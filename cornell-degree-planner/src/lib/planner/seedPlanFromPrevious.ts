/**
 * seedPlanFromPrevious.ts (spec 009 §4 / C4, cross-plan; re-shaped for the
 * spec 014 placement model) — "switching majors never deletes placements",
 * in the per-program-plan architecture: each program resolves to its OWN plan
 * document, so a real major switch swaps docs. When the target program's plan
 * is MISSING or EMPTY, its initial state is SEEDED from the previous program's
 * loaded plan. The OLD plan document is never modified; switching back finds
 * it untouched.
 *
 * With slots gone (spec 014 §D1) there is nothing to re-map INTO: the board
 * holds courses, so every placement simply travels — same column, same
 * position, same completed / in-progress mark. Requirement attribution is
 * position-independent (majorMatch), so the carried courses are labelled
 * against the new program automatically. On top of the carried courses, the
 * new program's own starting board (its fixed single-course requirements,
 * §D6) is laid down for any course not already carried, appended to the
 * bottom of its suggested column.
 *
 * Deliberately NOT carried: requirement waivers. They are keyed by the OLD
 * program's requirement ids, which mean nothing in the new program.
 *
 * Pure and deterministic: no React, no Firestore — PlanProvider applies the
 * result and persists it through the normal debounced save (to the NEW doc
 * only).
 */

import type { Placement } from "@/types/plan";
import { insertPlacement, sanitizePlacements } from "./placementOps";
import {
  remapPlacements,
  type RemapCourse,
  type RemapMark,
  type RemapPlacement,
  type RemapTargetSlot,
} from "./remapPlacements";

/** The old plan's state as the seeder needs it (a subset of the plan state). */
export type PrevPlanSnapshot = {
  placements: Placement[];
  /** courseId → course data (full Course objects qualify structurally). */
  placedCourses: Record<string, RemapCourse>;
  completedIds: string[];
  inProgressIds: string[];
};

export type PlanSeedResult = {
  placements: Placement[];
  completedIds: string[];
  inProgressIds: string[];
  /** Course ids the seeded placements reference (for snapshot carry-over). */
  courseIds: string[];
  /** Summary counts for the toast: kept = every carried placement, matched =
   *  carried placements that fill one of the new program's requirements. */
  kept: number;
  matched: number;
};

/** Which carried placements fill a requirement of the new program — counted
 *  with the C4 re-mapper's matching tiers (exact course, pattern, attribute,
 *  computable elective rule), each requirement filled at most once. */
function countMatched(
  carried: Placement[],
  prev: PrevPlanSnapshot,
  newTargetSlots: RemapTargetSlot[]
): number {
  const completed = new Set(prev.completedIds);
  const inProgress = new Set(prev.inProgressIds);
  const asRemap: RemapPlacement[] = carried.map((p) => {
    const mark: RemapMark | null = completed.has(p.id)
      ? "completed"
      : inProgress.has(p.id)
        ? "in-progress"
        : null;
    return { slotId: p.id, course: prev.placedCourses[p.courseId], semester: p.sem, mark };
  });
  return remapPlacements(asRemap, newTargetSlots).matchedCount;
}

/**
 * Build the new plan's initial state from the previous plan. Returns null when
 * the previous plan had nothing to carry (no placements with course data) —
 * then the new plan just gets its own starting board and no toast is warranted.
 *
 * @param startingBoard the NEW program's starting placements (§D6), already
 *   built by the caller (placementOps.startingPlacements) so ids stay injectable.
 */
export function seedPlanFromPrevious(
  prev: PrevPlanSnapshot,
  newTargetSlots: RemapTargetSlot[],
  startingBoard: Placement[] = []
): PlanSeedResult | null {
  // Every placement whose course data exists travels as-is (never invent a
  // course for one whose data is gone). Normalized: dense orders, clamped sems.
  const carried = sanitizePlacements(
    prev.placements.filter((p) => prev.placedCourses[p.courseId] != null)
  );
  if (carried.length === 0) return null;

  const carriedIds = new Set(carried.map((p) => p.id));
  const carriedCourseIds = new Set(carried.map((p) => p.courseId));

  // The new program's fixed courses, minus any the student already carries,
  // appended under the carried cards of their column (insertPlacement enforces
  // the plan cap and refuses id collisions).
  let placements = carried;
  for (const s of startingBoard) {
    if (carriedCourseIds.has(s.courseId)) continue;
    placements = insertPlacement(placements, { id: s.id, courseId: s.courseId }, s.sem);
  }

  const completedIds = prev.completedIds.filter((id) => carriedIds.has(id));
  const completedSet = new Set(completedIds);
  const inProgressIds = prev.inProgressIds.filter(
    (id) => carriedIds.has(id) && !completedSet.has(id)
  );

  return {
    placements,
    completedIds: [...new Set(completedIds)],
    inProgressIds: [...new Set(inProgressIds)],
    courseIds: [...new Set(placements.map((p) => p.courseId))],
    kept: carried.length,
    matched: countMatched(carried, prev, newTargetSlots),
  };
}

/** Is a loaded plan doc EMPTY of student content? (Missing docs surface as an
 *  empty created doc, and older-schemaVersion docs normalize to empty, so this
 *  one predicate covers "missing", "fresh" and "legacy".) Only content counts —
 *  name/programId say nothing about prior work. */
export function planContentIsEmpty(plan: {
  placements: unknown[];
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
}): boolean {
  return (
    plan.placements.length === 0 &&
    plan.completedIds.length === 0 &&
    plan.inProgressIds.length === 0 &&
    plan.waivedRequirementIds.length === 0
  );
}
