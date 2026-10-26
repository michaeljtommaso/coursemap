import { describe, it, expect } from "vitest";
import { verifyAssignment } from "./verify";
import type {
  CountedCourse,
  DistCourse,
  DistributionResult,
  Layer,
  LayerResult,
  Row,
  RowResult,
  RowStatus,
  SolveInput,
  VerifyReport,
} from "./types";

// Every result here is built by hand: the checker is tested without a solver.

const source = { url: "https://catalog.cornell.edu/", anchor: "requirements" };

const course = (id: string, credits: number, tags: string[] = [], over: Partial<DistCourse> = {}): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits, attrs: tags.map((value) => ({ value })), ...over };
};

const cc = (courseId: string, credits: number, categories?: string[]): CountedCourse =>
  categories ? { courseId, credits, categories } : { courseId, credits };

const rr = (
  layerId: string,
  row: Row,
  status: RowStatus,
  courses: CountedCourse[] = [],
  extra: Partial<RowResult> = {}
): RowResult => ({
  layerId,
  rowId: row.id,
  kind: row.kind,
  label: row.label,
  group: row.group,
  status,
  courses,
  progress: {},
  fraction: status === "met" ? 1 : 0,
  ...extra,
});

/** Fills attribution and uncounted from the row results (what a correct solver would emit). */
function finish(input: SolveInput, layers: LayerResult[]): DistributionResult {
  const canonical = input.canonical ?? ((id: string) => id);
  const attribution: DistributionResult["attribution"] = {};
  for (const l of layers) {
    for (const r of l.rows) {
      for (const c of r.courses) (attribution[c.courseId] ??= []).push({ layerId: l.layerId, rowId: r.rowId });
    }
  }
  const ids = [...new Set(input.courses.map((c) => canonical(c.id)))];
  return {
    layers,
    attribution,
    uncounted: ids.filter((id) => !attribution[id]),
    pct: 0,
    nodes: 0,
    capped: false,
    verifyLog: [],
  };
}

/** Re-derives attribution/uncounted after a corruption, so only the targeted claim is wrong. */
const refresh = (input: SolveInput, result: DistributionResult) => finish(input, result.layers);

const has = (report: VerifyReport, rowId: string, text: string) =>
  report.rejections.some((r) => r.rowId === rowId && r.reason.includes(text));

const findRow = (result: DistributionResult, layerId: string, rowId: string): RowResult => {
  const row = result.layers.find((l) => l.layerId === layerId)?.rows.find((r) => r.rowId === rowId);
  if (!row) throw new Error(`no row ${layerId}:${rowId}`);
  return row;
};

// ─── Base scenario: a CAS college layer plus a History major layer ──────────

const CAS = "cas-college";
const HIST = "hist-ba";

const fws: Row = {
  id: "fws",
  label: "First-Year Writing Seminars",
  group: "Writing",
  source,
  kind: "seat",
  exclusive: true,
  rule: { titleStartsWith: "FWS:" },
};
const dist: Row = {
  id: "dist",
  label: "Distribution",
  group: "Distribution",
  source,
  kind: "distribution",
  rule: { not: { creditKind: ["ap", "ib", "transfer", "placement"] } },
  categories: [
    { id: "alc", label: "ALC", rule: { tag: ["ALC-AS"] } },
    { id: "etm", label: "ETM", rule: { tag: ["ETM-AS"] } },
    { id: "hst", label: "HST", rule: { tag: ["HST-AS"] } },
    { id: "scd", label: "SCD", rule: { tag: ["SCD-AS"] } },
    { id: "ssc", label: "SSC", rule: { tag: ["SSC-AS"] } },
  ],
  requiredCourses: 4,
  minDistinctCategories: 5,
  maxCategoriesPerCourse: 2,
  maxDoubleCountCourses: 2,
};
const language: Row = {
  id: "language",
  label: "Language",
  group: "Language",
  source,
  kind: "anyOf",
  overlay: true,
  rows: [
    {
      id: "opt1",
      label: "One course at 2000+",
      group: "Language",
      source,
      kind: "seat",
      rule: { allOf: [{ subject: ["SPAN", "FREN"] }, { number: { min: 2000 } }] },
    },
    {
      id: "opt2",
      label: "11 credits in one language",
      group: "Language",
      source,
      kind: "credits",
      rule: { subject: ["SPAN", "FREN"] },
      requiredCredits: 11,
      sameSubject: true,
    },
  ],
};
const total: Row = {
  id: "total",
  label: "Credits outside mathematics",
  group: "Credits",
  source,
  kind: "credits",
  rule: { not: { subject: ["MATH"] } },
  requiredCredits: 120,
};
const letter: Row = { id: "letter", label: "Letter-graded credits", group: "Credits", source, kind: "confirm" };
const pe: Row = { id: "pe", label: "Physical education", group: "Other", source, kind: "seat", rule: { subject: ["PE"] } };
const oldReq: Row = {
  id: "old-req",
  label: "Pre-2025 requirement",
  group: "Other",
  source,
  kind: "pool",
  rule: { tag: ["GLC-AS"] },
  requiredCourses: 1,
  requiredCredits: 3,
  appliesTo: [{ enteredBefore: "FA25" }],
};
const newReq: Row = {
  id: "new-req",
  label: "Global citizenship",
  group: "Other",
  source,
  kind: "seat",
  rule: { tag: ["GLC-AS"] },
  appliesTo: [{ enteredFrom: "FA25" }],
};
const transferReq: Row = {
  id: "transfer-req",
  label: "Transfer residency",
  group: "Other",
  source,
  kind: "seat",
  rule: { tag: ["GLC-AS"] },
  appliesTo: [{ transfer: ["external", "internal"] }],
};
const core: Row = {
  id: "core",
  label: "History core",
  group: "Core",
  source,
  kind: "pool",
  rule: { subject: ["HIST"] },
  requiredCourses: 2,
  requiredCredits: 8,
  limits: [{ rule: { number: { min: 2000 } }, minCourses: 1, label: "one course at 2000+" }],
};
const writing: Row = {
  id: "writing",
  label: "Literature course",
  group: "Core",
  source,
  kind: "seat",
  rule: { tag: ["ALC-AS"] },
};
const histAny: Row = {
  id: "hist-any",
  label: "Any history course",
  group: "Core",
  source,
  kind: "seat",
  rule: { subject: ["HIST"] },
};

