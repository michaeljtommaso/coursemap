import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useProgramStore } from "@/store/useProgramStore";
import { programToRestore } from "@/lib/planner/restoreProgram";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import {
  subscribePlan,
  createPlan,
  updatePlan,
  deletePlan as deletePlanDoc,
  listPlans,
  type LoadedPlan,
  type PlanListItem,
  type UpdatePlanPatch,
} from "@/services/plans";
import {
  AdditionalProgramSchema,
  CourseMarksSchema,
  MAX_ADDITIONAL_PROGRAMS,
  MAX_COURSE_MARKS,
  MAX_MINORS,
  MAX_SECOND_MAJORS,
  MAX_TRIED_COURSES,
  PLAN_SCHEMA_VERSION,
  type AdditionalProgram,
  type MinorIndexEntry,
} from "@/lib/schemas";
import { minorClosure, onlyOpenToWho } from "@/lib/planner/minorEligibility";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { countsForKey, parseCountsForKey, parseRef } from "@/lib/planner/questions/keys";
import { canonicalProgramId } from "@/lib/planner/legacyPrograms";
import { programCollegeId } from "@/lib/planner/colleges";
import { engineeringForbiddenReason } from "@/lib/planner/engineeringDoubleMajor";
import { peekMinorIndex } from "@/services/minorIndexCache";
import { snapshotToCourse, courseToSnapshot } from "@/lib/normalize/courseSnapshot";
import type { Course, ProgramSlotWithData } from "@/types/db";
import type { ColumnRef, Placement } from "@/types/plan";
import {
  MAX_SHORT_TERMS,
  refOf,
  sameColumn,
  sanitizeShortTerms,
  termOfColumn,
  toColumnRef,
} from "@/lib/planner/terms";
import { usePlannerStore } from "@/store/usePlannerStore";
import type { RemapTargetSlot } from "@/lib/planner/remapPlacements";
import {
  MAX_PLACEMENTS,
  columnHasCourse,
  insertPlacement,
  movePlacementTo,
  removePlacementById,
  startingPlacements,
} from "@/lib/planner/placementOps";
import {
  seedPlanFromPrevious,
  mergeSeedMarks,
  mergeSeedTried,
  carryShortTerms,
  mergeSeedPrograms,
  planContentIsEmpty,
  coursesLeftBehind,
  leftBehindMessage,
} from "@/lib/planner/seedPlanFromPrevious";

/**
 * PlanProvider (docs/specs/002 §6; plan model = spec 014 course PLACEMENTS) —
 * owns the authoritative cloud plan and all plan mutations.
 *
 * Model (spec 014 §D1/§D5): the board is an ordered list of placements per
 * semester; requirements are attribution (majorMatch), not containers. State:
 *   placements, placedCourses (courseId → Course), completedIds /
 *   inProgressIds (placement ids — one manual state per placement),
 *   waivedRequirementIds (requirement ids), courseMarks (spec 020 answer key
 *   → mark; kept when its course leaves the board, D5), triedCourseIds
 *   (spec 028 D12 tried classes — course ids the student is trying on the
 *   Requirements page; not on the board, never shared), shortTerms (spec 042
 *   D4 added winter/summer columns — written only while non-empty).
 *
 * Sync recipe (standard layout-persistence): self-write, 600ms debounce,
 * echo-suppress, sanitize-on-load.
 *   - onSnapshot(users/{uid}/plans/{activePlanId}) is the source of truth.
 *   - Mutations apply OPTIMISTICALLY to local state and write through
 *     updatePlan() debounced 600ms.
 *   - lastWrittenRef holds a signature of our own last write; the snapshot that
 *     round-trips it is ignored (echo suppression).
 *   - A FAILED write rolls the optimistic state back to the last state the
 *     server confirmed AND says so with a toast (fail-closed rules shipped
 *     silent ~300ms rollbacks twice before — never again).
 *   - sanitize-on-load lives in normalizePlan (older schemaVersion → EMPTY).
 *   - While a debounced write is PENDING for this plan, incoming snapshots are
 *     skipped: the pending write carries the full local state and wins
 *     (last-writer-wins), so an edit is never built on a snapshot that the
 *     write is about to overwrite (fix pass P3).
 *   - The pending write is flushed on pagehide / visibilitychange→hidden, so
 *     an edit made just before a reload or tab close isn't lost (fix pass P4).
 *
 * Starting board (spec 014 §D6): one placement per fixed single-course
 * requirement of the program. A NEW plan is created with it (auto-create /
 * the switcher's "new plan"); otherwise it is laid down on load only for a
 * plan that was just created empty (a carry-over seed may be pending) or a
 * LEGACY doc (older schemaVersion, read as empty). A plan the student emptied
 * on purpose stays empty — on reload and in a second tab (fix pass P2). A
 * legacy doc whose program has nothing fixed still gets one empty new-shape
 * write, so it upgrades in place before the rules CONTRACT step (fix pass P7).
 *
 * Program identity (fix pass P6): `planProgramId` is the program of the plan
 * that is actually LOADED. Reset and the requirement template follow it, not
 * the selected program, so a slow major switch can't apply the new program's
 * board or requirements to the old plan.
 *
 * Auto-create: a fresh user with no plan for the selected program gets a plan
 * auto-created (name defaulted to the program shortName). Each program has its
 * OWN plan document.
 */

const DEBOUNCE_MS = 600;

export type PlanState = {
  placements: Placement[];
  placedCourses: Record<string, Course>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  /** Spec 020 D2 course marks: answer key (questions/keys.ts) → value. A
   *  cleared mark is absent, never null. */
  courseMarks: Record<string, MarkValue>;
  /** Spec 028 D12 tried classes: course ids, in the order tried, at most
   *  MAX_TRIED_COURSES. Placing one on the board (addPlacement, by any path)
   *  removes it in the same save (triedAfterPlacing); so do untryCourse /
   *  clearTried. A reset or a new starting board keeps them. */
  triedCourseIds: string[];
  /** Spec 042 D4 added short-term columns: the k of each "short term just
   *  before semester k", sorted, deduped, at most MAX_SHORT_TERMS. An empty
   *  added column persists until removeShortTerm. Placing a class into a
   *  short term adds its k here in the same save. A reset clears them (the
   *  starting board has none); a new starting board laid on load keeps them. */
  shortTerms: number[];
  /** Spec 047 D2: the plan's second major and minors, in the order added
   *  (at most 1 + 3). Persisted with the plan; `[]` deletes the field. A
   *  reset or a new starting board keeps them. */
  additionalPrograms: AdditionalProgram[];
};

