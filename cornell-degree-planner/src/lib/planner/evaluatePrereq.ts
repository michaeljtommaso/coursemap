import type { PrereqExpr, Course, ProgramSlotWithData } from "@/types/db";

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
export function computePrereqStatusMap(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): Record<string, boolean | null> {
  // Resolve which course object is currently in each slot
  const slotCourse = new Map<string, Course | null>();
  for (const slot of slots) {
    const userCourseId = slotSelections[slot.id];
    if (userCourseId) {
      slotCourse.set(slot.id, selectedCourses[userCourseId] ?? null);
    } else if (slot.kind === "course" && slot.courses) {
      slotCourse.set(slot.id, slot.courses);
    } else {
      slotCourse.set(slot.id, null);
    }
  }

  // Build per-semester course sets from planned slots
  const semCourses = new Map<number, { ids: Set<string>; codes: Set<string> }>();
  for (const slot of slots) {
    const course = slotCourse.get(slot.id);
    if (!course) continue;
    let entry = semCourses.get(slot.suggested_semester);
    if (!entry) {
      entry = { ids: new Set(), codes: new Set() };
      semCourses.set(slot.suggested_semester, entry);
    }
    entry.ids.add(course.id);
    entry.codes.add(`${course.subject} ${course.number}`);
  }

  // Completed slots count as "already done" regardless of semester
  const completedSet = new Set(completedSlotIds);
  const priorIds = new Set<string>();
  const priorCodes = new Set<string>();
  for (const slot of slots) {
    if (!completedSet.has(slot.id)) continue;
    const course = slotCourse.get(slot.id);
    if (course) {
      priorIds.add(course.id);
      priorCodes.add(`${course.subject} ${course.number}`);
    }
  }

  const sortedSems = [...semCourses.keys()].sort((a, b) => a - b);

  const result: Record<string, boolean | null> = {};
  for (const slot of slots) {
    const course = slotCourse.get(slot.id);
    if (!course || !course.prereq_expr) {
      result[slot.id] = null;
      continue;
    }

    // Accumulate all courses from semesters strictly before this one
    const availIds = new Set(priorIds);
    const availCodes = new Set(priorCodes);
    for (const sem of sortedSems) {
      if (sem >= slot.suggested_semester) break;
      const entry = semCourses.get(sem)!;
      for (const id of entry.ids) availIds.add(id);
      for (const code of entry.codes) availCodes.add(code);
    }

    // Concurrent pool: everything available PLUS this same semester's courses
    // (a "may be taken concurrently" prereq is met by scheduling them together).
    const concurrentIds = new Set(availIds);
    const sameSem = semCourses.get(slot.suggested_semester);
    if (sameSem) for (const id of sameSem.ids) concurrentIds.add(id);

    result[slot.id] = evaluatePrereq(course.prereq_expr, availIds, availCodes, {
      concurrentIds,
    });
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
