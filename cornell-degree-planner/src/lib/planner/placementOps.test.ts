import { describe, it, expect } from "vitest";
import {
  MAX_PLACEMENTS,
  clampSem,
  columnPlacements,
  insertPlacement,
  movePlacementTo,
  normalizePlacementOrder,
  positionBefore,
  positionOf,
  removePlacementById,
  sanitizePlacements,
  startingPlacements,
} from "./placementOps";
import type { Placement } from "@/types/plan";
import type { Course, ProgramSlotWithData } from "@/types/db";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = (id: string, sem: number, order: number, courseId = `C-${id}`): Placement => ({
  id,
  courseId,
  sem,
  order,
});

/** Column contents as ids, top → bottom. */
const col = (ps: Placement[], sem: number) => columnPlacements(ps, sem).map((p) => p.id);

/** Every column's orders are exactly 0..n-1. */
function expectDense(ps: Placement[]) {
  const sems = new Set(ps.map((p) => p.sem));
  for (const s of sems) {
    expect(columnPlacements(ps, s).map((p) => p.order)).toEqual(
      columnPlacements(ps, s).map((_, i) => i)
    );
  }
}

// Board: sem 1 = [a, b, c], sem 2 = [d, e]
const board = (): Placement[] => [P("a", 1, 0), P("b", 1, 1), P("c", 1, 2), P("d", 2, 0), P("e", 2, 1)];

function course(id: string): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: id,
    credits_min: 3,
    credits_max: 3,
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
    updated_at: "",
  };
}

function slot(id: string, over: Partial<ProgramSlotWithData> = {}): ProgramSlotWithData {
  return {
    id,
    program_id: "p",
    kind: "course",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: 1,
    slot_row: 0,
    category: null,
    attribute_match: null,
    courses: null,
    elective_groups: null,
    ...over,
  };
}

// ── clampSem / normalize ──────────────────────────────────────────────────────
describe("clampSem", () => {
  it("clamps into 1..10 and treats non-finite as 1", () => {
    expect(clampSem(0)).toBe(1);
    expect(clampSem(-3)).toBe(1);
    expect(clampSem(11)).toBe(10);
    expect(clampSem(4)).toBe(4);
    expect(clampSem(Number.NaN)).toBe(1);
  });
});

describe("normalizePlacementOrder", () => {
  it("renumbers gappy orders densely per semester, sorted by (sem, order)", () => {
    const out = normalizePlacementOrder([P("x", 2, 7), P("y", 1, 5), P("z", 1, 2)]);
    expect(out.map((p) => [p.id, p.sem, p.order])).toEqual([
      ["z", 1, 0],
      ["y", 1, 1],
      ["x", 2, 0],
    ]);
  });

  it("is STABLE: equal orders keep their input order", () => {
    const out = normalizePlacementOrder([P("first", 1, 0), P("second", 1, 0), P("third", 1, 0)]);
    expect(col(out, 1)).toEqual(["first", "second", "third"]);
    expectDense(out);
  });

  it("clamps out-of-range semesters", () => {
    const out = normalizePlacementOrder([P("hi", 14, 0), P("lo", 0, 0)]);
    expect(out.find((p) => p.id === "hi")!.sem).toBe(10);
    expect(out.find((p) => p.id === "lo")!.sem).toBe(1);
  });
});

