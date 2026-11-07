import { describe, expect, it } from "vitest";
import type { CreditEntry } from "@/lib/schemas";
import { examDisplayName, examResult, familyPrefix, resolveCreditProfile, scoresThatEarn, spreadCredits } from "./resolve";
import { CURRENT_TABLE_YEAR, examEntryId, type ExamTables } from "./types";

// A small fixture, not Cornell's table: enough rows to exercise every branch.
const SRC = { url: "https://courses.cornell.edu/fixture", fetched: "2026-11-06" };
const TABLES: ExamTables = {
  year: CURRENT_TABLE_YEAR,
  exams: [
    { id: "ap-calculus-bc", family: "ap", name: "Calculus BC", scale: ["1", "2", "3", "4", "5"], common: true },
    { id: "ap-chemistry", family: "ap", name: "Chemistry", scale: ["1", "2", "3", "4", "5"] },
    { id: "ap-english-literature", family: "ap", name: "English Literature", scale: ["1", "2", "3", "4", "5"] },
    { id: "ap-art-history", family: "ap", name: "Art History", scale: ["1", "2", "3", "4", "5"] },
    { id: "ap-physics-c-mechanics", family: "ap", name: "Physics C: Mechanics", scale: ["1", "2", "3", "4", "5"] },
    { id: "ib-mathematics-analysis-hl", family: "ib", name: "Mathematics: Analysis HL", scale: ["1", "2", "3", "4", "5", "6", "7"] },
    { id: "alevel-mathematics", family: "alevel", name: "Mathematics", scale: ["E", "D", "C", "B", "A", "A*"] },
    { id: "intl-fr-bac-mathematics", family: "intl", name: "Mathematics", group: "French Baccalaureate", scale: ["14", "15", "16"] },
    { id: "ap-placement-only", family: "ap", name: "Placement Exam", scale: ["4", "5"] },
    { id: "ap-chemistry-or", family: "ap", name: "Chemistry Or", scale: ["1", "2", "3", "4", "5"] },
    { id: "ap-german", family: "ap", name: "German", scale: ["1", "2", "3", "4", "5"] },
  ],
  university: {
    college: "university",
    year: CURRENT_TABLE_YEAR,
    source: SRC,
    awards: [
      { exam: "ap-calculus-bc", scores: ["4"], courses: ["MATH-1910"], credits: 4 },
      { exam: "ap-calculus-bc", scores: ["5"], courses: ["MATH-1910", "MATH-1920"], credits: 8 },
      {
        exam: "ap-chemistry",
        scores: ["5"],
        courses: ["CHEM-2070", "CHEM-2080"],
        credits: 8,
        courseCredits: { "CHEM-2070": 5, "CHEM-2080": 3 },
        limits: ["Biological Sciences majors: elective credit only"],
      },
      { exam: "ap-english-literature", scores: ["5"], courses: [], credits: 3, note: "Elective credit" },
      { exam: "ap-art-history", scores: ["4", "5"], courses: ["ARTH-1100"], credits: 3 },
      { exam: "ib-mathematics-analysis-hl", scores: ["6", "7"], courses: ["MATH-1110"], credits: 4 },
      { exam: "alevel-mathematics", scores: ["A", "A*"], courses: ["MATH-1110", "MATH-1120", "MATH-1121"], credits: 5 },
      { exam: "intl-fr-bac-mathematics", scores: ["16"], courses: ["MATH-1110"], credits: 4 },
      { exam: "ap-placement-only", scores: ["5"], courses: ["MATH-1120"], credits: 4, placementOnly: true },
      {
        exam: "ap-chemistry-or",
        scores: ["5"],
        courses: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"],
        courseOptions: [
          ["CHEM-2070", "CHEM-2071"],
          ["CHEM-2090", "CHEM-2091"],
        ],
        credits: 4,
        courseCredits: { "CHEM-2070": 3, "CHEM-2090": 3 },
        note: "One pair, not both.",
      },
      { exam: "ap-german", scores: ["4", "5"], courses: [], credits: 0, note: "German Studies decides credit." },
    ],
  },
  overrides: {
    cas: {
      college: "cas",
      year: CURRENT_TABLE_YEAR,
      source: SRC,
      awards: [{ exam: "ap-english-literature", scores: ["4", "5"], courses: [], credits: 0, note: "No credit in A&S" }],
      replaces: ["ap-english-literature"],
      collegeLimits: ["Not counted toward A&S distribution"],
    },
    cals: {
      college: "cals",
      year: CURRENT_TABLE_YEAR,
      source: SRC,
      awards: [{ exam: "ap-english-literature", scores: ["4", "5"], courses: ["ENGL-1100"], credits: 3 }],
      replaces: ["ap-english-literature"],
    },
  },
  engineering: {
    college: "engineering",
    year: CURRENT_TABLE_YEAR,
    source: SRC,
    awards: [
      { exam: "ap-calculus-bc", scores: ["5"], courses: ["MATH-1910"], credits: 4 },
      { exam: "ap-chemistry", scores: ["5"], courses: ["CHEM-2090"], credits: 4 },
      { exam: "ap-physics-c-mechanics", scores: ["5"], courses: ["PHYS-1112"], credits: 4 },
    ],
  },
};

