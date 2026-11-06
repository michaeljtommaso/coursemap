import { describe, it, expect } from "vitest";
import { buildMatchPool, matchCredits, programSlotsToMatchInput } from "./matchAdapters";
import { programToRequirements } from "./majorMatch";
import type { Course, ProgramSlotWithData, ElectiveGroup } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";

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
    roster: null,
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
const P = (id: string, courseId: string, sem = 1, order = 0): Placement => ({ id, courseId, sem, order });

describe("buildMatchPool (placements → MatchCourse[], spec 014)", () => {
  it("adds every placed course with its enrichment fields riding along", () => {
    const cs2110 = course("CS-2110", {
      title: "Object-Oriented Data Structures",
      credits_min: 4,
      attrs: [{ value: "OTH-AS", descr: "d", group: "g" }],
    });
    const pool = buildMatchPool({
      placements: [P("p1", "CS-2110")],
      placedCourses: { "CS-2110": cs2110 },
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

  it("counts every course on the board, completed or not (attribution is over the board)", () => {
    const pool = buildMatchPool({
      placements: [P("p1", "PHYS-1112", 1, 0), P("p2", "MATH-1910", 1, 1)],
      placedCourses: { "PHYS-1112": course("PHYS-1112"), "MATH-1910": course("MATH-1910") },
      creditProfile: [],
    });
    expect(pool.map((c) => c.id)).toEqual(["PHYS-1112", "MATH-1910"]);
  });

  it("orders the pool by board position (sem, then order), not array order", () => {
    const pool = buildMatchPool({
      placements: [P("late", "CS-4820", 7, 0), P("early-2", "CS-1110", 1, 1), P("early-1", "MATH-1910", 1, 0)],
      placedCourses: {},
      creditProfile: [],
    });
    expect(pool.map((c) => c.id)).toEqual(["MATH-1910", "CS-1110", "CS-4820"]);
  });

  it("a course placed twice (a retake) is pooled once", () => {
    const pool = buildMatchPool({
      placements: [P("a", "CS-2110", 3, 0), P("b", "CS-2110", 4, 0)],
      placedCourses: { "CS-2110": course("CS-2110") },
      creditProfile: [],
    });
    expect(pool).toHaveLength(1);
  });

  it("expands each credit entry's satisfiesCourseIds into isCredit courses", () => {
    const entries: CreditEntry[] = [
      { id: "ap-calc-bc", kind: "ap", label: "AP Calc BC", satisfiesCourseIds: ["MATH-1910", "MATH-1920"], credits: 4 },
    ];
    const pool = buildMatchPool({ placements: [], placedCourses: {}, creditProfile: entries });
    expect(pool).toHaveLength(2);
    expect(pool[0]).toMatchObject({ id: "MATH-1910", subject: "MATH", number: "1910", credits: 4, isCredit: true });
    expect(pool[1]).toMatchObject({ id: "MATH-1920", subject: "MATH", number: "1920", credits: 4, isCredit: true });
  });

  it("defaults a credit entry with no `credits` figure to 3", () => {
    const entries: CreditEntry[] = [
      { id: "ap-x", kind: "ap", label: "AP X", satisfiesCourseIds: ["CHEM-2070"] },
    ];
    const pool = buildMatchPool({ placements: [], placedCourses: {}, creditProfile: entries });
    expect(pool[0].credits).toBe(3);
  });

  it("dedupes by raw id: a real placement wins over a same-id synthetic credit", () => {
    const cs1110 = course("CS-1110", { credits_min: 4 });
    const pool = buildMatchPool({
      placements: [P("p1", "CS-1110")],
      placedCourses: { "CS-1110": cs1110 },
      creditProfile: [{ id: "ap", kind: "ap", label: "AP", satisfiesCourseIds: ["CS-1110"], credits: 3 }],
    });
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ id: "CS-1110", credits: 4 });
    expect(pool[0].isCredit).toBeUndefined(); // the placement, not the credit
  });

  it("falls back to id-derived subject/number and default credits when the course object is missing", () => {
    const pool = buildMatchPool({
      placements: [P("p1", "ORIE-3300")],
      placedCourses: {}, // no course cached yet
      creditProfile: [],
    });
    expect(pool[0]).toMatchObject({ id: "ORIE-3300", subject: "ORIE", number: "3300", credits: 3 });
  });
});

// ── buildMatchPool: Distribution fields (spec 019) ────────────────────────────
describe("buildMatchPool — DistCourse fields (spec 019)", () => {
  const ALIASES = { "ENGRD-2110": "CS-2110", "ENGRD-2100": "ECE-2100", "BTRY-3010": "STSCI-2200" };

  it("carries the credit entry's kind as creditKind on credit courses only", () => {
    const pool = buildMatchPool({
      placements: [P("p1", "CS-1110")],
      placedCourses: { "CS-1110": course("CS-1110") },
      creditProfile: [
        { id: "ap", kind: "ap", label: "AP", satisfiesCourseIds: ["MATH-1910"] },
        { id: "tr", kind: "transfer", label: "Transfer", satisfiesCourseIds: ["ECON-1110"] },
      ],
    });
    expect(pool.map((c) => [c.id, c.creditKind])).toEqual([
      ["CS-1110", undefined],
      ["MATH-1910", "ap"],
      ["ECON-1110", "transfer"],
    ]);
  });

  it("sets creditsMax only on a variable-credit course", () => {
    const pool = buildMatchPool({
      placements: [P("p1", "BIOMS-4990", 1, 0), P("p2", "CS-2110", 1, 1)],
      placedCourses: {
        "BIOMS-4990": course("BIOMS-4990", { credits_min: 1, credits_max: 4 }),
        "CS-2110": course("CS-2110", { credits_min: 3, credits_max: 3 }),
      },
      creditProfile: [],
    });
    expect(pool[0]).toMatchObject({ credits: 1, creditsMax: 4 });
    expect("creditsMax" in pool[1]).toBe(false);
  });

  it("fills crossListedSubjects from the alias map, both directions", () => {
    const pool = buildMatchPool({
      placements: [P("a", "CS-2110", 1, 0), P("b", "ENGRD-2100", 1, 1), P("c", "MATH-1910", 1, 2)],
      placedCourses: {},
      creditProfile: [{ id: "x", kind: "transfer", label: "T", satisfiesCourseIds: ["STSCI-2200"] }],
      aliases: ALIASES,
    });
    const byId = Object.fromEntries(pool.map((c) => [c.id, c.crossListedSubjects]));
    expect(byId["CS-2110"]).toEqual(["ENGRD"]); // canonical id → its alias's subject
    expect(byId["ENGRD-2100"]).toEqual(["ECE"]); // alias → the canonical's subject
    expect(byId["STSCI-2200"]).toEqual(["BTRY"]); // credit courses too
    expect(byId["MATH-1910"]).toBeUndefined(); // not cross-listed
  });

  it("without aliases no course carries crossListedSubjects (the Engineering callers)", () => {
    const pool = buildMatchPool({
      placements: [P("a", "CS-2110")],
      placedCourses: { "CS-2110": course("CS-2110") },
      creditProfile: [],
    });
    expect("crossListedSubjects" in pool[0]).toBe(false);
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

  it("collapses multiple slots sharing an elective group into ONE pool, targeting every slot", () => {
    const { electiveGroups } = programSlotsToMatchInput([
      slot("e1", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 3, name: "Technical Electives" }) }),
      slot("e2", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 3, name: "Technical Electives" }) }),
      slot("e3", { kind: "elective", elective_group_id: "adv", elective_groups: group("adv", { min_credits: 6, name: "Advisor-approved" }) }),
    ]);
    expect(electiveGroups).toHaveLength(2);
    // P-11: two slots × 3 credits each, not 3 credits total.
    expect(electiveGroups.find((g) => g.id === "tech")).toMatchObject({
      min_credits: 6,
      required_courses: 2,
      name: "Technical Electives",
    });
    expect(electiveGroups.find((g) => g.id === "adv")).toMatchObject({ min_credits: 6, required_courses: 1 });
  });

  it("explicit required_courses / required_credits win over the slot-count fallback (spec 019 D6)", () => {
    const g = group("lib", { min_credits: 3, required_courses: 6, required_credits: 18 });
    const { electiveGroups } = programSlotsToMatchInput([
      slot("e1", { kind: "elective", elective_group_id: "lib", elective_groups: g }),
      slot("e2", { kind: "elective", elective_group_id: "lib", elective_groups: g }),
    ]);
    expect(electiveGroups[0]).toMatchObject({ min_credits: 18, required_courses: 6 });
  });

  it("carries a list group's member courses through", () => {
    const g = group("pick", { min_credits: 4, qualifying_rule: { type: "list" }, course_ids: ["CS-3410", "CS-3420"] });
    const { electiveGroups } = programSlotsToMatchInput([
      slot("e1", { kind: "elective", elective_group_id: "pick", elective_groups: g }),
    ]);
    expect(electiveGroups[0].course_ids).toEqual(["CS-3410", "CS-3420"]);
    const [pool] = programToRequirements({ slots: [], electiveGroups });
    expect(pool).toMatchObject({ kind: "pool", computable: true, courseIds: ["CS-3410", "CS-3420"] });
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
      slot("e1", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 3 }) }),
      slot("e2", { kind: "elective", elective_group_id: "tech", elective_groups: group("tech", { min_credits: 3 }) }),
    ]);
    const reqs = programToRequirements(input);
    const seats = reqs.filter((r) => r.kind === "seat");
    const pools = reqs.filter((r) => r.kind === "pool");
    expect(seats).toHaveLength(1);
    expect(pools).toHaveLength(1);
    expect(seats[0]).toMatchObject({ credits: 4 });
    expect(pools[0]).toMatchObject({ minCredits: 6, requiredCourses: 2 });
  });
});

