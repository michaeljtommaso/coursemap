/// <reference types="node" />
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";
import type { DistributionResult, Layer, SolveInput } from "./distribution";

// solve() runs for real; one test post-processes its result to force an
// "unchecked" row (a node-cap outcome no small board reaches).
const solveSpy = vi.hoisted(() => ({ tweak: null as null | ((r: DistributionResult) => void), calls: 0 }));
vi.mock("./distribution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./distribution")>();
  return {
    ...actual,
    solve: (input: SolveInput) => {
      solveSpy.calls++;
      const result = actual.solve(input);
      solveSpy.tweak?.(result);
      return result;
    },
  };
});

import {
  computeDistributionProgress,
  findLayerRow,
  layerRowFilterRule,
  type DistributionProgressInput,
} from "./distributionProgress";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "distribution", "fixtures");
const load = (f: string): Layer => LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, f), "utf8"))) as Layer;
const CAS = load("cas-college.json");
const CALS_2025 = load("cals-college-2025.json");
const CALS_PRE = load("cals-college-pre2025.json");

const SRC = { url: "https://example.edu/major", anchor: "Requirements" };
const MAJOR: Layer = {
  id: "test-cas-major",
  kind: "major",
  family: "cas",
  name: "Test Major",
  catalogYear: "2025-26",
  programId: "test-cas-major",
  rows: [
    { id: "intro", kind: "seat", label: "Intro programming", group: "Core", source: SRC, rule: { course: ["CS-1110"] } },
    {
      id: "math",
      kind: "anyOf",
      label: "Calculus (one of two routes)",
      group: "Core",
      source: SRC,
      rows: [
        { id: "math-a", kind: "seat", label: "Route A: MATH 1910", group: "Core", source: SRC, rule: { course: ["MATH-1910"] } },
        {
          id: "math-b",
          kind: "pool",
          label: "Route B: two MATH courses",
          group: "Core",
          source: SRC,
          rule: { subject: ["MATH"] },
          requiredCourses: 2,
          requiredCredits: 8,
        },
      ],
    },
    { id: "advising", kind: "confirm", label: "Meet with a faculty advisor", group: "Core", source: SRC },
    {
      id: "electives",
      kind: "pool",
      label: "Three CS electives",
      group: "Electives",
      source: SRC,
      rule: { allOf: [{ subject: ["CS"] }, { number: { min: 3000 } }] },
      requiredCourses: 3,
      requiredCredits: 9,
    },
    {
      id: "breadth",
      kind: "distribution",
      label: "Breadth: two of three areas",
      group: "Breadth",
      source: SRC,
      categories: [
        { id: "x", label: "Area X", rule: { tag: ["X-T"] } },
        { id: "y", label: "Area Y", rule: { tag: ["Y-T"] } },
        { id: "z", label: "Area Z", rule: { tag: ["Z-T"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
    },
  ],
};

function course(id: string, credits = 3, tags: string[] = [], title?: string): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: title ?? `${subject} ${number}`,
    credits_min: credits,
    credits_max: credits,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: tags.map((value) => ({ value })),
    sections: [],
    components: [],
  } as unknown as Course;
}

function board(courses: Course[]): Pick<DistributionProgressInput, "placements" | "placedCourses"> {
  const placements: Placement[] = courses.map((c, i) => ({ id: `p-${c.id}`, courseId: c.id, sem: 1 + Math.floor(i / 5), order: i % 5 }));
  return { placements, placedCourses: Object.fromEntries(courses.map((c) => [c.id, c])) };
}

function input(over: Partial<DistributionProgressInput> = {}): DistributionProgressInput {
  return {
    layers: [CAS, CALS_2025, CALS_PRE, MAJOR],
    layerErrors: [],
    programId: "test-cas-major",
    family: "cas",
    programStatus: "visible",
    ctx: { entryTerm: "FA26", transfer: "none", transferStanding: null },
    placements: [],
    placedCourses: {},
    creditProfile: [],
    waivedRequirementIds: [],
    ...over,
  };
}

const item = (p: RequirementProgress, id: string): RequirementItem => {
  const it = p.groups.flatMap((g) => g.items).find((i) => i.id === id);
  if (!it) throw new Error(`no item ${id}`);
  return it;
};

// ── Notices ───────────────────────────────────────────────────────────────────
describe("computeDistributionProgress — notices", () => {
  it("a hidden major reads 'under review' and shows no rows", () => {
    const p = computeDistributionProgress(input({ programStatus: "hidden" }));
    expect(p.notice).toEqual({ kind: "under-review" });
    expect(p.groups).toEqual([]);
    expect(p.engine).toBe("distribution");
  });

  it("layers still loading → no rows and no notice", () => {
    const p = computeDistributionProgress(input({ layers: undefined }));
    expect(p.notice).toBeUndefined();
    expect(p.groups).toEqual([]);
    expect(p.engine).toBe("distribution");
  });

  it("asks for the entry term before choosing a CALS curriculum", () => {
    const p = computeDistributionProgress(
      input({ family: "cals", programId: "test-cals-major", ctx: { entryTerm: null, transfer: null, transferStanding: null } })
    );
    expect(p.notice).toEqual({ kind: "needs-entry-term" });
    expect(p.groups).toEqual([]);
  });

  it("asks whether the student transferred when it changes the curriculum", () => {
    const cals = { ...MAJOR, id: "test-cals-major", programId: "test-cals-major", family: "cals" as const };
    const p = computeDistributionProgress(
      input({
        layers: [CALS_2025, CALS_PRE, cals],
        family: "cals",
        programId: "test-cals-major",
        ctx: { entryTerm: "FA25", transfer: null, transferStanding: null },
      })
    );
    expect(p.notice).toEqual({ kind: "needs-transfer" });
    expect(p.groups).toEqual([]);
  });

  it("asks a transfer student's class standing when it changes the curriculum", () => {
    const cals = { ...MAJOR, id: "test-cals-major", programId: "test-cals-major", family: "cals" as const };
    const p = computeDistributionProgress(
      input({
        layers: [CALS_2025, CALS_PRE, cals],
        family: "cals",
        programId: "test-cals-major",
        ctx: { entryTerm: "FA25", transfer: "external", transferStanding: null },
      })
    );
    expect(p.notice).toEqual({ kind: "needs-transfer-standing" });
    expect(p.groups).toEqual([]);
  });

  it("a missing major layer → layers unavailable", () => {
    const p = computeDistributionProgress(input({ layers: [CAS] }));
    expect(p.notice).toEqual({ kind: "layers-unavailable" });
    expect(p.groups).toEqual([]);
  });

  it("a major layer that failed to load → layers unavailable", () => {
    const p = computeDistributionProgress(input({ layerErrors: ["test-cas-major"] }));
    expect(p.notice).toEqual({ kind: "layers-unavailable" });
    expect(p.groups).toEqual([]);
  });
});

// ── Rows ──────────────────────────────────────────────────────────────────────
describe("computeDistributionProgress — rows", () => {
  it("groups by layer then heading, keyed and labelled per D9", () => {
    const p = computeDistributionProgress(input());
    expect(p.groups.map((g) => g.key).slice(0, 2)).toEqual(["cas-college:First-Year Writing", "cas-college:Distribution"]);
    expect(p.groups.find((g) => g.key === "test-cas-major:Core")?.label).toBe("Major · Core");
    expect(p.groups[0].label).toBe("College · First-Year Writing");
    // College groups come before major groups.
    const keys = p.groups.map((g) => g.key);
    expect(keys.findIndex((k) => k.startsWith("test-cas-major:"))).toBeGreaterThan(
      keys.findLastIndex((k) => k.startsWith("cas-college:"))
    );
    expect(item(p, "test-cas-major:intro")).toMatchObject({
      category: null,
      suggestedSem: null,
      requirement: null,
      dist: { layerId: "test-cas-major", rowId: "intro", layerKind: "major", rowKind: "seat" },
    });
  });

  it("maps every engine status onto the shared status", () => {
    solveSpy.tweak = (r) => {
      const row = r.layers.find((l) => l.layerId === "cas-college")!.rows.find((x) => x.rowId === "credits-120")!;
      row.status = "unchecked";
      row.reason = "node-cap";
      row.courses = [];
    };
    try {
      const p = computeDistributionProgress(
        input({
          ...board([course("CS-1110"), course("CS-3110"), course("MATH-1920", 4)]),
          waivedRequirementIds: ["test-cas-major:breadth"],
        })
      );
      const cases: [string, string, string, boolean][] = [
        ["test-cas-major:intro", "met", "satisfied", true],
        ["test-cas-major:electives", "partial", "partial", true],
        ["cas-college:fws", "unmet", "unmet", true],
        ["test-cas-major:breadth", "waived", "waived", true],
        ["cas-college:credits-120", "unchecked", "unmet", false],
        ["test-cas-major:advising", "confirm", "unmet", false],
      ];
      for (const [id, engine, status, checkable] of cases) {
        const it = item(p, id);
        expect([id, it.dist?.engineStatus, it.status, it.checkable]).toEqual([id, engine, status, checkable]);
      }
      expect(item(p, "cas-college:credits-120").dist?.reason).toBe("node-cap");
      expect(item(p, "test-cas-major:advising").dist?.confirm).toBe(true);
    } finally {
      solveSpy.tweak = null;
    }
  });

  it("waiver keys round-trip: a layer-keyed waiver reaches the engine, others are ignored", () => {
    const p = computeDistributionProgress(
      input({
        ...board([course("CS-3110"), course("CS-4410"), course("CS-4820")]),
        waivedRequirementIds: ["test-cas-major:electives", "some-engineering-slot", "other-layer:row"],
      })
    );
    const electives = item(p, "test-cas-major:electives");
    expect(electives.status).toBe("waived");
    expect(electives.coveredBy).toEqual([]);
    expect(electives.id).toBe(`${electives.dist!.layerId}:${electives.dist!.rowId}`);
  });

  it("pool rows carry poolProgress and the counted codes in board order", () => {
    const p = computeDistributionProgress(input(board([course("CS-4820", 4), course("CS-3110", 4)])));
    const electives = item(p, "test-cas-major:electives");
    expect(electives.poolProgress).toEqual({ courses: 2, requiredCourses: 3, credits: 8, requiredCredits: 9 });
    expect(electives.dist).toMatchObject({ coursesHave: 2, coursesNeed: 3, creditsHave: 8, creditsNeed: 9 });
    expect(electives.dist?.countedCodes).toEqual(["CS 4820", "CS 3110"]);
    expect(electives.coveredBy).toEqual(["p-CS-4820", "p-CS-3110"]);
  });

  it("a course counted in the college and the major layer carries both labels", () => {
    const p = computeDistributionProgress(input(board([course("CS-1110", 4, ["SDS-AS"])])));
    expect(p.attribution["p-CS-1110"]).toEqual(
      expect.arrayContaining(["All ten distribution categories, from at least 8 courses", "Intro programming"])
    );
    // Credit totals stay off the cards.
    expect(p.attribution["p-CS-1110"]).not.toContain("120 academic credits");
  });

  it("distribution rows name filled and missing categories", () => {
    const p = computeDistributionProgress(
      input(board([course("HIST-1500", 4, ["HST-AS", "X-T"]), course("PHYS-1112", 4, ["PHS-AS"])]))
    );
    const college = item(p, "cas-college:distribution");
    expect(college.dist?.categories).toHaveLength(10);
    const chip = (id: string) => college.dist!.categories!.find((c) => c.id === id)!;
    expect(chip("hst")).toMatchObject({ label: "Historical Analysis", filled: true, missing: false });
    expect(chip("phs")).toMatchObject({ filled: true, missing: false });
    expect(chip("alc")).toMatchObject({ filled: false, missing: true });
    // A filled chip carries the codes of the counted courses filling it.
    expect(chip("hst").codes).toEqual(["HIST 1500"]);
    expect(chip("phs").codes).toEqual(["PHYS 1112"]);
    expect(chip("alc").codes).toBeUndefined();
    expect(college.dist?.categoriesHave).toBe(2);
    expect(college.dist?.categoriesNeed).toBe(10);

    const breadth = item(p, "test-cas-major:breadth");
    expect(breadth.status).toBe("partial");
    expect(breadth.dist?.categoriesHave).toBe(1);
    expect(breadth.dist?.categoriesNeed).toBe(2);
    expect(breadth.dist?.categories?.find((c) => c.id === "x")?.codes).toEqual(["HIST 1500"]);
    expect(breadth.dist?.categories?.map((c) => [c.id, c.filled])).toEqual([
      ["x", true],
      ["y", false],
      ["z", false],
    ]);
  });

  it("anyOf rows list their options and point at the one in progress", () => {
    const partial = computeDistributionProgress(input(board([course("MATH-2210", 4)])));
    const math = item(partial, "test-cas-major:math");
    expect(math.status).toBe("partial");
    expect(math.dist?.options?.map((o) => o.label)).toEqual(["Route A: MATH 1910", "Route B: two MATH courses"]);
    expect(math.dist?.activeOption).toBe(1);

    const metA = computeDistributionProgress(input(board([course("MATH-2210", 4), course("MATH-1910", 4)])));
    const mathA = item(metA, "test-cas-major:math");
    expect(mathA.status).toBe("satisfied");
    // Route B (two MATH courses) is met too here; the first met option wins.
    expect(mathA.dist?.options?.[mathA.dist.activeOption!].status).toBe("satisfied");
  });

  it("names the major layer's catalog year and reports the engine percentage", () => {
    const p = computeDistributionProgress(input());
    expect(p.catalogYear).toBe("2025-26");
    expect(p.engine).toBe("distribution");
    expect(typeof p.pct).toBe("number");
  });

  it("confirm rows stay out of the totals; waived rows count as done", () => {
    const p = computeDistributionProgress(
      input({ ...board([course("CS-1110")]), waivedRequirementIds: ["test-cas-major:electives"] })
    );
    const all = p.groups.flatMap((g) => g.items);
    const confirm = all.filter((i) => i.dist?.confirm);
    expect(confirm.length).toBeGreaterThan(0);
    expect(p.total).toBe(all.length - confirm.length);
    expect(p.satisfiedCount).toBe(all.filter((i) => i.status === "satisfied" || i.status === "waived").length);
    const core = p.groups.find((g) => g.key === "test-cas-major:Core")!;
    expect(core.total).toBe(2); // intro + math; advising is confirm
    expect(core.satisfiedCount).toBe(1);
  });
});

// ── Find a class helpers ─────────────────────────────────────────────────────
describe("computeDistributionProgress — credit named where it counts (spec 028 D7)", () => {
  const cs = { id: "transfer:ab12cd34", kind: "transfer" as const, label: "CS 1110 (State U)", satisfiesCourseIds: ["CS-1110"], credits: 4 };
  const calc = {
    id: "exam:ap-calculus-bc",
    kind: "ap" as const,
    label: "AP Calculus BC (5)",
    satisfiesCourseIds: ["MATH-1910"],
    credits: 4,
    courseCredits: { "MATH-1910": 4 },
    source: { kind: "exam" as const, exam: "ap-calculus-bc", family: "ap" as const, score: "5", tableYear: "2026-27", displayName: "AP Calculus BC (5)" },
  };

  it("rows counting a credit course name the entry, credit totals included", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs, calc] }));
    expect(item(p, "test-cas-major:intro").creditLabels).toEqual(["CS 1110 (State U)"]);
    expect(item(p, "test-cas-major:math").creditLabels).toEqual(["AP Calculus BC (5)"]);
    expect(item(p, "cas-college:credits-120").creditLabels).toEqual(["CS 1110 (State U)", "AP Calculus BC (5)"]);
    expect(item(p, "test-cas-major:electives").creditLabels).toBeUndefined();
  });

  it("creditFills maps each entry to the rows it counts toward, leaving out credit totals", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs, calc] }));
    expect(p.creditFills).toEqual({
      "transfer:ab12cd34": ["Intro programming"],
      "exam:ap-calculus-bc": ["Calculus (one of two routes)"],
    });
  });

  it("a course on the board is not credit's to name", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs], ...board([course("CS-1110", 4)]) }));
    expect(item(p, "test-cas-major:intro").creditLabels).toBeUndefined();
    expect(p.creditFills).toBeUndefined();
  });

  it("a waived row names no credit", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs], waivedRequirementIds: ["test-cas-major:intro"] }));
    expect(item(p, "test-cas-major:intro").creditLabels).toBeUndefined();
    expect(p.creditFills).toBeUndefined();
  });

  it("no credit → no creditFills key (results stay structurally unchanged)", () => {
    expect(computeDistributionProgress(input()).creditFills).toBeUndefined();
  });
});

