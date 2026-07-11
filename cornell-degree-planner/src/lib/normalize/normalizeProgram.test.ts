import { describe, it, expect } from "vitest";
import { normalizeProgramSlots } from "./normalizeProgram";
import type { ProgramDoc } from "@/lib/schemas";

/** Minimal ProgramDoc carrying just the slots under test (spec 010 §2, Unit 10B
 *  — attribute slot bridging). Cast loosely; normalizeProgramSlots only reads the
 *  fields exercised here. */
function docWithSlots(slots: unknown[]): ProgramDoc {
  return {
    id: "cornell-x-bs-2026",
    name: "X",
    shortName: "X",
    college: "Engineering",
    catalogYear: 2026,
    electiveGroups: [],
    slots,
    edges: [],
  } as unknown as ProgramDoc;
}

describe("normalizeProgramSlots — attribute slots (spec 010 §2)", () => {
  it("bridges a valid attributeMatch to a typed attribute_match", () => {
    const [slot] = normalizeProgramSlots(
      docWithSlots([
        {
          id: "x-s1-fwis",
          kind: "attribute",
          courseId: null,
          pattern: null,
          patternTitle: "First-Year Writing Seminar",
          attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
          electiveGroupId: null,
          suggestedSemester: 1,
          slotRow: 4,
        },
      ])
    );
    expect(slot.kind).toBe("attribute");
    expect(slot.pattern_title).toBe("First-Year Writing Seminar");
    expect(slot.attribute_match).toEqual({
      anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }],
    });
    // Attribute slots carry no course snapshot.
    expect(slot.courses).toBeNull();
  });

  it("normalizes a malformed attributeMatch to null (unmatchable, never a crash)", () => {
    const [slot] = normalizeProgramSlots(
      docWithSlots([
        {
          id: "x-s2-bad",
          kind: "attribute",
          courseId: null,
          pattern: null,
          patternTitle: "Broken Requirement",
          attributeMatch: { anyOf: [{ nope: true }] },
          electiveGroupId: null,
          suggestedSemester: 2,
          slotRow: 0,
        },
      ])
    );
    expect(slot.kind).toBe("attribute");
    expect(slot.attribute_match).toBeNull();
  });

  it("leaves non-attribute slots with a null attribute_match", () => {
    const [slot] = normalizeProgramSlots(
      docWithSlots([
        {
          id: "x-s1-cs",
          kind: "course",
          courseId: "CS-2110",
          pattern: null,
          patternTitle: null,
          electiveGroupId: null,
          suggestedSemester: 1,
          slotRow: 0,
          courseTitle: "OOP",
          creditsMin: 4,
          creditsMax: 4,
        },
      ])
    );
    expect(slot.kind).toBe("course");
    expect(slot.attribute_match).toBeNull();
  });
});
