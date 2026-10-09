import { describe, it, expect } from "vitest";
import {
  adaptCurrentShare,
  adaptLegacyShare,
  isLegacyShare,
  readLegacyShareFields,
  type ShareReadModel,
} from "./legacyShare";
import type { Course, ElectiveGroup, ProgramSlotWithData } from "@/types/db";

// ─── fixtures ────────────────────────────────────────────────────────────────

function course(id: string, credits = 4): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject: subject ?? "",
    number: number ?? "",
    title: `Title of ${id}`,
    credits_min: credits,
    credits_max: credits,
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
  };
}

const base = {
  program_id: "cornell-cs-bs-2026",
  course_id: null,
  pattern: null,
  pattern_title: null,
  elective_group_id: null,
  category: null,
  courses: null,
  elective_groups: null,
} as const;

function courseSlot(id: string, sem: number, row: number, c: Course): ProgramSlotWithData {
  return { ...base, id, kind: "course", course_id: c.id, suggested_semester: sem, slot_row: row, courses: c };
}
function group(name: string, min: number): ElectiveGroup {
  return {
    id: `g-${name}`,
    program_id: "cornell-cs-bs-2026",
    name,
    description: null,
    qualifying_rule: { type: "open" },
    min_credits: min,
    advisor_approval: false,
    notes: null,
  };
}
function electiveSlot(id: string, sem: number, row: number, name: string, min = 3): ProgramSlotWithData {
  return {
    ...base,
    id,
    kind: "elective",
    elective_group_id: `g-${name}`,
    suggested_semester: sem,
    slot_row: row,
    elective_groups: group(name, min),
  };
}
function patternSlot(id: string, sem: number, row: number, pattern: string, title: string): ProgramSlotWithData {
  return { ...base, id, kind: "pattern", pattern, pattern_title: title, suggested_semester: sem, slot_row: row };
}

/** A CS-major template, abridged — ids in the program-doc style. */
const TEMPLATE: ProgramSlotWithData[] = [
  courseSlot("cs-s1-math1910", 1, 0, course("MATH-1910")),
  patternSlot("cs-s1-cs111x", 1, 1, "CS-111x", "Intro to programming"),
  electiveSlot("cs-s1-fws", 1, 2, "First-Year Writing Seminar"),
  electiveSlot("cs-s1-pe", 1, 3, "Physical Education", 0),
  courseSlot("cs-s2-math1920", 2, 0, course("MATH-1920")),
  courseSlot("cs-s2-cs2110", 2, 1, course("CS-2110")),
  courseSlot("cs-s2-phys1112", 2, 2, course("PHYS-1112")),
  courseSlot("cs-s3-cs2800", 3, 0, course("CS-2800")),
  electiveSlot("cs-s3-tech", 3, 1, "Technical elective"),
  courseSlot("cs-s4-cs3110", 4, 0, course("CS-3110")),
  electiveSlot("cs-s4-libst", 4, 1, "Liberal studies"),
];

const snap = (id: string, title: string, cr: number) => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMin: cr, creditsMax: cr };
};

/** A realistic pre-014 share doc (schemaVersion 2), as Firestore returns it. */
const OLD_SHARE_DOC: Record<string, unknown> = {
  createdBy: "alice-uid",
  planName: "My CS plan",
  programId: "cornell-cs-bs-2026",
  programName: "Computer Science, B.S.",
  enteringYear: 2026,
  slotSelections: {
    "cs-s1-cs111x": "CS-1110",
    "cs-s3-tech": "CS-3780",
    // The pre-014 "duplicate" (sweep D9): CS 2110 dragged into a custom slot
    // in semester 3; its template slot kept showing the default CS 2110.
    "cus-7f3a": "CS-2110",
  },
  completedSlotIds: ["cs-s1-math1910", "cs-s1-cs111x", "cs-s1-fws", "cs-s2-cs2110"],
  inProgressSlotIds: ["cs-s2-math1920"],
  waivedSlotIds: ["cs-s2-phys1112"],
  courseSnapshots: {
    "CS-1110": snap("CS-1110", "Introduction to Computing: A Design and Development Perspective", 4),
    "CS-3780": snap("CS-3780", "Introduction to Machine Learning", 4),
    "CS-2110": snap("CS-2110", "Object-Oriented Programming and Data Structures", 3),
  },
  slotOverrides: {
    "cs-s1-pe": { removed: true },
    "cs-s4-cs3110": { sem: 5 },
  },
  customSlots: [{ id: "cus-7f3a", sem: 3 }],
  schemaVersion: 2,
};