const casLayer: Layer = {
  id: CAS,
  kind: "college",
  family: "cas",
  name: "College of Arts and Sciences",
  catalogYear: "2026-27",
  rows: [fws, dist, language, total, letter, pe, oldReq, newReq, transferReq],
};
const histLayer: Layer = {
  id: HIST,
  kind: "major",
  family: "cas",
  name: "History",
  catalogYear: "2026-27",
  programId: HIST,
  rows: [core, writing, histAny],
};

function base(): { input: SolveInput; result: DistributionResult } {
  const input: SolveInput = {
    layers: [casLayer, histLayer],
    courses: [
      course("ENGL-1170", 3, ["ALC-AS"], { title: "FWS: Short Stories" }),
      course("HIST-1530", 3, ["HST-AS", "SCD-AS"]),
      course("ENGL-2010", 4, ["ALC-AS"]),
      course("GOVT-1111", 4, ["SSC-AS"]),
      course("PHIL-1100", 4, ["ETM-AS"]),
      course("HIST-2500", 4, ["HST-AS"]),
      course("SPAN-1210", 4),
      course("SPAN-1220", 4),
      course("SPAN-2090", 3),
      course("FREN-1220", 4),
      // Cross-listed with HIST-1530; its 4 credits win after dedupe.
      course("AMST-1530", 4, ["HST-AS", "SCD-AS"]),
      course("MATH-1110", 4, ["SMR-AS"]),
    ],
    ctx: { programId: HIST, entryTerm: "FA25", transfer: "none" },
    waived: [`${CAS}:pe`],
    canonical: (id) => (id === "AMST-1530" ? "HIST-1530" : id),
  };

  const totalCourses = [
    cc("HIST-1530", 4),
    cc("ENGL-2010", 4),
    cc("GOVT-1111", 4),
    cc("PHIL-1100", 4),
    cc("HIST-2500", 4),
    cc("SPAN-1210", 4),
    cc("SPAN-1220", 4),
    cc("SPAN-2090", 3),
    cc("FREN-1220", 4),
  ];
  const lang = language as Extract<Row, { kind: "anyOf" }>;
  const layers: LayerResult[] = [
    {
      layerId: CAS,
      kind: "college",
      name: casLayer.name,
      rows: [
        rr(CAS, fws, "met", [cc("ENGL-1170", 3)], { progress: { coursesHave: 1, coursesNeed: 1 } }),
        rr(
          CAS,
          dist,
          "met",
          [
            cc("HIST-1530", 4, ["hst", "scd"]),
            cc("ENGL-2010", 4, ["alc"]),
            cc("GOVT-1111", 4, ["ssc"]),
            cc("PHIL-1100", 4, ["etm"]),
          ],
          { progress: { coursesHave: 4, coursesNeed: 4, categoriesHave: ["hst", "scd", "alc", "ssc", "etm"] } }
        ),
        rr(CAS, language, "met", [cc("SPAN-2090", 3)], {
          children: [
            rr(CAS, lang.rows[0], "met", [cc("SPAN-2090", 3)]),
            rr(CAS, lang.rows[1], "met", [cc("SPAN-1210", 4), cc("SPAN-1220", 4), cc("SPAN-2090", 3)], {
              progress: { creditsHave: 11, creditsNeed: 11 },
            }),
          ],
        }),
        rr(CAS, total, "partial", totalCourses, { progress: { creditsHave: 35, creditsNeed: 120 } }),
        rr(CAS, letter, "confirm"),
        rr(CAS, pe, "waived"),
        rr(CAS, newReq, "unmet"),
      ],
    },
    {
      layerId: HIST,
      kind: "major",
      name: histLayer.name,
      rows: [
        rr(HIST, core, "met", [cc("HIST-1530", 4), cc("HIST-2500", 4)], {
          progress: { coursesHave: 2, creditsHave: 8, creditsNeed: 8 },
        }),
        rr(HIST, writing, "met", [cc("ENGL-2010", 4)]),
        rr(HIST, histAny, "unmet"),
      ],
    },
  ];
  return { input, result: finish(input, layers) };
}

