/**
 * Spec 037: Engineering liberal studies.
 * - the predicate (tags per entering class, petitions dated and not, credit);
 * - the real ORE program file through computeRequirementProgress: Student A
 *   passes with HIST 1540 in Group 7, Student B (six tagged courses, two
 *   groups) is partial, a third Communications course doesn't count, a
 *   petitioned untagged course counts, a dated petition doesn't count for a
 *   later placement, AP Microeconomics counts in Group 4, an unknown entering
 *   class leaves Group 7's minimum out;
 * - the advisor-seat swap (D7) and its invariant;
 * - spec 038: the advisor-approved seats take 1100+ courses except the three
 *   pre-curriculum ones.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramSchema } from "@/lib/schemas";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { RequirementItem } from "@/hooks/useRequirementProgress";
import { computeRequirementProgress, type RequirementProgressInput } from "./requirementProgress";
import {
  applyLiberalStudies,
  countsForLiberalStudies,
  liberalStudiesCohort,
  liberalStudiesGroups,
  liberalStudiesGroupsOf,
  liberalStudiesRow,
  semesterTerm,
} from "./liberalStudies";
import { assign, type MatchCourse, type PoolRequirement, type RequirementInstance } from "./majorMatch";
import { buildMatchPool } from "./matchAdapters";
import { buildCourseDisplay, rankProgram } from "./rankMajors";
import type { Program } from "@/types/db";

// ─── The predicate ───────────────────────────────────────────────────────────

describe("liberalStudiesCohort", () => {
  it("follows the entry term, else Fall of the entering year, else unknown", () => {
    expect(liberalStudiesCohort("FA25", null)).toEqual({ cohort: "fa2024", olderPolicy: false });
    expect(liberalStudiesCohort("FA24", null)).toEqual({ cohort: "fa2024", olderPolicy: false });
    expect(liberalStudiesCohort("SP24", null)).toEqual({ cohort: "fa2020", olderPolicy: false });
    expect(liberalStudiesCohort("FA20", 2024)).toEqual({ cohort: "fa2020", olderPolicy: false });
    expect(liberalStudiesCohort("SP20", null)).toEqual({ cohort: "fa2020", olderPolicy: true });
    expect(liberalStudiesCohort(null, 2024)).toEqual({ cohort: "fa2024", olderPolicy: false });
    expect(liberalStudiesCohort(null, 2022)).toEqual({ cohort: "fa2020", olderPolicy: false });
    expect(liberalStudiesCohort(null, 2018)).toEqual({ cohort: "fa2020", olderPolicy: true });
    expect(liberalStudiesCohort("bogus", 2025)).toEqual({ cohort: "fa2024", olderPolicy: false });
    expect(liberalStudiesCohort(null, null)).toEqual({ cohort: null, olderPolicy: false });
    expect(liberalStudiesCohort(undefined, undefined)).toEqual({ cohort: null, olderPolicy: false });
  });

  it("semesterTerm dates a board column like the roadmap labels it", () => {
    expect(semesterTerm(1, 2025)).toBe("FA25");
    expect(semesterTerm(2, 2025)).toBe("SP26");
    expect(semesterTerm(8, 2025)).toBe("SP29");
    expect(semesterTerm(1, null)).toBeNull();
  });
});

describe("liberalStudiesGroupsOf", () => {
  const tagged = (...tags: string[]) => ({ id: "X-2000", attrs: tags.map((value) => ({ value })) });

  it("counts a tag by its base for any college suffix", () => {
    expect(liberalStudiesGroupsOf(tagged("SBA-AG", "SSC-AS"), "fa2024")).toEqual(["g4"]);
    expect(liberalStudiesGroupsOf(tagged("LAD-HE"), "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf(tagged("SSC-AAP"), "fa2024")).toEqual(["g4"]);
    expect(liberalStudiesGroupsOf(tagged("HA-AG", "D-AG", "HST-AS", "SCD-AS"), "fa2024")).toEqual(["g2", "g7"]);
    expect(liberalStudiesGroupsOf(tagged("CE-EN"), "fa2024")).toEqual(["g6"]);
    expect(liberalStudiesGroupsOf(tagged("FL-AG"), "fa2020")).toEqual(["g5"]);
  });

  it("splits SCD by entering class, and D only as D-AG", () => {
    expect(liberalStudiesGroupsOf(tagged("SCD-HA"), "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf(tagged("SCD-AS"), "fa2024")).toEqual(["g7"]);
    expect(liberalStudiesGroupsOf(tagged("SCD-HE"), "fa2024")).toEqual([]);
    expect(liberalStudiesGroupsOf(tagged("SCD-AS"), "fa2020")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf(tagged("SCD-HE"), "fa2020")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf(tagged("D-AG"), "fa2024")).toEqual(["g7"]);
    expect(liberalStudiesGroupsOf(tagged("D-AG"), "fa2020")).toEqual(["g7"]);
    expect(liberalStudiesGroupsOf(tagged("D-HE"), "fa2024")).toEqual([]);
    expect(liberalStudiesGroupsOf(tagged("D-HA"), "fa2020")).toEqual([]);
    expect(liberalStudiesGroupsOf(tagged("PBS-AS", "OPHLS-AG"), "fa2024")).toEqual([]);
  });

  it("reads an index record's string tags too", () => {
    expect(liberalStudiesGroupsOf({ id: "X-1000", attrs: ["ETM-AS", "WRT-AG"] }, "fa2024")).toEqual(["g3"]);
    expect(countsForLiberalStudies({ id: "X-1000", attrs: ["WRT-AG"] }, "fa2024")).toBe(false);
    expect(countsForLiberalStudies({ id: "X-1000", attrs: null }, "fa2024")).toBe(false);
  });

  it("counts a petitioned course with no tags; a bare SCD petition is Group 7 (Group 1 for 2020-24)", () => {
    expect(liberalStudiesGroupsOf({ id: "AEM-2710", attrs: [] }, "fa2024")).toEqual(["g4"]);
    expect(liberalStudiesGroupsOf({ id: "ENGRG-3700" }, "fa2024")).toEqual(["g7"]);
    expect(liberalStudiesGroupsOf({ id: "ENGRG-3700" }, "fa2020")).toEqual(["g1"]);
    // Several rows for one id: their groups together.
    expect(liberalStudiesGroupsOf({ id: "INDO-1100" }, "fa2024")).toEqual(["g1", "g5"]);
  });

  it("a petition limited to Summer 2024 and prior applies only to a placement then", () => {
    expect(liberalStudiesGroupsOf({ id: "ART-1500", term: "SU24" }, "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf({ id: "ART-1500", term: "FA23" }, "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf({ id: "ART-1500", term: "FA24" }, "fa2024")).toEqual([]);
    expect(liberalStudiesGroupsOf({ id: "ART-1500", term: "SP26" }, "fa2024")).toEqual([]);
    // Not placed in a known term (a catalog search): the dated row doesn't apply.
    expect(liberalStudiesGroupsOf({ id: "ART-1500" }, "fa2024")).toEqual([]);
  });

  it("an exam-only credit course counts through its award's base codes", () => {
    expect(liberalStudiesGroupsOf({ id: "SPAN-2000A", liberalStudies: ["FL"] }, "fa2024")).toEqual(["g5"]);
    expect(liberalStudiesGroupsOf({ id: "ENGL-1101A", liberalStudies: ["LA", "ALC"] }, "fa2024")).toEqual(["g1"]);
  });

  it("names the seven groups per cohort", () => {
    expect(liberalStudiesGroups("fa2024").map((g) => g.label)).toEqual([
      "Arts & Culture",
      "History",
      "Ethics & Mind",
      "Social Science",
      "Language",
      "Communications",
      "Race & Equity",
    ]);
    expect(liberalStudiesGroups("fa2020").map((g) => g.id)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
  });

  it("the row: Group 7's credit minimum only for Fall 2024 entrants, and only when the class is known", () => {
    expect(liberalStudiesRow("fa2024", {}).perCategory).toEqual({ g6: { max: 2 }, g7: { minCredits: 3 } });
    expect(liberalStudiesRow("fa2020", {}).perCategory).toEqual({ g6: { max: 2 } });
    expect(liberalStudiesRow("fa2024", {}, { omitGroupMinimums: true }).perCategory).toEqual({ g6: { max: 2 } });
    const row = liberalStudiesRow("fa2024", { g4: ["ECON-1110"] });
    expect(row.requiredCourses).toBe(6);
    expect(row.requiredCredits).toBe(18);
    expect(row.minDistinctCategories).toBe(3);
    expect(row.maxCategoriesPerCourse).toBe(1);
    expect(row.limits).toEqual([expect.objectContaining({ rule: { number: { min: 2000 } }, minCourses: 2 })]);
    expect(row.categories.find((c) => c.id === "g4")?.rule).toEqual({ course: ["ECON-1110"] });
  });
});

// ─── The real ORE program ────────────────────────────────────────────────────

function seedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const legacy = JSON.parse(readFileSync(join(seedDir(), "programs.json"), "utf-8")) as { id: string }[];
const oreDoc = legacy.find((p) => p.id === "cornell-ore-bs-2026");
if (!oreDoc) throw new Error("cornell-ore-bs-2026 not in programs.json");
const ORE = normalizeProgramSlots(ProgramSchema.parse(oreDoc));

const course = (id: string, credits: number, tags: string[] = []): Course => {
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
    attrs: tags.map((value) => ({ value, descr: value, group: "Distribution Requirements" })),
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
};

type BoardCourse = [id: string, credits: number, tags: string[], sem?: number];

const STUDENT_A: BoardCourse[] = [
  ["ECON-1110", 3, ["SBA-AG", "SSC-AS"]],
  ["PHIL-1440", 3, ["KCM-AG", "ETM-AS", "ETM-HA"]],
  ["HIST-1540", 4, ["HA-AG", "D-AG", "HST-AS", "SCD-AS"]],
  ["ENGL-2800", 3, ["CA-AG", "LA-AG", "ALC-AS"]],
  ["ENGRC-3500", 3, ["CE-EN"]],
  ["SPAN-1210", 4, ["FL-AG"]],
];

const STUDENT_B: BoardCourse[] = [
  ["ECON-1110", 3, ["SBA-AG", "SSC-AS"]],
  ["ECON-1120", 3, ["SBA-AG", "SSC-AS"]],
  ["PSYCH-1101", 3, ["SBA-AG", "SSC-AS"]],
  ["GOVT-1111", 4, ["SBA-AG", "SSC-AS"]],
  ["PHIL-1100", 3, ["KCM-AG", "ETM-AS"]],
  ["CS-1340", 3, ["KCM-AG", "ETM-AS"]],
];

/** Student A with a history course outside Group 7 in place of HIST 1540. */
const A_WITHOUT_G7: BoardCourse[] = STUDENT_A.map((c) =>
  c[0] === "HIST-1540" ? ["HIST-1530", 4, ["HA-AG", "HST-AS"]] : c
);