describe("computeDistributionProgress — credit counted toward the degree total (spec 045 D6)", () => {
  const cs = { id: "transfer:ab12cd34", kind: "transfer" as const, label: "CS 1110 (State U)", satisfiesCourseIds: ["CS-1110"], credits: 4 };
  const bio = { id: "exam:ap-biology", kind: "ap" as const, label: "AP Biology (5)", satisfiesCourseIds: ["BIOG-1440"], credits: 4 };
  const ALL_CREDIT = ["ap", "ib", "alevel", "intl", "transfer", "placement"];
  // The fixture's 120-credit row with a college cap on credit before Cornell.
  const capped = (max: number): Layer => ({
    ...CAS,
    rows: CAS.rows.map((r) =>
      r.id === "credits-120" && r.kind === "credits"
        ? { ...r, limits: [{ rule: { creditKind: ALL_CREDIT } as never, maxCredits: max, label: "Credit before Cornell" }] }
        : r
    ),
  });

  it("no credit → no creditCount", () => {
    expect(computeDistributionProgress(input()).creditCount).toBeUndefined();
  });

  it("with no cap, every credit counts", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs, bio] }));
    expect(p.creditCount).toEqual({ counted: 8, total: 8 });
  });

  it("a college cap holds the counted credit to the cap", () => {
    const p = computeDistributionProgress(
      input({ layers: [capped(4), CALS_2025, CALS_PRE, MAJOR], creditProfile: [cs, bio] })
    );
    expect(p.creditCount).toEqual({ counted: 4, total: 8 });
  });

  it("a credit course also on the board is the board's, not credit's", () => {
    const p = computeDistributionProgress(input({ creditProfile: [cs], ...board([course("CS-1110", 4)]) }));
    expect(p.creditCount).toBeUndefined();
  });

  // CALS splits its degree row by who it applies to: first-year entrants share
  // one small cap, external transfers get a larger one. The count must use the
  // student's own row, not whichever 120-credit row comes first.
  const split: Layer = {
    ...CAS,
    rows: CAS.rows.flatMap((r) => {
      if (r.id !== "credits-120" || r.kind !== "credits") return [r];
      const cap = (max: number) => [{ rule: { creditKind: ALL_CREDIT } as never, maxCredits: max, label: "cap" }];
      return [
        { ...r, appliesTo: [{ transfer: ["none", "internal"] }], limits: cap(4) } as typeof r,
        { ...r, id: "credits-120-external", appliesTo: [{ transfer: ["external"] }], limits: cap(8) } as typeof r,
      ];
    }),
  };

  it("a degree row split by transfer status counts with the student's own row", () => {
    const layers = [split, CALS_2025, CALS_PRE, MAJOR];
    const firstYear = computeDistributionProgress(input({ layers, creditProfile: [cs, bio] }));
    expect(firstYear.creditCount).toEqual({ counted: 4, total: 8 });
    const external = computeDistributionProgress(
      input({ layers, creditProfile: [cs, bio], ctx: { entryTerm: "FA26", transfer: "external", transferStanding: null } })
    );
    expect(external.creditCount).toEqual({ counted: 8, total: 8 });
  });

  // AP Biology 8 credits with no Cornell course (a credit-only course), and
  // two 4-credit exams: 16 credits under a 15-credit cap.
  const bio8 = { id: "exam:ap-biology", kind: "ap" as const, label: "AP Biology (5)", satisfiesCourseIds: [], credits: 8 };
  const chem = { id: "exam:ap-chemistry", kind: "ap" as const, label: "AP Chemistry (5)", satisfiesCourseIds: ["CHEM-2070"], credits: 4 };
  const calc = { id: "exam:ap-calculus-bc", kind: "ap" as const, label: "AP Calculus BC (5)", satisfiesCourseIds: ["MATH-1910"], credits: 4 };
  const EXAM = ["ap", "ib", "alevel", "intl"];

  it("a partial fit counts up to the cap, not whole courses (8 + 4 + 4 under 15 → 15)", () => {
    const p = computeDistributionProgress(
      input({ layers: [capped(15), CALS_2025, CALS_PRE, MAJOR], creditProfile: [bio8, chem, calc] })
    );
    expect(p.creditCount).toEqual({ counted: 15, total: 16 });
  });

  it("a waived degree row still counts credit up to the cap", () => {
    const p = computeDistributionProgress(
      input({
        layers: [capped(15), CALS_2025, CALS_PRE, MAJOR],
        creditProfile: [cs, bio],
        waivedRequirementIds: ["cas-college:credits-120"],
      })
    );
    expect(item(p, "cas-college:credits-120").status).toBe("waived");
    expect(p.creditCount).toEqual({ counted: 8, total: 8 });
  });

  it("nested limits: the tightest excess decides (a 15 exam cap inside an outside-credit cap)", () => {
    const nested = (outside: number): Layer => ({
      ...CAS,
      rows: CAS.rows.map((r) =>
        r.id === "credits-120" && r.kind === "credits"
          ? {
              ...r,
              limits: [
                { rule: { creditKind: EXAM } as never, maxCredits: 15, label: "Exam credit" },
                { rule: { creditKind: ALL_CREDIT } as never, maxCredits: outside, label: "Credit before Cornell" },
              ],
            }
          : r
      ),
    });
    const profile = [bio8, chem, calc, cs]; // 16 exam + 4 transfer = 20
    // Outside cap 60: only the exam cap binds (16 − 15 = 1 over).
    expect(
      computeDistributionProgress(input({ layers: [nested(60), CALS_2025, CALS_PRE, MAJOR], creditProfile: profile }))
        .creditCount
    ).toEqual({ counted: 19, total: 20 });
    // Outside cap 18: 2 over beats the exam cap's 1.
    expect(
      computeDistributionProgress(input({ layers: [nested(18), CALS_2025, CALS_PRE, MAJOR], creditProfile: profile }))
        .creditCount
    ).toEqual({ counted: 18, total: 20 });
  });
});