describe("verifyAssignment — valid hand-built results", () => {
  it("accepts the base scenario (seat, distribution, anyOf, overlay credits, confirm, waived, appliesTo)", () => {
    const { input, result } = base();
    expect(verifyAssignment(input, result)).toEqual({ ok: true, rejections: [] });
    expect(result.uncounted).toEqual(["MATH-1110"]);
  });

  it("allows one course to count once in each layer", () => {
    const { input, result } = base();
    expect(result.attribution["HIST-1530"]).toEqual([
      { layerId: CAS, rowId: "dist" },
      { layerId: CAS, rowId: "total" },
      { layerId: HIST, rowId: "core" },
    ]);
    expect(verifyAssignment(input, result).ok).toBe(true);
  });

  it("does not judge optimality: a provable row reported partial is fine", () => {
    const { input, result } = base();
    findRow(result, HIST, "core").status = "partial";
    expect(verifyAssignment(input, result).ok).toBe(true);
  });

  it("lets an overlay pool share courses with a consuming row in the same layer", () => {
    const shared: Row = { ...core, id: "shared", overlay: true, limits: undefined };
    const layer: Layer = { ...histLayer, rows: [core, shared] };
    const input: SolveInput = {
      layers: [layer],
      courses: [course("HIST-1530", 4, ["HST-AS"]), course("HIST-2500", 4, ["HST-AS"])],
      ctx: { programId: HIST },
    };
    const both = [cc("HIST-1530", 4), cc("HIST-2500", 4)];
    const result = finish(input, [
      { layerId: HIST, kind: "major", name: "History", rows: [rr(HIST, core, "met", both), rr(HIST, shared, "met", both)] },
    ]);
    expect(verifyAssignment(input, result)).toEqual({ ok: true, rejections: [] });
  });
});

describe("verifyAssignment — per-course claims", () => {
  it("rejects a course not in the input", () => {
    const { input, result } = base();
    findRow(result, CAS, "new-req").courses = [cc("CHEM-2070", 4)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(report.ok).toBe(false);
    expect(has(report, "new-req", "course CHEM-2070 is not among the student's courses")).toBe(true);
  });

  it("rejects a course that fails the row rule", () => {
    const { input, result } = base();
    findRow(result, HIST, "writing").courses = [cc("GOVT-1111", 4)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "writing", "course GOVT-1111 does not match the row rule")).toBe(true);
    expect(has(report, "writing", "claims met but counts no qualifying course")).toBe(true);
  });

  it("rejects an invalid course on a partial row too", () => {
    const { input, result } = base();
    findRow(result, CAS, "total").courses.push(cc("MATH-1110", 4));
    findRow(result, CAS, "total").progress = {};
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "total", "course MATH-1110 does not match the row rule")).toBe(true);
  });

  it("rejects a course claiming a category it lacks", () => {
    const { input, result } = base();
    findRow(result, CAS, "dist").courses[1] = cc("ENGL-2010", 4, ["alc", "hst"]);
    findRow(result, CAS, "dist").progress = {};
    const report = verifyAssignment(input, result);
    expect(has(report, "dist", "course ENGL-2010 claims category hst but does not match its rule")).toBe(true);
  });

  it("rejects an unknown category and a distribution course with no category", () => {
    const { input, result } = base();
    const row = findRow(result, CAS, "dist");
    row.progress = {};
    row.courses[2] = cc("GOVT-1111", 4, ["glc"]);
    row.courses[3] = cc("PHIL-1100", 4, []);
    const report = verifyAssignment(input, result);
    expect(has(report, "dist", "course GOVT-1111 claims unknown category glc")).toBe(true);
    expect(has(report, "dist", "course PHIL-1100 counts toward no category")).toBe(true);
  });

  it("rejects a non-canonical id", () => {
    const { input, result } = base();
    findRow(result, HIST, "core").courses[0] = cc("AMST-1530", 4);
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "core", "course AMST-1530 is not a canonical id (expected HIST-1530)")).toBe(true);
  });

  it("rejects credits that ignore the max-credits dedupe of cross-listed ids", () => {
    const { input, result } = base();
    findRow(result, HIST, "core").courses[0] = cc("HIST-1530", 3);
    findRow(result, HIST, "core").progress = {};
    const report = verifyAssignment(input, result);
    expect(has(report, "core", "course HIST-1530 lists 3 credits but has 4 after dedupe")).toBe(true);
  });

  it("rejects a seat listing two courses", () => {
    const { input, result } = base();
    findRow(result, HIST, "writing").courses.push(cc("ENGL-1170", 3));
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "writing", "a seat counts one course but 2 are listed")).toBe(true);
  });
});

