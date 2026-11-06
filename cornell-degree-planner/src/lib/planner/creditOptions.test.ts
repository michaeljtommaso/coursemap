import { describe, expect, it } from "vitest";
import { assign, courseVariants, type RequirementInstance } from "./majorMatch";
import { buildMatchPool } from "./matchAdapters";
import { creditEntryByCourse, creditProfileCredits, isCreditOnlyCourseId } from "./creditPool";
import { solve } from "./distribution";
import { courseMatchesRule } from "./distribution/rules";
import type { CourseRule, DistCourse, Layer, Row } from "./distribution/types";
import type { Placement } from "@/types/plan";
import type { PoolCreditEntry } from "./matchAdapters";
import type { CreditEntry } from "@/lib/schemas";
import { EXAM_TABLES } from "@/data/credit-tables";
import { resolveCreditProfile } from "@/lib/credit/resolve";
import { CURRENT_TABLE_YEAR, examEntryId, type CreditCollege } from "@/lib/credit/types";

// Spec 028: Cornell's "X or Y" exam awards (courseOptions) count ONE option in
// both requirement engines. Fixture entries, not Cornell's tables.

const exam = (examId: string, score: string) => ({
  kind: "exam" as const,
  exam: examId,
  family: "ap" as const,
  score,
  tableYear: "2026-27",
  displayName: `${examId} (${score})`,
});

const CHEM: PoolCreditEntry = {
  id: "exam:ap-chemistry",
  kind: "ap",
  label: "AP Chemistry (5)",
  satisfiesCourseIds: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"],
  credits: 4,
  courseOptions: [
    ["CHEM-2070", "CHEM-2071"],
    ["CHEM-2090", "CHEM-2091"],
  ],
  courseCredits: { "CHEM-2070": 3, "CHEM-2071": 1, "CHEM-2090": 3, "CHEM-2091": 1 },
  source: exam("ap-chemistry", "5"),
};

const STATS_IDS = ["AEM-2100", "BTRY-3010", "PSYCH-2500", "STSCI-2100"];
const STATS: PoolCreditEntry = {
  id: "exam:ap-statistics",
  kind: "ap",
  label: "AP Statistics (5)",
  satisfiesCourseIds: STATS_IDS,
  credits: 4,
  courseOptions: STATS_IDS.map((id) => [id]),
  courseCredits: Object.fromEntries(STATS_IDS.map((id) => [id, 4])),
  source: exam("ap-statistics", "5"),
};

const pool = (entries: PoolCreditEntry[], placements: Placement[] = []) =>
  buildMatchPool({ placements, placedCourses: {}, creditProfile: entries });

describe("buildMatchPool — courseOptions", () => {
  it("emits the first option only, each position carrying its alternates", () => {
    expect(pool([CHEM])).toEqual([
      expect.objectContaining({ id: "CHEM-2070", credits: 3, altIds: ["CHEM-2090"], creditExam: "ap-chemistry", creditScore: "5" }),
      expect.objectContaining({ id: "CHEM-2071", credits: 1, altIds: ["CHEM-2091"] }),
    ]);
    expect(pool([STATS])).toEqual([
      expect.objectContaining({ id: "AEM-2100", credits: 4, altIds: ["BTRY-3010", "PSYCH-2500", "STSCI-2100"] }),
    ]);
  });

  it("adds nothing when one of the options' courses is on the board", () => {
    const placed: Placement = { id: "p1", courseId: "CHEM-2090", sem: 1, order: 0 };
    expect(pool([CHEM], [placed]).map((c) => c.id)).toEqual(["CHEM-2090"]);
  });
});