describe("findLayerRow / layerRowFilterRule", () => {
  it("finds a top-level row by its waiver key", () => {
    expect(findLayerRow([CAS, MAJOR], "test-cas-major:electives")?.row.id).toBe("electives");
    expect(findLayerRow([CAS, MAJOR], "test-cas-major:math-a")).toBeNull();
    expect(findLayerRow([CAS, MAJOR], "s-2110")).toBeNull();
  });

  it("narrows a distribution row to its missing categories, an anyOf to any option, a confirm to nothing", () => {
    const breadth = findLayerRow([MAJOR], "test-cas-major:breadth")!.row;
    expect(layerRowFilterRule(breadth, ["y"])).toEqual({ anyOf: [{ tag: ["Y-T"] }] });
    expect(layerRowFilterRule(breadth, [])).toEqual({ anyOf: [{ tag: ["X-T"] }, { tag: ["Y-T"] }, { tag: ["Z-T"] }] });
    const math = findLayerRow([MAJOR], "test-cas-major:math")!.row;
    expect(layerRowFilterRule(math)).toEqual({ anyOf: [{ course: ["MATH-1910"] }, { subject: ["MATH"] }] });
    expect(layerRowFilterRule(findLayerRow([MAJOR], "test-cas-major:advising")!.row)).toBeNull();
  });
});

