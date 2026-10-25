/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramSchema } from "@/lib/schemas";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import type { Course, CourseAttr, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";
import { computeRequirementProgress } from "./requirementProgress";
import { assign, programToRequirements, type Assignment } from "./majorMatch";
import { buildMatchPool, programSlotsToMatchInput } from "./matchAdapters";

/**
 * Golden plans (spec 019 "Testing"): one known-good plan per Engineering major,
 * replayed through the real requirement path — schema parse → normalizer →
 * computeRequirementProgress / assign — with the program read from seed-data
 * at test time, so data fixes flow through.
 *
 * Fixtures are built by scripts/build-golden-plans.ts and are self-contained
 * for courses. Each holds a `full` plan (a distinct course for every slot) and
 * `one-of-<group>` plans (the full plan with all but one of a multi-slot
 * group's courses removed).
 */

/** A group with N slots needs N courses (spec 019 D6/D7). Was false while the
 *  P-11 before-snapshot was recorded; every one-of case failed then. */
const ENGINE_COUNTS_EVERY_SLOT = true;

// ── Fixture + program loading ───────────────────────────────────────────────

type FixtureCourse = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  attrs: CourseAttr[];
};
type Gap = { requirementId: string; reason: string; needed: number; placed: number };
type Plan = { name: string; groupId?: string; courseIds: string[] };
type Fixture = {
  programId: string;
  generatedFrom: string;
  gaps: Gap[];
  plans: Plan[];
  courses: FixtureCourse[];
};

/** Walk up from this file until we find scripts/seed-data. */
function findSeedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const SEED_DIR = findSeedDir();
const GOLDEN_DIR = join(SEED_DIR, "golden");

function loadFixtures(): Fixture[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as Fixture);
}

/** The raw program doc: a 2025 file of its own, or an entry in programs.json. */
function loadProgramDoc(programId: string): Record<string, unknown> {
  const own = join(SEED_DIR, "programs-2025", `${programId}.json`);
  if (existsSync(own)) return JSON.parse(readFileSync(own, "utf-8"));
  const legacy = JSON.parse(readFileSync(join(SEED_DIR, "programs.json"), "utf-8")) as Record<string, unknown>[];
  const doc = legacy.find((p) => p.id === programId);
  if (!doc) throw new Error(`program ${programId} not in seed-data`);
  return doc;
}

/** Program → joined slots, the way the app reads it. Course-kind slots get
 *  their display snapshot from the fixture courses, as the seeders do from
 *  the live catalog. */
function programSlots(fx: Fixture): ProgramSlotWithData[] {
  const byId = new Map(fx.courses.map((c) => [c.id, c]));
  const doc = loadProgramDoc(fx.programId);
  const slots = (doc.slots as Record<string, unknown>[]).map((s) => {
    const c = s.kind === "course" && typeof s.courseId === "string" ? byId.get(s.courseId) : undefined;
    if (!c) return s;
    return {
      ...s,
      courseTitle: c.title,
      creditsMin: c.creditsMin,
      creditsMax: c.creditsMax,
      courseSubject: c.subject,
      courseNumber: c.number,
    };
  });
  return normalizeProgramSlots(ProgramSchema.parse({ ...doc, slots }));
}

function toCourse(c: FixtureCourse): Course {
  return {
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    credits_min: c.creditsMin,
    credits_max: c.creditsMax,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: c.attrs,
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
}

/** Spread the plan's courses over semesters 1..8 in plan order, so board
 *  order (sem, then order) is the plan's own order. */
function placementsFor(plan: Plan): Placement[] {
  const n = plan.courseIds.length;
  const perSem = new Map<number, number>();
  return plan.courseIds.map((courseId, i) => {
    const sem = Math.floor((i * 8) / n) + 1;
    const order = perSem.get(sem) ?? 0;
    perSem.set(sem, order + 1);
    return { id: `${plan.name}-${i}`, courseId, sem, order };
  });
}

type Run = { progress: RequirementProgress; items: RequirementItem[]; assignment: Assignment };

function runPlan(fx: Fixture, slots: ProgramSlotWithData[], plan: Plan): Run {
  const placedCourses: Record<string, Course> = {};
  for (const c of fx.courses) placedCourses[c.id] = toCourse(c);
  const placements = placementsFor(plan);
  const progress = computeRequirementProgress({
    templateSlots: slots,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => id,
  });
  const assignment = assign(
    buildMatchPool({ placements, placedCourses, creditProfile: [] }),
    programToRequirements(programSlotsToMatchInput(slots))
  );
  return { progress, items: progress.groups.flatMap((g) => g.items), assignment };
}

/** The compact, engine-agnostic record the snapshot pins. */
function summarize(r: Run) {
  return {
    satisfiedCount: r.progress.satisfiedCount,
    total: r.progress.total,
    items: [...r.items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((it) => ({ id: it.id, status: it.status, coveredCount: it.coveredBy.length })),
    pct: r.assignment.pct,
    creditsSatisfied: r.assignment.creditsSatisfied,
    creditsRequired: r.assignment.creditsRequired,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

const FIXTURES = loadFixtures();

describe("golden plans", () => {
  it("covers the 13 Engineering majors", () => {
    expect(FIXTURES.map((f) => f.programId)).toHaveLength(13);
  });

  for (const fx of FIXTURES) {
    describe(fx.programId, () => {
      const slots = programSlots(fx);
      const full = fx.plans.find((p) => p.name === "full");
      if (!full) throw new Error(`${fx.programId}: fixture has no full plan`);
      const gapIds = new Set(fx.gaps.map((g) => g.requirementId));

      it("full plan: every checkable requirement is satisfied (except recorded gaps)", () => {
        const { items } = runPlan(fx, slots, full);
        const unexplained = items
          .filter((it) => it.checkable && it.status !== "satisfied" && !gapIds.has(it.id))
          .map((it) => `${it.id}: ${it.status}`);
        expect(unexplained).toEqual([]);
      });

      for (const plan of fx.plans) {
        it(`snapshot: ${plan.name}`, () => {
          expect(summarize(runPlan(fx, slots, plan))).toMatchSnapshot();
        });
      }

      // Removing all but one of a group's courses must cost the plan a
      // requirement. Usually that is the group itself ("partial"), but pools
      // fill greedily in group order, so a broad group (open/outside) that
      // comes first can make up its count from a later group's course and
      // leave THAT group short instead. Either way the plan drops.
      for (const plan of fx.plans.filter((p) => p.groupId)) {
        it.skipIf(!ENGINE_COUNTS_EVERY_SLOT)(`${plan.name}: one course leaves the plan unfinished`, () => {
          const before = runPlan(fx, slots, full);
          const after = runPlan(fx, slots, plan);
          expect(after.items.some((it) => it.id === plan.groupId), `no requirement item for ${plan.groupId}`).toBe(true);
          const dropped = before.items
            .filter((it) => it.status === "satisfied")
            .filter((it) => after.items.find((a) => a.id === it.id)?.status !== "satisfied")
            .map((it) => it.id);
          expect(dropped, `${plan.groupId} kept every requirement satisfied`).not.toEqual([]);
        });
      }
    });
  }
});
