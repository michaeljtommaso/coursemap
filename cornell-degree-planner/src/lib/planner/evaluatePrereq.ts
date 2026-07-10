import type { PrereqExpr, Course, ProgramSlotWithData } from "@/types/db";
import { computeSlotStatusMap } from "./computeSlotStatusMap";

// Converts a Cornell course pattern to a regex.
// Patterns use dash separators ("CS-111x") while codes use spaces ("CS 1110").
// Both * and x/X are single-character wildcards (Cornell uses x for digit positions).
export function patternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/-/g, " ");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/[*xX]/g, ".");
  return new RegExp(`^${withWildcards}$`, "i");
}

export type PrereqEvalOpts = {
  /** Courses available for {type:"concurrent"} nodes — completed PLUS anything
   *  planned in the same or an earlier semester (spec 005 §3). When omitted
   *  (e.g. catalog chips, which have no target semester), concurrent
   *  requirements stay satisfiable-by-definition. */
  concurrentIds?: Set<string>;
};

export function evaluatePrereq(
  expr: PrereqExpr | null | undefined,
  completedIds: Set<string>,
  completedCodes: Set<string>,
  opts?: PrereqEvalOpts
): boolean {
  if (!expr) return true;

  switch (expr.type) {
    case "and":
      return expr.children.every((c) => evaluatePrereq(c, completedIds, completedCodes, opts));
    case "or":
      return expr.children.some((c) => evaluatePrereq(c, completedIds, completedCodes, opts));
    case "course":
      return completedIds.has(expr.id);
    case "pattern": {
      const re = patternToRegex(expr.pattern);
      for (const code of completedCodes) {
        if (re.test(code)) return true;
      }
      return false;
    }
    case "concurrent":
      // "May be taken concurrently" — satisfied by having it done OR having it
      // planned no later than the target semester.
      return opts?.concurrentIds
        ? opts.concurrentIds.has(expr.id) || completedIds.has(expr.id)
        : true;
  }
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
