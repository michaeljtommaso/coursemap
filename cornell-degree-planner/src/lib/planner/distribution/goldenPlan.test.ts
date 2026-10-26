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
    expect(r).toEqual({ programId: "golden-test-major", ok: true, pct: 100, unmetRows: [], notLoadBearing: [], unknownCourses: [] });
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