function run(board: BoardCourse[], over: Partial<RequirementProgressInput> = {}) {
  const placedCourses: Record<string, Course> = {};
  const placements: Placement[] = board.map(([courseId, credits, tags, sem], i) => {
    placedCourses[courseId] = course(courseId, credits, tags);
    return { id: `p-${courseId}`, courseId, sem: sem ?? 3 + (i % 5), order: Math.floor(i / 5) };
  });
  const progress = computeRequirementProgress({
    templateSlots: ORE,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => id,
    entryTerm: "FA25",
    ...over,
  });
  const items = progress.groups.flatMap((g) => g.items);
  const item = (id: string): RequirementItem => {
    const it = items.find((x) => x.id === id);
    if (!it) throw new Error(`no requirement ${id}; have ${items.map((x) => x.id).join(", ")}`);
    return it;
  };
  return { progress, item, items };
}

const chips = (it: RequirementItem) => {
  const cats = it.dist?.categories ?? [];
  return {
    filled: cats.filter((c) => c.filled).map((c) => c.id),
    missing: cats.filter((c) => c.missing).map((c) => c.id),
  };
};

/** No placement is attributed to two requirements. */
function expectNoDoubleCount(items: RequirementItem[]) {
  const seen = new Map<string, string>();
  for (const it of items) {
    for (const pid of it.coveredBy) {
      expect(seen.get(pid), `${pid} counts for ${seen.get(pid)} and ${it.id}`).toBeUndefined();
      seen.set(pid, it.id);
    }
  }
}

