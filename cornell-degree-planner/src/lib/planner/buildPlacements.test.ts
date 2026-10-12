import { describe, it, expect } from "vitest";
import { buildPlacements } from "./buildPlacements";
import type { BoardCard } from "./board";
import type { Course } from "@/types/db";

function makeCourse(id: string, opts: Partial<Course> = {}): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject: subject ?? "",
    number: number ?? "",
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
    updated_at: new Date(0).toISOString(),
    ...opts,
  };
}

/** A board card: placement `id` in column `sem`, holding `course`. */
function card(id: string, sem: number, course: Course, order = 0): BoardCard {
  return { placement: { id, courseId: course.id, sem, order }, course };
}

describe("buildPlacements", () => {
  it("projects each card (one per placement) to a PlacedCourse", () => {
    const cs2110 = makeCourse("CS-2110");
    const cards = [card("p-1", 2, cs2110)];
    expect(buildPlacements(cards)).toEqual([
      { placementId: "p-1", course: cs2110, semester: 2 },
    ]);
  });

  it("uses the card's course as-is (the enriched course carries the real trees)", () => {
    const enriched = makeCourse("CS-3110", {
      prereq_expr: { type: "course", id: "CS-2110" },
    });
    const placements = buildPlacements([card("p-1", 4, enriched)]);
    expect(placements[0].course).toBe(enriched);
  });

  it("an empty board yields no placements", () => {
    expect(buildPlacements([])).toEqual([]);
  });

  it("trusts the placement's semester — the column the card sits in", () => {
    const cs2110 = makeCourse("CS-2110");
    expect(buildPlacements([card("p-1", 4, cs2110)])).toEqual([
      { placementId: "p-1", course: cs2110, semester: 4 },
    ]);
  });

  it("emits distinct placements (distinct placement ids) for a course placed twice", () => {
    const cs2800 = makeCourse("CS-2800");
    const cards = [card("p-a", 3, cs2800), card("p-b", 6, cs2800)];
    expect(buildPlacements(cards)).toEqual([
      { placementId: "p-a", course: cs2800, semester: 3 },
      { placementId: "p-b", course: cs2800, semester: 6 },
    ]);
  });
});
