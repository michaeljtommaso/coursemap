import { useMemo } from "react";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { buildPlacements } from "@/lib/planner/buildPlacements";
import { deriveEdges, type DerivedEdge, type Placement } from "@/lib/planner/deriveEdges";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * useDerivedEdges (spec 008 §2b/§2c, Unit 8B) — the canvas's edge source now
 * that authored edges.json is dead. Walks the enriched plan's placed courses
 * and emits the REAL prereq/coreq edges between them (deriveEdges), keyed by
 * slot so a course placed twice gets distinct wires and a moved course keeps
 * its wire for free.
 *
 * Returns the derived edges AND the placements they were built from — the
 * hover-unlocks layer (UnlocksGhosts) needs the same placements to resolve the
 * hovered slot's course/semester and the plan-wide placed-id set, so we surface
 * them here rather than rebuilding.
 *
 * Memo stability: same plan → same `placements` array identity (enriched inputs
 * are reference-stable) → same `edges` identity, so EdgeLayer's measure/chain
 * memos don't churn on unrelated renders.
 */
export type DerivedEdgesResult = {
  edges: DerivedEdge[];
  placements: Placement[];
};

export function useDerivedEdges(slots: ProgramSlotWithData[]): DerivedEdgesResult {
  const { enrichedSlots, enrichedCourses, picks } = useEnrichedPlan(slots);

  const placements = useMemo(
    () => buildPlacements(enrichedSlots, picks, enrichedCourses),
    [enrichedSlots, picks, enrichedCourses]
  );

  const edges = useMemo(() => deriveEdges(placements), [placements]);

  return useMemo(() => ({ edges, placements }), [edges, placements]);
}