// ── insert ────────────────────────────────────────────────────────────────────
describe("insertPlacement", () => {
  it("appends to the bottom of the column when index is omitted", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 1);
    expect(col(out, 1)).toEqual(["a", "b", "c", "n"]);
    expectDense(out);
  });

  it("inserts at the top (index 0) and shifts the rest down", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 2, 0);
    expect(col(out, 2)).toEqual(["n", "d", "e"]);
    expectDense(out);
  });

  it("inserts in the middle", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 1, 1);
    expect(col(out, 1)).toEqual(["a", "n", "b", "c"]);
  });

  it("an index past the end appends", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 1, 99);
    expect(col(out, 1)).toEqual(["a", "b", "c", "n"]);
  });

  it("inserts into an empty column at order 0", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 7);
    expect(out.find((p) => p.id === "n")).toEqual({ id: "n", courseId: "CS-2110", sem: 7, order: 0 });
  });

  it("clamps the target semester to 1..10", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "CS-2110" }, 42);
    expect(out.find((p) => p.id === "n")!.sem).toBe(10);
  });

  it("refuses (same reference) at the cap or for a duplicate id", () => {
    const full = Array.from({ length: MAX_PLACEMENTS }, (_, i) => P(`p${i}`, 1 + (i % 8), Math.floor(i / 8)));
    expect(insertPlacement(full, { id: "n", courseId: "X-1" }, 1)).toBe(full);
    const b = board();
    expect(insertPlacement(b, { id: "a", courseId: "X-1" }, 3)).toBe(b);
  });

  it("allows the same course twice (a retake) under different placement ids", () => {
    const out = insertPlacement(board(), { id: "n", courseId: "C-a" }, 3);
    expect(out.filter((p) => p.courseId === "C-a")).toHaveLength(2);
  });

  it("never mutates its input", () => {
    const b = board();
    const snapshot = JSON.stringify(b);
    insertPlacement(b, { id: "n", courseId: "X-1" }, 1, 0);
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

// ── move ──────────────────────────────────────────────────────────────────────
describe("movePlacementTo", () => {
  it("moves DOWN within the same column (index counted after removing the mover)", () => {
    // a out → [b, c]; index 1 → [b, a, c]
    const out = movePlacementTo(board(), "a", 1, 1);
    expect(col(out, 1)).toEqual(["b", "a", "c"]);
    expectDense(out);
  });

  it("moves to the bottom of the same column", () => {
    const out = movePlacementTo(board(), "a", 1, 2);
    expect(col(out, 1)).toEqual(["b", "c", "a"]);
  });

  it("moves UP within the same column", () => {
    const out = movePlacementTo(board(), "c", 1, 0);
    expect(col(out, 1)).toEqual(["c", "a", "b"]);
    expectDense(out);
  });

  it("moves across columns, closing the gap in the source", () => {
    const out = movePlacementTo(board(), "b", 2, 1);
    expect(col(out, 1)).toEqual(["a", "c"]);
    expect(col(out, 2)).toEqual(["d", "b", "e"]);
    expectDense(out);
    expect(out.find((p) => p.id === "b")!.sem).toBe(2);
  });

  it("an index past the end of the target column appends", () => {
    const out = movePlacementTo(board(), "a", 2, 50);
    expect(col(out, 2)).toEqual(["d", "e", "a"]);
  });

  it("moves into an empty column", () => {
    const out = movePlacementTo(board(), "e", 5, 0);
    expect(col(out, 5)).toEqual(["e"]);
    expect(col(out, 2)).toEqual(["d"]);
    expectDense(out);
  });

  it("returns the SAME reference for a no-op move or an unknown id", () => {
    const b = board();
    expect(movePlacementTo(b, "b", 1, 1)).toBe(b);
    expect(movePlacementTo(b, "nope", 3, 0)).toBe(b);
  });

  it("keeps the course and id of the mover", () => {
    const out = movePlacementTo(board(), "d", 1, 0);
    expect(out.find((p) => p.id === "d")).toEqual({ id: "d", courseId: "C-d", sem: 1, order: 0 });
  });

  it("the same card moved twice in a row commits both moves", () => {
    const once = movePlacementTo(board(), "a", 2, 0);
    const twice = movePlacementTo(once, "a", 3, 0);
    expect(col(twice, 3)).toEqual(["a"]);
    expect(col(twice, 2)).toEqual(["d", "e"]);
  });
});

// ── remove ────────────────────────────────────────────────────────────────────
describe("removePlacementById", () => {
  it("removes the card and renumbers its column densely", () => {
    const out = removePlacementById(board(), "b");
    expect(col(out, 1)).toEqual(["a", "c"]);
    expect(out.find((p) => p.id === "c")!.order).toBe(1);
    expectDense(out);
  });

  it("returns the same reference for an unknown id", () => {
    const b = board();
    expect(removePlacementById(b, "zzz")).toBe(b);
  });
});

// ── positions ─────────────────────────────────────────────────────────────────
describe("positionOf / positionBefore", () => {
  it("finds a card's column and index", () => {
    expect(positionOf(board(), "e")).toEqual({ sem: 2, index: 1 });
    expect(positionOf(board(), "nope")).toBeNull();
  });

  it("the drop position before a target excludes the mover (same column, from above)", () => {
    // Drag a onto c: without a, c is at index 1 → a lands between b and c.
    const pos = positionBefore(board(), "c", "a")!;
    expect(pos).toEqual({ sem: 1, index: 1 });
    expect(col(movePlacementTo(board(), "a", pos.sem, pos.index), 1)).toEqual(["b", "a", "c"]);
  });

  it("dropping a card on itself has no position", () => {
    expect(positionBefore(board(), "a", "a")).toBeNull();
  });
});

// ── sanitize ──────────────────────────────────────────────────────────────────
describe("sanitizePlacements", () => {
  it("drops malformed entries and duplicate ids, clamps, renumbers", () => {
    const out = sanitizePlacements([
      { id: "a", courseId: "CS-1110", sem: 1, order: 4 },
      { id: "a", courseId: "CS-2110", sem: 2, order: 0 }, // duplicate id
      { id: "b", sem: 1, order: 0 }, // no courseId
      "junk",
      null,
      { id: "c", courseId: "MATH-1910", sem: 99, order: 0 },
    ]);
    expect(out).toEqual([
      { id: "a", courseId: "CS-1110", sem: 1, order: 0 },
      { id: "c", courseId: "MATH-1910", sem: 10, order: 0 },
    ]);
  });

  it("non-arrays sanitize to []", () => {
    expect(sanitizePlacements(undefined)).toEqual([]);
    expect(sanitizePlacements({})).toEqual([]);
  });

  it("caps at MAX_PLACEMENTS", () => {
    const raw = Array.from({ length: MAX_PLACEMENTS + 5 }, (_, i) => ({
      id: `p${i}`,
      courseId: "X-1",
      sem: 1,
      order: i,
    }));
    expect(sanitizePlacements(raw)).toHaveLength(MAX_PLACEMENTS);
  });
});

// ── starting board (spec 014 §D6) ─────────────────────────────────────────────
describe("startingPlacements", () => {
  let n = 0;
  const ids = () => `id${n++}`;

  it("places ONLY fixed course-kind requirements, in their suggested semesters, by template order", () => {
    n = 0;
    const out = startingPlacements(
      [
        slot("s-2110", { suggested_semester: 3, slot_row: 1, courses: course("CS-2110") }),
        slot("s-fws", { kind: "attribute", suggested_semester: 1, slot_row: 0 }),
        slot("s-111x", { kind: "pattern", pattern: "CS-111x", suggested_semester: 1, slot_row: 1 }),
        slot("s-elec", { kind: "elective", suggested_semester: 5 }),
        slot("s-1910", { suggested_semester: 1, slot_row: 2, courses: course("MATH-1910") }),
        slot("s-2800", { suggested_semester: 3, slot_row: 0, courses: course("CS-2800") }),
      ],
      ids
    );
    expect(out.map((p) => [p.courseId, p.sem, p.order])).toEqual([
      ["MATH-1910", 1, 0],
      ["CS-2800", 3, 0],
      ["CS-2110", 3, 1],
    ]);
    expect(new Set(out.map((p) => p.id)).size).toBe(3);
  });

  it("skips a course-kind slot whose course can't be resolved (never invent a course)", () => {
    expect(startingPlacements([slot("s", { course_id: "CS-9999", courses: null })], ids)).toEqual([]);
  });

  it("clamps out-of-range suggested semesters", () => {
    const out = startingPlacements([slot("s", { suggested_semester: 12, courses: course("CS-4999") })], ids);
    expect(out[0].sem).toBe(10);
  });

  it("an empty template yields an empty board", () => {
    expect(startingPlacements([], ids)).toEqual([]);
  });
});
