/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema, ProgramSchema } from "@/lib/schemas";
import { solve } from "./distribution";
import type { DistCourse, Layer, Row, StudentContext } from "./distribution/types";
import {
  enforceOverlap,
  heldByLayer,
  holdBackLayers,
  overLimit,
  stripHeldPlacements,
  type HeldEntry,
} from "./distribution/overlap";
import { countedFromResult, holdCost, overlapPrograms, programOfLayer, progressScore } from "./multiProgram";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import type { Course, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";
import { computeRequirementProgress } from "./requirementProgress";
import { deriveSlotCategory } from "./slotCategory";

/**
 * Spec 047 D7: every promoted overlap fixture
 * (scripts/seed-data/golden/overlap/<minorId>.json, checked on its own
 * arithmetic by scripts/check-overlap-fixture.ts) run through the engine's
 * re-solve loop, wired as computeDistributionProgress wires it: the fixture's
 * major (from scripts/seed-data/layers/**) as the primary, its minor as the
 * extra program, its plan as the board (an Engineering major, which is a slot
 * template rather than a layer: through computeRequirementProgress itself,
 * where only the minor gives a course up). The engine must hold back what the
 * fixture says, or an equally valid alternative: as many courses, each one
 * the fixture lists as shared, held from the minor, and the pair within the
 * fixture's limit afterwards.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scripts", "seed-data"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate the repo root (scripts/seed-data)");
}
const SEED = join(findRepoRoot(), "scripts", "seed-data");

function jsonFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFilesUnder(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

type OverlapFixture = {
  programId: string;
  layerIds: string[];
  ctx: StudentContext;
  plan: string[];
  limit: { maxCourses?: number; maxCredits?: number };
  shared: string[];
  heldBack: { courseId: string; from: string }[];
  courses: DistCourse[];
};

const layersById = new Map<string, Layer>();
for (const file of jsonFilesUnder(join(SEED, "layers"))) {
  const layer = LayerSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as Layer;
  layersById.set(layer.id, layer);
}
const fixtures = jsonFilesUnder(join(SEED, "golden", "overlap")).map(
  (f) => JSON.parse(readFileSync(f, "utf8")) as OverlapFixture
);

// ── An Engineering major (a slot template, not a layer) ──────────────────────
// The fixture's major is an Engineering program in seed-data (programs-2025/<id>.json
// or programs.json): the plan runs through computeRequirementProgress with the
// minor as its extra program, the app's real Engineering + minor path. Each
// slot without a category gets the one backfill-slot-categories writes live.

type ProgramDocRaw = Record<string, unknown> & { id: string; slots: Record<string, unknown>[] };

function loadTemplateProgram(programId: string): ProgramDocRaw | null {
  const own = join(SEED, "programs-2025", `${programId}.json`);
  if (existsSync(own)) return JSON.parse(readFileSync(own, "utf8")) as ProgramDocRaw;
  const all = JSON.parse(readFileSync(join(SEED, "programs.json"), "utf8")) as ProgramDocRaw[];
  return all.find((p) => p.id === programId) ?? null;
}

function templateSlots(doc: ProgramDocRaw, byId: Map<string, DistCourse>): ProgramSlotWithData[] {
  const groups = new Map(((doc.electiveGroups as Record<string, unknown>[] | undefined) ?? []).map((g) => [g.id as string, g]));
  const slots = doc.slots.map((s) => {
    const out: Record<string, unknown> = { ...s };
    if (out.category == null) {
      const group = typeof s.electiveGroupId === "string" ? groups.get(s.electiveGroupId) : undefined;
      out.category = deriveSlotCategory(s as Parameters<typeof deriveSlotCategory>[0], group as Parameters<typeof deriveSlotCategory>[1]);
    }
    const c = s.kind === "course" && typeof s.courseId === "string" ? byId.get(s.courseId) : undefined;
    if (c) Object.assign(out, { courseTitle: c.title, creditsMin: c.credits, creditsMax: c.credits, courseSubject: c.subject, courseNumber: c.number });
    return out;
  });
  return normalizeProgramSlots(ProgramSchema.parse({ ...doc, slots }));
}

function runWithTemplate(doc: ProgramDocRaw, fx: OverlapFixture) {
  const minor = layersById.get(fx.layerIds[1]);
  expect(minor, `${fx.layerIds[1]} is a promoted layer`).toBeDefined();
  const byId = new Map(fx.courses.map((c) => [c.id, c]));
  expect(fx.plan.every((id) => byId.has(id))).toBe(true);
  const placedCourses = Object.fromEntries(
    fx.courses.map((c) => [
      c.id,
      { id: c.id, subject: c.subject, number: c.number, title: c.title, credits_min: c.credits, credits_max: c.credits, attrs: c.attrs ?? [] } as unknown as Course,
    ])
  );
  const placements: Placement[] = fx.plan.map((courseId, i) => ({ id: `p${i}-${courseId}`, courseId, sem: 1 + Math.floor((i * 8) / fx.plan.length), order: i }));
  const minorId = minor!.programId!;
  const progress = computeRequirementProgress({
    templateSlots: templateSlots(doc, byId),
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => id,
    entryTerm: fx.ctx.entryTerm ?? null,
    programId: doc.id,
    primaryName: { name: String(doc.name), shortName: String(doc.shortName) },
    extraPrograms: [
      { programId: minorId, kind: "minor", name: minor!.name, shortName: minor!.name, layers: [minor!], ...(minor!.sharing ? { sharing: minor!.sharing } : {}), status: "ok" },
    ],
  });
  const pair = progress.overlap?.find((p) => p.a === doc.id && p.b === minorId);
  expect(pair, "the app reports the pair").toBeDefined();
  const shared = pair!.sharedCourseIds.map((courseId) => ({ courseId, credits: byId.get(courseId)?.credits ?? 0 }));
  expect(overLimit(fx.limit, shared)).toBe(false);
  // The Engineering major is never re-solved: every hold-back is from the minor.
  const held = [...new Set(pair!.heldBack.map((h) => `${h.heldFrom}|${h.courseId}`))];
  expect(held).toHaveLength(fx.heldBack.length);
  for (const key of held) {
    const [from, courseId] = key.split("|");
    expect(fx.shared).toContain(courseId);
    expect(from).toBe(minorId);
  }
}

describe("overlap fixtures through the D7 loop", () => {
  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((fx) => [fx.programId, fx] as const))("%s", (_id, fx) => {
    const [majorId, minorId] = fx.layerIds;
    const template = layersById.has(majorId) ? null : loadTemplateProgram(majorId);
    if (template) return runWithTemplate(template, fx);
    const major = layersById.get(majorId);
    const minor = layersById.get(minorId);
    expect(major, `${majorId} is a promoted layer`).toBeDefined();
    expect(minor, `${minorId} is a promoted layer`).toBeDefined();
    const layers = [major!, minor!];
    const byId = new Map(fx.courses.map((c) => [c.id, c]));
    const courses = fx.plan.map((id) => byId.get(id)!).filter(Boolean);
    expect(courses).toHaveLength(fx.plan.length);

    const canonical = (id: string) => id;
    const primaryId = major!.programId!;
    const programs = overlapPrograms({ id: primaryId, layers: [major!], holdable: true }, [
      {
        programId: minor!.programId!,
        kind: "minor",
        name: minor!.name,
        shortName: minor!.name,
        layers: [minor!],
        ...(minor!.sharing ? { sharing: minor!.sharing } : {}),
        status: "ok",
      },
    ]);
    const layerProgram = programOfLayer(programs);
    const defs = new Map<string, Row>();
    for (const l of layers) for (const r of l.rows) defs.set(`${l.id}:${r.id}`, r);
    const input = {
      layers,
      courses,
      ctx: { ...fx.ctx, programId: primaryId, additionalProgramIds: [minor!.programId!] },
      canonical,
    };
    const outcome = enforceOverlap({
      programs,
      base: solve(input),
      solve: (h: HeldEntry[]) => {
        const by = heldByLayer(h, programs);
        return solve({ ...input, layers: holdBackLayers(layers, by), courses: stripHeldPlacements(courses, by, canonical) });
      },
      counted: (r) => countedFromResult(r, defs, layerProgram),
      score: (r) => progressScore(r, programs),
      cost: (r, pid, cid) => holdCost(r, programs, pid, cid),
    });

    expect(outcome.unresolved).toBe(false);
    const pair = outcome.pairs.find((p) => p.a === primaryId && p.b === minor!.programId)!;
    expect(pair.over).toBe(false);
    // Within the fixture's own reading of the limit, too.
    expect(overLimit(fx.limit, pair.shared)).toBe(false);

    // As many hold-backs as the fixture names, each a course the fixture
    // lists as shared, from one of the pair's programs (the fixture's own
    // choice, or an equally valid one: the limit holding is asserted above).
    const held = [...new Set(outcome.held.map((h) => `${h.from}|${h.courseId}`))];
    expect(held).toHaveLength(fx.heldBack.length);
    for (const key of held) {
      const [from, courseId] = key.split("|");
      expect(fx.shared).toContain(courseId);
      expect([primaryId, minor!.programId]).toContain(from);
    }
  });
});
