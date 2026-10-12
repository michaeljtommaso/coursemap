import type { BoardCard } from "./board";
import {
  semesterPrereqPools,
  type CardStatus,
  type CreditCourses,
} from "./computeCardStatusMap";
import { findPendingChoice, withoutPlacedPicks, type OpenChoice, type PendingChoice } from "./pendingChoices";
import { itemsBySemester } from "./requirementProgress";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";

/**
 * pendingChoiceMap.ts — the board-level half of the "pick one" state: which
 * HARD-blocked cards are only waiting on an open choice requirement. Layered
 * on top of computeCardStatusMap (its `blocked` keeps its meaning); the
 * per-course rule lives in pendingChoices.findPendingChoice.
 */

/** The open, checkable seat requirements a pick could still fill, in
 *  suggested-semester order (the checklist's "By semester" order). Elective
 *  credit pools are excluded: their rules admit too broadly to say a course is
 *  waiting on them specifically. */
export function openChoices(progress: RequirementProgress): OpenChoice[] {
  const out: OpenChoice[] = [];
  for (const it of itemsBySemester(progress)) {
    if (it.choiceCourseIds && it.choiceCourseIds.length > 0 && it.status !== "waived") {
      // A "pick one of these" group: never checkable as a pool, but its
      // explicit members make it a concrete choice.
      out.push({ id: it.id, label: it.label, requirement: null, courseIds: it.choiceCourseIds, suggestedSem: it.suggestedSem });
      continue;
    }
    if (!it.checkable || !it.requirement) continue;
    out.push({ id: it.id, label: it.label, requirement: it.requirement, suggestedSem: it.suggestedSem });
  }
  return out;
}

/** placement id → the choice that blocked card is waiting on. Only blocked,
 *  non-credit-covered cards are considered; cards that open choices can't
 *  unblock are absent (they stay red). */
export function computePendingChoiceMap(
  cards: BoardCard[],
  completedPlacementIds: string[],
  statusMap: Record<string, CardStatus>,
  choices: OpenChoice[],
  creditCourses?: CreditCourses,
  canonical?: (id: string) => string
): Record<string, PendingChoice> {
  const out: Record<string, PendingChoice> = {};
  // A list group whose member is already placed (even too late) is not open.
  const placedIds = cards.map((c) => c.course.id);
  const open = withoutPlacedPicks(choices, placedIds, canonical);
  if (open.length === 0) return out;
  const poolsBySem = new Map<number, ReturnType<typeof semesterPrereqPools>>();
  for (const { placement, course } of cards) {
    const status = statusMap[placement.id];
    if (!status?.blocked || status.coveredByCredit) continue;
    const sem = placement.sem;
    let pools = poolsBySem.get(sem);
    if (!pools) {
      pools = semesterPrereqPools(cards, completedPlacementIds, sem, creditCourses);
      poolsBySem.set(sem, pools);
    }
    const choice = findPendingChoice({
      prereqExpr: course.prereq_expr,
      coreqExpr: course.coreq_expr,
      sem,
      pools,
      choices: open,
      canonical,
    });
    if (choice) out[placement.id] = choice;
  }
  return out;
}