type PlanContextValue = PlanState & {
  planId: string | null;
  /** The program of the LOADED plan (null while none is loaded). During a
   *  major switch this stays the OLD program until the new plan loads — read
   *  it (not the selected program) for anything evaluated against the board. */
  planProgramId: string | null;
  planName: string | null;
  planLoading: boolean;
  planError: boolean;
  /** Place `course` in the `target` column at `index` (omitted = append). A
   *  number is a regular semester; a ColumnRef with `shortTerm` is the short
   *  term before that semester (spec 042), which is added to `shortTerms` if
   *  it isn't there yet. Returns the new placement id, or null — with a
   *  toast, never silently — at the cap. */
  addPlacement: (course: Course, target: number | ColumnRef, index?: number) => string | null;
  /** Move a placement to the `target` column (number = regular semester, or
   *  a ColumnRef); `index` = position in the TARGET column after the mover is
   *  taken out (0 = top; past the end = append). Moving into a short term not
   *  yet in `shortTerms` adds it. */
  movePlacement: (id: string, target: number | ColumnRef, index: number) => void;
  /** Add the short-term column just before semester `sem` (spec 042 D2/D4).
   *  Returns false, and changes nothing, when `sem` isn't an integer 1..10,
   *  that short term is already added, or MAX_SHORT_TERMS are. */
  addShortTerm: (sem: number) => boolean;
  /** Remove the short-term column before semester `sem` (spec 042 D7).
   *  Returns false, and changes nothing, while any class sits in it or when
   *  it isn't an added short term. */
  removeShortTerm: (sem: number) => boolean;
  /** Remove a placement (and its marks); an Undo toast restores it exactly. */
  removePlacement: (id: string) => void;
  /** Toggle "completed" on a placement; clears in-progress (one manual state). */
  toggleCompleted: (id: string) => void;
  /** Toggle "currently taking" on a placement; clears completed. */
  toggleInProgress: (id: string) => void;
  /** Toggle a requirement waiver (requirement id = template slot id). */
  toggleWaivedRequirement: (requirementId: string) => void;
  /** Answer (or, with null, clear) a course mark (spec 020). Saved through the
   *  normal debounced plan save; a failed save rolls back with the usual
   *  toast. Refuses — with a toast, never silently — past MAX_COURSE_MARKS or
   *  for a malformed key/value. */
  setCourseMark: (key: string, value: MarkValue | null) => void;
  /** Try a class (spec 028 D12): saved with the plan like course marks.
   *  Returns false, and changes nothing, when it is already tried, the list
   *  is at MAX_TRIED_COURSES, or the id is malformed. */
  tryCourse: (courseId: string) => boolean;
  /** Stop trying a class (a no-op when it is not tried). */
  untryCourse: (courseId: string) => void;
  /** Stop trying every class. */
  clearTried: () => void;
  /** Reset to the LOADED plan's program's starting board (spec 014 §D6). */
  resetPlan: () => void;
  /** Rename the active plan (spec 004 §"intimate": the plan has a name). */
  renamePlan: (name: string) => void;
  // ── Plan switcher (spec 005 §6, multiple plans per program) ──
  plansList: PlanListItem[];
  switchPlan: (planId: string, programId: string) => Promise<void>;
  createNewPlan: (programId: string, name: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  // -- Spec 047: extra programs (second major, minors) --
  /** Add a program to the plan (appended; a legacy id is stored as its
   *  current id). "duplicate": already on it; "cap": one second major /
   *  three minors already; "primary": it is the plan's own major;
   *  "invalid": a malformed entry, or a second major from another college
   *  than the primary's (D1) or not in the program list. A refusal also
   *  shows a toast saying why — callers need not toast again. */
  addProgram: (p: AdditionalProgram) => "added" | "duplicate" | "cap" | "primary" | "invalid";
  /** Soft remove (D10): drops the program and `triedToDrop` (tried classes
   *  counting only toward it); waivers and course marks stay. Shows the
   *  "Removed X" toast with Undo (refused after a plan switch). */
  removeProgram: (programId: string, triedToDrop: string[]) => void;
  /** A second major's chosen concentrations (deduped, at most 3; [] clears).
   *  Refused with a toast for a minor or a malformed list. */
  setProgramConcentrations: (programId: string, ids: string[]) => void;
  /** D3/D9: try these classes in order, passing over any already placed or
   *  tried, until the tried cap. `added`: the ids tried; `skipped`: how many
   *  were left out because tried was full. No toast (the caller words it). */
  addTriedCourses: (courseIds: string[]) => { added: string[]; skipped: number };
  /** D8: the one countsFor mark for a course (questions/keys.ts countsForKey);
   *  any other countsFor mark for that course is removed; null clears. A
   *  refusal (marks cap, malformed key) shows a toast. */
  setCountsFor: (courseId: string, layerId: string | null) => void;
  /** D10: drop waivers and course marks that name a layer not in
   *  `liveLayerIds`. Only entries that NAME a layer are candidates: layer
   *  waivers `${layerId}:${rowId}`, row-scoped marks
   *  `${type}:${layerId}/${row}@${course}` and `countsFor:${layerId}@${course}`.
   *  Engineering slot/group-id waivers, credit marks (`creditsTaken:<course>`)
   *  and profile facts are never pruned. Returns how many were dropped. */
  pruneOrphans: (liveLayerIds: string[]) => number;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const EMPTY: PlanState = {
  placements: [],
  placedCourses: {},
  completedIds: [],
  inProgressIds: [],
  waivedRequirementIds: [],
  courseMarks: {},
  triedCourseIds: [],
  shortTerms: [],
  additionalPrograms: [],
};

/** A loaded plan's additional programs (spec 047 D2): normalizePlan already
 *  read them tolerantly under their current ids; [] when the plan has none. */
function additionalProgramsOf(plan: { additionalPrograms?: AdditionalProgram[] }): AdditionalProgram[] {
  return plan.additionalPrograms ?? [];
}

/** Requirement-waiver cap — keep in sync with schemas.ts / firestore.rules. */
const MAX_WAIVERS = 80;

/** Keep placedCourses to exactly the courses on the board (same ref when
 *  nothing to drop). */
function pruneCourses(s: PlanState): PlanState {
  const used = new Set(s.placements.map((p) => p.courseId));
  const keys = Object.keys(s.placedCourses);
  if (keys.every((k) => used.has(k))) return s;
  const placedCourses: Record<string, Course> = {};
  for (const k of keys) if (used.has(k)) placedCourses[k] = s.placedCourses[k];
  return { ...s, placedCourses };
}

/**
 * The short-terms list after adding the short term before semester `sem`
 * (spec 042 D4/D8): sorted. "invalid" unless `sem` is an integer 1..10;
 * "same" when it is already added; "cap" at MAX_SHORT_TERMS. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function nextShortTerms(
  cur: readonly number[],
  sem: number
): number[] | "same" | "cap" | "invalid" {
  if (typeof sem !== "number" || !Number.isInteger(sem) || sem < 1 || sem > 10) return "invalid";
  if (cur.includes(sem)) return "same";
  if (cur.length >= MAX_SHORT_TERMS) return "cap";
  return sanitizeShortTerms([...cur, sem]);
}

/**
 * The short-terms list after removing the short term before semester `sem`
 * (spec 042 D7). "occupied" while any class sits in that column (the × is
 * disabled: move or remove its classes first); "absent" when it isn't an
 * added short term. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shortTermsAfterRemoving(
  s: Pick<PlanState, "placements" | "shortTerms">,
  sem: number
): number[] | "occupied" | "absent" {
  if (s.placements.some((p) => p.shortTerm === true && p.sem === sem)) return "occupied";
  if (!s.shortTerms.includes(sem)) return "absent";
  return s.shortTerms.filter((k) => k !== sem);
}

/** `shortTerms` with the column of placement `id` added when that placement
 *  sits in a short term not yet listed (a class placed or moved into a short
 *  term keeps its column after it is emptied — spec 042 D4). Same array when
 *  nothing changes. */
function shortTermsWithPlacement(
  shortTerms: number[],
  placements: Placement[],
  id: string
): number[] {
  const p = placements.find((x) => x.id === id);
  if (!p || p.shortTerm !== true || shortTerms.includes(p.sem)) return shortTerms;
  return sanitizeShortTerms([...shortTerms, p.sem]);
}

/** The doc payload for a plan state. Every value is defined (Firestore rejects
 *  undefined and fails the whole write). */
function toPayload(s: PlanState) {
  const courseSnapshots: Record<string, unknown> = {};
  for (const p of s.placements) {
    if (courseSnapshots[p.courseId]) continue;
    const c = s.placedCourses[p.courseId] ?? snapshotToCourse(p.courseId, null);
    courseSnapshots[p.courseId] = courseToSnapshot(c);
  }
  return {
    placements: s.placements.map((p): Placement => ({
      id: p.id,
      courseId: p.courseId,
      sem: p.sem,
      order: p.order,
      // Spec 042 D3: the key only on a short-term class (never false).
      ...(p.shortTerm === true ? { shortTerm: true as const } : {}),
    })),
    courseSnapshots,
    completedIds: s.completedIds,
    inProgressIds: s.inProgressIds,
    waivedRequirementIds: s.waivedRequirementIds,
    courseMarks: s.courseMarks,
    triedCourseIds: s.triedCourseIds,
    // The WHOLE list, empty included: updatePlan deletes the field for an
    // empty one (and createContent leaves it out), so a plan without short
    // terms keeps the pre-042 doc shape.
    shortTerms: s.shortTerms,
    // Spec 047 D2: the WHOLE list, empty included (updatePlan deletes the
    // field for an empty one; createContent leaves it out). Entries are
    // copied, so a later edit can't reach into a pending payload.
    additionalPrograms: s.additionalPrograms.map((p) => ({
      ...p,
      ...(p.concentrationIds ? { concentrationIds: [...p.concentrationIds] } : {}),
    })),
    schemaVersion: PLAN_SCHEMA_VERSION,
  };
}

// Stable signature of the writable plan fields, for echo suppression.
function planSignature(p: {
  placements: Placement[];
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  courseSnapshots: Record<string, unknown>;
  courseMarks?: Record<string, MarkValue>;
  triedCourseIds?: string[];
  shortTerms?: number[];
  additionalPrograms?: AdditionalProgram[];
}): string {
  return JSON.stringify({
    // Spec 047: order kept (it is the order the programs were added in).
    ap: (p.additionalPrograms ?? []).map((x) => [x.kind, x.programId, x.concentrationIds ?? []]),
    p: [...p.placements]
      .map((x) => [x.id, x.courseId, x.sem, x.order, x.shortTerm === true ? 1 : 0])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    st: sanitizeShortTerms(p.shortTerms ?? []),
    c: [...p.completedIds].sort(),
    ip: [...p.inProgressIds].sort(),
    w: [...p.waivedRequirementIds].sort(),
    cs: Object.keys(p.courseSnapshots).sort(),
    m: Object.entries(p.courseMarks ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    // Order kept: it is the order the classes were tried in.
    t: p.triedCourseIds ?? [],
  });
}

const EMPTY_SIGNATURE = planSignature({ ...EMPTY, courseSnapshots: {} });

// A program slot as the C4 matcher needs it (spec 009 §4) — used only to count
// how many carried courses fill a new-program requirement for the toast.
function toRemapTarget(s: ProgramSlotWithData): RemapTargetSlot {
  return {
    id: s.id,
    kind: s.kind,
    courseId: s.courses?.id ?? s.course_id,
    pattern: s.pattern,
    attributeMatch: s.attribute_match ?? null,
    qualifyingRule: s.elective_groups?.qualifying_rule ?? null,
    courseIds: s.elective_groups?.course_ids ?? [],
  };
}

/** The Course objects of a template's fixed course slots, by course id. */
function templateCourses(slots: ProgramSlotWithData[]): Record<string, Course> {
  const out: Record<string, Course> = {};
  for (const s of slots) if (s.kind === "course" && s.courses) out[s.courses.id] = s.courses;
  return out;
}

const FAILED_WRITE_TOAST = "Couldn't save your last change — check your connection and try again.";

/** Everything a removal's Undo needs, captured BEFORE the removal (spec 014
 *  §D8): the exact placement, its course, its mark, and the plan it was in. */
export type RemovedPlacement = {
  planId: string | null;
  placement: Placement;
  course: Course | null;
  wasCompleted: boolean;
  wasInProgress: boolean;
};

/** Spec 047 D4's refusal: "CS 2110 is already in Fall 2027." (bare season when
 *  the entering year is unknown). Pure — unit-tested. */
// eslint-disable-next-line react-refresh/only-export-components
export function alreadyInColumnMessage(
  code: string,
  target: number | ColumnRef,
  enteringYear: number | null | undefined
): string {
  return `${code} is already in ${termOfColumn(toColumnRef(target), enteringYear).label}.`;
}

/**
 * The state after undoing a removal: the placement back at its column and
 * position with its course and mark. "other-plan" when the plan on screen is
 * no longer the one it was removed from; the same `s` when it is already back;
 * "cap" when the board is full (the caller must say so — never a silent
 * no-op, fix pass P5); "duplicate" when its column now holds the same course
 * (spec 047 D4; `canonical` is the plan's alias map). Pure — unit-tested.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function restoreRemovedPlacement(
  s: PlanState,
  r: RemovedPlacement,
  currentPlanId: string | null,
  canonical: (id: string) => string = (id) => id
): PlanState | "cap" | "other-plan" | "duplicate" {
  // Never restore into a different plan than the one it left (fix pass P1).
  if (currentPlanId !== r.planId) return "other-plan";
  const { placement, course } = r;
  if (s.placements.some((p) => p.id === placement.id)) return s; // already back
  if (s.placements.length >= MAX_PLACEMENTS) return "cap";
  if (
    columnHasCourse(
      s.placements,
      placement.courseId,
      { sem: placement.sem, shortTerm: placement.shortTerm === true },
      canonical
    )
  ) {
    return "duplicate";
  }
  // Back into its own column — a short term included (spec 042), whose
  // column comes back too if it was removed meanwhile.
  const placements = insertPlacement(
    s.placements,
    { id: placement.id, courseId: placement.courseId },
    { sem: placement.sem, shortTerm: placement.shortTerm === true },
    placement.order
  );
  if (placements === s.placements) return "cap";
  return {
    ...s,
    placements,
    shortTerms: shortTermsWithPlacement(s.shortTerms, placements, placement.id),
    placedCourses: course ? { ...s.placedCourses, [course.id]: course } : s.placedCourses,
    completedIds: r.wasCompleted ? [...s.completedIds, placement.id] : s.completedIds,
    inProgressIds: r.wasInProgress ? [...s.inProgressIds, placement.id] : s.inProgressIds,
  };
}

/**
 * Should a loaded plan get the program's starting board laid down (fix pass
 * P2)? Only an EMPTY plan that is either a legacy doc (older schemaVersion,
 * read as empty) or one this session just created. A plan the student
 * emptied on purpose stays empty — on reload and in a second tab. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldLayStartingBoard(
  plan: {
    legacy: boolean;
    placements: unknown[];
    completedIds: string[];
    inProgressIds: string[];
    waivedRequirementIds: string[];
  },
  justCreated: boolean
): boolean {
  return planContentIsEmpty(plan) && (plan.legacy || justCreated);
}

/**
 * Skip an incoming snapshot of `snapshotPlanId` while a debounced write is
 * still pending for that plan (fix pass P3): the pending write holds the full
 * local state and will overwrite the doc, so applying the snapshot would only
 * let the next edit build on state that is about to be replaced. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldSkipSnapshot(
  pendingWritePlanId: string | null | undefined,
  snapshotPlanId: string
): boolean {
  return pendingWritePlanId === snapshotPlanId;
}

/**
 * The course-marks map after answering `key` with `value` (null clears it),
 * spec 020. "same" when nothing changes; "cap" when a NEW answer would pass
 * MAX_COURSE_MARKS; "invalid" when the key or value is malformed (the strict
 * CourseMarksSchema the save path runs). A cleared mark is deleted from the
 * map, never stored as null. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function nextCourseMarks(
  cur: Record<string, MarkValue>,
  key: string,
  value: MarkValue | null
): Record<string, MarkValue> | "same" | "cap" | "invalid" {
  if (value === null ? !(key in cur) : cur[key] === value) return "same";
  if (value !== null && !(key in cur) && Object.keys(cur).length >= MAX_COURSE_MARKS) return "cap";
  const next = { ...cur };
  if (value === null) delete next[key];
  else next[key] = value;
  return CourseMarksSchema.safeParse(next).success ? next : "invalid";
}

/**
 * A major-switch carry-over seed (spec 009 §4, spec 020 D5): the state the
 * seed writes, and the state a failed seed save rolls back to. The seeded
 * marks are the target plan's own marks plus the carried ones, capped at
 * MAX_COURSE_MARKS (mergeSeedMarks). The rollback keeps the target plan's
 * marks: an empty board may still hold marks on the server, and rolling back
 * to no marks would let the next edit write an empty map and erase them.
 * Tried classes (spec 028 D12) follow the same rule: the target plan's own
 * first, then the carried ones, capped at MAX_TRIED_COURSES (mergeSeedTried);
 * the rollback keeps the target plan's own. Short-term columns (spec 042 D4,
 * D12) likewise: the target plan's own plus the carried ones plus the column
 * of every carried short-term class; the rollback keeps the target's own (an
 * "empty" board can still hold empty added columns on the server). Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function seedStates(
  board: Omit<PlanState, "courseMarks" | "triedCourseIds" | "shortTerms" | "additionalPrograms">,
  carriedMarks: Record<string, MarkValue>,
  targetMarks: Record<string, MarkValue>,
  carriedTried: string[] = [],
  targetTried: string[] = [],
  carriedShortTerms: readonly number[] = [],
  targetShortTerms: readonly number[] = [],
  // Spec 047 D13: the target plan's own extra programs (kept on both sides)
  // and the carried ones (seed.additionalPrograms, after the target's own,
  // within the caps; the rollback keeps only the target's own).
  targetPrograms: AdditionalProgram[] = [],
  carriedPrograms: AdditionalProgram[] = [],
  primaryProgramId?: string
): { next: PlanState; confirmed: PlanState } {
  return {
    next: {
      ...board,
      courseMarks: mergeSeedMarks(targetMarks, carriedMarks),
      triedCourseIds: mergeSeedTried(targetTried, carriedTried),
      shortTerms: carryShortTerms([...targetShortTerms, ...carriedShortTerms], board.placements),
      additionalPrograms:
        carriedPrograms.length > 0
          ? mergeSeedPrograms(targetPrograms, carriedPrograms, primaryProgramId)
          : targetPrograms,
    },
    confirmed: {
      ...EMPTY,
      courseMarks: targetMarks,
      triedCourseIds: targetTried,
      shortTerms: sanitizeShortTerms(targetShortTerms),
      additionalPrograms: targetPrograms,
    },
  };
}

/**
 * The tried-classes list after trying `courseId` (spec 028 D12): appended at
 * the end. "same" when it is already tried; "cap" at MAX_TRIED_COURSES;
 * "invalid" for an id the save path would refuse (empty or over 40
 * characters: PlanSchema / rules). Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function nextTriedCourses(
  cur: string[],
  courseId: string
): string[] | "same" | "cap" | "invalid" {
  if (typeof courseId !== "string" || courseId.length === 0 || courseId.length > 40) return "invalid";
  if (cur.includes(courseId)) return "same";
  if (cur.length >= MAX_TRIED_COURSES) return "cap";
  return [...cur, courseId];
}

/**
 * The tried-classes list once `courseId` lands on the board (spec 028 D12,
 * audit F2): a tried class leaves the list by ANY path onto the board, so the
 * 20 cap only ever counts classes that are really being tried. Matched by
 * course, cross-listings included (`canonical`: the catalog's alias map).
 * Same array when nothing changes. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function triedAfterPlacing(
  tried: string[],
  courseId: string,
  canonical: (id: string) => string = (id) => id
): string[] {
  if (tried.length === 0) return tried;
  const placed = canonical(courseId);
  const next = tried.filter((id) => id !== courseId && canonical(id) !== placed);
  return next.length === tried.length ? tried : next;
}

// ── Spec 047: extra programs (second major, minors) — pure state helpers ──

/** addProgram's answer (contract §4). */
export type AddProgramResult = "added" | "duplicate" | "cap" | "primary" | "invalid";

/** A layer id as LayerSchema allows it (the part of a waiver before ":"). */
const LAYER_ID_RE = /^[a-z0-9][a-z0-9-]{0,100}$/;

/** `p` as it is stored: canonical program id (spec 019 D12), concentrations
 *  deduped and only when there are some; null when malformed (the strict
 *  entry schema, concentrations on a minor). Pure. */
function storedProgram(p: AdditionalProgram): AdditionalProgram | null {
  if (!p || typeof p.programId !== "string") return null;
  if (p.kind === "minor" && p.concentrationIds !== undefined) return null;
  const ids = Array.isArray(p.concentrationIds) ? [...new Set(p.concentrationIds)] : [];
  const entry: AdditionalProgram = {
    programId: canonicalProgramId(p.programId),
    kind: p.kind,
    ...(ids.length > 0 ? { concentrationIds: ids } : {}),
  };
  return AdditionalProgramSchema.safeParse(entry).success ? entry : null;
}

/** The cap on programs of `kind` (spec 047 D2). */
function kindCap(kind: AdditionalProgram["kind"]): number {
  return kind === "major" ? MAX_SECOND_MAJORS : MAX_MINORS;
}

/** Is there room for one more program of `kind`? */
function hasRoomFor(cur: readonly AdditionalProgram[], kind: AdditionalProgram["kind"]): boolean {
  return (
    cur.length < MAX_ADDITIONAL_PROGRAMS && cur.filter((q) => q.kind === kind).length < kindCap(kind)
  );
}

/**
 * The extra-programs list after adding `p` (spec 047 D2): appended. Refused
 * as "invalid" (malformed, or a second major whose college is unknown or not
 * the primary's — D1; `collegeOf` reads the program list), "primary" (the
 * plan's own major), "duplicate" (already on the plan) or "cap" (one second
 * major / three minors already). Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function programsAfterAdding(
  cur: readonly AdditionalProgram[],
  p: AdditionalProgram,
  primaryProgramId: string | null,
  collegeOf: (programId: string) => string | null
): AdditionalProgram[] | Exclude<AddProgramResult, "added"> {
  const entry = storedProgram(p);
  if (!entry || !primaryProgramId) return "invalid";
  if (entry.programId === primaryProgramId) return "primary";
  if (cur.some((q) => q.programId === entry.programId)) return "duplicate";
  if (!hasRoomFor(cur, entry.kind)) return "cap";
  if (entry.kind === "major") {
    const college = collegeOf(entry.programId);
    if (!college || college !== collegeOf(primaryProgramId)) return "invalid";
  }
  return [...cur, entry];
}

/**
 * The second major on `programs` that Cornell won't pair with the primary
 * (spec 047 D15: ISST with CS or ORE, either order), with the reason; null
 * when there is none. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function forbiddenSecondMajor(
  programs: readonly AdditionalProgram[],
  primaryId: string | null
): { programId: string; reason: string } | null {
  if (!primaryId) return null;
  for (const p of programs) {
    if (p.kind !== "major") continue;
    const reason = engineeringForbiddenReason(primaryId, p.programId);
    if (reason) return { programId: p.programId, reason };
  }
  return null;
}

/** A minor Cornell closes to the plan's majors (spec 047 D12): `notOpenTo`
 *  a major on the plan (`majorId`), or — with `onlyOpenTo` set — open only to
 *  majors the plan has none of (`majorId` is then the primary, or the first
 *  major when there is no primary). */
export type ClosedMinorPair = { minor: AdditionalProgram; majorId: string; onlyOpenTo?: readonly string[] };

/**
 * The first minor on `programs` whose minor-index entry closes it to the
 * plan's majors — the primary (`primaryId`) and a second major on `programs`,
 * alike (minorClosure): `notOpenTo` one of them, or `onlyOpenTo` none of
 * them. Matched like the `program` rule leaf (a prefix matches every catalog
 * year). With `involving`, only a closure that program is part of: the minor
 * itself, or for `notOpenTo` the major it is closed to (adding or bringing
 * back a major can never close an `onlyOpenTo` minor, so an `onlyOpenTo`
 * closure involves only its minor). `index` is the minor index the session
 * already read; without it nothing is known closed (null). Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function closedMinorPair(
  programs: readonly AdditionalProgram[],
  primaryId: string | null,
  index: readonly MinorIndexEntry[] | null,
  involving?: string
): ClosedMinorPair | null {
  if (!index) return null;
  const majors = [
    ...(primaryId ? [primaryId] : []),
    ...programs.filter((p) => p.kind === "major").map((p) => p.programId),
  ];
  for (const minor of programs) {
    if (minor.kind !== "minor") continue;
    const entry = index.find((e) => e.id === minor.programId);
    if (involving !== undefined && involving !== minor.programId) {
      // Only a notOpenTo pair with the `involving` major counts.
      const closure = minorClosure({ notOpenTo: entry?.notOpenTo }, [involving]);
      if (closure?.kind === "notOpenTo" && majors.includes(involving)) return { minor, majorId: involving };
      continue;
    }
    const closure = minorClosure(entry, majors);
    if (!closure) continue;
    if (closure.kind === "notOpenTo") return { minor, majorId: closure.majorId };
    return { minor, majorId: majors[0], onlyOpenTo: closure.onlyOpenTo };
  }
  return null;
}

/**
 * The `onlyOpenTo` minor that removing major `programId` from `programs`
 * would close (spec 047 D12, the mirror of adding a major a minor is
 * `notOpenTo`): open with it on the plan, closed without it. Null for a
 * minor, a program not on the plan, a minor already closed, or without the
 * minor index. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function minorClosedByRemoving(
  programs: readonly AdditionalProgram[],
  primaryId: string | null,
  index: readonly MinorIndexEntry[] | null,
  programId: string
): ClosedMinorPair | null {
  if (!index) return null;
  const leaving = programs.find((p) => p.programId === programId);
  if (!leaving || leaving.kind !== "major") return null;
  const after = programs.filter((p) => p !== leaving);
  for (const minor of after) {
    if (minor.kind !== "minor") continue;
    const now = closedMinorPair([minor, ...programs.filter((p) => p.kind === "major")], primaryId, index);
    if (now) continue; // already closed: removing a major doesn't change that
    const then = closedMinorPair([minor, ...after.filter((p) => p.kind === "major")], primaryId, index);
    if (then) return then;
  }
  return null;
}

/**
 * `programs` without the minors Cornell closes to a major on the plan (spec
 * 047 D12/D13: a major switch never carries a minor the new primary or the
 * carried second major can't take). Only minors `droppable` says may go are
 * dropped (a seed drops carried ones, never the target plan's own). Without
 * the minor index nothing is dropped. The same array when nothing is. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function withoutClosedMinors(
  programs: AdditionalProgram[],
  primaryId: string | null,
  index: readonly MinorIndexEntry[] | null,
  droppable: (programId: string) => boolean = () => true
): { programs: AdditionalProgram[]; dropped: ClosedMinorPair[] } {
  if (!index) return { programs, dropped: [] };
  const majors = programs.filter((p) => p.kind === "major");
  const dropped: ClosedMinorPair[] = [];
  const kept = programs.filter((p) => {
    if (p.kind !== "minor" || !droppable(p.programId)) return true;
    const hit = closedMinorPair([p, ...majors], primaryId, index);
    if (hit) dropped.push(hit);
    return hit === null;
  });
  return { programs: dropped.length > 0 ? kept : programs, dropped };
}

/** Everything a program removal's Undo needs (spec 047 D10), captured before
 *  the removal: the entry, its place in the list, the tried classes dropped
 *  with it, and the plan it was in. */
export type RemovedProgram = {
  planId: string | null;
  program: AdditionalProgram;
  index: number;
  /** The tried classes that left with it, in their tried order. */
  tried: string[];
};

/**
 * The state after removing program `programId` (spec 047 D10, soft remove):
 * the entry leaves the list and so do the tried classes in `triedToDrop`
 * (the caller's "counts only toward it" list; matched by course, aliases
 * included). Waivers and course marks stay. Null when it isn't on the plan.
 * Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function programRemoval(
  s: PlanState,
  programId: string,
  triedToDrop: readonly string[],
  canonical: (id: string) => string = (id) => id
): { next: PlanState; removed: Omit<RemovedProgram, "planId"> } | null {
  const index = s.additionalPrograms.findIndex((p) => p.programId === programId);
  if (index < 0) return null;
  const drop = new Set(triedToDrop.map(canonical));
  const tried = s.triedCourseIds.filter((id) => drop.has(canonical(id)));
  return {
    next: {
      ...s,
      additionalPrograms: s.additionalPrograms.filter((_, i) => i !== index),
      triedCourseIds:
        tried.length > 0 ? s.triedCourseIds.filter((id) => !drop.has(canonical(id))) : s.triedCourseIds,
    },
    removed: { program: s.additionalPrograms[index], index, tried },
  };
}

/**
 * The state after undoing a program removal (spec 047 D10): the entry back
 * at its place, and its tried classes back unless placed or tried meanwhile,
 * up to MAX_TRIED_COURSES (`triedLeftOut` counts those that didn't fit).
 * "other-plan" when the plan on screen is not the one it left (like
 * restoreRemovedPlacement); "cap" when its kind's cap filled meanwhile;
 * "closed" when, with `closedCheck` (the plan's primary and the session's
 * minor index), bringing it back would pair a minor with a major Cornell
 * closes it to (D12 notOpenTo — e.g. a CS second major added meanwhile); the
 * same `s` (nothing left out) when it is already back. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function restoreRemovedProgram(
  s: PlanState,
  r: RemovedProgram,
  currentPlanId: string | null,
  canonical: (id: string) => string = (id) => id,
  closedCheck?: { primaryId: string | null; minorIndex: readonly MinorIndexEntry[] | null }
): { next: PlanState; triedLeftOut: number } | "other-plan" | "cap" | "closed" {
  if (currentPlanId !== r.planId) return "other-plan";
  if (s.additionalPrograms.some((p) => p.programId === r.program.programId)) return { next: s, triedLeftOut: 0 };
  if (!hasRoomFor(s.additionalPrograms, r.program.kind)) return "cap";
  const additionalPrograms = [...s.additionalPrograms];
  additionalPrograms.splice(Math.min(r.index, additionalPrograms.length), 0, r.program);
  if (
    closedCheck &&
    closedMinorPair(additionalPrograms, closedCheck.primaryId, closedCheck.minorIndex, r.program.programId)
  ) {
    return "closed";
  }
  const back = triedAfterAdding(s.triedCourseIds, s.placements, r.tried, canonical);
  return {
    next: { ...s, additionalPrograms, triedCourseIds: back.next },
    triedLeftOut: back.skipped,
  };
}

/**
 * A second major's concentrations after choosing `ids` (spec 047 D2): deduped,
 * in the order given; none removes the field. "absent" when the program is
 * not on the plan; "minor" for a minor (never concentrations); "invalid" for
 * more than three or a malformed id; "same" when nothing changes. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function programsWithConcentrations(
  cur: readonly AdditionalProgram[],
  programId: string,
  ids: readonly string[]
): AdditionalProgram[] | "absent" | "minor" | "invalid" | "same" {
  const index = cur.findIndex((p) => p.programId === programId);
  if (index < 0) return "absent";
  const p = cur[index];
  if (p.kind === "minor") return "minor";
  const chosen = [...new Set(ids)];
  const entry: AdditionalProgram = {
    programId: p.programId,
    kind: p.kind,
    ...(chosen.length > 0 ? { concentrationIds: chosen } : {}),
  };
  if (!AdditionalProgramSchema.safeParse(entry).success) return "invalid";
  if (JSON.stringify(entry.concentrationIds ?? []) === JSON.stringify(p.concentrationIds ?? [])) return "same";
  return cur.map((q, i) => (i === index ? entry : q));
}

/**
 * The tried-classes list after trying `courseIds` in order (spec 047 D3/D9):
 * a class already placed or already tried (by course, aliases included), a
 * repeat within `courseIds` and a malformed id are passed over; the rest are
 * appended until MAX_TRIED_COURSES. `added` are the ids appended; `skipped`
 * counts those left out because tried was full. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function triedAfterAdding(
  tried: readonly string[],
  placements: readonly Pick<Placement, "courseId">[],
  courseIds: readonly string[],
  canonical: (id: string) => string = (id) => id
): { next: string[]; added: string[]; skipped: number } {
  const taken = new Set([...placements.map((p) => canonical(p.courseId)), ...tried.map(canonical)]);
  const next = [...tried];
  const added: string[] = [];
  let skipped = 0;
  for (const id of courseIds) {
    if (typeof id !== "string" || id.length === 0 || id.length > 40) continue;
    const c = canonical(id);
    if (taken.has(c)) continue;
    taken.add(c);
    if (next.length >= MAX_TRIED_COURSES) {
      skipped++;
      continue;
    }
    next.push(id);
    added.push(id);
  }
  return { next: added.length > 0 ? next : [...tried], added, skipped };
}

/**
 * The course marks after choosing where `courseId` counts (spec 047 D8): the
 * one `countsFor:${layerId}@${courseId}` mark ("yes"), with any other
 * countsFor mark for that course removed; `layerId` null clears them all.
 * "same" when nothing changes; "cap" when the new mark would pass
 * MAX_COURSE_MARKS; "invalid" when the key is malformed. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function marksWithCountsFor(
  cur: Record<string, MarkValue>,
  courseId: string,
  layerId: string | null
): Record<string, MarkValue> | "same" | "cap" | "invalid" {
  const key = layerId === null ? null : countsForKey(layerId, courseId);
  if (key !== null) {
    const parsed = parseCountsForKey(key);
    if (!parsed || parsed.layerId !== layerId || parsed.courseId !== courseId) return "invalid";
  }
  const next: Record<string, MarkValue> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (k !== key && parseCountsForKey(k)?.courseId === courseId) continue;
    next[k] = v;
  }
  if (key !== null) {
    if (!(key in next) && Object.keys(next).length >= MAX_COURSE_MARKS) return "cap";
    next[key] = "yes";
  }
  const keys = Object.keys(next);
  if (keys.length === Object.keys(cur).length && keys.every((k) => cur[k] === next[k])) return "same";
  return CourseMarksSchema.safeParse(next).success ? next : "invalid";
}

/** The layer a waiver names (spec 047 D10): `${layerId}:${rowId}`. An
 *  Engineering slot / group-id waiver names none (null). */
function waiverLayer(id: string): string | null {
  const colon = id.indexOf(":");
  if (colon <= 0) return null;
  const layerId = id.slice(0, colon);
  return LAYER_ID_RE.test(layerId) ? layerId : null;
}

/** The layer a course-mark key names (spec 047 D10): `countsFor:${layerId}@…`
 *  and row-scoped `${type}:${layerId}/${row}@…`. Credit marks
 *  (`creditsTaken:<course>`) and anything else name none (null). */
function markLayer(key: string): string | null {
  const countsFor = parseCountsForKey(key);
  if (countsFor) return countsFor.layerId;
  const at = key.indexOf("@");
  if (at <= 0) return null;
  const ref = parseRef(key.slice(0, at));
  return ref && "layerId" in ref ? ref.layerId : null;
}

/**
 * The waivers and course marks without orphans (spec 047 D10): entries that
 * name a layer not in `liveLayerIds`. Only entries that name a layer are
 * candidates (waiverLayer / markLayer). A layer counts as live when it IS a
 * live id or is `${liveId}--…` — a concentration of a live program (a major
 * layer's id is its program id), so a second major's unchosen concentration
 * keeps its waivers just like the primary's (whose concentrations all load).
 * An empty `liveLayerIds` prunes nothing (it would orphan the primary's own
 * entries). `removed` counts what was dropped; the same list/map when
 * nothing was. Pure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function withoutOrphans(
  s: Pick<PlanState, "waivedRequirementIds" | "courseMarks">,
  liveLayerIds: readonly string[]
): { waivedRequirementIds: string[]; courseMarks: Record<string, MarkValue>; removed: number } {
  if (liveLayerIds.length === 0) {
    return { waivedRequirementIds: s.waivedRequirementIds, courseMarks: s.courseMarks, removed: 0 };
  }
  const live = new Set(liveLayerIds);
  const isLive = (layerId: string) => {
    if (live.has(layerId)) return true;
    // Every "--" split, not only the first: LAYER_ID_RE allows "--" inside ids.
    for (let i = layerId.indexOf("--"); i > 0; i = layerId.indexOf("--", i + 1)) {
      if (live.has(layerId.slice(0, i))) return true;
    }
    return false;
  };
  const orphan = (layerId: string | null) => layerId !== null && !isLive(layerId);
  const waivers = s.waivedRequirementIds.filter((id) => !orphan(waiverLayer(id)));
  const marks: Record<string, MarkValue> = {};
  let droppedMarks = 0;
  for (const [k, v] of Object.entries(s.courseMarks)) {
    if (orphan(markLayer(k))) droppedMarks++;
    else marks[k] = v;
  }
  const droppedWaivers = s.waivedRequirementIds.length - waivers.length;
  return {
    waivedRequirementIds: droppedWaivers > 0 ? waivers : s.waivedRequirementIds,
    courseMarks: droppedMarks > 0 ? marks : s.courseMarks,
    removed: droppedWaivers + droppedMarks,
  };
}

/** A plan state's content fields for createPlan — plain data, no undefined
 *  (Firestore rejects undefined and fails the whole write). */
function createContent(s: PlanState) {
  const p = JSON.parse(JSON.stringify(toPayload(s))) as ReturnType<typeof toPayload>;
  return {
    placements: p.placements,
    courseSnapshots: p.courseSnapshots,
    completedIds: p.completedIds,
    inProgressIds: p.inProgressIds,
    waivedRequirementIds: p.waivedRequirementIds,
    courseMarks: p.courseMarks,
    triedCourseIds: p.triedCourseIds,
    // createPlan writes the field only when the list is non-empty.
    shortTerms: p.shortTerms,
    // Spec 047 D2: likewise (checked strictly against the plan's program).
    additionalPrograms: p.additionalPrograms,
  };
}

/** `s` with `kept`'s course marks, tried classes and extra programs (same ref
 *  when they already match). Laying a starting board or resetting replaces the
 *  board, not the student's answers (spec 020 D5: a mark outlives its course
 *  leaving the board), the classes they are trying (spec 028 D12: only untry /
 *  clear removes one) nor the programs on the plan (spec 047). */
function withMarks(
  s: PlanState,
  kept: Pick<PlanState, "courseMarks" | "triedCourseIds" | "additionalPrograms">
): PlanState {
  if (
    s.courseMarks === kept.courseMarks &&
    s.triedCourseIds === kept.triedCourseIds &&
    s.additionalPrograms === kept.additionalPrograms
  ) {
    return s;
  }
  return {
    ...s,
    courseMarks: kept.courseMarks,
    triedCourseIds: kept.triedCourseIds,
    additionalPrograms: kept.additionalPrograms,
  };
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { uid, profile, loading: authLoading, setActivePlanId, enteringYear } = useAuth();
  // Spec 047 D4: names the column in the "already in <term>" toast.
  const enteringYearRef = useRef(enteringYear);
  enteringYearRef.current = enteringYear;
  // Cross-listing aliases: a tried class placed under another code still
  // leaves the tried list (triedAfterPlacing). Read through a ref so the
  // mutations keep their identity when the catalog meta lands.
  const { aliases } = useCatalogContext();
  const aliasesRef = useRef(aliases);
  aliasesRef.current = aliases;
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs, getProgramData, loadProgramData } = useProgramContext();
  // Toast surface — the remove/undo affordance, the C4 program-switch summary,
  // the cap refusal and the failed-write notice. Zustand actions are stable.
  const showToast = usePlannerStore((s) => s.showToast);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>(EMPTY);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(false);
  const [plansList, setPlansList] = useState<PlanListItem[]>([]);
  // Bumped after create/delete to force the resolution effect to re-run.
  const [resolveKey, setResolveKey] = useState(0);
  // The program of the LOADED plan (fix pass P6) + a ref for sync reads.
  const [planProgramId, setPlanProgramId] = useState<string | null>(null);
  const planProgramIdRef = useRef<string | null>(null);
  const setLoadedProgram = useCallback((id: string | null) => {
    planProgramIdRef.current = id;
    setPlanProgramId(id);
  }, []);
  // Plans this session created (fix pass P2): an empty first load of one of
  // these gets the starting board (it was created empty because a carry-over
  // seed was pending or the template wasn't cached). Consumed on first load.
  const justCreatedRef = useRef<Set<string>>(new Set());
  // The Undo toast currently showing, if any — dismissed when the plan
  // changes so it can't restore into a different plan (fix pass P1).
  const undoToastKeyRef = useRef<number | null>(null);

  // Mirror of `state` for synchronous reads inside mutations (capturing what a
  // removal's undo needs, the cap check) without threading `state` through deps.
  const stateRef = useRef<PlanState>(EMPTY);
  // The last state the SERVER is known to hold (applied from a snapshot, or a
  // write that succeeded) — the rollback target for a failed write.
  const confirmedRef = useRef<PlanState>(EMPTY);
  // ── C4 cross-plan carry-over (spec 009 §4, per-program-plan architecture) ──
  // A real major switch swaps plan DOCUMENTS. At switch time we capture the
  // outgoing plan's state as the seed source; if the target program's plan
  // turns out MISSING/EMPTY, applyLoadedPlan seeds it.
  const pendingSeedRef = useRef<{
    toProgramId: string;
    fromProgramId: string;
    prevState: PlanState;
  } | null>(null);
  // The program the currently-loaded state belongs to (last resolved program).
  const lastProgramIdRef = useRef<string | null>(null);
  // Plan id we just seeded (carry-over or starting board): a stale EMPTY
  // snapshot (emitted before the seed's debounced write lands) must not wipe
  // the seeded optimistic state, and the board is laid down once per load.
  const seededPlanRef = useRef<string | null>(null);
  // Fresh view of the program list for the C4 summary (short name), read at
  // snapshot time without adding churn to applyLoadedPlan's deps.
  const programsRef = useRef(programs);
  useEffect(() => {
    programsRef.current = programs;
  }, [programs]);
  // Spec 047 D1: a program's college from the program list (null when the
  // list doesn't have it); two programs are "same college" only when both
  // are known and match.
  const collegeOf = useCallback(
    (programId: string): string | null =>
      programCollegeId(programsRef.current.find((p) => p.id === programId)),
    []
  );
  const sameCollege = useCallback(
    (a: string, b: string): boolean => {
      const college = collegeOf(a);
      return college !== null && college === collegeOf(b);
    },
    [collegeOf]
  );
  // A program's short display name for toasts ("Mathematics", "CS minor"):
  // the program list for a major, the minor index (if read) for a minor.
  const programLabel = useCallback((p: Pick<AdditionalProgram, "programId" | "kind">): string => {
    if (p.kind === "major") {
      const prog = programsRef.current.find((x) => x.id === p.programId);
      return prog?.short_name || prog?.name || "the second major";
    }
    return peekMinorIndex()?.find((e) => e.id === p.programId)?.shortName || "the minor";
  }, []);
  // Spec 047 D12 toasts: "the CS minor isn't open to Computer Science
  // majors" (notOpenTo; any major on the plan, the primary included), or
  // "the Exercise minor is only open to Nutritional Sciences majors"
  // (onlyOpenTo; no major on the plan is one of them).
  const closedSentence = useCallback((pair: ClosedMinorPair): string => {
    const minor = peekMinorIndex()?.find((e) => e.id === pair.minor.programId)?.shortName;
    const subject = minor ? `the ${minor}` : "that minor";
    if (pair.onlyOpenTo) return `${subject} is only open to ${onlyOpenToWho(pair.onlyOpenTo, programsRef.current)}`;
    const prog = programsRef.current.find((x) => x.id === pair.majorId);
    const major = prog?.short_name || prog?.name || "that major's";
    return `${subject} isn't open to ${major} majors`;
  }, []);
  // The program removal whose "Removed X · Undo" toast is showing (spec 047
  // D10): its layers' waivers and answers are not orphans while Undo can
  // still bring it back (pruneOrphans).
  const undoProgramRef = useRef<{ key: number | null; planId: string | null; programId: string } | null>(null);

  // Echo suppression: signature of our own last write; the snapshot matching it
  // is skipped.
  const lastWrittenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending (un-flushed) debounced write, captured so a plan switch / unmount can
  // flush it immediately instead of dropping the mutation.
  const pendingWriteRef = useRef<{
    uid: string;
    planId: string;
    state: PlanState;
    payload: ReturnType<typeof toPayload>;
    /** The plan's primary program, for the strict additional-programs check. */
    programId: string | null;
  } | null>(null);
  const planIdRef = useRef<string | null>(null);
  const uidRef = useRef<string | null>(null);
  // Guard so we only auto-create one plan per (uid, program) resolution pass.
  const creatingRef = useRef(false);
  // The account whose saved major was already restored this session (below).
  const restoredForUidRef = useRef<string | null>(null);
  // Board edits made before the active plan's first snapshot is applied
  // (U-13): right after first run the plan is still being created (no plan id
  // yet), and on any load the first snapshot is in flight. Such an edit shows
  // at once but has no loaded plan under it, so it is held here — not written
  // (the write would replace the doc with a board built on nothing) — and
  // replayed onto the plan when it loads. loadedPlanRef = the plan whose first
  // snapshot has been applied.
  const earlyEditsRef = useRef<((s: PlanState) => PlanState)[]>([]);
  const loadedPlanRef = useRef<string | null>(null);

  useEffect(() => {
    planIdRef.current = planId;
  }, [planId]);
  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Resolve which plan is active for the selected program ──────────────────
  // Order: profile.activePlanId (if it's for this program) → an existing plan for
  // this program → auto-create (name = program shortName). Runs when uid/profile/
  // selectedProgramId settle.
  useEffect(() => {
    if (authLoading || !uid || !profile) return;
    if (!selectedProgramId || selectedProgramId.startsWith("custom-")) {
      // No real program selected — clear the active plan view (and any pending
      // carry-over: with the state cleared there is no source to seed from).
      setPlanId(null);
      setState(EMPTY);
      setLoadedProgram(null);
      lastProgramIdRef.current = null;
      pendingSeedRef.current = null;
      earlyEditsRef.current = [];
      // The selection lives in local storage, which is per site: a student on
      // a new device or browser, or a new address (cucoursemap.app), has none
      // even though their account has plans. Bring the major back from the
      // account (its active plan) instead of showing first run. Once per
      // account per session, so it never overrides a choice made here.
      if (!selectedProgramId && restoredForUidRef.current !== uid) {
        restoredForUidRef.current = uid;
        const activePlanId = profile.activePlanId;
        listPlans(uid)
          .then((existing) => {
            const restore = programToRestore(activePlanId, existing);
            const store = useProgramStore.getState();
            if (restore && !store.selectedProgramId) store.setSelectedProgramId(restore);
          })
          .catch((err) => console.warn("[plan] restoring the saved major failed", err));
      }
      return;
    }
    // C4 cross-plan carry-over capture (spec 009 §4): on a REAL program switch,
    // grab the outgoing plan's state NOW — synchronously, before the plan
    // subscription swaps docs and clears it. Consumed by applyLoadedPlan only
    // if the target program's plan turns out missing/empty; a re-run of this
    // effect for the SAME program captures nothing and leaves a pending seed.
    if (lastProgramIdRef.current && lastProgramIdRef.current !== selectedProgramId) {
      pendingSeedRef.current = {
        toProgramId: selectedProgramId,
        fromProgramId: lastProgramIdRef.current,
        prevState: stateRef.current,
      };
    }
    lastProgramIdRef.current = selectedProgramId;

    let cancelled = false;
    (async () => {
      try {
        const existing = await listPlans(uid);
        if (cancelled) return;
        setPlansList(existing);

        // The starting board / a pending seed need the TARGET program's slots
        // cached before the plan snapshot arrives (applyLoadedPlan reads the
        // cache synchronously). Await it so seeding can't miss its window.
        await loadProgramData(selectedProgramId).catch(() => null);
        if (cancelled) return;

        // Prefer the profile's active plan if it targets this program.
        const active = profile.activePlanId
          ? existing.find(
              (p) => p.id === profile.activePlanId && p.programId === selectedProgramId
            )
          : undefined;
        const forProgram =
          active ?? existing.find((p) => p.programId === selectedProgramId);

        if (forProgram) {
          setPlanId(forProgram.id);
          if (profile.activePlanId !== forProgram.id) {
            await setActivePlanId(forProgram.id);
          }
          return;
        }

        // Auto-create needs the program list (for the shortName). If it hasn't
        // loaded yet, bail this pass — the effect re-runs when `programs`
        // populates. Serialize creates with creatingRef so a StrictMode
        // double-invoke or a fast re-render can't create two plans at once.
        const prog = programs.find((p) => p.id === selectedProgramId);
        if (!prog) return;
        if (creatingRef.current) return;
        creatingRef.current = true;

        const name = prog.short_name || prog.name || "My Plan";
        const newId = crypto.randomUUID();
        // The starting board rides in the create itself (fix pass P2) — unless
        // a C4 carry-over is pending for this program: the seed needs an EMPTY
        // doc and lays the starting board itself. Created empty → marked
        // just-created so the first load still lays the board.
        const seedPending = pendingSeedRef.current?.toProgramId === selectedProgramId;
        const start = seedPending ? null : startingStateFor(selectedProgramId);
        justCreatedRef.current.add(newId);
        // Suppress the create's echo (initial empty doc).
        lastWrittenRef.current = EMPTY_SIGNATURE;
        try {
          await createPlan(uid, newId, {
            name,
            programId: selectedProgramId,
            ...(start ? createContent(start) : {}),
          });
          if (cancelled) return;
          setPlanId(newId);
          await setActivePlanId(newId);
        } finally {
          creatingRef.current = false;
        }
      } catch (err) {
        console.warn("[plan] resolve/auto-create failed", err);
        if (!cancelled) setPlanError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // profile.activePlanId intentionally excluded — we write it ourselves and
    // don't want that write to retrigger resolution. uid + program are the keys;
    // resolveKey forces a pass after create/delete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authLoading, selectedProgramId, programs, resolveKey]);

  // ── Subscribe to the active plan doc ───────────────────────────────────────
  useEffect(() => {
    // The plan changed: an Undo toast from the previous plan must not linger
    // (its action is also guarded on the plan id — fix pass P1).
    const toast = usePlannerStore.getState().toast;
    if (undoToastKeyRef.current !== null && toast?.key === undoToastKeyRef.current) {
      usePlannerStore.getState().dismissToast();
    }
    undoToastKeyRef.current = null;

    if (!uid || !planId) return;
    setPlanLoading(true);
    setPlanError(false);
    // New plan focus: clear the previous plan's state + echo signature so its
    // data can't bleed into this plan's view (the first snapshot repopulates).
    // Edits made while no plan was attached stay on screen until that
    // snapshot replays them onto the plan (U-13).
    const early = earlyEditsRef.current.reduce((s, edit) => edit(s), EMPTY);
    setState(early);
    stateRef.current = early;
    confirmedRef.current = EMPTY;
    loadedPlanRef.current = null;
    setLoadedProgram(null);
    setPlanName(null);
    lastWrittenRef.current = null;
    // A fresh load of this plan may seed again (the post-seed guard below is
    // per subscription, not per session).
    seededPlanRef.current = null;

    const unsub = subscribePlan(uid, planId, ({ plan, error }) => {
      setPlanLoading(false);
      if (error) {
        setPlanError(true);
        return;
      }
      if (!plan) {
        // Doc doesn't exist yet (create in flight) — keep current optimistic view.
        return;
      }
      // Name updates apply even on echo-suppressed / post-seed snapshots
      // (renames write outside the debounced payload).
      setPlanName(plan.name || null);

      // Pending-write guard (fix pass P3): local edits are still debouncing
      // for this plan; that write carries the full local state and wins.
      if (shouldSkipSnapshot(pendingWriteRef.current?.planId, planId)) {
        return;
      }

      // Post-seed guard: after seeding this plan (carry-over or starting
      // board), a stale EMPTY snapshot — emitted before the seed's debounced
      // write lands — must not wipe the seeded optimistic view.
      if (seededPlanRef.current === planId && planContentIsEmpty(plan)) {
        return;
      }

      // Echo suppression: ignore the snapshot that round-trips our own write.
      const sig = planSignature(plan);
      if (lastWrittenRef.current !== null && sig === lastWrittenRef.current) {
        return;
      }

      applyLoadedPlan(plan);
    });

    return () => {
      // Flush (not drop) any pending write for the plan we're leaving BEFORE
      // detaching the listener, so a fast switch can't lose a mutation.
      flushPendingWrite();
      unsub();
      // Edits held for a plan that never loaded belong to it, not the next.
      earlyEditsRef.current = [];
    };
    // applyLoadedPlan + flushPendingWrite are stable useCallbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, planId]);

  // ── Debounced write-through ────────────────────────────────────────────────
  // Flush the pending write NOW (used by the debounce timer and on plan switch /
  // unmount so an in-flight mutation is never dropped).
  const flushPendingWrite = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingWriteRef.current;
    if (!pending) return;
    pendingWriteRef.current = null;
    // Defensive strip: Firestore rejects ANY undefined value in a payload and
    // fails the whole write. JSON round-trip drops undefined fields (the
    // payload is plain data — no timestamps/sentinels at this layer).
    const payload = JSON.parse(JSON.stringify(pending.payload)) as UpdatePlanPatch &
      ReturnType<typeof toPayload>;
    // Record the signature so the resulting snapshot is echo-suppressed.
    lastWrittenRef.current = planSignature(payload);
    updatePlan(pending.uid, pending.planId, payload, {
      ...(pending.programId ? { primaryProgramId: pending.programId } : {}),
    })
      .then(() => {
        if (planIdRef.current === pending.planId) confirmedRef.current = pending.state;
      })
      .catch((err) => {
        console.warn("[plan] write failed", err);
        // Never a silent rollback: restore what the server holds AND say so.
        if (planIdRef.current === pending.planId) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = null;
          pendingWriteRef.current = null;
          lastWrittenRef.current = null;
          const back = confirmedRef.current;
          stateRef.current = back;
          setState(back);
        }
        usePlannerStore.getState().showToast(FAILED_WRITE_TOAST);
      });
  }, []);

  const scheduleWrite = useCallback(
    (next: PlanState) => {
      const uidNow = uidRef.current;
      const planIdNow = planIdRef.current;
      if (!uidNow || !planIdNow) return;

      pendingWriteRef.current = {
        uid: uidNow,
        planId: planIdNow,
        state: next,
        payload: toPayload(next),
        programId: planProgramIdRef.current,
      };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushPendingWrite, DEBOUNCE_MS);
    },
    [flushPendingWrite]
  );

  // Flush a pending write when the page is being hidden or unloaded (fix pass
  // P4): an edit made within the 600ms debounce of a reload / tab close was
  // lost silently. Best effort — the SDK queues the write immediately.
  useEffect(() => {
    const onPageHide = () => flushPendingWrite();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPendingWrite();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushPendingWrite]);

  /** The starting board (spec 014 §D6) for a program, or null if its template
   *  isn't cached yet. */
  const startingStateFor = useCallback(
    (programId: string): PlanState | null => {
      const data = getProgramData(programId);
      if (!data) return null;
      return pruneCourses({
        ...EMPTY,
        placements: startingPlacements(data.slots),
        placedCourses: templateCourses(data.slots),
      });
    },
    [getProgramData]
  );

  /** Lay the starting board down on an EMPTY loaded plan (a legacy doc or one
   *  just created empty — see shouldLayStartingBoard), once per load. With
   *  `upgradeLegacy`, a program with nothing fixed to place still gets ONE
   *  empty new-shape write, so the legacy doc drops its retired slot-model
   *  fields and keeps passing the rules after the CONTRACT step (fix pass P7 —
   *  only content writes delete them, so a later rename would fail). */
  const layStartingBoard = useCallback(
    (programId: string, forPlanId: string, upgradeLegacy: boolean) => {
      const apply = () => {
        if (planIdRef.current !== forPlanId) return; // switched away meanwhile
        if (seededPlanRef.current === forPlanId) return; // already laid down
        // Student acted first — their own write upgrades the doc.
        if (!planContentIsEmpty(stateRef.current)) return;
        const start = startingStateFor(programId);
        if (!start || start.placements.length === 0) {
          // Nothing fixed to place (or the template couldn't load).
          if (upgradeLegacy) scheduleWrite(stateRef.current);
          return;
        }
        // Short-term columns the student added before the board was laid
        // (spec 042 D4) stay with it, like their marks.
        const cur = stateRef.current;
        const marked = withMarks(start, cur);
        const next =
          cur.shortTerms.length > 0 ? { ...marked, shortTerms: cur.shortTerms } : marked;
        seededPlanRef.current = forPlanId;
        stateRef.current = next;
        setState(next);
        scheduleWrite(next);
      };
      if (getProgramData(programId)) apply();
      else
        loadProgramData(programId).then(
          () => apply(),
          () => apply()
        );
    },
    [getProgramData, loadProgramData, startingStateFor, scheduleWrite]
  );

  // Project a loaded plan into state; seed it when it's empty (carry-over from
  // the previous major first, else the program's starting board).
  const applyLoadedPlan = useCallback(
    (plan: LoadedPlan) => {
      const forPlanId = planIdRef.current;
      // The board now shows THIS plan's program (fix pass P6).
      setLoadedProgram(plan.programId || null);
      // Loaded from here on: edits write through. Edits made before it loaded
      // are replayed onto what the board shows (U-13); none on later loads.
      loadedPlanRef.current = forPlanId;
      const early = earlyEditsRef.current;
      earlyEditsRef.current = [];
      const replayEarly = (s: PlanState) => early.reduce((acc, edit) => edit(acc), s);
      // A plan this session just created is "new" only on its first load.
      const justCreated = forPlanId ? justCreatedRef.current.delete(forPlanId) : false;

      // ── C4 cross-plan seeding (spec 009 §4): a major switch lands on the new
      //    program's OWN plan doc. If that plan is MISSING/EMPTY and a
      //    carry-over seed is pending, its initial state is the previous
      //    plan's placements plus the new program's starting board. Consumed
      //    at most once per switch; a NON-empty plan loads untouched (the
      //    user's prior work on that major). The OLD doc is never modified. ──
      const pendingSeed = pendingSeedRef.current;
      if (pendingSeed && pendingSeed.toProgramId === plan.programId) {
        pendingSeedRef.current = null;
        const target = getProgramData(plan.programId);
        if (planContentIsEmpty(plan) && target && forPlanId) {
          const prev = pendingSeed.prevState;
          const seed = seedPlanFromPrevious(
            {
              placements: prev.placements,
              placedCourses: prev.placedCourses,
              completedIds: prev.completedIds,
              inProgressIds: prev.inProgressIds,
              courseMarks: prev.courseMarks,
              triedCourseIds: prev.triedCourseIds,
              shortTerms: prev.shortTerms,
              additionalPrograms: prev.additionalPrograms,
            },
            target.slots.map(toRemapTarget),
            startingPlacements(target.slots),
            {
              // carryMark: the default (college-layer and credit marks); see
              // seedPlanFromPrevious defaultCarryMark.
              // Spec 047 D13: the extra programs carry, minus the new major
              // itself and a second major outside its college (D1).
              primaryProgramId: plan.programId,
              // D15: nor a pair Cornell forbids (ISST with CS or ORE).
              keepProgram: (p) =>
                p.kind === "minor" ||
                (sameCollege(p.programId, plan.programId) &&
                  engineeringForbiddenReason(p.programId, plan.programId) === null),
            }
          );
          if (seed) {
            const fromTemplate = templateCourses(target.slots);
            const placedCourses: Record<string, Course> = {};
            for (const cid of seed.courseIds) {
              const c = prev.placedCourses[cid] ?? fromTemplate[cid];
              placedCourses[cid] = c ?? snapshotToCourse(cid, null);
            }
            // Marks the new program asks too (spec 020 D5); any the target
            // plan already holds win, and the total stays under the cap. A
            // failed save rolls back to what the server holds: an empty board
            // with the target plan's own marks.
            const { next: seeded, confirmed } = seedStates(
              {
                placements: seed.placements,
                placedCourses,
                completedIds: seed.completedIds,
                inProgressIds: seed.inProgressIds,
                waivedRequirementIds: [], // waivers are the OLD program's requirement ids
              },
              seed.courseMarks,
              plan.courseMarks,
              seed.triedCourseIds,
              plan.triedCourseIds,
              // Spec 042 D12: the previous plan's added short-term columns
              // (and the column of every carried short-term class) come
              // along, after the target plan's own.
              seed.shortTerms,
              plan.shortTerms,
              additionalProgramsOf(plan),
              seed.additionalPrograms,
              plan.programId
            );
            // D12/D13: a carried minor Cornell closes to the new major or the
            // carried second major leaves (the target plan's own stay). Only
            // known once the session read the minor index; until then it is
            // carried and the programs panel warns.
            const ownIds = new Set(additionalProgramsOf(plan).map((p) => p.programId));
            const closed = withoutClosedMinors(
              seeded.additionalPrograms,
              plan.programId,
              peekMinorIndex(),
              (id) => !ownIds.has(id)
            );
            const next =
              closed.dropped.length > 0 ? { ...seeded, additionalPrograms: closed.programs } : seeded;
            confirmedRef.current = confirmed;
            seededPlanRef.current = forPlanId;
            const shown = replayEarly(next);
            stateRef.current = shown;
            setState(shown);
            // Persist through the NORMAL debounced save — planIdRef already
            // points at the NEW plan doc, so only that doc is written.
            scheduleWrite(shown);
            const shortName =
              programsRef.current.find((p) => p.id === plan.programId)?.short_name ??
              "the new major";
            // Nothing from the old board (only its tried classes / marks
            // came along): no "Kept your courses" sentence.
            let kept = "";
            if (seed.kept > 0) {
              const keptPhrase =
                seed.kept === 1 ? "Kept your course" : `Kept your ${seed.kept} courses`;
              kept =
                seed.matched > 0
                  ? `${keptPhrase} — ${seed.matched} count toward ${shortName} requirements`
                  : `${keptPhrase} on your new board`;
            }
            // Never silent: each minor left behind says why.
            const removedMinors = closed.dropped
              .map((pair) => `${closedSentence(pair)}, so it was removed`)
              .join("; ");
            const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
            const body = kept && removedMinors
              ? `${kept}; ${removedMinors}.`
              : kept || (removedMinors ? `${capital(removedMinors)}.` : "");
            // The new major was the second major (it leaves the extra list,
            // and the old primary isn't carried): say so.
            const wasSecond = prev.additionalPrograms.some(
              (p) => p.kind === "major" && p.programId === plan.programId
            );
            const promoted = wasSecond ? `${shortName} is now your major; it was your second major.` : "";
            const message = [promoted, body].filter(Boolean).join(" ");
            if (message) showToast(message);
            return;
          }
        }
        // Switching to a major whose plan already holds work loads it
        // untouched (above). Say which courses from the previous board aren't
        // on it — they stay in the previous major's plan (U-8).
        if (!planContentIsEmpty(plan)) {
          const prev = pendingSeed.prevState;
          const left = coursesLeftBehind(prev, plan);
          const codes = left.map((cid) => {
            const c = prev.placedCourses[cid];
            return c ? `${c.subject} ${c.number}` : cid.replace(/-/g, " ");
          });
          const fromName =
            programsRef.current.find((p) => p.id === pendingSeed.fromProgramId)?.short_name ??
            "previous major's";
          const message = leftBehindMessage(codes, fromName);
          if (message) showToast(message);
        }
      }

      const placedCourses: Record<string, Course> = {};
      for (const p of plan.placements) {
        if (!placedCourses[p.courseId]) {
          placedCourses[p.courseId] = snapshotToCourse(p.courseId, plan.courseSnapshots[p.courseId]);
        }
      }
      const next: PlanState = {
        placements: plan.placements,
        placedCourses,
        completedIds: plan.completedIds,
        inProgressIds: plan.inProgressIds,
        waivedRequirementIds: plan.waivedRequirementIds,
        courseMarks: plan.courseMarks,
        triedCourseIds: plan.triedCourseIds,
        shortTerms: plan.shortTerms,
        additionalPrograms: additionalProgramsOf(plan),
      };
      confirmedRef.current = next;
      const shown = replayEarly(next);
      stateRef.current = shown;
      setState(shown);
      if (shown !== next) scheduleWrite(shown);

      // Starting board (spec 014 §D5/§D6) only for a legacy doc (read as
      // empty) or a plan just created empty — never for a plan the student
      // emptied on purpose (fix pass P2). A legacy doc is upgraded in place
      // even when nothing gets laid (fix pass P7).
      if (forPlanId && shouldLayStartingBoard(plan, justCreated)) {
        layStartingBoard(plan.programId, forPlanId, plan.legacy);
      }
    },
    [getProgramData, showToast, scheduleWrite, layStartingBoard, setLoadedProgram, sameCollege, closedSentence]
  );

  // ── Mutations (optimistic state + debounced write) ─────────────────────────
  const commit = useCallback(
    (updater: (s: PlanState) => PlanState) => {
      const prev = stateRef.current;
      const next = updater(prev);
      if (next === prev) return;
      stateRef.current = next;
      setState(next);
      // No loaded plan under this edit yet: hold it for the replay (U-13).
      if (!planIdRef.current || loadedPlanRef.current !== planIdRef.current) {
        earlyEditsRef.current.push(updater);
        return;
      }
      scheduleWrite(next);
    },
    [scheduleWrite]
  );

  const addPlacement = useCallback(
    (course: Course, target: number | ColumnRef, index?: number): string | null => {
      if (stateRef.current.placements.length >= MAX_PLACEMENTS) {
        showToast(
          `Your board holds up to ${MAX_PLACEMENTS} courses — remove one to add ${course.subject} ${course.number}.`
        );
        return null;
      }
      const id = crypto.randomUUID();
      const aliasMap = aliasesRef.current;
      const canonical = (cid: string) => aliasMap[cid] ?? cid;
      // Spec 047 D4: never the same class twice in one column (a retake in
      // another term stays allowed). Checked here for the toast and again in
      // the commit, which may replay onto a newer state.
      if (columnHasCourse(stateRef.current.placements, course.id, target, canonical)) {
        showToast(alreadyInColumnMessage(`${course.subject} ${course.number}`, target, enteringYearRef.current));
        return null;
      }
      commit((s) => {
        if (columnHasCourse(s.placements, course.id, target, canonical)) return s;
        const placements = insertPlacement(s.placements, { id, courseId: course.id }, target, index);
        if (placements === s.placements) return s;
        // A tried class placed by any path stops being tried, in the same
        // save as the placement (spec 028 D12, audit F2). A class placed
        // into a short term keeps that column listed (spec 042 D4).
        return {
          ...s,
          placements,
          placedCourses: { ...s.placedCourses, [course.id]: course },
          triedCourseIds: triedAfterPlacing(s.triedCourseIds, course.id, canonical),
          shortTerms: shortTermsWithPlacement(s.shortTerms, placements, id),
        };
      });
      return id;
    },
    [commit, showToast]
  );

  const movePlacement = useCallback(
    (id: string, target: number | ColumnRef, index: number) => {
      const aliasMap = aliasesRef.current;
      const canonical = (cid: string) => aliasMap[cid] ?? cid;
      // Spec 047 D4: a move INTO another column that already holds the same
      // class is refused (the card stays where it was). A reorder within its
      // own column is never refused, even on a board saved before the rule.
      const intoDuplicate = (s: PlanState): Placement | null => {
        const mover = s.placements.find((p) => p.id === id);
        if (!mover || sameColumn(refOf(mover), toColumnRef(target))) return null;
        return columnHasCourse(s.placements, mover.courseId, target, canonical, id) ? mover : null;
      };
      const blocked = intoDuplicate(stateRef.current);
      if (blocked) {
        const c = stateRef.current.placedCourses[blocked.courseId];
        const code = c ? `${c.subject} ${c.number}` : blocked.courseId.replace(/-/g, " ");
        showToast(alreadyInColumnMessage(code, target, enteringYearRef.current));
        return;
      }
      commit((s) => {
        if (intoDuplicate(s)) return s;
        const placements = movePlacementTo(s.placements, id, target, index);
        if (placements === s.placements) return s;
        return {
          ...s,
          placements,
          shortTerms: shortTermsWithPlacement(s.shortTerms, placements, id),
        };
      });
    },
    [commit, showToast]
  );

  // Short-term columns (spec 042 D2/D4/D7). Checked against the current
  // state for the return value, and re-checked against the state the commit
  // applies to (an edit held before the first snapshot replays onto the
  // loaded plan — U-13).
  const addShortTerm = useCallback(
    (sem: number): boolean => {
      if (!Array.isArray(nextShortTerms(stateRef.current.shortTerms, sem))) return false;
      commit((s) => {
        const applied = nextShortTerms(s.shortTerms, sem);
        return Array.isArray(applied) ? { ...s, shortTerms: applied } : s;
      });
      return true;
    },
    [commit]
  );

  const removeShortTerm = useCallback(
    (sem: number): boolean => {
      if (!Array.isArray(shortTermsAfterRemoving(stateRef.current, sem))) return false;
      commit((s) => {
        const applied = shortTermsAfterRemoving(s, sem);
        return Array.isArray(applied) ? { ...s, shortTerms: applied } : s;
      });
      return true;
    },
    [commit]
  );

  const removePlacement = useCallback(
    (id: string) => {
      // Capture everything the undo needs BEFORE mutating (spec 014 §D8): the
      // exact placement (id, column, position), its course, its mark — and the
      // plan it was removed from (fix pass P1).
      const prev = stateRef.current;
      const placement = prev.placements.find((p) => p.id === id);
      if (!placement) return;
      const removed: RemovedPlacement = {
        planId: planIdRef.current,
        placement,
        course: prev.placedCourses[placement.courseId] ?? null,
        wasCompleted: prev.completedIds.includes(id),
        wasInProgress: prev.inProgressIds.includes(id),
      };

      commit((s) =>
        pruneCourses({
          ...s,
          placements: removePlacementById(s.placements, id),
          completedIds: s.completedIds.filter((x) => x !== id),
          inProgressIds: s.inProgressIds.filter((x) => x !== id),
        })
      );

      const course = removed.course;
      const code = course ? `${course.subject} ${course.number}` : placement.courseId.replace(/-/g, " ");
      showToast(`Removed ${code} from your board`, {
        actionLabel: "Undo",
        onAction: () => {
          // "other-plan": the plan changed since the removal — never restore into
          // a different plan (fix pass P1; the toast is also dismissed on change).
          const aliasMap = aliasesRef.current;
          const result = restoreRemovedPlacement(
            stateRef.current,
            removed,
            planIdRef.current,
            (cid) => aliasMap[cid] ?? cid
          );
          if (result === "other-plan") return;
          if (result === "duplicate") {
            // Spec 047 D4: the column got the same class back meanwhile.
            showToast(
              alreadyInColumnMessage(
                code,
                { sem: placement.sem, shortTerm: placement.shortTerm === true },
                enteringYearRef.current
              )
            );
            return;
          }
          if (result === "cap") {
            // Never a silent no-op (fix pass P5).
            showToast(
              `Your board holds up to ${MAX_PLACEMENTS} courses — remove one to restore ${code}.`
            );
            return;
          }
          commit(() => result);
        },
      });
      undoToastKeyRef.current = usePlannerStore.getState().toast?.key ?? null;
    },
    [commit, showToast]
  );

  // One placement lives in at most one manual state (spec 006 §B.1). Turning
  // one ON clears the other; turning OFF just removes it. Unknown ids no-op.
  const toggleCompleted = useCallback(
    (id: string) => {
      commit((s) => {
        if (!s.placements.some((p) => p.id === id)) return s;
        const on = !s.completedIds.includes(id);
        return {
          ...s,
          completedIds: on ? [...s.completedIds, id] : s.completedIds.filter((x) => x !== id),
          inProgressIds: s.inProgressIds.filter((x) => x !== id),
        };
      });
    },
    [commit]
  );

  const toggleInProgress = useCallback(
    (id: string) => {
      commit((s) => {
        if (!s.placements.some((p) => p.id === id)) return s;
        const on = !s.inProgressIds.includes(id);
        return {
          ...s,
          inProgressIds: on ? [...s.inProgressIds, id] : s.inProgressIds.filter((x) => x !== id),
          completedIds: s.completedIds.filter((x) => x !== id),
        };
      });
    },
    [commit]
  );

  const toggleWaivedRequirement = useCallback(
    (requirementId: string) => {
      const cur = stateRef.current.waivedRequirementIds;
      if (!cur.includes(requirementId) && cur.length >= MAX_WAIVERS) {
        showToast(`You can waive up to ${MAX_WAIVERS} requirements.`);
        return;
      }
      commit((s) => ({
        ...s,
        waivedRequirementIds: s.waivedRequirementIds.includes(requirementId)
          ? s.waivedRequirementIds.filter((x) => x !== requirementId)
          : [...s.waivedRequirementIds, requirementId],
      }));
    },
    [commit, showToast]
  );

  const setCourseMark = useCallback(
    (key: string, value: MarkValue | null) => {
      const next = nextCourseMarks(stateRef.current.courseMarks, key, value);
      if (next === "same") return;
      if (next === "cap") {
        showToast(`A plan holds up to ${MAX_COURSE_MARKS} course answers — clear one to add another.`);
        return;
      }
      if (next === "invalid") {
        console.warn("[plan] refused a malformed course mark", key, value);
        showToast("Couldn't save that answer.");
        return;
      }
      commit((s) => ({ ...s, courseMarks: next }));
    },
    [commit, showToast]
  );

  const tryCourse = useCallback(
    (courseId: string): boolean => {
      const next = nextTriedCourses(stateRef.current.triedCourseIds, courseId);
      if (!Array.isArray(next)) return false;
      // Re-checked against the state the commit actually applies to.
      commit((s) => {
        const applied = nextTriedCourses(s.triedCourseIds, courseId);
        return Array.isArray(applied) ? { ...s, triedCourseIds: applied } : s;
      });
      return true;
    },
    [commit]
  );

  const untryCourse = useCallback(
    (courseId: string) => {
      commit((s) =>
        s.triedCourseIds.includes(courseId)
          ? { ...s, triedCourseIds: s.triedCourseIds.filter((x) => x !== courseId) }
          : s
      );
    },
    [commit]
  );

  const clearTried = useCallback(() => {
    commit((s) => (s.triedCourseIds.length === 0 ? s : { ...s, triedCourseIds: [] }));
  }, [commit]);

  const resetPlan = useCallback(() => {
    // The LOADED plan's program (fix pass P6) — during a slow major switch the
    // old plan is still on screen and must reset to ITS board, not the newly
    // selected program's. Falls back to the selection when nothing is loaded.
    const pid = planProgramIdRef.current ?? useProgramStore.getState().selectedProgramId;
    const forPlanId = planIdRef.current;
    const start = pid ? startingStateFor(pid) : null;
    // A reset clears the board, completions and waivers; course marks stay
    // (hidden until their course is back, spec 020 D5), and so do tried
    // classes (spec 028 D12).
    commit((s) => withMarks(start ?? { ...EMPTY }, s));
    if (pid && !start) {
      // Template not cached yet — lay the starting board down once it is.
      loadProgramData(pid)
        .then(() => {
          if (planIdRef.current !== forPlanId) return; // switched away meanwhile
          const late = startingStateFor(pid);
          if (late && planContentIsEmpty(stateRef.current)) {
            commit((s) => withMarks(late, s));
          }
        })
        .catch(() => {});
    }
  }, [commit, startingStateFor, loadProgramData]);

  // ── Plan switcher (spec 005 §6): multiple plans per program ────────────────
  const switchPlan = useCallback(
    async (targetPlanId: string, targetProgramId: string) => {
      flushPendingWrite(); // never drop an in-flight mutation on switch
      await setActivePlanId(targetPlanId);
      const store = useProgramStore.getState();
      if (store.selectedProgramId !== targetProgramId) {
        // Program change re-runs resolution, which now prefers activePlanId.
        store.setSelectedProgramId(targetProgramId);
      } else {
        setPlanId(targetPlanId); // same program — subscribe directly
      }
    },
    [flushPendingWrite, setActivePlanId]
  );

  const createNewPlan = useCallback(
    async (programId: string, name: string) => {
      const uidNow = uidRef.current;
      if (!uidNow) return;
      flushPendingWrite();
      const newId = crypto.randomUUID();
      lastWrittenRef.current = null;
      // A new plan for the CURRENT program is created with its starting board
      // (fix pass P2). For another program it is created empty: the switch may
      // carry the current courses over (C4), which needs an empty doc; the
      // just-created mark lays the starting board on load otherwise.
      const sameProgram = useProgramStore.getState().selectedProgramId === programId;
      if (sameProgram) await loadProgramData(programId).catch(() => null);
      const start = sameProgram ? startingStateFor(programId) : null;
      // Spec 047 D13: a what-if for the plan's own program keeps its second
      // major and minors (the point of a what-if is to vary from here).
      // Another program's plan gets them through the C4 seed instead.
      const programsNow =
        planProgramIdRef.current === programId
          ? mergeSeedPrograms([], stateRef.current.additionalPrograms, programId)
          : [];
      justCreatedRef.current.add(newId);
      await createPlan(uidNow, newId, {
        name: name.trim().slice(0, 80) || "My Plan",
        programId,
        ...(start ? createContent(start) : {}),
        ...(programsNow.length > 0 ? { additionalPrograms: programsNow } : {}),
      });
      setPlansList((l) => [...l, { id: newId, name, programId }]);
      await switchPlan(newId, programId);
      setResolveKey((k) => k + 1);
    },
    [flushPendingWrite, switchPlan, loadProgramData, startingStateFor]
  );

  const deletePlan = useCallback(
    async (targetPlanId: string) => {
      const uidNow = uidRef.current;
      if (!uidNow) return;
      if (targetPlanId === planIdRef.current) {
        // Leaving the doc we're subscribed to: drop the pending write for it.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        pendingWriteRef.current = null;
        setPlanId(null);
      }
      await deletePlanDoc(uidNow, targetPlanId);
      setPlansList((l) => l.filter((p) => p.id !== targetPlanId));
      setResolveKey((k) => k + 1); // re-resolve (next plan or auto-create)
    },
    []
  );

  const renamePlan = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 80);
      if (!trimmed) return;
      const uidNow = uidRef.current;
      const planIdNow = planIdRef.current;
      if (!uidNow || !planIdNow) return;
      const previousName = planName;
      setPlanName(trimmed); // optimistic
      setPlansList((l) => l.map((p) => (p.id === planIdNow ? { ...p, name: trimmed } : p)));
      updatePlan(uidNow, planIdNow, { name: trimmed }).catch((err) => {
        console.warn("[plan] rename failed", err);
        // Roll back AND say so (never a silent rollback).
        if (planIdRef.current === planIdNow) setPlanName(previousName);
        setPlansList((l) =>
          l.map((p) => (p.id === planIdNow ? { ...p, name: previousName ?? p.name } : p))
        );
        showToast("Couldn't rename your plan — check your connection and try again.");
      });
    },
    [planName, showToast]
  );

  // -- Spec 047 extra programs (second major, minors) --
  // Each is checked against the current state for its answer / toast and
  // re-checked against the state the commit applies to (an edit held before
  // the first snapshot replays onto the loaded plan — U-13).
  const addProgram = useCallback(
    (p: AdditionalProgram): AddProgramResult => {
      const primary = planProgramIdRef.current ?? useProgramStore.getState().selectedProgramId;
      const next = programsAfterAdding(stateRef.current.additionalPrograms, p, primary, collegeOf);
      if (!Array.isArray(next)) {
        const label = p && typeof p.programId === "string" ? programLabel(p) : "that program";
        const upper = label.charAt(0).toUpperCase() + label.slice(1);
        if (next === "duplicate") showToast(`${upper} is already on this plan.`);
        else if (next === "primary") showToast(`${upper} is already this plan's major.`);
        else if (next === "cap") {
          showToast(
            p.kind === "major"
              ? "A plan holds one second major — remove it to add another."
              : `A plan holds up to ${MAX_MINORS} minors — remove one to add another.`
          );
        } else if (p?.kind === "major" && primary && AdditionalProgramSchema.safeParse(p).success) {
          showToast("A second major has to be in the same college as your major.");
        } else {
          console.warn("[plan] refused a malformed program", p);
          showToast("Couldn't add that program.");
        }
        return next;
      }
      // D15: never a second major Cornell won't pair with the primary.
      const forbidden = forbiddenSecondMajor(next, primary);
      if (forbidden) {
        showToast(`Can't add ${programLabel(p)} as a second major: ${forbidden.reason}`);
        return "invalid";
      }
      // D12: never pair a minor with a major Cornell closes it to (a CS
      // second major beside the CS minor, or the reverse). Only known once
      // the session read the minor index; until then the panel warns.
      const closedNow = (list: readonly AdditionalProgram[]) =>
        closedMinorPair(list, primary, peekMinorIndex(), canonicalProgramId(p.programId));
      const closed = closedNow(next);
      if (closed) {
        const sentence = closedSentence(closed);
        showToast(
          closed.minor.programId === canonicalProgramId(p.programId)
            ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
            : `Can't add ${programLabel(p)}: ${sentence}. Remove the minor first.`
        );
        return "invalid";
      }
      commit((s) => {
        const applied = programsAfterAdding(s.additionalPrograms, p, primary, collegeOf);
        return Array.isArray(applied) && !closedNow(applied) && !forbiddenSecondMajor(applied, primary)
          ? { ...s, additionalPrograms: applied }
          : s;
      });
      return "added";
    },
    [commit, collegeOf, programLabel, closedSentence, showToast]
  );

  const removeProgram = useCallback(
    (programId: string, triedToDrop: string[]) => {
      const canonicalNow = (cid: string) => aliasesRef.current[cid] ?? cid;
      const planned = programRemoval(stateRef.current, programId, triedToDrop, canonicalNow);
      if (!planned) return; // not on the plan (a stale caller): nothing to undo
      // D12, the mirror of adding a major a minor is closed to: never remove
      // the major that keeps an onlyOpenTo minor open (a Nutritional Sciences
      // second major beside a minor only open to it). Known once the session
      // read the minor index; until then it is removed and the panel warns.
      const primary = planProgramIdRef.current ?? useProgramStore.getState().selectedProgramId;
      const wouldClose = (s: PlanState) =>
        minorClosedByRemoving(s.additionalPrograms, primary, peekMinorIndex(), programId);
      const closing = wouldClose(stateRef.current);
      if (closing) {
        showToast(`Can't remove ${programLabel(planned.removed.program)}: ${closedSentence(closing)}. Remove the minor first.`);
        return;
      }
      const removed: RemovedProgram = { planId: planIdRef.current, ...planned.removed };
      commit((s) => (wouldClose(s) ? s : programRemoval(s, programId, triedToDrop, canonicalNow)?.next ?? s));

      const label = programLabel(removed.program);
      showToast(`Removed ${label}`, {
        actionLabel: "Undo",
        onAction: () => {
          // "other-plan": never restore into a different plan (like a card's
          // Undo; the toast is also dismissed when the plan changes).
          // D12: never bring back a minor beside a major Cornell closes it to
          // (or a major beside such a minor) — known once the index is read.
          const closedCheck = { primaryId: planProgramIdRef.current, minorIndex: peekMinorIndex() };
          const result = restoreRemovedProgram(
            stateRef.current,
            removed,
            planIdRef.current,
            canonicalNow,
            closedCheck
          );
          if (result === "other-plan") return;
          if (result === "closed") {
            const restored = [...stateRef.current.additionalPrograms, removed.program];
            const pair = closedMinorPair(
              restored,
              closedCheck.primaryId,
              closedCheck.minorIndex,
              removed.program.programId
            );
            showToast(
              pair
                ? `Can't bring back ${label}: ${closedSentence(pair)}.`
                : `Can't bring back ${label}.`
            );
            return;
          }
          if (result === "cap") {
            showToast(
              removed.program.kind === "major"
                ? `This plan already has a second major — remove it to bring back ${label}.`
                : `This plan already has ${MAX_MINORS} minors — remove one to bring back ${label}.`
            );
            return;
          }
          commit((s) => {
            const applied = restoreRemovedProgram(s, removed, planIdRef.current, canonicalNow, closedCheck);
            return typeof applied === "object" ? applied.next : s;
          });
          if (result.triedLeftOut > 0) {
            showToast(
              `Brought back ${label}. Tried holds ${MAX_TRIED_COURSES} — ${result.triedLeftOut} of its classes didn't fit.`
            );
          }
        },
      });
      undoToastKeyRef.current = usePlannerStore.getState().toast?.key ?? null;
      undoProgramRef.current = {
        key: undoToastKeyRef.current,
        planId: removed.planId,
        programId: removed.program.programId,
      };
    },
    [commit, programLabel, closedSentence, showToast]
  );

  const setProgramConcentrations = useCallback(
    (programId: string, ids: string[]) => {
      const next = programsWithConcentrations(stateRef.current.additionalPrograms, programId, ids);
      if (next === "same" || next === "absent") return; // nothing to change / a stale caller
      if (next === "minor" || next === "invalid") {
        console.warn("[plan] refused concentrations", programId, ids);
        showToast(
          next === "invalid" && new Set(ids).size > 3
            ? "A major takes up to 3 concentrations."
            : "Couldn't save those concentrations."
        );
        return;
      }
      commit((s) => {
        const applied = programsWithConcentrations(s.additionalPrograms, programId, ids);
        return Array.isArray(applied) ? { ...s, additionalPrograms: applied } : s;
      });
    },
    [commit, showToast]
  );

  const addTriedCourses = useCallback(
    (courseIds: string[]): { added: string[]; skipped: number } => {
      const canonicalNow = (cid: string) => aliasesRef.current[cid] ?? cid;
      const cur = stateRef.current;
      const result = triedAfterAdding(cur.triedCourseIds, cur.placements, courseIds, canonicalNow);
      if (result.added.length === 0) return { added: [], skipped: result.skipped };
      commit((s) => {
        const applied = triedAfterAdding(s.triedCourseIds, s.placements, courseIds, canonicalNow);
        return applied.added.length > 0 ? { ...s, triedCourseIds: applied.next } : s;
      });
      return { added: result.added, skipped: result.skipped };
    },
    [commit]
  );

  const setCountsFor = useCallback(
    (courseId: string, layerId: string | null) => {
      const next = marksWithCountsFor(stateRef.current.courseMarks, courseId, layerId);
      if (next === "same") return;
      if (next === "cap") {
        showToast(`A plan holds up to ${MAX_COURSE_MARKS} course answers — clear one to add another.`);
        return;
      }
      if (next === "invalid") {
        console.warn("[plan] refused a malformed countsFor choice", courseId, layerId);
        showToast("Couldn't save that choice.");
        return;
      }
      commit((s) => {
        const applied = marksWithCountsFor(s.courseMarks, courseId, layerId);
        return typeof applied === "object" ? { ...s, courseMarks: applied } : s;
      });
    },
    [commit, showToast]
  );

  const pruneOrphans = useCallback(
    (liveLayerIds: string[]): number => {
      // D10: a program removed with its Undo toast still showing is not gone
      // yet — Undo must bring back its waivers and answers too. Its id keeps
      // its own layer and (withoutOrphans' "--" rule) its concentrations live.
      // Never added to an empty list (that would prune the primary's own).
      const undo = undoProgramRef.current;
      const undoOpen =
        undo !== null &&
        undo.key !== null &&
        undo.key === usePlannerStore.getState().toast?.key &&
        undo.planId === planIdRef.current;
      const live = undoOpen && liveLayerIds.length > 0 ? [...liveLayerIds, undo.programId] : liveLayerIds;
      const { removed } = withoutOrphans(stateRef.current, live);
      if (removed === 0) return 0;
      // One save: waivers and marks in the same commit.
      commit((s) => {
        const applied = withoutOrphans(s, live);
        return applied.removed === 0
          ? s
          : { ...s, waivedRequirementIds: applied.waivedRequirementIds, courseMarks: applied.courseMarks };
      });
      return removed;
    },
    [commit]
  );

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      planId,
      planProgramId,
      planName,
      planLoading,
      planError,
      addPlacement,
      movePlacement,
      addShortTerm,
      removeShortTerm,
      removePlacement,
      toggleCompleted,
      toggleInProgress,
      toggleWaivedRequirement,
      setCourseMark,
      tryCourse,
      untryCourse,
      clearTried,
      resetPlan,
      renamePlan,
      plansList,
      switchPlan,
      createNewPlan,
      deletePlan,
      addProgram,
      removeProgram,
      setProgramConcentrations,
      addTriedCourses,
      setCountsFor,
      pruneOrphans,
    }),
    [
      state,
      planId,
      planProgramId,
      planName,
      planLoading,
      planError,
      addPlacement,
      movePlacement,
      addShortTerm,
      removeShortTerm,
      removePlacement,
      toggleCompleted,
      toggleInProgress,
      toggleWaivedRequirement,
      setCourseMark,
      tryCourse,
      untryCourse,
      clearTried,
      resetPlan,
      renamePlan,
      plansList,
      switchPlan,
      createNewPlan,
      deletePlan,
      addProgram,
      removeProgram,
      setProgramConcentrations,
      addTriedCourses,
      setCountsFor,
      pruneOrphans,
    ]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlanContext(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanContext must be used within PlanProvider");
  return ctx;
}
