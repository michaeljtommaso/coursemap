import type { PrereqExpr } from "@/types/db";
import { evaluatePrereq, type PrereqEvalOpts } from "./evaluatePrereq";

/**
 * prereqProgress — met/total over a course's TOP-LEVEL prerequisite
 * requirements, feeding the SlotCard "PRE 1/2" counter (card direction 11,
 * claude-design-2026-07-11).
 *
 * "Top-level requirement" counting rule:
 *   - an AND root: each NON-advisory child is one requirement (an OR child
 *     counts as ONE requirement, satisfied by any of its alternatives);
 *   - advisory nodes (spec 007 §1b/§3) are NOT hard requirements — they never
 *     block (evaluatePrereq always passes them), so counting them would
 *     inflate the total with always-met rows ("PRE 1/1 ✓") while the card
 *     shows the quiet advisory state. Advisory children are filtered out of
 *     an AND root; a root that is ITSELF advisory counts zero requirements;
 *   - any other root (course / pattern / concurrent / OR): one requirement;
 *   - no expression at all (or advisory-only): zero requirements ("PRE —").
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
  // Advisory is never a hard requirement (spec 007 §1b/§3): filter advisory
  // children out of an AND root; an advisory root itself counts nothing.
  const requirements =
    expr.type === "and"
      ? expr.children.filter((c) => c.type !== "advisory")
      : expr.type === "advisory"
        ? []
        : [expr];
  const opts: PrereqEvalOpts = { concurrentIds: pools.concurrentIds };
  let met = 0;
  for (const req of requirements) {
    if (evaluatePrereq(req, pools.completedIds, pools.completedCodes, opts)) met++;
  }
  return { met, total: requirements.length };
}
