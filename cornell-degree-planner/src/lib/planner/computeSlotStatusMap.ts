import type { Course, ProgramSlotWithData } from "@/types/db";
import { evaluate } from "./satisfies";

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
  /** null = no course placed / no prereqExpr on the course.
   *  met/advisory → true, blocked → false (HARD state only). */
  prereq: boolean | null;
  /** null = no course placed / no coreqExpr on the course. */
  coreq: boolean | null;
  /** null = no course placed / course has no `offered` data. */
  offeredOk: boolean | null;
  /** prereq === false || coreq === false. HARD-only: advisory nodes and overlap
   *  warnings NEVER set this (spec 007 §1b/§6). */
  blocked: boolean;
  /** Human course codes / patterns from the failing prereq+coreq leaves (HARD
   *  misses only). Empty unless the slot is blocked. */
  unmetPrereqLeaves: string[];
  /** The prereq tree's tri-state (spec 007 §1b). null exactly where `prereq` is
   *  null (no course / no prereqExpr). */
  prereqState: "met" | "advisory" | "blocked" | null;
  /** Advisory-node notes from the prereq (and coreq) tree whose inner expr is
   *  unsatisfied — "usually needs MATH 1910; AP credit also counts". Informational,
   *  reported for advisory AND blocked slots; NEVER implies blocked. */
  advisoryNotes: string[];
  /** Display codes of OTHER placed courses this slot forbid-overlaps with (spec
   *  007 §1b/§5). Advisory tone, never blocking. Empty when no conflict. */
  overlaps: string[];
  /** The course's `prereq_notes` prose (grade minimums, permission-of-instructor,
   *  etc.) — No-data-safe, never a hard block (spec 007 §1b/§4). */
  docNotes: string[];
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

/** Synthetic credit courses (spec 007 §2 — AP/IB/transfer) folded into every
 *  evaluate() ctx as "completed from semester 0". Default empty; a later unit
 *  wires the real credit profile in. */
export type CreditCourses = { ids: Set<string>; codes: Set<string> };
const NO_CREDIT: CreditCourses = { ids: new Set(), codes: new Set() };

/** Everything derivable from the plan before looking at a specific semester:
 *  the course in each slot, per-semester course pools + credit totals, and the
 *  "completed regardless of column" prior pool. Shared by the per-slot loop in
 *  computeSlotStatusMap and the detail panel's semesterPrereqPools. */
type PlanPools = {
  slotCourse: Map<string, Course | null>;
  courseById: Map<string, Course>; // id → course, for leaf → code
  semCourses: Map<number, { ids: Set<string>; codes: Set<string> }>;
  semesterCredits: Map<number, number>;
  priorIds: Set<string>;
  priorCodes: Set<string>;
  sortedSems: number[];
};

function buildPlanPools(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>
): PlanPools {
  // ── Resolve the course object currently in each slot (user pick wins, else
  //    the template's fixed course, else empty). ─────────────────────────────
  const slotCourse = new Map<string, Course | null>();
  const courseById = new Map<string, Course>();
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

  return { slotCourse, courseById, semCourses, semesterCredits, priorIds, priorCodes, sortedSems };
}

/** The two pools a course placed in `sem` is evaluated against: strictly-earlier
 *  (prereq semantics) and same-or-earlier (concurrent/coreq semantics). */
function poolsAt(plan: PlanPools, sem: number) {
  const earlierIds = new Set(plan.priorIds);
  const earlierCodes = new Set(plan.priorCodes);
  for (const s of plan.sortedSems) {
    if (s >= sem) break;
    const entry = plan.semCourses.get(s)!;
    for (const id of entry.ids) earlierIds.add(id);
    for (const code of entry.codes) earlierCodes.add(code);
  }
  const sameSem = plan.semCourses.get(sem);
  const concurrentIds = new Set(earlierIds);
  const concurrentCodes = new Set(earlierCodes);
  if (sameSem) {
    for (const id of sameSem.ids) concurrentIds.add(id);
    for (const code of sameSem.codes) concurrentCodes.add(code);
  }
  return { earlierIds, earlierCodes, concurrentIds, concurrentCodes };
}

/** Union `extra` into `base` without mutating either — same policy as
 *  satisfies.ts's private `withPool`, duplicated here (tiny, no shared export)
 *  so semesterPrereqPools can fold the credit pool in with zero allocation on
 *  the common (no-credit) path. */
function unionSet(base: Set<string>, extra: Set<string>): Set<string> {
  if (extra.size === 0) return base;
  const out = new Set(base);
  for (const v of extra) out.add(v);
  return out;
}

/** The pools for a course placed in semester `sem`, with EXACTLY the engine's
 *  semantics: completed = completed slots + strictly-earlier semesters;
 *  concurrent = same-or-earlier. The detail panel feeds these to the prereq
 *  tree so a leaf there never disagrees with the card's blocked state.
 *
 *  `creditCourses` (spec 007 §2/§3 — Unit 7C2) is optional and unioned into
 *  BOTH the completed and concurrent pools, mirroring computeSlotStatusMap's
 *  own evaluate() calls (which fold creditIds/creditCodes into every pool a
 *  leaf can see). Passing it keeps the detail panel's tree/notes agreeing
 *  with the card's engine-computed status — the C1 bug class this spec fixes. */