describe("matchCredits — a fixed 0-credit course (spec 019 review)", () => {
  it("a snapshot's 0 is 'no data' (default 3); the catalog doc's 0–0 is a real 0", () => {
    const zero = course("BIOMG-1320", { credits_min: 0, credits_max: 0 });
    const snapshotOnly = buildMatchPool({ placements: [P("p1", "BIOMG-1320")], placedCourses: { "BIOMG-1320": zero }, creditProfile: [] });
    expect(snapshotOnly[0].credits).toBe(3);
    const withDoc = buildMatchPool({
      placements: [P("p1", "BIOMG-1320")],
      placedCourses: { "BIOMG-1320": zero },
      creditProfile: [],
      details: { "BIOMG-1320": zero },
    });
    expect(withDoc[0].credits).toBe(0);
    expect(matchCredits(0, 0, true)).toBe(0);
    expect(matchCredits(0, 4, true)).toBe(3);
    expect(matchCredits(0, 0, false)).toBe(3);
    expect(matchCredits(4, 4, true)).toBe(4);
  });
});

describe("buildMatchPool — resolved credit (spec 025)", () => {
  const SOURCE = {
    kind: "exam" as const,
    exam: "ap-chemistry",
    family: "ap" as const,
    score: "5",
    tableYear: "2026-27",
    displayName: "AP Chemistry (5)",
  };
  const chem = {
    id: "exam:ap-chemistry",
    kind: "ap" as const,
    label: "AP Chemistry (5)",
    satisfiesCourseIds: ["CHEM-2070", "CHEM-2080"],
    credits: 8,
    courseCredits: { "CHEM-2070": 5, "CHEM-2080": 3 },
    source: SOURCE,
  };

  it("each course counts its own share, not the total", () => {
    const pool = buildMatchPool({ placements: [], placedCourses: {}, creditProfile: [chem] });
    expect(pool.map((c) => [c.id, c.credits])).toEqual([
      ["CHEM-2070", 5],
      ["CHEM-2080", 3],
    ]);
  });

  it("exam credit courses carry their exam and score", () => {
    const pool = buildMatchPool({ placements: [], placedCourses: {}, creditProfile: [chem] });
    expect(pool[0]).toMatchObject({ isCredit: true, creditKind: "ap", creditExam: "ap-chemistry", creditScore: "5" });
  });

  it("transfer and unresolved credit carry no exam fields", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [
        { id: "transfer:x", kind: "transfer", label: "T", satisfiesCourseIds: ["MATH-1920"], credits: 4, source: { kind: "transfer" } },
        { id: "old", kind: "ap", label: "U", satisfiesCourseIds: ["CS-1110"], credits: 4, source: { kind: "unresolved" } },
      ],
    });
    for (const c of pool) {
      expect(c.creditExam).toBeUndefined();
      expect(c.creditScore).toBeUndefined();
    }
    expect(pool[0]).toMatchObject({ creditKind: "transfer", credits: 4 });
  });

  it("a placement-only award never enters the pool", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [{ ...chem, credits: 0, courseCredits: { "CHEM-2070": 0, "CHEM-2080": 0 }, placementOnly: true }],
    });
    expect(pool).toEqual([]);
  });

  it("A-Level and international credit kinds pass through", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [
        { id: "a", kind: "alevel", label: "A", satisfiesCourseIds: ["MATH-1110"], credits: 4 },
        { id: "b", kind: "intl", label: "B", satisfiesCourseIds: ["PHYS-1112"], credits: 4 },
      ],
    });
    expect(pool.map((c) => c.creditKind)).toEqual(["alevel", "intl"]);
  });

  it("credit naming no course adds one credit-only course (C1)", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [
        { id: "exam:ap-biology", kind: "ap", label: "AP Biology (5)", satisfiesCourseIds: [], credits: 8, source: { ...SOURCE, exam: "ap-biology" } },
        { id: "transfer:abcd1234", kind: "transfer", label: "T", satisfiesCourseIds: [], credits: 3, source: { kind: "transfer" } },
        // no credits, earns nothing, placement only: nothing
        { id: "exam:ap-german", kind: "ap", label: "G", satisfiesCourseIds: [], credits: 0 },
        { id: "exam:ap-music-theory", kind: "ap", label: "M", satisfiesCourseIds: [], credits: 0, earnsNothing: true },
        { id: "exam:x", kind: "ap", label: "X", satisfiesCourseIds: [], credits: 3, placementOnly: true },
      ],
    });
    expect(pool).toEqual([
      { id: "credit:exam:ap-biology", subject: "", number: "", credits: 8, isCredit: true, creditKind: "ap", creditExam: "ap-biology", creditScore: "5" },
      { id: "credit:transfer:abcd1234", subject: "", number: "", credits: 3, isCredit: true, creditKind: "transfer" },
    ]);
  });

  it("a credit-only course survives an alias map and never takes a course id", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [{ id: "exam:ap-biology", kind: "ap", label: "B", satisfiesCourseIds: [], credits: 8 }],
      aliases: { "CS-2110": "ENGRD-2110" },
    });
    expect(pool.map((c) => [c.id, c.crossListedSubjects])).toEqual([["credit:exam:ap-biology", undefined]]);
  });

  it("a synthetic course takes the award's title for it (C3)", () => {
    const pool = buildMatchPool({
      placements: [],
      placedCourses: {},
      creditProfile: [
        {
          id: "exam:ap-english-literature-and-composition",
          kind: "ap",
          label: "E",
          satisfiesCourseIds: ["ENGL-1100F"],
          credits: 3,
          courseTitles: { "ENGL-1100F": "FWS: First-Year Writing Seminar (exam credit)" },
        },
      ],
    });
    expect(pool).toEqual([expect.objectContaining({ id: "ENGL-1100F", subject: "ENGL", number: "1100F", title: "FWS: First-Year Writing Seminar (exam credit)" })]);
  });
});
