import { describe, it, expect, vi } from "vitest";

// The hook reads the alias map from CatalogProvider (which boots Firebase);
// these tests exercise only the pure predicate, so stub the context module.
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
// Same for the plan/program hooks it reads for Distribution rows (spec 019).
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ planProgramId: null }) }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => ({ slots: [] }) }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => ({ groups: [] }) }));
vi.mock("@/store/useProgramStore", () => ({ useProgramStore: () => null }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ studentContext: { entryTerm: null }, enteringYear: null }) }));
import {
  matchesFilters,
  buildRequirementPredicate,
  buildLayerRowPredicate,
  recordToDistCourse,
  buildPlanPools,
  prereqCandidates,
  prereqsMetByPools,
  recordOnTargetRoster,
  indexHasTargetRoster,
  scheduleFilterActive,
  buildBusyCourses,
  indexHasMeetings,
  buildLiberalStudiesPredicate,
  liberalStudiesFilterCohort,
  type PlanStatus,
  type FilterContext,
} from "./useCourseFilters";
import type { ElectiveGroup, PrereqExpr, ProgramSlotWithData } from "@/types/db";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Layer } from "@/lib/planner/distribution";
import type { ProfessorRating } from "@/lib/classes/professorRatings";

function rec(overrides: Partial<CatalogIndexRecord> = {}): CatalogIndexRecord {
  return {
    id: "CS-2110",
    subject: "CS",
    number: "2110",
    title: "Object-Oriented Programming and Data Structures",
    creditsMin: 3,
    creditsMax: 4,
    hasPrereqs: true,
    offered: ["FA", "SP"],
    ...overrides,
  } as CatalogIndexRecord;
}

const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
  favorites: new Set<string>(),
  isRelevant: () => false,
  ...over,
});

describe("matchesFilters — no filters", () => {
  it("passes everything when the filter set is empty", () => {
    expect(matchesFilters(rec(), {}, ctx())).toBe(true);
  });
});

describe("matchesFilters — subject", () => {
  it("keeps a matching subject, drops others", () => {
    expect(matchesFilters(rec(), { subject: "CS" }, ctx())).toBe(true);
    expect(matchesFilters(rec(), { subject: "MATH" }, ctx())).toBe(false);
  });
});

describe("matchesFilters — level (first digit)", () => {
  it("matches on the leading digit of the number", () => {
    expect(matchesFilters(rec({ number: "2110" }), { levels: [2] }, ctx())).toBe(true);
    expect(matchesFilters(rec({ number: "4820" }), { levels: [2] }, ctx())).toBe(false);
    expect(matchesFilters(rec({ number: "1110" }), { levels: [1] }, ctx())).toBe(true);
  });
});

describe("matchesFilters — credits", () => {
  it("matches a credit value inside the course's [min,max] range", () => {
    expect(matchesFilters(rec({ creditsMin: 3, creditsMax: 4 }), { credits: 4 }, ctx())).toBe(true);
    expect(matchesFilters(rec({ creditsMin: 3, creditsMax: 4 }), { credits: 3 }, ctx())).toBe(true);
    expect(matchesFilters(rec({ creditsMin: 3, creditsMax: 4 }), { credits: 1 }, ctx())).toBe(false);
  });
});

describe("matchesFilters — offered", () => {
  it("matches when the term is in the record's offered list", () => {
    expect(matchesFilters(rec({ offered: ["FA"] }), { offered: "FA" }, ctx())).toBe(true);
    expect(matchesFilters(rec({ offered: ["SP"] }), { offered: "FA" }, ctx())).toBe(false);
  });
  it("excludes a record with no offered data when an offered filter is set", () => {
    expect(matchesFilters(rec({ offered: [] }), { offered: "FA" }, ctx())).toBe(false);
  });
});

describe("matchesFilters — hasPrereqs", () => {
  it("distinguishes courses with and without prereqs", () => {
    expect(matchesFilters(rec({ hasPrereqs: true }), { hasPrereqs: true }, ctx())).toBe(true);
    expect(matchesFilters(rec({ hasPrereqs: true }), { hasPrereqs: false }, ctx())).toBe(false);
    expect(matchesFilters(rec({ hasPrereqs: false }), { hasPrereqs: false }, ctx())).toBe(true);
  });
});

describe("matchesFilters — favorites", () => {
  it("keeps only favorited ids when favoritesOnly is set", () => {
    const favCtx = ctx({ favorites: new Set(["CS-2110"]) });
    expect(matchesFilters(rec({ id: "CS-2110" }), { favoritesOnly: true }, favCtx)).toBe(true);
    expect(matchesFilters(rec({ id: "CS-4820" }), { favoritesOnly: true }, favCtx)).toBe(false);
  });
});

describe("matchesFilters — relevantToMajor", () => {
  it("defers to the context's isRelevant closure", () => {
    const relevant = ctx({ isRelevant: (r) => r.subject === "CS" });
    expect(matchesFilters(rec({ subject: "CS" }), { relevantToMajor: true }, relevant)).toBe(true);
    expect(matchesFilters(rec({ subject: "MATH" }), { relevantToMajor: true }, relevant)).toBe(false);
  });
});

