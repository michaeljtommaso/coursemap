import { describe, it, expect } from "vitest";
import { annotatePrereq, isVacuousPrereq, idToCode, type PrereqPools } from "./prereqTree";
import type { PrereqExpr } from "@/types/db";

const course = (id: string): PrereqExpr => ({ type: "course", id });
const pattern = (p: string): PrereqExpr => ({ type: "pattern", pattern: p });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });
const concurrent = (id: string): PrereqExpr => ({ type: "concurrent", id });

function pools(ids: string[], opts?: { concurrent?: string[] | null }): PrereqPools {
  const completedIds = new Set(ids);
  const completedCodes = new Set(ids.map(idToCode));
  return {
    completedIds,
    completedCodes,
    concurrentIds:
      opts?.concurrent === null
        ? undefined
        : new Set(opts?.concurrent ?? ids),
  };
}

/** Annotate an expr that is expected to carry a real requirement (non-null). */
function annotate(expr: PrereqExpr, p: PrereqPools) {
  const a = annotatePrereq(expr, p);
  if (!a) throw new Error("expected a non-null annotation");
  return a;
}

describe("annotatePrereq — course leaves", () => {
  it("marks a satisfied course met", () => {
    const a = annotate(course("CS-2110"), pools(["CS-2110"]));
    expect(a).toMatchObject({ type: "course", met: true, id: "CS-2110", code: "CS 2110" });
  });
  it("marks a missing course unmet", () => {
    const a = annotate(course("CS-2110"), pools([]));
    expect(a.met).toBe(false);
  });
});

describe("annotatePrereq — and", () => {
  it("met only when every child is met", () => {
    const expr = and(course("MATH-1910"), course("CS-1110"));
    expect(annotate(expr, pools(["MATH-1910", "CS-1110"])).met).toBe(true);
    expect(annotate(expr, pools(["MATH-1910"])).met).toBe(false);
  });
});

describe("annotatePrereq — or / alternatives + blame", () => {
  it("is met when ANY alternative is met, and each alternative keeps its own met flag", () => {
    const expr = or(course("CS-2110"), course("CS-2112"));
    const a = annotate(expr, pools(["CS-2112"]));
    expect(a.met).toBe(true);
    if (a.type === "or") {
      expect(a.children.find((c) => "id" in c && c.id === "CS-2110")?.met).toBe(false);
      expect(a.children.find((c) => "id" in c && c.id === "CS-2112")?.met).toBe(true);
    }
  });
  it("a failed or surfaces every alternative as unmet (all shown as fixes)", () => {
    const expr = or(course("CS-2110"), course("CS-2112"));
    const a = annotate(expr, pools([]));
    expect(a.met).toBe(false);
    if (a.type === "or") expect(a.children.every((c) => !c.met)).toBe(true);
  });
});

describe("annotatePrereq — pattern", () => {
  it("met when a completed code matches the wildcard pattern", () => {
    const a = annotate(pattern("CS-111x"), pools(["CS-1110"]));
    expect(a).toMatchObject({ type: "pattern", met: true, pattern: "CS-111x" });
    if (a.type === "pattern") expect(a.label).toBe("CS 111x (any matching)");
  });
  it("unmet when no completed code matches", () => {
    expect(annotate(pattern("CS-111x"), pools(["MATH-1910"])).met).toBe(false);
  });
});

describe("annotatePrereq — concurrent", () => {
  it("met when the id is in the concurrent pool", () => {
    expect(annotate(concurrent("PHYS-2213"), pools([], { concurrent: ["PHYS-2213"] })).met).toBe(true);
  });
  it("met when the id is already completed", () => {
    expect(annotate(concurrent("PHYS-2213"), pools(["PHYS-2213"], { concurrent: [] })).met).toBe(true);
  });
  it("satisfiable-by-definition when no concurrent pool is supplied", () => {
    expect(annotate(concurrent("PHYS-2213"), pools([], { concurrent: null })).met).toBe(true);
  });
  it("unmet when a concurrent pool is supplied but lacks the id", () => {
    expect(annotate(concurrent("PHYS-2213"), pools([], { concurrent: ["MATH-1910"] })).met).toBe(false);
  });
});

describe("annotatePrereq — empty groups (vacuous truth)", () => {
  it("annotates an empty and/or group to null — no requirement, not 'met'", () => {
    expect(annotatePrereq(and(), pools([]))).toBeNull();
    expect(annotatePrereq(or(), pools([]))).toBeNull();
  });
  it("annotates a group of only-empty groups to null", () => {
    expect(annotatePrereq(and(or(), and()), pools([]))).toBeNull();
  });
  it("filters empty child groups out of a real group without changing its verdict", () => {
    const a = annotate(and(course("CS-1110"), or()), pools(["CS-1110"]));
    expect(a.met).toBe(true);
    if (a.type === "and") {
      expect(a.children).toHaveLength(1);
      expect(a.children[0]).toMatchObject({ type: "course", id: "CS-1110" });
    }
  });
});

describe("isVacuousPrereq", () => {
  it("true for null/undefined and empty (or all-empty) groups", () => {
    expect(isVacuousPrereq(null)).toBe(true);
    expect(isVacuousPrereq(undefined)).toBe(true);
    expect(isVacuousPrereq(and())).toBe(true);
    expect(isVacuousPrereq(or(and(), or()))).toBe(true);
  });
  it("false as soon as any real leaf exists", () => {
    expect(isVacuousPrereq(course("CS-1110"))).toBe(false);
    expect(isVacuousPrereq(and(or(), course("CS-1110")))).toBe(false);
  });
});

describe("annotatePrereq — nested composition", () => {
  it("annotates a realistic and(or, pattern, concurrent) tree", () => {
    const expr = and(
      or(course("CS-2110"), course("CS-2112")),
      pattern("MATH-19xx"),
      concurrent("PHYS-2213")
    );
    const a = annotate(expr, pools(["CS-2110", "MATH-1910"], { concurrent: ["PHYS-2213"] }));
    expect(a.met).toBe(true);
    // Same tree, concurrent unsatisfied → whole thing unmet.
    const b = annotate(expr, pools(["CS-2110", "MATH-1910"], { concurrent: ["MATH-1910"] }));
    expect(b.met).toBe(false);
  });
});
