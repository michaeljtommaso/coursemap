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
const solveSpy = vi.hoisted(() => ({ tweak: null as null | ((r: DistributionResult) => void) }));
vi.mock("./distribution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./distribution")>();
  return {
    ...actual,
    solve: (input: SolveInput) => {
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
    expect(college.dist?.categoriesHave).toBe(2);
    expect(college.dist?.categoriesNeed).toBe(10);

    const breadth = item(p, "test-cas-major:breadth");
    expect(breadth.status).toBe("partial");
    expect(breadth.dist?.categoriesHave).toBe(1);
    expect(breadth.dist?.categoriesNeed).toBe(2);
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
