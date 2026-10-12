import type { Course } from "@/types/db";
import type { BoardCard } from "./board";
import { evaluate } from "./satisfies";

/**
 * computeCardStatusMap (spec 006 §B.2) — the ONE unified engine that every
 * canvas/catalog/legend surface reads its state from. It supersedes the
 * prereq-only `computePrereqStatusMap` (which is now a thin wrapper over this)
 * by evaluating, per board card (one placed course, spec 014):
 *
 *   - prereq    — the course's prereqExpr against a STRICTLY-EARLIER-semester
 *                 completed/planned pool (unchanged from the old evaluator).
 *   - coreq     — the course's coreqExpr against a SAME-OR-EARLIER-semester
 *                 pool (concurrent semantics: a coreq dropped in the same
 *                 column satisfies it). Wired here for the first time.
 *   - offeredOk — whether the placed column's term (odd sem = Fall/"FA",
 *                 even sem = Spring/"SP") is in the course's `offered` tokens.
 *   - blocked   — prereq === false || coreq === false.
 *   - unmetPrereqLeaves / unmetCoreqLeaves — the human course codes /
 *                 patterns that failed, kept per tree so the UI can render
 *                 "Needs CS 2110 first" for a prerequisite and "Take
 *                 CHEM 2091 alongside" for a corequisite.
 *   - coveredByCredit — the credit-profile entry that already grants this
 *                 course (AP Calc BC → MATH 1910); a covered course reads
 *                 neutral-met, never blocked (spec 007 §2c).
 *
 * Plus `semesterCredits: Map<sem, number>` — the per-column credit total used
 * for the overload warning.
 *
 * Input (spec 014 placement model): useBoard's cards, each a placement (id,
 * column, order) plus its course, and the completed PLACEMENT ids. Results are
 * keyed by placement id, so a course placed twice gets a status per card.
 */

/** Semester-overload cap. One place, tunable (spec 006 §B.1). */
export const MAX_SEMESTER_CREDITS = 20;

/** Whether a column's credit total exceeds the cap. Lives next to the constant
 *  so the comparison has one owner. */
export function isSemesterOverloaded(credits: number): boolean {
  return credits > MAX_SEMESTER_CREDITS;
}

export type CardStatus = {
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
  /** Human course codes / patterns ("CS 111x", code form) from the failing
   *  PREREQ tree's leaves (HARD misses only). Empty unless the prereq tree
   *  blocks. Patterns are raw here; leafWording turns them into prose. */
  unmetPrereqLeaves: string[];
  /** Same, for the failing COREQ tree (a corequisite miss reads "Take X
   *  alongside", not "Needs X first"). Empty unless the coreq tree blocks. */
  unmetCoreqLeaves: string[];
  /** The prereq tree's tri-state (spec 007 §1b). null exactly where `prereq` is
   *  null (no course / no prereqExpr). */
  prereqState: "met" | "advisory" | "blocked" | null;
  /** Advisory-node notes from the prereq (and coreq) tree whose inner expr is
   *  unsatisfied — "usually needs MATH 1910; AP credit also counts". Informational,
   *  reported for advisory AND blocked cards; NEVER implies blocked. */
  advisoryNotes: string[];
  /** Display codes of OTHER placed courses this card forbid-overlaps with (spec
   *  007 §1b/§5). Advisory tone, never blocking. Empty when no conflict. */
  overlaps: string[];
  /** The course's `prereq_notes` prose (grade minimums, permission-of-instructor,
   *  etc.) — No-data-safe, never a hard block (spec 007 §1b/§4). */
  docNotes: string[];
  /** The credit-profile entry (AP/IB/transfer/placement) that already grants
   *  THIS placed course, or null (spec 007 §2c). When set, the course's own
   *  prereq/coreq/term checks are moot — the student already holds the credit —
   *  so the engine reports it neutral-met: prereq/coreq true (where an expr
   *  exists), prereqState "met", offeredOk null, never blocked, no unmet
   *  leaves or advisory notes. Overlaps and docNotes still report. */
  coveredByCredit: CreditSource | null;
};

