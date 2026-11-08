import { describe, it, expect } from "vitest";
import {
  BLANK_PROGRAM_ID,
  buildCourseDisplay,
  matchCollege,
  programsInScope,
  rankMajors,
  rankProgram,
} from "./rankMajors";
import { assign, programToRequirements, type MatchCourse } from "./majorMatch";
import { programSlotsToMatchInput } from "./matchAdapters";
import { solve } from "./distribution";
import type { Answers, Layer } from "./distribution/types";
import type { ProgramData } from "@/contexts/ProgramProvider";
import type { Course, Program, ProgramSlotWithData } from "@/types/db";

// ── Fixtures (fictional majors) ──────────────────────────────────────────────
function program(id: string, over: Partial<Program> = {}): Program {
  return {
    id,
    name: id,
    short_name: id.toUpperCase(),
    college: "College of Engineering",
    catalog_year: 2025,
    total_credits: 120,
    affiliation_text: null,
    created_at: new Date(0).toISOString(),
    ...over,
  };
}

function mc(id: string, credits = 3, extra: Partial<MatchCourse> = {}): MatchCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number} title`, credits, ...extra };
}

function course(id: string, credits = 3): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: id,
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

function courseSlot(id: string, courseId: string, credits = 3): ProgramSlotWithData {
  return {
    id,
    program_id: "eng",
    kind: "course",
    course_id: courseId,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: 1,
    slot_row: 0,
    category: null,
    attribute_match: null,
    courses: course(courseId, credits),
    elective_groups: null,
  };
}

const SOURCE = { url: "https://example.edu/catalog", anchor: "requirements" };

/** A small hand-made History major layer: one named course, a two-course pool
 *  of HIST courses, and a confirm row (never scored). */
function historyMajor(programId: string): Layer {
  return {
    id: programId,
    kind: "major",
    family: "cas",
    name: "History",
    catalogYear: "2026-27",
    programId,
    rows: [
      { id: "intro", kind: "seat", label: "Intro to History", group: "Core", source: SOURCE, rule: { course: ["HIST-1500"] } },
      {
        id: "electives",
        kind: "pool",
        label: "History electives",
        group: "Electives",
        source: SOURCE,
        rule: { subject: ["HIST"] },
        requiredCourses: 2,
        requiredCredits: 6,
      },
      { id: "advisor", kind: "confirm", label: "Meet your advisor", group: "Other", source: SOURCE },
    ],
  };
}

/** A college layer the ranking must ignore (same for every major). */
const COLLEGE_LAYER: Layer = {
  id: "cas-college",
  kind: "college",
  family: "cas",
  name: "Arts & Sciences",
  catalogYear: "2026-27",
  rows: [{ id: "lang", kind: "seat", label: "A language", group: "Language", source: SOURCE, rule: { subject: ["FREN"] } }],
};

const canonical = (id: string) => id;

// ── Scope ────────────────────────────────────────────────────────────────────
describe("matchCollege", () => {
  it("the current plan's major decides the college", () => {
    expect(matchCollege(null, program("cs"))).toBe("engineering");
    expect(matchCollege("cas", program("cs"))).toBe("engineering");
  });

  it("the blank canvas falls back to the student's saved college, else none", () => {
    const blank = program(BLANK_PROGRAM_ID, { college: "Your own plan" });
    expect(matchCollege("cals", blank)).toBe("cals");
    expect(matchCollege(null, blank)).toBeNull();
    expect(matchCollege(null, null)).toBeNull();
  });
});

describe("programsInScope", () => {
  const programs = [
    program(BLANK_PROGRAM_ID, { college: "Your own plan" }),
    program("cs"),
    program("me"),
    program("old-eng", { status: "hidden" }),
    program("hist", { college: "College of Arts and Sciences", collegeId: "cas", family: "cas" }),
    program("infosci", { college: "College of Agriculture and Life Sciences", collegeId: "cals" }),
  ];

  it("keeps only visible majors of the college, never the blank", () => {
    expect(programsInScope(programs, "engineering").map((p) => p.id)).toEqual(["cs", "me"]);
    expect(programsInScope(programs, "cas").map((p) => p.id)).toEqual(["hist"]);
  });

  it("a CALS major on the Engineering engine still ranks with CALS", () => {
    expect(programsInScope(programs, "cals").map((p) => p.id)).toEqual(["infosci"]);
  });

  it("no college → nothing ranked", () => {
    expect(programsInScope(programs, null)).toEqual([]);
  });
});

// ── Engines ──────────────────────────────────────────────────────────────────
describe("rankProgram — Engineering family", () => {
  it("is exactly today's assign() over the program's slots", () => {
    const slots = [courseSlot("s1", "CS-1110", 4), courseSlot("s2", "CS-2110")];
    const pool = [mc("CS-1110", 4), mc("MATH-1910", 4)];
    const display = buildCourseDisplay(pool, canonical);
    const m = rankProgram(program("cs"), { slots }, { pool, canonical, display })!;
    const expected = assign(pool, programToRequirements(programSlotsToMatchInput(slots)), canonical);

    expect(m.engine).toBe("engineering");
    expect(m.pct).toBe(expected.pct);
    expect(m.creditsSatisfied).toBe(expected.creditsSatisfied);
    expect(m.creditsRequired).toBe(expected.creditsRequired);
    expect(m.missing).toEqual(expected.missing);
    expect(m.matched.map((x) => [x.courseId, x.requirementId, x.credits])).toEqual(
      expected.matched.map((x) => [x.courseId, x.requirementId, x.credits])
    );
    expect(m.uncounted.map((u) => [u.code, u.reason])).toEqual([["MATH 1910", "no-requirement-matched"]]);
    expect(m.requirementsLeft).toBeUndefined();
  });
});

describe("rankProgram — Distribution family", () => {
  const hist = program("hist", { college: "College of Arts and Sciences", collegeId: "cas", family: "cas" });
  const data: ProgramData = { slots: [], layers: [COLLEGE_LAYER, historyMajor("hist")] };
  const pool = [mc("HIST-1500"), mc("HIST-2000"), mc("MATH-1110", 4), mc("FREN-1210", 4)];
  const display = buildCourseDisplay(pool, canonical);

  it("solves the major layer alone and reports the engine's own percent", () => {
    const m = rankProgram(hist, data, { pool, canonical, display })!;
    const expected = solve({ layers: [historyMajor("hist")], courses: pool, ctx: { programId: "hist" }, canonical });
    expect(m.engine).toBe("distribution");
    expect(m.pct).toBe(expected.pct);
    expect(m.pct).toBeGreaterThan(0);
    expect(m.pct).toBeLessThan(100);
  });

  it("maps matched, missing and uncounted without inventing credit totals", () => {
    const m = rankProgram(hist, data, { pool, canonical, display })!;
    expect(m.matched).toContainEqual(
      expect.objectContaining({ courseId: "HIST-1500", code: "HIST 1500", requirementId: "intro", requirementLabel: "Intro to History" })
    );
    expect(m.matched).toContainEqual(expect.objectContaining({ courseId: "HIST-2000", requirementId: "electives" }));
    // One pool row is short a course and 3 credits; the confirm row is never "left".
    expect(m.missing).toEqual([{ requirementId: "electives", label: "History electives", courses: 1, credits: 3 }]);
    expect(m.requirementsLeft).toBe(1);
    expect(m.creditsSatisfied).toBe(6);
    expect(m.creditsRequired).toBe(0);
    // College rows weren't solved: FREN counts toward nothing here.
    expect(m.uncounted.map((u) => u.courseId).sort()).toEqual(["FREN-1210", "MATH-1110"]);
    expect(m.uncounted.every((u) => u.reason === "no-requirement-matched")).toBe(true);
  });

  it("a fully met major has no requirements left", () => {
    const full = [mc("HIST-1500"), mc("HIST-2000"), mc("HIST-3000")];
    const m = rankProgram(hist, data, { pool: full, canonical, display: buildCourseDisplay(full, canonical) })!;
    expect(m.pct).toBe(100);
    expect(m.requirementsLeft).toBe(0);
    expect(m.missing).toEqual([]);
  });

  it("a program whose major layer didn't load can't be scored", () => {
    expect(rankProgram(hist, { slots: [], layers: [COLLEGE_LAYER] }, { pool, canonical, display })).toBeNull();
    expect(rankProgram(hist, { slots: [] }, { pool, canonical, display })).toBeNull();
  });
});

describe("rankProgram — a major whose requirements all live in its tracks", () => {
  // Fictional "Ancient Languages" major: the major layer only has confirm rows
  // (pick a track, a grade floor); everything countable is in the two tracks.
  const MAJOR: Layer = {
    id: "anclang",
    kind: "major",
    family: "cas",
    name: "Ancient Languages",
    catalogYear: "2026-27",
    programId: "anclang",
    concentrations: { min: 1, max: 1 },
    rows: [
      { id: "pick-track", kind: "confirm", label: "Pick a track", group: "Track", source: SOURCE },
      { id: "grades", kind: "confirm", label: "C- or better", group: "Other", source: SOURCE },
    ],
  };
  const track = (id: string, name: string, subject: string): Layer => ({
    id: `anclang--${id}`,
    kind: "concentration",
    family: "cas",
    name,
    catalogYear: "2026-27",
    programId: "anclang",
    concentrationId: id,
    rows: [
      { id: `${id}-intro`, kind: "seat", label: `${name} intro`, group: name, source: SOURCE, rule: { course: [`${subject}-1101`] } },
      {
        id: `${id}-more`,
        kind: "pool",
        label: `More ${name}`,
        group: name,
        source: SOURCE,
        rule: { subject: [subject] },
        requiredCourses: 3,
        requiredCredits: 9,
      },
    ],
  });
  const GREEK = track("greek", "Greek", "GREK");
  const LATIN = track("latin", "Latin", "LATIN");
  // A track the app can't check at all (every row is advisor-confirmed) must
  // never win by having "nothing left".
  const CIV: Layer = {
    ...track("civ", "Civilization", "CLASS"),
    rows: [{ id: "civ-advisor", kind: "confirm", label: "Advisor picks your courses", group: "Civ", source: SOURCE }],
  };
  const prog = program("anclang", { college: "College of Arts and Sciences", collegeId: "cas", family: "cas" });
  const data: ProgramData = { slots: [], layers: [COLLEGE_LAYER, MAJOR, CIV, GREEK, LATIN] };

  it("shows a track by its short name, without the major or the word track", () => {
    const named: ProgramData = {
      slots: [],
      layers: [MAJOR, { ...LATIN, name: "Ancient Languages (BA): Latin track" }],
    };
    const m = rankProgram(prog, named, { pool: [], canonical, display: buildCourseDisplay([], canonical) })!;
    expect(m.track).toBe("Latin");
  });

  it("is scored on the track the plan fits best, and says which", () => {
    const pool = [mc("LATIN-1101"), mc("LATIN-2201")];
    const m = rankProgram(prog, data, { pool, canonical, display: buildCourseDisplay(pool, canonical) })!;
    const expected = solve({ layers: [MAJOR, LATIN], courses: pool, ctx: { programId: "anclang" }, canonical });
    expect(m.track).toBe("Latin");
    expect(m.pct).toBe(expected.pct);
    expect(m.pct).toBeGreaterThan(0);
    expect(m.requirementsLeft).toBe(1);
    expect(m.missing.map((x) => x.requirementId)).toEqual(["latin-more"]);
    expect(m.matched.map((x) => x.courseId).sort()).toEqual(["LATIN-1101", "LATIN-2201"]);
  });

  it("an empty plan still shows how much is left (the first track by name on a tie)", () => {
    const m = rankProgram(prog, data, { pool: [], canonical, display: buildCourseDisplay([], canonical) })!;
    expect(m.track).toBe("Greek");
    expect(m.pct).toBe(0);
    expect(m.requirementsLeft).toBe(2);
  });

  it("a major with requirements of its own is scored on its own layer, with no track", () => {
    const hist = program("hist", { college: "College of Arts and Sciences", collegeId: "cas", family: "cas" });
    const histData: ProgramData = { slots: [], layers: [historyMajor("hist"), { ...LATIN, programId: "hist", id: "hist--latin" }] };
    const pool = [mc("HIST-1500")];
    const m = rankProgram(hist, histData, { pool, canonical, display: buildCourseDisplay(pool, canonical) })!;
    expect(m.track).toBeUndefined();
    expect(m.pct).toBe(solve({ layers: [historyMajor("hist")], courses: pool, ctx: { programId: "hist" }, canonical }).pct);
  });
});

describe("rankMajors", () => {
  const cas = { college: "College of Arts and Sciences", collegeId: "cas" as const, family: "cas" as const };
  const programs = [
    program(BLANK_PROGRAM_ID, { college: "Your own plan" }),
    program("cs"),
    program("hist", cas),
    program("hist2", { ...cas, name: "Another History" }),
    program("gone", { ...cas, status: "hidden" }),
  ];
  const dataById: Record<string, ProgramData> = {
    cs: { slots: [courseSlot("s1", "CS-1110")] },
    hist: { slots: [], layers: [historyMajor("hist")] },
    hist2: { slots: [], layers: [historyMajor("hist2")] },
    gone: { slots: [], layers: [historyMajor("gone")] },
  };

  it("ranks only visible majors of the college, best first", () => {
    const shortHist: Layer = { ...historyMajor("hist"), rows: historyMajor("hist").rows.slice(0, 1) };
    const pool = [mc("HIST-1500")];
    const out = rankMajors({
      programs,
      college: "cas",
      getData: (id) => (id === "hist" ? { slots: [], layers: [shortHist] } : dataById[id]),
      pool,
      canonical,
    });
    // hist (one row, met) 100% beats hist2 (pool still open); the hidden
    // major, the blank and Engineering's cs are never ranked.
    expect(out.map((m) => [m.program.id, m.pct])).toEqual([
      ["hist", 100],
      ["hist2", out[1].pct],
    ]);
    expect(out[1].pct).toBeLessThan(100);
    expect(out.every((m) => m.engine === "distribution")).toBe(true);
  });

  it("ties break by name", () => {
    const pool = [mc("HIST-1500")];
    const out = rankMajors({ programs, college: "cas", getData: (id) => dataById[id], pool, canonical });
    expect(out.map((m) => m.program.name)).toEqual(["Another History", "hist"]);
  });

  it("skips programs not loaded yet", () => {
    const out = rankMajors({
      programs,
      college: "cas",
      getData: (id) => (id === "hist" ? dataById[id] : undefined),
      pool: [],
      canonical,
    });
    expect(out.map((m) => m.program.id)).toEqual(["hist"]);
  });

  it("no college → nothing ranked", () => {
    expect(rankMajors({ programs, college: null, getData: (id) => dataById[id], pool: [], canonical })).toEqual([]);
  });
});

describe("rankProgram — Distribution family uses the student's answers (review)", () => {
  // A row only non-transfers need: solved for the student, as the panel does.
  const major: Layer = {
    ...historyMajor("hist"),
    rows: [
      { id: "intro", kind: "seat", label: "Intro to History", group: "Core", source: SOURCE, rule: { course: ["HIST-1500"] } },
      {
        id: "writing",
        kind: "seat",
        label: "Writing (non-transfers)",
        group: "Core",
        source: SOURCE,
        appliesTo: [{ transfer: ["none"] }],
        rule: { course: ["ENGL-1100"] },
      },
    ],
  };
  const hist = program("hist", { collegeId: "cas", family: "cas", college: "College of Arts and Sciences" });
  const pool = [mc("HIST-1500")];
  const display = buildCourseDisplay(pool, canonical);

  it("a non-transfer student is ranked on the row that applies to them", () => {
    const data: ProgramData = { slots: [], layers: [major] };
    const m = rankProgram(hist, data, {
      pool,
      canonical,
      display,
      ctx: { entryTerm: "FA25", transfer: "none", transferStanding: null },
    })!;
    expect(m.pct).toBeLessThan(100);
    expect(m.requirementsLeft).toBe(1);
  });

  it("the Distribution pool (catalog credits) is used when given", () => {
    const data: ProgramData = { slots: [], layers: [historyMajor("hist")] };
    const zero = [mc("HIST-1500"), mc("HIST-2000", 0), mc("HIST-2100", 0)];
    const three = [mc("HIST-1500"), mc("HIST-2000"), mc("HIST-2100")];
    const m = rankProgram(hist, data, { pool: three, distPool: zero, canonical, display: buildCourseDisplay(three, canonical) })!;
    // Two 0-credit HIST courses don't make the 6-credit elective pool.
    expect(m.requirementsLeft).toBe(1);
  });
});

// ── Spec 020 D7: Major Match uses every answer that applies ─────────────────
describe("rankProgram — the student's answers (spec 020 D7)", () => {
  const FWS_REF = "usedAs:cas-college/fws";
  /** A college layer whose exclusive FWS row counts ENGL 2880 only when the
   *  student says they use it as a writing seminar. */
  const college: Layer = {
    id: "cas-college",
    kind: "college",
    family: "cas",
    name: "Arts & Sciences",
    catalogYear: "2026-27",
    rows: [
      {
        id: "fws",
        kind: "pool",
        label: "Two writing seminars",
        group: "Writing",
        source: SOURCE,
        exclusive: true,
        rule: { anyOf: [{ titleStartsWith: "FWS:" }, { allOf: [{ course: ["ENGL-2880"] }, { answered: FWS_REF }] }] },
        requiredCourses: 2,
        requiredCredits: 6,
      },
    ],
    questions: [{ type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] }, source: SOURCE, quote: "Writing seminar." }],
  };
  /** Two different A&S majors, each with a row ENGL 2880 would fill. */
  const english: Layer = {
    id: "eng-ba",
    kind: "major",
    family: "cas",
    name: "English",
    catalogYear: "2026-27",
    programId: "eng-ba",
    rows: [
      { id: "writing", kind: "seat", label: "A writing course", group: "Core", source: SOURCE, rule: { course: ["ENGL-2880"] } },
      { id: "survey", kind: "seat", label: "Survey", group: "Core", source: SOURCE, rule: { course: ["ENGL-2000"] } },
    ],
  };
  const comparative: Layer = {
    id: "complit-ba",
    kind: "major",
    family: "cas",
    name: "Comparative Literature",
    catalogYear: "2026-27",
    programId: "complit-ba",
    rows: [
      { id: "lit", kind: "seat", label: "A literature course", group: "Core", source: SOURCE, rule: { subject: ["ENGL"] } },
      { id: "theory", kind: "seat", label: "Theory", group: "Core", source: SOURCE, rule: { course: ["COML-3000"] } },
    ],
  };
  const casProgram = (id: string) => program(id, { collegeId: "cas", family: "cas", college: "College of Arts and Sciences" });
  const ctx = { entryTerm: "FA25", transfer: "none" as const, transferStanding: null };
  const pool = [mc("WRIT-1370", 3, { title: "FWS: Writing About Place" }), mc("ENGL-2880", 3, { title: "Expository Writing" })];
  const display = buildCourseDisplay(pool, canonical);
  const rank = (layer: Layer, answers?: { marks: Record<string, "yes" | "no" | number>; facts: Record<string, "yes" | "no"> }) =>
    rankProgram(casProgram(layer.programId!), { slots: [], layers: [college, layer] }, { pool, canonical, display, ctx, answers })!;

  it("a college mark has one key for every major of the college and changes them identically", () => {
    const answers = { marks: { [`${FWS_REF}@ENGL-2880`]: "yes" as const }, facts: {} };
    const engBefore = rank(english);
    const litBefore = rank(comparative);
    const engAfter = rank(english, answers);
    const litAfter = rank(comparative, answers);
    // Unanswered: ENGL 2880 fills one row of each major.
    expect(engBefore.matched.map((m) => m.courseId)).toContain("ENGL-2880");
    expect(litBefore.matched.map((m) => m.courseId)).toContain("ENGL-2880");
    expect(engBefore.pct).toBe(50);
    expect(litBefore.pct).toBe(50);
    // Yes: ENGL 2880 is the student's writing seminar (an exclusive college
    // row), so it counts toward neither major — the same change for both.
    expect(engAfter.matched.map((m) => m.courseId)).not.toContain("ENGL-2880");
    expect(litAfter.matched.map((m) => m.courseId)).not.toContain("ENGL-2880");
    expect(engAfter.pct).toBe(0);
    expect(litAfter.pct).toBe(0);
    expect(engBefore.pct - engAfter.pct).toBe(litBefore.pct - litAfter.pct);
    // ...and exactly what the full solve (college + major) gives the major rows.
    const full = solve({
      layers: [college, english],
      courses: pool,
      ctx: { programId: "eng-ba", ...ctx },
      canonical,
      answers,
    });
    const majorRows = full.layers.find((l) => l.layerId === "eng-ba")!.rows;
    expect(majorRows.find((r) => r.rowId === "writing")!.status).toBe("unmet");
    expect(full.layers.find((l) => l.layerId === "cas-college")!.rows[0].status).toBe("met");
  });

  it("a no, or no answer, keeps the strict reading", () => {
    const no = { marks: { [`${FWS_REF}@ENGL-2880`]: "no" as const }, facts: {} };
    expect(rank(english, no).pct).toBe(rank(english).pct);
  });

  it("a major's own mark applies only to that major (its key carries the major's layer id)", () => {
    const englishQ: Layer = {
      ...english,
      rows: [
        { id: "writing", kind: "seat", label: "A writing course", group: "Core", source: SOURCE, rule: { course: ["ENGL-2880"] } },
        {
          id: "seminar",
          kind: "seat",
          label: "Approved seminar",
          group: "Core",
          source: SOURCE,
          rule: { allOf: [{ subject: ["WRIT"] }, { answered: "approvedFor:eng-ba/seminar" }] },
        },
      ],
      questions: [
        { type: "approvedFor", row: "seminar", courses: { subject: ["WRIT"] }, approver: "dus", source: SOURCE, quote: "With DUS approval." },
      ],
    };
    const litQ: Layer = {
      ...comparative,
      rows: [
        ...comparative.rows,
        {
          id: "seminar",
          kind: "seat",
          label: "Approved seminar",
          group: "Core",
          source: SOURCE,
          rule: { allOf: [{ subject: ["WRIT"] }, { answered: "approvedFor:complit-ba/seminar" }] },
        },
      ],
    };
    const answers = { marks: { "approvedFor:eng-ba/seminar@WRIT-1370": "yes" as const }, facts: {} };
    expect(rank(englishQ, answers).pct).toBeGreaterThan(rank(englishQ).pct);
    expect(rank(litQ, answers).pct).toBe(rank(litQ).pct);
  });

  it("facts apply to every major scored", () => {
    const HONORS = "studentFact:honorsProgram:eng-ba";
    const englishQ: Layer = {
      ...english,
      rows: [
        ...english.rows,
        { id: "honors", kind: "seat", label: "Honors", group: "Core", source: SOURCE, rule: { allOf: [{ answered: HONORS }, { subject: ["WRIT"] }] } },
      ],
    };
    expect(rank(englishQ, { marks: {}, facts: { [HONORS]: "yes" } }).pct).toBeGreaterThan(rank(englishQ).pct);
  });

  it("credit marks change a course's credits before scoring", () => {
    const BIOMI = "creditsTaken:BIOMI-4850";
    const bio: Layer = {
      id: "bio-ba",
      kind: "major",
      family: "cas",
      name: "Biology",
      catalogYear: "2026-27",
      programId: "bio-ba",
      rows: [{ id: "sem", kind: "seat", label: "Seminar", group: "Core", source: SOURCE, rule: { allOf: [{ course: ["BIOMI-4850"] }, { minCredits: 3 }] } }],
      questions: [{ type: "creditsTaken", course: "BIOMI-4850", values: [2, 3], source: SOURCE, quote: "At 3 credits." }],
    };
    const bioPool = [mc("BIOMI-4850", 2)];
    const run = (answers?: { marks: Record<string, number>; facts: Record<string, "yes" | "no"> }) =>
      rankProgram(casProgram("bio-ba"), { slots: [], layers: [college, bio] }, {
        pool: bioPool,
        canonical,
        display: buildCourseDisplay(bioPool, canonical),
        ctx,
        answers,
      })!;
    expect(run().pct).toBe(0);
    expect(run({ marks: { [BIOMI]: 3 }, facts: {} }).pct).toBe(100);
  });

  // ── Audit findings 1 and 2: pin from what the college solve counts ──
  const yesEngl: Answers = { marks: { [`${FWS_REF}@ENGL-2880`]: "yes" }, facts: {} };
  /** The major rows' mean fraction in the full solve: what Major Match must equal (D7). */
  const panelMajorPct = (layers: Layer[], courses: MatchCourse[], answers: Answers, waived?: string[]) => {
    const full = solve({ layers, courses, ctx: { programId: "eng-ba", ...ctx }, canonical, answers, ...(waived ? { waived } : {}) });
    const rows = full.layers.find((l) => l.layerId === "eng-ba")!.rows;
    return { rows, pct: Math.round((100 * rows.reduce((a, r) => a + r.fraction, 0)) / rows.length) };
  };
  const rankWith = (layers: Layer[], courses: MatchCourse[], answers: Answers, waived?: string[]) =>
    rankProgram(casProgram("eng-ba"), { slots: [], layers }, {
      pool: courses,
      canonical,
      display: buildCourseDisplay(courses, canonical),
      ctx,
      answers,
      ...(waived ? { waived } : {}),
    })!;

  it("a usedAs yes on a course the full FWS row does not need leaves it to the major", () => {
    const board = [
      mc("WRIT-1370", 3, { title: "FWS: A" }),
      mc("WRIT-1380", 3, { title: "FWS: B" }),
      mc("ENGL-2880", 3, { title: "Expository Writing" }),
    ];
    const panel = panelMajorPct([college, english], board, yesEngl);
    expect(panel.rows.find((r) => r.rowId === "writing")!.status).toBe("met");
    const m = rankWith([college, english], board, yesEngl);
    expect(m.matched.map((x) => `${x.courseId}->${x.requirementId}`)).toContain("ENGL-2880->writing");
    expect(m.pct).toBe(panel.pct);
  });

  it("a waived college row pins nothing (the plan's college waivers reach Major Match)", () => {
    const board = [mc("ENGL-2880", 3, { title: "Expository Writing" })];
    const waived = ["cas-college:fws"];
    const panel = panelMajorPct([college, english], board, yesEngl, waived);
    expect(panel.rows.find((r) => r.rowId === "writing")!.status).toBe("met");
    const m = rankWith([college, english], board, yesEngl, waived);
    expect(m.matched.some((x) => x.requirementId === "writing")).toBe(true);
    expect(m.pct).toBe(panel.pct);
    // Not waived: the FWS row counts it, so the major does not.
    expect(rankWith([college, english], board, yesEngl).matched.some((x) => x.requirementId === "writing")).toBe(false);
  });

  it("a usedAs target that is an option of an exclusive anyOf pins the course", () => {
    const ALT_REF = "usedAs:cas-college/engl";
    const college2: Layer = {
      ...college,
      rows: [
        {
          id: "writing-req",
          kind: "anyOf",
          label: "Writing",
          group: "Writing",
          source: SOURCE,
          exclusive: true,
          rows: [
            { id: "two-fws", kind: "pool", label: "Two FWS", group: "Writing", source: SOURCE, rule: { titleStartsWith: "FWS:" }, requiredCourses: 2, requiredCredits: 0 },
            { id: "engl", kind: "seat", label: "ENGL 2880 as a seminar", group: "Writing", source: SOURCE, rule: { allOf: [{ course: ["ENGL-2880"] }, { answered: ALT_REF }] } },
          ],
        },
      ],
      questions: [{ type: "usedAs", row: "engl", courses: { course: ["ENGL-2880"] }, source: SOURCE, quote: "Writing seminar." }],
    };
    const board = [mc("ENGL-2880", 3, { title: "Expository Writing" })];
    const answers = { marks: { [`${ALT_REF}@ENGL-2880`]: "yes" as const }, facts: {} };
    const panel = panelMajorPct([college2, english], board, answers);
    expect(panel.rows.find((r) => r.rowId === "writing")!.status).toBe("unmet");
    const m = rankWith([college2, english], board, answers);
    expect(m.matched.some((x) => x.courseId === "ENGL-2880")).toBe(false);
    expect(m.pct).toBe(panel.pct);
  });

  it("runs one college solve per computation, shared by every major of the college", () => {
    const collegeCache = new Map<string, Set<string>>();
    for (const layer of [english, comparative]) {
      rankProgram(casProgram(layer.programId!), { slots: [], layers: [college, layer] }, {
        pool,
        canonical,
        display,
        ctx,
        answers: yesEngl,
        collegeCache,
      });
    }
    expect(collegeCache.size).toBe(1);
  });
});
