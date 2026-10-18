import { describe, it, expect, vi } from "vitest";

// The hook reads the alias map from CatalogProvider (which boots Firebase);
// these tests exercise only the pure predicate, so stub the context module.
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
import {
  matchesFilters,
  buildRequirementPredicate,
  buildPlanPools,
  prereqCandidates,
  prereqsMetByPools,
  type PlanStatus,
  type FilterContext,
} from "./useCourseFilters";
import type { ElectiveGroup, PrereqExpr, ProgramSlotWithData } from "@/types/db";
import type { CatalogIndexRecord } from "@/lib/schemas";

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
    expect(matchesFilters(rec({ number: "2110" }), { level: 2 }, ctx())).toBe(true);
    expect(matchesFilters(rec({ number: "4820" }), { level: 2 }, ctx())).toBe(false);
    expect(matchesFilters(rec({ number: "1110" }), { level: 1 }, ctx())).toBe(true);
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
    expect(matchesFilters(r, { attribute: FWS, level: 1 }, ctx())).toBe(true);
    expect(matchesFilters(r, { attribute: FWS, level: 3 }, ctx())).toBe(false);
  });
});

describe("matchesFilters — composition", () => {
  it("requires ALL active axes to pass", () => {
    const r = rec({ subject: "CS", number: "2110", creditsMin: 4, creditsMax: 4, offered: ["FA"] });
    expect(matchesFilters(r, { subject: "CS", level: 2, credits: 4, offered: "FA" }, ctx())).toBe(true);
    // one axis fails → whole predicate fails
    expect(matchesFilters(r, { subject: "CS", level: 2, credits: 3 }, ctx())).toBe(false);
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
    expect(matchesFilters(rec(), { requirementId: "g-lib" }, reqCtx())).toBe(true);
    expect(matchesFilters(rec(), { requirementId: "nope" }, reqCtx())).toBe(true);
  });
  it("the label is display-only and never filters", () => {
    expect(matchesFilters(rec(), { requirementLabel: "Anything" }, reqCtx())).toBe(true);
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