describe("courseVariants / courseMatchesRule — alternates", () => {
  const [c2070] = pool([CHEM]) as DistCourse[];

  it("lists the course, then each alternate re-cast", () => {
    expect(courseVariants(c2070).map((v) => [v.id, v.subject, v.number])).toEqual([
      ["CHEM-2070", "CHEM", "2070"],
      ["CHEM-2090", "CHEM", "2090"],
    ]);
  });

  it("a course, pattern, subject or number leaf accepts an alternate", () => {
    expect(courseMatchesRule(c2070, { course: ["CHEM-2090"] })).toBe(true);
    expect(courseMatchesRule(c2070, { pattern: "CHEM 209x" })).toBe(true);
    expect(courseMatchesRule(c2070, { number: { min: 2080 } })).toBe(true);
    expect(courseMatchesRule(c2070, { course: ["CHEM-2080"] })).toBe(false);
    const [stats] = pool([STATS]) as DistCourse[];
    expect(courseMatchesRule(stats, { subject: ["PSYCH"] })).toBe(true);
  });

  it("one reading at a time: allOf never mixes two alternates", () => {
    const [stats] = pool([STATS]) as DistCourse[];
    expect(courseMatchesRule(stats, { allOf: [{ subject: ["PSYCH"] }, { number: { min: 3000 } }] })).toBe(false);
    expect(courseMatchesRule(stats, { allOf: [{ subject: ["BTRY"] }, { number: { min: 3000 } }] })).toBe(true);
  });

  it("a board course (no altIds) is unchanged", () => {
    const board: DistCourse = { id: "CHEM-2070", subject: "CHEM", number: "2070", credits: 4 };
    expect(courseMatchesRule(board, { course: ["CHEM-2090"] })).toBe(false);
  });
});

describe("Engineering matcher (assign) — one option, once", () => {
  const seat = (id: string, courseId: string): RequirementInstance => ({
    id,
    kind: "seat",
    req: { kind: "course", courseId },
    credits: 3,
    label: courseId,
  });

  it("AP Chemistry fills the CHEM 2090 seat through its alternate", () => {
    const r = assign(pool([CHEM]), [seat("s-2090", "CHEM-2090")]);
    expect(r.matched.map((m) => m.requirementId)).toEqual(["s-2090"]);
  });

  it("AP Chemistry fills the 2070 seat OR the 2090 seat, never both", () => {
    const r = assign(pool([CHEM]), [seat("s-2070", "CHEM-2070"), seat("s-2090", "CHEM-2090")]);
    expect(r.matched.filter((m) => m.requirementId.startsWith("s-20"))).toHaveLength(1);
  });

  it("AP Statistics fills one statistics seat, not two", () => {
    const r = assign(pool([STATS]), [seat("a", "BTRY-3010"), seat("b", "PSYCH-2500")]);
    expect(r.matched).toHaveLength(1);
    expect(r.missing).toHaveLength(1);
  });

  it("a list pool accepts the alternate", () => {
    const listPool: RequirementInstance = {
      id: "stats",
      kind: "pool",
      rule: { type: "list" },
      minCredits: 3,
      requiredCourses: 1,
      courseIds: ["STSCI-2100"],
      label: "Statistics",
      computable: true,
    };
    const r = assign(pool([STATS]), [listPool]);
    expect(r.missing).toEqual([]);
  });
});

describe("Distribution engine — one option, once", () => {
  const source = { url: "https://example.edu/catalog", anchor: "req" };
  const twoCourse = (id: string, a: string, b: string): Row => ({
    id,
    label: id,
    group: "Chemistry",
    source,
    kind: "pool",
    rule: { course: [a, b] },
    requiredCourses: 2,
    requiredCredits: 0,
  });
  const layer = (rows: Row[]): Layer => ({
    id: "fixture-major",
    kind: "major",
    family: "cals",
    name: "Fixture",
    catalogYear: "2026-27",
    programId: "fixture",
    rows,
  });
  const run = (rows: Row[], entries: PoolCreditEntry[]) => {
    const input = { layers: [layer(rows)], courses: pool(entries), ctx: { programId: "fixture" } };
    const result = solve(input);
    expect(result.verifyLog).toEqual([]);
    return result.layers[0].rows;
  };

  it("AP Chemistry fills a CHEM 2070+2071 pool, or a CHEM 2090+2091 pool", () => {
    expect(run([twoCourse("gen", "CHEM-2070", "CHEM-2071")], [CHEM])[0].status).toBe("met");
    expect(run([twoCourse("honors", "CHEM-2090", "CHEM-2091")], [CHEM])[0].status).toBe("met");
  });

  it("but never both in one layer", () => {
    const rows = run([twoCourse("gen", "CHEM-2070", "CHEM-2071"), twoCourse("honors", "CHEM-2090", "CHEM-2091")], [CHEM]);
    expect(rows.filter((r) => r.status === "met")).toHaveLength(1);
  });

  it("AP Statistics fills one statistics seat, not two", () => {
    const seat = (id: string, c: string): Row => ({ id, label: id, group: "Stats", source, kind: "seat", rule: { course: [c] } });
    const rows = run([seat("a", "BTRY-3010"), seat("b", "PSYCH-2500")], [STATS]);
    expect(rows.map((r) => r.status).sort()).toEqual(["met", "unmet"]);
  });
});

