import { describe, it, expect } from "vitest";
import { buildBoard, placementToEngineSlot, courseForPlacement } from "./board";
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

describe("buildBoard — the board adapter (spec 014)", () => {
  it("always renders semesters 1–8, even empty", () => {
    const { columns, engineSlots } = buildBoard([], {});
    expect(columns.map((c) => c.sem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(columns.every((c) => c.cards.length === 0)).toBe(true);
    expect(engineSlots).toEqual([]);
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

  it("synthesizes one course-kind engine slot per placement, in board order", () => {
    const courses = { "CS-2110": course("CS-2110"), "MATH-1910": course("MATH-1910") };
    const { engineSlots } = buildBoard(
      [P("late", "CS-2110", 3, 0), P("early", "MATH-1910", 1, 0)],
      courses
    );
    expect(engineSlots.map((s) => s.id)).toEqual(["early", "late"]);
    expect(engineSlots[1]).toMatchObject({
      id: "late",
      kind: "course",
      course_id: "CS-2110",
      suggested_semester: 3,
      slot_row: 0,
      courses: courses["CS-2110"],
      elective_groups: null,
      pattern: null,
    });
  });

  it("a placement whose course snapshot is missing still renders (code derived from the id)", () => {
    const c = courseForPlacement(P("x", "ORIE-3300", 5, 0), {});
    expect(c).toMatchObject({ id: "ORIE-3300", subject: "ORIE", number: "3300" });
  });

  it("the same course placed twice yields two engine slots (distinct placement ids)", () => {
    const courses = { "CS-2110": course("CS-2110") };
    const { engineSlots } = buildBoard([P("a", "CS-2110", 3, 0), P("b", "CS-2110", 4, 0)], courses);
    expect(engineSlots.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("placementToEngineSlot derives the category from the course subject", () => {
    expect(placementToEngineSlot(P("m", "MATH-1910", 1, 0), course("MATH-1910")).category).toBe("math");
  });
});
