/**
 * triedProgress.ts (spec 028 D11/D13) — "if you take what you're trying".
 *
 * A plan's tried classes are course ids the student is trying on the
 * Requirements page without placing them. This module answers what the
 * requirements would look like with them: every tried class that is NOT on the
 * board becomes a virtual placement after the board's last semester, and the
 * caller's own engine (Engineering or Distribution, the same path the board is
 * scored on) solves board + virtual placements. The REAL result is never
 * touched: tried classes are a separate, blue "+N" state and never mark a real
 * requirement met (D11). Major Match never sees them.
 *
 * Pure: no React, no Firestore. useRequirementProgress supplies the solver,
 * the catalog lookup and the cross-listing canonicalizer.
 */
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type {
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { recordToCourse } from "@/lib/catalog/recordToCourse";

/** The placement id of a tried class's virtual placement. Never collides with
 *  a real placement id (those are uuids or template slot ids). */
export function triedPlacementId(courseId: string): string {
  return `tried:${courseId}`;
}

/**
 * Course data for a tried id: a Course when the catalog has it, null when the
 * catalog is loaded and does not (the class is no longer offered), undefined
 * while that can't be told yet (catalog still loading). Called with the
 * canonical id first, then the stored id.
 */
export type TriedCourseLookup = (courseId: string) => Course | null | undefined;

/**
 * A lookup over the session's catalog: a full course doc first (courseDetails,
 * fetched on demand), else the compact index record. `indexReady` false (the
 * index is loading or failed) → unknown ids read as undefined, never as
 * missing, so a slow index load can't flash "no longer offered".
 */
export function catalogTriedLookup(
  indexById: ReadonlyMap<string, CatalogIndexRecord>,
  courseDetails: Record<string, Course>,
  indexReady: boolean
): TriedCourseLookup {
  return (id) => {
    const full = courseDetails[id];
    if (full) return full;
    const record = indexById.get(id);
    if (record) return recordToCourse(record);
    return indexReady ? null : undefined;
  };
}

export type TriedProgressInput = {
  /** The plan's tried course ids, in the order tried. */
  triedCourseIds: readonly string[];
  /** The REAL board. */
  placements: Placement[];
  placedCourses: Record<string, Course>;
  /** The real result (the same engine on the board alone). Used as is when no
   *  tried class needs a virtual placement, and for on-board tried fills. */
  base: RequirementProgress;
  /** Cross-listing canonicalizer (alias map); identity when absent. */
  canonical?: (id: string) => string;
  lookup: TriedCourseLookup;
  /** The caller's engine, on the given board. */
  solve: (placements: Placement[], placedCourses: Record<string, Course>) => RequirementProgress;
};

/**
 * The tried state (spec 028 D11), or undefined when nothing is being tried.
 *  - courseIds: the tried ids, in order (deduped).
 *  - notOnBoard: tried ids whose course (canonical, so a cross-listed code on
 *    the board counts) is not on the board — the rail reminder.
 *  - missing: not-on-board tried ids the loaded catalog does not have; they
 *    get no virtual placement and count toward nothing.
 *  - items: every requirement item, recomputed with the virtual placements.
 *  - fills: tried id → labels of the requirements it would count toward
 *    (virtual placement's attribution; for a tried class already on the
 *    board, its placements' real attribution).
 */
export function computeTriedProgress(input: TriedProgressInput): TriedProgress | undefined {
  const canonical = input.canonical ?? ((id: string) => id);
  const courseIds = [...new Set(input.triedCourseIds)];
  if (courseIds.length === 0) return undefined;

  const boardByCourse = new Map<string, string[]>();
  let lastSem = 0;
  for (const p of input.placements) {
    const c = canonical(p.courseId);
    const list = boardByCourse.get(c);
    if (list) list.push(p.id);
    else boardByCourse.set(c, [p.id]);
    // Raw `sem`, short terms included (spec 042): a short term before k sits
    // before semester k, so the regular semester max(sem) + 1 is after EVERY
    // column — the virtual placements stay last in time order.
    if (p.sem > lastSem) lastSem = p.sem;
  }

  const notOnBoard: string[] = [];
  const missing: string[] = [];
  const virtual: Placement[] = [];
  const virtualCourses: Record<string, Course> = {};
  /** tried id → its virtual placement id (two ids may share one course). */
  const virtualFor: Record<string, string> = {};
  /** tried id → the board placements of its course. */
  const boardFor: Record<string, string[]> = {};

  for (const id of courseIds) {
    const canon = canonical(id);
    const onBoard = boardByCourse.get(canon);
    if (onBoard) {
      boardFor[id] = onBoard;
      continue;
    }
    notOnBoard.push(id);
    const course = lookupEither(input.lookup, canon, id);
    if (course === null) {
      missing.push(id);
      continue;
    }
    if (course === undefined) continue; // catalog still loading: neither counted nor missing
    const placementId = triedPlacementId(course.id);
    virtualFor[id] = placementId;
    // One virtual placement per course (two tried ids may be cross-listings).
    if (virtualCourses[course.id]) continue;
    virtualCourses[course.id] = course;
    virtual.push({ id: placementId, courseId: course.id, sem: lastSem + 1, order: virtual.length });
  }

  const solved =
    virtual.length === 0
      ? input.base
      : input.solve([...input.placements, ...virtual], { ...input.placedCourses, ...virtualCourses });

  const items: Record<string, RequirementItem> = {};
  for (const group of solved.groups) for (const item of group.items) items[item.id] = item;

  const fills: Record<string, string[]> = {};
  for (const id of courseIds) {
    const vid = virtualFor[id];
    if (vid) {
      fills[id] = [...(solved.attribution[vid] ?? [])];
      continue;
    }
    const placed = boardFor[id];
    if (placed) {
      const labels: string[] = [];
      for (const pid of placed) {
        for (const l of input.base.attribution[pid] ?? []) if (!labels.includes(l)) labels.push(l);
      }
      fills[id] = labels;
    }
  }

  // Spec 047 D10: tried classes counting toward exactly one program, an extra
  // one (removing it takes them along). Only virtual placements: a tried class
  // already on the board stays.
  const extraSections = new Set(
    (solved.sections ?? []).filter((x) => x.kind === "secondMajor" || x.kind === "minor").map((x) => x.id)
  );
  const onlyFor: Record<string, string[]> = {};
  if (extraSections.size > 0) {
    for (const id of courseIds) {
      const vid = virtualFor[id];
      if (!vid) continue;
      const sections = [...new Set((solved.attributionDetail?.[vid] ?? []).map((d) => d.sectionId))];
      if (sections.length === 1 && extraSections.has(sections[0])) (onlyFor[sections[0]] ??= []).push(id);
    }
  }

  return {
    courseIds,
    notOnBoard,
    items,
    fills,
    missing,
    ...(Object.keys(onlyFor).length > 0 ? { onlyFor } : {}),
  };
}

/** The first course found under the canonical id, then the stored id; null
 *  only when every lookup says the catalog lacks it. */
function lookupEither(lookup: TriedCourseLookup, canon: string, id: string): Course | null | undefined {
  const first = lookup(canon);
  if (first || canon === id) return first;
  const second = lookup(id);
  if (second) return second;
  return first === null && second === null ? null : undefined;
}

/** Structural equality for tried results (plain data). */
export function sameTried(a: TriedProgress | undefined, b: TriedProgress | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
