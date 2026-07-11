import { describe, it, expect } from "vitest";
import {
  remapPlacements,
  type RemapPlacement,
  type RemapTargetSlot,
  type RemapCourse,
} from "./remapPlacements";

function c(id: string, title?: string, attrs?: { value: string }[]): RemapCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, attrs };
}

function placement(slotId: string, course: RemapCourse, semester = 1, mark: RemapPlacement["mark"] = null): RemapPlacement {
  return { slotId, course, semester, mark };
}

describe("remapPlacements", () => {
  it("exact course match — moves into the same fixed-course slot", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-calc", kind: "course", courseId: "MATH-1910" }];
    const res = remapPlacements([placement("cs-calc", c("MATH-1910"))], targets);
    expect(res.moves).toEqual([{ fromSlotId: "cs-calc", toSlotId: "orie-calc", courseId: "MATH-1910" }]);
    expect(res.customCreations).toEqual([]);
    expect(res.matchedCount).toBe(1);
    expect(res.keptCount).toBe(1);
  });

  it("pattern match — moves into a pattern slot the course satisfies", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-tech", kind: "pattern", pattern: "CS-4xxx" }];
    const res = remapPlacements([placement("cs-x", c("CS-4820"))], targets);
    expect(res.moves).toEqual([{ fromSlotId: "cs-x", toSlotId: "orie-tech", courseId: "CS-4820" }]);
    expect(res.matchedCount).toBe(1);
  });

  it("attribute match — moves into an attribute slot the course satisfies", () => {
    const targets: RemapTargetSlot[] = [
      { id: "orie-fws", kind: "attribute", attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } },
    ];
    const res = remapPlacements([placement("cs-fws", c("ENGL-1134", "FWS: True Stories"))], targets);
    expect(res.moves).toEqual([{ fromSlotId: "cs-fws", toSlotId: "orie-fws", courseId: "ENGL-1134" }]);
  });

  it("elective match — computable qualifying rule accepts", () => {
    const targets: RemapTargetSlot[] = [
      { id: "orie-elec", kind: "elective", qualifyingRule: { type: "level", subject: "CS", min_number: 3000 } },
    ];
    const res = remapPlacements([placement("cs-e", c("CS-4820"))], targets);
    expect(res.moves).toEqual([{ fromSlotId: "cs-e", toSlotId: "orie-elec", courseId: "CS-4820" }]);
  });

  it("no match → a custom slot in the SAME semester (deterministic id)", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-calc", kind: "course", courseId: "MATH-1910" }];
    const res = remapPlacements([placement("cs-weird", c("MUSIC-1201"), 5)], targets);
    expect(res.moves).toEqual([]);
    expect(res.customCreations).toEqual([{ slotId: "cus-remap-cs-weird", sem: 5, courseId: "MUSIC-1201" }]);
    expect(res.matchedCount).toBe(0);
    expect(res.keptCount).toBe(1);
  });

  it("occupied target → the course lands in a custom slot instead", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-tech", kind: "pattern", pattern: "CS-4xxx" }];
    // The one CS-4xxx slot is already taken by a placement that stayed valid.
    const res = remapPlacements([placement("cs-x", c("CS-4820"), 6)], targets, ["orie-tech"]);
    expect(res.moves).toEqual([]);
    expect(res.customCreations).toEqual([{ slotId: "cus-remap-cs-x", sem: 6, courseId: "CS-4820" }]);
  });

  it("two courses competing for one slot — first keeps it, second gets a custom slot", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-tech", kind: "pattern", pattern: "CS-4xxx" }];
    const res = remapPlacements(
      [placement("a", c("CS-4820"), 7), placement("b", c("CS-4700"), 7)],
      targets
    );
    expect(res.moves).toEqual([{ fromSlotId: "a", toSlotId: "orie-tech", courseId: "CS-4820" }]);
    expect(res.customCreations).toEqual([{ slotId: "cus-remap-b", sem: 7, courseId: "CS-4700" }]);
  });

  it("priority: exact course beats pattern for the same course", () => {
    const targets: RemapTargetSlot[] = [
      { id: "pat", kind: "pattern", pattern: "CS-2xxx" },
      { id: "exact", kind: "course", courseId: "CS-2110" },
    ];
    const res = remapPlacements([placement("cs", c("CS-2110"))], targets);
    expect(res.moves).toEqual([{ fromSlotId: "cs", toSlotId: "exact", courseId: "CS-2110" }]);
  });

  it("carries a slot's manual mark to the new slot id", () => {
    const targets: RemapTargetSlot[] = [{ id: "orie-calc", kind: "course", courseId: "MATH-1910" }];
    const res = remapPlacements([placement("cs-calc", c("MATH-1910"), 1, "completed")], targets);
    expect(res.markTransfers).toEqual([{ fromSlotId: "cs-calc", toSlotId: "orie-calc", mark: "completed" }]);
  });

  it("carries a mark onto a freshly-created custom slot", () => {
    const res = remapPlacements([placement("cs-w", c("MUSIC-1201"), 3, "in-progress")], []);
    expect(res.customCreations).toEqual([{ slotId: "cus-remap-cs-w", sem: 3, courseId: "MUSIC-1201" }]);
    expect(res.markTransfers).toEqual([{ fromSlotId: "cs-w", toSlotId: "cus-remap-cs-w", mark: "in-progress" }]);
  });

  it("is deterministic / idempotent — same inputs give the same plan (switch-back safe)", () => {
    const targets: RemapTargetSlot[] = [
      { id: "orie-calc", kind: "course", courseId: "MATH-1910" },
      { id: "orie-tech", kind: "pattern", pattern: "CS-4xxx" },
    ];
    const placements = [
      placement("cs-calc", c("MATH-1910"), 1, "completed"),
      placement("cs-x", c("CS-4820"), 6),
      placement("cs-w", c("MUSIC-1201"), 5),
    ];
    const a = remapPlacements(placements, targets);
    const b = remapPlacements(placements, targets);
    expect(a).toEqual(b);
    // Custom-slot ids are stable across runs (no randomness).
    expect(a.customCreations[0].slotId).toBe("cus-remap-cs-w");
  });

  it("empty input → empty plan (nothing to re-map)", () => {
    const res = remapPlacements([], [{ id: "x", kind: "course", courseId: "CS-2110" }]);
    expect(res).toEqual({ moves: [], customCreations: [], markTransfers: [], matchedCount: 0, keptCount: 0 });
  });
});
