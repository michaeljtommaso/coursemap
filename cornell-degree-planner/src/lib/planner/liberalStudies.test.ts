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
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  liberalStudiesShortfall,
  semesterTerm,
} from "./liberalStudies";
import { assign, type MatchCourse, type PoolRequirement, type RequirementInstance } from "./majorMatch";
import { buildMatchPool } from "./matchAdapters";
import { evaluateStandaloneRow, type StandaloneRowResult } from "./distribution";
import { buildCourseDisplay, engineeringMatchPool, rankProgram } from "./rankMajors";
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

  it("a cross-listing the petition's note names counts as the printed course does", () => {
    expect(liberalStudiesGroupsOf({ id: "ILRGL-4330" }, "fa2024")).toEqual(["g4"]);
    expect(liberalStudiesGroupsOf({ id: "GOVT-3303" }, "fa2024")).toEqual(["g4"]);
    expect(liberalStudiesGroupsOf({ id: "MUSIC-3613" }, "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf({ id: "LATA-3613" }, "fa2024")).toEqual(["g1"]);
    // A note that limits the approval to the printed course adds no twin.
    expect(liberalStudiesGroupsOf({ id: "PMA-1200" }, "fa2024")).toEqual(["g1"]);
    expect(liberalStudiesGroupsOf({ id: "PE-1180" }, "fa2024")).toEqual([]);
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
      // 20 credits and six groups, shown as reached: "3 of 3 · 18 of 18" (audit F5).
      creditsHave: 18,
      creditsNeed: 18,
      categoriesHave: 3,
      categoriesNeed: 3,
    });
    expect(ls.dist?.categories?.map((c) => c.label)).toEqual(liberalStudiesGroups("fa2024").map((g) => g.label));
    const { filled, missing } = chips(ls);
    // HIST 1540 is History or Race & Equity: it counts where the rules need it.
    expect(filled).toContain("g7");
    expect(filled).not.toContain("g2");
    expect(missing).toEqual([]);
    // The chips still show every group the counted courses fill.
    expect(filled).toHaveLength(6);
    expect(ls.dist?.note).toBeUndefined();
    expect(ls.poolProgress).toBeUndefined();
    expectNoDoubleCount(items);
  });

  it("Student B (six tagged courses, two groups) is partial: 2 of 3 groups, Group 7 missing", () => {
    const { item } = run(STUDENT_B);
    const ls = item("liberal-studies");
    expect(ls.status).toBe("partial");
    // 19 credits, shown as the 18 the row needs (audit F5).
    expect(ls.dist).toMatchObject({ engineStatus: "partial", categoriesHave: 2, categoriesNeed: 3, coursesHave: 6, creditsHave: 18 });
    const { filled, missing } = chips(ls);
    expect(filled).toEqual(["g3", "g4"]);
    expect(missing).toContain("g7");
  });

  it("a Fall 2020 – Spring 2024 entrant isn't required Group 7", () => {
    const fa2024 = run(A_WITHOUT_G7).item("liberal-studies");
    expect(fa2024.status).toBe("partial");
    expect(chips(fa2024).missing).toEqual(["g7"]);
    // Five other groups, Race & Equity required and missing: it is one of the
    // three, so the row reads "2 of 3 groups", never "3 of 3" while not done.
    expect(fa2024.dist).toMatchObject({ categoriesHave: 2, categoriesNeed: 3, coursesHave: 6 });
    const fa2020 = run(A_WITHOUT_G7, { entryTerm: "FA22" }).item("liberal-studies");
    expect(fa2020.status).toBe("satisfied");
    expect(chips(fa2020).missing).toEqual([]);
    // No Group 7 minimum: the plain count.
    expect(fa2020.dist).toMatchObject({ categoriesHave: 3, categoriesNeed: 3 });
    expect(fa2020.dist?.categories?.find((c) => c.id === "g7")?.label).toBe("Diversity");
    // Student B still fails the group spread and the 2000-level rule.
    const b = run(STUDENT_B, { entryTerm: "FA22" }).item("liberal-studies");
    expect(b.status).toBe("partial");
    expect(b.dist?.categoriesHave).toBe(2);
  });

  it("Race & Equity met with only two other groups: 3 of 3 groups", () => {
    // Student B with HIST 1540 (History or Race & Equity) for PSYCH 1101.
    const board = STUDENT_B.map((c): BoardCourse =>
      c[0] === "PSYCH-1101" ? ["HIST-1540", 4, ["HA-AG", "D-AG", "HST-AS", "SCD-AS"]] : c
    );
    const ls = run(board).item("liberal-studies");
    expect(chips(ls).filled).toContain("g7");
    expect(chips(ls).missing).toEqual([]);
    expect(ls.dist).toMatchObject({ categoriesHave: 3, categoriesNeed: 3, coursesHave: 6 });
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

describe("applyLiberalStudies — a Group 7 course held by another broad pool", () => {
  // Student A without a Group 7 course, every course numbered below 3000:
  // meets every rule but Group 7's credits.
  const SIX = A_WITHOUT_G7.map(([id, cr, tags]) =>
    id === "ENGRC-3500" ? mc("ENGRC-2350", cr, tags) : mc(id, cr, tags)
  );
  const G7 = mc("AMST-3001", 3, ["HA-AG", "SCD-AS"]);
  const outside = (min_number?: number): PoolRequirement => ({
    id: "outside-elective",
    kind: "pool",
    rule: { type: "outside", exclude_subjects: ["CS"], ...(min_number != null ? { min_number } : {}) },
    minCredits: 3,
    requiredCourses: 1,
    courseIds: [],
    label: "Outside Elective",
    computable: true,
  });
  const orig = (out: PoolRequirement) => ({
    matched: [
      ...SIX.map((c) => ({ courseId: c.id, requirementId: LS_POOL.id, credits: c.credits })),
      { courseId: G7.id, requirementId: out.id, credits: 3 },
    ],
    missing: [],
    uncounted: [],
    creditsSatisfied: 21,
    creditsRequired: 21,
    pct: 100,
  });

  it("swaps the Group 7 course in when a displaced course can take the outside seat", () => {
    const out = outside();
    const r = applyLiberalStudies({
      courses: [...SIX, G7],
      requirements: [LS_POOL, out],
      assignment: orig(out),
      canonical: (id) => id,
      cohort: "fa2024",
    })!;
    expect(r.row.status).toBe("met");
    expect(r.row.categoryOf["AMST-3001"]).toBe("g7");
    const held = r.assignment.matched.filter((m) => m.requirementId === out.id);
    expect(held).toHaveLength(1);
    expect(held[0].courseId).not.toBe("AMST-3001");
    const all = r.assignment.matched.map((m) => m.courseId);
    expect(new Set(all).size).toBe(all.length);
  });

  it("refuses the swap when it would leave the outside pool short", () => {
    // The outside seat takes only 3000+ courses, and every course liberal
    // studies could give back is numbered below 3000.
    const out = outside(3000);
    const r = applyLiberalStudies({
      courses: [...SIX, G7],
      requirements: [LS_POOL, out],
      assignment: orig(out),
      canonical: (id) => id,
      cohort: "fa2024",
    })!;
    expect(r.assignment.matched.filter((m) => m.requirementId === out.id).map((m) => m.courseId)).toEqual(["AMST-3001"]);
    expect(r.row.counted).not.toContain("AMST-3001");
    expect(r.row.status).toBe("partial");
    expect(r.row.missingCategories).toContain("g7");
  });
});

// ─── The evaluator's search budget runs out (audit G2) ───────────────────────

/** 32 courses, each in two or three of Groups 1–6 and none in Group 7: the
 *  evaluator's search budget runs out over all of them (audit probe 2c). */
function budgetBoard(): MatchCourse[] {
  let s = 129 >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const NO_G7 = ["g1", "g2", "g3", "g4", "g5", "g6"];
  const TAG: Record<string, string> = { g1: "CA-AG", g2: "HST-AS", g3: "ETM-AS", g4: "SSC-AS", g5: "FL-AG", g6: "CE-EN" };
  const out: MatchCourse[] = [];
  for (let i = 0; i < 32; i++) {
    const k = r() < 1 ? 2 + (r() < 0.3 ? 1 : 0) : 1;
    const gs = new Set<string>();
    while (gs.size < k) gs.add(NO_G7[Math.floor(r() * NO_G7.length)]);
    const credits = [3, 3, 4, 2][Math.floor(r() * 4)];
    const number = ["1100", "2000", "3300"][Math.floor(r() * 3)];
    const subject = `S${i % 5}`;
    out.push({ id: `${subject}-${1000 + i}`, subject, number, credits, attrs: NO_G7.filter((g) => gs.has(g)).map((g) => ({ value: TAG[g] })) });
  }
  return out;
}

describe("applyLiberalStudies — when the evaluator can't prove a result", () => {
  const board = budgetBoard();
  const requirements: RequirementInstance[] = [LS_POOL];

  it("keeps the matcher's liberal studies courses instead of counting none", () => {
    const matcher = assign(board, requirements, (id) => id, { liberalStudiesCohort: "fa2024" });
    const pool = matcher.matched.filter((m) => m.requirementId === LS_POOL.id).map((m) => m.courseId);
    expect(pool.length).toBeGreaterThanOrEqual(6);
    // Over all 32 the evaluator gives up.
    const membersOf: Record<string, string[]> = {};
    for (const c of board) for (const g of liberalStudiesGroupsOf(c, "fa2024")) (membersOf[g] ??= []).push(c.id);
    expect(evaluateStandaloneRow(liberalStudiesRow("fa2024", membersOf), board).proven).toBe(false);
    const out = applyLiberalStudies({ courses: board, requirements, assignment: matcher, canonical: (id) => id, cohort: "fa2024" })!;
    expect(out.row.status).toBe("partial");
    expect(out.row.coursesHave).toBe(6);
    expect(out.row.creditsHave).toBeGreaterThanOrEqual(18);
    expect(out.row.missingCategories).toEqual(["g7"]);
    const ls = out.assignment.matched.filter((m) => m.requirementId === LS_POOL.id).map((m) => m.courseId);
    expect(ls.length).toBe(6);
    expect(ls.every((id) => pool.includes(id))).toBe(true);
    const all = out.assignment.matched.map((m) => m.courseId);
    expect(new Set(all).size).toBe(all.length);
  });

  it("a pool too large to prove keeps every course, counted plainly and never met", () => {
    const orig = {
      matched: board.map((c) => ({ courseId: c.id, requirementId: LS_POOL.id, credits: c.credits })),
      missing: [],
      uncounted: [],
      creditsSatisfied: 0,
      creditsRequired: 24,
      pct: 0,
    };
    const out = applyLiberalStudies({ courses: board, requirements: [LS_POOL], assignment: orig, canonical: (id) => id, cohort: "fa2024" })!;
    expect(out.row.proven).toBe(false);
    expect(out.row.status).toBe("partial");
    expect(out.row.counted).toEqual(board.map((c) => c.id));
    expect(out.row.fraction).toBeLessThan(1);
    expect(out.row.missingCategories).toEqual(["g7"]);
    expect(Object.keys(out.row.categoryOf)).toHaveLength(32);
    expect(Object.values(out.row.categoryOf).filter((g) => g === "g6").length).toBeLessThanOrEqual(2);
    expect(out.assignment.matched.filter((m) => m.requirementId === LS_POOL.id)).toHaveLength(32);
  });
});

// ─── The group's text in the program files (audit F6) ────────────────────────

describe("program files — the liberal studies group's text", () => {
  type Group = { id: string; description?: string | null; notes?: string | null };
  const docs: { id: string; electiveGroups?: Group[] }[] = [
    ...(legacy as { id: string; electiveGroups?: Group[] }[]),
    ...readdirSync(join(seedDir(), "programs-2025"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(seedDir(), "programs-2025", f), "utf-8"))),
  ];
  const groups = docs.flatMap((d) => (d.electiveGroups ?? []).filter((g) => g.id === "liberal-studies").map((g) => ({ program: d.id, g })));

  it("all 13 Engineering programs state the group rules, the same way", () => {
    expect(groups).toHaveLength(13);
    const RULE =
      "Six courses, at least 18 credits, from at least 3 of Engineering's 7 groups. Started in Fall 2024 or later: at least 3 credits from Group 7, Race and Equity. At most 2 Communications in Engineering courses count; at least 2 courses must be at the 2000 level or above. A course's class roster category, or Engineering's approved petitions list, decides its group.";
    for (const { program, g } of groups) {
      expect(g.notes?.startsWith(RULE), program).toBe(true);
      expect(g.notes!.length, program).toBeLessThanOrEqual(500);
      expect(g.notes, program).not.toMatch(/outside engineering/i);
      expect(g.description, program).toBe("Six courses and 18 credits from Engineering's seven liberal studies groups.");
    }
  });
});

// ─── Board order doesn't change the verdict (audit G1) ───────────────────────

function loadProgram(id: string) {
  const own = join(seedDir(), "programs-2025", `${id}.json`);
  const doc = existsSync(own) ? JSON.parse(readFileSync(own, "utf-8")) : legacy.find((p) => p.id === id);
  if (!doc) throw new Error(`no program ${id}`);
  return normalizeProgramSlots(ProgramSchema.parse(doc));
}

describe("computeRequirementProgress — a Group 7 course in a CS or EAS elective pool", () => {
  const SIX_NON_G7: BoardCourse[] = [
    ["ENGL-2800", 3, ["CA-AG", "LA-AG", "ALC-AS"]],
    ["HIST-1530", 3, ["HA-AG", "HST-AS"]],
    ["PHIL-2410", 3, ["KCM-AG", "ETM-AS"]],
    ["ECON-1110", 3, ["SBA-AG", "SSC-AS"]],
    ["ECON-1120", 3, ["SBA-AG", "SSC-AS"]],
    ["GOVT-1111", 3, ["SBA-AG", "SSC-AS"]],
  ];
  const G7: BoardCourse = ["ASRC-2650", 3, ["SCD-AS", "D-AG"]];
  const AEM: BoardCourse[] = [
    ["AEM-2400", 4, []],
    ["AEM-2500", 4, []],
  ];
  const verdict = (programId: string, board: BoardCourse[]) => {
    const slots = loadProgram(programId);
    const placedCourses: Record<string, Course> = {};
    const placements: Placement[] = board.map(([courseId, credits, tags], i) => {
      placedCourses[courseId] = course(courseId, credits, tags);
      return { id: `p-${courseId}`, courseId, sem: 1 + Math.floor((i * 8) / board.length), order: i };
    });
    const items = computeRequirementProgress({
      templateSlots: slots,
      placements,
      placedCourses,
      creditProfile: [],
      waivedRequirementIds: [],
      canonical: (id) => id,
      entryTerm: "FA25",
    }).groups.flatMap((g) => g.items);
    expectNoDoubleCount(items);
    const ls = items.find((i) => i.id === "liberal-studies")!;
    return { status: ls.status, missing: chips(ls).missing, others: items.filter((i) => i.id !== "liberal-studies").map((i) => `${i.id}:${i.status}`) };
  };

  for (const programId of ["cornell-cs-bs-2026", "cornell-eas-bs-2025"]) {
    it(`${programId}: met whether the Group 7 course is placed first or last`, () => {
      const last = verdict(programId, [...SIX_NON_G7, G7, ...AEM]);
      const first = verdict(programId, [G7, ...SIX_NON_G7, ...AEM]);
      expect(last.status).toBe("satisfied");
      expect(first.status).toBe("satisfied");
      expect(first.missing).toEqual([]);
      // Every other requirement reads the same either way.
      expect(first.others).toEqual(last.others);
    });
  }
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

  // Audit F4 + G3: an unmet row says what it needs and isn't credited in full.
  it("an unmet row is credited its fraction, and its missing line names the groups", () => {
    const b = poolOf(STUDENT_B);
    const mb = rankProgram(program, { slots: ORE }, { pool: b, canonical, display: buildCourseDisplay(b, canonical), ctx: { entryTerm: "FA25" } })!;
    const credited = mb.matched.filter((m) => m.requirementId === "liberal-studies").reduce((s, m) => s + m.credits, 0);
    // Student B has six courses and 19 credits, but the row is partial.
    expect(credited).toBeLessThan(18);
    expect(credited).toBeGreaterThan(0);
    const ls = mb.missing.find((m) => m.requirementId === "liberal-studies")!;
    expect(ls.courses).toBeUndefined();
    expect(ls.detail).toBe("needs 1 more group, Race & Equity");
    expect(ls.credits).toBe(18 - credited);
    expect(mb.creditsSatisfied).toBe(mb.matched.reduce((s, m) => s + m.credits, 0));
    // Met: credited in full, nothing missing.
    const a = poolOf(STUDENT_A);
    const ma = rankProgram(program, { slots: ORE }, { pool: a, canonical, display: buildCourseDisplay(a, canonical), ctx: { entryTerm: "FA25" } })!;
    expect(ma.matched.filter((m) => m.requirementId === "liberal-studies").reduce((s, m) => s + m.credits, 0)).toBe(18);
  });

  it("the missing line for a row short only on credits, or only on the 2000 level", () => {
    const outcome = (row: Partial<StandaloneRowResult>) =>
      liberalStudiesShortfall({
        assignment: { matched: [], missing: [], uncounted: [], creditsSatisfied: 0, creditsRequired: 0, pct: 0 },
        row: {
          status: "partial",
          counted: [],
          categoryOf: {},
          categoriesHave: ["g1", "g2", "g7"],
          missingCategories: [],
          coursesHave: 6,
          coursesNeed: 6,
          creditsHave: 18,
          creditsNeed: 18,
          fraction: 0.9,
          proven: true,
          ...row,
        },
        cohort: "fa2024",
        cohortUnknown: false,
        olderPolicy: false,
        requirementId: "liberal-studies",
      });
    expect(outcome({ creditsHave: 16 })).toBe("needs 2 more credits");
    expect(outcome({ creditsHave: 17 })).toBe("needs 1 more credit");
    expect(outcome({})).toBe("needs 2 courses at the 2000 level or higher");
    expect(outcome({ categoriesHave: ["g1"], missingCategories: ["g2", "g3", "g4", "g5", "g6", "g7"] })).toBe(
      "needs 2 more groups, Race & Equity"
    );
    expect(outcome({ status: "met", fraction: 1 })).toBeNull();
  });

  // Audit F1: Major Match builds its pool as the Requirements panel does.
  const boardOf = (board: BoardCourse[]) => {
    const placedCourses: Record<string, Course> = {};
    const placements: Placement[] = board.map(([id, cr, tags, sem], i) => {
      placedCourses[id] = course(id, cr, tags);
      return { id: `p${i}`, courseId: id, sem: sem ?? 3, order: i };
    });
    return { placements, placedCourses };
  };
  const lsIds = (pool: MatchCourse[], ctx: { entryTerm: string | null }, enteringYear?: number | null) =>
    rankProgram(program, { slots: ORE }, { pool, canonical, display: buildCourseDisplay(pool, canonical), ctx, enteringYear })!
      .matched.filter((m) => m.requirementId === "liberal-studies")
      .map((m) => m.courseId);

  it("a dated petition counts for a placement in Spring 2024 (the entering year dates the board)", () => {
    // Entered Fall 2023: semester 2 is Spring 2024, inside ART 1500's approval.
    const { placements, placedCourses } = boardOf([...STUDENT_A.filter((c) => c[0] !== "ENGL-2800"), ["ART-1500", 3, [], 2]]);
    const pool = engineeringMatchPool({ placements, placedCourses, creditProfile: [], enteringYear: 2023, entryTerm: "FA23" });
    expect(lsIds(pool, { entryTerm: "FA23" }, 2023)).toContain("ART-1500");
    // The entry term alone dates the board too.
    const byTerm = engineeringMatchPool({ placements, placedCourses, creditProfile: [], entryTerm: "FA23" });
    expect(lsIds(byTerm, { entryTerm: "FA23" })).toContain("ART-1500");
    // The pool the hook built before: no terms, so the petition never applied.
    const undated = buildMatchPool({ placements, placedCourses, creditProfile: [] });
    expect(lsIds(undated, { entryTerm: "FA23" }, 2023)).not.toContain("ART-1500");
  });

  it("transfer credit naming HIST 1540 counts through the catalog's tags", () => {
    const { placements, placedCourses } = boardOf(STUDENT_A.filter((c) => c[0] !== "HIST-1540"));
    const creditProfile = [
      { id: "transfer:hist", kind: "transfer" as const, label: "Transfer: US History", satisfiesCourseIds: ["HIST-1540"], credits: 4 },
    ];
    const tags: Record<string, string[]> = { "HIST-1540": ["HA-AG", "D-AG", "HST-AS", "SCD-AS"] };
    const pool = engineeringMatchPool({ placements, placedCourses, creditProfile, entryTerm: "FA25", catalogAttrs: (id) => tags[id] });
    const m = rankProgram(program, { slots: ORE }, { pool, canonical, display: buildCourseDisplay(pool, canonical), ctx: { entryTerm: "FA25" } })!;
    expect(m.matched.filter((x) => x.requirementId === "liberal-studies").map((x) => x.courseId)).toContain("HIST-1540");
    expect(m.missing.some((x) => x.requirementId === "liberal-studies")).toBe(false);
    // Without the catalog's tags (the hook's old pool) the credit carries none.
    const bare = buildMatchPool({ placements, placedCourses, creditProfile });
    expect(lsIds(bare, { entryTerm: "FA25" })).not.toContain("HIST-1540");
  });
});
