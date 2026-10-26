import { describe, it, expect, vi, afterEach } from "vitest";
import { countingGroups, DEFAULT_NODE_CAP, solveLayers, termKey } from "./engine";
import { calsPreMajorBoard, majorWithConcentrationBoard, randomMajorBoard, rng } from "./search.testkit";
import { solve as solveChecked } from "./index";
import calsPre2025 from "./fixtures/cals-college-pre2025.json";
import type {
  AnyOfRow,
  ConfirmRow,
  CourseRule,
  CreditsRow,
  DistCourse,
  DistributionCategory,
  DistributionResult,
  DistributionRow,
  Layer,
  PoolRow,
  Row,
  RowResult,
  SeatRow,
  SolveInput,
  StudentContext,
} from "./types";

// ─── builders ────────────────────────────────────────────────────────────────

/** "HIST-1530" with tags → a 3-credit course carrying those attributes. */
const C = (id: string, tags: string[] = [], over: Partial<DistCourse> = {}): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits: 3, attrs: tags.map((value) => ({ value })), ...over };
};

const source = { url: "https://example.edu/catalog", anchor: "req" };
const base = (id: string) => ({ id, label: id, group: "Test", source });

const tag = (...t: string[]): CourseRule => ({ tag: t });
const seat = (id: string, rule: CourseRule, over: Partial<SeatRow> = {}): SeatRow => ({ ...base(id), kind: "seat", rule, ...over });
const pool = (id: string, rule: CourseRule, requiredCourses: number, requiredCredits: number, over: Partial<PoolRow> = {}): PoolRow => ({
  ...base(id),
  kind: "pool",
  rule,
  requiredCourses,
  requiredCredits,
  ...over,
});
const credits = (id: string, rule: CourseRule, requiredCredits: number, over: Partial<CreditsRow> = {}): CreditsRow => ({
  ...base(id),
  kind: "credits",
  rule,
  requiredCredits,
  ...over,
});
const cats = (...ids: string[]): DistributionCategory[] => ids.map((id) => ({ id, label: id, rule: { tag: [id] } }));
const dist = (id: string, categories: DistributionCategory[], over: Partial<DistributionRow>): DistributionRow => ({
  ...base(id),
  kind: "distribution",
  categories,
  requiredCourses: 0,
  minDistinctCategories: 0,
  ...over,
});
const anyOf = (id: string, rows: AnyOfRow["rows"], over: Partial<AnyOfRow> = {}): AnyOfRow => ({ ...base(id), kind: "anyOf", rows, ...over });
const confirm = (id: string): ConfirmRow => ({ ...base(id), kind: "confirm" });

const layer = (id: string, rows: Row[], kind: Layer["kind"] = "college"): Layer => ({
  id,
  kind,
  family: "cas",
  name: id,
  catalogYear: "2026-27",
  rows,
});

const ctx: StudentContext = { programId: "test-program", entryTerm: "FA25", transfer: "none" };

const solve = (layers: Layer[], courses: DistCourse[], extra: Partial<SolveInput> = {}) =>
  solveLayers({ layers, courses, ctx, ...extra });

const rowOf = (res: DistributionResult, layerId: string, rowId: string): RowResult => {
  const r = res.layers.find((l) => l.layerId === layerId)?.rows.find((x) => x.rowId === rowId);
  if (!r) throw new Error(`no row ${layerId}:${rowId}`);
  return r;
};
const ids = (r: RowResult) => r.courses.map((c) => c.courseId);
/** Solve one row in one layer and return its result. */
const one = (row: Row, courses: DistCourse[], extra: Partial<SolveInput> = {}) =>
  rowOf(solve([layer("L", [row])], courses, extra), "L", row.id);

afterEach(() => vi.restoreAllMocks());

// ─── row kinds ───────────────────────────────────────────────────────────────

describe("seat rows", () => {
  const row = seat("s", { course: ["ECON-1110"] });
  it.each([
    ["met", [C("ECON-1110")], "met", 1],
    ["unmet", [C("ECON-1120")], "unmet", 0],
  ] as const)("%s", (_, courses, status, fraction) => {
    const r = one(row, [...courses]);
    expect(r.status).toBe(status);
    expect(r.fraction).toBe(fraction);
    expect(r.courses.length).toBeLessThanOrEqual(1);
  });

  it("lists at most one course even when several match", () => {
    const r = one(seat("s", tag("ALC-AS")), [C("ENGL-1100", ["ALC-AS"]), C("ENGL-2000", ["ALC-AS"])]);
    expect(ids(r)).toEqual(["ENGL-1100"]);
  });
});

describe("pool rows", () => {
  const row = pool("p", { subject: ["ECON"] }, 4, 12);
  const econ = (n: number) => Array.from({ length: n }, (_, k) => C(`ECON-${3000 + k}`));
  it.each([
    ["met", econ(5), "met", 1, 4],
    ["partial", econ(2), "partial", 0.5, 2],
    ["unmet", [C("HIST-1000")], "unmet", 0, 0],
  ] as const)("%s", (_, courses, status, fraction, counted) => {
    const r = one(row, [...courses]);
    expect(r.status).toBe(status);
    expect(r.fraction).toBeCloseTo(fraction);
    expect(r.courses).toHaveLength(counted);
    expect(r.progress.coursesHave).toBe(counted);
    expect(r.progress.creditsHave).toBe(counted * 3);
  });

  it("a met pool counts only what it needs (fewest courses)", () => {
    const r = one(pool("p", { subject: ["ECON"] }, 2, 8), [C("ECON-3000"), C("ECON-3010", [], { credits: 4 }), C("ECON-3020", [], { credits: 4 })]);
    expect(r.status).toBe("met");
    expect(ids(r)).toEqual(["ECON-3010", "ECON-3020"]);
  });

  describe("limits (CALS written expression: 9 credits, >= 6 WRT, <= 1 ORL course)", () => {
    const row = pool("w", tag("WRT-AG", "ORL-AG"), 0, 9, {
      limits: [
        { rule: tag("WRT-AG"), minCredits: 6 },
        { rule: tag("ORL-AG"), maxCourses: 1 },
      ],
    });
    it("two WRT + one ORL is met", () => {
      const r = one(row, [C("WRIT-1", ["WRT-AG"]), C("WRIT-2", ["WRT-AG"]), C("COMM-1", ["ORL-AG"])]);
      expect(r.status).toBe("met");
    });
    it("only one ORL course counts, and the WRT minimum is short", () => {
      const r = one(row, [C("WRIT-1", ["WRT-AG"]), C("COMM-1", ["ORL-AG"]), C("COMM-2", ["ORL-AG"])]);
      expect(r.status).toBe("partial");
      expect(ids(r)).toEqual(["WRIT-1", "COMM-1"]);
      expect(r.progress.creditsHave).toBe(6);
    });
    it("extra ORL courses never push a met pool past its cap", () => {
      const r = one(row, [C("COMM-1", ["ORL-AG"]), C("COMM-2", ["ORL-AG"]), C("WRIT-1", ["WRT-AG"]), C("WRIT-2", ["WRT-AG"])]);
      expect(r.status).toBe("met");
      expect(r.courses.filter((c) => c.courseId.startsWith("COMM"))).toHaveLength(1);
    });
  });

  it("maxPerSubject caps a department: FREN/ITAL/SPAN/PORT in one subject group count 2", () => {
    const romance = ["FREN", "ITAL", "SPAN", "PORT"];
    const courses = romance.map((s) => C(`${s}-2000`));
    const p = one(pool("p", { subject: romance }, 4, 0, { maxPerSubject: 2, subjectGroups: [romance] }), courses);
    expect(p.status).toBe("partial");
    expect(p.courses).toHaveLength(2);
    // Without the group each language is its own department.
    expect(one(pool("p", { subject: romance }, 4, 0, { maxPerSubject: 2 }), courses).status).toBe("met");
    // The same cap inside a distribution row (flow path).
    const d = one(
      dist("d", cats("A", "B", "C", "D"), { requiredCourses: 4, minDistinctCategories: 4, maxPerSubject: 2, subjectGroups: [romance] }),
      romance.map((s, k) => C(`${s}-3000`, [["A", "B", "C", "D"][k]]))
    );
    expect(d.status).toBe("partial");
    expect(d.courses).toHaveLength(2);
  });

  it.each([
    ["three in one subject: only two count", [C("ECON-1"), C("ECON-2"), C("ECON-3")], "partial", 2],
    ["two subjects: met", [C("ECON-1"), C("ECON-2"), C("HIST-1")], "met", 3],
  ] as const)("maxPerSubject 2 — %s", (_, courses, status, counted) => {
    const r = one(pool("p", { anyOf: [{ subject: ["ECON"] }, { subject: ["HIST"] }] }, 3, 0, { maxPerSubject: 2 }), [...courses]);
    expect(r.status).toBe(status);
    expect(r.courses).toHaveLength(counted);
  });
});

