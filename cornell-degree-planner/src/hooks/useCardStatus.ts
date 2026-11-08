import { useMemo } from "react";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { computeCardStatusMap, type CardStatusResult } from "@/lib/planner/computeCardStatusMap";
import { computePendingChoiceMap, openChoices } from "@/lib/planner/pendingChoiceMap";
import type { PendingChoice } from "@/lib/planner/pendingChoices";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import type { BoardCard } from "@/lib/planner/board";
import { usePlan } from "@/hooks/usePlan";
import { withChosenCredits } from "@/lib/planner/chosenCredits";

/**
 * useCardStatus (spec 006 §B.2) — the single hook every canvas/legend surface
 * reads card state from. Returns the full unified status: prereq, coreq,
 * offeredOk, blocked, unmet leaves, and per-semester credit totals.
 *
 * Data feed (the fix for the "template slots never block" bug): the enrichment
 * supply line — fetch the ≤~60 plan course docs and overlay their real
 * prereq/coreq/offered onto the display snapshots — now lives in the shared
 * useEnrichedPlan hook (spec 008 §2c), consumed here and by useDerivedEdges so
 * the status engine and the derived graph read the SAME enriched courses.
 *
 * The "pick one" layer: `pendingChoices` names, for each HARD-blocked card
 * that an open choice requirement would unblock, the choice it waits on
 * (lib/planner/pendingChoiceMap). Derived HERE, once, so the card and the
 * detail panel read the same answer; the engine's `blocked` is unchanged.
 *
 * Index statusMap / pendingChoices by PLACEMENT id (`cards` = useBoard's
 * cards); read column credit totals via `semesterCredits.get(sem)`.
 */
export type CardStatusView = CardStatusResult & {
  /** placement id → the open choice that blocked card is waiting on. */
  pendingChoices: Record<string, PendingChoice>;
};

export function useCardStatus(cards: BoardCard[]): CardStatusView {
  const { enrichedCards, enrichedCourses, completedIds } = useEnrichedPlan(cards);
  // Spec 028: credit resolved for the student's college.
  const { resolved: creditProfile } = useCreditProfile();
  const { aliases } = useCatalogContext();
  const progress = useRequirementProgress();

  // Credit profile (spec 007 §2) folded into the evaluation pool as synthetic
  // completed courses — recomputed only when the profile's entries change.
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);

  // Cross-listing canonicalizer from the catalog's alias map (ENGRD-2110 →
  // CS-2110), so a cross-listed twin satisfies a prereq leaf.
  const canonical = useMemo(() => (id: string) => aliases[id] ?? id, [aliases]);

  // Credits chosen on variable-credit cards count in the semester totals
  // (the heavy-semester check), as they do in the column header.
  const { courseMarks } = usePlan();
  const creditedCards = useMemo(
    () =>
      enrichedCards.map((c) => {
        const course = withChosenCredits(c.course, courseMarks, c.placement.courseId);
        return course === c.course ? c : { ...c, course };
      }),
    [enrichedCards, courseMarks]
  );

  const result = useMemo(
    () =>
      computeCardStatusMap(
        creditedCards,
        completedIds,
        enrichedCourses,
        creditCourses,
        canonical
      ),
    [creditedCards, completedIds, enrichedCourses, creditCourses, canonical]
  );

  const choices = useMemo(() => openChoices(progress), [progress]);
  const pendingChoices = useMemo(
    () =>
      computePendingChoiceMap(
        enrichedCards,
        completedIds,
        result.statusMap,
        choices,
        creditCourses,
        canonical
      ),
    [enrichedCards, completedIds, result.statusMap, choices, creditCourses, canonical]
  );

  return useMemo(() => ({ ...result, pendingChoices }), [result, pendingChoices]);
}