function exam(examId: string, score: string, extra: Partial<CreditEntry> = {}): CreditEntry {
  return {
    id: examEntryId(examId),
    kind: "ap",
    label: "saved label",
    satisfiesCourseIds: [],
    exam: examId,
    score,
    tableYear: CURRENT_TABLE_YEAR,
    ...extra,
  };
}

describe("familyPrefix / examDisplayName", () => {
  it("names each family", () => {
    expect(examDisplayName(TABLES.exams[0], "5")).toBe("AP Calculus BC (5)");
    expect(examDisplayName(TABLES.exams[5], "7")).toBe("IB Mathematics: Analysis HL (7)");
    expect(examDisplayName(TABLES.exams[6], "A*")).toBe("A-Level Mathematics (A*)");
    expect(examDisplayName(TABLES.exams[7], "16")).toBe("French Baccalaureate Mathematics (16)");
  });
  it("an intl exam with no group reads International", () => {
    expect(familyPrefix({ id: "x", family: "intl", name: "Physics", scale: ["1"] })).toBe("International");
  });
});

describe("spreadCredits", () => {
  it("no courses → undefined", () => {
    expect(spreadCredits([], 3)).toBeUndefined();
  });
  it("one course takes everything", () => {
    expect(spreadCredits(["MATH-1910"], 4)).toEqual({ "MATH-1910": 4 });
  });
  it("evenly in whole credits, remainder to the first course", () => {
    expect(spreadCredits(["A-1", "B-1"], 8)).toEqual({ "A-1": 4, "B-1": 4 });
    expect(spreadCredits(["A-1", "B-1"], 5)).toEqual({ "A-1": 3, "B-1": 2 });
    expect(spreadCredits(["A-1", "B-1", "C-1"], 5)).toEqual({ "A-1": 3, "B-1": 1, "C-1": 1 });
  });
  it("keeps stated figures and spreads only what is left", () => {
    expect(spreadCredits(["A-1", "B-1", "C-1"], 8, { "A-1": 4 })).toEqual({ "A-1": 4, "B-1": 2, "C-1": 2 });
    expect(spreadCredits(["A-1", "B-1"], 8, { "A-1": 5, "B-1": 3 })).toEqual({ "A-1": 5, "B-1": 3 });
  });
  it("always sums to the total", () => {
    for (const total of [0, 1, 3, 4, 7, 8, 11]) {
      for (const n of [1, 2, 3, 4]) {
        const ids = Array.from({ length: n }, (_, i) => `X-${i}`);
        const out = spreadCredits(ids, total)!;
        expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe("resolveCreditProfile — colleges", () => {
  it("null college → the university table", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "5")], null, TABLES);
    expect(r).toMatchObject({
      id: "exam:ap-calculus-bc",
      kind: "ap",
      label: "AP Calculus BC (5)",
      satisfiesCourseIds: ["MATH-1910", "MATH-1920"],
      credits: 8,
      courseCredits: { "MATH-1910": 4, "MATH-1920": 4 },
      limits: [],
      earnsNothing: false,
      source: {
        kind: "exam",
        exam: "ap-calculus-bc",
        family: "ap",
        score: "5",
        tableYear: CURRENT_TABLE_YEAR,
        displayName: "AP Calculus BC (5)",
      },
    });
  });

  it("the score picks the award", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "4")], null, TABLES);
    expect(r.satisfiesCourseIds).toEqual(["MATH-1910"]);
    expect(r.credits).toBe(4);
    expect(r.label).toBe("AP Calculus BC (4)");
  });

  it("a score with no award earns nothing (kept, named, 0 credits)", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "3")], null, TABLES);
    expect(r).toMatchObject({ earnsNothing: true, satisfiesCourseIds: [], credits: 0, label: "AP Calculus BC (3)", limits: [] });
    expect(r.courseCredits).toBeUndefined();
    expect(r.source.kind).toBe("exam");
  });

  it("engineering reads only its own table", () => {
    const [calc, chem, phys, art] = resolveCreditProfile(
      [exam("ap-calculus-bc", "5"), exam("ap-chemistry", "5"), exam("ap-physics-c-mechanics", "5"), exam("ap-art-history", "5")],
      "engineering",
      TABLES
    );
    expect(calc.satisfiesCourseIds).toEqual(["MATH-1910"]);
    expect(calc.credits).toBe(4);
    expect(chem.satisfiesCourseIds).toEqual(["CHEM-2090"]);
    expect(chem.limits).toEqual([]);
    expect(phys.satisfiesCourseIds).toEqual(["PHYS-1112"]);
    // Unlisted in Engineering's table → nothing, even though the university grants it.
    expect(art).toMatchObject({ earnsNothing: true, satisfiesCourseIds: [], credits: 0 });
  });

  it("an exam only Engineering lists earns nothing elsewhere", () => {
    const [phys] = resolveCreditProfile([exam("ap-physics-c-mechanics", "5")], "cas", TABLES);
    expect(phys.earnsNothing).toBe(true);
  });

  it("cas: a replaced exam uses the override, plus the college limits", () => {
    const [eng] = resolveCreditProfile([exam("ap-english-literature", "5")], "cas", TABLES);
    expect(eng).toMatchObject({ credits: 0, satisfiesCourseIds: [], earnsNothing: false });
    expect(eng.limits).toEqual(["Not counted toward A&S distribution"]);
    // Score 4 is in the override only.
    const [eng4] = resolveCreditProfile([exam("ap-english-literature", "4")], "cas", TABLES);
    expect(eng4.earnsNothing).toBe(false);
  });

  it("cas: an exam the override doesn't replace keeps the university award, with collegeLimits after the award's", () => {
    const [chem] = resolveCreditProfile([exam("ap-chemistry", "5")], "cas", TABLES);
    expect(chem.satisfiesCourseIds).toEqual(["CHEM-2070", "CHEM-2080"]);
    expect(chem.courseCredits).toEqual({ "CHEM-2070": 5, "CHEM-2080": 3 });
    expect(chem.limits).toEqual(["Biological Sciences majors: elective credit only", "Not counted toward A&S distribution"]);
  });

  it("cals: its override replaces the exam; no college limits when none are listed", () => {
    const [eng, calc] = resolveCreditProfile([exam("ap-english-literature", "4"), exam("ap-calculus-bc", "5")], "cals", TABLES);
    expect(eng.satisfiesCourseIds).toEqual(["ENGL-1100"]);
    expect(eng.credits).toBe(3);
    expect(eng.limits).toEqual([]);
    expect(calc.satisfiesCourseIds).toEqual(["MATH-1910", "MATH-1920"]);
  });

  it("a college with no override reads the university table", () => {
    const noCals: ExamTables = { ...TABLES, overrides: { cas: TABLES.overrides.cas } };
    const [eng] = resolveCreditProfile([exam("ap-english-literature", "5")], "cals", noCals);
    expect(eng.credits).toBe(3);
    expect(eng.satisfiesCourseIds).toEqual([]);
    expect(eng.courseCredits).toBeUndefined();
  });

  it("a college switch re-resolves the same saved entry (D3)", () => {
    const saved = [exam("ap-calculus-bc", "5")];
    expect(resolveCreditProfile(saved, null, TABLES)[0].credits).toBe(8);
    expect(resolveCreditProfile(saved, "engineering", TABLES)[0].credits).toBe(4);
  });
});

