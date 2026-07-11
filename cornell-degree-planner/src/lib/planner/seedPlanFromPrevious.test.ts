import { describe, it, expect } from "vitest";
import {
  buildCarryOverPlacements,
  seedPlanFromPrevious,
  planContentIsEmpty,
  type PrevPlanSnapshot,
  type OldProgramSlot,
} from "./seedPlanFromPrevious";
import type { RemapTargetSlot, RemapCourse } from "./remapPlacements";

function course(id: string, title?: string): RemapCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title };
}

function prevPlan(partial: Partial<PrevPlanSnapshot> = {}): PrevPlanSnapshot {
  return {
    slotSelections: {},
    completedSlotIds: [],
    waivedSlotIds: [],
    inProgressSlotIds: [],
    selectedCourses: {},
    slotOverrides: {},
    customSlots: [],
    ...partial,
  };
}

describe("buildCarryOverPlacements — effective-semester resolution", () => {
  const oldSlots: OldProgramSlot[] = [
    { id: "cs-s1-math", suggested_semester: 1 },
    { id: "cs-s3-cs2110", suggested_semester: 3 },
  ];

  it("uses the old template slot's suggested semester by default", () => {
    const prev = prevPlan({
      slotSelections: { "cs-s3-cs2110": "CS-2110" },
      selectedCourses: { "CS-2110": course("CS-2110") },
    });
    const p = buildCarryOverPlacements(prev, oldSlots);
    expect(p).toEqual([
      { slotId: "cs-s3-cs2110", course: course("CS-2110"), semester: 3, mark: null },
    ]);
  });

  it("an old slotOverride's sem WINS over the template semester", () => {
    const prev = prevPlan({
      slotSelections: { "cs-s3-cs2110": "CS-2110" },
      selectedCourses: { "CS-2110": course("CS-2110") },
      slotOverrides: { "cs-s3-cs2110": { sem: 5 } },
    });
    expect(buildCarryOverPlacements(prev, oldSlots)[0].semester).toBe(5);
  });

  it("a custom slot carries its OWN semester", () => {
    const prev = prevPlan({
      slotSelections: { "cus-abc": "MUSIC-1201" },
      selectedCourses: { "MUSIC-1201": course("MUSIC-1201") },
      customSlots: [{ id: "cus-abc", sem: 7 }],
    });
    expect(buildCarryOverPlacements(prev, oldSlots)[0].semester).toBe(7);
  });

  it("carries the slot's manual mark; skips selections with no course data", () => {
    const prev = prevPlan({
      slotSelections: { "cs-s1-math": "MATH-1910", "cs-s3-cs2110": "GONE-1" },
      selectedCourses: { "MATH-1910": course("MATH-1910") }, // GONE-1 has no data
      completedSlotIds: ["cs-s1-math"],
    });
    const p = buildCarryOverPlacements(prev, oldSlots);
    expect(p).toHaveLength(1);
    expect(p[0].mark).toBe("completed");
  });
});