// ── Seam: the alias map reaches the engine (spec 019 Phase 3) ────────────────
describe("computeDistributionProgress — cross-listed subjects", () => {
  const XLIST: Layer = {
    id: "test-xlist-major",
    kind: "major",
    family: "cas",
    name: "Cross-listing test",
    catalogYear: "2025-26",
    programId: "test-xlist-major",
    rows: [
      {
        id: "ns",
        kind: "seat",
        label: "A course offered under NS",
        group: "Core",
        source: SRC,
        rule: { subject: ["NS"], crossListed: true },
      },
    ],
  };
  const base = () =>
    input({
      layers: [CAS, XLIST],
      programId: "test-xlist-major",
      ...board([course("PSYCH-1101")]),
    });

  it("a course cross-listed under a subject counts for that subject's row only with the alias map", () => {
    const aliases = { "NS-1101": "PSYCH-1101" };
    const without = computeDistributionProgress(base());
    expect(item(without, "test-xlist-major:ns").status).toBe("unmet");
    const withAliases = computeDistributionProgress({
      ...base(),
      aliases,
      canonical: (id) => aliases[id as keyof typeof aliases] ?? id,
    });
    expect(item(withAliases, "test-xlist-major:ns").status).toBe("satisfied");
  });
});

describe("computeDistributionProgress — a fixed 0-credit course (review)", () => {
  const CREDITS: Layer = {
    id: "test-credit-major",
    kind: "major",
    family: "cas",
    name: "Credit test",
    catalogYear: "2025-26",
    programId: "test-credit-major",
    rows: [
      { id: "bio", kind: "credits", label: "3 BIOMG credits", group: "Core", source: SRC, rule: { subject: ["BIOMG"] }, requiredCredits: 3 },
    ],
  };
  const zero = course("BIOMG-1320", 0);

  it("doesn't fill a credit total with a 0-credit orientation lecture", () => {
    const p = computeDistributionProgress({
      ...input({ layers: [CAS, CREDITS], programId: "test-credit-major", ...board([zero]) }),
      courseDetails: { "BIOMG-1320": zero },
    });
    expect(item(p, "test-credit-major:bio").status).not.toBe("satisfied");
    expect(item(p, "test-credit-major:bio").dist?.creditsHave).toBe(0);
  });
});