describe("credit totals and naming with courseOptions", () => {
  it("an option award adds its total once, and nothing once an option course is counted", () => {
    expect(creditProfileCredits([CHEM])).toBe(4);
    expect(creditProfileCredits([STATS])).toBe(4);
    expect(creditProfileCredits([CHEM], new Set(["CHEM-2091"]))).toBe(0);
  });

  it("names only the first option's courses, and none when an option course is on the board", () => {
    const transfer: PoolCreditEntry = { id: "transfer:x", kind: "transfer", label: "T", satisfiesCourseIds: ["PSYCH-2500"], credits: 3 };
    const map = creditEntryByCourse([STATS, transfer], []);
    expect(map.get("AEM-2100")?.id).toBe("exam:ap-statistics");
    expect(map.get("PSYCH-2500")?.id).toBe("transfer:x");
    expect(creditEntryByCourse([CHEM], ["CHEM-2090"]).size).toBe(0);
  });
});

// ── Spec 028 audit fixes, against the real 2026-27 tables ──────────────────

const saved = (examId: string, score: string): CreditEntry => ({
  id: examEntryId(examId),
  kind: "ap",
  label: "saved",
  satisfiesCourseIds: [],
  exam: examId,
  score,
  tableYear: CURRENT_TABLE_YEAR,
});
const resolved = (college: CreditCollege, ...entries: CreditEntry[]) => resolveCreditProfile(entries, college, EXAM_TABLES);
const SRC = { url: "https://example.edu/catalog", anchor: "req" };
const fixtureLayer = (rows: Row[], family: Layer["family"] = "cas"): Layer => ({
  id: "fixture-college",
  kind: "college",
  family,
  name: "Fixture",
  catalogYear: "2026-27",
  programId: "fixture",
  rows,
});
const solveRows = (rows: Row[], courses: DistCourse[], family: Layer["family"] = "cas") => {
  const result = solve({ layers: [fixtureLayer(rows, family)], courses, ctx: { programId: "fixture" } });
  expect(result.verifyLog).toEqual([]);
  return result.layers[0].rows;
};
/** The CAS "120 academic credits" row's shape (PE and 1000-1099 left out). */
const credits120 = (limits?: { rule: CourseRule; label: string; maxCredits: number }[]): Row => ({
  id: "credits-120",
  label: "Earn at least 120 academic credits",
  group: "Credits",
  source: SRC,
  kind: "credits",
  rule: { not: { anyOf: [{ subject: ["PE"] }, { number: { min: 1000, max: 1099 } }] } },
  requiredCredits: 120,
  ...(limits ? { limits } : {}),
});
const EXAM_KINDS: CourseRule = { creditKind: ["ap", "ib", "alevel", "intl", "placement"] };

