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
 * Placement model (spec 014): `slots` are useBoard's engineSlots — one
 * course-kind slot per placement, carrying its course — so the engines resolve
 * every card's course from `slot.courses`, and `picks` is always empty.
 *
 * Returns the enriched slots + placed-course map plus the `picks` /
 * `completedIds` the consumers key their memos on (and pass positionally to
 * the engines). Reference-stable when the plan and cache are unchanged
 * (enrichSlots/enrichSelectedCourses return the SAME array/object when nothing
 * changed), so memoized consumers stay stable.
 */
export type EnrichedPlan = {
  enrichedSlots: ProgramSlotWithData[];
  /** courseId → enriched placed course. */
  enrichedCourses: Record<string, Course>;
  /** Engine "slot picks" — always empty in the placement model (stable ref). */
  picks: Record<string, string>;
  /** Completed placement ids. */
  completedIds: string[];
};

/** The engines' picks argument in the placement model: none (stable ref). */
export const NO_PICKS: Record<string, string> = Object.freeze({}) as Record<string, string>;

export function useEnrichedPlan(slots: ProgramSlotWithData[]): EnrichedPlan {
  const { completedIds, placedCourses } = usePlan();
  const { courseDetails, ensureCourseDetails } = useCatalogContext();

  // Fetch full docs for every course placed on the board (≤ 80 ids, never a
  // catalog scan).
  const planCourseIds = useMemo(() => collectPlanCourseIds(slots, NO_PICKS), [slots]);
  useEffect(() => {
    ensureCourseDetails(planCourseIds);
  }, [planCourseIds, ensureCourseDetails]);

  // Overlay real prereq/coreq/offered onto the display snapshots (same reference
  // when nothing is cached yet, so downstream memos stay stable).
  const enrichedSlots = useMemo(
    () => enrichSlots(slots, courseDetails),
    [slots, courseDetails]
  );
  const enrichedCourses = useMemo(
    () => enrichSelectedCourses(placedCourses, courseDetails),
    [placedCourses, courseDetails]
  );

  return { enrichedSlots, enrichedCourses, picks: NO_PICKS, completedIds };
}
