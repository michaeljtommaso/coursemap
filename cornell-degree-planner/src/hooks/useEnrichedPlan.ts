import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import {
  collectPlanCourseIds,
  enrichCards,
  enrichSelectedCourses,
} from "@/lib/planner/enrichCourses";
import type { BoardCard } from "@/lib/planner/board";
import type { Course } from "@/types/db";

/**
 * useEnrichedPlan (spec 008 §2c, Unit 8B) — the shared enrichment supply line,
 * extracted verbatim from useCardStatus so BOTH the status engine and the
 * derived-edge/unlocks graph read the SAME enriched courses from ONE place.
 *
 * The job (unchanged from useCardStatus's original inline version): (1) ask
 * CatalogProvider to fetch the full docs for the ≤~60 ids actually on this plan
 * — batched, deduped, session-cached, never a catalog scan — and (2) overlay
 * those real prereq/coreq/offered trees onto the display-only snapshots
 * (plan course snapshots carry null exprs). Until a doc arrives the course
 * reads as before; it upgrades on the next render.
 *
 * `cards` are useBoard's cards — one per placement, carrying its course.
 *
 * Returns the enriched cards + placed-course map plus the `completedIds` the
 * consumers key their memos on (and pass positionally to the engines).
 * Reference-stable when the plan and cache are unchanged
 * (enrichCards/enrichSelectedCourses return the SAME array/object when nothing
 * changed), so memoized consumers stay stable.
 */
export type EnrichedPlan = {
  enrichedCards: BoardCard[];
  /** courseId → enriched placed course. */
  enrichedCourses: Record<string, Course>;
  /** Completed placement ids. */
  completedIds: string[];
};

export function useEnrichedPlan(cards: BoardCard[]): EnrichedPlan {
  const { completedIds, placedCourses } = usePlan();
  const { courseDetails, ensureCourseDetails } = useCatalogContext();

  // Fetch full docs for every course placed on the board (≤ 80 ids, never a
  // catalog scan).
  const planCourseIds = useMemo(() => collectPlanCourseIds(cards), [cards]);
  useEffect(() => {
    ensureCourseDetails(planCourseIds);
  }, [planCourseIds, ensureCourseDetails]);

  // Overlay real prereq/coreq/offered onto the display snapshots (same reference
  // when nothing is cached yet, so downstream memos stay stable).
  const enrichedCards = useMemo(
    () => enrichCards(cards, courseDetails),
    [cards, courseDetails]
  );
  const enrichedCourses = useMemo(
    () => enrichSelectedCourses(placedCourses, courseDetails),
    [placedCourses, courseDetails]
  );

  return { enrichedCards, enrichedCourses, completedIds };
}