describe("C1: credit naming no Cornell course reaches the Distribution engine", () => {
  const bio = () => resolved("cas", saved("ap-biology", "5"));

  it("AP Biology 5 under A&S is one credit-only course of 8 credits", () => {
    const [entry] = bio();
    expect(entry.satisfiesCourseIds).toEqual([]);
    expect(pool(bio())).toEqual([
      expect.objectContaining({ id: "credit:exam:ap-biology", subject: "", number: "", credits: 8, isCredit: true, creditKind: "ap", creditExam: "ap-biology", creditScore: "5" }),
    ]);
  });

  it("counts 8 toward the 120-credit row", () => {
    const [row] = solveRows([credits120()], pool(bio()));
    expect(row.progress.creditsHave).toBe(8);
    expect(row.courses.map((c) => c.courseId)).toEqual(["credit:exam:ap-biology"]);
  });

  it("is held to a CALS 'at most 15 credits from exams' limit", () => {
    const entries = resolved("cals", saved("ap-biology", "5"), saved("ap-calculus-bc", "5"), saved("ap-psychology", "5"));
    const [row] = solveRows([credits120([{ rule: EXAM_KINDS, label: "At most 15 credits from exams", maxCredits: 15 }])], pool(entries), "cals");
    // 8 (Biology) + 8 (BC: MATH 1110 + 1120) + 3 (Psychology) = 19 from exams, capped at 15.
    expect(row.courses.map((c) => c.courseId)).toContain("credit:exam:ap-biology");
    expect(row.progress.creditsHave).toBeLessThanOrEqual(15);
    expect(row.progress.creditsHave).toBeGreaterThan(8);
  });

  it("never fills a biology-subject, number, pattern or title row", () => {
    const bioRow = (id: string, rule: CourseRule): Row => ({ id, label: id, group: "Bio", source: SRC, kind: "pool", rule, requiredCredits: 4, requiredCourses: 1 });
    const rows = solveRows(
      [
        bioRow("subject", { subject: ["BIOG", "BIOMG", "BIOEE", "BIONB"] }),
        bioRow("number", { number: { min: 1000 } }),
        bioRow("pattern", { pattern: "BIOG xxxx" }),
        bioRow("title", { titleStartsWith: "FWS:" }),
      ],
      pool(bio())
    );
    expect(rows.map((r) => r.status)).toEqual(["unmet", "unmet", "unmet", "unmet"]);
  });

  it("transfer credit with no Cornell equivalent counts too; zero-credit and placement entries add nothing", () => {
    const transfer: PoolCreditEntry = { id: "transfer:abcd1234", kind: "transfer", label: "Intro Sociology (State U)", satisfiesCourseIds: [], credits: 3 };
    const german = resolved("cas", saved("ap-german-language-and-culture", "5")); // 0 credits, the department decides
    const calsEnglish = resolved("cals", saved("ap-english-literature-and-composition", "5")); // placement only
    expect(calsEnglish[0]).toMatchObject({ placementOnly: true, credits: 0 });
    expect(pool([transfer, ...german, ...calsEnglish]).map((c) => [c.id, c.credits, c.creditKind])).toEqual([["credit:transfer:abcd1234", 3, "transfer"]]);
  });

  it("is named by its entry, never a course code", () => {
    const [entry] = bio();
    const map = creditEntryByCourse(bio(), []);
    expect(map.get("credit:exam:ap-biology")?.label).toBe(entry.label);
    expect(isCreditOnlyCourseId("credit:exam:ap-biology")).toBe(true);
    expect(isCreditOnlyCourseId("BIOG-1440")).toBe(false);
  });

  it("the Engineering matcher tolerates it: no seat or level pool takes it", () => {
    const seats: RequirementInstance[] = [
      { id: "bio-seat", kind: "seat", req: { kind: "course", courseId: "BIOMG-1350" }, credits: 3, label: "BIOMG 1350" },
      { id: "bio-pattern", kind: "seat", req: { kind: "pattern", pattern: "BIOG xxxx" }, credits: 3, label: "BIOG" },
      { id: "fws", kind: "seat", req: { kind: "attribute", match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } }, credits: 3, label: "FWS" },
      { id: "bio-level", kind: "pool", rule: { type: "level", subject: "BIOG", min_number: 1000 }, minCredits: 3, requiredCourses: 1, courseIds: [], label: "Bio", computable: true },
    ];
    const r = assign(pool(bio()), seats);
    expect(r.matched).toEqual([]);
  });
});