describe("distribution rows", () => {
  const ten = ["ALC", "BIO", "ETM", "GLC", "HST", "PHS", "SCD", "SMR", "SSC", "SDS"];
  const casRow = dist("d", cats(...ten), {
    requiredCourses: 8,
    minDistinctCategories: 10,
    maxCategoriesPerCourse: 2,
    maxDoubleCountCourses: 2,
  });

  it("CAS: 8 courses, exactly two carrying two needed tags → met", () => {
    const courses = [
      ...ten.slice(0, 6).map((t, k) => C(`S-${k}`, [t])),
      C("D-1", ["SMR", "SSC"]),
      C("D-2", ["SDS", "SCD"]),
    ];
    const r = one(casRow, courses);
    expect(r.status).toBe("met");
    expect(r.fraction).toBe(1);
    expect(r.progress.categoriesHave).toHaveLength(10);
    expect(r.courses).toHaveLength(8);
    expect(r.courses.filter((c) => (c.categories ?? []).length > 1).length).toBeLessThanOrEqual(2);
  });

  it("CAS: the same with a third course needing to double → not met", () => {
    const courses = [
      C("S-1", ["ALC"]),
      C("S-2", ["BIO"]),
      C("S-3", ["ETM"]),
      C("S-4", ["GLC"]),
      C("S-5", ["ALC"]),
      C("D-1", ["HST", "PHS"]),
      C("D-2", ["SCD", "SMR"]),
      C("D-3", ["SSC", "SDS"]),
    ];
    const r = one(casRow, courses);
    expect(r.status).toBe("partial");
    expect(r.progress.categoriesHave).toHaveLength(9);
    expect(r.progress.missingCategories).toHaveLength(1);
    expect(r.fraction).toBeCloseTo((1 + 0.9) / 2);
    expect(r.courses.filter((c) => (c.categories ?? []).length > 1)).toHaveLength(2);
    // every listed course claims at least one category
    expect(r.courses.every((c) => (c.categories ?? []).length >= 1)).toBe(true);
  });

  const cals = dist("c", cats("CA", "FL", "HA", "LA", "SBA"), {
    requiredCourses: 2,
    minDistinctCategories: 2,
    perCategory: Object.fromEntries(["CA", "FL", "HA", "LA", "SBA"].map((c) => [c, { max: 1 }])),
  });
  it.each([
    ["two CA courses: max 1 each → partial", [C("A-1", ["CA"]), C("A-2", ["CA"])], "partial", 1],
    ["CA + FL → met", [C("A-1", ["CA"]), C("B-1", ["FL"])], "met", 2],
    ["nothing → unmet", [C("X-1")], "unmet", 0],
  ] as const)("CALS 2 of 5, max 1 each — %s", (_, courses, status, counted) => {
    const r = one(cals, [...courses]);
    expect(r.status).toBe(status);
    expect(r.courses).toHaveLength(counted);
  });

  const preD = dist("p", cats("A", "B", "C", "D"), { requiredCourses: 3, minDistinctCategories: 3, perCategory: { D: { min: 1 } } });
  it("per-category minimum: D required", () => {
    const miss = one(preD, [C("X-1", ["A"]), C("X-2", ["B"]), C("X-3", ["C"])]);
    expect(miss.status).toBe("partial");
    expect(miss.progress.missingCategories).toEqual(["D"]);
    const hit = one(preD, [C("X-1", ["A"]), C("X-2", ["B"]), C("X-4", ["D"])]);
    expect(hit.status).toBe("met");
  });

  it("minDistinctCategories: five courses in two categories → 2 of 4", () => {
    const r = one(dist("m", cats("A", "B", "C", "D"), { requiredCourses: 5, minDistinctCategories: 4 }), [
      C("X-1", ["A"]),
      C("X-2", ["A"]),
      C("X-3", ["B"]),
      C("X-4", ["B"]),
      C("X-5", ["A"]),
    ]);
    expect(r.status).toBe("partial");
    expect(r.progress.categoriesHave).toEqual(["A", "B"]);
    expect(r.progress.missingCategories).toEqual(["C", "D"]);
    expect(r.fraction).toBeCloseTo((1 + 0.5) / 2);
  });

  it("row-level eligibility rule excludes AP credit", () => {
    const row = dist("e", cats("A", "B"), { rule: { not: { creditKind: ["ap"] } }, requiredCourses: 2, minDistinctCategories: 2 });
    const r = one(row, [C("X-1", ["A"]), C("AP-1", ["B"], { isCredit: true, creditKind: "ap" })]);
    expect(r.status).toBe("partial");
    expect(ids(r)).toEqual(["X-1"]);
  });

  it("three categories per course (search fallback) honours the double-count budget", () => {
    const row = dist("t", cats("A", "B", "C", "D"), {
      requiredCourses: 2,
      minDistinctCategories: 4,
      maxCategoriesPerCourse: 3,
      maxDoubleCountCourses: 1,
    });
    expect(one(row, [C("X-1", ["A", "B", "C"]), C("X-2", ["D"])]).status).toBe("met");
    expect(one(row, [C("X-1", ["A", "B"]), C("X-2", ["C", "D"])]).status).toBe("partial");
  });
});

