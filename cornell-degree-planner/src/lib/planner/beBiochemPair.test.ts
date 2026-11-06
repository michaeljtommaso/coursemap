/**
 * BE (spec 031): the two-course biochemistry option, BIOMG 3310 + 3320, must
 * fill Biochemistry even when an upper-level biology course is also on the
 * board. BIOMG 3310 meets the upper-level biology rule too; when both lists held
 * it, the matcher's one-course-per-seat pass put 3310 into Upper Level Biology
 * and left Biochemistry at 2 of 4 credits. The program's lists keep the
 * biochemistry options out of Upper Level Biology, and this pins that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramSchema } from "@/lib/schemas";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import { computeRequirementProgress } from "./requirementProgress";

function seedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const doc = JSON.parse(readFileSync(join(seedDir(), "programs-2025", "cornell-be-bs-2025.json"), "utf-8"));
const slots = normalizeProgramSlots(ProgramSchema.parse(doc));

const course = (id: string, credits: number): Course => {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: id,
    credits_min: credits,
    credits_max: credits,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
};

const COURSES = { "BIOMG-3310": 3, "BIOMG-3320": 2, "BIOMI-2900": 3, "BIOMG-3300": 4 } as const;

function statusOf(courseIds: (keyof typeof COURSES)[]) {
  const placedCourses: Record<string, Course> = {};
  const placements: Placement[] = courseIds.map((courseId, i) => {
    placedCourses[courseId] = course(courseId, COURSES[courseId]);
    return { id: `p${i}`, courseId, sem: 5 + (i % 2), order: Math.floor(i / 2) };
  });
  const progress = computeRequirementProgress({
    templateSlots: slots,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => id,
  });
  const items = progress.groups.flatMap((g) => g.items);
  const of = (id: string) => items.find((it) => it.id === id)?.status;
  return { biochem: of("be-biochem"), upper: of("be-upper-bio") };
}

describe("BE biochemistry pair (spec 031)", () => {
  it("BIOMG 3310 alone leaves Biochemistry partial", () => {
    expect(statusOf(["BIOMG-3310"]).biochem).toBe("partial");
  });

  it("BIOMG 3310 + 3320 fill Biochemistry and stay out of Upper Level Biology", () => {
    expect(statusOf(["BIOMG-3310", "BIOMG-3320"])).toEqual({ biochem: "satisfied", upper: "unmet" });
  });

  it("with BIOMI 2900 too, both requirements are satisfied, in any board order", () => {
    for (const order of [
      ["BIOMG-3310", "BIOMG-3320", "BIOMI-2900"],
      ["BIOMI-2900", "BIOMG-3320", "BIOMG-3310"],
      ["BIOMG-3320", "BIOMI-2900", "BIOMG-3310"],
    ] as (keyof typeof COURSES)[][]) {
      expect(statusOf(order)).toEqual({ biochem: "satisfied", upper: "satisfied" });
    }
  });

  it("BIOMG 3300 fills Biochemistry on its own", () => {
    expect(statusOf(["BIOMG-3300"]).biochem).toBe("satisfied");
  });
});
