import type { PrereqExpr, Course, ProgramSlotWithData } from "@/types/db";
import { evaluatePrereq, patternToRegex, type PrereqEvalOpts } from "./evaluatePrereq";

/**
 * computeSlotStatusMap (spec 006 §B.2) — the ONE unified engine that every
 * canvas/catalog/legend surface reads its state from. It supersedes the
 * prereq-only `computePrereqStatusMap` (which is now a thin wrapper over this)
 * by evaluating, per placed slot:
 *
 *   - prereq    — the course's prereqExpr against a STRICTLY-EARLIER-semester
 *                 completed/planned pool (unchanged from the old evaluator).
 *   - coreq     — the course's coreqExpr against a SAME-OR-EARLIER-semester
 *                 pool (concurrent semantics: a coreq dropped in the same
 *                 column satisfies it). Wired here for the first time.
 *   - offeredOk — whether the placed column's term (odd sem = Fall/"FA",
 *                 even sem = Spring/"SP") is in the course's `offered` tokens.
 *   - blocked   — prereq === false || coreq === false.
 *   - unmetPrereqLeaves — the human course codes / patterns that failed,
 *                 aggregated from whichever tree(s) blocked the slot, so the
 *                 UI can render "Needs CS 2110 first".
 *
 * Plus `semesterCredits: Map<sem, number>` — the per-column credit total used
 * for the overload warning.
 */

/** Semester-overload cap. One place, tunable (spec 006 §B.1). */
export const MAX_SEMESTER_CREDITS = 20;

/** Whether a column's credit total exceeds the cap. Lives next to the constant
 *  so the comparison has one owner. */
export function isSemesterOverloaded(credits: number): boolean {
  return credits > MAX_SEMESTER_CREDITS;
}

export type SlotStatus = {
  /** null = no course placed / no prereqExpr on the course. */
  prereq: boolean | null;
  /** null = no course placed / no coreqExpr on the course. */
  coreq: boolean | null;
  /** null = no course placed / course has no `offered` data. */
  offeredOk: boolean | null;
  /** prereq === false || coreq === false. */
  blocked: boolean;
  /** Human course codes / patterns from the failing prereq+coreq leaves.
   *  Empty unless the slot is blocked. */
  unmetPrereqLeaves: string[];
};

export type SlotStatusResult = {
  /** slotId → status. A Record (not a Map) to mirror the string-keyed
   *  prereqStatusMap the UI already indexes as `map[slot.id]`. */
  statusMap: Record<string, SlotStatus>;
  /** semester index → summed credits of placed courses in that column.
   *  A Map (per spec 006 §B.2) — keys are numeric semester indices. */
  semesterCredits: Map<number, number>;
};

/** Odd semesters are Fall ("FA"), even are Spring ("SP") — matches
 *  semesters.ts / semesterLabel. SU/WI never map to a planned column, so a
 *  course offered only in summer/winter reads as a term mismatch. */
function termForSemester(sem: number): "FA" | "SP" {
  return sem % 2 === 1 ? "FA" : "SP";
}

function courseCode(c: Course): string {
  return `${c.subject} ${c.number}`;
}

/** Collect the leaves that caused `expr` to evaluate false, as a blame set:
 *  every satisfied branch contributes nothing; a failed OR contributes all its
 *  alternatives (any one would fix it); a failed AND contributes each failing
 *  child. Course ids stay as ids here — the caller resolves them to codes. */
function collectUnmetLeaves(
  expr: PrereqExpr | null | undefined,
  ids: Set<string>,
  codes: Set<string>,
  opts: PrereqEvalOpts
): string[] {
  if (!expr) return [];
  switch (expr.type) {
    case "and":
      return expr.children.flatMap((c) => collectUnmetLeaves(c, ids, codes, opts));
    case "or":
      // Satisfied OR: nothing missing. Failed OR: surface every alternative.
      if (evaluatePrereq(expr, ids, codes, opts)) return [];
      return expr.children.flatMap((c) => collectUnmetLeaves(c, ids, codes, opts));
    case "course":
      return ids.has(expr.id) ? [] : [expr.id];
    case "pattern": {
      const re = patternToRegex(expr.pattern);
      for (const code of codes) if (re.test(code)) return [];
      // Present the pattern in code form ("CS 111x") rather than dash form.
      return [expr.pattern.replace(/-/g, " ")];
    }
    case "concurrent": {
      const ok = opts.concurrentIds
        ? opts.concurrentIds.has(expr.id) || ids.has(expr.id)
        : true;
      return ok ? [] : [expr.id];
    }
  }
}