describe("seedPlanFromPrevious — the cross-plan C4 seeder", () => {
  const oldSlots: OldProgramSlot[] = [
    { id: "cs-calc", suggested_semester: 1 },
    { id: "cs-2110", suggested_semester: 3 },
    { id: "cs-fws", suggested_semester: 1 },
    { id: "cs-weird", suggested_semester: 5 },
  ];
  const orieTargets: RemapTargetSlot[] = [
    { id: "orie-calc", kind: "course", courseId: "MATH-1910" },
    { id: "orie-tech", kind: "pattern", pattern: "CS-2xxx" },
    {
      id: "orie-fws",
      kind: "attribute",
      attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
    },
  ];

  it("full carry-over with mixed exact/pattern/attribute/custom outcomes", () => {
    const prev = prevPlan({
      slotSelections: {
        "cs-calc": "MATH-1910",
        "cs-2110": "CS-2110",
        "cs-fws": "ENGL-1134",
        "cs-weird": "MUSIC-1201",
      },
      selectedCourses: {
        "MATH-1910": course("MATH-1910"),
        "CS-2110": course("CS-2110"),
        "ENGL-1134": course("ENGL-1134", "FWS: True Stories"),
        "MUSIC-1201": course("MUSIC-1201"),
      },
    });
    const seed = seedPlanFromPrevious(prev, oldSlots, orieTargets);
    expect(seed).not.toBeNull();
    expect(seed!.slotSelections).toEqual({
      "orie-calc": "MATH-1910", // exact course
      "orie-tech": "CS-2110", // pattern
      "orie-fws": "ENGL-1134", // attribute
      "cus-remap-cs-weird": "MUSIC-1201", // no match → custom slot
    });
    expect(seed!.customSlots).toEqual([{ id: "cus-remap-cs-weird", sem: 5 }]);
    expect(seed!.kept).toBe(4);
    expect(seed!.matched).toBe(3);
    expect([...seed!.courseIds].sort()).toEqual([
      "CS-2110",
      "ENGL-1134",
      "MATH-1910",
      "MUSIC-1201",
    ]);
  });

  it("marks travel with their placement to the NEW slot ids", () => {
    const prev = prevPlan({
      slotSelections: { "cs-calc": "MATH-1910", "cs-weird": "MUSIC-1201" },
      selectedCourses: {
        "MATH-1910": course("MATH-1910"),
        "MUSIC-1201": course("MUSIC-1201"),
      },
      completedSlotIds: ["cs-calc"],
      inProgressSlotIds: ["cs-weird"],
    });
    const seed = seedPlanFromPrevious(prev, oldSlots, orieTargets)!;
    expect(seed.completedSlotIds).toEqual(["orie-calc"]);
    expect(seed.inProgressSlotIds).toEqual(["cus-remap-cs-weird"]);
    expect(seed.waivedSlotIds).toEqual([]);
  });

  it("is pure — inputs are not mutated", () => {
    const prev = prevPlan({
      slotSelections: { "cs-calc": "MATH-1910" },
      selectedCourses: { "MATH-1910": course("MATH-1910") },
      completedSlotIds: ["cs-calc"],
      slotOverrides: { "cs-calc": { sem: 2 } },
      customSlots: [{ id: "cus-x", sem: 4 }],
    });
    const prevJson = JSON.stringify(prev);
    const oldJson = JSON.stringify(oldSlots);
    const targetsJson = JSON.stringify(orieTargets);
    seedPlanFromPrevious(prev, oldSlots, orieTargets);
    expect(JSON.stringify(prev)).toBe(prevJson);
    expect(JSON.stringify(oldSlots)).toBe(oldJson);
    expect(JSON.stringify(orieTargets)).toBe(targetsJson);
  });

  it("returns null when the previous plan has nothing to carry", () => {
    expect(seedPlanFromPrevious(prevPlan(), oldSlots, orieTargets)).toBeNull();
    // A mark on a slot with no resolvable course (cs-fws is not a fixed-course
    // slot here) identifies no course to carry — never invent.
    expect(
      seedPlanFromPrevious(prevPlan({ completedSlotIds: ["cs-fws"] }), oldSlots, orieTargets)
    ).toBeNull();
  });

  it("is deterministic — same inputs, same seed (switch-back safe)", () => {
    const prev = prevPlan({
      slotSelections: { "cs-2110": "CS-2110", "cs-weird": "MUSIC-1201" },
      selectedCourses: {
        "CS-2110": course("CS-2110"),
        "MUSIC-1201": course("MUSIC-1201"),
      },
    });
    expect(seedPlanFromPrevious(prev, oldSlots, orieTargets)).toEqual(
      seedPlanFromPrevious(prev, oldSlots, orieTargets)
    );
  });
});

