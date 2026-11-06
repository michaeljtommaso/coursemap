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
 * Course marks (spec 020 D5) carry when the NEW program asks the same
 * question: a mark's key names its question without a program id, so a
 * question asked by a layer both programs share (a college layer) has the
 * same key in both. Which keys the new program asks is decided by the
 * `carryMark` option (see defaultCarryMark).
 *
 * Tried classes (spec 025 D12) carry as they are: they name courses, not any
 * program's requirements, so they mean the same thing under the new program.
 *
 * Pure and deterministic: no React, no Firestore — PlanProvider applies the
 * result and persists it through the normal debounced save (to the NEW doc
 * only).
 */

import type { Placement } from "@/types/plan";
import type { MarkValue } from "./distribution/types";
import { parseRef } from "./questions/keys";
import { MAX_COURSE_MARKS, MAX_TRIED_COURSES } from "@/lib/schemas";
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
  /** Spec 020 course marks of the old plan (answer key → value). */
  courseMarks?: Record<string, MarkValue>;
  /** Spec 025 D12 tried classes of the old plan (course ids). */
  triedCourseIds?: string[];
};

export type PlanSeedResult = {
  placements: Placement[];
  completedIds: string[];
  inProgressIds: string[];
  /** The old plan's marks whose question the new program asks (spec 020 D5). */
  courseMarks: Record<string, MarkValue>;
  /** The old plan's tried classes, deduped and capped (spec 025 D12). */
  triedCourseIds: string[];
  /** Course ids the seeded placements reference (for snapshot carry-over). */
  courseIds: string[];
  /** Summary counts for the toast: kept = every carried placement, matched =
   *  carried placements that fill one of the new program's requirements. */
  kept: number;
  matched: number;
};

/** College layer ids follow one naming convention: the family, "-college",
 *  then an optional version suffix ("cas-college", "cals-college-2025",
 *  "cals-college-pre2025"). Program ids never start this way, so a future
 *  version (e.g. "cas-college-2027") is recognised without a code change. */
const COLLEGE_LAYER_ID_RE = /^(cas|cals)-college(-|$)/;

/** College layers: every major of the college includes the same layer id, so
 *  a question one of them asks is asked by every major of that college. */
export function isCollegeLayerId(layerId: string): boolean {
  return COLLEGE_LAYER_ID_RE.test(layerId);
}

/**
 * The default `carryMark` predicate: carry a mark when its question is one a
 * new program is sure to ask without looking at its layers —
 *  - a row-scoped mark (usedAs / approvedFor / courseCondition, key
 *    `${type}:${layerId}/${row}@${courseId}`) asked by a COLLEGE layer;
 *  - a credit mark (creditsTaken / sequenceDone, key `${type}:${course}`):
 *    it is about the course itself, not about any program's row.
 * A mark on a major's or concentration's own row stays with the old plan.
 * It ignores which college the new program is in: a CAS mark carried into a
 * CALS plan is simply never asked there (the engine ignores a mark no layer
 * asks; the answers list shows it as "No longer asked").
 *
 * Callers that know the new program's layers should pass a precise predicate
 * instead: `key => askedRefs.has(key.split("@")[0])`, where askedRefs holds
 * questionRef() of every question the new program's selected layers declare.
 */
export function defaultCarryMark(key: string): boolean {
  const at = key.indexOf("@");
  const parsed = parseRef(at >= 0 ? key.slice(0, at) : key);
  if (!parsed) return false;
  switch (parsed.type) {
    case "usedAs":
    case "approvedFor":
    case "courseCondition":
      return at >= 0 && isCollegeLayerId(parsed.layerId);
    case "creditsTaken":
    case "sequenceDone":
      return at < 0;
    case "studentFact":
      // Facts live on the profile, never on a plan.
      return false;
  }
}

export type SeedOptions = {
  /** Should the old plan's mark with this answer key carry to the new plan?
   *  Defaults to defaultCarryMark. */
  carryMark?: (key: string) => boolean;
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
 * the previous plan had nothing to carry (no placements with course data, no
 * tried classes and no carried marks) — then the new plan just gets its own
 * starting board and no toast is warranted. An empty old board that still
 * holds tried classes or carried marks seeds the new program's starting board
 * with them (`kept` 0: nothing on the board was carried).
 *
 * @param startingBoard the NEW program's starting placements (§D6), already
 *   built by the caller (placementOps.startingPlacements) so ids stay injectable.
 * @param options.carryMark which of the old plan's course marks carry (spec
 *   020 D5); see defaultCarryMark.
 */
