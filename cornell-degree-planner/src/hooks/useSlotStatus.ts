import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { computeSlotStatusMap, type SlotStatusResult } from "@/lib/planner/computeSlotStatusMap";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * useSlotStatus (spec 006 §B.2) — the single hook every canvas/legend surface
 * reads slot state from. Returns the full unified status: prereq, coreq,
 * offeredOk, blocked, unmet leaves, and per-semester credit totals.
 *
 * Data feed (the fix for the "template slots never block" bug): the enrichment
 * supply line — fetch the ≤~60 plan course docs and overlay their real
 * prereq/coreq/offered onto the display snapshots — now lives in the shared
 * useEnrichedPlan hook (spec 008 §2c), consumed here and by useDerivedEdges so
 * the status engine and the derived graph read the SAME enriched courses. The
 * engine memo's deps are unchanged from the pre-extraction version.
 *
 * Returns { statusMap, semesterCredits }. Index statusMap by slot id
 * (`statusMap[slot.id]`); read column credit totals via `semesterCredits.get(sem)`.
 */
export function useSlotStatus(slots: ProgramSlotWithData[]): SlotStatusResult {
  const { enrichedSlots, enrichedSelected, slotSelections, completedSlotIds } =
    useEnrichedPlan(slots);
  const { creditProfile } = useAuth();

  // Credit profile (spec 007 §2) folded into the evaluation pool as synthetic
  // completed courses — recomputed only when the profile's entries change.
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);

  return useMemo(
    () =>
      computeSlotStatusMap(
        enrichedSlots,
        completedSlotIds,
        slotSelections,
        enrichedSelected,
        creditCourses
      ),
    [enrichedSlots, completedSlotIds, slotSelections, enrichedSelected, creditCourses]
  );
}