describe("credits rows", () => {
  it.each([
    ["met", 4, "met"],
    ["partial", 2, "partial"],
    ["unmet", 0, "unmet"],
  ] as const)("plain total — %s", (_, n, status) => {
    const courses = Array.from({ length: n }, (_, k) => C(`ANY-${k}`));
    const r = one(credits("t", { not: { tag: ["NONE"] } }, 12), [...courses, ...(n === 0 ? [] : [])]);
    expect(r.status).toBe(status);
    expect(r.progress.creditsHave).toBe(n * 3);
  });

  it("lists every matching course (a total never stops at the target)", () => {
    const r = one(credits("t", { not: { tag: ["NONE"] } }, 6), [C("A-1"), C("A-2"), C("A-3")]);
    expect(r.status).toBe("met");
    expect(r.progress.creditsHave).toBe(9);
    expect(r.courses).toHaveLength(3);
  });

  const lang = credits("lang", tag("LANG"), 11, { sameSubject: true });
  it("sameSubject: 11 credits in one language → met", () => {
    const r = one(lang, [C("SPAN-1110", ["LANG"], { credits: 4 }), C("SPAN-1120", ["LANG"], { credits: 4 }), C("SPAN-2090", ["LANG"])]);
    expect(r.status).toBe("met");
    expect(r.progress.creditsHave).toBe(11);
  });
  it("sameSubject: 6 + 6 across two languages → not met, counts one subject", () => {
    const r = one(lang, [C("SPAN-1", ["LANG"]), C("FREN-1", ["LANG"]), C("SPAN-2", ["LANG"]), C("FREN-2", ["LANG"])]);
    expect(r.status).toBe("partial");
    expect(r.progress.creditsHave).toBe(6);
    expect(ids(r)).toEqual(["SPAN-1", "SPAN-2"]);
  });

  it("limits: at most 2 FWS courses count", () => {
    const row = credits("t", { not: { tag: ["NONE"] } }, 12, { limits: [{ rule: tag("FWS"), maxCourses: 2 }] });
    const r = one(row, [C("F-1", ["FWS"]), C("F-2", ["FWS"]), C("F-3", ["FWS"]), C("O-1")]);
    expect(r.status).toBe("partial");
    expect(r.progress.creditsHave).toBe(9);
    expect(r.courses.filter((c) => c.courseId.startsWith("F"))).toHaveLength(2);
  });
});

describe("anyOf rows", () => {
  // Language: Option 1 = one 2000-level course; Option 2 = 11 credits in one language.
  const row = anyOf("lang", [
    pool("opt1", { allOf: [tag("LANG"), { number: { min: 2000 } }] }, 1, 0),
    credits("opt2", tag("LANG"), 11, { sameSubject: true }),
  ]);
  it.each([
    ["option 1 met", [C("SPAN-2090", ["LANG"])], "met", "opt1"],
    ["option 2 met", [C("SPAN-1110", ["LANG"], { credits: 4 }), C("SPAN-1120", ["LANG"], { credits: 4 }), C("SPAN-1130", ["LANG"])], "met", "opt2"],
    ["neither: best partial child", [C("SPAN-1110", ["LANG"])], "partial", "opt2"],
  ] as const)("%s", (_, courses, status, chosen) => {
    const r = one(row, [...courses]);
    expect(r.status).toBe(status);
    expect(r.children?.map((c) => c.rowId)).toEqual(["opt1", "opt2"]);
    const pick = r.children?.find((c) => c.rowId === chosen);
    expect(ids(r)).toEqual(pick ? ids(pick) : []);
  });

  it("an option whose appliesTo excludes the student stays listed but is never met", () => {
    const gated = anyOf("g", [seat("a", tag("X"), { appliesTo: [{ transfer: ["external"] }] }), seat("b", tag("Y"))]);
    const r = one(gated, [C("A-1", ["X"])]);
    expect(r.status).toBe("unmet");
    expect(r.children?.map((c) => [c.rowId, c.status])).toEqual([
      ["a", "unmet"],
      ["b", "unmet"],
    ]);
  });

  it("in a consuming layer only the chosen child consumes", () => {
    const res = solve(
      [layer("L", [anyOf("any", [seat("x", tag("A")), seat("y", tag("B"))]), seat("other", tag("B"))])],
      [C("A-1", ["A"]), C("B-1", ["B"])]
    );
    expect(rowOf(res, "L", "any").status).toBe("met");
    expect(rowOf(res, "L", "other").status).toBe("met");
    expect(res.attribution["B-1"]).toEqual([{ layerId: "L", rowId: "other" }]);
  });
});

// ─── layering and consumption ────────────────────────────────────────────────

describe("layers, exclusivity and overlay", () => {
  it("exclusive: an FWS course used by the college row cannot fill a major row", () => {
    const res = solve(
      [layer("college", [seat("fws", tag("FWS"), { exclusive: true })]), layer("major", [seat("hist", { subject: ["HIST"] })], "major")],
      [C("HIST-1200", ["FWS"])]
    );
    expect(rowOf(res, "college", "fws").status).toBe("met");
    expect(rowOf(res, "major", "hist").status).toBe("unmet");
    expect(res.attribution["HIST-1200"]).toEqual([{ layerId: "college", rowId: "fws" }]);
  });

  it.each([
    ["ENGL-2880 first", ["ENGL-2880", "ENGL-1105", "HIST-1200"]],
    ["ENGL-2880 last", ["ENGL-1105", "HIST-1200", "ENGL-2880"]],
  ])("exclusive rows leave other rows' courses alone when they can (%s)", (_, order) => {
    const fwsRule: CourseRule = { anyOf: [{ titleStartsWith: "FWS:" }, { course: ["ENGL-2880"] }] };
    const titles: Record<string, string> = { "ENGL-1105": "FWS: Reading", "HIST-1200": "FWS: Empire", "ENGL-2880": "Expository Writing" };
    const res = solve(
      [
        layer("college", [pool("fws", fwsRule, 2, 6, { exclusive: true })]),
        layer("major", [seat("writing", { course: ["ENGL-2880"] })], "major"),
      ],
      order.map((id) => C(id, [], { title: titles[id] }))
    );
    expect(rowOf(res, "college", "fws").status).toBe("met");
    expect(ids(rowOf(res, "college", "fws")).sort()).toEqual(["ENGL-1105", "HIST-1200"]);
    expect(rowOf(res, "major", "writing").status).toBe("met");
  });

  it("exclusive removal reaches overlay rows too", () => {
    const res = solve(
      [layer("college", [seat("fws", tag("FWS"), { exclusive: true }), seat("ov", tag("FWS"), { overlay: true })])],
      [C("HIST-1200", ["FWS"])]
    );
    expect(rowOf(res, "college", "ov").status).toBe("unmet");
  });

  it("credits rows still count courses an exclusive row used (an FWS counts toward 120 credits)", () => {
    const anything: CourseRule = { not: { tag: ["NONE"] } };
    const res = solve(
      [
        layer("college", [pool("fws", tag("FWS"), 2, 6, { exclusive: true }), credits("total", anything, 120)]),
        layer("major", [anyOf("opt", [credits("hours", anything, 9)]), seat("any", anything)], "major"),
      ],
      [C("ENGL-1105", ["FWS"]), C("HIST-1200", ["FWS"]), C("ECON-1110")]
    );
    expect(rowOf(res, "college", "fws").status).toBe("met");
    const total = rowOf(res, "college", "total");
    expect(ids(total)).toEqual(["ENGL-1105", "HIST-1200", "ECON-1110"]);
    expect(total.progress.creditsHave).toBe(9);
    expect(rowOf(res, "major", "opt").status).toBe("met"); // a credits option of an anyOf too
    expect(ids(rowOf(res, "major", "any"))).toEqual(["ECON-1110"]); // other kinds still lose them
    expect(res.attribution["HIST-1200"]).toEqual([
      { layerId: "college", rowId: "fws" },
      { layerId: "college", rowId: "total" },
      { layerId: "major", rowId: "opt" },
    ]);
  });

  it("overlay rows consume nothing", () => {
    const res = solve(
      [layer("L", [seat("ov", tag("A"), { overlay: true }), seat("main", tag("A"))])],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "L", "ov").status).toBe("met");
    expect(rowOf(res, "L", "main").status).toBe("met");
    expect(res.attribution["X-1"]).toHaveLength(2);
  });

  it("layer independence: one course counts in the college AND the major layer", () => {
    const res = solve(
      [layer("college", [seat("c", tag("SSC"))]), layer("major", [seat("m", { subject: ["ECON"] })], "major")],
      [C("ECON-1110", ["SSC"])]
    );
    expect(rowOf(res, "college", "c").status).toBe("met");
    expect(rowOf(res, "major", "m").status).toBe("met");
    expect(res.attribution["ECON-1110"]).toEqual([
      { layerId: "college", rowId: "c" },
      { layerId: "major", rowId: "m" },
    ]);
  });

  it("within a layer a course counts once", () => {
    const res = solve([layer("L", [seat("a", tag("A")), seat("b", tag("A"))])], [C("X-1", ["A"])]);
    const statuses = [rowOf(res, "L", "a").status, rowOf(res, "L", "b").status].sort();
    expect(statuses).toEqual(["met", "unmet"]);
  });

  it("contested course where greedy fails: X fits A and B, Y only A → both met", () => {
    const res = solve(
      [layer("L", [seat("A", { course: ["X-1", "Y-1"] }), seat("B", { course: ["X-1"] })])],
      [C("X-1"), C("Y-1")]
    );
    expect(rowOf(res, "L", "A").status).toBe("met");
    expect(rowOf(res, "L", "B").status).toBe("met");
    expect(ids(rowOf(res, "L", "B"))).toEqual(["X-1"]);
  });

  it("contested between a pool and a distribution: the search splits the courses", () => {
    const res = solve(
      [
        layer("L", [
          pool("p", tag("A"), 2, 0),
          dist("d", cats("A", "B"), { requiredCourses: 2, minDistinctCategories: 2 }),
        ]),
      ],
      [C("X-1", ["A"]), C("X-2", ["A"]), C("X-3", ["A"]), C("X-4", ["B"])]
    );
    expect(rowOf(res, "L", "p").status).toBe("met");
    expect(rowOf(res, "L", "d").status).toBe("met");
  });
});

