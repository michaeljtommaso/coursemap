import type { BoardCard } from "./board";
import type { PlacedCourse } from "./deriveEdges";

/**
 * buildPlacements (spec 008 §2b/§2c; spec 014 placement model) — the pure
 * bridge from the board's cards to deriveEdges' PlacedCourse[]. Kept separate
 * from the hook (useDerivedEdges) so it is table-testable without provider
 * scaffolding.
 *
 * `cards` MUST be the SAME cards RoadmapCanvas renders — useBoard's cards,
 * ENRICHED (useEnrichedPlan → enrichCards overlays the real prereq/coreq trees
 * onto each card's course). A PlacedCourse is a straight projection of a card
 * (placement id, course, the column it sits in), so derived edges can never
 * disagree with what's on screen.
 */
export function buildPlacements(cards: BoardCard[]): PlacedCourse[] {
  return cards.map(({ placement, course }) => ({
    placementId: placement.id,
    course,
    semester: placement.sem,
  }));
}
