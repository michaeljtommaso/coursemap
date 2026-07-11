import { describe, it, expect } from "vitest";
import { prereqProgress, type PrereqProgressPools } from "./prereqProgress";
import { evaluatePrereq } from "./evaluatePrereq";
import type { PrereqExpr } from "@/types/db";

// ── Fixtures ────────────────────────────────────────────────────────────────

const course = (id: string): PrereqExpr => ({ type: "course", id });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });

function pools(
  ids: string[] = [],
  codes: string[] = [],
  concurrent?: string[]
): PrereqProgressPools {
  return {
    completedIds: new Set(ids),
    completedCodes: new Set(codes),
    concurrentIds: concurrent ? new Set(concurrent) : undefined,
  };
}

// ── Cases ────────────────────────────────────────────────────────────────────

describe("prereqProgress", () => {
  it("null / undefined expr → 0/0 (renders as PRE —)", () => {
    expect(prereqProgress(null, pools())).toEqual({ met: 0, total: 0 });
    expect(prereqProgress(undefined, pools())).toEqual({ met: 0, total: 0 });
  });

  it("single course root — met and unmet", () => {
    const expr = course("CS-1110");
    expect(prereqProgress(expr, pools(["CS-1110"]))).toEqual({ met: 1, total: 1 });
    expect(prereqProgress(expr, pools())).toEqual({ met: 0, total: 1 });
  });

  it("AND of 3 — partially met counts each top-level child", () => {
    const expr = and(course("A"), course("B"), course("C"));
    expect(prereqProgress(expr, pools(["A", "C"]))).toEqual({ met: 2, total: 3 });
    expect(prereqProgress(expr, pools([]))).toEqual({ met: 0, total: 3 });
    expect(prereqProgress(expr, pools(["A", "B", "C"]))).toEqual({ met: 3, total: 3 });
  });

  it("OR root counts as ONE requirement, satisfied by any alternative", () => {
    const expr = or(course("CS-1110"), course("CS-1112"));
    expect(prereqProgress(expr, pools(["CS-1112"]))).toEqual({ met: 1, total: 1 });
    expect(prereqProgress(expr, pools(["ENGL-1101"]))).toEqual({ met: 0, total: 1 });
  });

  it("an OR nested under an AND is still one requirement", () => {
    const expr = and(or(course("CS-1110"), course("CS-1112")), course("MATH-1910"));
    expect(prereqProgress(expr, pools(["CS-1112"]))).toEqual({ met: 1, total: 2 });
    expect(prereqProgress(expr, pools(["CS-1110", "MATH-1910"]))).toEqual({ met: 2, total: 2 });
  });

  it("pattern root — matched by completed CODES (dash/space + wildcards)", () => {
    const expr: PrereqExpr = { type: "pattern", pattern: "MATH-19x0" };
    expect(prereqProgress(expr, pools([], ["MATH 1910"]))).toEqual({ met: 1, total: 1 });
    expect(prereqProgress(expr, pools([], ["MATH 2210"]))).toEqual({ met: 0, total: 1 });
  });

  it("concurrent — met via the same-or-earlier pool; unmet when absent", () => {
    const expr: PrereqExpr = { type: "concurrent", id: "MATH-1920" };
    // Planned in the same semester → satisfied.
    expect(prereqProgress(expr, pools([], [], ["MATH-1920"]))).toEqual({ met: 1, total: 1 });
    // Already completed (earlier pool) also satisfies.
    expect(prereqProgress(expr, pools(["MATH-1920"], [], []))).toEqual({ met: 1, total: 1 });
    // Concurrent pool provided but the course is nowhere → unmet.
    expect(prereqProgress(expr, pools([], [], []))).toEqual({ met: 0, total: 1 });
    // No concurrent pool at all (no target semester) → satisfiable-by-definition,
    // matching evaluatePrereq's catalog-context behavior.
    expect(prereqProgress(expr, pools())).toEqual({ met: 1, total: 1 });
  });

  it("agrees with the engine evaluator: met === total ⟺ evaluatePrereq true", () => {
    const exprs: PrereqExpr[] = [
      course("A"),
      and(course("A"), or(course("B"), course("C"))),
      or(course("A"), course("B")),
      and(course("A"), { type: "pattern", pattern: "CS-2xxx" }, { type: "concurrent", id: "D" }),
    ];
    const poolVariants = [
      pools([], [], []),
      pools(["A"], [], []),
      pools(["A", "B"], ["CS 2110"], ["D"]),
      pools(["A", "B", "C", "D"], ["CS 2800"], ["D"]),
    ];
    for (const expr of exprs) {
      for (const p of poolVariants) {
        const { met, total } = prereqProgress(expr, p);
        const whole = evaluatePrereq(expr, p.completedIds, p.completedCodes, {
          concurrentIds: p.concurrentIds,
        });
        expect(met === total).toBe(whole);
      }
    }
  });
});
