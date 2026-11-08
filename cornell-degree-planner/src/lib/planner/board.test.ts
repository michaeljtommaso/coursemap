import { describe, it, expect } from "vitest";
import { buildBoard, courseForPlacement } from "./board";
import type { Placement } from "@/types/plan";
import type { Course } from "@/types/db";

function course(id: string, credits = 3): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number} title`,
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
    updated_at: "",
  };
}

const P = (id: string, courseId: string, sem: number, order: number): Placement => ({
  id,
  courseId,
  sem,
  order,
});

describe("buildBoard (spec 014)", () => {
  it("always renders semesters 1–8, even empty", () => {
    const { columns, cards } = buildBoard([], {});
    expect(columns.map((c) => c.sem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(columns.every((c) => c.cards.length === 0)).toBe(true);
    expect(cards).toEqual([]);
  });

  it("adds semesters 9–10 only when they hold a card", () => {
    const { columns } = buildBoard([P("a", "CS-4999", 10, 0)], { "CS-4999": course("CS-4999") });
    expect(columns.map((c) => c.sem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
  });

  it("sorts each column's cards by order and pairs each with its course", () => {
    const courses = { "CS-2110": course("CS-2110"), "MATH-1910": course("MATH-1910", 4) };
    const { columns } = buildBoard(
      [P("b", "CS-2110", 1, 1), P("a", "MATH-1910", 1, 0)],
      courses
    );
    const sem1 = columns.find((c) => c.sem === 1)!;
    expect(sem1.cards.map((c) => c.placement.id)).toEqual(["a", "b"]);
    expect(sem1.cards[0].course).toBe(courses["MATH-1910"]);
  });

  it("flattens one card per placement, in board order", () => {
    const courses = { "CS-2110": course("CS-2110"), "MATH-1910": course("MATH-1910") };
    const { cards } = buildBoard(
      [P("late", "CS-2110", 3, 0), P("early", "MATH-1910", 1, 0)],
      courses
    );
    expect(cards.map((c) => c.placement.id)).toEqual(["early", "late"]);
    expect(cards[1]).toEqual({
      placement: P("late", "CS-2110", 3, 0),
      course: courses["CS-2110"],
    });
  });

  it("a placement whose course snapshot is missing still renders (code derived from the id)", () => {
    const c = courseForPlacement(P("x", "ORIE-3300", 5, 0), {});
    expect(c).toMatchObject({ id: "ORIE-3300", subject: "ORIE", number: "3300" });
  });

  it("the same course placed twice yields two cards (distinct placement ids)", () => {
    const courses = { "CS-2110": course("CS-2110") };
    const { cards } = buildBoard([P("a", "CS-2110", 3, 0), P("b", "CS-2110", 4, 0)], courses);
    expect(cards.map((c) => c.placement.id)).toEqual(["a", "b"]);
  });

  it("the flat list holds the same card objects as the columns", () => {
    const courses = { "CS-2110": course("CS-2110") };
    const { columns, cards } = buildBoard([P("a", "CS-2110", 3, 0)], courses);
    expect(cards[0]).toBe(columns.find((c) => c.sem === 3)!.cards[0]);
  });
});

describe("buildBoard short-term columns (spec 042)", () => {
  const S = (id: string, courseId: string, sem: number, order: number): Placement => ({
    id,
    courseId,
    sem,
    order,
    shortTerm: true,
  });
  const shape = (cols: { sem: number; shortTerm: boolean }[]) =>
    cols.map((c) => (c.shortTerm ? `S${c.sem}` : `${c.sem}`));

  it("no short terms: exactly the old columns, each marked regular with key 2k", () => {
    const { columns } = buildBoard([], {});
    expect(shape(columns)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(columns.every((c) => c.shortTerm === false && c.key === 2 * c.sem)).toBe(true);
  });

  it("an added short term renders even when empty, before its semester", () => {
    const { columns } = buildBoard([], {}, [1, 2]);
    expect(shape(columns)).toEqual(["S1", "1", "S2", "2", "3", "4", "5", "6", "7", "8"]);
    expect(columns[0]).toMatchObject({ sem: 1, shortTerm: true, key: 1, cards: [] });
    expect(columns[2]).toMatchObject({ sem: 2, shortTerm: true, key: 3 });
  });

  it("a short-term placement adds its column even when not listed in shortTerms", () => {
    const courses = { "CS-1110": course("CS-1110") };
    const { columns } = buildBoard([S("s", "CS-1110", 5, 0)], courses);
    expect(shape(columns)).toEqual(["1", "2", "3", "4", "S5", "5", "6", "7", "8"]);
    expect(columns[4].cards.map((c) => c.placement.id)).toEqual(["s"]);
    // The regular semester 5 does not hold the short-term card.
    expect(columns[5].cards).toEqual([]);
  });

  it("dedupes and ignores invalid shortTerms entries", () => {
    const { columns } = buildBoard([], {}, [3, 3, 0, 11, 2.5, -1, NaN]);
    expect(shape(columns)).toEqual(["1", "2", "S3", "3", "4", "5", "6", "7", "8"]);
  });

  it("a short term before semester 9 or 10 renders without the regular 9/10 column", () => {
    const { columns } = buildBoard([], {}, [10]);
    expect(shape(columns)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "S10"]);
  });

  it("flattens cards in time order across short and regular columns", () => {
    const courses = {
      "A-1": course("A-1"),
      "B-1": course("B-1"),
      "C-1": course("C-1"),
      "D-1": course("D-1"),
    };
    const { cards } = buildBoard(
      [P("sem2", "D-1", 2, 0), S("win2", "C-1", 2, 0), P("sem1", "B-1", 1, 0), S("sum1", "A-1", 1, 0)],
      courses
    );
    expect(cards.map((c) => c.placement.id)).toEqual(["sum1", "sem1", "win2", "sem2"]);
  });
});