// ── Concentrations (spec 019 Phase 5) ─────────────────────────────────────────
describe("computeDistributionProgress — concentrations", () => {
  const conc = (id: string, name: string, courseId: string): Layer => ({
    id: `test-cas-major--${id}`,
    kind: "concentration",
    family: "cas",
    name,
    catalogYear: "2025-26",
    programId: "test-cas-major",
    concentrationId: id,
    rows: [
      { id: `${id}-seat`, kind: "seat", label: `${name} course`, group: "Concentration", source: SRC, rule: { course: [courseId] } },
    ],
  });
  const ALPHA = conc("alpha", "Alpha track", "ZZ-1000");
  const BETA = conc("beta", "Beta track", "ZZ-2000");
  const withMajor = (concentrations?: { min: number; max: number }): Layer =>
    concentrations ? { ...MAJOR, concentrations } : MAJOR;
  const layers = (c?: { min: number; max: number }) => [CAS, CALS_2025, CALS_PRE, withMajor(c), ALPHA, BETA];
  const ctxWith = (concentration: { programId: string; ids: string[] } | null) => ({
    entryTerm: "FA26",
    transfer: "none" as const,
    transferStanding: null,
    concentration,
  });
  const rowIds = (p: RequirementProgress) => p.groups.flatMap((g) => g.items).map((i) => i.id);

  it("a chosen concentration's rows count and are listed", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 1, max: 1 }), ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha"] }) })
    );
    expect(p.concentrations).toMatchObject({ min: 1, max: 1, chosen: ["alpha"], needed: false });
    expect(p.concentrations?.options).toEqual([
      { id: "alpha", name: "Alpha track" },
      { id: "beta", name: "Beta track" },
    ]);
    expect(rowIds(p)).toContain("test-cas-major--alpha:alpha-seat");
    expect(rowIds(p)).not.toContain("test-cas-major--beta:beta-seat");
    expect(p.groups.some((g) => g.label === "Concentration · Concentration")).toBe(true);
  });

  it("the chosen concentration's seat is satisfied by the course", () => {
    const p = computeDistributionProgress(
      input({
        layers: layers({ min: 1, max: 1 }),
        ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha"] }),
        ...board([course("ZZ-1000")]),
      })
    );
    expect(item(p, "test-cas-major--alpha:alpha-seat").status).toBe("satisfied");
  });

  it("two chosen when the major allows two", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 1, max: 2 }), ctx: ctxWith({ programId: "test-cas-major", ids: ["beta", "alpha"] }) })
    );
    expect(p.concentrations).toMatchObject({ chosen: ["beta", "alpha"], needed: false });
    expect(rowIds(p)).toEqual(expect.arrayContaining(["test-cas-major--alpha:alpha-seat", "test-cas-major--beta:beta-seat"]));
  });

  it("not chosen but required: college and major rows still show, and the pick is flagged", () => {
    const p = computeDistributionProgress(input({ layers: layers({ min: 1, max: 1 }), ctx: ctxWith(null) }));
    expect(p.notice).toBeUndefined();
    expect(p.concentrations?.needed).toBe(true);
    expect(rowIds(p)).toContain("test-cas-major:intro");
    expect(rowIds(p).some((id) => id.startsWith("cas-college:"))).toBe(true);
    expect(rowIds(p).some((id) => id.includes("--"))).toBe(false);
  });

  it("below min (one of two required) is flagged but the chosen rows show", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 2, max: 2 }), ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha"] }) })
    );
    expect(p.concentrations?.needed).toBe(true);
    expect(rowIds(p)).toContain("test-cas-major--alpha:alpha-seat");
  });

  it("above max is flagged", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 1, max: 1 }), ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha", "beta"] }) })
    );
    expect(p.concentrations?.needed).toBe(true);
  });

  it("a choice made for another major is ignored (switching majors invalidates it)", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 1, max: 1 }), ctx: ctxWith({ programId: "some-other-major", ids: ["alpha"] }) })
    );
    expect(p.concentrations).toMatchObject({ chosen: [], needed: true });
    expect(rowIds(p).some((id) => id.includes("--"))).toBe(false);
  });

  it("an id the major no longer offers does not count as chosen", () => {
    const p = computeDistributionProgress(
      input({ layers: layers({ min: 1, max: 1 }), ctx: ctxWith({ programId: "test-cas-major", ids: ["gone"] }) })
    );
    expect(p.concentrations).toMatchObject({ chosen: [], needed: true });
  });

  it("optional by default: nothing chosen is not flagged, but the choice is offered", () => {
    const p = computeDistributionProgress(input({ layers: layers(), ctx: ctxWith(null) }));
    expect(p.concentrations).toMatchObject({ min: 0, max: 1, chosen: [], needed: false });
  });

  it("a major with no concentrations carries no concentration info", () => {
    expect(computeDistributionProgress(input()).concentrations).toBeUndefined();
  });

  it("a required concentration whose layers did not load stops the panel (never a silent pass)", () => {
    const none = computeDistributionProgress(
      input({ layers: [CAS, CALS_2025, CALS_PRE, withMajor({ min: 1, max: 1 })], ctx: ctxWith(null) })
    );
    expect(none.notice).toEqual({ kind: "layers-unavailable" });
    const dropped = computeDistributionProgress(
      input({
        layers: layers({ min: 1, max: 1 }),
        layerErrors: ["test-cas-major--gamma"],
        ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha"] }),
      })
    );
    expect(dropped.notice).toEqual({ kind: "layers-unavailable" });
  });

  it("a dropped concentration the student had chosen stops the panel even when optional", () => {
    const p = computeDistributionProgress(
      input({
        layers: [CAS, CALS_2025, CALS_PRE, MAJOR, BETA],
        layerErrors: ["test-cas-major--alpha"],
        ctx: ctxWith({ programId: "test-cas-major", ids: ["alpha"] }),
      })
    );
    expect(p.notice).toEqual({ kind: "layers-unavailable" });
  });

  it("a dropped concentration alone does not stop an optional major the student did not choose from", () => {
    const p = computeDistributionProgress(
      input({
        layers: [CAS, CALS_2025, CALS_PRE, MAJOR, BETA],
        layerErrors: ["test-cas-major--alpha"],
        ctx: ctxWith(null),
      })
    );
    expect(p.notice).toBeUndefined();
  });
});

