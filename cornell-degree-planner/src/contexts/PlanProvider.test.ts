import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";

// PlanProvider's pure plan-safety rules (fix pass P1/P2/P3/P5). The provider's
// Firebase-backed neighbours are stubbed so the module imports in node.
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => ({}) }));
vi.mock("@/services/plans", () => ({
  subscribePlan: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  listPlans: vi.fn(),
}));

const { restoreRemovedPlacement, shouldLayStartingBoard, shouldSkipSnapshot, nextCourseMarks } =
  await import("./PlanProvider");
const { MAX_PLACEMENTS } = await import("@/lib/planner/placementOps");

const course = (id: string) =>
  ({ id, subject: id.split("-")[0], number: id.split("-")[1] }) as unknown as Course;
const EMPTY_STATE = {
  placements: [] as Placement[],
  placedCourses: {} as Record<string, Course>,
  completedIds: [] as string[],
  inProgressIds: [] as string[],
  waivedRequirementIds: [] as string[],
  courseMarks: {} as Record<string, "yes" | "no" | number>,
};
const col = (sem: number, ids: string[]): Placement[] =>
  ids.map((id, order) => ({ id, courseId: `CS-${1000 + order}`, sem, order }));

describe("restoreRemovedPlacement — Undo (spec 014 §D8, fix pass P5)", () => {
  const removed = {
    planId: "plan-a",
    placement: { id: "x", courseId: "CS-2110", sem: 3, order: 1 },
    course: course("CS-2110"),
    wasCompleted: true,
    wasInProgress: false,
  };

  it("puts the placement back at its column + position with its course and mark", () => {
    const s = { ...EMPTY_STATE, placements: col(3, ["a", "b"]) };
    const out = restoreRemovedPlacement(s, removed, "plan-a");
    if (typeof out === "string") throw new Error(`unexpected ${out}`);
    expect(out.placements.filter((p) => p.sem === 3).sort((a, b) => a.order - b.order).map((p) => p.id)).toEqual([
      "a",
      "x",
      "b",
    ]);
    expect(out.placedCourses["CS-2110"]).toBe(removed.course);
    expect(out.completedIds).toEqual(["x"]);
  });

  it("is the same state when the placement is already back", () => {
    const s = { ...EMPTY_STATE, placements: [{ id: "x", courseId: "CS-2110", sem: 3, order: 0 }] };
    expect(restoreRemovedPlacement(s, removed, "plan-a")).toBe(s);
  });

  it("reports the cap instead of failing silently", () => {
    const full = Array.from({ length: MAX_PLACEMENTS }, (_, i) => ({
      id: `p${i}`,
      courseId: `CS-${i}`,
      sem: 1 + (i % 8),
      order: Math.floor(i / 8),
    }));
    expect(restoreRemovedPlacement({ ...EMPTY_STATE, placements: full }, removed, "plan-a")).toBe("cap");
  });
});

describe("shouldLayStartingBoard (fix pass P2)", () => {
  const emptyPlan = { ...EMPTY_STATE, legacy: false };

  it("a plan the student emptied on purpose stays empty (reload / second tab)", () => {
    expect(shouldLayStartingBoard(emptyPlan, false)).toBe(false);
  });

  it("a just-created empty plan gets the starting board", () => {
    expect(shouldLayStartingBoard(emptyPlan, true)).toBe(true);
  });

  it("a legacy doc (read as empty) gets the starting board", () => {
    expect(shouldLayStartingBoard({ ...emptyPlan, legacy: true }, false)).toBe(true);
  });

  it("never over a plan with content", () => {
    const plan = { ...emptyPlan, legacy: true, placements: col(1, ["a"]) };
    expect(shouldLayStartingBoard(plan, true)).toBe(false);
    expect(shouldLayStartingBoard({ ...emptyPlan, waivedRequirementIds: ["r1"] }, true)).toBe(false);
  });
});

describe("shouldSkipSnapshot (fix pass P3)", () => {
  it("skips a snapshot of the plan whose write is still debouncing", () => {
    expect(shouldSkipSnapshot("plan-a", "plan-a")).toBe(true);
  });
  it("applies it when nothing is pending, or the pending write is another plan's", () => {
    expect(shouldSkipSnapshot(null, "plan-a")).toBe(false);
    expect(shouldSkipSnapshot(undefined, "plan-a")).toBe(false);
    expect(shouldSkipSnapshot("plan-b", "plan-a")).toBe(false);
  });
});

describe("restoreRemovedPlacement — plan guard (fix pass P1)", () => {
  it("refuses to restore into a different plan than the one it was removed from", () => {
    const removed = {
      planId: "plan-a",
      placement: { id: "x", courseId: "CS-2110", sem: 3, order: 0 },
      course: null,
      wasCompleted: false,
      wasInProgress: false,
    };
    expect(restoreRemovedPlacement(EMPTY_STATE, removed, "plan-b")).toBe("other-plan");
    expect(restoreRemovedPlacement(EMPTY_STATE, removed, null)).toBe("other-plan");
  });
});

describe("nextCourseMarks — spec 020 course marks", () => {
  const FWS = "usedAs:cas-college/fws@ENGL-2880";
  const many = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:BIOMI-${4000 + i}`, 3]));

  it("adds and changes an answer", () => {
    expect(nextCourseMarks({}, FWS, "yes")).toEqual({ [FWS]: "yes" });
    expect(nextCourseMarks({ [FWS]: "yes" }, FWS, "no")).toEqual({ [FWS]: "no" });
    expect(nextCourseMarks({}, "creditsTaken:BIOMI-4850", 3)).toEqual({ "creditsTaken:BIOMI-4850": 3 });
  });

  it("clearing deletes the key (never stored as null)", () => {
    const out = nextCourseMarks({ [FWS]: "yes", "creditsTaken:BIOMI-4850": 3 }, FWS, null);
    expect(out).toEqual({ "creditsTaken:BIOMI-4850": 3 });
    expect(out).not.toHaveProperty(FWS);
  });

  it("is 'same' when nothing changes", () => {
    expect(nextCourseMarks({ [FWS]: "yes" }, FWS, "yes")).toBe("same");
    expect(nextCourseMarks({}, FWS, null)).toBe("same");
  });

  it("refuses a NEW answer past the 80-mark cap, but still changes or clears one at the cap", () => {
    const full = many(80);
    expect(nextCourseMarks(full, FWS, "yes")).toBe("cap");
    expect(nextCourseMarks(full, "creditsTaken:BIOMI-4000", 4)).not.toBe("cap");
    expect(Object.keys(nextCourseMarks(full, "creditsTaken:BIOMI-4000", null) as object)).toHaveLength(79);
  });

  it("refuses a malformed key or value", () => {
    expect(nextCourseMarks({}, "bad.key", "yes")).toBe("invalid");
    expect(nextCourseMarks({}, "creditsTaken:BIOMI-4850", 99)).toBe("invalid");
  });

  it("restoring a removed placement leaves the marks alone (a mark outlives its course, D5)", () => {
    const s = { ...EMPTY_STATE, courseMarks: { [FWS]: "yes" as const } };
    const removed = {
      planId: "plan-a",
      placement: { id: "x", courseId: "ENGL-2880", sem: 1, order: 0 },
      course: course("ENGL-2880"),
      wasCompleted: false,
      wasInProgress: false,
    };
    const out = restoreRemovedPlacement(s, removed, "plan-a");
    expect(typeof out === "object" && out.courseMarks).toEqual({ [FWS]: "yes" });
  });
});