describe("computeRequirementProgress — liberal studies on the ORE program", () => {
  it("Student A passes; HIST 1540 counts in Group 7", () => {
    const { item, items } = run(STUDENT_A);
    const ls = item("liberal-studies");
    expect(ls.checkable).toBe(true);
    expect(ls.status).toBe("satisfied");
    expect(ls.coveredBy).toHaveLength(6);
    expect(ls.dist).toMatchObject({
      rowKind: "distribution",
      layerId: "engineering",
      rowId: "liberal-studies",
      layerKind: "college",
      engineStatus: "met",
      coursesHave: 6,
      coursesNeed: 6,
      creditsHave: 20,
      creditsNeed: 18,
      categoriesNeed: 3,
    });
    expect(ls.dist?.categories?.map((c) => c.label)).toEqual(liberalStudiesGroups("fa2024").map((g) => g.label));
    const { filled, missing } = chips(ls);
    // HIST 1540 is History or Race & Equity: it counts where the rules need it.
    expect(filled).toContain("g7");
    expect(filled).not.toContain("g2");
    expect(missing).toEqual([]);
    expect(ls.dist?.note).toBeUndefined();
    expect(ls.poolProgress).toBeUndefined();
    expectNoDoubleCount(items);
  });

  it("Student B (six tagged courses, two groups) is partial: 2 of 3 groups, Group 7 missing", () => {
    const { item } = run(STUDENT_B);
    const ls = item("liberal-studies");
    expect(ls.status).toBe("partial");
    expect(ls.dist).toMatchObject({ engineStatus: "partial", categoriesHave: 2, categoriesNeed: 3, coursesHave: 6, creditsHave: 19 });
    const { filled, missing } = chips(ls);
    expect(filled).toEqual(["g3", "g4"]);
    expect(missing).toContain("g7");
  });

  it("a Fall 2020 – Spring 2024 entrant isn't required Group 7", () => {
    const fa2024 = run(A_WITHOUT_G7).item("liberal-studies");
    expect(fa2024.status).toBe("partial");
    expect(chips(fa2024).missing).toEqual(["g7"]);
    const fa2020 = run(A_WITHOUT_G7, { entryTerm: "FA22" }).item("liberal-studies");
    expect(fa2020.status).toBe("satisfied");
    expect(chips(fa2020).missing).toEqual([]);
    expect(fa2020.dist?.categories?.find((c) => c.id === "g7")?.label).toBe("Diversity");
    // Student B still fails the group spread and the 2000-level rule.
    const b = run(STUDENT_B, { entryTerm: "FA22" }).item("liberal-studies");
    expect(b.status).toBe("partial");
    expect(b.dist?.categoriesHave).toBe(2);
  });

  it("an entrant before Fall 2020 gets the 2020-24 rules and a note", () => {
    const ls = run(A_WITHOUT_G7, { entryTerm: "FA18" }).item("liberal-studies");
    expect(ls.status).toBe("satisfied");
    expect(ls.dist?.note).toMatch(/before Fall 2020/);
  });

  it("unknown entering class: the row says so and leaves Group 7's minimum out", () => {
    const ls = run(A_WITHOUT_G7, { entryTerm: null, enteringYear: null }).item("liberal-studies");
    expect(ls.status).toBe("satisfied");
    expect(ls.dist?.notice).toEqual({ kind: "needs-entry-term" });
    expect(ls.dist?.note).toMatch(/when you started at Cornell/);
    // The entering year alone is enough.
    const known = run(A_WITHOUT_G7, { entryTerm: null, enteringYear: 2025 }).item("liberal-studies");
    expect(known.status).toBe("partial");
    expect(known.dist?.notice).toBeUndefined();
  });

  it("a third Communications course doesn't count; it fills an advisor-approved seat instead", () => {
    const board: BoardCourse[] = [
      ...STUDENT_A,
      ["ENGRC-3020", 3, ["CE-EN"]],
      ["ENGRC-3350", 3, ["CE-EN"]],
    ];
    const { item, items } = run(board);
    const ls = item("liberal-studies");
    expect(ls.status).toBe("satisfied");
    const ce = ["p-ENGRC-3500", "p-ENGRC-3020", "p-ENGRC-3350"];
    expect(ls.coveredBy.filter((p) => ce.includes(p)).length).toBeLessThanOrEqual(2);
    const adv = item("advisor-elective-open");
    expect(ce.some((p) => adv.coveredBy.includes(p))).toBe(true);
    expectNoDoubleCount(items);
  });

  it("a petitioned course with no roster tag counts", () => {
    const board: BoardCourse[] = [...STUDENT_A.filter((c) => c[0] !== "ECON-1110"), ["AEM-2710", 3, []]];
    const ls = run(board).item("liberal-studies");
    expect(ls.coveredBy).toContain("p-AEM-2710");
    expect(chips(ls).filled).toContain("g4");
    expect(ls.status).toBe("satisfied");
  });

  it("a petition limited to Summer 2024 and prior doesn't count for a Spring 2026 placement", () => {
    const board: BoardCourse[] = [...STUDENT_A.filter((c) => c[0] !== "ENGL-2800"), ["ART-1500", 3, [], 2]];
    // Entered Fall 2025: semester 2 is Spring 2026.
    const late = run(board, { enteringYear: 2025 }).item("liberal-studies");
    expect(late.coveredBy).not.toContain("p-ART-1500");
    // Entered Fall 2023: semester 2 is Spring 2024, inside the approval.
    const early = run(board, { entryTerm: "FA23", enteringYear: 2023 }).item("liberal-studies");
    expect(early.coveredBy).toContain("p-ART-1500");
  });

  it("AP Microeconomics credit (ECON 1110) counts in Group 4 through ECON 1110's catalog tags", () => {
    const board = STUDENT_A.filter((c) => c[0] !== "ECON-1110");
    const tags: Record<string, string[]> = { "ECON-1110": ["SBA-AG", "SSC-AS"] };
    const { item } = run(board, {
      creditProfile: [{ id: "exam:ap-micro", kind: "ap", label: "AP Microeconomics (5)", satisfiesCourseIds: ["ECON-1110"], credits: 3 }],
      catalogAttrs: (id) => tags[id],
    });
    const ls = item("liberal-studies");
    expect(ls.status).toBe("satisfied");
    expect(chips(ls).filled).toContain("g4");
    expect(ls.dist?.countedCodes).toContain("ECON 1110");
    expect(ls.creditLabels).toEqual(["AP Microeconomics (5)"]);
    // Without the catalog's tags the credit course carries none.
    const bare = run(board, {
      creditProfile: [{ id: "exam:ap-micro", kind: "ap", label: "AP Microeconomics (5)", satisfiesCourseIds: ["ECON-1110"], credits: 3 }],
    }).item("liberal-studies");
    expect(bare.status).toBe("partial");
  });

  it("a waived liberal studies requirement stays waived", () => {
    const ls = run(STUDENT_B, { waivedRequirementIds: ["liberal-studies"] }).item("liberal-studies");
    expect(ls.status).toBe("waived");
    expect(ls.dist).toBeUndefined();
  });

  it("nothing tagged: 0 of 3 groups, every chip dashed", () => {
    const ls = run([["CS-2110", 3, []]]).item("liberal-studies");
    expect(ls.status).toBe("unmet");
    expect(ls.dist).toMatchObject({ categoriesHave: 0, coursesHave: 0, creditsHave: 0, creditsNeed: 18 });
    expect(chips(ls).missing).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
  });
});

