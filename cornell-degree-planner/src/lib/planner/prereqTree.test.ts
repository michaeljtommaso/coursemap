import { describe, it, expect } from "vitest";
import { annotatePrereq, idToCode, type PrereqPools } from "./prereqTree";
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

describe("annotatePrereq — course leaves", () => {
  it("marks a satisfied course met", () => {
    const a = annotatePrereq(course("CS-2110"), pools(["CS-2110"]));
    expect(a).toMatchObject({ type: "course", met: true, id: "CS-2110", code: "CS 2110" });
  });
  it("marks a missing course unmet", () => {
    const a = annotatePrereq(course("CS-2110"), pools([]));
    expect(a.met).toBe(false);
  });
});

describe("annotatePrereq — and", () => {
  it("met only when every child is met", () => {
    const expr = and(course("MATH-1910"), course("CS-1110"));
    expect(annotatePrereq(expr, pools(["MATH-1910", "CS-1110"])).met).toBe(true);
    expect(annotatePrereq(expr, pools(["MATH-1910"])).met).toBe(false);
  });
});

describe("annotatePrereq — or / alternatives + blame", () => {
  it("is met when ANY alternative is met, and each alternative keeps its own met flag", () => {
    const expr = or(course("CS-2110"), course("CS-2112"));
    const a = annotatePrereq(expr, pools(["CS-2112"]));
    expect(a.met).toBe(true);
    if (a.type === "or") {
      expect(a.children.find((c) => "id" in c && c.id === "CS-2110")?.met).toBe(false);
      expect(a.children.find((c) => "id" in c && c.id === "CS-2112")?.met).toBe(true);
    }
  });
  it("a failed or surfaces every alternative as unmet (all shown as fixes)", () => {
    const expr = or(course("CS-2110"), course("CS-2112"));
    const a = annotatePrereq(expr, pools([]));
    expect(a.met).toBe(false);
    if (a.type === "or") expect(a.children.every((c) => !c.met)).toBe(true);
  });
});

describe("annotatePrereq — pattern", () => {
  it("met when a completed code matches the wildcard pattern", () => {
    const a = annotatePrereq(pattern("CS-111x"), pools(["CS-1110"]));
    expect(a).toMatchObject({ type: "pattern", met: true, pattern: "CS-111x" });
    if (a.type === "pattern") expect(a.label).toBe("CS 111x (any matching)");
  });
  it("unmet when no completed code matches", () => {
    expect(annotatePrereq(pattern("CS-111x"), pools(["MATH-1910"])).met).toBe(false);
  });
});

describe("annotatePrereq — concurrent", () => {
  it("met when the id is in the concurrent pool", () => {
    expect(annotatePrereq(concurrent("PHYS-2213"), pools([], { concurrent: ["PHYS-2213"] })).met).toBe(true);
  });
  it("met when the id is already completed", () => {
    expect(annotatePrereq(concurrent("PHYS-2213"), pools(["PHYS-2213"], { concurrent: [] })).met).toBe(true);
  });
  it("satisfiable-by-definition when no concurrent pool is supplied", () => {
    expect(annotatePrereq(concurrent("PHYS-2213"), pools([], { concurrent: null })).met).toBe(true);
  });
  it("unmet when a concurrent pool is supplied but lacks the id", () => {
    expect(annotatePrereq(concurrent("PHYS-2213"), pools([], { concurrent: ["MATH-1910"] })).met).toBe(false);
  });
});

describe("annotatePrereq — nested composition", () => {
  it("annotates a realistic and(or, pattern, concurrent) tree", () => {
    const expr = and(
      or(course("CS-2110"), course("CS-2112")),
      pattern("MATH-19xx"),
      concurrent("PHYS-2213")
    );
    const a = annotatePrereq(expr, pools(["CS-2110", "MATH-1910"], { concurrent: ["PHYS-2213"] }));
    expect(a.met).toBe(true);
    // Same tree, concurrent unsatisfied → whole thing unmet.
    const b = annotatePrereq(expr, pools(["CS-2110", "MATH-1910"], { concurrent: ["MATH-1910"] }));
    expect(b.met).toBe(false);
  });
});