// ── Spec 020: ask the student ─────────────────────────────────────────────────
// TEST-ONLY copies of the layers carry the questions (the real fixtures are not
// edited here; the real CAS layer gains its question in a later lane).
describe("computeDistributionProgress — questions and answers (spec 020)", () => {
  const FWS_REF = "usedAs:cas-college/fws";
  const FWS_KEY = `${FWS_REF}@ENGL-2880`;
  const QSRC = { url: "https://catalog.cornell.edu/arts-sciences/", anchor: "College of Arts and Sciences Graduation Requirements" };

  /** The CAS layer whose FWS row counts ENGL 2860 / 2880 only when the
   *  student says they are using it as a writing seminar. */
  const casQ: Layer = {
    ...CAS,
    rows: CAS.rows.map((r) =>
      r.id === "fws" && r.kind === "pool"
        ? {
            ...r,
            rule: {
              anyOf: [
                { titleStartsWith: "FWS:" },
                { allOf: [{ course: ["ENGL-2860", "ENGL-2880"] }, { answered: FWS_REF }] },
              ],
            },
          }
        : r
    ),
    questions: [
      {
        type: "usedAs",
        row: "fws",
        courses: { course: ["ENGL-2860", "ENGL-2880"] },
        source: QSRC,
        quote: "If counted toward the First-Year Writing Seminar requirement, the course will not count toward ALC-AS.",
      },
    ],
  };
  const fwsLabel = CAS.rows.find((r) => r.id === "fws")!.label;

  const fws = course("WRIT-1370", 3, ["ALC-AS"], "FWS: Writing About Place");
  const engl = course("ENGL-2880", 3, ["ALC-AS"], "Expository Writing");
  const hist = course("HIST-1530", 3, ["HST-AS"]);

  const withQ = (over: Partial<DistributionProgressInput> = {}) =>
    input({ layers: [casQ, CALS_2025, CALS_PRE, MAJOR], ...board([fws, engl, hist]), ...over });

  it("ENGL 2880's question shows on the writing-seminar row, worded by the registry", () => {
    const p = computeDistributionProgress(withQ());
    const row = item(p, "cas-college:fws");
    expect(row.status).toBe("partial");
    expect(row.dist?.questions).toEqual([
      {
        key: FWS_KEY,
        scope: "mark",
        prompt: `Are you using ENGL 2880 as ${fwsLabel}?`,
        detail: "If you are, it counts here and not toward anything else.",
        input: { kind: "yesno" },
        courseCode: "ENGL 2880",
      },
    ]);
    expect(row.dist?.answered).toBeUndefined();
    expect(p.openQuestionCount).toBe(1);
    expect(p.answers).toBeUndefined();
    // No other row carries it.
    const others = p.groups.flatMap((g) => g.items).filter((i) => i.id !== "cas-college:fws");
    expect(others.every((i) => i.dist?.questions == null)).toBe(true);
  });

  it("skipOpenQuestions (the tried solve) leaves the questions out and the rows as they are", () => {
    const full = computeDistributionProgress(withQ());
    const p = computeDistributionProgress(withQ({ skipOpenQuestions: true }));
    expect(p.openQuestionCount).toBeUndefined();
    expect(p.groups.flatMap((g) => g.items).every((i) => i.dist?.questions == null)).toBe(true);
    const statuses = (r: typeof p) => r.groups.flatMap((g) => g.items.map((i) => [i.id, i.status]));
    expect(statuses(p)).toEqual(statuses(full));
  });

  it("after yes: the row is met, says why, and the question count drops", () => {
    const p = computeDistributionProgress(withQ({ answers: { marks: { [FWS_KEY]: "yes" }, facts: {} } }));
    const row = item(p, "cas-college:fws");
    expect(row.status).toBe("satisfied");
    expect(row.dist?.questions).toBeUndefined();
    expect(row.dist?.answered).toEqual([
      { key: FWS_KEY, scope: "mark", line: `Counted because you said you're using ENGL 2880 as ${fwsLabel}` },
    ]);
    expect(p.openQuestionCount).toBeUndefined();
    // ENGL 2880 now counts for the writing seminar and nothing else.
    expect(p.attribution["p-ENGL-2880"]).toEqual([fwsLabel]);
    expect(p.answers).toEqual([
      {
        key: FWS_KEY,
        scope: "mark",
        prompt: `Are you using ENGL 2880 as ${fwsLabel}?`,
        valueLabel: "Yes",
        value: "yes",
        input: { kind: "yesno" },
        state: "active",
      },
    ]);
  });

  it("after no: the strict result, no question, no 'counted because' line", () => {
    const p = computeDistributionProgress(withQ({ answers: { marks: { [FWS_KEY]: "no" }, facts: {} } }));
    const row = item(p, "cas-college:fws");
    expect(row.status).toBe("partial");
    expect(row.dist?.questions).toBeUndefined();
    expect(row.dist?.answered).toBeUndefined();
    expect(p.answers?.[0]).toMatchObject({ key: FWS_KEY, valueLabel: "No", state: "active" });
  });

  it("the answers list: active, hidden (course off the board) and notAsked (no layer asks it)", () => {
    const p = computeDistributionProgress(
      withQ({
        answers: {
          marks: {
            [FWS_KEY]: "yes",
            [`${FWS_REF}@ENGL-2860`]: "yes",
            "usedAs:cas-college/retired-row@ENGL-2880": "yes",
          },
          facts: { "studentFact:honorsProgram:test-cas-major": "no" },
        },
      })
    );
    const byKey = Object.fromEntries((p.answers ?? []).map((a) => [a.key, a]));
    expect(Object.keys(byKey)).toHaveLength(4);
    expect(byKey[FWS_KEY].state).toBe("active");
    expect(byKey[`${FWS_REF}@ENGL-2860`]).toMatchObject({
      state: "hidden",
      scope: "mark",
      prompt: `Are you using ENGL 2860 as ${fwsLabel}?`,
    });
    expect(byKey["usedAs:cas-college/retired-row@ENGL-2880"]).toMatchObject({
      state: "notAsked",
      prompt: "A question about ENGL 2880",
    });
    expect(byKey["studentFact:honorsProgram:test-cas-major"]).toMatchObject({
      state: "notAsked",
      scope: "fact",
      valueLabel: "No",
      value: "no",
    });
    // A hidden mark puts nothing on a row.
    expect(item(p, "cas-college:fws").dist?.answered?.map((a) => a.key)).toEqual([FWS_KEY]);
  });

  it("a board with no candidate course costs no extra solve; one candidate costs one", () => {
    solveSpy.calls = 0;
    const none = computeDistributionProgress(input({ layers: [casQ, CALS_2025, CALS_PRE, MAJOR], ...board([fws, hist]) }));
    expect(solveSpy.calls).toBe(1);
    expect(none.openQuestionCount).toBeUndefined();

    solveSpy.calls = 0;
    computeDistributionProgress(withQ());
    expect(solveSpy.calls).toBe(2);

    // Layers that ask nothing: one solve, as before spec 020. (The real CAS
    // fixture now asks the ENGL 2860/2880 question, so strip it here.)
    const casNoQuestions: Layer = { ...CAS, questions: undefined };
    solveSpy.calls = 0;
    computeDistributionProgress(input({ layers: [casNoQuestions, CALS_2025, CALS_PRE, MAJOR], ...board([fws, engl, hist]) }));
    expect(solveSpy.calls).toBe(1);
  });

  describe("credit marks (creditsTaken)", () => {
    const BIOMI_REF = "creditsTaken:BIOMI-4850";
    const majorQ: Layer = {
      ...MAJOR,
      rows: [
        ...MAJOR.rows,
        {
          id: "bs-seminar",
          kind: "seat",
          label: "Biology & Society seminar",
          group: "Core",
          source: SRC,
          rule: { allOf: [{ course: ["BIOMI-4850"] }, { minCredits: 3 }] },
        },
      ],
      questions: [{ type: "creditsTaken", course: "BIOMI-4850", values: [2, 3], source: SRC, quote: "BIOMI 4850 counts at 3 credits." }],
    };
    const biomi = { ...course("BIOMI-4850", 2), credits_min: 2, credits_max: 3 } as Course;
    const creditsInput = (over: Partial<DistributionProgressInput> = {}) =>
      input({ layers: [CAS, majorQ], ...board([biomi]), ...over });

    it("asks with a credits input listing the allowed values", () => {
      const p = computeDistributionProgress(creditsInput());
      expect(item(p, "test-cas-major:bs-seminar").status).toBe("unmet");
      expect(item(p, "test-cas-major:bs-seminar").dist?.questions).toEqual([
        {
          key: BIOMI_REF,
          scope: "mark",
          prompt: "How many credits did you take BIOMI 4850 for?",
          detail: "It can be taken for 2 and 3 credits, and some requirements depend on which.",
          input: { kind: "credits", values: [2, 3] },
          courseCode: "BIOMI 4850",
        },
      ]);
      expect(p.openQuestionCount).toBe(1);
    });

    it("3 credits meets the row and says so; the answers list reads '3 credits'", () => {
      const p = computeDistributionProgress(creditsInput({ answers: { marks: { [BIOMI_REF]: 3 }, facts: {} } }));
      const row = item(p, "test-cas-major:bs-seminar");
      expect(row.status).toBe("satisfied");
      expect(row.dist?.answered).toEqual([
        { key: BIOMI_REF, scope: "mark", line: "Counted at 3 credits because you said you took BIOMI 4850 for 3 credits" },
      ]);
      expect(p.answers).toEqual([
        {
          key: BIOMI_REF,
          scope: "mark",
          prompt: "How many credits did you take BIOMI 4850 for?",
          valueLabel: "3 credits",
          value: 3,
          input: { kind: "credits", values: [2, 3] },
          state: "active",
        },
      ]);
    });

    it("credits chosen on a card count even where no layer asks, and stay off the answers list", () => {
      const research = { ...course("BIOMI-4990", 1), credits_min: 1, credits_max: 4 } as Course;
      const rowQ: Layer = {
        ...majorQ,
        rows: [
          ...MAJOR.rows,
          {
            id: "bs-seminar",
            kind: "seat",
            label: "Biology & Society seminar",
            group: "Core",
            source: SRC,
            rule: { allOf: [{ course: ["BIOMI-4990"] }, { minCredits: 3 }] },
          },
        ],
        questions: [],
      };
      const key = "creditsTaken:BIOMI-4990";
      const base = input({ layers: [CAS, rowQ], ...board([research]) });
      expect(item(computeDistributionProgress(base), "test-cas-major:bs-seminar").status).toBe("unmet");
      const p = computeDistributionProgress({ ...base, answers: { marks: { [key]: 3 }, facts: {} } });
      expect(item(p, "test-cas-major:bs-seminar").status).toBe("satisfied");
      expect((p.answers ?? []).some((a) => a.key === key)).toBe(false);
    });

    it("2 credits (no change) adds no line to any row", () => {
      const p = computeDistributionProgress(creditsInput({ answers: { marks: { [BIOMI_REF]: 2 }, facts: {} } }));
      expect(item(p, "test-cas-major:bs-seminar").status).toBe("unmet");
      expect(p.groups.flatMap((g) => g.items).every((i) => i.dist?.answered == null)).toBe(true);
    });
  });

  describe("student facts", () => {
    const HONORS = "studentFact:honorsProgram:test-cas-major";
    const majorQ: Layer = {
      ...MAJOR,
      rows: [
        ...MAJOR.rows,
        {
          id: "honors",
          kind: "seat",
          label: "Honors thesis course",
          group: "Honors",
          source: SRC,
          rule: { allOf: [{ answered: HONORS }, { course: ["CS-4999"] }] },
        },
      ],
      questions: [
        { type: "studentFact", fact: "honorsProgram", subject: "test-cas-major", row: "honors", source: SRC, quote: "Honors students take CS 4999." },
      ],
    };
    const factInput = (over: Partial<DistributionProgressInput> = {}) =>
      input({ layers: [CAS, majorQ], ...board([course("CS-4999")]), ...over });

    it("asks on the row, scoped to the profile, named with the program", () => {
      const p = computeDistributionProgress(factInput());
      expect(item(p, "test-cas-major:honors").dist?.questions).toEqual([
        {
          key: HONORS,
          scope: "fact",
          prompt: "Are you in the Test Major honors program?",
          detail: "Honors students have some different requirements.",
          input: { kind: "yesno" },
        },
      ]);
    });

    it("a fact about another program is named from the program index, not its id", () => {
      const ACCEPTED = "studentFact:acceptedToProgram:other-program-bs";
      const asking: Layer = {
        ...MAJOR,
        rows: [
          ...MAJOR.rows,
          { id: "other", kind: "seat", label: "Other course", group: "Other", source: SRC, rule: { allOf: [{ answered: ACCEPTED }, { course: ["CS-4999"] }] } },
        ],
        questions: [{ type: "studentFact", fact: "acceptedToProgram", subject: "other-program-bs", row: "other", source: SRC, quote: "Accepted students only." }],
      };
      const ask = (over: Partial<DistributionProgressInput> = {}) =>
        item(computeDistributionProgress(input({ layers: [CAS, asking], ...board([course("CS-4999")]), ...over })), "test-cas-major:other").dist?.questions?.[0]
          ?.prompt;
      expect(ask({ programNames: { "other-program-bs": "Other Program (BS)" } })).toBe("Have you been officially accepted to Other Program (BS)?");
      // No index entry: the id, as before.
      expect(ask()).toBe("Have you been officially accepted to other-program-bs?");
    });

    it("yes meets the row and carries the fact's line", () => {
      const p = computeDistributionProgress(factInput({ answers: { marks: {}, facts: { [HONORS]: "yes" } } }));
      const row = item(p, "test-cas-major:honors");
      expect(row.status).toBe("satisfied");
      expect(row.dist?.answered).toEqual([
        { key: HONORS, scope: "fact", line: "Counted because you said you're in the Test Major honors program" },
      ]);
      expect(p.answers).toEqual([expect.objectContaining({ key: HONORS, scope: "fact", state: "active", valueLabel: "Yes" })]);
    });
  });

  describe("college rule set (spec 020 D6)", () => {
    const cals = { ...MAJOR, id: "test-cals-major", programId: "test-cals-major", family: "cals" as const };

    it("reports the college layer it chose", () => {
      expect(computeDistributionProgress(input()).collegeLayerId).toBe("cas-college");
    });

    it("a forced college layer is scored without the start answers that would pick it", () => {
      const p = computeDistributionProgress(
        input({
          layers: [CALS_2025, CALS_PRE, cals],
          family: "cals",
          programId: "test-cals-major",
          ctx: { entryTerm: null, transfer: null, transferStanding: null },
          collegeLayerId: "cals-college-pre2025",
        })
      );
      expect(p.notice).toBeUndefined();
      expect(p.collegeLayerId).toBe("cals-college-pre2025");
      expect(p.collegeVersion).toBe(CALS_PRE.name);
    });
  });
});

