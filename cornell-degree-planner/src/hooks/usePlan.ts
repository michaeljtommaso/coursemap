import { usePlanContext } from "@/contexts/PlanProvider";

/**
 * Thin hook over PlanProvider. Returns the plan state + mutations with the SAME
 * names/shapes the old usePlannerStore exposed (slotSelections, selectedCourses,
 * completedSlotIds, waivedSlotIds, assignSlot, clearSlot, toggleCompleted,
 * toggleWaived, resetPlan) so call sites migrate with a one-line import swap
 * (docs/specs/002 §6). Plan data now lives in the cloud via PlanProvider, not in
 * localStorage.
 */
export function usePlan() {
  return usePlanContext();
}