describe("marked template courses — student-asserted truth travels", () => {
  // Old CS program: two fixed-course template slots + one pattern-ish slot.
  const oldSlots: OldProgramSlot[] = [
    { id: "cs-3110", suggested_semester: 4, course: course("CS-3110", "Data Structures & Functional Programming") },
    { id: "cs-2800", suggested_semester: 3, course: course("CS-2800", "Discrete Structures") },
    { id: "cs-fws", suggested_semester: 1 }, // attribute-ish slot: no fixed course
  ];
  const targets: RemapTargetSlot[] = [
    { id: "mse-tech", kind: "pattern", pattern: "CS-3xxx" },
  ];

  it("a COMPLETED template course carries, with its mark, at its template semester", () => {
    const prev = prevPlan({ completedSlotIds: ["cs-3110"] });
    const placements = buildCarryOverPlacements(prev, oldSlots);
    expect(placements).toEqual([
      { slotId: "cs-3110", course: course("CS-3110", "Data Structures & Functional Programming"), semester: 4, mark: "completed" },
    ]);
    const seed = seedPlanFromPrevious(prev, oldSlots, targets)!;
    expect(seed.slotSelections).toEqual({ "mse-tech": "CS-3110" });
    expect(seed.completedSlotIds).toEqual(["mse-tech"]);
    expect(seed.kept).toBe(1);
    expect(seed.matched).toBe(1);
  });

  it("an IN-PROGRESS template course carries too", () => {
    const prev = prevPlan({ inProgressSlotIds: ["cs-2800"] });
    const seed = seedPlanFromPrevious(prev, oldSlots, targets)!;
    // CS-2800 doesn't match CS-3xxx → custom slot at the template semester.
    expect(seed.slotSelections).toEqual({ "cus-remap-cs-2800": "CS-2800" });
    expect(seed.inProgressSlotIds).toEqual(["cus-remap-cs-2800"]);
    expect(seed.customSlots).toEqual([{ id: "cus-remap-cs-2800", sem: 3 }]);
  });

  it("an UNMARKED template default does NOT carry (the template is a suggestion)", () => {
    // Both fixed-course slots present, neither marked, no placements → nothing.
    expect(seedPlanFromPrevious(prevPlan(), oldSlots, targets)).toBeNull();
  });

  it("a WAIVED mark does not carry a template course (waiver ≠ took the course)", () => {
    expect(
      seedPlanFromPrevious(prevPlan({ waivedSlotIds: ["cs-3110"] }), oldSlots, targets)
    ).toBeNull();
  });

  it("a waived-without-course slot carries nothing (no course to identify)", () => {
    expect(
      seedPlanFromPrevious(prevPlan({ waivedSlotIds: ["cs-fws"] }), oldSlots, targets)
    ).toBeNull();
  });

  it("a REMOVED marked template slot does not carry ('not in my plan' is also truth)", () => {
    const prev = prevPlan({
      completedSlotIds: ["cs-3110"],
      slotOverrides: { "cs-3110": { removed: true } },
    });
    expect(seedPlanFromPrevious(prev, oldSlots, targets)).toBeNull();
  });

  it("mixed placement + marked-template: counts cover both; no course duplication", () => {
    // The user placed CS-3110 in a custom slot; the cs-3110 template slot is
    // ALSO marked complete — the course travels once (via the placement).
    const prev = prevPlan({
      slotSelections: { "cus-a": "CS-3110", "cs-2800": "MATH-2930" },
      selectedCourses: {
        "CS-3110": course("CS-3110"),
        "MATH-2930": course("MATH-2930"),
      },
      completedSlotIds: ["cs-3110", "cs-2800"],
      customSlots: [{ id: "cus-a", sem: 6 }],
    });
    const seed = seedPlanFromPrevious(prev, oldSlots, targets)!;
    // CS-3110 (placement) matches the pattern slot; MATH-2930 (placed in the
    // cs-2800 template slot, mark travels with the placement) → custom slot.
    expect(seed.slotSelections).toEqual({
      "mse-tech": "CS-3110",
      "cus-remap-cs-2800": "MATH-2930",
    });
    expect(seed.kept).toBe(2);
    expect(seed.matched).toBe(1);
    expect([...seed.completedSlotIds].sort()).toEqual(["cus-remap-cs-2800", "mse-tech"]);
    // No duplicate CS-3110 selection was minted from the marked template slot.
    expect(Object.values(seed.slotSelections).filter((c) => c === "CS-3110")).toHaveLength(1);
  });

  it("mixed placement + independently marked template course: both carry, counts correct", () => {
    const prev = prevPlan({
      slotSelections: { "cus-a": "PHYS-2214" },
      selectedCourses: { "PHYS-2214": course("PHYS-2214") },
      completedSlotIds: ["cs-3110"], // marked template, untouched by placements
      customSlots: [{ id: "cus-a", sem: 3 }],
    });
    const seed = seedPlanFromPrevious(prev, oldSlots, targets)!;
    expect(seed.slotSelections).toEqual({
      "cus-remap-cus-a": "PHYS-2214", // placement → no match → custom slot
      "mse-tech": "CS-3110", // marked template → pattern match
    });
    expect(seed.completedSlotIds).toEqual(["mse-tech"]);
    expect(seed.kept).toBe(2);
    expect(seed.matched).toBe(1);
  });
});

describe("planContentIsEmpty — the seed-or-load decision", () => {
  const empty = {
    slotSelections: {},
    completedSlotIds: [],
    waivedSlotIds: [],
    inProgressSlotIds: [],
    customSlots: [],
  };
  it("true for a fresh/created plan doc", () => {
    expect(planContentIsEmpty(empty)).toBe(true);
  });
  it("false when ANY student content exists (load untouched, no seeding)", () => {
    expect(planContentIsEmpty({ ...empty, slotSelections: { a: "CS-1110" } })).toBe(false);
    expect(planContentIsEmpty({ ...empty, completedSlotIds: ["a"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, waivedSlotIds: ["a"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, inProgressSlotIds: ["a"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, customSlots: [{ id: "c", sem: 1 }] })).toBe(false);
  });
});