describe("resolveCreditProfile — families", () => {
  it("IB, A-Level and intl exams resolve with their family as kind", () => {
    const [ib, al, fr] = resolveCreditProfile(
      [
        exam("ib-mathematics-analysis-hl", "7", { kind: "ib" }),
        exam("alevel-mathematics", "A*", { kind: "alevel" }),
        exam("intl-fr-bac-mathematics", "16", { kind: "intl" }),
      ],
      null,
      TABLES
    );
    expect(ib).toMatchObject({ kind: "ib", label: "IB Mathematics: Analysis HL (7)", satisfiesCourseIds: ["MATH-1110"], credits: 4 });
    expect(al).toMatchObject({ kind: "alevel", label: "A-Level Mathematics (A*)", credits: 5 });
    expect(al.courseCredits).toEqual({ "MATH-1110": 3, "MATH-1120": 1, "MATH-1121": 1 });
    expect(fr).toMatchObject({ kind: "intl", label: "French Baccalaureate Mathematics (16)" });
  });

  it("kind comes from the table, not the saved kind", () => {
    const [r] = resolveCreditProfile([exam("ib-mathematics-analysis-hl", "7", { kind: "ap" })], null, TABLES);
    expect(r.kind).toBe("ib");
  });

  it("credits-only award: no courses, no courseCredits", () => {
    const [r] = resolveCreditProfile([exam("ap-english-literature", "5")], null, TABLES);
    expect(r).toMatchObject({ satisfiesCourseIds: [], credits: 3, earnsNothing: false });
    expect(r.courseCredits).toBeUndefined();
  });

  it("placement only: courses kept for prerequisites, 0 credits, flagged", () => {
    const [r] = resolveCreditProfile([exam("ap-placement-only", "5")], null, TABLES);
    expect(r).toMatchObject({ satisfiesCourseIds: ["MATH-1120"], credits: 0, placementOnly: true, earnsNothing: false });
    expect(r.courseCredits).toEqual({ "MATH-1120": 0 });
  });
});