export function semesterPrereqPools(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>,
  sem: number,
  creditCourses: CreditCourses = NO_CREDIT
): {
  completedIds: Set<string>;
  completedCodes: Set<string>;
  concurrentIds: Set<string>;
  concurrentCodes: Set<string>;
} {
  const plan = buildPlanPools(slots, completedSlotIds, slotSelections, selectedCourses);
  const p = poolsAt(plan, sem);
  return {
    completedIds: unionSet(p.earlierIds, creditCourses.ids),
    completedCodes: unionSet(p.earlierCodes, creditCourses.codes),
    concurrentIds: unionSet(p.concurrentIds, creditCourses.ids),
    concurrentCodes: unionSet(p.concurrentCodes, creditCourses.codes),
  };
}

export function computeSlotStatusMap(
  slots: ProgramSlotWithData[],
  completedSlotIds: string[],
  slotSelections: Record<string, string>,
  selectedCourses: Record<string, Course>,
  creditCourses: CreditCourses = NO_CREDIT
): SlotStatusResult {
  const plan = buildPlanPools(slots, completedSlotIds, slotSelections, selectedCourses);
  const { slotCourse, courseById, semesterCredits } = plan;
  const { ids: creditIds, codes: creditCodes } = creditCourses;

  const resolveLeaf = (leaf: string): string => {
    const c = courseById.get(leaf);
    // Unresolvable leaf (course not placed anywhere on the plan): fall back to
    // display form rather than the raw dash id — "Needs MATH 1110", never
    // "Needs MATH-1110". Course ids are strictly SUBJ-NNNN, so the global
    // dash→space replace is safe; pattern leaves already arrive in code form
    // ("CS 3xxx", no dashes) and pass through unchanged.
    return c ? courseCode(c) : leaf.replace(/-/g, " ");
  };

  // ── Plan-wide forbidden-overlap warnings (spec 007 §1b/§5) ──
  // Two PLACED courses a,b conflict iff b ∈ a.forbidden_overlaps OR a ∈
  // b.forbidden_overlaps — check BOTH directions because roster coverage is
  // asymmetric. Each conflicted slot lists the OTHER course's display code(s).
  // Direct id matching, no alias canonicalization in v1: overlap lists carry
  // roster-code ids that already match course-doc ids.
  const placed: { slotId: string; course: Course }[] = [];
  for (const slot of slots) {
    const c = slotCourse.get(slot.id);
    if (c) placed.push({ slotId: slot.id, course: c });
  }
  const overlapsBySlot = new Map<string, string[]>();
  for (const a of placed) {
    const codes = new Set<string>();
    for (const b of placed) {
      if (a.slotId === b.slotId) continue; // self never flagged
      const conflict =
        a.course.forbidden_overlaps.includes(b.course.id) ||
        b.course.forbidden_overlaps.includes(a.course.id);
      if (conflict) codes.add(courseCode(b.course));
    }
    if (codes.size > 0) overlapsBySlot.set(a.slotId, [...codes]);
  }

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
        prereqState: null,
        advisoryNotes: [],
        overlaps: [],
        docNotes: [],
      };
      continue;
    }

    const sem = slot.suggested_semester;

    // Strictly-earlier pool (for prereqs) + same-or-earlier pool (concurrent
    // additions for prereqs, base pool for coreqs) — shared with the panel via
    // poolsAt/semesterPrereqPools.
    const { earlierIds, earlierCodes, concurrentIds, concurrentCodes } = poolsAt(plan, sem);

    // ── prereq: strictly-earlier completed pool + same-sem concurrent pool,
    //    plus synthetic credit (completed from semester 0). ──
    const prereqResult = course.prereq_expr
      ? evaluate(course.prereq_expr, {
          completedIds: earlierIds,
          completedCodes: earlierCodes,
          concurrentIds,
          creditIds,
          creditCodes,
        })
      : null;
    const prereqState = prereqResult ? prereqResult.state : null;
    // met/advisory → true, blocked → false (HARD state only).
    const prereq: boolean | null = prereqResult ? prereqResult.state !== "blocked" : null;

    // ── coreq: same-OR-earlier pool. A coreq in the same column satisfies. ──
    const coreqIds = concurrentIds;
    const coreqCodes = concurrentCodes;
    const coreqResult = course.coreq_expr
      ? evaluate(course.coreq_expr, {
          completedIds: coreqIds,
          completedCodes: coreqCodes,
          concurrentIds: coreqIds,
          creditIds,
          creditCodes,
        })
      : null;
    const coreq: boolean | null = coreqResult ? coreqResult.state !== "blocked" : null;

    // ── offeredOk: null when no `offered` data, else term membership. ──
    const offeredOk: boolean | null =
      course.offered.length === 0 ? null : course.offered.includes(termForSemester(sem));

    const blocked = prereq === false || coreq === false;

    // ── Unmet leaves: HARD misses only. evaluate.missing is [] unless the tree
    //    is blocked, so concatenating is equivalent to the old blocked-gated
    //    collection. ──
    const unmet = [
      ...(prereqResult?.missing ?? []),
      ...(coreqResult?.missing ?? []),
    ];
    const unmetPrereqLeaves = [...new Set(unmet.map(resolveLeaf))];

    // Advisory notes from both trees (reported for advisory AND blocked slots).
    const advisoryNotes = [
      ...new Set([
        ...(prereqResult?.advisoryNotes ?? []),
        ...(coreqResult?.advisoryNotes ?? []),
      ]),
    ];

    statusMap[slot.id] = {
      prereq,
      coreq,
      offeredOk,
      blocked,
      unmetPrereqLeaves,
      prereqState,
      advisoryNotes,
      overlaps: overlapsBySlot.get(slot.id) ?? [],
      docNotes: course.prereq_notes,
    };
  }

  return { statusMap, semesterCredits };
}
