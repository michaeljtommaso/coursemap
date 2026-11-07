/**
 * EP (spec 036): the real program file through computeRequirementProgress.
 * - Two of AEP 3560 / 3620 / 4340 fill the Advanced AEP Course seats, in any
 *   order; a third counts as a major-approved elective (note e).
 * - Five major-approved electives must be 3000+; the sixth may be any level, so
 *   a 2000-level technical course fills only the any-level seat.
 * - A non-technical course fills no major-approved seat.
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

const doc = JSON.parse(readFileSync(join(seedDir(), "programs-2025", "cornell-ep-bs-2025.json"), "utf-8"));
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

function progressOf(board: [string, number][]) {
  const placedCourses: Record<string, Course> = {};
  const placements: Placement[] = board.map(([courseId, credits], i) => {
    placedCourses[courseId] = course(courseId, credits);
    return { id: `p${i}`, courseId, sem: 5 + (i % 4), order: Math.floor(i / 4) };
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
  return (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) throw new Error(`no requirement ${id}; have ${items.map((x) => x.id).join(", ")}`);
    return it;
  };
}

describe("EP electives (spec 036)", () => {
  it("two of the three advanced AEP courses fill the seats, in any pair and order", () => {
    for (const board of [
      [["AEP-3560", 4], ["AEP-3620", 4]],
      [["AEP-4340", 4], ["AEP-3560", 4]],
      [["AEP-3620", 4], ["AEP-4340", 4]],
    ] as [string, number][][]) {
      expect(progressOf(board)("ep-advanced-core").status).toBe("satisfied");
    }
    expect(progressOf([["AEP-3620", 4]])("ep-advanced-core").status).toBe("partial");
  });

  it("a third advanced AEP course counts as a major-approved elective", () => {
    const of = progressOf([
      ["AEP-3560", 4],
      ["AEP-3620", 4],
      ["AEP-4340", 4],
    ]);
    expect(of("ep-advanced-core").status).toBe("satisfied");
    expect(of("ep-major-approved-elective").coveredBy.length + of("ep-major-approved-any").coveredBy.length).toBe(1);
  });

  it("five 3000+ technical courses and one 2000-level course fill all six major-approved seats", () => {
    const of = progressOf([
      ["ECE-3030", 4],
      ["PHYS-3316", 4],
      ["AEP-4380", 3],
      ["MATH-4130", 4],
      ["AEP-4900", 3],
      ["MATH-2210", 4],
    ]);
    expect(of("ep-major-approved-elective").status).toBe("satisfied");
    expect(of("ep-major-approved-any").status).toBe("satisfied");
  });

  it("2000-level courses fill only the any-level seat", () => {
    const of = progressOf([
      ["MATH-2210", 4],
      ["MATH-2220", 4],
      ["BIOMG-1350", 3],
    ]);
    expect(of("ep-major-approved-any").status).toBe("satisfied");
    expect(of("ep-major-approved-elective").status).toBe("unmet");
  });

  it("a non-technical course fills no major-approved seat", () => {
    const of = progressOf([["ECON-3130", 4]]);
    expect(of("ep-major-approved-elective").status).toBe("unmet");
    expect(of("ep-major-approved-any").status).toBe("unmet");
  });
});
