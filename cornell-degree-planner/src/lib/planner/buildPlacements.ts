import type { Course, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "./deriveEdges";

/**
 * buildPlacements (spec 008 §2b/§2c, Unit 8B) — the pure bridge from the
 * canvas's EFFECTIVE slots to deriveEdges' Placement[]. Kept separate from the
 * hook (useDerivedEdges) so the override/custom-slot/effective-semester rules
 * are table-testable without provider scaffolding.
 *
 * `slots` MUST be the SAME effective-slots array RoadmapCanvas renders from
 * (useEffectiveSlots' output): overrides already remapped onto
 * `suggested_semester`, removed template slots dropped, custom slots appended.
 * That is why a Placement's `semester` is simply `slot.suggested_semester` —
 * the effective semester the card actually sits in — so derived edges can never
 * disagree with what's on screen.
 *
 * A slot contributes a Placement when it holds a course:
 *   - a user selection (slotSelections[slot.id] → selectedCourses[id]) wins, or
 *   - a course-kind template slot's own course snapshot.
 * Both are the ENRICHED forms (real prereq/coreq trees overlaid — see
 * enrichCourses.ts), supplied by the caller. Empty pattern/elective/attribute
 * slots contribute nothing (no course → no wire, C2's structural fix).
 */
export function buildPlacements(
  slots: ProgramSlotWithData[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): Placement[] {
  const out: Placement[] = [];
  for (const slot of slots) {
    const selectedId = slotSelections[slot.id];
    const course = selectedId
      ? (selectedCourses[selectedId] ?? null)
      : slot.kind === "course"
        ? slot.courses
        : null;
    if (!course) continue;
    out.push({ slotId: slot.id, course, semester: slot.suggested_semester });
  }
  return out;
}
