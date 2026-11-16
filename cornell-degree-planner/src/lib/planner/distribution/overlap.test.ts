import { describe, it, expect } from "vitest";
import {
  enforceOverlap,
  holdBackLayers,
  heldByLayer,
  measurePairs,
  pairLimit,
  pairLimitWithSource,
  stripHeldPlacements,
  type CountedByProgram,
  type HeldEntry,
  type OverlapProgram,
} from "./overlap";
import { solve } from "./index";
import type { DistCourse, Layer } from "./types";

// ── Programs ─────────────────────────────────────────────────────────────────
const major = (id: string, over: Partial<OverlapProgram> = {}): OverlapProgram => ({
  id,
  kind: "major",
  layerIds: [id],
  holdable: true,
  ...over,
});
const minor = (id: string, over: Partial<OverlapProgram> = {}): OverlapProgram => ({
  id,
  kind: "minor",
  layerIds: [id],
  holdable: true,
  ...over,
});

describe("pairLimit (spec 047 D7/D14)", () => {
  it("no sharing on either side → no limit", () => {
    expect(pairLimit(major("test-econ"), minor("test-minor-data"))).toBeNull();
  });

  it("a minor's otherMajors limit applies toward a major; its minors limit toward a minor", () => {
    const m = minor("test-minor-data", { sharing: { otherMajors: { maxCourses: 2 }, minors: "none" } });
    expect(pairLimitWithSource(major("test-econ"), m)).toEqual({ limit: { maxCourses: 2 }, from: "test-minor-data" });
    expect(pairLimit(minor("test-minor-art"), m)).toBe("none");
  });

  it("the stricter side wins, and names itself", () => {
    const a = major("test-econ", { sharing: { minors: { maxCourses: 1 } } });
    const b = minor("test-minor-data", { sharing: { otherMajors: { maxCourses: 2, maxCredits: 6 } } });
    expect(pairLimitWithSource(a, b)).toEqual({ limit: { maxCourses: 1, maxCredits: 6 }, from: "test-econ" });
    const none = minor("test-minor-data", { sharing: { otherMajors: "none" } });
    expect(pairLimitWithSource(a, none)).toEqual({ limit: "none", from: "test-minor-data" });
  });

  it("`with` scopes a cap to the named partners (prefix match, any catalog year)", () => {
    const policy = minor("test-minor-policy", {
      sharing: { otherMajors: { maxCredits: 12, with: ["test-econ", "test-govt"] } },
    });
    expect(pairLimit(major("test-econ-ba-2026"), policy)).toEqual({ maxCredits: 12 });
    expect(pairLimit(major("test-math-ba-2026"), policy)).toBeNull();
    // A prefix must end at a dash: "test-economics" is not "test-econ".
    expect(pairLimit(major("test-economics"), policy)).toBeNull();
  });

  it("forbiddenWith on either side, or otherMajors 'forbidden' toward a major, is forbidden", () => {
    const bio = major("test-bio-ba-2026", { forbiddenWith: ["test-biosoc"] });
    expect(pairLimitWithSource(bio, major("test-biosoc-ba-2026"))).toEqual({ limit: "forbidden", from: "test-bio-ba-2026" });
    expect(pairLimitWithSource(major("test-biosoc-ba-2026"), bio)).toEqual({ limit: "forbidden", from: "test-bio-ba-2026" });
    const solo = major("test-solo", { sharing: { otherMajors: "forbidden" } });
    expect(pairLimit(solo, major("test-econ"))).toBe("forbidden");
    // Toward a minor the major's `minors` field applies instead.
    expect(pairLimit(solo, minor("test-minor-data"))).toBeNull();
  });

  it("an object with no bound is no limit", () => {
    expect(pairLimit(major("test-econ"), minor("test-m", { sharing: { otherMajors: {} } }))).toBeNull();
  });
});

