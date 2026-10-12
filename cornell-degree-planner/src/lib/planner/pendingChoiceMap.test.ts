import { describe, it, expect } from "vitest";
import { computePendingChoiceMap, openChoices } from "./pendingChoiceMap";
import { computeRequirementProgress } from "./requirementProgress";
import { computeCardStatusMap } from "./computeCardStatusMap";
import { buildBoard } from "./board";
import type { Course, ElectiveGroup, PrereqExpr, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";

function course(id: string, extra: Partial<Course> = {}): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number}`,
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
    ...extra,
  };
}

function slot(id: string, sem: number, over: Partial<ProgramSlotWithData>): ProgramSlotWithData {
  return {
    id,
    program_id: "p",
    kind: "course",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: sem,
    slot_row: 0,
    category: "core",
    attribute_match: null,
    courses: null,
    elective_groups: null,
    ...over,
  };
}

const pattern = (p: string): PrereqExpr => ({ type: "pattern", pattern: p });

/** A fresh CS-style board: CS 2110 (sem 3) and CS 2800 (sem 3) placed, both
 *  needing the CS 111x pick that waits in the checklist (sem 1). */
function freshBoard(introSem = 1) {
  const cs2110 = course("CS-2110", { prereq_expr: pattern("CS-111x") });
  const cs2800 = course("CS-2800", { prereq_expr: pattern("CS-111x") });
  const cs3110 = course("CS-3110", { prereq_expr: { type: "course", id: "MATH-1910" } });
  const g: ElectiveGroup = {
    id: "g-free",
    program_id: "p",
    name: "Free Elective",
    description: null,
    qualifying_rule: { type: "open" },
    min_credits: 3,
    advisor_approval: false,
    notes: null,
  };
  const templateSlots = [
    slot("s-intro", introSem, { kind: "pattern", pattern: "CS-111x", pattern_title: "Intro Programming (CS 1110/1112)" }),
    slot("s-2110", 3, { course_id: "CS-2110", courses: cs2110 }),
    slot("s-2800", 3, { course_id: "CS-2800", courses: cs2800 }),
    slot("s-3110", 5, { course_id: "CS-3110", courses: cs3110 }),
    slot("s-free", 1, { kind: "elective", elective_group_id: "g-free", elective_groups: g }),
  ];
  const placements: Placement[] = [
    { id: "pl-2110", courseId: "CS-2110", sem: 3, order: 0 },
    { id: "pl-2800", courseId: "CS-2800", sem: 3, order: 1 },
    { id: "pl-3110", courseId: "CS-3110", sem: 5, order: 0 },
  ];
  const placedCourses = { "CS-2110": cs2110, "CS-2800": cs2800, "CS-3110": cs3110 };
  return { templateSlots, placements, placedCourses };
}

function run(introSem = 1) {
  const { templateSlots, placements, placedCourses } = freshBoard(introSem);
  const progress = computeRequirementProgress({
    templateSlots,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
  });
  const { cards } = buildBoard(placements, placedCourses);
  const { statusMap } = computeCardStatusMap(cards, [], placedCourses);
  const choices = openChoices(progress);
  return {
    statusMap,
    choices,
    map: computePendingChoiceMap(cards, [], statusMap, choices),
  };
}

describe("openChoices", () => {
  it("lists open, checkable seat requirements only (no credit pools)", () => {
    const { choices } = run();
    expect(choices.map((c) => c.id)).toEqual(["s-intro"]);
    expect(choices[0]).toMatchObject({
      label: "Intro Programming (CS 1110/1112)",
      requirement: { kind: "pattern", pattern: "CS-111x" },
      suggestedSem: 1,
    });
  });
});

describe("computePendingChoiceMap", () => {
  it("cards waiting on the CS 111x pick are in the choice state; blocked stays as the engine says", () => {
    const { statusMap, map } = run();
    expect(statusMap["pl-2110"].blocked).toBe(true);
    expect(statusMap["pl-2800"].blocked).toBe(true);
    expect(map["pl-2110"]).toEqual({
      requirementId: "s-intro",
      label: "Intro Programming (CS 1110/1112)",
      leaves: ["CS 111x"],
    });
    expect(map["pl-2800"]?.requirementId).toBe("s-intro");
  });

  it("a card blocked on something no open choice supplies stays red (absent)", () => {
    const { statusMap, map } = run();
    expect(statusMap["pl-3110"].blocked).toBe(true);
    expect(map["pl-3110"]).toBeUndefined();
  });

  it("a choice suggested for the card's own semester or later doesn't count", () => {
    expect(run(3).map["pl-2110"]).toBeUndefined();
    expect(run(4).map["pl-2110"]).toBeUndefined();
  });
});

describe("list-rule groups as choices", () => {
  it('a "pick one of these" group is an open choice; a blocked card waiting on it is in the choice state', () => {
    const bee2510 = course("BEE-2510", {
      prereq_expr: { type: "or", children: [{ type: "course", id: "CHEM-2070" }, { type: "course", id: "CHEM-2090" }] },
    });
    const chem: ElectiveGroup = {
      id: "g-chem",
      program_id: "p",
      name: "Introductory Chemistry",
      description: null,
      qualifying_rule: { type: "list" },
      min_credits: 4,
      advisor_approval: false,
      notes: null,
      course_ids: ["CHEM-2090", "CHEM-2091", "CHEM-2070", "CHEM-2071"],
    };
    const templateSlots = [
      slot("s-chem", 1, { kind: "elective", elective_group_id: "g-chem", elective_groups: chem }),
      slot("s-2510", 3, { course_id: "BEE-2510", courses: bee2510 }),
    ];
    const placements: Placement[] = [{ id: "pl-2510", courseId: "BEE-2510", sem: 3, order: 0 }];
    const placedCourses = { "BEE-2510": bee2510 };
    const progress = computeRequirementProgress({
      templateSlots,
      placements,
      placedCourses,
      creditProfile: [],
      waivedRequirementIds: [],
    });
    const choices = openChoices(progress);
    expect(choices).toEqual([
      {
        id: "g-chem",
        label: "Introductory Chemistry",
        requirement: null,
        courseIds: ["CHEM-2090", "CHEM-2091", "CHEM-2070", "CHEM-2071"],
        suggestedSem: 1,
      },
    ]);
    const { cards } = buildBoard(placements, placedCourses);
    const { statusMap } = computeCardStatusMap(cards, [], placedCourses);
    expect(statusMap["pl-2510"].blocked).toBe(true);
    const map = computePendingChoiceMap(cards, [], statusMap, choices);
    expect(map["pl-2510"]).toMatchObject({ requirementId: "g-chem", label: "Introductory Chemistry" });
  });
});

describe("list-rule groups — a pick placed too late", () => {
  it("stays red: the group is not open once a member is on the board, even after the card", () => {
    const bee2510 = course("BEE-2510", {
      prereq_expr: { type: "or", children: [{ type: "course", id: "CHEM-2070" }, { type: "course", id: "CHEM-2090" }] },
    });
    const chem2090 = course("CHEM-2090");
    const chem: ElectiveGroup = {
      id: "g-chem",
      program_id: "p",
      name: "Introductory Chemistry",
      description: null,
      qualifying_rule: { type: "list" },
      min_credits: 4,
      advisor_approval: false,
      notes: null,
      course_ids: ["CHEM-2090", "CHEM-2070"],
    };
    const templateSlots = [
      slot("s-chem", 1, { kind: "elective", elective_group_id: "g-chem", elective_groups: chem }),
      slot("s-2510", 3, { course_id: "BEE-2510", courses: bee2510 }),
    ];
    const placements: Placement[] = [
      { id: "pl-2510", courseId: "BEE-2510", sem: 3, order: 0 },
      { id: "pl-2090", courseId: "CHEM-2090", sem: 4, order: 0 },
    ];
    const placedCourses = { "BEE-2510": bee2510, "CHEM-2090": chem2090 };
    const progress = computeRequirementProgress({
      templateSlots,
      placements,
      placedCourses,
      creditProfile: [],
      waivedRequirementIds: [],
    });
    const { cards } = buildBoard(placements, placedCourses);
    const { statusMap } = computeCardStatusMap(cards, [], placedCourses);
    expect(statusMap["pl-2510"].blocked).toBe(true);
    const map = computePendingChoiceMap(cards, [], statusMap, openChoices(progress));
    expect(map["pl-2510"]).toBeUndefined();
  });
});