export function computeSlotStatusMap(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): SlotStatusResult {
  // ── Resolve the course object currently in each slot (user pick wins, else
  //    the template's fixed course, else empty). ─────────────────────────────
  const slotCourse = new Map<string, Course | null>();
  const courseById = new Map<string, Course>(); // id → course, for leaf → code
  const rememberCourse = (c: Course | null | undefined) => {
    if (c) courseById.set(c.id, c);
  };
  for (const c of Object.values(selectedCourses)) rememberCourse(c);

  for (const slot of slots) {
    const userCourseId = slotSelections[slot.id];
    let course: Course | null = null;
    if (userCourseId) {
      course = selectedCourses[userCourseId] ?? null;
    } else if (slot.kind === "course" && slot.courses) {
      course = slot.courses;
    }
    slotCourse.set(slot.id, course);
    rememberCourse(course);
  }

  // ── Per-semester pools of placed courses + per-semester credit totals. ─────
  const semCourses = new Map<number, { ids: Set<string>; codes: Set<string> }>();
  const semesterCredits = new Map<number, number>();
  for (const slot of slots) {
    const course = slotCourse.get(slot.id);
    if (!course) continue;
    const sem = slot.suggested_semester;

    let entry = semCourses.get(sem);
    if (!entry) {
      entry = { ids: new Set(), codes: new Set() };
      semCourses.set(sem, entry);
    }
    entry.ids.add(course.id);
    entry.codes.add(courseCode(course));

    // Variable-credit courses count at their MINIMUM (credits_min) — the same
    // floor slotCredits()/formatCredits use — so overload warnings never
    // false-positive on an "up to N credits" course.
    semesterCredits.set(sem, (semesterCredits.get(sem) ?? 0) + course.credits_min);
  }

  // ── Completed slots count as done regardless of their column. ──────────────
  const completedSet = new Set(completedSlotIds);
  const priorIds = new Set<string>();
  const priorCodes = new Set<string>();
  for (const slot of slots) {
    if (!completedSet.has(slot.id)) continue;
    const course = slotCourse.get(slot.id);
    if (course) {
      priorIds.add(course.id);
      priorCodes.add(courseCode(course));
    }
  }

  const sortedSems = [...semCourses.keys()].sort((a, b) => a - b);

  const resolveLeaf = (leaf: string): string => {
    const c = courseById.get(leaf);
    return c ? courseCode(c) : leaf;
  };

  const statusMap: Record<string, SlotStatus> = {};

  for (const slot of slots) {
    const course = slotCourse.get(slot.id);
    if (!course) {
      statusMap[slot.id] = {
        prereq: null,
        coreq: null,
        offeredOk: null,
        blocked: false,
        unmetPrereqLeaves: [],
      };
      continue;
    }

    const sem = slot.suggested_semester;

    // Strictly-earlier pool (for prereqs).
    const earlierIds = new Set(priorIds);
    const earlierCodes = new Set(priorCodes);
    for (const s of sortedSems) {
      if (s >= sem) break;
      const entry = semCourses.get(s)!;
      for (const id of entry.ids) earlierIds.add(id);
      for (const code of entry.codes) earlierCodes.add(code);
    }

    // Same-semester additions (concurrent pool for prereqs, base pool for coreqs).
    const sameSem = semCourses.get(sem);
    const concurrentIds = new Set(earlierIds);
    if (sameSem) for (const id of sameSem.ids) concurrentIds.add(id);

    // ── prereq: strictly-earlier completed pool + same-sem concurrent pool. ──
    const prereqOpts: PrereqEvalOpts = { concurrentIds };
    const prereq: boolean | null = course.prereq_expr
      ? evaluatePrereq(course.prereq_expr, earlierIds, earlierCodes, prereqOpts)
      : null;

    // ── coreq: same-OR-earlier pool. A coreq in the same column satisfies. ──
    const coreqIds = new Set(earlierIds);
    const coreqCodes = new Set(earlierCodes);
    if (sameSem) {
      for (const id of sameSem.ids) coreqIds.add(id);
      for (const code of sameSem.codes) coreqCodes.add(code);
    }
    const coreqOpts: PrereqEvalOpts = { concurrentIds: coreqIds };
    const coreq: boolean | null = course.coreq_expr
      ? evaluatePrereq(course.coreq_expr, coreqIds, coreqCodes, coreqOpts)
      : null;

    // ── offeredOk: null when no `offered` data, else term membership. ──
    const offeredOk: boolean | null =
      course.offered.length === 0 ? null : course.offered.includes(termForSemester(sem));

    const blocked = prereq === false || coreq === false;

    // ── Unmet leaves: aggregate from whichever tree(s) actually blocked. ──
    const unmet: string[] = [];
    if (prereq === false && course.prereq_expr) {
      unmet.push(...collectUnmetLeaves(course.prereq_expr, earlierIds, earlierCodes, prereqOpts));
    }
    if (coreq === false && course.coreq_expr) {
      unmet.push(...collectUnmetLeaves(course.coreq_expr, coreqIds, coreqCodes, coreqOpts));
    }
    const unmetPrereqLeaves = [...new Set(unmet.map(resolveLeaf))];

    statusMap[slot.id] = { prereq, coreq, offeredOk, blocked, unmetPrereqLeaves };
  }

  return { statusMap, semesterCredits };
}