describe("resolveCreditProfile — courseOptions and notes", () => {
  it("an X-or-Y award keeps the union as satisfiesCourseIds and copies the options and note", () => {
    const [r] = resolveCreditProfile([exam("ap-chemistry-or", "5")], null, TABLES);
    expect(r.satisfiesCourseIds).toEqual(["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"]);
    expect(r.courseOptions).toEqual([
      ["CHEM-2070", "CHEM-2071"],
      ["CHEM-2090", "CHEM-2091"],
    ]);
    expect(r.note).toBe("One pair, not both.");
    expect(r.credits).toBe(4);
  });

  it("per-course credits are computed within each option (each sums to the total)", () => {
    const [r] = resolveCreditProfile([exam("ap-chemistry-or", "5")], null, TABLES);
    expect(r.courseCredits).toEqual({ "CHEM-2070": 3, "CHEM-2071": 1, "CHEM-2090": 3, "CHEM-2091": 1 });
  });

  it("does not share the option arrays with the tables", () => {
    const [r] = resolveCreditProfile([exam("ap-chemistry-or", "5")], null, TABLES);
    r.courseOptions![0].push("HACK-1");
    expect(TABLES.university.awards.find((a) => a.exam === "ap-chemistry-or")!.courseOptions![0]).toEqual(["CHEM-2070", "CHEM-2071"]);
  });

  it("a 0-credit award with a note resolves with no courses, not earning nothing, note set", () => {
    const [r] = resolveCreditProfile([exam("ap-german", "5")], null, TABLES);
    expect(r).toMatchObject({ credits: 0, satisfiesCourseIds: [], earnsNothing: false, note: "German Studies decides credit." });
    expect(r.courseCredits).toBeUndefined();
    expect(r.courseOptions).toBeUndefined();
  });

  it("an award without a note leaves note unset", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "5")], null, TABLES);
    expect("note" in r).toBe(false);
  });

  it("examResult carries the options", () => {
    expect(examResult("ap-chemistry-or", "5", "cas", TABLES)?.courseOptions).toHaveLength(2);
  });

  it("copies the award's courseTitles (Engineering's exam-credit FWS), unshared", () => {
    const titled: ExamTables = {
      ...TABLES,
      engineering: {
        ...TABLES.engineering,
        awards: [
          ...TABLES.engineering.awards,
          { exam: "ap-english-literature", scores: ["5"], courses: ["ENGL-1100F"], credits: 3, courseTitles: { "ENGL-1100F": "FWS: Exam credit" } },
        ],
      },
    };
    const [eng] = resolveCreditProfile([exam("ap-english-literature", "5")], "engineering", titled);
    expect(eng.courseTitles).toEqual({ "ENGL-1100F": "FWS: Exam credit" });
    eng.courseTitles!["ENGL-1100F"] = "changed";
    expect(titled.engineering.awards.at(-1)!.courseTitles).toEqual({ "ENGL-1100F": "FWS: Exam credit" });
    // The A&S table grants no course and no title.
    const [cas] = resolveCreditProfile([exam("ap-english-literature", "5")], "cas", titled);
    expect(cas.courseTitles).toBeUndefined();
    expect(cas.satisfiesCourseIds).toEqual([]);
  });

  it("copies the award's liberalStudies categories (spec 037 D4), unshared; absent elsewhere", () => {
    const withLs: ExamTables = {
      ...TABLES,
      engineering: {
        ...TABLES.engineering,
        awards: [
          ...TABLES.engineering.awards,
          { exam: "ap-english-literature", scores: ["4"], courses: ["ENGL-1102A"], credits: 3, liberalStudies: ["LA", "ALC"] },
        ],
      },
    };
    const [eng] = resolveCreditProfile([exam("ap-english-literature", "4")], "engineering", withLs);
    expect(eng.liberalStudies).toEqual(["LA", "ALC"]);
    expect(eng.satisfiesCourseIds).toEqual(["ENGL-1102A"]);
    eng.liberalStudies!.push("FL");
    expect(withLs.engineering.awards.at(-1)!.liberalStudies).toEqual(["LA", "ALC"]);
    // The editor's preview carries it too, as its own copy.
    const preview = examResult("ap-english-literature", "4", "engineering", withLs);
    expect(preview?.liberalStudies).toEqual(["LA", "ALC"]);
    preview!.liberalStudies!.push("FL");
    expect(withLs.engineering.awards.at(-1)!.liberalStudies).toEqual(["LA", "ALC"]);
    // An award without it leaves the field unset.
    const [bc] = resolveCreditProfile([exam("ap-calculus-bc", "5")], "engineering", withLs);
    expect("liberalStudies" in bc).toBe(false);
  });
});

