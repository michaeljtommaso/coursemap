/**
 * Spec 040: the second Engineering Distribution seats of CE, EnvE, EAS and EP,
 * run through the real 2025 program files. Each seat takes the college's ENGRD
 * categories the major hasn't already covered (plus the major's own substitute
 * routes) and leaves out courses the major requires.
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

const slotsOf = (programId: string) =>
  normalizeProgramSlots(
    ProgramSchema.parse(JSON.parse(readFileSync(join(seedDir(), "programs-2025", `${programId}.json`), "utf-8")))
  );

const course = (id: string, credits = 4): Course => {
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

/** Status of each requirement id after placing `courseIds` (4 credits each). */
function statuses(programId: string, courseIds: string[]): (id: string) => string | undefined {
  const placedCourses: Record<string, Course> = {};
  const placements: Placement[] = courseIds.map((courseId, i) => {
    placedCourses[courseId] = course(courseId);
    return { id: `p${i}`, courseId, sem: 3 + (i % 2), order: Math.floor(i / 2) };
  });
  const progress = computeRequirementProgress({
    templateSlots: slotsOf(programId),
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => id,
  });
  const items = progress.groups.flatMap((g) => g.items);
  return (id) => items.find((it) => it.id === id)?.status;
}

describe("second Engineering Distribution (spec 040)", () => {
  it("CE: an ENGRD from another category fills it; ENGRD 2020 and CEE 3040 don't", () => {
    expect(statuses("cornell-ce-bs-2025", ["ENGRD-2210"])("ce-engrd-second")).toBe("satisfied");
    expect(statuses("cornell-ce-bs-2025", ["ENGRD-2020", "CEE-3040"])("ce-engrd-second")).not.toBe("satisfied");
  });

  it("EnvE: any ENGRD, or a 3000+ engineering course, fills it; BEE 2510 doesn't", () => {
    expect(statuses("cornell-enve-bs-2025", ["ENGRD-2600"])("enve-engrd-second")).toBe("satisfied");
    expect(statuses("cornell-enve-bs-2025", ["CS-3110"])("enve-engrd-second")).toBe("satisfied");
    expect(statuses("cornell-enve-bs-2025", ["BEE-2510"])("enve-engrd-second")).not.toBe("satisfied");
  });

  it("EAS: two ENGRDs fill both seats; EAS 2250 fills neither", () => {
    const two = statuses("cornell-eas-bs-2025", ["ENGRD-2110", "ENGRD-2700"]);
    expect(two("eas-engrd")).toBe("satisfied");
    expect(two("eas-engrd-second")).toBe("satisfied");
    const intro = statuses("cornell-eas-bs-2025", ["EAS-2250", "ENGRD-2250"]);
    expect(intro("eas-engrd")).not.toBe("satisfied");
    expect(intro("eas-engrd-second")).not.toBe("satisfied");
  });

  it("EP: MATH 4710 fills it; ENGRD 2020 (Mechanics, AEP 3330's category) doesn't", () => {
    expect(statuses("cornell-ep-bs-2025", ["MATH-4710"])("ep-engrd-second")).toBe("satisfied");
    expect(statuses("cornell-ep-bs-2025", ["ENGRD-2020"])("ep-engrd-second")).not.toBe("satisfied");
  });
});