// ─── counting groups (courseSharing) ─────────────────────────────────────────

const majorL = (id: string, rows: Row[], programId = "p"): Layer => ({ ...layer(id, rows, "major"), programId });
const concL = (id: string, rows: Row[], courseSharing?: Layer["courseSharing"], programId = "p"): Layer => ({
  ...layer(id, rows, "concentration"),
  programId,
  concentrationId: id,
  ...(courseSharing ? { courseSharing } : {}),
});

describe("counting groups (courseSharing)", () => {
  // Mathematics: "No course may be used to satisfy more than one requirement."
  const algebra = pool("algebra", { course: ["MATH-3320", "MATH-3340", "MATH-4310"] }, 2, 0);
  const upper = pool("upper", { allOf: [{ subject: ["MATH"] }, { number: { min: 3000 } }] }, 1, 0);

  it("separate: a course the major's row counts cannot also fill a concentration row (no false green)", () => {
    const res = solve(
      [majorL("math", [algebra]), concL("math--or", [upper], "separate")],
      [C("MATH-3320"), C("MATH-3340")]
    );
    // Two courses cannot meet both rows (3 needed). The search's objective
    // (rows met, then progress) keeps one row met and shows the other's share.
    const a = rowOf(res, "math", "algebra");
    const u = rowOf(res, "math--or", "upper");
    expect([a.status, u.status].filter((s) => s === "met")).toHaveLength(1);
    expect(a.courses.length + u.courses.length).toBe(2);
    expect(res.attribution["MATH-3320"]).toHaveLength(1);
    expect(res.attribution["MATH-3340"]).toHaveLength(1);
    // Shared, the same board shows both rows met — the false green this prevents.
    const shared = solve([majorL("math", [algebra]), concL("math--or", [upper])], [C("MATH-3320"), C("MATH-3340")]);
    expect([rowOf(shared, "math", "algebra").status, rowOf(shared, "math--or", "upper").status]).toEqual(["met", "met"]);
  });

  it("separate: one course, two seats — one is met, and a tie goes to the major's row (layer order)", () => {
    const seatUpper = seat("upper", { allOf: [{ subject: ["MATH"] }, { number: { min: 3000 } }] });
    const algebraSeat = seat("algebra", { course: ["MATH-3320"] });
    const res = solve([majorL("math", [algebraSeat]), concL("math--or", [seatUpper], "separate")], [C("MATH-3320")]);
    expect(rowOf(res, "math", "algebra").status).toBe("met");
    expect(rowOf(res, "math--or", "upper").status).toBe("unmet");
    expect(res.attribution["MATH-3320"]).toEqual([{ layerId: "math", rowId: "algebra" }]);
  });

  it("separate: a third course fills the concentration, and each row reports under its own layer", () => {
    const res = solve(
      [majorL("math", [algebra]), concL("math--or", [upper], "separate")],
      [C("MATH-3320"), C("MATH-3340"), C("MATH-4310")]
    );
    const a = rowOf(res, "math", "algebra");
    const u = rowOf(res, "math--or", "upper");
    expect([a.status, u.status]).toEqual(["met", "met"]);
    expect(a.layerId).toBe("math");
    expect(u.layerId).toBe("math--or");
    const counted = [...ids(a), ...ids(u)];
    expect(new Set(counted).size).toBe(3);
    expect(res.layers.map((l) => l.layerId)).toEqual(["math", "math--or"]);
  });

  it("separate: the group is one exact search — greedy fails across layers, the search does not", () => {
    // X fits the major seat and the concentration seat; Y only the major's.
    const res = solve(
      [majorL("M", [seat("A", { course: ["X-1", "Y-1"] })]), concL("M--c", [seat("B", { course: ["X-1"] })], "separate")],
      [C("X-1"), C("Y-1")]
    );
    expect(rowOf(res, "M", "A")).toMatchObject({ status: "met", courses: [{ courseId: "Y-1", credits: 3 }] });
    expect(rowOf(res, "M--c", "B")).toMatchObject({ status: "met", courses: [{ courseId: "X-1", credits: 3 }] });
  });

  it.each([["shared" as const], [undefined]])("courseSharing %s: the layers stay independent (today's behaviour)", (sharing) => {
    const res = solve([majorL("math", [algebra]), concL("math--or", [upper], sharing)], [C("MATH-3320"), C("MATH-3340")]);
    expect(rowOf(res, "math", "algebra").status).toBe("met");
    expect(rowOf(res, "math--or", "upper").status).toBe("met");
    const both = res.attribution[ids(rowOf(res, "math--or", "upper"))[0]];
    expect(both).toHaveLength(2);
  });

  it("two separate concentrations share one group with the major", () => {
    const res = solve(
      [
        majorL("M", [seat("m", tag("A"))]),
        concL("M--one", [seat("c1", tag("A"))], "separate"),
        concL("M--two", [seat("c2", tag("A"))], "separate"),
      ],
      [C("X-1", ["A"]), C("X-2", ["A"])]
    );
    const statuses = [rowOf(res, "M", "m"), rowOf(res, "M--one", "c1"), rowOf(res, "M--two", "c2")].map((r) => r.status);
    expect(statuses.filter((s) => s === "met")).toHaveLength(2);
    expect(statuses.filter((s) => s === "unmet")).toHaveLength(1);
    for (const id of ["X-1", "X-2"]) expect(res.attribution[id]).toHaveLength(1);
  });

  it("a shared concentration beside a separate one still reuses the major's courses", () => {
    const res = solve(
      [
        majorL("M", [seat("m", tag("A"))]),
        concL("M--sep", [seat("s", tag("A"))], "separate"),
        concL("M--shr", [seat("h", tag("A"))], "shared"),
      ],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "M", "m").status).toBe("met");
    expect(rowOf(res, "M--sep", "s").status).toBe("unmet");
    expect(rowOf(res, "M--shr", "h").status).toBe("met");
  });

  it("a separate concentration without its major in the solve stays on its own", () => {
    // College + concentration only, and a major of another program: neither joins it.
    const res = solve(
      [
        layer("college", [seat("c", tag("A"))]),
        majorL("other", [seat("o", tag("A"))], "q"),
        concL("p--c", [seat("k", tag("A"))], "separate", "p"),
      ],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "college", "c").status).toBe("met");
    expect(rowOf(res, "other", "o").status).toBe("met");
    expect(rowOf(res, "p--c", "k").status).toBe("met");
    expect(res.attribution["X-1"]).toHaveLength(3);
  });

  it("college layers never join a group: the college row still reuses a grouped course", () => {
    const res = solve(
      [layer("college", [seat("c", tag("A"))]), majorL("M", [seat("m", tag("A"))]), concL("M--c", [seat("k", tag("A"))], "separate")],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "college", "c").status).toBe("met");
    expect([rowOf(res, "M", "m").status, rowOf(res, "M--c", "k").status].sort()).toEqual(["met", "unmet"]);
  });

  it("overlay and credits rows still see every course of the group", () => {
    const res = solve(
      [
        majorL("M", [seat("m", tag("A")), pool("m-ov", tag("A"), 1, 0, { overlay: true })]),
        concL(
          "M--c",
          [seat("k", tag("A")), seat("k-ov", tag("A"), { overlay: true }), credits("k-cr", tag("A"), 3), anyOf("k-any", [credits("k-any-cr", tag("A"), 3), credits("k-any-cr2", tag("B"), 3)])],
          "separate"
        ),
      ],
      [C("X-1", ["A"])]
    );
    // One consuming row gets the course; the other is unmet.
    expect([rowOf(res, "M", "m").status, rowOf(res, "M--c", "k").status].sort()).toEqual(["met", "unmet"]);
    for (const [l, r] of [["M", "m-ov"], ["M--c", "k-ov"], ["M--c", "k-cr"], ["M--c", "k-any"]]) {
      expect(rowOf(res, l, r).status, `${l}:${r}`).toBe("met");
    }
  });

  it("exclusive rows still run first across all layers, then the group splits what is left", () => {
    const res = solve(
      [
        layer("college", [seat("fws", tag("FWS"), { exclusive: true })]),
        majorL("M", [seat("m", tag("A"))]),
        concL("M--c", [seat("k", tag("A")), seat("k-fws", tag("FWS"))], "separate"),
      ],
      [C("X-1", ["A", "FWS"]), C("X-2", ["A"])]
    );
    expect(rowOf(res, "college", "fws")).toMatchObject({ status: "met", courses: [{ courseId: "X-1", credits: 3 }] });
    expect(rowOf(res, "M--c", "k-fws").status).toBe("unmet");
    expect([rowOf(res, "M", "m").status, rowOf(res, "M--c", "k").status].sort()).toEqual(["met", "unmet"]);
    expect(res.attribution["X-2"]).toHaveLength(1);
  });

  it("a waived major row frees its course for the concentration", () => {
    const res = solve([majorL("M", [seat("m", tag("A"))]), concL("M--c", [seat("k", tag("A"))], "separate")], [C("X-1", ["A"])], {
      waived: ["M:m"],
    });
    expect(rowOf(res, "M", "m").status).toBe("waived");
    expect(rowOf(res, "M--c", "k").status).toBe("met");
  });

  it("a capped group never shows a false green in either layer", () => {
    const rows = (prefix: string) => Array.from({ length: 3 }, (_, k) => pool(`${prefix}${k}`, tag("A"), 2, 0));
    const layers = [majorL("M", rows("m")), concL("M--c", rows("c"), "separate")];
    const courses = Array.from({ length: 10 }, (_, k) => C(`X-${k}`, ["A"]));
    const full = solve(layers, courses);
    const capped = solve(layers, courses, { nodeCap: 1 });
    expect(full.capped).toBe(false);
    expect(capped.capped).toBe(true);
    // 10 courses, 2 per pool: 5 of the 6 rows across both layers.
    expect(full.layers.flatMap((l) => l.rows).filter((r) => r.status === "met")).toHaveLength(5);
    for (const l of capped.layers) {
      for (const r of l.rows) if (r.status === "met") expect(rowOf(full, l.layerId, r.rowId).status).toBe("met");
    }
  });

  it("an engine error in a group marks every row of the group unchecked, other layers untouched", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = {
      get tag(): string[] {
        throw new Error("boom");
      },
    } as unknown as CourseRule;
    const res = solve(
      [layer("college", [seat("ok", tag("A"))]), majorL("M", [seat("fine", tag("A"))]), concL("M--c", [seat("bad", bad)], "separate")],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "college", "ok").status).toBe("met");
    expect(rowOf(res, "M", "fine")).toMatchObject({ status: "unchecked", reason: "engine-error" });
    expect(rowOf(res, "M--c", "bad")).toMatchObject({ status: "unchecked", reason: "engine-error" });
  });

  it("same input twice → deep-equal output", () => {
    const layers = [majorL("M", [pool("m", tag("A"), 2, 0), seat("m2", tag("B"))]), concL("M--c", [pool("k", tag("A", "B"), 2, 0)], "separate")];
    const courses = [C("X-1", ["A", "B"]), C("X-2", ["A"]), C("X-3", ["B"]), C("X-4", ["A", "B"])];
    expect(solve(layers, courses)).toEqual(solve(layers, courses));
  });
});