describe("computeDistributionProgress — a line only where its own answer changed the row (audit finding 5)", () => {
  const FACT = "studentFact:departmentExamPassed:ECON";
  const BIOMI_REF = "creditsTaken:BIOMI-4850";
  const major: Layer = {
    id: "M",
    kind: "major",
    family: "cas",
    name: "M",
    catalogYear: "2026-27",
    programId: "M",
    rows: [
      {
        id: "intro",
        kind: "pool",
        label: "Intro course or the exam route",
        group: "Core",
        source: SRC,
        rule: { anyOf: [{ course: ["BIOMI-4850"] }, { allOf: [{ answered: FACT }, { subject: ["HIST"] }] }] },
        requiredCourses: 1,
        requiredCredits: 3,
      },
    ],
    questions: [
      { type: "creditsTaken", course: "BIOMI-4850", values: [2, 3], source: SRC, quote: "2-3 credits." },
      { type: "studentFact", fact: "departmentExamPassed", subject: "ECON", source: SRC, quote: "Exam." },
    ],
  };
  const biomi = { ...course("BIOMI-4850", 2), credits_min: 2, credits_max: 3 } as Course;
  const run = (fact: "yes" | "no") =>
    computeDistributionProgress(
      input({
        layers: [CAS, major],
        programId: "M",
        ...board([biomi, course("HIST-1530", 4)]),
        answers: { marks: { [BIOMI_REF]: 3 }, facts: { [FACT]: fact } },
      })
    );

  it("a fact that did not change the row adds no line there", () => {
    const yes = item(run("yes"), "M:intro");
    const no = item(run("no"), "M:intro");
    // The fact changes nothing: the row reads the same with yes or no...
    expect(yes.status).toBe("satisfied");
    expect(yes.dist?.countedCodes).toEqual(no.dist?.countedCodes);
    // ...so its "counted because" line does not appear on it.
    expect(yes.dist?.answered?.map((a) => a.key) ?? []).not.toContain(FACT);
  });
});