// ─── The advisor-seat swap (D7) ──────────────────────────────────────────────

const mc = (id: string, credits: number, tags: string[]): MatchCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits, attrs: tags.map((value) => ({ value })) };
};

const LS_POOL: PoolRequirement = {
  id: "liberal-studies",
  kind: "pool",
  rule: { type: "category", category: "liberal-studies" },
  minCredits: 18,
  requiredCourses: 6,
  courseIds: [],
  label: "Liberal Studies",
  computable: true,
};
const ADVISOR: PoolRequirement = {
  id: "advisor-elective-open",
  kind: "pool",
  rule: { type: "open", min_number: 1100, exclude_courses: ["MATH-1110", "MATH-1900", "CS-1109"] },
  minCredits: 6,
  requiredCourses: 2,
  courseIds: [],
  label: "Advisor-Approved Electives",
  computable: true,
};

describe("applyLiberalStudies — the advisor-seat swap", () => {
  const B = STUDENT_B.map(([id, cr, tags]) => mc(id, cr, tags));
  const ENGL = mc("ENGL-2800", 3, ["CA-AG", "LA-AG", "ALC-AS"]);
  const AMST = mc("AMST-2001", 3, ["HA-AG", "SCD-AS"]);
  const courses = [...B, ENGL, AMST];
  const requirements: RequirementInstance[] = [LS_POOL, ADVISOR];

  // The matcher's result with the two courses the rules need sitting in the
  // advisor seats and Student B's six in liberal studies.
  const orig = {
    matched: [
      ...B.map((c) => ({ courseId: c.id, requirementId: LS_POOL.id, credits: c.credits })),
      { courseId: ENGL.id, requirementId: ADVISOR.id, credits: 3 },
      { courseId: AMST.id, requirementId: ADVISOR.id, credits: 3 },
    ],
    missing: [],
    uncounted: [],
    creditsSatisfied: 25,
    creditsRequired: 24,
    pct: 100,
  };

  it("moves the needed courses into liberal studies and the displaced ones into the advisor seats", () => {
    const out = applyLiberalStudies({ courses, requirements, assignment: orig, canonical: (id) => id, cohort: "fa2024" });
    expect(out).not.toBeNull();
    expect(out!.row.status).toBe("met");
    expect(out!.row.counted).toEqual(expect.arrayContaining(["ENGL-2800", "AMST-2001"]));
    expect(out!.row.categoryOf["AMST-2001"]).toBe("g7");
    const lsIds = out!.assignment.matched.filter((m) => m.requirementId === LS_POOL.id).map((m) => m.courseId);
    const advIds = out!.assignment.matched.filter((m) => m.requirementId === ADVISOR.id).map((m) => m.courseId);
    expect(lsIds.sort()).toEqual([...out!.row.counted].sort());
    expect(advIds).toHaveLength(2);
    expect(advIds.every((id) => B.some((c) => c.id === id))).toBe(true);
    // Invariant: no course counts twice; the advisor seats keep their coverage.
    const all = out!.assignment.matched.map((m) => m.courseId);
    expect(new Set(all).size).toBe(all.length);
    expect(out!.assignment.matched.filter((m) => m.requirementId === ADVISOR.id).reduce((s, m) => s + m.credits, 0)).toBe(6);
    expect(out!.assignment.missing).toEqual([]);
  });

  it("doesn't swap when the displaced courses can't take the advisor seats", () => {
    // Every course liberal studies could give back is numbered below 1100.
    const low = [
      mc("ECON-1001", 3, ["SBA-AG"]),
      mc("ECON-1002", 3, ["SBA-AG"]),
      mc("ECON-1003", 3, ["SBA-AG"]),
      mc("ECON-1004", 3, ["SBA-AG"]),
      mc("PHIL-1001", 3, ["ETM-AS"]),
      mc("PHIL-1002", 3, ["ETM-AS"]),
    ];
    const board = [...low, ENGL, AMST];
    const a = {
      ...orig,
      matched: [
        ...low.map((c) => ({ courseId: c.id, requirementId: LS_POOL.id, credits: c.credits })),
        { courseId: ENGL.id, requirementId: ADVISOR.id, credits: 3 },
        { courseId: AMST.id, requirementId: ADVISOR.id, credits: 3 },
      ],
    };
    const out = applyLiberalStudies({ courses: board, requirements, assignment: a, canonical: (id) => id, cohort: "fa2024" })!;
    // The advisor seats keep ENGL 2800 and AMST 2001; liberal studies stays partial.
    const adv = out.assignment.matched.filter((m) => m.requirementId === ADVISOR.id).map((m) => m.courseId);
    expect(adv.sort()).toEqual(["AMST-2001", "ENGL-2800"]);
    expect(out.row.status).toBe("partial");
    expect(out.row.counted).not.toContain("ENGL-2800");
    const all = out.assignment.matched.map((m) => m.courseId);
    expect(new Set(all).size).toBe(all.length);
  });

  it("through assign(): the full board meets liberal studies and fills both advisor seats", () => {
    const matcher = assign(courses, requirements, (id) => id, { liberalStudiesCohort: "fa2024" });
    const out = applyLiberalStudies({ courses, requirements, assignment: matcher, canonical: (id) => id, cohort: "fa2024" })!;
    expect(out.row.status).toBe("met");
    const adv = out.assignment.matched.filter((m) => m.requirementId === ADVISOR.id);
    expect(adv.reduce((s, m) => s + m.credits, 0)).toBe(6);
    const all = out.assignment.matched.map((m) => m.courseId);
    expect(new Set(all).size).toBe(all.length);
  });

  it("no liberal studies pool (or waived) → null", () => {
    expect(applyLiberalStudies({ courses, requirements: [ADVISOR], assignment: orig, canonical: (id) => id, cohort: null })).toBeNull();
  });
});

