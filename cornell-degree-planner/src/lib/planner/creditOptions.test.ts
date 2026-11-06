import { describe, expect, it } from "vitest";
import { assign, courseVariants, type RequirementInstance } from "./majorMatch";
import { buildMatchPool } from "./matchAdapters";
import { creditEntryByCourse, creditProfileCredits } from "./creditPool";
import { solve } from "./distribution";
import { courseMatchesRule } from "./distribution/rules";
import type { DistCourse, Layer, Row } from "./distribution/types";
import type { Placement } from "@/types/plan";
import type { PoolCreditEntry } from "./matchAdapters";

// Spec 025: Cornell's "X or Y" exam awards (courseOptions) count ONE option in
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
