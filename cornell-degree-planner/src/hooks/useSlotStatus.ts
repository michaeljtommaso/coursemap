import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { computeSlotStatusMap, type SlotStatusResult } from "@/lib/planner/computeSlotStatusMap";
import { computePendingChoiceMap, openChoices } from "@/lib/planner/pendingChoiceMap";
import type { PendingChoice } from "@/lib/planner/pendingChoices";
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
 * the status engine and the derived graph read the SAME enriched courses.
 *
 * The "pick one" layer: `pendingChoices` names, for each HARD-blocked card
 * that an open choice requirement would unblock, the choice it waits on
 * (lib/planner/pendingChoiceMap). Derived HERE, once, so the card and the
 * detail panel read the same answer; the engine's `blocked` is unchanged.
 *
 * Index statusMap / pendingChoices by slot id — in the placement model (spec
 * 014) that is the PLACEMENT id (`slots` = useBoard's engineSlots); read
 * column credit totals via `semesterCredits.get(sem)`.
 */
export type SlotStatusView = SlotStatusResult & {
  /** slot id → the open choice that blocked card is waiting on. */
  pendingChoices: Record<string, PendingChoice>;
};

export function useSlotStatus(slots: ProgramSlotWithData[]): SlotStatusView {
  const { enrichedSlots, enrichedCourses, picks, completedIds } = useEnrichedPlan(slots);
  const { creditProfile } = useAuth();
  const { aliases } = useCatalogContext();
  const progress = useRequirementProgress();

  // Credit profile (spec 007 §2) folded into the evaluation pool as synthetic
  // completed courses — recomputed only when the profile's entries change.
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);

  // Cross-listing canonicalizer from the catalog's alias map (ENGRD-2110 →
  // CS-2110), so a cross-listed twin satisfies a prereq leaf.
  const canonical = useMemo(() => (id: string) => aliases[id] ?? id, [aliases]);

  const result = useMemo(
    () =>
      computeSlotStatusMap(
        enrichedSlots,
        completedIds,
        picks,
        enrichedCourses,
        creditCourses,
        canonical
      ),
    [enrichedSlots, completedIds, picks, enrichedCourses, creditCourses, canonical]
  );

  const choices = useMemo(() => openChoices(progress), [progress]);
  const pendingChoices = useMemo(
    () =>
      computePendingChoiceMap(
        enrichedSlots,
        completedIds,
        picks,
        enrichedCourses,
        result.statusMap,
        choices,
        creditCourses,
        canonical
      ),
    [enrichedSlots, completedIds, picks, enrichedCourses, result.statusMap, choices, creditCourses, canonical]
  );

  return useMemo(() => ({ ...result, pendingChoices }), [result, pendingChoices]);
}