describe("verifyAssignment — counting across rows and layers", () => {
  it("rejects a course in two consuming rows of one layer", () => {
    const { input, result } = base();
    const row = findRow(result, HIST, "hist-any");
    row.status = "met";
    row.courses = [cc("HIST-2500", 4)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(report.ok).toBe(false);
    expect(has(report, "hist-any", "course HIST-2500 is already counted by consuming row core in this layer")).toBe(true);
  });

  it("rejects an exclusive course reused in another layer", () => {
    const { input, result } = base();
    findRow(result, HIST, "writing").courses = [cc("ENGL-1170", 3)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "writing", "course ENGL-1170 is counted by exclusive row cas-college:fws")).toBe(true);
  });

  it("accepts an exclusive course in a credit total (its credits still count toward the degree)", () => {
    const { input, result } = base();
    findRow(result, CAS, "total").courses.push(cc("ENGL-1170", 3));
    findRow(result, CAS, "total").progress = {};
    const report = verifyAssignment(input, refresh(input, result));
    expect(report.rejections.filter((r) => r.rowId === "total")).toEqual([]);
  });

  it("rejects an exclusive course reused by an overlay row that is not a credit total", () => {
    const { input, result } = base();
    const overlay: Row = { ...pe, id: "overlay-seat", overlay: true, rule: { titleStartsWith: "FWS:" } };
    input.layers[0] = { ...input.layers[0], rows: [...input.layers[0].rows, overlay] };
    result.layers[0].rows.push({
      layerId: CAS,
      rowId: "overlay-seat",
      kind: "seat",
      label: overlay.label,
      group: overlay.group,
      status: "met",
      courses: [cc("ENGL-1170", 3)],
      progress: {},
      fraction: 1,
    });
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "overlay-seat", "course ENGL-1170 is counted by exclusive row cas-college:fws")).toBe(true);
  });
});