export type CardStatusResult = {
  /** placement id → status. A Record (not a Map) to mirror the string-keyed
   *  prereqStatusMap the UI already indexes as `map[placement.id]`. */
  statusMap: Record<string, CardStatus>;
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

/** Which credit-profile entry grants a course: its kind ("ap" | "ib" |
 *  "transfer" | "placement") and student-facing label. */
export type CreditSource = { kind: string; label: string };

/** Synthetic credit courses (spec 007 §2 — AP/IB/transfer) folded into every
 *  evaluate() ctx as "completed from semester 0". `sources` (course id → the
 *  granting entry, built by creditPool.buildCreditCourses) lets the engine name
 *  the credit that covers a placed course; optional so hand-built pools (tests,
 *  the catalog) stay valid — a covered course without a source reads as a
 *  generic credit. */
export type CreditCourses = {
  ids: Set<string>;
  codes: Set<string>;
  sources?: Map<string, CreditSource>;
};
const NO_CREDIT: CreditCourses = { ids: new Set(), codes: new Set() };
/** coveredByCredit for a credit pool built without `sources`. */
const GENERIC_CREDIT: CreditSource = { kind: "credit", label: "Credit" };

/** Everything derivable from the plan before looking at a specific semester:
 *  per-semester course pools + credit totals, and the "completed regardless of
 *  column" prior pool. Shared by the per-card loop in computeCardStatusMap and
 *  the detail panel's semesterPrereqPools. */
type PlanPools = {
  semCourses: Map<number, { ids: Set<string>; codes: Set<string> }>;
  semesterCredits: Map<number, number>;
  priorIds: Set<string>;
  priorCodes: Set<string>;
  sortedSems: number[];
  /** Every course on the board, any semester (EvalContext.boardIds). */
  boardIds: Set<string>;
};

function buildPlanPools(cards: BoardCard[], completedPlacementIds: string[]): PlanPools {
  // ── Per-semester pools of placed courses + per-semester credit totals. ─────
  const semCourses = new Map<number, { ids: Set<string>; codes: Set<string> }>();
  const semesterCredits = new Map<number, number>();
  for (const { placement, course } of cards) {
    const sem = placement.sem;

    let entry = semCourses.get(sem);
    if (!entry) {
      entry = { ids: new Set(), codes: new Set() };
      semCourses.set(sem, entry);
    }
    entry.ids.add(course.id);
    entry.codes.add(courseCode(course));

    // Variable-credit courses count at their MINIMUM (credits_min) — the same
    // floor columnCredits()/formatCredits use — so overload warnings never
    // false-positive on an "up to N credits" course.
    semesterCredits.set(sem, (semesterCredits.get(sem) ?? 0) + course.credits_min);
  }

  // ── Completed cards count as done regardless of their column. Every card
  //    carries a course (a placement without a course doc, e.g. from a term
  //    the catalog hasn't synced, gets one derived from its id in
  //    board.courseForPlacement), so a missing doc can't permanently block the
  //    courses that depend on it. ────────────────────────────────────────────
  const completedSet = new Set(completedPlacementIds);
  const priorIds = new Set<string>();
  const priorCodes = new Set<string>();
  for (const { placement, course } of cards) {
    if (!completedSet.has(placement.id)) continue;
    priorIds.add(course.id);
    priorCodes.add(courseCode(course));
  }

  const sortedSems = [...semCourses.keys()].sort((a, b) => a - b);
  const boardIds = new Set(cards.map((c) => c.course.id));

  return { semCourses, semesterCredits, priorIds, priorCodes, sortedSems, boardIds };
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
 *  semantics: completed = completed cards + strictly-earlier semesters;
 *  concurrent = same-or-earlier. The detail panel feeds these to the prereq
 *  tree so a leaf there never disagrees with the card's blocked state.
 *
 *  `creditCourses` (spec 007 §2/§3 — Unit 7C2) is optional and unioned into
 *  BOTH the completed and concurrent pools, mirroring computeCardStatusMap's
 *  own evaluate() calls (which fold creditIds/creditCodes into every pool a
 *  leaf can see). Passing it keeps the detail panel's tree/notes agreeing
 *  with the card's engine-computed status — the C1 bug class this spec fixes. */
export function semesterPrereqPools(
  cards: BoardCard[],
  completedPlacementIds: string[],
  sem: number,
  creditCourses: CreditCourses = NO_CREDIT
): {
  completedIds: Set<string>;
  completedCodes: Set<string>;
  concurrentIds: Set<string>;
  concurrentCodes: Set<string>;
  boardIds: Set<string>;
} {
  const plan = buildPlanPools(cards, completedPlacementIds);
  const p = poolsAt(plan, sem);
  return {
    boardIds: plan.boardIds,
    completedIds: unionSet(p.earlierIds, creditCourses.ids),
    completedCodes: unionSet(p.earlierCodes, creditCourses.codes),
    concurrentIds: unionSet(p.concurrentIds, creditCourses.ids),
    concurrentCodes: unionSet(p.concurrentCodes, creditCourses.codes),
  };
}

/**
 * `placedCourses` is the plan's course map (course id → course); together with
 * the cards' own courses it names unmet leaves in display form.
 *
 * `canonical` (optional, identity by default) is the cross-listing
 * canonicalizer from the catalog's alias map, threaded into every evaluate()
 * call so a cross-listed twin satisfies a leaf (ENGRD-2110 ⇄ CS-2110).
 */
export function computeCardStatusMap(
  cards: BoardCard[],
  completedPlacementIds: string[],
  placedCourses: Record<string, Course>,
  creditCourses: CreditCourses = NO_CREDIT,
  canonical?: (id: string) => string
): CardStatusResult {
  const plan = buildPlanPools(cards, completedPlacementIds);
  const { semesterCredits } = plan;
  const { ids: creditIds, codes: creditCodes } = creditCourses;

  // id → course, for leaf → code. A card's own course wins over the plan map.
  const courseById = new Map<string, Course>();
  for (const c of Object.values(placedCourses)) courseById.set(c.id, c);
  for (const { course } of cards) courseById.set(course.id, course);

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
  // asymmetric. Each conflicted card lists the OTHER course's display code(s).
  // Direct id matching, no alias canonicalization in v1: overlap lists carry
  // roster-code ids that already match course-doc ids.
  const overlapsByCard = new Map<string, string[]>();
  for (const a of cards) {
    const codes = new Set<string>();
    for (const b of cards) {
      if (a.placement.id === b.placement.id) continue; // self never flagged
      const conflict =
        a.course.forbidden_overlaps.includes(b.course.id) ||
        b.course.forbidden_overlaps.includes(a.course.id);
      if (conflict) codes.add(courseCode(b.course));
    }
    if (codes.size > 0) overlapsByCard.set(a.placement.id, [...codes]);
  }

  const statusMap: Record<string, CardStatus> = {};

  for (const { placement, course } of cards) {

    // ── Covered by credit (spec 007 §2c): the student already holds credit
    //    for THIS course (e.g. AP Calculus BC → MATH 1910), so its own
    //    prereqs/coreqs/term are moot — report it neutral-met rather than
    //    "Needs X first". Courses that list it as a prereq already see the
    //    credit via creditIds in their own evaluate() calls below. ──
    if (creditIds.has(course.id)) {
      statusMap[placement.id] = {
        prereq: course.prereq_expr ? true : null,
        coreq: course.coreq_expr ? true : null,
        offeredOk: null,
        blocked: false,
        unmetPrereqLeaves: [],
        unmetCoreqLeaves: [],
        prereqState: course.prereq_expr ? "met" : null,
        advisoryNotes: [],
        overlaps: overlapsByCard.get(placement.id) ?? [],
        docNotes: course.prereq_notes,
        coveredByCredit: creditCourses.sources?.get(course.id) ?? GENERIC_CREDIT,
      };
      continue;
    }

    const sem = placement.sem;

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
          canonical,
          boardIds: plan.boardIds,
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
          canonical,
          boardIds: plan.boardIds,
        })
      : null;
    const coreq: boolean | null = coreqResult ? coreqResult.state !== "blocked" : null;

    // ── offeredOk: null when no `offered` data, else term membership. ──
    const offeredOk: boolean | null =
      course.offered.length === 0 ? null : course.offered.includes(termForSemester(sem));

    const blocked = prereq === false || coreq === false;

    // ── Unmet leaves: HARD misses only, per tree. evaluate.missing is []
    //    unless that tree is blocked. ──
    const unmetPrereqLeaves = [...new Set((prereqResult?.missing ?? []).map(resolveLeaf))];
    const unmetCoreqLeaves = [...new Set((coreqResult?.missing ?? []).map(resolveLeaf))];

    // Advisory notes from both trees (reported for advisory AND blocked cards).
    const advisoryNotes = [
      ...new Set([
        ...(prereqResult?.advisoryNotes ?? []),
        ...(coreqResult?.advisoryNotes ?? []),
      ]),
    ];

    statusMap[placement.id] = {
      prereq,
      coreq,
      offeredOk,
      blocked,
      unmetPrereqLeaves,
      unmetCoreqLeaves,
      prereqState,
      advisoryNotes,
      overlaps: overlapsByCard.get(placement.id) ?? [],
      docNotes: course.prereq_notes,
      coveredByCredit: null,
    };
  }

  return { statusMap, semesterCredits };
}
