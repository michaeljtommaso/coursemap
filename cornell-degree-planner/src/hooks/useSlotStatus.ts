import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { computeSlotStatusMap, type SlotStatusResult } from "@/lib/planner/computeSlotStatusMap";
import {
  collectPlanCourseIds,
  enrichSlots,
  enrichSelectedCourses,
} from "@/lib/planner/enrichCourses";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * useSlotStatus (spec 006 §B.2) — the single hook every canvas/legend surface
 * reads slot state from. Returns the full unified status: prereq, coreq,
 * offeredOk, blocked, unmet leaves, and per-semester credit totals.
 *
 * Data feed (the fix for the "template slots never block" bug): template slot
 * snapshots and plan course snapshots deliberately carry null prereq/coreq and
 * empty offered (they're display-only). Here we (1) ask CatalogProvider to fetch
 * the full docs for the ≤~60 course ids ACTUALLY on this plan — batched, deduped,
 * session-cached, never a catalog scan — and (2) overlay those real exprs onto
 * the snapshots before handing them to the (unchanged) engine. Until a doc
 * arrives the course reads as before (neutral), then upgrades on the next render.
 *
 * Returns { statusMap, semesterCredits }. Index statusMap by slot id
 * (`statusMap[slot.id]`); read column credit totals via `semesterCredits.get(sem)`.
 */
export function useSlotStatus(slots: ProgramSlotWithData[]): SlotStatusResult {
  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();
  const { courseDetails, ensureCourseDetails } = useCatalogContext();

  // Fetch full docs for every course placed on the plan (template + user picks).
  const planCourseIds = useMemo(
    () => collectPlanCourseIds(slots, slotSelections),
    [slots, slotSelections]
  );
  useEffect(() => {
    ensureCourseDetails(planCourseIds);
  }, [planCourseIds, ensureCourseDetails]);

  // Overlay real prereq/coreq/offered onto the display snapshots (same reference
  // when nothing is cached yet, so the engine memo below stays stable).
  const enrichedSlots = useMemo(
    () => enrichSlots(slots, courseDetails),
    [slots, courseDetails]
  );
  const enrichedSelected = useMemo(
    () => enrichSelectedCourses(selectedCourses, courseDetails),
    [selectedCourses, courseDetails]
  );

  return useMemo(
    () =>
      computeSlotStatusMap(
        enrichedSlots,
        completedSlotIds,
        slotSelections,
        enrichedSelected
      ),
    [enrichedSlots, completedSlotIds, slotSelections, enrichedSelected]
  );
}