describe("countingGroups", () => {
  it("joins separate concentrations to their program's major, in layer order", () => {
    const groups = countingGroups([
      layer("college", []),
      majorL("M", []),
      concL("M--a", [], "separate"),
      concL("M--b", [], "shared"),
      concL("M--c", [], "separate"),
      concL("M--d", []),
    ]);
    expect(groups).toEqual([[0], [1, 2, 4], [3], [5]]);
  });

  it("a separate concentration with no major of its program, or listed before it, is handled by programId", () => {
    expect(countingGroups([concL("p--a", [], "separate"), majorL("other", [], "q")])).toEqual([[0], [1]]);
    expect(countingGroups([concL("p--a", [], "separate"), majorL("M", [], "p")])).toEqual([[0, 1]]);
  });

  it("only concentration layers can be separate", () => {
    const notConc: Layer = { ...majorL("M2", []), courseSharing: "separate" };
    expect(countingGroups([majorL("M", []), notConc])).toEqual([[0], [1]]);
    const noProgram: Layer = { ...concL("c", [], "separate"), programId: undefined };
    expect(countingGroups([majorL("M", []), noProgram])).toEqual([[0], [1]]);
  });
});

// ─── applicability, waivers, confirm ─────────────────────────────────────────

describe("appliesTo, waived, confirm", () => {
  it("terms order by year then WI < SP < SU < FA", () => {
    const keys = ["FA24", "WI25", "SP25", "SU25", "FA25"].map(termKey);
    expect([...keys].sort((a, b) => (a as number) - (b as number))).toEqual(keys);
    expect(termKey("bogus")).toBeNull();
  });

  it.each(["fa25", " FA25", "FA25 ", "FA2025", "Fa25"])("terms parse strictly: %j is unknown", (term) => {
    expect(termKey(term)).toBeNull();
    const res = solveLayers({
      layers: [layer("L", [seat("new", tag("A"), { appliesTo: [{ enteredFrom: "FA25" }] })])],
      courses: [],
      ctx: { programId: "p", entryTerm: term },
    });
    expect(res.layers[0].rows).toEqual([]);
  });

  it("an empty appliesTo list matches no one", () => {
    const res = solve([layer("L", [seat("never", tag("A"), { appliesTo: [] }), seat("always", tag("A"))])], []);
    expect(res.layers[0].rows.map((r) => r.rowId)).toEqual(["always"]);
  });

  const gated = layer("L", [
    seat("new", tag("A"), { appliesTo: [{ enteredFrom: "FA25" }] }),
    seat("old", tag("A"), { appliesTo: [{ enteredBefore: "FA25" }] }),
    seat("xfer", tag("A"), { appliesTo: [{ transfer: ["external"] }] }),
    seat("always", tag("A")),
  ]);
  it.each([
    ["entered FA25", { entryTerm: "FA25", transfer: "none" }, ["new", "always"]],
    ["entered SP25", { entryTerm: "SP25", transfer: "none" }, ["old", "always"]],
    ["unknown entry term", { entryTerm: null, transfer: null }, ["always"]],
    ["external transfer, FA24", { entryTerm: "FA24", transfer: "external" }, ["old", "xfer", "always"]],
  ] as const)("%s", (_, over, want) => {
    const res = solveLayers({ layers: [gated], courses: [], ctx: { programId: "p", ...over } });
    expect(res.layers[0].rows.map((r) => r.rowId)).toEqual(want);
  });

  it("waived rows report waived, count nothing, and stay out of pct", () => {
    const res = solve([layer("L", [seat("a", tag("A")), seat("b", tag("B"))])], [C("X-1", ["A"])], { waived: ["L:b"] });
    const b = rowOf(res, "L", "b");
    expect(b.status).toBe("waived");
    expect(b.fraction).toBe(0);
    expect(res.pct).toBe(100);
  });

  it("a waived confirm row is waived", () => {
    const res = solve([layer("L", [confirm("c")])], [], { waived: ["L:c"] });
    expect(rowOf(res, "L", "c").status).toBe("waived");
  });

  it("confirm rows stay out of pct", () => {
    const res = solve([layer("L", [seat("a", tag("A")), seat("b", tag("B")), confirm("c")])], [C("X-1", ["A"])]);
    expect(rowOf(res, "L", "c").status).toBe("confirm");
    expect(res.pct).toBe(50);
  });

  it("pct is 0 with no scorable rows", () => {
    expect(solve([layer("L", [confirm("c")])], []).pct).toBe(0);
  });
});