describe("verifyAssignment — met proofs", () => {
  // CALS written expression: 9 credits, at least 6 WRT-AG credits, at most 1 ORL-AG course.
  const written: Row = {
    id: "written",
    label: "Written and oral expression",
    group: "Distribution",
    source,
    kind: "pool",
    rule: { tag: ["WRT-AG", "ORL-AG"] },
    requiredCourses: 3,
    requiredCredits: 9,
    maxPerSubject: 2,
    limits: [
      { rule: { tag: ["WRT-AG"] }, minCredits: 6, label: "6 credits WRT" },
      { rule: { tag: ["ORL-AG"] }, maxCourses: 1, label: "one ORL course" },
    ],
  };
  const calsCourses = [
    course("ENGL-1105", 3, ["WRT-AG"]),
    course("COMM-2010", 3, ["ORL-AG"]),
    course("COMM-2760", 3, ["ORL-AG"]),
    course("WRIT-1340", 3, ["WRT-AG"]),
    course("ENGL-2880", 3, ["WRT-AG"]),
    course("ENGL-2890", 3, ["WRT-AG"]),
  ];
  const calsLayer = (rows: Row[]): Layer => ({
    id: "cals-college-2025",
    kind: "college",
    family: "cals",
    name: "CALS",
    catalogYear: "2026-27",
    rows,
  });
  const solo = (row: Row, status: RowStatus, courses: CountedCourse[], courses2 = calsCourses) => {
    const layer = calsLayer([row]);
    const input: SolveInput = { layers: [layer], courses: courses2, ctx: { programId: "ansc", entryTerm: "FA25" } };
    const result = finish(input, [
      { layerId: layer.id, kind: "college", name: layer.name, rows: [rr(layer.id, row, status, courses)] },
    ]);
    return verifyAssignment(input, result);
  };

  it("accepts a pool that honours its limits and subject cap", () => {
    const report = solo(written, "met", [cc("ENGL-1105", 3), cc("WRIT-1340", 3), cc("COMM-2010", 3)]);
    expect(report).toEqual({ ok: true, rejections: [] });
  });

  it("rejects a pool one course short", () => {
    const report = solo({ ...written, requiredCredits: 6 }, "met", [cc("ENGL-1105", 3), cc("WRIT-1340", 3)]);
    expect(report.rejections).toEqual([
      { layerId: "cals-college-2025", rowId: "written", reason: "claims met but counts 2 of 3 required courses" },
    ]);
  });

  it("rejects a pool one credit short", () => {
    const report = solo({ ...written, requiredCredits: 10 }, "met", [
      cc("ENGL-1105", 3),
      cc("WRIT-1340", 3),
      cc("COMM-2010", 3),
    ]);
    expect(has(report, "written", "counts 9 of 10 required credits")).toBe(true);
  });

  it("rejects a pool that breaks its sub-limits", () => {
    const report = solo(written, "met", [cc("ENGL-1105", 3), cc("COMM-2010", 3), cc("COMM-2760", 3)]);
    expect(has(report, "written", 'limit "6 credits WRT" needs at least 6 credits, has 3')).toBe(true);
    expect(has(report, "written", 'limit "one ORL course" allows at most 1 courses, has 2')).toBe(true);
  });

  it("rejects a pool over its per-subject cap", () => {
    const report = solo(written, "met", [cc("ENGL-1105", 3), cc("ENGL-2880", 3), cc("ENGL-2890", 3)]);
    expect(has(report, "written", "counts 3 ENGL courses (max 2 per department)")).toBe(true);
  });

  it("applies the cap per department when subjects are grouped", () => {
    const grouped = { ...written, subjectGroups: [["ENGL", "COMM"]] } as Row;
    const report = solo(grouped, "met", [cc("ENGL-1105", 3), cc("ENGL-2880", 3), cc("COMM-2010", 3)]);
    expect(has(report, "written", "counts 3 ENGL/COMM courses (max 2 per department)")).toBe(true);
    const ungrouped = solo(written, "met", [cc("ENGL-1105", 3), cc("ENGL-2880", 3), cc("COMM-2010", 3)]);
    expect(has(ungrouped, "written", "per department")).toBe(false);
  });

  it("rejects a credits row whose sum is short", () => {
    const { input, result } = base();
    findRow(result, CAS, "total").status = "met";
    const report = verifyAssignment(input, result);
    expect(has(report, "total", "claims met but counts 35 of 120 required credits")).toBe(true);
  });

  it("rejects a single-subject credits option that mixes subjects", () => {
    const { input, result } = base();
    const opt2 = findRow(result, CAS, "language").children![1];
    opt2.courses = [cc("SPAN-1210", 4), cc("FREN-1220", 4), cc("SPAN-2090", 3)];
    const report = verifyAssignment(input, result);
    expect(has(report, "language", "option opt2: claims met but mixes subjects SPAN, FREN")).toBe(true);
  });

  it("rejects an option whose credits are short even when the parent is met by another option", () => {
    const { input, result } = base();
    const opt2 = findRow(result, CAS, "language").children![1];
    opt2.courses = [cc("SPAN-1210", 4), cc("SPAN-2090", 3)];
    opt2.progress = {};
    const report = verifyAssignment(input, result);
    expect(report.rejections).toEqual([
      { layerId: CAS, rowId: "language", reason: "option opt2: claims met but counts 7 of 11 required credits" },
    ]);
  });

  it("rejects an anyOf claiming met with no met option", () => {
    const { input, result } = base();
    const row = findRow(result, CAS, "language");
    row.children![0].status = "unmet";
    row.children![0].courses = [];
    row.children![1].status = "partial";
    row.children![1].courses = [cc("SPAN-1210", 4), cc("SPAN-2090", 3)];
    row.children![1].progress = {};
    row.courses = [cc("SPAN-1210", 4), cc("SPAN-2090", 3)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "language", "claims met but no option re-proves as met")).toBe(true);
  });

  it("rejects an anyOf whose courses are not the met option's", () => {
    const { input, result } = base();
    findRow(result, CAS, "language").courses = [cc("SPAN-1210", 4)];
    const report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "language", "its courses match no option's courses")).toBe(true);
  });

  it("rejects 3 double-counted courses when the budget is 2", () => {
    const row: Row = { ...(dist as Extract<Row, { kind: "distribution" }>), requiredCourses: 3, minDistinctCategories: 4 };
    const layer: Layer = { ...casLayer, rows: [row] };
    const input: SolveInput = {
      layers: [layer],
      courses: [
        course("ASIAN-2208", 4, ["ALC-AS", "HST-AS"]),
        course("AMST-2001", 4, ["HST-AS", "SCD-AS"]),
        course("GOVT-2225", 4, ["SCD-AS", "SSC-AS"]),
      ],
      ctx: { programId: "govt-ba" },
    };
    const mk = (doubles: number) => {
      const cats = [
        ["alc", "hst"],
        ["hst", "scd"],
        ["ssc", "scd"],
      ].map((c, i) => (i < doubles ? c : c.slice(0, 1)));
      return finish(input, [
        {
          layerId: CAS,
          kind: "college",
          name: "CAS",
          rows: [
            rr(CAS, row, "met", [
              cc("ASIAN-2208", 4, cats[0]),
              cc("AMST-2001", 4, cats[1]),
              cc("GOVT-2225", 4, cats[2]),
            ]),
          ],
        },
      ]);
    };
    expect(verifyAssignment(input, mk(2)).ok).toBe(true);
    const report = verifyAssignment(input, mk(3));
    expect(report.rejections).toEqual([
      { layerId: CAS, rowId: "dist", reason: "claims met but 3 courses fill more than one category (max 2)" },
    ]);
  });

  it("rejects a course filling more categories than allowed, and too few distinct categories", () => {
    const row: Row = {
      ...(dist as Extract<Row, { kind: "distribution" }>),
      maxCategoriesPerCourse: 1,
      requiredCourses: 1,
      minDistinctCategories: 3,
    };
    const layer: Layer = { ...casLayer, rows: [row] };
    const input: SolveInput = {
      layers: [layer],
      courses: [course("HIST-1530", 4, ["HST-AS", "SCD-AS"])],
      ctx: { programId: HIST },
    };
    const result = finish(input, [
      { layerId: CAS, kind: "college", name: "CAS", rows: [rr(CAS, row, "met", [cc("HIST-1530", 4, ["hst", "scd"])])] },
    ]);
    const report = verifyAssignment(input, result);
    expect(has(report, "dist", "course HIST-1530 fills 2 categories (max 1 per course)")).toBe(true);
    expect(has(report, "dist", "fills 2 of 3 required categories")).toBe(true);
  });

  it("enforces a per-category max (CALS: max 1 each)", () => {
    const humanities: Row = {
      id: "humanities",
      label: "Humanities and social sciences",
      group: "Distribution",
      source,
      kind: "distribution",
      categories: [
        { id: "ca", label: "CA", rule: { tag: ["CA-AG"] } },
        { id: "ha", label: "HA", rule: { tag: ["HA-AG"] } },
        { id: "la", label: "LA", rule: { tag: ["LA-AG"] } },
        { id: "d", label: "D", rule: { tag: ["D-AG"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
      perCategory: { ca: { max: 1 }, ha: { max: 1 }, la: { max: 1 }, d: { min: 0 } },
    };
    const courses = [course("ARTH-1100", 3, ["CA-AG"]), course("DSOC-1101", 3, ["CA-AG", "D-AG"]), course("HIST-1200", 3, ["HA-AG"])];
    expect(solo(humanities, "met", [cc("ARTH-1100", 3, ["ca"]), cc("HIST-1200", 3, ["ha"])], courses).ok).toBe(true);
    const report = solo(humanities, "met", [cc("ARTH-1100", 3, ["ca"]), cc("DSOC-1101", 3, ["ca"])], courses);
    expect(has(report, "humanities", "category ca has 2 courses (max 1)")).toBe(true);
    expect(has(report, "humanities", "fills 1 of 2 required categories")).toBe(true);
  });

  it("rejects a seat claiming met with no course", () => {
    const { input, result } = base();
    findRow(result, CAS, "new-req").status = "met";
    const report = verifyAssignment(input, result);
    expect(has(report, "new-req", "claims met but counts no qualifying course")).toBe(true);
  });
});

describe("verifyAssignment — confirm, waived and applicability", () => {
  it("rejects a met confirm row", () => {
    const { input, result } = base();
    findRow(result, CAS, "letter").status = "met";
    const report = verifyAssignment(input, result);
    expect(has(report, "letter", 'confirm row reports status met; only "confirm" is allowed')).toBe(true);
  });

  it("rejects a waived row with courses, and a waived row reported met", () => {
    const { input, result } = base();
    findRow(result, CAS, "pe").courses = [cc("MATH-1110", 4)];
    let report = verifyAssignment(input, refresh(input, result));
    expect(has(report, "pe", "waived row lists counted courses")).toBe(true);

    const b = base();
    findRow(b.result, CAS, "pe").status = "met";
    report = verifyAssignment(b.input, b.result);
    expect(has(report, "pe", "row is waived but reports status met")).toBe(true);
  });

  it("rejects a missing applicable row", () => {
    const { input, result } = base();
    result.layers[0].rows = result.layers[0].rows.filter((r) => r.rowId !== "new-req");
    const report = verifyAssignment(input, result);
    expect(report.rejections).toEqual([
      { layerId: CAS, rowId: "new-req", reason: "row applies to this student but is missing from the result" },
    ]);
  });

  it("rejects a row present though its appliesTo excludes the student", () => {
    const { input, result } = base();
    result.layers[0].rows.push(rr(CAS, oldReq, "unmet"), rr(CAS, transferReq, "unmet"));
    const report = verifyAssignment(input, result);
    expect(has(report, "old-req", "row is present but its appliesTo excludes this student")).toBe(true);
    expect(has(report, "transfer-req", "row is present but its appliesTo excludes this student")).toBe(true);
  });

  it("rejects a row that is not in the input layer", () => {
    const { input, result } = base();
    result.layers[1].rows.push(rr(HIST, { ...histAny, id: "invented" }, "unmet"));
    expect(has(verifyAssignment(input, result), "invented", "row is not in the input layer")).toBe(true);
  });

  // Entry-term boundaries: enteredFrom inclusive, enteredBefore exclusive,
  // terms ordered by year then WI < SP < SU < FA, unknown never matches.
  const before: Row = { ...newReq, id: "before", appliesTo: [{ enteredBefore: "FA25" }] };
  const from: Row = { ...newReq, id: "from", appliesTo: [{ enteredFrom: "FA25" }] };
  const window: Row = { ...newReq, id: "window", appliesTo: [{ enteredFrom: "SP25", enteredBefore: "SU25" }] };
  const either: Row = {
    ...newReq,
    id: "either",
    appliesTo: [{ enteredBefore: "SP24" }, { transferStanding: ["junior"], transfer: ["external"] }],
  };
  const termLayer: Layer = { ...casLayer, rows: [before, from, window, either] };
  const cases: [string, Partial<SolveInput["ctx"]>, string[]][] = [
    ["SU25 is before FA25", { entryTerm: "SU25" }, ["before"]],
    ["FA25 is the inclusive start", { entryTerm: "FA25" }, ["from"]],
    ["SP26 follows FA25 (year first)", { entryTerm: "SP26" }, ["from"]],
    ["SP25 is inside [SP25, SU25)", { entryTerm: "SP25" }, ["before", "window"]],
    ["WI25 sorts before SP25", { entryTerm: "WI25" }, ["before"]],
    ["FA23 matches the first OR clause", { entryTerm: "FA23" }, ["before", "either"]],
    ["unknown entry term matches no term clause", { entryTerm: null }, []],
    ["junior external transfer matches the second clause", { entryTerm: null, transfer: "external", transferStanding: "junior" }, ["either"]],
    ["unknown transfer never matches a transfer list", { entryTerm: null, transferStanding: "junior" }, []],
  ];
  for (const [name, ctx, present] of cases) {
    it(`applicability: ${name}`, () => {
      const input: SolveInput = { layers: [termLayer], courses: [], ctx: { programId: "x", ...ctx } };
      const rows = termLayer.rows.filter((r) => present.includes(r.id)).map((r) => rr(CAS, r, "unmet"));
      const good = finish(input, [{ layerId: CAS, kind: "college", name: "CAS", rows }]);
      expect(verifyAssignment(input, good)).toEqual({ ok: true, rejections: [] });

      // Every row flipped: each present row goes missing, each absent row appears.
      const flipped = termLayer.rows.filter((r) => !present.includes(r.id)).map((r) => rr(CAS, r, "unmet"));
      const bad = finish(input, [{ layerId: CAS, kind: "college", name: "CAS", rows: flipped }]);
      const report = verifyAssignment(input, bad);
      expect(report.rejections).toHaveLength(termLayer.rows.length);
    });
  }
});

describe("verifyAssignment — attribution, uncounted, layers, progress", () => {
  it("rejects attribution missing a row", () => {
    const { input, result } = base();
    result.attribution["HIST-1530"] = result.attribution["HIST-1530"].filter((a) => a.rowId !== "core");
    const report = verifyAssignment(input, result);
    expect(report.rejections).toEqual([
      { layerId: HIST, rowId: "core", reason: "attribution for HIST-1530 does not list this row" },
    ]);
  });

  it("rejects attribution naming a row that does not count the course (anyOf options are not attributed)", () => {
    const { input, result } = base();
    result.attribution["SPAN-1210"].push({ layerId: CAS, rowId: "language" });
    const report = verifyAssignment(input, result);
    expect(has(report, "language", "attribution lists SPAN-1210 for this row but the row does not count it")).toBe(true);
  });

  it("rejects a wrong uncounted list", () => {
    const { input, result } = base();
    result.uncounted = ["HIST-2500"];
    const report = verifyAssignment(input, result);
    expect(has(report, "*", "course MATH-1110 is counted by no row but missing from uncounted")).toBe(true);
    // Reported against the first row (in layer order) that counts it.
    expect(has(report, "total", "course HIST-2500 is counted by this row but also listed as uncounted")).toBe(true);
  });

  it("rejects layers out of order, missing or extra", () => {
    const { input, result } = base();
    result.layers.reverse();
    expect(has(verifyAssignment(input, result), "*", "layer order is hist-ba, cas-college, expected cas-college, hist-ba")).toBe(
      true
    );

    const b = base();
    b.result.layers = [b.result.layers[0], { ...b.result.layers[1], layerId: "econ-ba" }];
    const report = verifyAssignment(b.input, b.result);
    expect(report.rejections.some((r) => r.layerId === HIST && r.reason === "layer is missing from the result")).toBe(true);
    expect(report.rejections.some((r) => r.layerId === "econ-ba" && r.reason === "layer is not one of the input layers")).toBe(
      true
    );
  });

  it("rejects progress counts that disagree with the listed courses", () => {
    const { input, result } = base();
    findRow(result, CAS, "total").progress = { creditsHave: 40, creditsNeed: 120 };
    findRow(result, HIST, "core").progress = { coursesHave: 3 };
    const report = verifyAssignment(input, result);
    expect(has(report, "total", "progress reports 40 credits but the listed courses total 35")).toBe(true);
    expect(has(report, "core", "progress reports 3 courses but 2 are listed")).toBe(true);
  });

  it("never throws on a malformed result", () => {
    const { input } = base();
    const junk = [null, {}, { layers: "no" }, { layers: [null, { layerId: CAS, rows: [{ rowId: "fws", courses: "x" }] }] }];
    for (const j of junk) {
      const report = verifyAssignment(input, j as unknown as DistributionResult);
      expect(report.ok).toBe(false);
      expect(report.rejections.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate its inputs", () => {
    const { input, result } = base();
    const before = JSON.stringify({ ...input, canonical: undefined, result });
    verifyAssignment(input, result);
    expect(JSON.stringify({ ...input, canonical: undefined, result })).toBe(before);
  });
});

describe("verifyAssignment — counting groups (separate concentrations)", () => {
  const P = "bio-ba";
  const seatRow = (id: string, over: Partial<Row> = {}): Row =>
    ({ id, label: id, group: "G", source, kind: "seat", rule: { subject: ["BIO"] }, ...over }) as Row;
  const mk = (id: string, kind: Layer["kind"], rows: Row[], over: Partial<Layer> = {}): Layer => ({
    id,
    kind,
    family: "cas",
    name: id,
    catalogYear: "2026-27",
    programId: P,
    rows,
    ...over,
  });
  const BIO = course("BIO-1000", 3);
  const scenario = (opts: {
    conc: Partial<Layer>[];
    majorRow?: Row;
    concRow?: (i: number) => Row;
    omitMajor?: boolean;
  }) => {
    const majorRow = opts.majorRow ?? seatRow("m");
    const major = mk(P, "major", [majorRow]);
    const concs = opts.conc.map((o, i) => mk(`${P}--c${i}`, "concentration", [opts.concRow ? opts.concRow(i) : seatRow("k")], o));
    const layers = opts.omitMajor ? concs : [major, ...concs];
    const input: SolveInput = { layers, courses: [BIO], ctx: { programId: P, entryTerm: "FA25" } };
    const results: LayerResult[] = layers.map((l) => ({
      layerId: l.id,
      kind: l.kind,
      name: l.name,
      rows: l.rows.map((r) => rr(l.id, r, "met", [cc("BIO-1000", 3)])),
    }));
    return { input, result: finish(input, results) };
  };

  it("downgrades a course consumed by a major row and a separate concentration row", () => {
    const { input, result } = scenario({ conc: [{ courseSharing: "separate" }] });
    const report = verifyAssignment(input, result);
    expect(report.ok).toBe(false);
    expect(has(report, "k", "course BIO-1000 is already counted by consuming row bio-ba:m in the same counting group")).toBe(true);
  });

  it("accepts the same double use across a shared concentration", () => {
    for (const conc of [{ courseSharing: "shared" as const }, {}]) {
      const { input, result } = scenario({ conc: [conc] });
      expect(verifyAssignment(input, result)).toEqual({ ok: true, rejections: [] });
    }
  });

  it("joins two separate concentrations and the major into one group", () => {
    const { input, result } = scenario({ conc: [{ courseSharing: "separate" }, { courseSharing: "separate" }], majorRow: seatRow("m", { rule: { subject: ["NONE"] } }) });
    // major row lists nothing here: only the two concentrations collide
    result.layers[0].rows[0].courses = [];
    result.layers[0].rows[0].status = "unmet";
    const fixed = finish(input, result.layers);
    const report = verifyAssignment(input, fixed);
    expect(report.ok).toBe(false);
    expect(report.rejections.some((r) => r.layerId === `${P}--c1` && r.reason.includes("same counting group"))).toBe(true);
  });

  it("keeps a shared concentration independent of a separate sibling and the major", () => {
    const { input, result } = scenario({ conc: [{ courseSharing: "shared" }, { courseSharing: "separate" }] });
    // major + c0 (shared) + c1 (separate) all count BIO: c1 collides with the major only
    const report = verifyAssignment(input, result);
    expect(report.rejections.map((r) => r.layerId)).toEqual([`${P}--c1`]);
  });

  it("lets overlay and credits rows see a course a group member consumes", () => {
    const { input, result } = scenario({
      conc: [{ courseSharing: "separate" }],
      concRow: () => seatRow("k", { overlay: true }),
    });
    expect(verifyAssignment(input, result)).toEqual({ ok: true, rejections: [] });
    const credits = scenario({
      conc: [{ courseSharing: "separate" }],
      concRow: () => ({ id: "k", label: "k", group: "G", source, kind: "credits", rule: { subject: ["BIO"] }, requiredCredits: 3 }) as Row,
    });
    expect(verifyAssignment(credits.input, credits.result)).toEqual({ ok: true, rejections: [] });
  });

  it("treats a separate concentration whose major is not solved as independent", () => {
    const { input, result } = scenario({ conc: [{ courseSharing: "separate" }], omitMajor: true });
    expect(verifyAssignment(input, result)).toEqual({ ok: true, rejections: [] });
  });
});