describe("resolveCreditProfile — legacy ids, transfer, unresolved", () => {
  const legacy: CreditEntry = {
    id: "ap-calc-bc-5",
    kind: "ap",
    label: "AP Calculus BC (score 5)",
    satisfiesCourseIds: ["MATH-1910", "MATH-1920"],
    credits: 8,
  };

  it("a legacy id reads as exam + score, keeping its saved id", () => {
    const [r] = resolveCreditProfile([legacy], "engineering", TABLES);
    expect(r).toMatchObject({
      id: "ap-calc-bc-5",
      label: "AP Calculus BC (5)",
      exam: "ap-calculus-bc",
      score: "5",
      tableYear: CURRENT_TABLE_YEAR,
      satisfiesCourseIds: ["MATH-1910"],
      credits: 4,
    });
    expect(r.source).toMatchObject({ kind: "exam", exam: "ap-calculus-bc", score: "5" });
  });

  it("never rewrites the saved entry", () => {
    const saved = structuredClone(legacy);
    resolveCreditProfile([saved], "engineering", TABLES);
    expect(saved).toEqual(legacy);
  });

  it("all five legacy ids map to an exam", () => {
    const ids = ["ap-calc-bc-5", "ap-chem-5", "ap-physics-c-mech-5", "ap-physics-c-em-5", "ap-cs-a-5"];
    const out = resolveCreditProfile(
      ids.map((id) => ({ id, kind: "ap" as const, label: id, satisfiesCourseIds: ["X-1"], credits: 4 })),
      null,
      null
    );
    // No tables → kept as saved.
    expect(out.map((r) => r.source.kind)).toEqual(["unresolved", "unresolved", "unresolved", "unresolved", "unresolved"]);
    expect(out[0].satisfiesCourseIds).toEqual(["X-1"]);
    expect(out[0].credits).toBe(4);
  });

  it("transfer entries are kept as saved", () => {
    const t: CreditEntry = { id: "transfer:abcd1234", kind: "transfer", label: "MATH 1920 (State U)", satisfiesCourseIds: ["MATH-1920"], credits: 4 };
    const [r] = resolveCreditProfile([t], "cas", TABLES);
    expect(r).toEqual({ ...t, source: { kind: "transfer" }, limits: [], earnsNothing: false });
  });

  it("a non-exam, non-transfer entry is unresolved and kept", () => {
    const p: CreditEntry = { id: "placement-x", kind: "placement", label: "Placement", satisfiesCourseIds: ["MATH-1110"] };
    const [r] = resolveCreditProfile([p], null, TABLES);
    expect(r).toEqual({ ...p, source: { kind: "unresolved" }, limits: [], earnsNothing: false });
  });

  it("no tables → exam entries unresolved, kept as saved", () => {
    const e = exam("ap-calculus-bc", "5");
    const [r] = resolveCreditProfile([e], "cas", null);
    expect(r).toEqual({ ...e, source: { kind: "unresolved" }, limits: [], earnsNothing: false });
  });

  it("an unknown exam id is unresolved", () => {
    const [r] = resolveCreditProfile([exam("ap-underwater-basketry", "5")], null, TABLES);
    expect(r.source.kind).toBe("unresolved");
    expect(r.label).toBe("saved label");
  });

  it("a score off the scale, or missing, is unresolved", () => {
    const [off, missing] = resolveCreditProfile(
      [exam("ap-calculus-bc", "9"), exam("ap-calculus-bc", "", { score: undefined })],
      null,
      TABLES
    );
    expect(off.source.kind).toBe("unresolved");
    expect(missing.source.kind).toBe("unresolved");
  });

  it("another table year is unresolved (D3), counted as saved", () => {
    const [r] = resolveCreditProfile(
      [exam("ap-calculus-bc", "5", { tableYear: "2027-28", satisfiesCourseIds: ["MATH-1910"], credits: 4 })],
      null,
      TABLES
    );
    expect(r.source.kind).toBe("unresolved");
    expect(r.satisfiesCourseIds).toEqual(["MATH-1910"]);
    expect(r.credits).toBe(4);
  });

  it("no tableYear reads as the tables' year", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "5", { tableYear: undefined })], null, TABLES);
    expect(r.source.kind).toBe("exam");
    expect(r.tableYear).toBe(CURRENT_TABLE_YEAR);
  });

  it("keeps input order, is pure (equal output for equal input)", () => {
    const input = [exam("ap-chemistry", "5"), legacy, exam("ap-calculus-bc", "4")];
    const a = resolveCreditProfile(input, "cas", TABLES);
    const b = resolveCreditProfile(structuredClone(input), "cas", TABLES);
    expect(a.map((r) => r.id)).toEqual(["exam:ap-chemistry", "ap-calc-bc-5", "exam:ap-calculus-bc"]);
    expect(a).toEqual(b);
  });

  it("does not share arrays with the tables", () => {
    const [r] = resolveCreditProfile([exam("ap-calculus-bc", "5")], null, TABLES);
    r.satisfiesCourseIds.push("HACK-1");
    expect(TABLES.university.awards[1].courses).toEqual(["MATH-1910", "MATH-1920"]);
  });
});