// ─── identity, determinism, robustness ───────────────────────────────────────

describe("canonical ids and determinism", () => {
  it("two cross-listed ids count once, credits keep the max", () => {
    const canonical = (id: string) => (id === "ASIAN-1530" ? "HIST-1530" : id);
    const res = solve(
      [layer("L", [pool("p", tag("HST"), 2, 0)])],
      [C("ASIAN-1530", ["HST"]), C("HIST-1530", ["HST"], { credits: 4 })],
      { canonical }
    );
    const p = rowOf(res, "L", "p");
    expect(p.status).toBe("partial");
    expect(p.courses).toEqual([{ courseId: "HIST-1530", credits: 4 }]);
    expect(Object.keys(res.attribution)).toEqual(["HIST-1530"]);
  });

  it("uncounted lists canonical ids no row counts", () => {
    const res = solve([layer("L", [seat("a", tag("A"))])], [C("X-1", ["A"]), C("X-2")]);
    expect(res.uncounted).toEqual(["X-2"]);
  });

  it("same input twice → deep-equal output", () => {
    const input = casInput();
    expect(solveLayers(input)).toEqual(solveLayers(input));
  });
});

describe("node cap", () => {
  it("a tiny cap marks unproven rows unchecked and never wrongly met", () => {
    const rows = Array.from({ length: 6 }, (_, k) => pool(`p${k}`, tag("A"), 2, 0));
    const courses = Array.from({ length: 10 }, (_, k) => C(`X-${k}`, ["A"]));
    const full = solve([layer("L", rows)], courses);
    const capped = solve([layer("L", rows)], courses, { nodeCap: 1 });
    expect(capped.capped).toBe(true);
    expect(full.capped).toBe(false);
    const statuses = capped.layers[0].rows;
    expect(statuses.some((r) => r.status === "unchecked" && r.reason === "node-cap")).toBe(true);
    for (const r of statuses) {
      if (r.status === "met") expect(rowOf(full, "L", r.rowId).status).toBe("met");
      if (r.status === "unchecked") {
        expect(r.fraction).toBe(0);
        expect(r.courses).toEqual([]);
      }
    }
    // The full solve meets 5 of 6 pools (10 courses, 2 each).
    expect(full.layers[0].rows.filter((r) => r.status === "met")).toHaveLength(5);
  });

  it("under the cap, provably unmet rows keep their status: a seat whose course is not on the board is never unchecked", () => {
    const rows: Row[] = [
      ...Array.from({ length: 6 }, (_, k) => pool(`p${k}`, tag("A"), 2, 0)),
      seat("missing", { course: ["NONE-1000"] }),
      pool("short", tag("B"), 3, 0), // only one B course exists anywhere
    ];
    const courses = [...Array.from({ length: 10 }, (_, k) => C(`X-${k}`, ["A"])), C("Y-1", ["A", "B"])];
    const res = solve([layer("L", rows)], courses, { nodeCap: 1 });
    expect(res.capped).toBe(true);
    expect(rowOf(res, "L", "missing")).toMatchObject({ status: "unmet", fraction: 0 });
    expect(rowOf(res, "L", "missing").reason).toBeUndefined();
    const short = rowOf(res, "L", "short");
    expect(["partial", "unmet"]).toContain(short.status);
    expect(short.reason).toBeUndefined();
    // Rows that might still be met are the only unchecked ones.
    for (const r of res.layers[0].rows) if (r.status === "unchecked") expect(r.rowId).toMatch(/^p\d$/);
  });

  it("an engine error marks that layer unchecked and does not throw", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = {
      get tag(): string[] {
        throw new Error("boom");
      },
    } as unknown as CourseRule;
    const res = solve(
      [layer("college", [seat("ok", tag("A"))]), layer("major", [seat("bad", bad), seat("fine", tag("A"))], "major")],
      [C("X-1", ["A"])]
    );
    expect(rowOf(res, "college", "ok").status).toBe("met");
    expect(rowOf(res, "major", "bad")).toMatchObject({ status: "unchecked", reason: "engine-error", fraction: 0 });
    expect(rowOf(res, "major", "fine")).toMatchObject({ status: "unchecked", reason: "engine-error" });
    expect(err).toHaveBeenCalled();
  });
});

