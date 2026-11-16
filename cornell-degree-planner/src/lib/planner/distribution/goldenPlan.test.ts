import { describe, it, expect, vi, afterEach } from "vitest";
import * as engineEntry from "./index";
import { describeGoldenFailure, runGoldenPlan, type GoldenFixture } from "./goldenPlan";
import type { ConfirmRow, CourseRule, DistCourse, DistributionResult, Layer, PoolRow, Row, SeatRow } from "./types";

// The real solver by default; one test swaps in a result the engine could not
// prove, which small synthetic layers never produce on their own.
vi.mock("./index", async (importOriginal) => {
  const real = await importOriginal<typeof import("./index")>();
  return { ...real, solve: vi.fn(real.solve) };
});

afterEach(() => {
  vi.mocked(engineEntry.solve).mockClear();
});

// ─── builders ────────────────────────────────────────────────────────────────

const C = (id: string, tags: string[] = [], credits = 3): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits, attrs: tags.map((value) => ({ value })) };
};

const source = { url: "https://example.edu/catalog", anchor: "req" };
const base = (id: string) => ({ id, label: id, group: "Test", source });
const seat = (id: string, rule: CourseRule): SeatRow => ({ ...base(id), kind: "seat", rule });
const pool = (id: string, rule: CourseRule, requiredCourses: number, requiredCredits: number): PoolRow => ({
  ...base(id),
  kind: "pool",
  rule,
  requiredCourses,
  requiredCredits,
});
const confirm = (id: string): ConfirmRow => ({ ...base(id), kind: "confirm" });

const major = (rows: Row[]): Layer => ({
  id: "golden-test-major",
  kind: "major",
  family: "cas",
  name: "Golden Test Major",
  catalogYear: "2026-27",
  programId: "golden-test-major",
  rows,
});

const COURSES = [C("AAA-1000"), C("BBB-2000", ["X"]), C("BBB-2100", ["X"]), C("CCC-3000", ["X"]), C("DDD-4000")];

const fixture = (plan: string[], courses: DistCourse[] = COURSES): GoldenFixture => ({
  programId: "golden-test-major",
  description: "synthetic",
  layerIds: ["golden-test-major"],
  ctx: { programId: "golden-test-major", entryTerm: "FA26", transfer: "none" },
  plan,
  courses,
});

const LAYER = major([seat("intro", { course: ["AAA-1000"] }), pool("core", { tag: ["X"] }, 2, 6)]);

// ─── tests ───────────────────────────────────────────────────────────────────