describe("matchesFilters — attribute (spec 010 §2)", () => {
  const FWS = { anyOf: [{ field: "title" as const, op: "startsWith" as const, value: "FWS:" }] };

  it("FWS flag path — uses the derived index fws flag", () => {
    expect(matchesFilters(rec({ fws: true, title: "FWS: Poetry" }), { attribute: FWS }, ctx())).toBe(true);
    expect(matchesFilters(rec({ fws: false, title: "Intro to Poetry" }), { attribute: FWS }, ctx())).toBe(false);
  });

  it("generic title path — records without an fws flag fall back to the title", () => {
    // No `fws` provided → title prefix decides.
    expect(matchesFilters(rec({ title: "FWS: Short Stories" }), { attribute: FWS }, ctx())).toBe(true);
    expect(matchesFilters(rec({ title: "Data Structures" }), { attribute: FWS }, ctx())).toBe(false);
  });

  it("attrs path — attrs.value 'in' tests the record's attr values", () => {
    const m = { anyOf: [{ field: "attrs.value" as const, op: "in" as const, value: ["ALC-AS"] }] };
    expect(matchesFilters(rec({ attrs: ["ALC-AS", "SBA-AS"] }), { attribute: m }, ctx())).toBe(true);
    expect(matchesFilters(rec({ attrs: ["SBA-AS"] }), { attribute: m }, ctx())).toBe(false);
    expect(matchesFilters(rec({ attrs: [] }), { attribute: m }, ctx())).toBe(false);
  });

  it("composes with other axes (attribute AND level)", () => {
    const r = rec({ title: "FWS: Writing", number: "1105", fws: true });
    expect(matchesFilters(r, { attribute: FWS, levels: [1] }, ctx())).toBe(true);
    expect(matchesFilters(r, { attribute: FWS, levels: [3] }, ctx())).toBe(false);
  });
});

describe("matchesFilters — composition", () => {
  it("requires ALL active axes to pass", () => {
    const r = rec({ subject: "CS", number: "2110", creditsMin: 4, creditsMax: 4, offered: ["FA"] });
    expect(matchesFilters(r, { subject: "CS", levels: [2], credits: 4, offered: "FA" }, ctx())).toBe(true);
    // one axis fails → whole predicate fails
    expect(matchesFilters(r, { subject: "CS", levels: [2], credits: 3 }, ctx())).toBe(false);
  });
});

// ── Requirement scope (spec 014 D2) ──────────────────────────────────────────
function slot(over: Partial<ProgramSlotWithData>): ProgramSlotWithData {
  return {
    id: "s",
    program_id: "p",
    kind: "course",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: 1,
    slot_row: 0,
    category: null,
    attribute_match: null,
    courses: null,
    elective_groups: null,
    ...over,
  };
}
function eg(id: string, rule: ElectiveGroup["qualifying_rule"]): ElectiveGroup {
  return {
    id,
    program_id: "p",
    name: id,
    description: null,
    qualifying_rule: rule,
    min_credits: 9,
    advisor_approval: false,
    notes: null,
  };
}
const REQ_SLOTS: ProgramSlotWithData[] = [
  slot({ id: "s-2110", kind: "course", course_id: "CS-2110" }),
  slot({ id: "s-111x", kind: "pattern", pattern: "CS-111x", pattern_title: "CS 111x" }),
  slot({
    id: "s-fws",
    kind: "attribute",
    pattern_title: "First-Year Writing Seminar",
    attribute_match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
  }),
  slot({ id: "s-el", kind: "elective", elective_group_id: "g-cs", elective_groups: eg("g-cs", { type: "level", subject: "CS", min_number: 3000 }) }),
  slot({ id: "s-lib", kind: "elective", elective_group_id: "g-lib", elective_groups: eg("g-lib", { type: "category", category: "liberal-studies" }) }),
  slot({ id: "s-cat", kind: "elective", elective_group_id: "g-cat", elective_groups: eg("g-cat", { type: "category", category: "humanities" }) }),
];
const reqCtx = (aliases: Record<string, string> = {}) =>
  ctx({ satisfiesRequirement: buildRequirementPredicate(REQ_SLOTS, (id) => aliases[id] ?? id) });

