/**
 * EAS (spec 035): the real program file through computeRequirementProgress.
 * - The field course can be 3 credits of independent research split across
 *   EAS 4910 and 4920. Both are also 3000+ (the major-approved elective), so a
 *   short pair must still finish the Field Course rather than leave it partial.
 *   The app counts a variable-credit course at its minimum (1 credit for these),
 *   so on a real board the pair shows 2 of 3 and the seat's notes say to waive
 *   it; the 1 + 2 cases pin the matcher's side (spec 032's take-back).
 * - A core course of another concentration counts as a concentration course
 *   once the three core seats are full (Climate students list EAS 3030).
 * - Outside electives refuse EAS courses.
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

const doc = JSON.parse(readFileSync(join(seedDir(), "programs-2025", "cornell-eas-bs-2025.json"), "utf-8"));
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

describe("EAS electives (spec 035)", () => {
  it("EAS 4910 + 4920 (1 + 2 credits) finish the Field Course, in either order", () => {
    for (const board of [
      [["EAS-4910", 1], ["EAS-4920", 2]],
      [["EAS-4920", 2], ["EAS-4910", 1]],
    ] as [string, number][][]) {
      expect(progressOf(board)("eas-field-course").status).toBe("satisfied");
    }
  });

  it("the pair still finishes the Field Course with the science and major-approved seats in play", () => {
    for (const board of [
      [["EAS-4910", 1], ["EAS-4920", 2], ["MATH-2210", 4], ["ECON-3030", 4]],
      [["ECON-3030", 4], ["EAS-4920", 2], ["MATH-2210", 4], ["EAS-4910", 1]],
      [["EAS-4920", 2], ["EAS-4910", 1], ["EAS-4350", 3]],
    ] as [string, number][][]) {
      const of = progressOf(board);
      expect(of("eas-field-course").status).toBe("satisfied");
    }
    const full = progressOf([["EAS-4910", 1], ["EAS-4920", 2], ["MATH-2210", 4], ["ECON-3030", 4]]);
    expect(full("eas-advisor-course").status).toBe("satisfied");
    // ECON 3030 is both 3000+ and outside EAS: it fills one of the two, either is right.
    const econ = [full("eas-major-approved-elect").status, full("eas-outside-elect").status];
    expect(econ.filter((s) => s !== "unmet")).toHaveLength(1);
  });

  it("at their catalog minimum (1 credit each), the research pair leaves the Field Course partial", () => {
    expect(progressOf([["EAS-4910", 1]])("eas-field-course").status).toBe("partial");
    const pair = progressOf([["EAS-4910", 1], ["EAS-4920", 1]])("eas-field-course");
    expect(pair.status).toBe("partial");
  });

  it("EAS 2500 fills the Field Course on its own", () => {
    expect(progressOf([["EAS-2500", 4]])("eas-field-course").status).toBe("satisfied");
  });

  it("a Climate student's three core courses fill Core, and EAS 3030 counts as a concentration course", () => {
    const of = progressOf([
      ["EAS-3050", 3],
      ["EAS-3410", 3],
      ["EAS-3420", 3],
      ["EAS-3030", 4],
    ]);
    expect(of("eas-core").status).toBe("satisfied");
    expect(of("eas-concentration").status).toBe("partial");
  });

  it("the advisor-approved science course and the biology course fill from their lists", () => {
    const of = progressOf([
      ["MATH-2210", 4],
      ["BIOEE-1780", 4],
    ]);
    expect(of("eas-advisor-course").status).toBe("satisfied");
    expect(of("eas-biology").status).toBe("satisfied");
  });

  it("an EAS course never fills an Outside Elective", () => {
    const of = progressOf([["EAS-4350", 3]]);
    expect(of("eas-outside-elect").status).toBe("unmet");
  });

  it("three non-EAS courses fill the Outside Electives", () => {
    const of = progressOf([
      ["ECON-1110", 3],
      ["GOVT-1111", 3],
      ["PSYCH-1101", 3],
    ]);
    expect(of("eas-outside-elect").status).toBe("satisfied");
  });
});