describe("runGoldenPlan", () => {
  it("passes a minimal plan that meets every row", () => {
    const r = runGoldenPlan([LAYER], fixture(["AAA-1000", "BBB-2000", "BBB-2100"]));
    expect(r).toEqual({
      programId: "golden-test-major",
      ok: true,
      pct: 100,
      unmetRows: [],
      notLoadBearing: [],
      unknownCourses: [],
      forbiddenCounted: [],
    });
    expect(describeGoldenFailure(r)).toEqual([]);
  });

  it("flags slack: a course whose removal keeps the plan at 100%", () => {
    const r = runGoldenPlan([LAYER], fixture(["AAA-1000", "BBB-2000", "BBB-2100", "CCC-3000", "DDD-4000"]));
    expect(r.ok).toBe(false);
    expect(r.pct).toBe(100);
    expect(r.unmetRows).toEqual([]);
    // Any one of the three X courses can go (the other two still fill core);
    // DDD-4000 counts for nothing at all.
    expect(r.notLoadBearing).toEqual(["BBB-2000", "BBB-2100", "CCC-3000", "DDD-4000"]);
    expect(describeGoldenFailure(r)).toContain("golden-test-major: DDD-4000 is not load-bearing (removing it keeps 100%)");
  });

  it("reports a row the plan does not meet", () => {
    const r = runGoldenPlan([LAYER], fixture(["AAA-1000", "BBB-2000"]));
    expect(r.ok).toBe(false);
    expect(r.pct).toBeLessThan(100);
    expect(r.unmetRows).toEqual([{ layerId: "golden-test-major", rowId: "core", status: "partial" }]);
  });

  it("reports plan ids missing from the course data, without solving on them", () => {
    const r = runGoldenPlan([LAYER], fixture(["AAA-1000", "BBB-2000", "BBB-2100", "ZZZ-9999"]));
    expect(r.ok).toBe(false);
    expect(r.unknownCourses).toEqual(["ZZZ-9999"]);
    expect(r.unmetRows).toEqual([]);
    expect(r.notLoadBearing).toEqual([]);
    expect(describeGoldenFailure(r)).toEqual(["golden-test-major: ZZZ-9999 has no course data"]);
  });

  it("ignores confirm rows: never checkable, never unmet", () => {
    const layer = major([seat("intro", { course: ["AAA-1000"] }), confirm("advisor")]);
    const r = runGoldenPlan([layer], fixture(["AAA-1000"]));
    expect(r.ok).toBe(true);
    expect(r.pct).toBe(100);
  });

  it("a layer of confirm rows only passes with the empty plan, and only with it", () => {
    const layer = major([confirm("track-choice"), confirm("grades")]);
    const empty = runGoldenPlan([layer], fixture([]));
    expect(empty.ok).toBe(true);
    expect(empty.pct).toBe(0);
    // Any course in such a plan is slack: nothing can use it.
    const padded = runGoldenPlan([layer], fixture(["AAA-1000"]));
    expect(padded.ok).toBe(false);
    expect(padded.notLoadBearing).toEqual(["AAA-1000"]);
    // A layer with a checkable row still needs 100%.
    expect(runGoldenPlan([LAYER], fixture([])).ok).toBe(false);
  });

  it("fails a row the engine could not check", () => {
    const real = vi.mocked(engineEntry.solve).getMockImplementation()!;
    vi.mocked(engineEntry.solve).mockImplementationOnce((input) => {
      const res: DistributionResult = real(input);
      const rows = res.layers[0].rows.map((row) => (row.rowId === "core" ? { ...row, status: "unchecked" as const, fraction: 0 } : row));
      return { ...res, layers: [{ ...res.layers[0], rows }], pct: 50 };
    });
    const r = runGoldenPlan([LAYER], fixture(["AAA-1000", "BBB-2000", "BBB-2100"]));
    expect(r.ok).toBe(false);
    expect(r.unmetRows).toEqual([{ layerId: "golden-test-major", rowId: "core", status: "unchecked" }]);
    expect(r.pct).toBe(50);
  });

  it("solves with no waivers and the plan in plan order", () => {
    runGoldenPlan([LAYER], fixture(["BBB-2100", "AAA-1000", "BBB-2000"]));
    const first = vi.mocked(engineEntry.solve).mock.calls[0][0];
    expect(first.waived).toEqual([]);
    expect(first.courses.map((c) => c.id)).toEqual(["BBB-2100", "AAA-1000", "BBB-2000"]);
    // One full solve plus one per plan course.
    expect(vi.mocked(engineEntry.solve).mock.calls).toHaveLength(4);
  });
});

// ─── negative probes (mustNotCount) ─────────────────────────────────────────

const anyOf = (id: string, rows: (SeatRow | PoolRow)[]): Row => ({ ...base(id), kind: "anyOf", rows });

const probeFixture = (plan: string[], mustNotCount: GoldenFixture["mustNotCount"], courses: DistCourse[]): GoldenFixture => ({
  ...fixture(plan, courses),
  mustNotCount,
});