describe("C2: a lecture and its lab — the lecture carries the credit", () => {
  const minCredits3 = (id: string, course: string[]): Row => ({ id, label: id, group: "Chem", source: SRC, kind: "seat", rule: { allOf: [{ course }, { minCredits: 3 }] } });

  it("AP Chemistry 5: CHEM 2070 counts 4, CHEM 2071 counts 0", () => {
    const courses = pool(resolved("cas", saved("ap-chemistry", "5")));
    expect(courses.map((c) => [c.id, c.credits])).toEqual([
      ["CHEM-2070", 4],
      ["CHEM-2071", 0],
    ]);
    expect(solveRows([minCredits3("gen-chem", ["CHEM-2070", "CHEM-2090"])], courses)[0].status).toBe("met");
  });

  it("IB Chemistry 7 and A-Level Chemistry B fill a 3-credit chemistry seat", () => {
    for (const e of [saved("ib-chemistry-hl", "7"), saved("alevel-chemistry", "B")]) {
      expect(solveRows([minCredits3("gen-chem", ["CHEM-2070", "CHEM-2090"])], pool(resolved("cas", e)))[0].status).toBe("met");
    }
  });

  it("IB Physical Science 7: CHEM 2070 4, CHEM 2071 0, PHYS 1101 4 (the page's split)", () => {
    const [entry] = resolved("cas", saved("ib-physical-science-hl", "7"));
    expect(entry.credits).toBe(8);
    expect(entry.courseCredits).toEqual({ "CHEM-2070": 4, "CHEM-2071": 0, "PHYS-1101": 4 });
  });

  it("Engineering's AP Chemistry 5: CHEM 2090 counts 4", () => {
    expect(pool(resolved("engineering", saved("ap-chemistry", "5"))).map((c) => [c.id, c.credits])).toEqual([
      ["CHEM-2090", 4],
      ["CHEM-2091", 0],
    ]);
  });
});

describe("C3: Engineering's exam-credit FWS fills an FWS seat", () => {
  const fwsSeat: RequirementInstance = {
    id: "fws-1",
    kind: "seat",
    req: { kind: "attribute", match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } },
    credits: 3,
    label: "First-Year Writing Seminar",
  };

  it("AP English Literature 5 under Engineering is ENGL 1100F titled 'FWS: …'", () => {
    const entries = resolved("engineering", saved("ap-english-literature-and-composition", "5"));
    expect(entries[0].courseTitles).toEqual({ "ENGL-1100F": "FWS: First-Year Writing Seminar (exam credit)" });
    const courses = pool(entries);
    expect(courses).toEqual([expect.objectContaining({ id: "ENGL-1100F", title: "FWS: First-Year Writing Seminar (exam credit)", credits: 3 })]);
    expect(assign(courses, [fwsSeat]).matched).toEqual([{ courseId: "ENGL-1100F", requirementId: "fws-1", credits: 3 }]);
    // The Distribution engine's title leaf sees it too.
    expect(courseMatchesRule(courses[0], { titleStartsWith: "FWS:" })).toBe(true);
  });

  it("A&S students never get ENGL 1100F (the A&S table): 3 credits, no course, no FWS seat", () => {
    const entries = resolved("cas", saved("ap-english-literature-and-composition", "5"));
    expect(entries[0].satisfiesCourseIds).not.toContain("ENGL-1100F");
    expect(entries[0].courseTitles).toBeUndefined();
    const courses = pool(entries);
    expect(courses.map((c) => c.id)).toEqual(["credit:exam:ap-english-literature-and-composition"]);
    expect(assign(courses, [fwsSeat]).matched).toEqual([]);
  });
});

describe("C4 / P4: overlapping 'X or Y' grants count as the engines count them", () => {
  it("AP Chemistry 5 + A-Level Chemistry A (CALS): 8 on the rail and in the pool", () => {
    const entries = resolved("cals", saved("ap-chemistry", "5"), { ...saved("alevel-chemistry", "A"), kind: "alevel" });
    const courses = pool(entries);
    expect(courses.map((c) => c.id)).toEqual(["CHEM-2070", "CHEM-2071", "CHEM-2080", "CHEM-2081"]);
    expect(courses.reduce((s, c) => s + c.credits, 0)).toBe(8);
    expect(creditProfileCredits(entries)).toBe(8);
    // Either one alone, or nothing once an option course is counted from the board.
    expect(creditProfileCredits(entries.slice(0, 1))).toBe(4);
    expect(creditProfileCredits(entries, new Set(["CHEM-2090"]))).toBe(0);
  });

  it("CALS AP Statistics 5 and A-Level Statistics: STSCI 2100 first, the forfeit list as alternates", () => {
    for (const e of [saved("ap-statistics", "5"), { ...saved("alevel-statistics", "A"), kind: "alevel" as const }]) {
      const [c] = pool(resolved("cals", e));
      expect(c).toMatchObject({ id: "STSCI-2100", credits: 4 });
      expect(c.altIds).toEqual(expect.arrayContaining(["AEM-2100", "BTRY-3010", "PSYCH-2500"]));
    }
  });
});
