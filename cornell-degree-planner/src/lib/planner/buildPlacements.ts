import type { ProgramSlotWithData } from "@/types/db";
import type { PlacedCourse } from "./deriveEdges";

/**
 * buildPlacements (spec 008 §2b/§2c; spec 014 placement model) — the pure
 * bridge from the board's engine slots to deriveEdges' PlacedCourse[]. Kept
 * separate from the hook (useDerivedEdges) so it is table-testable without
 * provider scaffolding.
 *
 * `slots` MUST be the SAME array RoadmapCanvas renders from — useBoard's
 * engineSlots, ENRICHED (useEnrichedPlan → enrichSlots overlays the real
 * prereq/coreq trees onto each slot's course). In the placement model every
 * engine slot is one placement: `id` = the placement id, `courses` = the placed
 * course, `suggested_semester` = the column the card sits in. So a
 * PlacedCourse is a straight projection, and derived edges can never disagree
 * with what's on screen.
 *
 * A slot without a course (never produced by useBoard; defensive for malformed
 * input) contributes nothing — no course, no wire.
 */
export function buildPlacements(slots: ProgramSlotWithData[]): PlacedCourse[] {
  const out: PlacedCourse[] = [];
  for (const slot of slots) {
    if (!slot.courses) continue;
    out.push({ placementId: slot.id, course: slot.courses, semester: slot.suggested_semester });
  }
  return out;
}
