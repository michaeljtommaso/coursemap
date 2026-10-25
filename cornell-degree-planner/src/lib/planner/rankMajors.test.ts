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
import type { Layer } from "./distribution/types";
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
