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
  it("emits a placement for a course-kind template slot from its snapshot", () => {
    const cs2110 = makeCourse("CS-2110");
    const slots = [courseSlot("s1", 2, cs2110)];
    expect(buildPlacements(slots, {}, {})).toEqual([
      { slotId: "s1", course: cs2110, semester: 2 },
    ]);
  });

  it("a user selection wins over the template snapshot", () => {
    const template = makeCourse("CS-2110");
    const picked = makeCourse("CS-3110");
    const slots = [courseSlot("s1", 2, template)];
    const placements = buildPlacements(slots, { s1: "CS-3110" }, { "CS-3110": picked });
    expect(placements).toEqual([{ slotId: "s1", course: picked, semester: 2 }]);
  });

  it("fills an empty elective slot from its selection", () => {
    const picked = makeCourse("CS-4780");
    const slots = [electiveSlot("e1", 5)];
    const placements = buildPlacements(slots, { e1: "CS-4780" }, { "CS-4780": picked });
    expect(placements).toEqual([{ slotId: "e1", course: picked, semester: 5 }]);
  });

  it("skips empty pattern/elective slots (no course → no wire)", () => {
    const slots = [electiveSlot("e1", 5), courseSlot("s1", 1, null)];
    expect(buildPlacements(slots, {}, {})).toEqual([]);
  });

  it("respects the EFFECTIVE semester (override remapped onto suggested_semester)", () => {
    // The board adapter (useBoard) puts the card's column on suggested_semester;
    // buildPlacements simply trusts the slot's semester.
    const cs2110 = makeCourse("CS-2110");
    const moved = courseSlot("s1", 4, cs2110); // template sem was 2, override → 4
    expect(buildPlacements([moved], {}, {})).toEqual([
      { slotId: "s1", course: cs2110, semester: 4 },
    ]);
  });

  it("emits distinct placements (distinct slotIds) for a course placed twice", () => {
    const picked = makeCourse("CS-2800");
    const slots = [electiveSlot("e1", 3), electiveSlot("e2", 6)];
    const placements = buildPlacements(
      slots,
      { e1: "CS-2800", e2: "CS-2800" },
      { "CS-2800": picked }
    );
    expect(placements).toEqual([
      { slotId: "e1", course: picked, semester: 3 },
      { slotId: "e2", course: picked, semester: 6 },
    ]);
  });

  it("ignores a selection whose course is not (yet) in pickedCourses", () => {
    const slots = [electiveSlot("e1", 5)];
    expect(buildPlacements(slots, { e1: "CS-4780" }, {})).toEqual([]);
  });
});
