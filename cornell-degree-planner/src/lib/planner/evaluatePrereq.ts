import type { PrereqExpr, Course, ProgramSlotWithData } from "@/types/db";
import { computeSlotStatusMap } from "./computeSlotStatusMap";
import { evaluate, patternToRegex } from "./satisfies";

// patternToRegex now lives in satisfies.ts (the single satisfaction module);
// re-exported here so existing `@/lib/planner/evaluatePrereq` imports keep working.
export { patternToRegex };

export type PrereqEvalOpts = {
  /** Courses available for {type:"concurrent"} nodes — completed PLUS anything
   *  planned in the same or an earlier semester (spec 005 §3). When omitted
   *  (e.g. catalog chips, which have no target semester), concurrent
   *  requirements stay satisfiable-by-definition. */
  concurrentIds?: Set<string>;
};

/**
 * Thin boolean wrapper over the single satisfaction engine (satisfies.evaluate).
 * "Hard-satisfied" (advisory nodes treated as always-true) is exactly
 * `state !== "blocked"`, so met/advisory → true and blocked → false — bit-for-bit
 * the old evaluator's semantics. There is no second tree-walk anywhere now.
 */
export function evaluatePrereq(
  expr: PrereqExpr | null | undefined,
  completedIds: Set<string>,
  completedCodes: Set<string>,
  opts?: PrereqEvalOpts
): boolean {
  return (
    evaluate(expr, {
      completedIds,
      completedCodes,
      concurrentIds: opts?.concurrentIds,
    }).state !== "blocked"
  );
}

// For each slot on the canvas, determine whether the placed course's prereqs
// are satisfied by courses in earlier semesters (planned or completed).
// Returns null when no course is placed or the course has no prereqs.
//
// This is now a thin, back-compat projection of the unified engine
// (computeSlotStatusMap) down to its prereq field — so the two existing call
// sites (RoadmapCanvas → SemesterColumn → SlotCard) keep the exact
// `Record<slotId, boolean | null>` shape they already consume while phase 2
// migrates them onto the full status map. Prereq semantics are unchanged.
export function computePrereqStatusMap(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): Record<string, boolean | null> {
  const { statusMap } = computeSlotStatusMap(
    slots,
    completedSlotIds,
    slotSelections,
    selectedCourses
  );
  const result: Record<string, boolean | null> = {};
  for (const slotId of Object.keys(statusMap)) {
    result[slotId] = statusMap[slotId].prereq;
  }
  return result;
}

export function buildCompletedSets(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): { completedIds: Set<string>; completedCodes: Set<string> } {
  const completedIds = new Set<string>();
  const completedCodes = new Set<string>();
  const completedSet = new Set(completedSlotIds);

  for (const slot of slots) {
    if (!completedSet.has(slot.id)) continue;

    const userCourseId = slotSelections[slot.id];
    if (userCourseId) {
      completedIds.add(userCourseId);
      const course = selectedCourses[userCourseId];
      if (course) completedCodes.add(`${course.subject} ${course.number}`);
      continue;
    }

    if (slot.kind === "course" && slot.courses) {
      completedIds.add(slot.courses.id);
      completedCodes.add(`${slot.courses.subject} ${slot.courses.number}`);
    }
  }

  return { completedIds, completedCodes };
}
