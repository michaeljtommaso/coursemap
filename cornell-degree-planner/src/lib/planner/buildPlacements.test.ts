import { describe, it, expect } from "vitest";
import { buildPlacements } from "./buildPlacements";
import type { Course, ProgramSlotWithData } from "@/types/db";

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

function courseSlot(
  id: string,
  sem: number,
  course: Course | null,
  opts: Partial<ProgramSlotWithData> = {}
): ProgramSlotWithData {
  return {
    id,
    program_id: "p",
    kind: "course",
    course_id: course?.id ?? null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: sem,
    slot_row: 0,
    category: null,
    courses: course,
    elective_groups: null,
    ...opts,
  };
}

function electiveSlot(id: string, sem: number): ProgramSlotWithData {
  return {
    id,
    program_id: "p",
    kind: "elective",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: "g",
    suggested_semester: sem,
    slot_row: 0,
    category: "elective",
    courses: null,
    elective_groups: null,
  };
}

describe("buildPlacements", () => {
  it("projects each engine slot (one per placement) to a PlacedCourse", () => {
    const cs2110 = makeCourse("CS-2110");
    const slots = [courseSlot("p-1", 2, cs2110)];
    expect(buildPlacements(slots)).toEqual([
      { placementId: "p-1", course: cs2110, semester: 2 },
    ]);
  });

  it("uses the slot's course as-is (the enriched course carries the real trees)", () => {
    const enriched = makeCourse("CS-3110", {
      prereq_expr: { type: "course", id: "CS-2110" },
    });
    const placements = buildPlacements([courseSlot("p-1", 4, enriched)]);
    expect(placements[0].course).toBe(enriched);
  });

  it("skips a slot without a course (defensive — useBoard never emits one)", () => {
    const slots = [electiveSlot("e1", 5), courseSlot("p-1", 1, null)];
    expect(buildPlacements(slots)).toEqual([]);
  });

  it("trusts the slot's semester — the column the card sits in", () => {
    const cs2110 = makeCourse("CS-2110");
    expect(buildPlacements([courseSlot("p-1", 4, cs2110)])).toEqual([
      { placementId: "p-1", course: cs2110, semester: 4 },
    ]);
  });

  it("emits distinct placements (distinct placement ids) for a course placed twice", () => {
    const cs2800 = makeCourse("CS-2800");
    const slots = [courseSlot("p-a", 3, cs2800), courseSlot("p-b", 6, cs2800)];
    expect(buildPlacements(slots)).toEqual([
      { placementId: "p-a", course: cs2800, semester: 3 },
      { placementId: "p-b", course: cs2800, semester: 6 },
    ]);
  });
});
