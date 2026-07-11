import { describe, it, expect } from "vitest";
import { buildMatchPool, programSlotsToMatchInput } from "./matchAdapters";
import { programToRequirements } from "./majorMatch";
import type { Course, ProgramSlotWithData, ElectiveGroup } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";

// ── Fixtures ──────────────────────────────────────────────────────────────────
function course(id: string, extra: Partial<Course> = {}): Course {
  const [subject, ...rest] = id.split("-");
  return {
    id,
    subject,
    number: rest.join("-"),
    title: `${subject} ${rest.join("-")}`,
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
    updated_at: new Date(0).toISOString(),
    ...extra,
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

function group(id: string, over: Partial<ElectiveGroup> = {}): ElectiveGroup {
  return {
    id,
    program_id: "p",
    name: `Group ${id}`,
    description: null,
    qualifying_rule: { type: "level", subject: "CS", min_number: 4000 },
    min_credits: 6,
    advisor_approval: false,
    notes: null,
    ...over,
  };
}

// ── buildMatchPool ────────────────────────────────────────────────────────────
describe("buildMatchPool", () => {
  it("adds placed picks with their enrichment fields riding along", () => {
    const cs2110 = course("CS-2110", {
      title: "Object-Oriented Data Structures",
      credits_min: 4,
      attrs: [{ value: "OTH-AS", descr: "d", group: "g" }],
    });
    const pool = buildMatchPool({
      slots: [slot("s1", { kind: "elective" })],
      slotSelections: { s1: "CS-2110" },
      selectedCourses: { "CS-2110": cs2110 },
      completedSlotIds: [],
      creditProfile: [],
    });
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({
      id: "CS-2110",
      subject: "CS",
      number: "2110",
      title: "Object-Oriented Data Structures",
      credits: 4,
      attrs: [{ value: "OTH-AS", descr: "d", group: "g" }],
    });
    expect(pool[0].isCredit).toBeUndefined();
  });

  it("counts a generically-completed template course slot's template course", () => {
    const pool = buildMatchPool({
      slots: [slot("s1", { kind: "course", courses: course("PHYS-1112") })],
      slotSelections: {},
      selectedCourses: {},
      completedSlotIds: ["s1"],
      creditProfile: [],
    });
    expect(pool.map((c) => c.id)).toEqual(["PHYS-1112"]);
  });

  it("does NOT count a completed NON-course generic slot (no course to grant)", () => {
    const pool = buildMatchPool({
      slots: [slot("s1", { kind: "pattern", pattern: "CS-111x" })],
      slotSelections: {},
      selectedCourses: {},
      completedSlotIds: ["s1"], // "I finished FWS" — but which course? unknown.
      creditProfile: [],
    });
    expect(pool).toHaveLength(0);
  });

  it("expands each credit entry's satisfiesCourseIds into isCredit courses", () => {
    const entries: CreditEntry[] = [
      { id: "ap-calc-bc", kind: "ap", label: "AP Calc BC", satisfiesCourseIds: ["MATH-1910", "MATH-1920"], credits: 4 },
    ];
    const pool = buildMatchPool({
      slots: [],
      slotSelections: {},
      selectedCourses: {},
      completedSlotIds: [],
      creditProfile: entries,
    });
    expect(pool).toHaveLength(2);
    expect(pool[0]).toMatchObject({ id: "MATH-1910", subject: "MATH", number: "1910", credits: 4, isCredit: true });
    expect(pool[1]).toMatchObject({ id: "MATH-1920", subject: "MATH", number: "1920", credits: 4, isCredit: true });
  });

  it("defaults a credit entry with no `credits` figure to 3", () => {
    const entries: CreditEntry[] = [
      { id: "ap-x", kind: "ap", label: "AP X", satisfiesCourseIds: ["CHEM-2070"] },
    ];
    const pool = buildMatchPool({
      slots: [],
      slotSelections: {},
      selectedCourses: {},
      completedSlotIds: [],
      creditProfile: entries,
    });
    expect(pool[0].credits).toBe(3);
  });

  it("dedupes by raw id: a real placement wins over a same-id synthetic credit", () => {
    const cs1110 = course("CS-1110", { credits_min: 4 });
    const pool = buildMatchPool({
      slots: [slot("s1", { kind: "elective" })],
      slotSelections: { s1: "CS-1110" },
      selectedCourses: { "CS-1110": cs1110 },
      completedSlotIds: [],
      creditProfile: [{ id: "ap", kind: "ap", label: "AP", satisfiesCourseIds: ["CS-1110"], credits: 3 }],
    });
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ id: "CS-1110", credits: 4 });
    expect(pool[0].isCredit).toBeUndefined(); // the placement, not the credit
  });

  it("falls back to id-derived subject/number and default credits when the course object is missing", () => {
    const pool = buildMatchPool({
      slots: [slot("s1", { kind: "elective" })],
      slotSelections: { s1: "ORIE-3300" },
      selectedCourses: {}, // no full course cached yet
      completedSlotIds: [],
      creditProfile: [],
    });
    expect(pool[0]).toMatchObject({ id: "ORIE-3300", subject: "ORIE", number: "3300", credits: 3 });
  });
});