describe("verify hook", () => {
  it("a rejected met row is downgraded, logged, and loses its attribution", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const layers = [layer("L", [seat("a", tag("A")), seat("b", tag("B"))])];
    const courses = [C("X-1", ["A"]), C("X-2", ["B"])];
    const res = solveLayers(
      { layers, courses, ctx },
      { verify: () => ({ ok: false, rejections: [{ layerId: "L", rowId: "a", reason: "course does not match" }] }) }
    );
    expect(rowOf(res, "L", "a")).toMatchObject({ status: "unchecked", reason: "verify-rejected", fraction: 0, courses: [] });
    expect(rowOf(res, "L", "b").status).toBe("met");
    expect(res.verifyLog).toHaveLength(1);
    expect(res.attribution["X-1"]).toBeUndefined();
    expect(res.uncounted).toEqual(["X-1"]);
    expect(res.pct).toBe(50);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a wildcard", { layerId: "*", rowId: "*" }],
    ["a key naming no row", { layerId: "L", rowId: "nope" }],
  ])("%s rejection withdraws every met and partial claim", (_, key) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const layers = [layer("L", [seat("a", tag("A")), pool("b", tag("B"), 2, 0), seat("c", tag("Z")), confirm("d")])];
    const courses = [C("X-1", ["A"]), C("X-2", ["B"])];
    const res = solveLayers({ layers, courses, ctx }, { verify: () => ({ ok: false, rejections: [{ ...key, reason: "inconsistent" }] }) });
    expect(rowOf(res, "L", "a")).toMatchObject({ status: "unchecked", reason: "verify-rejected" });
    expect(rowOf(res, "L", "b")).toMatchObject({ status: "unchecked", reason: "verify-rejected" });
    expect(rowOf(res, "L", "c").status).toBe("unmet");
    expect(rowOf(res, "L", "d").status).toBe("confirm");
    expect(res.attribution).toEqual({});
    expect(res.pct).toBe(0);
    expect(res.verifyLog.length).toBeGreaterThanOrEqual(3);
  });

  it("the checker sees the finished result", () => {
    const verify = vi.fn(() => ({ ok: true, rejections: [] }));
    const input = { layers: [layer("L", [seat("a", tag("A"))])], courses: [C("X-1", ["A"])], ctx };
    const res = solveLayers(input, { verify });
    expect(verify).toHaveBeenCalledWith(input, res);
    expect(res.verifyLog).toEqual([]);
  });
});

// ─── performance ─────────────────────────────────────────────────────────────

const CAS_TAGS = ["ALC-AS", "BIO-AS", "ETM-AS", "GLC-AS", "HST-AS", "PHS-AS", "SCD-AS", "SMR-AS", "SSC-AS", "SDS-AS"];

/** A realistic CAS board: ~45 courses, many carrying two or three tags, with a
 *  college layer (FWS, language, distribution, totals, confirm), an economics
 *  major with overlapping seats and pools, and a concentration pool. */
function casInput(): SolveInput {
  const courses: DistCourse[] = [
    C("ENGL-1105", ["FWS"]),
    C("HIST-1200", ["FWS", "HST-AS"]),
    C("SPAN-1210", ["LANG"], { credits: 4 }),
    C("SPAN-1220", ["LANG"], { credits: 4 }),
    C("SPAN-2090", ["LANG", "GLC-AS"]),
    C("MATH-1110", ["SMR-AS"], { credits: 4 }),
    C("MATH-1120", ["SMR-AS"], { credits: 4 }),
    C("ECON-1110", ["SSC-AS"]),
    C("ECON-1120", ["SSC-AS"]),
    C("ECON-3130", ["SSC-AS", "SDS-AS"], { credits: 4 }),
    C("ECON-3140", ["SSC-AS", "SDS-AS"], { credits: 4 }),
    C("ECON-3120", ["SDS-AS"], { credits: 4 }),
    C("ECON-3810", ["SSC-AS", "HST-AS"]),
    C("ECON-4020", ["SSC-AS", "GLC-AS"]),
    C("ECON-3350", ["SSC-AS", "ETM-AS"]),
    C("ECON-4610", ["SSC-AS"]),
    C("ECON-3030", ["SSC-AS", "SDS-AS"]),
    C("ECON-3040", ["SSC-AS"]),
    C("BIOG-1440", ["BIO-AS", "PHS-AS"], { credits: 4 }),
    C("BIOG-1445", ["BIO-AS"], { credits: 4 }),
    C("PHYS-1112", ["PHS-AS", "SDS-AS"], { credits: 4 }),
    C("CHEM-2070", ["PHS-AS"], { credits: 4 }),
    C("PHIL-1100", ["ETM-AS", "ALC-AS"]),
    C("PHIL-2310", ["ETM-AS", "SCD-AS"]),
    C("ENGL-2800", ["ALC-AS", "SCD-AS"]),
    C("ENGL-2010", ["ALC-AS", "HST-AS"]),
    C("HIST-1530", ["HST-AS", "SCD-AS", "GLC-AS"], { credits: 4 }),
    C("ASIAN-1191", ["GLC-AS", "HST-AS"]),
    C("GOVT-1111", ["SSC-AS", "GLC-AS"]),
    C("GOVT-1313", ["SSC-AS", "SCD-AS"]),
    C("SOC-1101", ["SSC-AS", "SCD-AS"]),
    C("PSYCH-1101", ["SSC-AS", "BIO-AS"]),
    C("CS-1110", ["SMR-AS", "SDS-AS"], { credits: 4 }),
    C("STSCI-2150", ["SDS-AS"], { credits: 4 }),
    C("MUSIC-1100", ["ALC-AS"]),
    C("ARTH-1100", ["ALC-AS", "HST-AS"]),
    C("ANTHR-1400", ["SCD-AS", "GLC-AS"]),
    C("ASTRO-1101", ["PHS-AS"], { credits: 4 }),
    C("AEM-2200", []),
    C("PE-1100", [], { credits: 0 }),
    C("ECON-3510", ["SSC-AS"]),
    C("ECON-4150", ["SSC-AS", "SDS-AS"]),
    C("ILRLE-2400", ["SSC-AS"]),
    C("FGSS-2010", ["SCD-AS", "ETM-AS"]),
    C("ENGL-1170", ["FWS", "ALC-AS"]),
  ];
  const anything: CourseRule = { not: { tag: ["NEVER"] } };
  const college = layer("cas-college", [
    pool("fws", tag("FWS"), 2, 6, { exclusive: true, group: "First-Year Writing" }),
    anyOf(
      "language",
      [
        pool("option1", { allOf: [tag("LANG"), { number: { min: 2000 } }] }, 1, 3),
        credits("option2", tag("LANG"), 11, { sameSubject: true }),
      ],
      { overlay: true }
    ),
    dist("distribution", cats(...CAS_TAGS), {
      rule: { not: { creditKind: ["ap", "ib", "transfer"] } },
      requiredCourses: 8,
      minDistinctCategories: 10,
      maxCategoriesPerCourse: 2,
      maxDoubleCountCourses: 2,
      maxPerSubject: undefined,
    }),
    credits("total", anything, 120),
    credits("cas", { not: { subject: ["AEM", "ILRLE"] } }, 100),
    confirm("letter-graded"),
    confirm("residency"),
  ]);
  const major = layer(
    "econ",
    [
      seat("micro", { course: ["ECON-1110"] }),
      seat("macro", { course: ["ECON-1120"] }),
      seat("calc", { anyOf: [{ course: ["MATH-1110"] }, { course: ["MATH-1120"] }] }),
      seat("int-micro", { anyOf: [{ course: ["ECON-3030"] }, { course: ["ECON-3130"] }] }),
      seat("int-macro", { anyOf: [{ course: ["ECON-3040"] }, { course: ["ECON-3140"] }] }),
      seat("metrics", { anyOf: [{ course: ["ECON-3120"] }, { course: ["ECON-3140"] }] }),
      pool("electives", { allOf: [{ subject: ["ECON"] }, { number: { min: 3000 } }] }, 5, 15, {
        limits: [{ rule: { number: { min: 4000 } }, minCourses: 1 }],
      }),
      pool("stats", tag("SDS-AS"), 1, 3),
    ],
    "major"
  );
  const concentration = layer(
    "econ--policy",
    [pool("policy", { anyOf: [{ subject: ["GOVT"] }, { subject: ["ECON"] }, { subject: ["SOC"] }] }, 3, 9, { maxPerSubject: 2 })],
    "concentration"
  );
  return { layers: [college, major, concentration], courses, ctx };
}

