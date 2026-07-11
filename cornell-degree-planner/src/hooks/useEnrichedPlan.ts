import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import {
  collectPlanCourseIds,
  enrichSlots,
  enrichSelectedCourses,
} from "@/lib/planner/enrichCourses";
import type { Course, ProgramSlotWithData } from "@/types/db";

/**
 * useEnrichedPlan (spec 008 §2c, Unit 8B) — the shared enrichment supply line,
 * extracted verbatim from useSlotStatus so BOTH the status engine and the
 * derived-edge/unlocks graph read the SAME enriched courses from ONE place.
 *
 * The job (unchanged from useSlotStatus's original inline version): (1) ask
 * CatalogProvider to fetch the full docs for the ≤~60 ids actually on this plan
 * — batched, deduped, session-cached, never a catalog scan — and (2) overlay
 * those real prereq/coreq/offered trees onto the display-only snapshots
 * (template slots + plan picks carry null exprs). Until a doc arrives the
 * course reads as before; it upgrades on the next render.
 *
 * Returns the enriched slots + selection map plus the raw slotSelections /
 * completedSlotIds the consumers key their memos on. Reference-stable when the
 * plan and cache are unchanged (enrichSlots/enrichSelectedCourses return the
 * SAME array/object when nothing changed), so memoized consumers stay stable.
 */
export type EnrichedPlan = {
  enrichedSlots: ProgramSlotWithData[];
  enrichedSelected: Record<string, Course>;
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
};

export function useEnrichedPlan(slots: ProgramSlotWithData[]): EnrichedPlan {
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
  // when nothing is cached yet, so downstream memos stay stable).
  const enrichedSlots = useMemo(
    () => enrichSlots(slots, courseDetails),
    [slots, courseDetails]
  );
  const enrichedSelected = useMemo(
    () => enrichSelectedCourses(selectedCourses, courseDetails),
    [selectedCourses, courseDetails]
  );

  return { enrichedSlots, enrichedSelected, slotSelections, completedSlotIds };
}
