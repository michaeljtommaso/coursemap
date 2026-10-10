import { describe, it, expect } from "vitest";
import { computePendingChoiceMap, openChoices } from "./pendingChoiceMap";
import { computeRequirementProgress } from "./requirementProgress";
import { computeSlotStatusMap } from "./computeSlotStatusMap";
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
  const { engineSlots } = buildBoard(placements, placedCourses);
  const { statusMap } = computeSlotStatusMap(engineSlots, [], {}, placedCourses);
  const choices = openChoices(progress);
  return {
    statusMap,
    choices,
    map: computePendingChoiceMap(engineSlots, [], {}, placedCourses, statusMap, choices),
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
