import { describe, it, expect } from "vitest";
import {
  seedPlanFromPrevious,
  planContentIsEmpty,
  type PrevPlanSnapshot,
} from "./seedPlanFromPrevious";
import { columnPlacements } from "./placementOps";
import type { RemapTargetSlot, RemapCourse } from "./remapPlacements";
import type { Placement } from "@/types/plan";

function course(id: string, title?: string): RemapCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title };
}

const P = (id: string, courseId: string, sem: number, order: number): Placement => ({
  id,
  courseId,
  sem,
  order,
});

function prevPlan(partial: Partial<PrevPlanSnapshot> = {}): PrevPlanSnapshot {
  return {
    placements: [],
    placedCourses: {},
    completedIds: [],
    inProgressIds: [],
    ...partial,
  };
}

const orieTargets: RemapTargetSlot[] = [
  { id: "orie-calc", kind: "course", courseId: "MATH-1910" },
  { id: "orie-tech", kind: "pattern", pattern: "CS-2xxx" },
  {
    id: "orie-fws",
    kind: "attribute",
    attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
  },
];

const fourCourses = (): PrevPlanSnapshot =>
  prevPlan({
    placements: [
      P("p-calc", "MATH-1910", 1, 0),
      P("p-fws", "ENGL-1134", 1, 1),
      P("p-2110", "CS-2110", 3, 0),
      P("p-music", "MUSIC-1201", 5, 0),
    ],
    placedCourses: {
      "MATH-1910": course("MATH-1910"),
      "CS-2110": course("CS-2110"),
      "ENGL-1134": course("ENGL-1134", "FWS: True Stories"),
      "MUSIC-1201": course("MUSIC-1201"),
    },
  });

describe("seedPlanFromPrevious — every placement travels (spec 009 §4 intent, spec 014 model)", () => {
  it("carries every placement at the same column and position, with the same ids", () => {
    const prev = fourCourses();
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed).not.toBeNull();
    expect(seed.placements).toEqual(prev.placements);
    expect(seed.kept).toBe(4);
    expect([...seed.courseIds].sort()).toEqual(["CS-2110", "ENGL-1134", "MATH-1910", "MUSIC-1201"]);
  });

  it("counts matched = carried courses that fill a new-program requirement (exact / pattern / attribute)", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets)!;
    // MATH-1910 exact, CS-2110 pattern, ENGL-1134 attribute; MUSIC-1201 counts toward nothing.
    expect(seed.matched).toBe(3);
  });

  it("completed / in-progress marks travel with their placement", () => {
    const prev = { ...fourCourses(), completedIds: ["p-calc"], inProgressIds: ["p-music"] };
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed.completedIds).toEqual(["p-calc"]);
    expect(seed.inProgressIds).toEqual(["p-music"]);
  });

  it("skips a placement whose course data is gone (never invent a course), and its marks", () => {
    const prev = prevPlan({
      placements: [P("p1", "MATH-1910", 1, 0), P("p2", "GONE-1", 1, 1)],
      placedCourses: { "MATH-1910": course("MATH-1910") },
      completedIds: ["p2"],
    });
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed.placements.map((p) => p.id)).toEqual(["p1"]);
    expect(seed.completedIds).toEqual([]);
    expect(seed.kept).toBe(1);
  });

  it("returns null when the previous plan has nothing to carry", () => {
    expect(seedPlanFromPrevious(prevPlan(), orieTargets)).toBeNull();
    expect(
      seedPlanFromPrevious(prevPlan({ placements: [P("x", "GONE-1", 1, 0)] }), orieTargets)
    ).toBeNull();
  });

  it("is pure — inputs are not mutated", () => {
    const prev = { ...fourCourses(), completedIds: ["p-calc"] };
    const before = JSON.stringify(prev);
    seedPlanFromPrevious(prev, orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    expect(JSON.stringify(prev)).toBe(before);
  });

  it("is deterministic — same inputs, same seed (switch-back safe)", () => {
    const a = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    const b = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    expect(a).toEqual(b);
  });
});

describe("seedPlanFromPrevious — the new program's starting board (spec 014 §D6)", () => {
  it("adds the new program's fixed courses under the carried cards of their column", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets, [
      P("s-3300", "ORIE-3300", 5, 0),
      P("s-1112", "PHYS-1112", 1, 0),
    ])!;
    expect(columnPlacements(seed.placements, 5).map((p) => p.courseId)).toEqual([
      "MUSIC-1201",
      "ORIE-3300",
    ]);
    expect(columnPlacements(seed.placements, 1).map((p) => p.courseId)).toEqual([
      "MATH-1910",
      "ENGL-1134",
      "PHYS-1112",
    ]);
    expect(seed.courseIds).toContain("ORIE-3300");
    // kept counts only what the student carried, not the new defaults
    expect(seed.kept).toBe(4);
  });

  it("does not duplicate a fixed course the student already carries", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s-calc", "MATH-1910", 1, 0)])!;
    expect(seed.placements.filter((p) => p.courseId === "MATH-1910")).toHaveLength(1);
    expect(seed.placements.some((p) => p.id === "s-calc")).toBe(false);
  });
});

describe("planContentIsEmpty — the seed-or-load decision", () => {
  const empty = { placements: [], completedIds: [], inProgressIds: [], waivedRequirementIds: [] };

  it("true for a fresh/created (or legacy-normalized) plan doc", () => {
    expect(planContentIsEmpty(empty)).toBe(true);
  });

  it("false when ANY student content exists (load untouched, no seeding)", () => {
    expect(planContentIsEmpty({ ...empty, placements: [P("p", "CS-1110", 1, 0)] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, completedIds: ["p"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, inProgressIds: ["p"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, waivedRequirementIds: ["r"] })).toBe(false);
  });
});
