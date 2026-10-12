import type { PrereqExpr, Course } from "@/types/db";
import type { BoardCard } from "./board";
import { computeCardStatusMap } from "./computeCardStatusMap";
import { evaluate, patternToRegex } from "./satisfies";

// patternToRegex now lives in satisfies.ts (the single satisfaction module);
// re-exported here so existing `@/lib/planner/evaluatePrereq` imports keep working.
export { patternToRegex };

export type PrereqEvalOpts = {
  /** Courses available for {type:"concurrent"} nodes — completed PLUS anything
   *  planned in the same or an earlier semester (spec 005 §3). When omitted
   *  (e.g. catalog chips, which have no target semester), concurrent
   *  requirements stay satisfiable-by-definition. */
  concurrentIds?: Set<string>;
  /** Cross-listing canonicalizer (satisfies.EvalContext.canonical). */
  canonical?: (id: string) => string;
  /** Every course on the board (satisfies.EvalContext.boardIds). */
  boardIds?: Set<string>;
};

/**
 * Thin boolean wrapper over the single satisfaction engine (satisfies.evaluate).
 * "Hard-satisfied" (advisory nodes treated as always-true) is exactly
 * `state !== "blocked"`, so met/advisory → true and blocked → false — bit-for-bit
 * the old evaluator's semantics. There is no second tree-walk anywhere now.
 */
export function evaluatePrereq(
  expr: PrereqExpr | null | undefined,
  completedIds: Set<string>,
  completedCodes: Set<string>,
  opts?: PrereqEvalOpts
): boolean {
  return (
    evaluate(expr, {
      completedIds,
      completedCodes,
      concurrentIds: opts?.concurrentIds,
      canonical: opts?.canonical,
      boardIds: opts?.boardIds,
    }).state !== "blocked"
  );
}

// For each card on the board, determine whether the placed course's prereqs
// are satisfied by courses in earlier semesters (planned or completed).
// Returns null when the course has no prereqs.
//
// This is a thin, back-compat projection of the unified engine
// (computeCardStatusMap) down to its prereq field, keyed by placement id, for
// callers that only need the boolean. Prereq semantics are unchanged.
export function computePrereqStatusMap(
  cards: BoardCard[],
  completedPlacementIds: string[],
  placedCourses: Record<string, Course>
): Record<string, boolean | null> {
  const { statusMap } = computeCardStatusMap(cards, completedPlacementIds, placedCourses);
  const result: Record<string, boolean | null> = {};
  for (const placementId of Object.keys(statusMap)) {
    result[placementId] = statusMap[placementId].prereq;
  }
  return result;
}

/** The courses (ids + display codes) of every completed card, regardless of
 *  column. */
export function buildCompletedSets(
  cards: BoardCard[],
  completedPlacementIds: string[]
): { completedIds: Set<string>; completedCodes: Set<string> } {
  const completedIds = new Set<string>();
  const completedCodes = new Set<string>();
  const completedSet = new Set(completedPlacementIds);

  for (const { placement, course } of cards) {
    if (!completedSet.has(placement.id)) continue;
    completedIds.add(course.id);
    completedCodes.add(`${course.subject} ${course.number}`);
  }

  return { completedIds, completedCodes };
}