describe("examResult", () => {
  it("returns the award with every limit", () => {
    expect(examResult("ap-chemistry", "5", "cas", TABLES)).toMatchObject({
      courses: ["CHEM-2070", "CHEM-2080"],
      credits: 8,
      limits: ["Biological Sciences majors: elective credit only", "Not counted toward A&S distribution"],
    });
    expect(examResult("ap-calculus-bc", "5", "engineering", TABLES)).toMatchObject({ courses: ["MATH-1910"], credits: 4, limits: [] });
  });
  it("null when it earns nothing, the exam is unknown, the score is off-scale, or there are no tables", () => {
    expect(examResult("ap-art-history", "5", "engineering", TABLES)).toBeNull();
    expect(examResult("ap-calculus-bc", "3", null, TABLES)).toBeNull();
    expect(examResult("nope", "5", null, TABLES)).toBeNull();
    expect(examResult("ap-calculus-bc", "9", null, TABLES)).toBeNull();
    expect(examResult("ap-calculus-bc", "5", null, null)).toBeNull();
  });
});

describe("scoresThatEarn", () => {
  it("scores that earn something in any college, lowest first", () => {
    expect(scoresThatEarn("ap-calculus-bc", TABLES)).toEqual(["4", "5"]);
    // University 5 (credits) + CAS 4/5 (0 credits, but a note) + CALS 4/5.
    expect(scoresThatEarn("ap-english-literature", TABLES)).toEqual(["4", "5"]);
    expect(scoresThatEarn("ap-physics-c-mechanics", TABLES)).toEqual(["5"]);
    expect(scoresThatEarn("alevel-mathematics", TABLES)).toEqual(["A", "A*"]);
    expect(scoresThatEarn("ap-placement-only", TABLES)).toEqual(["5"]);
    // 0 credits, no course, but a note: the department decides.
    expect(scoresThatEarn("ap-german", TABLES)).toEqual(["4", "5"]);
  });
  it("an award that grants nothing is not offered", () => {
    const t: ExamTables = {
      ...TABLES,
      university: { ...TABLES.university, awards: [{ exam: "ap-calculus-bc", scores: ["3"], courses: [], credits: 0 }] },
      overrides: {},
      engineering: { ...TABLES.engineering, awards: [] },
    };
    expect(scoresThatEarn("ap-calculus-bc", t)).toEqual([]);
  });
  it("[] for an unknown exam or no tables", () => {
    expect(scoresThatEarn("nope", TABLES)).toEqual([]);
    expect(scoresThatEarn("ap-calculus-bc", null)).toEqual([]);
  });
});