describe("runGoldenPlan negative probes", () => {
  // A 2-course elective pool where at most one course may be numbered 2000–2999.
  const ELECTIVE_COURSES = [C("AAA-1000"), C("EEE-2100", ["X"]), C("EEE-2200", ["X"]), C("EEE-3100", ["X"])];
  const withLimit = (limited: boolean) =>
    major([
      seat("intro", { course: ["AAA-1000"] }),
      {
        ...pool("electives", { tag: ["X"] }, 2, 6),
        ...(limited ? { limits: [{ rule: { number: { min: 2000, max: 2999 } }, maxCourses: 1 }] } : {}),
      },
    ]);
  const secondLowLevel = [{ courseId: "EEE-2200", rowId: "electives", why: "only one 2000-level course counts" }];

  it("a lost 'at most one' limit: the plan alone passes either way, the probe tells them apart", () => {
    const plan = ["AAA-1000", "EEE-2100", "EEE-3100"];
    // Without the probe the loose layer passes: the plan never needs a second 2000-level course.
    expect(runGoldenPlan([withLimit(false)], fixture(plan, ELECTIVE_COURSES)).ok).toBe(true);
    const tight = runGoldenPlan([withLimit(true)], probeFixture(plan, secondLowLevel, ELECTIVE_COURSES));
    expect(tight.ok).toBe(true);
    expect(tight.forbiddenCounted).toEqual([]);
    const loose = runGoldenPlan([withLimit(false)], probeFixture(plan, secondLowLevel, ELECTIVE_COURSES));
    expect(loose.ok).toBe(false);
    expect(loose.pct).toBe(100);
    expect(loose.notLoadBearing).toEqual([]);
    expect(loose.forbiddenCounted).toEqual([{ courseId: "EEE-2200", layerId: "golden-test-major", rowId: "electives" }]);
  });

  it("a dropped exclusion: an independent-study number the pool must not take", () => {
    const courses = [C("AAA-1000"), C("EEE-4100", ["X"]), C("EEE-4200", ["X"]), C("EEE-4990", ["X"])];
    const layerFor = (rule: CourseRule) => major([seat("intro", { course: ["AAA-1000"] }), pool("advanced", rule, 2, 6)]);
    const probes = [{ courseId: "EEE-4990", rowId: "advanced", why: "independent study is excluded" }];
    const plan = ["AAA-1000", "EEE-4100", "EEE-4200"];
    const tight = layerFor({ allOf: [{ tag: ["X"] }, { not: { course: ["EEE-4990"] } }] });
    expect(runGoldenPlan([tight], probeFixture(plan, probes, courses)).ok).toBe(true);
    const loose = runGoldenPlan([layerFor({ tag: ["X"] })], probeFixture(plan, probes, courses));
    expect(loose.forbiddenCounted).toEqual([{ courseId: "EEE-4990", layerId: "golden-test-major", rowId: "advanced" }]);
  });

  it("a missing level floor: a 1000-level course in a 4000-level pool", () => {
    const courses = [C("AAA-1000"), C("EEE-4100"), C("EEE-4200"), C("EEE-1100")];
    const layerFor = (rule: CourseRule) => major([seat("intro", { course: ["AAA-1000"] }), pool("advanced", rule, 2, 6)]);
    const probes = [{ courseId: "EEE-1100", rowId: "advanced", why: "4000-level only" }];
    const plan = ["AAA-1000", "EEE-4100", "EEE-4200"];
    expect(runGoldenPlan([layerFor({ allOf: [{ subject: ["EEE"] }, { number: { min: 4000 } }] })], probeFixture(plan, probes, courses)).ok).toBe(
      true,
    );
    const loose = runGoldenPlan([layerFor({ subject: ["EEE"] })], probeFixture(plan, probes, courses));
    expect(loose.forbiddenCounted.map((f) => f.courseId)).toEqual(["EEE-1100"]);
  });

  it("a seat gives up its plan course so the probe can be tried in its place", () => {
    const courses = [C("AAA-1000"), C("AAA-1500"), C("BBB-2000", ["X"]), C("BBB-2100", ["X"])];
    const layerFor = (rule: CourseRule) => major([seat("intro", rule), pool("core", { tag: ["X"] }, 2, 6)]);
    const probes = [{ courseId: "AAA-1500", rowId: "intro", why: "only the named course" }];
    const plan = ["AAA-1000", "BBB-2000", "BBB-2100"];
    expect(runGoldenPlan([layerFor({ course: ["AAA-1000"] })], probeFixture(plan, probes, courses)).ok).toBe(true);
    const loose = runGoldenPlan([layerFor({ subject: ["AAA"] })], probeFixture(plan, probes, courses));
    expect(loose.forbiddenCounted).toEqual([{ courseId: "AAA-1500", layerId: "golden-test-major", rowId: "intro" }]);
  });

  it("anyOf: an option probe is keyed parent/child and tried on that option only; a parent probe on every option", () => {
    const courses = [C("AAA-1000"), C("MMM-1110"), C("SSS-2150"), C("SSS-3010")];
    const layerFor = (statsRule: CourseRule) =>
      major([
        seat("intro", { course: ["AAA-1000"] }),
        anyOf("quant", [
          { ...seat("quant-calc", { course: ["MMM-1110"] }) },
          { ...seat("quant-stats", statsRule) },
        ]),
      ]);
    const plan = ["AAA-1000", "MMM-1110"];
    const onStats = [{ courseId: "SSS-3010", rowId: "quant/quant-stats", why: "only the intro statistics course" }];
    const onCalc = [{ courseId: "SSS-3010", rowId: "quant/quant-calc", why: "not a calculus course" }];
    const onParent = [{ courseId: "SSS-3010", rowId: "quant", why: "neither option takes it" }];
    const tight = layerFor({ course: ["SSS-2150"] });
    const loose = layerFor({ subject: ["SSS"] });
    expect(runGoldenPlan([tight], probeFixture(plan, onStats, courses)).ok).toBe(true);
    expect(runGoldenPlan([tight], probeFixture(plan, onParent, courses)).ok).toBe(true);
    // The loose statistics option (not the one the plan uses) is caught by name …
    expect(runGoldenPlan([loose], probeFixture(plan, onStats, courses)).forbiddenCounted).toEqual([
      { courseId: "SSS-3010", layerId: "golden-test-major", rowId: "quant/quant-stats" },
    ]);
    // … and through the parent id, but not on the calculus option.
    expect(runGoldenPlan([loose], probeFixture(plan, onParent, courses)).forbiddenCounted.map((f) => f.rowId)).toEqual(["quant"]);
    expect(runGoldenPlan([loose], probeFixture(plan, onCalc, courses)).forbiddenCounted).toEqual([]);
  });

  it("a probe course missing from the course data is unknown and not solved on", () => {
    const probes = [{ courseId: "ZZZ-9999", rowId: "core", why: "x" }];
    const r = runGoldenPlan([LAYER], probeFixture(["AAA-1000", "BBB-2000", "BBB-2100"], probes, COURSES));
    expect(r.ok).toBe(false);
    expect(r.unknownCourses).toEqual(["ZZZ-9999"]);
    expect(r.forbiddenCounted).toEqual([]);
    expect(vi.mocked(engineEntry.solve).mock.calls.every(([input]) => input.courses.every((c) => c.id !== "ZZZ-9999"))).toBe(true);
  });

  it("a probe naming no row (or an option of a non-anyOf row) throws", () => {
    const plan = ["AAA-1000", "BBB-2000", "BBB-2100"];
    expect(() => runGoldenPlan([LAYER], probeFixture(plan, [{ courseId: "DDD-4000", rowId: "nope", why: "x" }], COURSES))).toThrow(
      /no row "nope"/,
    );
    expect(() => runGoldenPlan([LAYER], probeFixture(plan, [{ courseId: "DDD-4000", rowId: "core/x", why: "x" }], COURSES))).toThrow(
      /no row "core\/x"/,
    );
  });

  it("probes leave the load-bearing check alone and are appended after the plan in fixture order", () => {
    const plan = ["AAA-1000", "BBB-2000", "BBB-2100", "CCC-3000"];
    const probes = [
      { courseId: "DDD-4000", rowId: "core", why: "untagged" },
      { courseId: "AAA-1000", rowId: "core", why: "already in the plan" },
      { courseId: "CCC-3000", rowId: "intro", why: "not the intro course" },
    ];
    const without = runGoldenPlan([LAYER], fixture(plan));
    vi.mocked(engineEntry.solve).mockClear();
    const withProbes = runGoldenPlan([LAYER], probeFixture(plan, probes, COURSES));
    expect(withProbes.notLoadBearing).toEqual(without.notLoadBearing);
    expect(withProbes.unmetRows).toEqual(without.unmetRows);
    expect(withProbes.pct).toBe(without.pct);
    const calls = vi.mocked(engineEntry.solve).mock.calls.map(([input]) => input.courses.map((c) => c.id));
    // The plan alone, then one solve per plan course without it, before any probe course is seen.
    expect(calls[0]).toEqual(plan);
    for (let i = 1; i <= plan.length; i++) expect(calls[i].every((id) => plan.includes(id))).toBe(true);
    // (a): every probe course not already in the plan, after the plan, in fixture order.
    expect(calls[plan.length + 1]).toEqual([...plan, "DDD-4000"]);
    expect(withProbes.forbiddenCounted).toEqual([]);
  });

  it("describeGoldenFailure names the row, the course and the fixture's reason", () => {
    const plan = ["AAA-1000", "EEE-2100", "EEE-3100"];
    const fx = probeFixture(plan, secondLowLevel, ELECTIVE_COURSES);
    const r = runGoldenPlan([withLimit(false)], fx);
    expect(describeGoldenFailure(r, fx)).toEqual([
      "golden-test-major: row golden-test-major:electives counts EEE-2200, which it must not (only one 2000-level course counts)",
    ]);
    expect(describeGoldenFailure(r)).toEqual(["golden-test-major: row golden-test-major:electives counts EEE-2200, which it must not"]);
  });
});

