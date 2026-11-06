import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";

// PlanProvider's pure plan-safety rules (fix pass P1/P2/P3/P5). The provider's
// Firebase-backed neighbours are stubbed so the module imports in node.
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => ({}) }));
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
vi.mock("@/services/plans", () => ({
  subscribePlan: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  listPlans: vi.fn(),
}));

const {
  restoreRemovedPlacement,
  shouldLayStartingBoard,
  shouldSkipSnapshot,
  nextCourseMarks,
  nextTriedCourses,
  triedAfterPlacing,
  seedStates,
} = await import("./PlanProvider");
const { MAX_PLACEMENTS } = await import("@/lib/planner/placementOps");
const { MAX_COURSE_MARKS, MAX_TRIED_COURSES } = await import("@/lib/schemas");

const course = (id: string) =>
  ({ id, subject: id.split("-")[0], number: id.split("-")[1] }) as unknown as Course;
const EMPTY_STATE = {
  placements: [] as Placement[],
  placedCourses: {} as Record<string, Course>,
  completedIds: [] as string[],
  inProgressIds: [] as string[],
  waivedRequirementIds: [] as string[],
  courseMarks: {} as Record<string, "yes" | "no" | number>,
  triedCourseIds: [] as string[],
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

describe("seedStates — major-switch carry-over seed (spec 020 D5)", () => {
  const marks = (prefix: string, n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:${prefix}-${2000 + i}`, 3]));
  const board = {
    placements: col(1, ["a"]),
    placedCourses: {},
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
  };

  it("caps the seeded marks at 80, the target plan's own marks first", () => {
    const target = marks("CHEM", 40);
    const { next } = seedStates(board, marks("BIOMI", 50), target);
    expect(Object.keys(next.courseMarks)).toHaveLength(MAX_COURSE_MARKS);
    for (const key of Object.keys(target)) expect(key in next.courseMarks).toBe(true);
    expect(next.placements).toBe(board.placements);
  });

  it("a failed seed save rolls back to the target plan's own marks, not to none", () => {
    const target = marks("CHEM", 5);
    const { confirmed } = seedStates(board, marks("BIOMI", 3), target);
    expect(confirmed.courseMarks).toEqual(target);
    expect(confirmed.placements).toEqual([]);
    // The next edit builds on `confirmed`, so its save carries the marks back
    // instead of an empty map that would clear them on the server.
    const edit = nextCourseMarks(confirmed.courseMarks, "creditsTaken:CHEM-9999", 4);
    expect(typeof edit === "object" && Object.keys(edit)).toHaveLength(6);
  });
});

describe("tried classes (spec 025 D12)", () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${2000 + i}`);

  it("triedAfterPlacing drops the placed course, cross-listings included; same array otherwise", () => {
    const tried = ["CS-2110", "HIST-1530"];
    expect(triedAfterPlacing(tried, "HIST-1530")).toEqual(["CS-2110"]);
    const alias: Record<string, string> = { "ENGRD-2110": "CS-2110" };
    expect(triedAfterPlacing(tried, "ENGRD-2110", (id) => alias[id] ?? id)).toEqual(["HIST-1530"]);
    expect(triedAfterPlacing(tried, "MATH-1910")).toBe(tried);
    const none: string[] = [];
    expect(triedAfterPlacing(none, "CS-2110")).toBe(none);
  });

  it("nextTriedCourses appends; refuses a repeat, the 21st class and a malformed id", () => {
    expect(nextTriedCourses([], "CS-2110")).toEqual(["CS-2110"]);
    expect(nextTriedCourses(["CS-2110"], "MATH-2930")).toEqual(["CS-2110", "MATH-2930"]);
    expect(nextTriedCourses(["CS-2110"], "CS-2110")).toBe("same");
    expect(nextTriedCourses(ids("CS", MAX_TRIED_COURSES), "MATH-2930")).toBe("cap");
    expect(nextTriedCourses([], "")).toBe("invalid");
    expect(nextTriedCourses([], "X".repeat(41))).toBe("invalid");
  });

  it("a major-switch seed carries tried classes after the target plan's own, capped at 20", () => {
    const board = { placements: col(1, ["a"]), placedCourses: {}, completedIds: [], inProgressIds: [], waivedRequirementIds: [] };
    const target = ids("CHEM", 15);
    const { next, confirmed } = seedStates(board, {}, {}, [...ids("BIOMI", 10), "CHEM-2000"], target);
    expect(next.triedCourseIds).toHaveLength(MAX_TRIED_COURSES);
    expect(next.triedCourseIds.slice(0, 15)).toEqual(target);
    expect(new Set(next.triedCourseIds).size).toBe(MAX_TRIED_COURSES);
    // A failed seed save rolls back to the target plan's own list, not to none.
    expect(confirmed.triedCourseIds).toEqual(target);
  });

  it("a seed without tried classes leaves the list empty", () => {
    const board = { placements: col(1, ["a"]), placedCourses: {}, completedIds: [], inProgressIds: [], waivedRequirementIds: [] };
    expect(seedStates(board, {}, {}).next.triedCourseIds).toEqual([]);
  });
});
