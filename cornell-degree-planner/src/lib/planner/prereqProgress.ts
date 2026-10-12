import type { PrereqExpr } from "@/types/db";
import { evaluatePrereq, type PrereqEvalOpts } from "./evaluatePrereq";

/**
 * prereqProgress — met/total over a course's TOP-LEVEL prerequisite
 * requirements, feeding the CourseCard "PRE 1/2" counter (card direction 11,
 * claude-design-2026-07-11).
 *
 * "Top-level requirement" counting rule:
 *   - an AND root: each NON-advisory child is one requirement (an OR child
 *     counts as ONE requirement, satisfied by any of its alternatives);
 *   - advisory nodes (spec 007 §1b/§3) are NOT hard requirements — they never
 *     block (evaluatePrereq always passes them), so counting them would
 *     inflate the total with always-met rows ("PRE 1/1 ✓") while the card
 *     shows the quiet advisory state. Advisory children are filtered out of
 *     an AND root; a root that is ITSELF advisory counts zero requirements.
 *     Exception: an advisory whose requirement the board places too late
 *     blocks in the engine, so it counts as one (unmet) requirement;
 *   - any other root (course / pattern / concurrent / OR): one requirement;
 *   - no expression at all (or advisory-only): zero requirements ("PRE —").
 *
 * Each requirement is scored with the SAME evaluator and pool semantics the
 * unified engine uses (evaluatePrereq over semesterPrereqPools output), so
 * `met === total` if and only if computeCardStatusMap's `prereq` is true for
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
  /** Cross-listing canonicalizer — pass the engine's so the counter agrees
   *  with `blocked` for cross-listed leaves. Identity when omitted. */
  canonical?: (id: string) => string;
  /** Every course on the board (`semesterPrereqPools(...).boardIds`), so an
   *  advisory requirement placed too late counts as an unmet requirement,
   *  exactly when the engine blocks on it. */
  boardIds?: Set<string>;
};

export function prereqProgress(
  expr: PrereqExpr | null | undefined,
  pools: PrereqProgressPools
): PrereqProgress {
  if (!expr) return { met: 0, total: 0 };
  const opts: PrereqEvalOpts = {
    concurrentIds: pools.concurrentIds,
    canonical: pools.canonical,
    boardIds: pools.boardIds,
  };
  // Advisory is not a hard requirement (spec 007 §1b/§3) and isn't counted,
  // unless the board places it too late: then it blocks, so it counts (unmet).
  const counts = (c: PrereqExpr) =>
    c.type !== "advisory" || !evaluatePrereq(c, pools.completedIds, pools.completedCodes, opts);
  const top = expr.type === "and" ? expr.children : [expr];
  const requirements = top.filter(counts);
  let met = 0;
  for (const req of requirements) {
    if (evaluatePrereq(req, pools.completedIds, pools.completedCodes, opts)) met++;
  }
  return { met, total: requirements.length };
}