// ─── Spec 038: advisor-approved electives on the ORE program ─────────────────

describe("computeRequirementProgress — advisor-approved electives (spec 038)", () => {
  // ORE has its own ENGRD 2700 seat; waived, ENGRD 2700 is free for the
  // advisor-approved seats.
  const waivedRequirementIds = ["ore-s3-engrd2700"];

  it("MATH 1110 never fills an advisor-approved seat; ENGRD 2700 does; a 1000-level course doesn't", () => {
    const { item, progress } = run(
      [
        ["MATH-1110", 4, []],
        ["ENGRD-2700", 3, []],
        ["ANSC-1000", 3, []],
      ],
      { waivedRequirementIds }
    );
    const adv = item("advisor-elective-open");
    expect(adv.coveredBy).toEqual(["p-ENGRD-2700"]);
    expect(adv.status).toBe("partial");
    expect(progress.attribution["p-MATH-1110"]).toBeUndefined();
    expect(progress.attribution["p-ANSC-1000"]).toBeUndefined();
  });
});

// ─── Major Match scores liberal studies the same way ─────────────────────────

describe("rankProgram — liberal studies (spec 037)", () => {
  const program: Program = {
    id: "cornell-ore-bs-2026",
    name: "Operations Research and Engineering",
    short_name: "ORE",
    college: "Engineering",
    catalog_year: 2026,
    total_credits: null,
    affiliation_text: null,
    created_at: new Date(0).toISOString(),
  };
  const poolOf = (board: BoardCourse[]) => {
    const placedCourses: Record<string, Course> = {};
    const placements: Placement[] = board.map(([id, cr, tags], i) => {
      placedCourses[id] = course(id, cr, tags);
      return { id: `p${i}`, courseId: id, sem: 3, order: i };
    });
    return buildMatchPool({ placements, placedCourses, creditProfile: [] });
  };
  const canonical = (id: string) => id;

  it("counts liberal studies by the group rules: Student A meets it, Student B is short", () => {
    const a = poolOf(STUDENT_A);
    const ma = rankProgram(program, { slots: ORE }, { pool: a, canonical, display: buildCourseDisplay(a, canonical), ctx: { entryTerm: "FA25" } })!;
    expect(ma.matched.filter((m) => m.requirementId === "liberal-studies")).toHaveLength(6);
    expect(ma.missing.some((m) => m.requirementId === "liberal-studies")).toBe(false);

    const b = poolOf(STUDENT_B);
    const mb = rankProgram(program, { slots: ORE }, { pool: b, canonical, display: buildCourseDisplay(b, canonical), ctx: { entryTerm: "FA25" } })!;
    expect(mb.missing.some((m) => m.requirementId === "liberal-studies")).toBe(true);
    expect(mb.creditsSatisfied).toBe(mb.matched.reduce((s, m) => s + m.credits, 0));
  });
});
