import { describe, it, expect, vi } from "vitest";

// The hook reads the alias map from CatalogProvider (which boots Firebase);
// these tests exercise only the pure predicate, so stub the context module.
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
import {
  matchesFilters,
  buildRequirementPredicate,
  buildPlanStatusMap,
  type FilterContext,
} from "./useCourseFilters";
import type { ElectiveGroup, ProgramSlotWithData } from "@/types/db";
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

describe("matchesFilters — planStatus (multi-select)", () => {
  const statuses: Record<string, "taken" | "in-progress" | "planned"> = {
    "MATH-1910": "taken",
    "CS-2110": "in-progress",
    "CS-3110": "planned",
  };
  const planCtx = ctx({ planStatusOf: (id) => statuses[id] ?? null });

  it("keeps courses whose plan status is any selected status", () => {
    const f = { planStatus: ["taken", "planned"] as const };
    expect(matchesFilters(rec({ id: "MATH-1910" }), { planStatus: [...f.planStatus] }, planCtx)).toBe(true);
    expect(matchesFilters(rec({ id: "CS-3110" }), { planStatus: [...f.planStatus] }, planCtx)).toBe(true);
    expect(matchesFilters(rec({ id: "CS-2110" }), { planStatus: [...f.planStatus] }, planCtx)).toBe(false);
  });

  it("drops courses that aren't on the plan at all", () => {
    expect(matchesFilters(rec({ id: "CS-4820" }), { planStatus: ["planned"] }, planCtx)).toBe(false);
  });

  it("an empty selection narrows nothing; with no status lookup nothing is on the plan", () => {
    expect(matchesFilters(rec({ id: "CS-4820" }), { planStatus: [] }, planCtx)).toBe(true);
    expect(matchesFilters(rec({ id: "CS-4820" }), { planStatus: ["taken"] }, ctx())).toBe(false);
  });
});

describe("buildPlanStatusMap", () => {
  const card = (placementId: string, courseId: string) => ({ placementId, courseId });

  it("labels completed, in-progress and other placed courses", () => {
    const m = buildPlanStatusMap(
      [card("p1", "MATH-1910"), card("p2", "CS-2110"), card("p3", "CS-3110")],
      ["p1"],
      ["p2"],
      new Set()
    );
    expect(m.get("MATH-1910")).toBe("taken");
    expect(m.get("CS-2110")).toBe("in-progress");
    expect(m.get("CS-3110")).toBe("planned");
  });

  it("counts AP/transfer credit as taken, and the strongest status wins for a twice-placed course", () => {
    const m = buildPlanStatusMap(
      [card("p1", "CS-2110"), card("p2", "CS-2110")],
      [],
      ["p2"],
      new Set(["PHYS-1112"])
    );
    expect(m.get("PHYS-1112")).toBe("taken");
    expect(m.get("CS-2110")).toBe("in-progress");
  });

  it("keys cross-listed courses under their canonical id too", () => {
    const m = buildPlanStatusMap([card("p1", "ENGRD-3200")], ["p1"], [], new Set(), (id) =>
      id === "ENGRD-3200" ? "CEE-3200" : id
    );
    expect(m.get("ENGRD-3200")).toBe("taken");
    expect(m.get("CEE-3200")).toBe("taken");
  });
});
