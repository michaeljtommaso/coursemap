import { useMemo } from "react";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { buildPlacements } from "@/lib/planner/buildPlacements";
import { deriveEdges, type DerivedEdge, type PlacedCourse } from "@/lib/planner/deriveEdges";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * useDerivedEdges (spec 008 §2b/§2c; spec 014 placement model) — the canvas's
 * edge source. Walks the board's placed courses (enriched with their real
 * prereq/coreq trees) and emits the REAL edges between them (deriveEdges),
 * keyed by PLACEMENT id, so a course placed twice gets distinct wires and a
 * moved card keeps its wire for free.
 *
 * `slots` are useBoard's engineSlots (one per placement, id = placement id).
 *
 * Returns the derived edges AND the placed courses they were built from — the
 * hover-unlocks layer (UnlocksGhosts) needs the same list to resolve the
 * hovered card's course/semester and the board-wide placed-id set, so we
 * surface it here rather than rebuilding.
 *
 * Memo stability: same board → same `placements` array identity (enriched
 * slots are reference-stable) → same `edges` identity, so EdgeLayer's
 * measure/chain memos don't churn on unrelated renders.
 */
export type DerivedEdgesResult = {
  edges: DerivedEdge[];
  placements: PlacedCourse[];
};

export function useDerivedEdges(slots: ProgramSlotWithData[]): DerivedEdgesResult {
  const { enrichedSlots } = useEnrichedPlan(slots);

  const placements = useMemo(() => buildPlacements(enrichedSlots), [enrichedSlots]);

  const edges = useMemo(() => deriveEdges(placements), [placements]);

  return useMemo(() => ({ edges, placements }), [edges, placements]);
}