describe("matchesFilters — requirementId (spec 014 D2)", () => {
  it("course seat: only that course (and its cross-listings) passes", () => {
    expect(matchesFilters(rec(), { requirementId: "s-2110" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec({ id: "CS-3110", number: "3110" }), { requirementId: "s-2110" }, reqCtx())).toBe(false);
    const engrd = rec({ id: "ENGRD-2110", subject: "ENGRD" });
    expect(matchesFilters(engrd, { requirementId: "s-2110" }, reqCtx({ "ENGRD-2110": "CS-2110" }))).toBe(true);
  });
  it("pattern seat: courses matching the pattern pass", () => {
    expect(matchesFilters(rec({ id: "CS-1112", number: "1112" }), { requirementId: "s-111x" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "s-111x" }, reqCtx())).toBe(false);
  });
  it("attribute seat: matches on the index record's fws flag", () => {
    const fws = rec({ id: "ENGL-1170", subject: "ENGL", number: "1170", title: "FWS: Stories", fws: true });
    expect(matchesFilters(fws, { requirementId: "s-fws" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec({ fws: false }), { requirementId: "s-fws" }, reqCtx())).toBe(false);
  });
  it("computable pool: the group's qualifying rule decides", () => {
    expect(matchesFilters(rec({ id: "CS-4820", number: "4820" }), { requirementId: "g-cs" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "g-cs" }, reqCtx())).toBe(false);
  });
  it("non-computable pool and unknown ids narrow nothing", () => {
    expect(matchesFilters(rec(), { requirementId: "g-cat" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "nope" }, reqCtx())).toBe(true);
  });
  it("a liberal studies pool is computable (spec 037 D5): tagged courses only", () => {
    const tagged = rec({ id: "ECON-1110", subject: "ECON", number: "1110", attrs: ["SBA-AG", "SSC-AS"] });
    expect(matchesFilters(tagged, { requirementId: "g-lib" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec({ attrs: [] }), { requirementId: "g-lib" }, reqCtx())).toBe(false);
  });
  it("the label is display-only and never filters", () => {
    expect(matchesFilters(rec(), { requirementLabel: "Anything" }, reqCtx())).toBe(true);
  });
});

// ── Spec 019 D9 — a Distribution row's requirementId ─────────────────────────
const SRC = { url: "https://example.edu", anchor: "Requirements" };
const LAYER: Layer = {
  id: "test-major",
  kind: "major",
  family: "cas",
  name: "Test Major",
  catalogYear: "2026-27",
  programId: "test-major",
  rows: [
    { id: "ethics", kind: "seat", label: "Ethics", group: "Core", source: SRC, rule: { tag: ["ETH-AG"] } },
    {
      id: "upper",
      kind: "pool",
      label: "Upper-level CS",
      group: "Core",
      source: SRC,
      rule: { allOf: [{ subject: ["CS"] }, { number: { min: 3000 } }] },
      requiredCourses: 2,
      requiredCredits: 6,
    },
    {
      id: "breadth",
      kind: "distribution",
      label: "Breadth",
      group: "Breadth",
      source: SRC,
      rule: { minCredits: 3 },
      categories: [
        { id: "alc", label: "Arts", rule: { tag: ["ALC-AS"] } },
        { id: "hst", label: "History", rule: { tag: ["HST-AS"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
    },
    {
      id: "math",
      kind: "anyOf",
      label: "Calculus",
      group: "Core",
      source: SRC,
      rows: [
        { id: "math-a", kind: "seat", label: "MATH 1910", group: "Core", source: SRC, rule: { course: ["MATH-1910"] } },
        { id: "math-b", kind: "seat", label: "MATH 1120", group: "Core", source: SRC, rule: { course: ["MATH-1120"] } },
      ],
    },
    { id: "advising", kind: "confirm", label: "Advising", group: "Core", source: SRC },
  ],
};

/** The hook's composition: a layer row id first, the Engineering slots otherwise. */
const layerCtx = (missing: Record<string, string[]> = {}) => {
  const layerRow = buildLayerRowPredicate([LAYER], (id) => missing[id], { programId: "test-major" });
  const engineering = buildRequirementPredicate(REQ_SLOTS);
  return ctx({ satisfiesRequirement: (r, id) => layerRow(r, id) ?? engineering(r, id) });
};

describe("matchesFilters — requirementId of a Distribution row (spec 019 D9)", () => {
  it("builds the engine's course shape from an index record", () => {
    expect(recordToDistCourse(rec({ attrs: ["ALC-AS"], creditsMin: 1, creditsMax: 4 }))).toEqual({
      id: "CS-2110",
      subject: "CS",
      number: "2110",
      title: "Object-Oriented Programming and Data Structures",
      attrs: [{ value: "ALC-AS" }],
      credits: 1,
      creditsMax: 4,
    });
  });
  it("a crossListed rule sees a record's cross-listed subjects, as the board does (review)", () => {
    const layers = [
      {
        id: "x",
        kind: "major",
        family: "cals",
        name: "X",
        catalogYear: "2026-27",
        programId: "x",
        rows: [
          {
            id: "stat",
            kind: "seat",
            label: "A STSCI course",
            group: "Core",
            source: { url: "https://example.edu", anchor: "a" },
            rule: { subject: ["STSCI"], crossListed: true },
          },
        ],
      },
    ] as Layer[];
    const btry = rec({ id: "BTRY-3010", subject: "BTRY", number: "3010" });
    const aliases = { "BTRY-3010": "STSCI-2200" };
    const ctx = { programId: "x", canonical: (id: string) => aliases[id as keyof typeof aliases] ?? id };
    expect(buildLayerRowPredicate(layers, () => undefined, ctx)(btry, "x:stat")).toBe(false);
    expect(buildLayerRowPredicate(layers, () => undefined, ctx, aliases)(btry, "x:stat")).toBe(true);
  });
  it("uses the board's credit rule: a fixed 0-credit record is 0, a 0–4 record is the default 3 (review)", () => {
    expect(recordToDistCourse(rec({ creditsMin: 0, creditsMax: 0 })).credits).toBe(0);
    const v = recordToDistCourse(rec({ creditsMin: 0, creditsMax: 4 }));
    expect([v.credits, v.creditsMax]).toEqual([3, 4]);
  });
  it("seat and pool rows narrow by the row's rule (tags, subject + number)", () => {
    const eth = rec({ id: "PHIL-1440", subject: "PHIL", number: "1440", attrs: ["ETH-AG"] });
    expect(matchesFilters(eth, { requirementId: "test-major:ethics" }, layerCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "test-major:ethics" }, layerCtx())).toBe(false);
    expect(matchesFilters(rec({ id: "CS-4820", number: "4820" }), { requirementId: "test-major:upper" }, layerCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "test-major:upper" }, layerCtx())).toBe(false);
  });
  it("a distribution row narrows to its missing categories (and its eligibility rule)", () => {
    const arts = rec({ id: "ARTH-1100", subject: "ARTH", number: "1100", attrs: ["ALC-AS"] });
    const hist = rec({ id: "HIST-1500", subject: "HIST", number: "1500", attrs: ["HST-AS"] });
    const f = { requirementId: "test-major:breadth" };
    // History is the only category still missing.
    expect(matchesFilters(hist, f, layerCtx({ "test-major:breadth": ["hst"] }))).toBe(true);
    expect(matchesFilters(arts, f, layerCtx({ "test-major:breadth": ["hst"] }))).toBe(false);
    // Nothing named missing → every category.
    expect(matchesFilters(arts, f, layerCtx())).toBe(true);
    expect(matchesFilters(hist, f, layerCtx())).toBe(true);
    expect(matchesFilters(rec(), f, layerCtx())).toBe(false);
    // The row's own rule still applies (3+ credits).
    expect(matchesFilters({ ...hist, creditsMin: 1, creditsMax: 1 }, f, layerCtx())).toBe(false);
  });
  it("an anyOf row passes a course any option takes; a confirm row narrows nothing", () => {
    const f = { requirementId: "test-major:math" };
    expect(matchesFilters(rec({ id: "MATH-1120", subject: "MATH", number: "1120" }), f, layerCtx())).toBe(true);
    expect(matchesFilters(rec({ id: "MATH-1910", subject: "MATH", number: "1910" }), f, layerCtx())).toBe(true);
    expect(matchesFilters(rec(), f, layerCtx())).toBe(false);
    expect(matchesFilters(rec(), { requirementId: "test-major:advising" }, layerCtx())).toBe(true);
  });
  it("an Engineering requirementId behaves as before alongside layers", () => {
    expect(matchesFilters(rec(), { requirementId: "s-2110" }, layerCtx())).toBe(true);
    expect(matchesFilters(rec({ id: "CS-3110", number: "3110" }), { requirementId: "s-2110" }, layerCtx())).toBe(false);
    expect(matchesFilters(rec(), { requirementId: "nope" }, layerCtx())).toBe(true);
    // A key-shaped id whose layer isn't loaded narrows nothing.
    expect(matchesFilters(rec(), { requirementId: "other-layer:row" }, layerCtx())).toBe(true);
  });
});

describe("matchesFilters — prereqsMetBy (multi-select)", () => {
  // ORIE-4xxx needs ORIE-3300, which the student plans but hasn't taken.
  const metBy = (id: string, statuses: readonly PlanStatus[]) =>
    id === "ORIE-4580" ? statuses.includes("planned") : id === "MATH-1920" && statuses.includes("taken");
  const planCtx = ctx({ prereqsMetBy: metBy });

  it("hides a course whose prerequisite is only planned until Planning to take is on", () => {
    const r = rec({ id: "ORIE-4580", subject: "ORIE", number: "4580", hasPrereqs: true });
    expect(matchesFilters(r, { prereqsMetBy: ["taken"] }, planCtx)).toBe(false);
    expect(matchesFilters(r, { prereqsMetBy: ["taken", "planned"] }, planCtx)).toBe(true);
  });

  it("always keeps courses with no prerequisites", () => {
    const r = rec({ id: "ORIE-1101", hasPrereqs: false });
    expect(matchesFilters(r, { prereqsMetBy: ["taken"] }, planCtx)).toBe(true);
  });

  it("an empty selection narrows nothing; with no lookup nothing is covered", () => {
    const r = rec({ id: "CS-4820", hasPrereqs: true });
    expect(matchesFilters(r, { prereqsMetBy: [] }, planCtx)).toBe(true);
    expect(matchesFilters(r, { prereqsMetBy: ["taken"] }, ctx())).toBe(false);
  });
});

describe("buildPlanPools / prereqCandidates / prereqsMetByPools", () => {
  const course = (id: string) => {
    const [subject, number] = id.split("-");
    return { id, subject, number };
  };
  const pools = buildPlanPools(
    [
      { placementId: "p1", course: course("MATH-1910") },
      { placementId: "p2", course: course("ORIE-3300") },
      { placementId: "p3", course: course("CS-2110") },
    ],
    ["p1"],
    ["p3"],
    { ids: new Set(["PHYS-1112"]), codes: new Set(["PHYS 1112"]) }
  );
  const needs = (id: string): PrereqExpr => ({ type: "course", id });

  it("groups board courses by status, with AP/transfer credit as taken", () => {
    expect([...pools.taken.ids].sort()).toEqual(["MATH-1910", "PHYS-1112"]);
    expect([...pools["in-progress"].ids]).toEqual(["CS-2110"]);
    expect([...pools.planned.ids]).toEqual(["ORIE-3300"]);
    expect(pools.planned.codes.has("ORIE 3300")).toBe(true);
  });

  it("candidates are what the chosen pools unlock, cross-listings included", () => {
    const unlocks: Record<string, string[]> = {
      "MATH-1910": ["MATH-1920"],
      "ORIE-3300": ["ORIE-4580"],
      "CEE-2110": ["CEE-3040"],
    };
    const canonical = (id: string) => (id === "CS-2110" ? "CEE-2110" : id);
    expect([...prereqCandidates(pools, ["taken"], (id) => unlocks[id], canonical)]).toEqual(["MATH-1920"]);
    expect(
      [...prereqCandidates(pools, ["taken", "planned", "in-progress"], (id) => unlocks[id], canonical)].sort()
    ).toEqual(["CEE-3040", "MATH-1920", "ORIE-4580"]);
  });

  it("evaluates the prerequisite against only the chosen pools", () => {
    expect(prereqsMetByPools(needs("ORIE-3300"), pools, ["taken"])).toBe(false);
    expect(prereqsMetByPools(needs("ORIE-3300"), pools, ["taken", "planned"])).toBe(true);
    expect(prereqsMetByPools(needs("CS-2110"), pools, ["in-progress"])).toBe(true);
    const both: PrereqExpr = { type: "and", children: [needs("MATH-1910"), needs("ORIE-3300")] };
    expect(prereqsMetByPools(both, pools, ["taken"])).toBe(false);
    expect(prereqsMetByPools(both, pools, ["taken", "planned"])).toBe(true);
  });

  it("a soft (or-equivalent) requirement counts as firm: the course itself must be counted", () => {
    const soft: PrereqExpr = { type: "advisory", expr: needs("ORIE-3300"), note: "or equivalent" };
    expect(prereqsMetByPools(soft, pools, ["taken"])).toBe(false);
    expect(prereqsMetByPools(soft, pools, ["planned"])).toBe(true);
  });
});

describe("matchesFilters — enrollment-term roster (spec 017 D1)", () => {
  it("passes only records whose roster is the enrollment target", () => {
    const f = { onTargetRoster: true };
    const c = ctx({ enrollmentTarget: "SP27" });
    expect(matchesFilters(rec({ roster: "SP27" }), f, c)).toBe(true);
    expect(matchesFilters(rec({ roster: "FA26" }), f, c)).toBe(false);
    expect(matchesFilters(rec({ roster: null }), f, c)).toBe(false);
  });

  it("narrows nothing when there is no target (never filter on missing data)", () => {
    expect(matchesFilters(rec({ roster: "FA26" }), { onTargetRoster: true }, ctx())).toBe(true);
    expect(recordOnTargetRoster({ roster: null }, null)).toBe(true);
  });

  it("is inert when the key is absent (the drawer never sets it)", () => {
    expect(matchesFilters(rec({ roster: "FA26" }), {}, ctx({ enrollmentTarget: "SP27" }))).toBe(true);
  });
});

describe("indexHasTargetRoster — when the term switch shows (spec 017 D1)", () => {
  it("true only when some record's roster IS the target", () => {
    expect(indexHasTargetRoster([{ roster: "FA26" }, { roster: "SP27" }], "SP27")).toBe(true);
  });

  it("false when the target moved ahead of its roster sync (other rosters only)", () => {
    expect(indexHasTargetRoster([{ roster: "FA26" }, { roster: "SP27" }], "FA27")).toBe(false);
  });

  it("false with no target, or an index built before the roster field", () => {
    expect(indexHasTargetRoster([{ roster: "SP27" }], null)).toBe(false);
    expect(indexHasTargetRoster([{ roster: null }, { roster: null }], "SP27")).toBe(false);
    expect(indexHasTargetRoster([], "SP27")).toBe(false);
  });
});

describe("matchesFilters — well-rated lead lecturer (spec 017 D7)", () => {
  const rating = (over: Partial<ProfessorRating> = {}): ProfessorRating => ({
    rating: 4.2,
    count: 12,
    tier: "verified",
    fetchedAtMs: 0,
    ...over,
  });
  const lead = { netid: "al123", name: "Ada Lovelace", more: 0 };
  const f = { wellRated: true };
  const withRating = (r: ProfessorRating) =>
    ctx({ enrollmentTarget: "SP27", ratings: new Map([["al123", r]]) });
  const onTarget = (over: Partial<CatalogIndexRecord> = {}) => rec({ lead, roster: "SP27", ...over });

  it("passes a verified 4+ rating with 5+ reviews", () => {
    expect(matchesFilters(onTarget(), f, withRating(rating()))).toBe(true);
    expect(matchesFilters(onTarget(), f, withRating(rating({ rating: 4.0, count: 5 })))).toBe(true);
  });

  it("agrees with the displayed one-decimal rating", () => {
    expect(matchesFilters(onTarget(), f, withRating(rating({ rating: 3.96 })))).toBe(true);
    expect(matchesFilters(onTarget(), f, withRating(rating({ rating: 3.94 })))).toBe(false);
  });

  it("fails below the rating or review-count floor", () => {
    expect(matchesFilters(onTarget(), f, withRating(rating({ rating: 3.8 })))).toBe(false);
    expect(matchesFilters(onTarget(), f, withRating(rating({ count: 4 })))).toBe(false);
  });

  it("never passes a probable match", () => {
    expect(matchesFilters(onTarget(), f, withRating(rating({ tier: "probable", rating: 4.9 })))).toBe(false);
  });

  it("fails with no lead, no rating, or no ratings map", () => {
    expect(matchesFilters(onTarget({ lead: null }), f, withRating(rating()))).toBe(false);
    expect(matchesFilters(onTarget({ lead: { ...lead, netid: "zz1" } }), f, withRating(rating()))).toBe(false);
    expect(matchesFilters(onTarget(), f, ctx())).toBe(false);
  });

  it("fails whenever the row shows no rating: unknown roster or a name-only lead", () => {
    expect(matchesFilters(onTarget({ roster: null }), f, withRating(rating()))).toBe(false);
    expect(matchesFilters(onTarget({ lead: { ...lead, netid: "" } }), f, withRating(rating()))).toBe(false);
  });

  it("is inert when the key is absent", () => {
    expect(matchesFilters(rec({ lead: null }), {}, ctx())).toBe(true);
  });
});

describe("buildLayerRowPredicate — rows with answered leaves (spec 020, audit finding 8)", () => {
  const FWS_REF = "usedAs:cas-college/fws";
  const SRC = { url: "https://catalog.cornell.edu/", anchor: "a" };
  const layers = [
    {
      id: "cas-college",
      kind: "college",
      family: "cas",
      name: "Arts & Sciences",
      catalogYear: "2026-27",
      rows: [
        {
          id: "fws",
          kind: "pool",
          label: "Two writing seminars",
          group: "Writing",
          source: SRC,
          exclusive: true,
          rule: { anyOf: [{ titleStartsWith: "FWS:" }, { allOf: [{ course: ["ENGL-2860", "ENGL-2880"] }, { answered: FWS_REF }] }] },
          requiredCourses: 2,
          requiredCredits: 6,
        },
      ],
      questions: [{ type: "usedAs", row: "fws", courses: { course: ["ENGL-2860", "ENGL-2880"] }, source: SRC, quote: "q" }],
    },
  ] as Layer[];

  it("the FWS row's find-a-class list includes ENGL 2880 with no answers (it could count)", () => {
    const pred = buildLayerRowPredicate(layers, () => undefined, { programId: "x" });
    expect(pred(rec({ id: "ENGL-2880", subject: "ENGL", number: "2880", title: "Expository Writing" }), "cas-college:fws")).toBe(true);
    expect(pred(rec({ id: "WRIT-1370", subject: "WRIT", number: "1370", title: "FWS: Writing About Place" }), "cas-college:fws")).toBe(true);
    // Outside the question's courses: still not a writing seminar.
    expect(pred(rec({ id: "ENGL-2000", subject: "ENGL", number: "2000", title: "Survey" }), "cas-college:fws")).toBe(false);
  });
});
describe("schedule filters (spec 021)", () => {
  // CS 2110 in SP27: TR 10:10–11:25 lecture, M 7:30 PM discussion.
  const cs = rec({ id: "CS-2110", roster: "SP27", meets: ["PLEC|TR 610-685", "SDIS|M 1170-1220"] });
  const fall = rec({ id: "MATH-1910", roster: "FA26", meets: ["PLEC|MWF 545-595"] });
  const untimed = rec({ id: "CS-4999", roster: "SP27", meets: ["PIND|"] });
  const sp27 = ctx({ enrollmentTarget: "SP27" });

  it("scheduleFilterActive ignores the parts toggle on its own", () => {
    expect(scheduleFilterActive({ scheduleParts: "all" })).toBe(false);
    expect(scheduleFilterActive({ days: [] })).toBe(false);
    expect(scheduleFilterActive({ days: ["M"] })).toBe(true);
    expect(scheduleFilterActive({ timeFrom: 600 })).toBe(true);
    expect(scheduleFilterActive({ fitsSemester: true })).toBe(true);
  });

  it("no schedule filter: nothing narrowed, untimed and other-term courses included", () => {
    expect(matchesFilters(untimed, { scheduleParts: "all" }, sp27)).toBe(true);
    expect(matchesFilters(fall, {}, sp27)).toBe(true);
  });

  it("days and time window narrow on the lecture by default", () => {
    expect(matchesFilters(cs, { days: ["T", "R"] }, sp27)).toBe(true);
    expect(matchesFilters(cs, { days: ["M", "W", "F"] }, sp27)).toBe(false);
    expect(matchesFilters(cs, { timeFrom: 600, timeTo: 720 }, sp27)).toBe(true);
    expect(matchesFilters(cs, { timeFrom: 600, timeTo: 720, scheduleParts: "all" }, sp27)).toBe(false);
  });

  it("only enrollment-term times are judged; untimed courses never fit", () => {
    expect(matchesFilters(fall, { days: ["M", "W", "F"] }, sp27)).toBe(false);
    expect(matchesFilters(fall, { days: ["M", "W", "F"] }, ctx())).toBe(true); // no target: its own times
    expect(matchesFilters(untimed, { timeFrom: 420 }, sp27)).toBe(false);
  });

  it("fitsSemester hides a clash with the column, ignoring the course itself", () => {
    const busy = [{ courseId: "MATH-2940", blocks: [{ days: ["T", "R"], start: 600, end: 675 }] }];
    expect(matchesFilters(cs, { fitsSemester: true }, ctx({ enrollmentTarget: "SP27", busy }))).toBe(false);
    const self = [{ courseId: "CS-2110", blocks: [{ days: ["T", "R"], start: 610, end: 685 }] }];
    expect(matchesFilters(cs, { fitsSemester: true }, ctx({ enrollmentTarget: "SP27", busy: self }))).toBe(true);
    // A cross-listed twin on the board is the same course.
    const twin = [{ courseId: "ENGRD-2110", blocks: [{ days: ["T", "R"], start: 610, end: 685 }] }];
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    expect(
      matchesFilters(cs, { fitsSemester: true }, ctx({ enrollmentTarget: "SP27", busy: twin, canonical }))
    ).toBe(true);
    // Nothing on the board: everything timed this term fits.
    expect(matchesFilters(cs, { fitsSemester: true }, sp27)).toBe(true);
  });

  it("buildBusyCourses takes the enrollment-term column's timed primary sections", () => {
    const index = new Map(
      [
        cs,
        fall,
        untimed,
        rec({ id: "MATH-2940", roster: "SP27", meets: ["SDIS|F 600-650", "PLEC|MW 610-660", "PLEC|MW 700-750"] }),
      ].map((r) => [r.id, r])
    );
    const cards = [
      { placement: { sem: 2 }, course: { id: "MATH-2940" } }, // SP27 column (entering 2026)
      { placement: { sem: 2 }, course: { id: "CS-4999" } }, // untimed: skipped
      { placement: { sem: 2 }, course: { id: "MATH-1910" } }, // FA26 times: skipped
      { placement: { sem: 4 }, course: { id: "CS-2110" } }, // SP28 column: not near
    ];
    expect(buildBusyCourses(cards, (id) => index.get(id), 2026, "SP27")).toEqual([
      { courseId: "MATH-2940", blocks: [{ days: ["M", "W"], start: 610, end: 660 }] },
    ]);
    expect(buildBusyCourses(cards, (id) => index.get(id), null, "SP27")).toEqual([]);
    expect(buildBusyCourses(cards, (id) => index.get(id), 2026, null)).toEqual([]);
  });

  it("indexHasMeetings: only once some record carries times", () => {
    expect(indexHasMeetings([{ meets: [] }, { meets: [] }])).toBe(false);
    expect(indexHasMeetings([{ meets: [] }, { meets: ["PIND|"] }])).toBe(true);
  });
});

describe("matchesFilters — distribution tag (spec 022)", () => {
  it("keeps courses carrying the tag, drops others and untagged ones", () => {
    expect(matchesFilters(rec({ attrs: ["LA-AG", "ALC-AS"] }), { distTag: "LA-AG" }, ctx())).toBe(true);
    expect(matchesFilters(rec({ attrs: ["CA-AG"] }), { distTag: "LA-AG" }, ctx())).toBe(false);
    expect(matchesFilters(rec({}), { distTag: "LA-AG" }, ctx())).toBe(false);
  });

  it("combines with the requirement and schedule axes", () => {
    const r = rec({ attrs: ["LA-AG"], roster: "SP27", meets: ["PLEC|TR 805-880"] });
    const c = ctx({ enrollmentTarget: "SP27", satisfiesRequirement: (_r, id) => id === "liberal" });
    expect(matchesFilters(r, { distTag: "LA-AG", days: ["T", "R"], timeFrom: 780 }, c)).toBe(true);
    expect(matchesFilters(r, { distTag: "LA-AG", days: ["M", "W"] }, c)).toBe(false);
    expect(matchesFilters(r, { distTag: "LA-AG", requirementId: "other" }, c)).toBe(false);
  });
});

describe("matchesFilters — several levels at once", () => {
  it("passes a course at ANY chosen level", () => {
    const f = { levels: [2, 4] };
    expect(matchesFilters(rec({ number: "2110" }), f, ctx())).toBe(true);
    expect(matchesFilters(rec({ number: "4820" }), f, ctx())).toBe(true);
    expect(matchesFilters(rec({ number: "3110" }), f, ctx())).toBe(false);
    expect(matchesFilters(rec({ number: "1110" }), f, ctx())).toBe(false);
  });

  it("an empty selection narrows nothing", () => {
    expect(matchesFilters(rec({ number: "3110" }), { levels: [] }, ctx())).toBe(true);
  });

  it("composes with the other axes", () => {
    expect(matchesFilters(rec({ subject: "CS", number: "4820" }), { subject: "CS", levels: [3, 4] }, ctx())).toBe(true);
    expect(matchesFilters(rec({ subject: "CS", number: "4820" }), { subject: "MATH", levels: [3, 4] }, ctx())).toBe(false);
  });
});


// Spec 037 D10 — "Counts toward" Liberal Studies and its seven groups, over
// lean index records (attrs as plain strings; no term: not placed yet).
describe("buildLiberalStudiesPredicate", () => {
  const lsRec = (id: string, attrs: string[]) => {
    const [subject, number] = id.split("-");
    return rec({ id, subject, number, attrs, hasPrereqs: false });
  };
  const GROUPS = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"];
  // One tagged record per group, each tagged for that group only.
  const PER_GROUP: [string, string, string[]][] = [
    ["g1", "ENGL-2800", ["LA-AG", "ALC-AS"]],
    ["g2", "HIST-1200", ["HST-AS"]],
    ["g3", "PHIL-1100", ["KCM-AG", "ETM-AS"]],
    ["g4", "ECON-1110", ["SBA-AG", "SSC-AS"]],
    ["g5", "SPAN-1210", ["FL-AG"]],
    ["g6", "ENGRC-3500", ["CE-EN"]],
    ["g7", "AAS-2130", ["SCD-AS"]],
  ];
  const fa2024 = buildLiberalStudiesPredicate("fa2024");

  it("a tagged record is found under Liberal Studies and its own group only", () => {
    for (const [group, id, attrs] of PER_GROUP) {
      const r = lsRec(id, attrs);
      expect([id, fa2024(r, "liberal-studies")]).toEqual([id, true]);
      for (const g of GROUPS) expect([id, g, fa2024(r, `liberal-studies#${g}`)]).toEqual([id, g, g === group]);
    }
  });

  it("any college's suffix counts (LAD-HE in Arts & Culture)", () => {
    expect(fa2024(lsRec("FSAD-1220", ["LAD-HE"]), "liberal-studies#g1")).toBe(true);
  });

  it("D-HE-only and untagged records are left out everywhere", () => {
    for (const r of [lsRec("DEA-1110", ["D-HE"]), lsRec("CS-2110", []), lsRec("MATH-1910", ["CU-SBY"])]) {
      expect(fa2024(r, "liberal-studies")).toBe(false);
      for (const g of GROUPS) expect(fa2024(r, `liberal-studies#${g}`)).toBe(false);
    }
  });

  it("a petitioned course with no roster tag is found in its petitioned group", () => {
    // AEM 2710: Engineering's petitions list, SBA/SSC → Social Science.
    const r = lsRec("AEM-2710", []);
    expect(fa2024(r, "liberal-studies")).toBe(true);
    expect(fa2024(r, "liberal-studies#g4")).toBe(true);
    expect(fa2024(r, "liberal-studies#g1")).toBe(false);
  });

  it("follows the entering class: SCD-AS is Race & Equity for Fall 2024+, Arts & Culture for 2020–24", () => {
    const r = lsRec("AAS-2130", ["SCD-AS"]);
    const fa2020 = buildLiberalStudiesPredicate("fa2020");
    expect(fa2024(r, "liberal-studies#g7")).toBe(true);
    expect(fa2020(r, "liberal-studies#g7")).toBe(false);
    expect(fa2020(r, "liberal-studies#g1")).toBe(true);
  });

  it("any other requirement id is not its business (null)", () => {
    const r = lsRec("ECON-1110", ["SBA-AG"]);
    expect(fa2024(r, "g-cs")).toBeNull();
    expect(fa2024(r, "cas-college:dist")).toBeNull();
  });

  it("composes with the rest of the filters through satisfiesRequirement", () => {
    const satisfiesRequirement = (r: CatalogIndexRecord, id: string) => fa2024(r, id) ?? true;
    const f = { requirementId: "liberal-studies#g5", levels: [1] };
    expect(matchesFilters(lsRec("SPAN-1210", ["FL-AG"]), f, ctx({ satisfiesRequirement }))).toBe(true);
    expect(matchesFilters(lsRec("SPAN-2090", ["FL-AG"]), f, ctx({ satisfiesRequirement }))).toBe(false);
    expect(matchesFilters(lsRec("ECON-1110", ["SBA-AG"]), f, ctx({ satisfiesRequirement }))).toBe(false);
  });
});

describe("liberalStudiesFilterCohort", () => {
  it("entry term first, then entering year, else the Fall 2024 groups", () => {
    expect(liberalStudiesFilterCohort("FA25", null)).toBe("fa2024");
    expect(liberalStudiesFilterCohort("FA22", 2025)).toBe("fa2020");
    expect(liberalStudiesFilterCohort(null, 2021)).toBe("fa2020");
    expect(liberalStudiesFilterCohort(null, 2024)).toBe("fa2024");
    expect(liberalStudiesFilterCohort(null, null)).toBe("fa2024");
  });
});
