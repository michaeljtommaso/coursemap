import { describe, it, expect } from "vitest";
import { matchesFilters, type FilterContext } from "./useCourseFilters";
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