// ── programSlotsToMatchInput ──────────────────────────────────────────────────
describe("programSlotsToMatchInput", () => {
  it("maps course / pattern / attribute slots through to MatchSlots", () => {
    const attributeMatch = { anyOf: [{ field: "title" as const, op: "startsWith" as const, value: "FWS:" }] };
    const { slots } = programSlotsToMatchInput([
      slot("c1", { kind: "course", course_id: "CS-2110", courses: course("CS-2110", { credits_min: 4 }) }),
      slot("p1", { kind: "pattern", pattern: "CS-4xxx", pattern_title: "4000-level CS" }),
      slot("a1", { kind: "attribute", pattern_title: "First-Year Writing Seminar", attribute_match: attributeMatch }),
      slot("e1", { kind: "elective", elective_group_id: "g1", elective_groups: group("g1") }),
    ]);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toMatchObject({ id: "c1", kind: "course", course_id: "CS-2110" });
    expect(slots[0].courses).toMatchObject({ id: "CS-2110", subject: "CS", number: "2110", credits_min: 4 });
    expect(slots[1]).toMatchObject({ id: "p1", kind: "pattern", pattern: "CS-4xxx", pattern_title: "4000-level CS" });
    expect(slots[2]).toMatchObject({ id: "a1", kind: "attribute", attribute_match: attributeMatch });
  });

  it("collapses multiple slots sharing an elective group into ONE pool", () => {
    const { electiveGroups } = programSlotsToMatchInput([
      slot("e1", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 9, name: "Technical Electives" }) }),
      slot("e2", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 9, name: "Technical Electives" }) }),
      slot("e3", { kind: "elective", elective_group_id: "adv", elective_groups: group("adv", { min_credits: 6, name: "Advisor-approved" }) }),
    ]);
    expect(electiveGroups).toHaveLength(2);
    expect(electiveGroups.find((g) => g.id === "tech")).toMatchObject({ min_credits: 9, name: "Technical Electives" });
    expect(electiveGroups.find((g) => g.id === "adv")).toMatchObject({ min_credits: 6 });
  });

  it("maps a 0-credit course snapshot to undefined so the seat gets the module default", () => {
    const { slots } = programSlotsToMatchInput([
      slot("c1", { kind: "course", course_id: "CS-1110", courses: course("CS-1110", { credits_min: 0 }) }),
    ]);
    expect(slots[0].courses?.credits_min).toBeUndefined();
    // Round-trip through programToRequirements: the seat lands on DEFAULT (3).
    const reqs = programToRequirements({ slots, electiveGroups: [] });
    expect(reqs[0]).toMatchObject({ kind: "seat", credits: 3 });
  });

  it("round-trips into programToRequirements: seats + one pool per group, in the denominator", () => {
    const input = programSlotsToMatchInput([
      slot("c1", { kind: "course", course_id: "CS-2110", courses: course("CS-2110", { credits_min: 4 }) }),
      slot("e1", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 9 }) }),
      slot("e2", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 9 }) }),
    ]);
    const reqs = programToRequirements(input);
    const seats = reqs.filter((r) => r.kind === "seat");
    const pools = reqs.filter((r) => r.kind === "pool");
    expect(seats).toHaveLength(1);
    expect(pools).toHaveLength(1);
    expect(seats[0]).toMatchObject({ credits: 4 });
    expect(pools[0]).toMatchObject({ minCredits: 9 });
  });
});
