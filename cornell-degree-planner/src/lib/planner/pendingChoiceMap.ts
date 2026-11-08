import type { BoardCard } from "./board";
import {
  semesterPrereqPools,
  type CardStatus,
  type CreditCourses,
} from "./computeCardStatusMap";
import { findPendingChoice, withoutPlacedPicks, type OpenChoice, type PendingChoice } from "./pendingChoices";
import { itemsBySemester } from "./requirementProgress";
import { columnKey, refOf } from "./terms";
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
      // A "pick one of these" group still short of picks: its explicit
      // members make it a concrete choice. Short only on CREDITS (a 3-credit
      // lecture in a 4-credit group) means the pick is made — not a choice.
      const p = it.poolProgress;
      if (p && p.courses >= p.requiredCourses) continue;
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
  // Placed members are not the pick a blocked card is waiting on.
  const placedIds = cards.map((c) => c.course.id);
  const open = withoutPlacedPicks(choices, placedIds, canonical);
  if (open.length === 0) return out;
  // Pools per column, keyed by TIME key (spec 042: a short term is its own
  // column, between semester k − 1 and k).
  const poolsByColumn = new Map<number, ReturnType<typeof semesterPrereqPools>>();
  for (const { placement, course } of cards) {
    const status = statusMap[placement.id];
    if (!status?.blocked || status.coveredByCredit) continue;
    const column = refOf(placement);
    const key = columnKey(column);
    let pools = poolsByColumn.get(key);
    if (!pools) {
      pools = semesterPrereqPools(cards, completedPlacementIds, column, creditCourses);
      poolsByColumn.set(key, pools);
    }
    const choice = findPendingChoice({
      prereqExpr: course.prereq_expr,
      coreqExpr: course.coreq_expr,
      // findPendingChoice compares this against a requirement's suggested
      // (Fall/Spring) semester. On the semester scale a short term before k
      // sits at k − ½ (columnKey / 2): a suggested semester s is strictly
      // earlier iff s < k − ½ and same-or-earlier iff s ≤ k − ½ — both "s < k",
      // as time order requires. A regular semester stays exactly k.
      sem: key / 2,
      pools,
      choices: open,
      canonical,
    });
    if (choice) out[placement.id] = choice;
  }
  return out;
}