describe("performance", () => {
  it("a realistic CAS board solves exactly under the default cap, well under a second", () => {
    const input = casInput();
    const t0 = performance.now();
    const res = solveLayers(input);
    const ms = performance.now() - t0;
    expect(res.capped).toBe(false);
    expect(ms).toBeLessThan(1000);
    expect(rowOf(res, "cas-college", "distribution").status).toBe("met");
    expect(rowOf(res, "cas-college", "fws").status).toBe("met");
    expect(rowOf(res, "cas-college", "language").status).toBe("met");
    for (const id of ["micro", "macro", "calc", "int-micro", "int-macro", "metrics", "electives", "stats"]) {
      expect(rowOf(res, "econ", id).status).toBe("met");
    }
    expect(res.nodes).toBeLessThan(DEFAULT_NODE_CAP);
    // FWS courses count nowhere else except the credit totals.
    expect(res.attribution["HIST-1200"]).toEqual([
      { layerId: "cas-college", rowId: "fws" },
      { layerId: "cas-college", rowId: "total" },
      { layerId: "cas-college", rowId: "cas" },
    ]);
  });

  it("a 14-row major with a catch-all pool never caps and stays fast on 40 seeded 48-course boards", () => {
    const r = rng(2026);
    let worst = 0;
    let cappedBoards = 0;
    let maxNodes = 0;
    for (let b = 0; b < 40; b++) {
      const { layer: major, courses } = randomMajorBoard(r);
      const t0 = performance.now();
      const res = solveLayers({ layers: [major], courses, ctx });
      worst = Math.max(worst, performance.now() - t0);
      maxNodes = Math.max(maxNodes, res.nodes);
      if (res.capped) cappedBoards++;
    }
    expect(cappedBoards).toBe(0);
    expect(worst).toBeLessThan(300);
  });

  it("a major + separate concentration as one counting group (29 consuming rows) on 40 seeded 50-course boards: fast, rarely capped", () => {
    const r = rng(2027);
    let worstExact = 0;
    let worstCapped = 0;
    let cappedBoards = 0;
    for (let b = 0; b < 40; b++) {
      const { major, concentration, courses } = majorWithConcentrationBoard(r);
      const t0 = performance.now();
      const res = solveLayers({ layers: [major, concentration], courses, ctx: { programId: "p" } });
      const ms = performance.now() - t0;
      if (res.capped) {
        cappedBoards++;
        worstCapped = Math.max(worstCapped, ms);
        for (const l of res.layers) for (const row of l.rows) if (row.status === "unchecked") expect(row.reason).toBe("node-cap");
      } else {
        worstExact = Math.max(worstExact, ms);
      }
      // One group: no course counts in two consuming rows across the two layers.
      const overlay = new Set(["upper-any", "c-upper"]);
      const counted = res.layers.flatMap((l) => l.rows.filter((row) => !overlay.has(row.rowId)).flatMap((row) => ids(row)));
      expect(new Set(counted).size).toBe(counted.length);
    }
    // The same budget as the CALS boards below: a group is one layer's search.
    expect(cappedBoards).toBeLessThanOrEqual(2);
    expect(worstExact).toBeLessThan(500);
    expect(worstCapped).toBeLessThan(2000);
  });

  it("real CALS pre-2025 layer + a random 12-row major on 40 seeded 50-course boards: fast, rarely capped, never a false green", () => {
    const college = calsPre2025 as unknown as Layer;
    let worstExact = 0;
    let worstCapped = 0;
    let cappedBoards = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { major, courses } = calsPreMajorBoard(rng(seed));
      const t0 = performance.now();
      // solve() runs the independent checker: a capped board must still never
      // show a "met" it cannot prove.
      const res = solveChecked({ layers: [college, major], courses, ctx: { programId: "p", entryTerm: "FA24", transfer: "none" } });
      const ms = performance.now() - t0;
      expect(res.verifyLog).toEqual([]);
      if (res.capped) {
        cappedBoards++;
        worstCapped = Math.max(worstCapped, ms);
        for (const row of res.layers[1].rows) if (row.status === "unchecked") expect(row.reason).toBe("node-cap");
      } else {
        worstExact = Math.max(worstExact, ms);
      }
    }
    // Two of these boards are credit-packing cases the bounds cannot settle
    // within the node budget; they cap (and stay correct) instead of hanging.
    expect(cappedBoards).toBeLessThanOrEqual(2);
    expect(worstExact).toBeLessThan(500);
    expect(worstCapped).toBeLessThan(2000);
  });

  it("stress: a distribution row contending with overlapping pools in one layer stays exact", () => {
    const input = casInput();
    // One layer where the 10-category distribution competes with four pools
    // and two seats over the same multi-tagged courses.
    const contested = layer("contested", [
      dist("distribution", cats(...CAS_TAGS), {
        requiredCourses: 8,
        minDistinctCategories: 10,
        maxCategoriesPerCourse: 2,
        maxDoubleCountCourses: 2,
      }),
      pool("social", tag("SSC-AS"), 4, 12),
      pool("quant", tag("SDS-AS", "SMR-AS"), 3, 9),
      pool("humanities", tag("ALC-AS", "HST-AS"), 3, 9, { maxPerSubject: 1 }),
      pool("science", tag("PHS-AS", "BIO-AS"), 2, 7),
      seat("ethics", tag("ETM-AS")),
      seat("diversity", tag("SCD-AS")),
    ]);
    const t0 = performance.now();
    const res = solveLayers({ ...input, layers: [input.layers[0], contested] });
    const ms = performance.now() - t0;
    expect(res.capped).toBe(false);
    expect(ms).toBeLessThan(1000);
    const rows = res.layers[1].rows;
    expect(rows.every((r) => r.status === "met")).toBe(true);
    // A course counts once inside the layer.
    const counted = rows.flatMap((r) => r.courses.map((c) => c.courseId));
    expect(new Set(counted).size).toBe(counted.length);
  });
});