export function seedPlanFromPrevious(
  prev: PrevPlanSnapshot,
  newTargetSlots: RemapTargetSlot[],
  startingBoard: Placement[] = [],
  options: SeedOptions = {}
): PlanSeedResult | null {
  // Every placement whose course data exists travels as-is (never invent a
  // course for one whose data is gone). Normalized: dense orders, clamped sems.
  const carried = sanitizePlacements(
    prev.placements.filter((p) => prev.placedCourses[p.courseId] != null)
  );
  const carryMark = options.carryMark ?? defaultCarryMark;
  const courseMarks: Record<string, MarkValue> = {};
  for (const [key, value] of Object.entries(prev.courseMarks ?? {})) {
    if (carryMark(key)) courseMarks[key] = value;
  }
  const triedCourseIds = mergeSeedTried([], prev.triedCourseIds ?? []);
  if (carried.length === 0 && triedCourseIds.length === 0 && Object.keys(courseMarks).length === 0) {
    return null;
  }

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
    courseMarks,
    triedCourseIds,
    courseIds: [...new Set(placements.map((p) => p.courseId))],
    kept: carried.length,
    matched: countMatched(carried, prev, newTargetSlots),
  };
}

/**
 * The course marks a seeded plan starts with (spec 020 D5): the target plan's
 * own marks first (they win on a shared key), then the carried marks in order,
 * never more than `cap` in all. A target plan can hold marks while its board
 * is empty (a reset keeps marks), so an uncapped merge could pass the
 * MAX_COURSE_MARKS write limit and fail the whole seed save. Pure.
 */
export function mergeSeedMarks(
  targetMarks: Record<string, MarkValue> | undefined,
  carriedMarks: Record<string, MarkValue>,
  cap: number = MAX_COURSE_MARKS
): Record<string, MarkValue> {
  const out: Record<string, MarkValue> = {};
  let count = 0;
  for (const source of [targetMarks ?? {}, carriedMarks]) {
    for (const [key, value] of Object.entries(source)) {
      if (key in out) continue;
      if (count >= cap) return out;
      out[key] = value;
      count++;
    }
  }
  return out;
}

/**
 * The tried classes a seeded plan starts with (spec 025 D12): the target
 * plan's own first, then the carried ones in order, deduped, never more than
 * `cap` in all (an over-long list would fail the whole seed save). Pure.
 */
export function mergeSeedTried(
  targetTried: readonly string[] | undefined,
  carriedTried: readonly string[],
  cap: number = MAX_TRIED_COURSES
): string[] {
  const out: string[] = [];
  for (const id of [...(targetTried ?? []), ...carriedTried]) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
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

/**
 * Switching back to a major whose plan already holds work loads that plan
 * untouched — so courses that were on the previous board but aren't on this
 * one stay behind in the previous major's plan (U-8). Returns their course
 * ids, in board order, so the switch can say so instead of dropping them
 * silently.
 */
export function coursesLeftBehind(
  prev: { placements: Placement[] },
  loaded: { placements: { courseId: string }[] }
): string[] {
  const onLoaded = new Set(loaded.placements.map((p) => p.courseId));
  const ordered = [...prev.placements].sort((a, b) => a.sem - b.sem || a.order - b.order);
  const out: string[] = [];
  for (const p of ordered) {
    if (!onLoaded.has(p.courseId) && !out.includes(p.courseId)) out.push(p.courseId);
  }
  return out;
}

/** "CHEME 2200 and 3 more stay in your ChemE plan." — the toast for
 *  coursesLeftBehind: one short sentence naming the first course (two when
 *  there are exactly two) and counting the rest. `codes` are display codes;
 *  null when nothing was left. */
export function leftBehindMessage(codes: string[], fromName: string): string | null {
  if (codes.length === 0) return null;
  const named =
    codes.length <= 2 ? codes.join(" and ") : `${codes[0]} and ${codes.length - 1} more`;
  const verb = codes.length === 1 ? "stays" : "stay";
  return `${named} ${verb} in your ${fromName} plan.`;
}
