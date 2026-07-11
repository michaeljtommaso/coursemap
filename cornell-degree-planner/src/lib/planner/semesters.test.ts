import { describe, it, expect } from "vitest";
import { slotSearchSeed } from "./semesters";
import type { ProgramSlotWithData } from "@/types/db";

function slot(over: Partial<ProgramSlotWithData>): ProgramSlotWithData {
  return {
    id: "s",
    program_id: "p",
    kind: "pattern",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: 1,
    slot_row: 0,
    category: null,
    courses: null,
    elective_groups: null,
    ...over,
  };
}

describe("slotSearchSeed", () => {
  it("pattern slots seed subject+level (wildcards stripped)", () => {
    expect(slotSearchSeed(slot({ kind: "pattern", pattern: "CS-111x" }))).toBe("CS 111");
    expect(slotSearchSeed(slot({ kind: "pattern", pattern: "ENGRI-1xxx" }))).toBe("ENGRI 1");
  });

  it("level-rule electives seed the subject; other electives seed ''", () => {
    expect(
      slotSearchSeed(
        slot({
          kind: "elective",
          elective_groups: {
            id: "g", program_id: "p", name: "G", description: null,
            qualifying_rule: { type: "level", subject: "CS", min_number: 3000 },
            min_credits: 3, advisor_approval: false, notes: null,
          },
        })
      )
    ).toBe("CS");
    expect(
      slotSearchSeed(
        slot({
          kind: "elective",
          elective_groups: {
            id: "g", program_id: "p", name: "G", description: null,
            qualifying_rule: { type: "open" },
            min_credits: 3, advisor_approval: false, notes: null,
          },
        })
      )
    ).toBe("");
  });

  it("attribute slots emit NO text query (spec 010 §2) — the filter carries the match", () => {
    expect(
      slotSearchSeed(
        slot({
          kind: "attribute",
          pattern_title: "First-Year Writing Seminar",
          attribute_match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
        })
      )
    ).toBe("");
  });
});
