import { useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { computeSlotStatusMap, type SlotStatusResult } from "@/lib/planner/computeSlotStatusMap";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * useSlotStatus (spec 006 §B.2) — the single hook every canvas/catalog/legend
 * surface reads slot state from. Modeled on the memoized
 * computePrereqStatusMap call RoadmapCanvas already runs, but returns the full
 * unified status: prereq, coreq, offeredOk, blocked, unmet leaves, and the
 * per-semester credit totals.
 *
 * Returns { statusMap, semesterCredits }. Index statusMap by slot id
 * (`statusMap[slot.id]`); read column credit totals via
 * `semesterCredits.get(sem)`.
 */
export function useSlotStatus(slots: ProgramSlotWithData[]): SlotStatusResult {
  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();
  return useMemo(
    () => computeSlotStatusMap(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
  );
}
