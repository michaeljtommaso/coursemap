import type { Course, ProgramSlotWithData } from "@/types/db";
import {
  semesterPrereqPools,
  type CreditCourses,
  type SlotStatus,
} from "./computeSlotStatusMap";
import { findPendingChoice, type OpenChoice, type PendingChoice } from "./pendingChoices";
import { itemsBySemester } from "./requirementProgress";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";

/**
 * pendingChoiceMap.ts — the board-level half of the "pick one" state: which
 * HARD-blocked cards are only waiting on an open choice requirement. Layered
 * on top of computeSlotStatusMap (its `blocked` keeps its meaning); the
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

/** slot id → the choice that blocked card is waiting on. Only blocked,
 *  non-credit-covered cards are considered; cards that open choices can't
 *  unblock are absent (they stay red). */
export function computePendingChoiceMap(
  slots: ProgramSlotWithData[],
  markedCompleteIds: string[],
  slotPicks: Record<string, string>,
  pickedCourses: Record<string, Course>,
  statusMap: Record<string, SlotStatus>,
  choices: OpenChoice[],
  creditCourses?: CreditCourses,
  canonical?: (id: string) => string
): Record<string, PendingChoice> {
  const out: Record<string, PendingChoice> = {};
  if (choices.length === 0) return out;
  const poolsBySem = new Map<number, ReturnType<typeof semesterPrereqPools>>();
  for (const slot of slots) {
    const status = statusMap[slot.id];
    const course = slot.courses;
    if (!status?.blocked || status.coveredByCredit || !course) continue;
    const sem = slot.suggested_semester;
    let pools = poolsBySem.get(sem);
    if (!pools) {
      pools = semesterPrereqPools(slots, markedCompleteIds, slotPicks, pickedCourses, sem, creditCourses);
      poolsBySem.set(sem, pools);
    }
    const choice = findPendingChoice({
      prereqExpr: course.prereq_expr,
      coreqExpr: course.coreq_expr,
      sem,
      pools,
      choices,
      canonical,
    });
    if (choice) out[slot.id] = choice;
  }
  return out;
}