/** Column view of a read model: sem → [label per card, top to bottom]. */
function columns(m: ShareReadModel): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const sorted = [...m.placements].sort((a, b) => a.sem - b.sem || a.order - b.order);
  for (const p of sorted) {
    (out[p.sem] ??= []).push(m.buckets[p.id] ? `[${m.buckets[p.id].title}]` : p.courseId);
  }
  return out;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("isLegacyShare", () => {
  it("is true below the placement schemaVersion, false at/after it", () => {
    expect(isLegacyShare({ schemaVersion: 1 })).toBe(true);
    expect(isLegacyShare({ schemaVersion: 2 })).toBe(true);
    expect(isLegacyShare({ schemaVersion: 3 })).toBe(false);
  });
});

describe("adaptLegacyShare — realistic pre-014 CS share", () => {
  const model = adaptLegacyShare(readLegacyShareFields(OLD_SHARE_DOC), TEMPLATE);

  it("lays out the board the old share showed, minus empty containers", () => {
    expect(columns(model)).toEqual({
      // PE removed by override; the completed FWS bucket survives as a card.
      1: ["MATH-1910", "CS-1110", "[First-Year Writing Seminar]"],
      // CS 2110's template default is deduped against the user's placement;
      // PHYS 1112 is waived (and unmarked) → not on the board.
      2: ["MATH-1920"],
      // Template order, then the custom slot after the template rows.
      3: ["CS-2800", "CS-3780", "CS-2110"],
      // Unmarked empty Liberal-studies bucket dropped; CS 3110 moved to sem 5.
      5: ["CS-3110"],
    });
  });

  it("placement ids ARE the old slot ids, with dense per-column order", () => {
    const s3 = model.placements.filter((p) => p.sem === 3);
    expect(s3.map((p) => [p.id, p.order])).toEqual([
      ["cs-s3-cs2800", 0],
      ["cs-s3-tech", 1],
      ["cus-7f3a", 2],
    ]);
  });

  it("maps marks onto placements; a deduped default's mark carries to the user's card", () => {
    expect(new Set(model.completedIds)).toEqual(
      new Set(["cs-s1-math1910", "cs-s1-cs111x", "cs-s1-fws", "cus-7f3a"])
    );
    expect(model.inProgressIds).toEqual(["cs-s2-math1920"]);
  });

  it("waivedRequirementIds = waived TEMPLATE slots", () => {
    expect(model.waivedRequirementIds).toEqual(["cs-s2-phys1112"]);
  });

  it("selection courses come from the share's snapshots; defaults from the program doc", () => {
    expect(model.courses["CS-3780"].title).toBe("Introduction to Machine Learning");
    expect(model.courses["CS-2110"].credits_min).toBe(3); // the snapshot, not the template's 4
    expect(model.courses["MATH-1910"]).toBe(TEMPLATE[0].courses);
  });

  it("a marked empty bucket becomes a requirement card with a synthetic, non-course id", () => {
    const fws = model.placements.find((p) => p.id === "cs-s1-fws")!;
    expect(fws.courseId).toBe("requirement:cs-s1-fws");
    expect(model.courses[fws.courseId]).toBeUndefined();
    expect(model.buckets["cs-s1-fws"]).toEqual({
      label: "Elective",
      title: "First-Year Writing Seminar",
      credits: { min: 3, max: 3 },
    });
  });

  it("never writes: the input share fields are left untouched", () => {
    const fields = readLegacyShareFields(OLD_SHARE_DOC);
    const before = JSON.stringify(fields);
    adaptLegacyShare(fields, TEMPLATE);
    expect(JSON.stringify(fields)).toBe(before);
  });
});

