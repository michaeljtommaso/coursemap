import { describe, it, expect } from "vitest";
import {
  slotRequirement,
  placedCourseSatisfiesSlot,
  slotSuggestionLabel,
} from "./slotSuggestion";
import type { ProgramSlotWithData, Course, AttributeMatch } from "@/types/db";

// Minimal course factory — only the fields the honesty check reads.
function course(partial: Partial<Course> & { id: string; subject: string; number: string }): Course {
  return {
    title: `${partial.subject} ${partial.number}`,
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
    ...partial,
  };
}

// Minimal slot factory.
function slot(partial: Partial<ProgramSlotWithData> & { kind: ProgramSlotWithData["kind"] }): ProgramSlotWithData {
  return {
    id: "slot-1",
    program_id: "cs",
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
    ...partial,
  };
}

const CS2110 = course({ id: "CS-2110", subject: "CS", number: "2110", title: "OOP & Data Structures" });
const FWS = course({ id: "ENGL-1134", subject: "ENGL", number: "1134", title: "FWS: True Stories" });

describe("slotRequirement", () => {
  it("maps course/pattern/attribute slots to a Requirement", () => {
    expect(slotRequirement(slot({ kind: "course", course_id: "CS-2110" }))).toEqual({
      kind: "course",
      courseId: "CS-2110",
    });
    expect(slotRequirement(slot({ kind: "pattern", pattern: "CS-4xxx" }))).toEqual({
      kind: "pattern",
      pattern: "CS-4xxx",
    });
    const match: AttributeMatch = { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] };
    expect(slotRequirement(slot({ kind: "attribute", attribute_match: match }))).toEqual({
      kind: "attribute",
      match,
    });
  });
  it("returns null for elective and custom slots", () => {
    expect(slotRequirement(slot({ kind: "elective" }))).toBeNull();
  });
});

describe("placedCourseSatisfiesSlot — the honesty predicate", () => {
  it("a CS course does NOT satisfy an FWS attribute slot (unmet → hint shows)", () => {
    const fwsSlot = slot({
      kind: "attribute",
      pattern_title: "First-Year Writing Seminar",
      attribute_match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
    });
    expect(placedCourseSatisfiesSlot(fwsSlot, CS2110)).toBe(false);
  });
  it("an FWS-titled course DOES satisfy the FWS attribute slot (no hint)", () => {
    const fwsSlot = slot({
      kind: "attribute",
      attribute_match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
    });
    expect(placedCourseSatisfiesSlot(fwsSlot, FWS)).toBe(true);
  });
  it("a matching course satisfies a pattern slot; a non-matching one doesn't", () => {
    const patSlot = slot({ kind: "pattern", pattern: "CS-2xxx" });
    expect(placedCourseSatisfiesSlot(patSlot, CS2110)).toBe(true);
    expect(placedCourseSatisfiesSlot(patSlot, course({ id: "CS-4820", subject: "CS", number: "4820" }))).toBe(false);
  });
  it("a fixed-course slot is satisfied only by that course (replacement reads unmet)", () => {
    const courseSlot = slot({ kind: "course", course_id: "CS-2110" });
    expect(placedCourseSatisfiesSlot(courseSlot, CS2110)).toBe(true);
    expect(placedCourseSatisfiesSlot(courseSlot, course({ id: "CS-3110", subject: "CS", number: "3110" }))).toBe(false);
  });
  it("elective slots: open accepts anything; level enforces the floor", () => {
    const open = slot({
      kind: "elective",
      elective_groups: { id: "g", program_id: "cs", name: "Free elective", description: null, qualifying_rule: { type: "open" }, min_credits: 3, advisor_approval: false, notes: null },
    });
    expect(placedCourseSatisfiesSlot(open, CS2110)).toBe(true);
    const lvl = slot({
      kind: "elective",
      elective_groups: { id: "g", program_id: "cs", name: "CS 3000+ elective", description: null, qualifying_rule: { type: "level", subject: "CS", min_number: 3000 }, min_credits: 3, advisor_approval: false, notes: null },
    });
    expect(placedCourseSatisfiesSlot(lvl, CS2110)).toBe(false); // 2110 < 3000 → hint
    expect(placedCourseSatisfiesSlot(lvl, course({ id: "CS-4820", subject: "CS", number: "4820" }))).toBe(true);
  });
  it("non-computable list/category electives accept (no false mismatch)", () => {
    const listGroup = slot({
      kind: "elective",
      elective_groups: { id: "g", program_id: "cs", name: "Curated list", description: null, qualifying_rule: { type: "list" }, min_credits: 3, advisor_approval: false, notes: null },
    });
    expect(placedCourseSatisfiesSlot(listGroup, CS2110)).toBe(true);
  });
  it("a user-added custom (_plan) slot suggests nothing → always satisfied", () => {
    const custom = slot({
      kind: "elective",
      program_id: "_plan",
      elective_groups: { id: "_custom", program_id: null, name: "Any course", description: null, qualifying_rule: { type: "open" }, min_credits: 3, advisor_approval: false, notes: null },
    });
    expect(placedCourseSatisfiesSlot(custom, CS2110)).toBe(true);
  });
  it("honors an alias canonicalizer for course-kind slots", () => {
    const courseSlot = slot({ kind: "course", course_id: "CS-2110" });
    const engrd = course({ id: "ENGRD-2110", subject: "ENGRD", number: "2110" });
    expect(placedCourseSatisfiesSlot(courseSlot, engrd)).toBe(false);
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    expect(placedCourseSatisfiesSlot(courseSlot, engrd, canonical)).toBe(true);
  });
});

describe("slotSuggestionLabel", () => {
  it("labels each requirement kind", () => {
    expect(slotSuggestionLabel(slot({ kind: "pattern", pattern: "CS-4xxx", pattern_title: "CS Elective" }))).toBe("CS Elective");
    expect(slotSuggestionLabel(slot({ kind: "attribute", pattern_title: "First-Year Writing Seminar" }))).toBe("First-Year Writing Seminar");
    expect(
      slotSuggestionLabel(
        slot({ kind: "course", courses: CS2110 })
      )
    ).toBe("CS 2110");
    expect(
      slotSuggestionLabel(
        slot({
          kind: "elective",
          elective_groups: { id: "g", program_id: "cs", name: "Technical elective", description: null, qualifying_rule: { type: "open" }, min_credits: 3, advisor_approval: false, notes: null },
        })
      )
    ).toBe("Technical elective");
  });
  it("returns null for a user-added custom (_plan) slot", () => {
    expect(
      slotSuggestionLabel(
        slot({
          kind: "elective",
          program_id: "_plan",
          elective_groups: { id: "_custom", program_id: null, name: "Any course", description: null, qualifying_rule: { type: "open" }, min_credits: 3, advisor_approval: false, notes: null },
        })
      )
    ).toBeNull();
  });
});
