import type { PrereqExpr } from "@/types/db";
import { evaluatePrereq, type PrereqEvalOpts } from "./evaluatePrereq";

/**
 * prereqProgress — met/total over a course's TOP-LEVEL prerequisite
 * requirements, feeding the SlotCard "PRE 1/2" counter (card direction 11,
 * claude-design-2026-07-11).
 *
 * "Top-level requirement" counting rule:
 *   - an AND root: each child is one requirement (an OR child counts as ONE
 *     requirement, satisfied by any of its alternatives);
 *   - any other root (course / pattern / concurrent / OR): one requirement;
 *   - no expression at all: zero requirements (renders as "PRE —").
 *
 * Each requirement is scored with the SAME evaluator and pool semantics the
 * unified engine uses (evaluatePrereq over semesterPrereqPools output), so
 * `met === total` if and only if computeSlotStatusMap's `prereq` is true for
 * the same expression and pools — the counter can never disagree with the
 * card's blocked state.
 */

export type PrereqProgress = { met: number; total: number };

export type PrereqProgressPools = {
  /** Strictly-earlier-semester completed/planned pool (engine prereq semantics —
   *  `semesterPrereqPools(...).completedIds/completedCodes`). */
  completedIds: Set<string>;
  completedCodes: Set<string>;
  /** Same-or-earlier pool for {type:"concurrent"} nodes
   *  (`semesterPrereqPools(...).concurrentIds`). Omit in contexts with no
   *  target semester — concurrent nodes then read as satisfiable-by-definition,
   *  matching evaluatePrereq. */
  concurrentIds?: Set<string>;
};

export function prereqProgress(
  expr: PrereqExpr | null | undefined,
  pools: PrereqProgressPools
): PrereqProgress {
  if (!expr) return { met: 0, total: 0 };
  const requirements = expr.type === "and" ? expr.children : [expr];
  const opts: PrereqEvalOpts = { concurrentIds: pools.concurrentIds };
  let met = 0;
  for (const req of requirements) {
    if (evaluatePrereq(req, pools.completedIds, pools.completedCodes, opts)) met++;
  }
  return { met, total: requirements.length };
}