describe("adaptLegacyShare — edge rules", () => {
  it("a waived slot that is ALSO completed keeps its card (Complete > Waived)", () => {
    const m = adaptLegacyShare(
      readLegacyShareFields({ completedSlotIds: ["cs-s2-phys1112"], waivedSlotIds: ["cs-s2-phys1112"] }),
      TEMPLATE
    );
    expect(m.placements.some((p) => p.id === "cs-s2-phys1112")).toBe(true);
    expect(m.completedIds).toContain("cs-s2-phys1112");
  });

  it("a waived slot holding a course the user CHOSE keeps that course", () => {
    const m = adaptLegacyShare(
      readLegacyShareFields({ slotSelections: { "cs-s3-tech": "CS-4780" }, waivedSlotIds: ["cs-s3-tech"] }),
      TEMPLATE
    );
    expect(m.placements.find((p) => p.id === "cs-s3-tech")?.courseId).toBe("CS-4780");
  });

  it("a pattern bucket in progress reads by its pattern code", () => {
    const m = adaptLegacyShare(readLegacyShareFields({ inProgressSlotIds: ["cs-s1-cs111x"] }), TEMPLATE);
    expect(m.buckets["cs-s1-cs111x"]).toEqual({ label: "CS 111x", title: "Intro to programming", credits: null });
    expect(m.inProgressIds).toEqual(["cs-s1-cs111x"]);
  });

  it("completed wins over in-progress for the same slot", () => {
    const m = adaptLegacyShare(
      readLegacyShareFields({ completedSlotIds: ["cs-s3-cs2800"], inProgressSlotIds: ["cs-s3-cs2800"] }),
      TEMPLATE
    );
    expect(m.completedIds).toEqual(["cs-s3-cs2800"]);
    expect(m.inProgressIds).toEqual([]);
  });

  it("program unreadable (no template): custom slots + override-positioned selections only", () => {
    const m = adaptLegacyShare(
      readLegacyShareFields({
        ...OLD_SHARE_DOC,
        slotOverrides: { "cs-s1-cs111x": { sem: 2 } },
      }),
      []
    );
    expect(columns(m)).toEqual({ 2: ["CS-1110"], 3: ["CS-2110"] });
    expect(m.waivedRequirementIds).toEqual([]);
  });

  it("an empty old plan reads as an empty board", () => {
    const m = adaptLegacyShare(readLegacyShareFields({}), []);
    expect(m.placements).toEqual([]);
  });

  it("clamps an out-of-range override semester into 1..10", () => {
    const m = adaptLegacyShare(
      readLegacyShareFields({ slotOverrides: { "cs-s3-cs2800": { sem: 14 } } }),
      TEMPLATE
    );
    expect(m.placements.find((p) => p.id === "cs-s3-cs2800")?.sem).toBe(10);
  });
});

describe("readLegacyShareFields", () => {
  it("tolerates a v1 share without inProgress / overrides / customs", () => {
    const f = readLegacyShareFields({
      slotSelections: { a: "CS-1110" },
      completedSlotIds: ["a"],
      waivedSlotIds: [],
      courseSnapshots: {},
      schemaVersion: 1,
    });
    expect(f.inProgressSlotIds).toEqual([]);
    expect(f.slotOverrides).toEqual({});
    expect(f.customSlots).toEqual([]);
  });

  it("drops garbled entries instead of throwing", () => {
    const f = readLegacyShareFields({
      slotSelections: { a: 42, b: "", c: "CS-2110" },
      completedSlotIds: ["x", 7, null],
      slotOverrides: { s: "nope", t: { sem: "3", removed: "yes" }, u: { sem: 4 } },
      customSlots: [null, { id: "" }, { id: "cus-1", sem: 2, title: "Music" }],
      courseSnapshots: ["not", "a", "map"],
    });
    expect(f.slotSelections).toEqual({ c: "CS-2110" });
    expect(f.completedSlotIds).toEqual(["x"]);
    expect(f.slotOverrides).toEqual({ t: {}, u: { sem: 4 } });
    expect(f.customSlots).toEqual([{ id: "cus-1", sem: 2, title: "Music" }]);
    expect(f.courseSnapshots).toEqual({});
  });
});

describe("adaptCurrentShare (new shape)", () => {
  it("reads placements + snapshots and keeps only marks for present placements", () => {
    const m = adaptCurrentShare({
      placements: [
        { id: "p2", courseId: "CS-2110", sem: 2, order: 0 },
        { id: "p1", courseId: "MATH-1910", sem: 1, order: 0 },
      ],
      courseSnapshots: { "CS-2110": snap("CS-2110", "OOP and Data Structures", 3) },
      completedIds: ["p1", "gone"],
      inProgressIds: ["p1", "p2"],
      waivedRequirementIds: ["cs-s2-phys1112"],
    });
    expect(m.placements.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(m.courses["CS-2110"].title).toBe("OOP and Data Structures");
    // A missing snapshot still yields a usable card (code derived from the id).
    expect(m.courses["MATH-1910"].subject).toBe("MATH");
    expect(m.completedIds).toEqual(["p1"]);
    expect(m.inProgressIds).toEqual(["p2"]); // completed wins
    expect(m.waivedRequirementIds).toEqual(["cs-s2-phys1112"]);
    expect(m.buckets).toEqual({});
  });
});
