import type { Course, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "./deriveEdges";

/**
 * buildPlacements (spec 008 §2b/§2c, Unit 8B) — the pure bridge from the
 * canvas's board slots to deriveEdges' Placement[]. Kept separate from the
 * hook (useDerivedEdges) so the semester rules are table-testable without
 * provider scaffolding.
 *
 * `slots` MUST be the SAME array RoadmapCanvas renders from — useBoard's
 * engineSlots in the spec 014 placement model (one course-kind slot per
 * placement, `suggested_semester` = its column). That is why a Placement's
 * `semester` is simply `slot.suggested_semester` — the semester the card
 * actually sits in — so derived edges can never disagree with what's on
 * screen. (The app passes empty picks; the picks path stays for the engine's
 * own table tests until the engine-internal "slot" rename.)
 *
 * A slot contributes a Placement when it holds a course:
 *   - a user selection (slotPicks[slot.id] → pickedCourses[id]) wins, or
 *   - a course-kind template slot's own course snapshot.
 * Both are the ENRICHED forms (real prereq/coreq trees overlaid — see
 * enrichCourses.ts), supplied by the caller. Empty pattern/elective/attribute
 * slots contribute nothing (no course → no wire, C2's structural fix).
 */
export function buildPlacements(
  slots: ProgramSlotWithData[],
  slotPicks: Record<string, string>,
  pickedCourses: Record<string, Course>
): Placement[] {
  const out: Placement[] = [];
  for (const slot of slots) {
    const selectedId = slotPicks[slot.id];
    const course = selectedId
      ? (pickedCourses[selectedId] ?? null)
      : slot.kind === "course"
        ? slot.courses
        : null;
    if (!course) continue;
    out.push({ slotId: slot.id, course, semester: slot.suggested_semester });
  }
  return out;
}