describe("computeDistributionProgress — a distribution row with a credit total (spec 037 D6)", () => {
  const breadthOf = (layer: Layer) => layer.rows.find((r) => r.id === "breadth")!;
  const withCredits: Layer = {
    ...MAJOR,
    rows: MAJOR.rows.map((r) =>
      r.id === "breadth" && r.kind === "distribution"
        ? { ...r, requiredCredits: 8, perCategory: { z: { minCredits: 2 } }, limits: [{ rule: { number: { min: 2000 } }, minCourses: 1 }] }
        : r
    ),
  };
  const tagged = board([course("ANTH-1100", 3, ["X-T"]), course("ENGL-2100", 3, ["Y-T"])]);

  it("surfaces creditsHave / creditsNeed on the row like a pool's", () => {
    const p = computeDistributionProgress(input({ layers: [CAS, CALS_2025, CALS_PRE, withCredits], ...tagged }));
    const it = item(p, "test-cas-major:breadth");
    expect(it.status).toBe("partial");
    expect(it.dist).toMatchObject({ rowKind: "distribution", coursesHave: 2, coursesNeed: 2, creditsHave: 6, creditsNeed: 8 });
    // Area Z is short of its credit minimum, so its chip reads missing.
    expect(it.dist?.categories?.find((c) => c.id === "z")).toMatchObject({ filled: false, missing: true });
  });

  it("a row without requiredCredits still carries no credit figures", () => {
    expect(breadthOf(MAJOR)).not.toHaveProperty("requiredCredits");
    const p = computeDistributionProgress(input(tagged));
    const it = item(p, "test-cas-major:breadth");
    expect(it.status).toBe("satisfied");
    expect(it.dist?.creditsNeed).toBeUndefined();
    expect(it.dist?.creditsHave).toBeUndefined();
  });

  it("meets once the credits, the category credit minimum and the limit hold", () => {
    const p = computeDistributionProgress(
      input({
        layers: [CAS, CALS_2025, CALS_PRE, withCredits],
        ...board([course("ANTH-1100", 3, ["X-T"]), course("ENGL-2100", 3, ["Y-T"]), course("HIST-1200", 2, ["Z-T"])]),
      })
    );
    const it = item(p, "test-cas-major:breadth");
    expect(it.status).toBe("satisfied");
    expect(it.dist).toMatchObject({ creditsHave: 8, creditsNeed: 8 });
  });
});