describe("measurePairs", () => {
  it("shared = counted by both, credits the larger; 'forbidden' is reported but never over", () => {
    const programs = [
      major("a", { forbiddenWith: ["c"] }),
      minor("b", { sharing: { otherMajors: { maxCredits: 4 } } }),
      major("c"),
    ];
    const counted: CountedByProgram = new Map([
      ["a", new Map([["X-1", 3], ["X-2", 4]])],
      ["b", new Map([["X-1", 4], ["X-2", 3]])],
      ["c", new Map([["X-1", 3]])],
    ]);
    const pairs = measurePairs(programs, counted);
    expect(pairs.map((p) => [p.a, p.b, p.over])).toEqual([
      ["a", "b", true],
      ["a", "c", false],
      // The minor's limit applies toward every major on the plan: 4 credits shared, within 4.
      ["b", "c", false],
    ]);
    expect(pairs[0].shared).toEqual([
      { courseId: "X-1", credits: 4 },
      { courseId: "X-2", credits: 4 },
    ]);
    expect(pairs[1].limit).toBe("forbidden");
  });
});

// ── The bounded search, on a model solver ────────────────────────────────────
// Each program counts every course of its universe it isn't held back from;
// `value` weighs a course for a program (the score is the weighted sum).
type Model = { counted: CountedByProgram; score: number };
function modelSolver(
  universe: Record<string, string[]>,
  value: (program: string, course: string) => number = () => 1,
  credits: (course: string) => number = () => 3
) {
  let calls = 0;
  const solveHeld = (held: HeldEntry[]): Model => {
    calls++;
    const counted: CountedByProgram = new Map();
    let score = 0;
    for (const [program, courses] of Object.entries(universe)) {
      const map = new Map<string, number>();
      for (const c of courses) {
        if (held.some((h) => h.from === program && h.courseId === c)) continue;
        map.set(c, credits(c));
        score += value(program, c);
      }
      counted.set(program, map);
    }
    return { counted, score };
  };
  return { solveHeld, calls: () => calls };
}

function run(
  programs: OverlapProgram[],
  universe: Record<string, string[]>,
  opts: {
    value?: (p: string, c: string) => number;
    credits?: (c: string) => number;
    countsFor?: Map<string, string>;
    maxResolves?: number;
  } = {}
) {
  const model = modelSolver(universe, opts.value, opts.credits);
  const outcome = enforceOverlap<Model>({
    programs,
    base: model.solveHeld([]),
    solve: model.solveHeld,
    counted: (r) => r.counted,
    score: (r) => r.score,
    cost: (_r, p, c) => (opts.value ?? (() => 1))(p, c),
    ...(opts.countsFor ? { countsFor: opts.countsFor } : {}),
    ...(opts.maxResolves != null ? { maxResolves: opts.maxResolves } : {}),
  });
  return { outcome, calls: model.calls() - 1 };
}

