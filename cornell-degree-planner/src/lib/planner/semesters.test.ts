import { describe, it, expect } from "vitest";
import { columnCredits, formatCredits } from "./semesters";
import { buildBoard } from "./board";
import { computeCardStatusMap } from "./computeCardStatusMap";
import type { Placement } from "@/types/plan";
import type { Course } from "@/types/db";

function course(id: string, min = 3, max = min): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number}`,
    credits_min: min,
    credits_max: max,
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

describe("columnCredits — the column header + footer credit total (B2)", () => {
  it("an empty column is 0", () => {
    expect(columnCredits([])).toEqual({ min: 0, max: 0 });
  });

  it("sums fixed-credit courses; formats as one number", () => {
    const cr = columnCredits([course("INFO-1200", 3), course("INFO-1300", 4), course("CS-1110", 4)]);
    expect(cr).toEqual({ min: 11, max: 11 });
    expect(formatCredits(cr)).toBe("11");
  });

  it("variable-credit courses widen the range; formats as min–max", () => {
    const cr = columnCredits([course("INFO-1200", 3), course("INFO-4999", 1, 4)]);
    expect(cr).toEqual({ min: 4, max: 7 });
    expect(formatCredits(cr)).toBe("4–7");
  });

  it("min matches the engine's semesterCredits for every column of the same board", () => {
    // The InfoSci shape from the sweep: a fixed course plus a variable one in
    // the first column, two fixed courses in the second.
    const placedCourses: Record<string, Course> = {
      "INFO-1200": course("INFO-1200", 4),
      "INFO-4999": course("INFO-4999", 1, 4),
      "INFO-2950": course("INFO-2950", 4),
      "MATH-1710": course("MATH-1710", 3),
    };
    const placements = [
      P("a", "INFO-1200", 1, 0),
      P("b", "INFO-4999", 1, 1),
      P("c", "INFO-2950", 2, 0),
      P("d", "MATH-1710", 2, 1),
    ];
    const { columns, cards } = buildBoard(placements, placedCourses);
    const { semesterCredits } = computeCardStatusMap(cards, [], placedCourses);
    for (const col of columns) {
      const cr = columnCredits(col.cards.map((c) => c.course));
      expect(cr.min).toBe(semesterCredits.get(col.sem) ?? 0);
    }
    expect(formatCredits(columnCredits(columns[0].cards.map((c) => c.course)))).toBe("5–8");
    expect(formatCredits(columnCredits(columns[1].cards.map((c) => c.course)))).toBe("7");
  });
});
