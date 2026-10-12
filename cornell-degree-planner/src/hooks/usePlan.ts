import { usePlanContext } from "@/contexts/PlanProvider";

/**
 * Thin hook over PlanProvider — the plan state + mutations (spec 014 course
 * placement model):
 *
 *   placements, placedCourses, completedIds, inProgressIds,
 *   waivedRequirementIds,
 *   addPlacement(course, sem, index?) → id | null,
 *   movePlacement(id, sem, index), removePlacement(id) (with Undo toast),
 *   toggleCompleted(id), toggleInProgress(id),
 *   toggleWaivedRequirement(requirementId), resetPlan(),
 *   plus the plan identity / switcher surface (planId, planName, renamePlan,
 *   plansList, switchPlan, createNewPlan, deletePlan).
 *
 * Board rendering goes through useBoard (columns + cards), not raw
 * placements, wherever a component draws or evaluates the board.
 */
export function usePlan() {
  return usePlanContext();
}