// ─── answers (spec 020 questions) ───────────────────────────────────────────

describe("runGoldenPlan answers", () => {
  const APPROVED = "approvedFor:golden-test-major/approved";
  const CREDITS = "creditsTaken:DDD-4000";
  const QSRC = { source, quote: "Invented." };
  const layer: Layer = {
    ...major([
      pool("approved", { allOf: [{ tag: ["X"] }, { answered: APPROVED }] }, 1, 0),
      { ...base("research"), kind: "pool", rule: { course: ["DDD-4000"] }, requiredCourses: 1, requiredCredits: 4 },
    ]),
    questions: [
      { ...QSRC, type: "approvedFor", row: "approved", approver: "director", courses: { tag: ["X"] } },
      { ...QSRC, type: "creditsTaken", course: "DDD-4000", values: [3, 4] },
    ],
  };
  const answered = (marks: Record<string, "yes" | "no" | number>): GoldenFixture => ({
    ...fixture(["BBB-2000", "DDD-4000"]),
    answers: { marks, facts: {} },
  });

  it("solves the app's way: credit marks applied to the courses, the answers passed to solve", () => {
    const r = runGoldenPlan([layer], answered({ [`${APPROVED}@BBB-2000`]: "yes", [CREDITS]: 4 }));
    expect(r.ok).toBe(true);
    const first = vi.mocked(engineEntry.solve).mock.calls[0][0];
    expect(first.answers?.marks[CREDITS]).toBe(4);
    expect(first.courses.find((c) => c.id === "DDD-4000")?.credits).toBe(4);
    expect(r.metByAnswer).toEqual([
      { layerId: "golden-test-major", rowId: "approved", without: "unmet", answers: [`${APPROVED}@BBB-2000`] },
      { layerId: "golden-test-major", rowId: "research", without: "partial", answers: [CREDITS] },
    ]);
    expect(r.answersNotLoadBearing).toEqual([]);
    expect(describeGoldenFailure(r)).toEqual([]);
  });

  it("without the answers the rows stay short; a credit value outside the question's values is a problem", () => {
    expect(runGoldenPlan([layer], fixture(["BBB-2000", "DDD-4000"])).unmetRows.map((u) => u.rowId)).toEqual(["approved", "research"]);
    const bad = runGoldenPlan([layer], answered({ [`${APPROVED}@BBB-2000`]: "yes", [CREDITS]: 5 }));
    expect(bad.ok).toBe(false);
    expect(bad.answerProblems).toEqual([`answers.marks "${CREDITS}" must be one of the question's credit values (3, 4)`]);
  });

  it("a probe is still tried, with the plan's answers, and never gets an answer of its own", () => {
    const probes = [{ courseId: "CCC-3000", rowId: "approved", why: "not approved" }];
    const fx = { ...answered({ [`${APPROVED}@BBB-2000`]: "yes", [CREDITS]: 4 }), mustNotCount: probes };
    const r = runGoldenPlan([layer], fx);
    expect(r.forbiddenCounted).toEqual([]);
    expect(r.ok).toBe(true);
    const probeSolves = vi.mocked(engineEntry.solve).mock.calls.filter(([i]) => i.courses.some((c) => c.id === "CCC-3000"));
    expect(probeSolves.length).toBeGreaterThan(0);
    for (const [i] of probeSolves) expect(Object.keys(i.answers?.marks ?? {}).some((k) => k.endsWith("@CCC-3000"))).toBe(false);
  });
});