describe("enforceOverlap (spec 047 D7/D8)", () => {
  const econ = major("econ");
  const dataNone = minor("data", { sharing: { otherMajors: "none" } });

  it("a pair within its limit is untouched (no re-solve)", () => {
    const capTwo = minor("data", { sharing: { otherMajors: { maxCourses: 2 } } });
    const { outcome, calls } = run([econ, capTwo], { econ: ["A", "B"], data: ["A", "B", "C"] });
    expect(calls).toBe(0);
    expect(outcome.held).toEqual([]);
    expect(outcome.estimated).toBe(false);
    expect(outcome.pairs[0].shared.map((s) => s.courseId)).toEqual(["A", "B"]);
  });

  it("'none': every shared course is held back from one side, the cheaper side chosen", () => {
    // A matters more to econ, B more to data.
    const value = (p: string, c: string) => (c === "A" ? (p === "econ" ? 5 : 1) : c === "B" ? (p === "data" ? 5 : 1) : 1);
    const { outcome } = run([econ, dataNone], { econ: ["A", "B", "E"], data: ["A", "B", "D"] }, { value });
    expect(outcome.unresolved).toBe(false);
    expect(outcome.estimated).toBe(false);
    expect(outcome.pairs[0].shared).toEqual([]);
    const held = outcome.held.map((h) => `${h.courseId}<-${h.from}`).sort();
    expect(held).toEqual(["A<-data", "B<-econ"]);
    expect(outcome.held.every((h) => h.pair === "econ|data")).toBe(true);
  });

  it("a course cap holds back only the excess, keeping the best total", () => {
    const capOne = minor("data", { sharing: { otherMajors: { maxCourses: 1 } } });
    const value = (p: string, c: string) => (p === "data" && c === "C" ? 9 : 1);
    const { outcome } = run([econ, capOne], { econ: ["A", "B", "C"], data: ["A", "B", "C"] }, { value });
    expect(outcome.pairs[0].shared).toHaveLength(1);
    expect(outcome.held).toHaveLength(2);
    // C is worth most to data: it is never held back from data.
    expect(outcome.held.some((h) => h.courseId === "C" && h.from === "data")).toBe(false);
  });

  it("a credit cap counts credits", () => {
    const capCredits = minor("data", { sharing: { otherMajors: { maxCredits: 4 } } });
    const credits = (c: string) => (c === "A" ? 4 : 3);
    const { outcome } = run([econ, capCredits], { econ: ["A", "B", "C"], data: ["A", "B", "C"] }, { credits });
    const sharedCredits = outcome.pairs[0].shared.reduce((s, c) => s + c.credits, 0);
    expect(sharedCredits).toBeLessThanOrEqual(4);
    expect(outcome.unresolved).toBe(false);
  });

  it("a countsFor choice narrows the combinations (never held back from the chosen program)", () => {
    // Without a choice, A (cheap for data) is held back from data.
    const value = (p: string) => (p === "econ" ? 5 : 1);
    const free = run([econ, dataNone], { econ: ["A"], data: ["A"] }, { value }).outcome;
    expect(free.held).toEqual([{ courseId: "A", from: "data", pair: "econ|data" }]);
    const chosen = run([econ, dataNone], { econ: ["A"], data: ["A"] }, { value, countsFor: new Map([["A", "data"]]) })
      .outcome;
    expect(chosen.held).toEqual([{ courseId: "A", from: "econ", pair: "econ|data" }]);
  });

  it("a countsFor choice is inert while the pair is within its limit", () => {
    const capTwo = minor("data", { sharing: { otherMajors: { maxCourses: 2 } } });
    const { outcome } = run([econ, capTwo], { econ: ["A"], data: ["A"] }, { countsFor: new Map([["A", "data"]]) });
    expect(outcome.held).toEqual([]);
    expect(outcome.pairs[0].shared.map((s) => s.courseId)).toEqual(["A"]);
  });

  it("a program that can't re-solve (an Engineering primary) never gives a course up", () => {
    const eng = major("eng", { holdable: false });
    const value = (p: string) => (p === "eng" ? 1 : 5);
    const { outcome } = run([eng, dataNone], { eng: ["A", "B"], data: ["A", "B"] }, { value });
    expect(outcome.held.every((h) => h.from === "data")).toBe(true);
    expect(outcome.pairs[0].shared).toEqual([]);
  });

  it("a choice for the side that can't give a course up still lets the limit win", () => {
    const eng = major("eng", { holdable: false });
    const { outcome } = run([eng, dataNone], { eng: ["A"], data: ["A"] }, { countsFor: new Map([["A", "data"]]) });
    expect(outcome.held).toEqual([{ courseId: "A", from: "data", pair: "eng|data" }]);
    expect(outcome.unresolved).toBe(false);
  });

  it("past the bound: the greedy fallback stays within every limit and never beats the bounded answer", () => {
    const programs = [
      major("econ"),
      major("math", { sharing: { otherMajors: { maxCourses: 1 } } }),
      minor("data", { sharing: { otherMajors: "none", minors: "none" } }),
      minor("art", { sharing: { otherMajors: { maxCourses: 1 } } }),
    ];
    const universe = {
      econ: ["A", "B", "C", "D", "E"],
      math: ["A", "B", "C", "F", "G"],
      data: ["A", "D", "F", "H"],
      art: ["B", "H", "E", "G"],
    };
    const value = (p: string, c: string) => ((p.charCodeAt(0) + c.charCodeAt(0)) % 5) + 1;
    const bounded = run(programs, universe, { value, maxResolves: 5000 }).outcome;
    expect(bounded.unresolved).toBe(false);
    for (const budget of [0, 1, 3, 20]) {
      const { outcome, calls } = run(programs, universe, { value, maxResolves: budget });
      expect(outcome.unresolved).toBe(false);
      expect(outcome.pairs.every((p) => !p.over)).toBe(true);
      expect(outcome.result.score).toBeLessThanOrEqual(bounded.result.score);
      expect(outcome.resolves).toBe(calls);
      if (budget === 0) expect(outcome.estimated).toBe(true);
    }
  });

  it("the default bound is 20 re-solves before the greedy fallback", () => {
    const programs = [
      major("econ"),
      minor("data", { sharing: { otherMajors: { maxCourses: 2 } } }),
      minor("art", { sharing: { otherMajors: { maxCourses: 1 }, minors: { maxCourses: 1 } } }),
    ];
    const courses = ["A", "B", "C", "D", "E", "F", "G"];
    const { outcome, calls } = run(programs, { econ: courses, data: courses, art: courses });
    expect(outcome.unresolved).toBe(false);
    expect(calls).toBe(outcome.resolves);
    if (outcome.estimated) expect(outcome.resolves).toBeGreaterThanOrEqual(20);
    else expect(outcome.resolves).toBeLessThanOrEqual(20);
  });
});

// ── Holding back on the real engine ─────────────────────────────────────────
const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };
const MINOR: Layer = {
  id: "test-minor-data-science",
  kind: "minor",
  family: "other",
  name: "Test data minor",
  catalogYear: "2026-27",
  programId: "test-minor-data-science",
  rows: [
    { id: "intro", kind: "seat", label: "Intro statistics", group: "Core", source: SRC, rule: { course: ["STAT-2000"] } },
    {
      id: "electives",
      kind: "pool",
      label: "Two data electives",
      group: "Electives",
      source: SRC,
      rule: { subject: ["STAT", "CS"] },
      requiredCourses: 2,
      requiredCredits: 6,
    },
    {
      id: "credits",
      kind: "credits",
      label: "Twelve credits",
      group: "Credits",
      source: SRC,
      rule: { subject: ["STAT", "CS"] },
      requiredCredits: 12,
    },
  ],
};
const dc = (id: string, credits = 3): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits };
};

describe("holdBackLayers on the real engine", () => {
  it("a held course counts nowhere in that program's layers, and the checker agrees", () => {
    const courses = [dc("STAT-2000"), dc("CS-1110"), dc("CS-2110"), dc("STAT-3000")];
    const before = solve({ layers: [MINOR], courses, ctx: { programId: "x" } });
    expect(before.layers[0].rows.map((r) => r.status)).toEqual(["met", "met", "met"]);
    const byLayer = heldByLayer(
      [{ courseId: "STAT-2000", from: "test-minor-data-science", pair: "x|test-minor-data-science" }],
      [minor("test-minor-data-science", { layerIds: [MINOR.id] })]
    );
    const after = solve({ layers: holdBackLayers([MINOR], byLayer), courses, ctx: { programId: "x" } });
    expect(after.layers[0].rows.map((r) => r.status)).toEqual(["unmet", "met", "partial"]);
    expect(after.attribution["STAT-2000"]).toBeUndefined();
    expect(after.verifyLog).toEqual([]);
  });

  it("untouched layers keep their identity", () => {
    const other = { ...MINOR, id: "test-minor-other" };
    const out = holdBackLayers([MINOR, other], new Map([[MINOR.id, ["CS-1110"]]]));
    expect(out[1]).toBe(other);
    expect(out[0]).not.toBe(MINOR);
  });

  it("a student-placed credit pointing into a held layer loses that choice", () => {
    const placed: DistCourse = { ...dc("CS-1110"), isCredit: true, placedFor: { row: `${MINOR.id}:electives` } };
    const out = stripHeldPlacements([placed, dc("CS-2110")], new Map([[MINOR.id, ["CS-1110"]]]), (id) => id);
    expect(out[0].placedFor).toBeUndefined();
    const kept = stripHeldPlacements([placed], new Map([["other-layer", ["CS-1110"]]]), (id) => id);
    expect(kept[0]).toBe(placed);
  });
});
