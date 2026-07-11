/**
 * seedPlanFromPrevious.ts (spec 009 §4 / C4, cross-plan) — "switching majors
 * never deletes placements", adapted to the per-program-plan architecture: each
 * program resolves to its OWN plan document, so a real major switch swaps docs.
 * When the target program's plan is MISSING or EMPTY, its initial state is
 * SEEDED from the previous program's loaded plan via the re-mapper — every
 * placement of the old plan is an orphan by definition and is carried over.
 * The OLD plan document is never modified; switching back finds it untouched.
 *
 * Pure and deterministic: given the old plan state + the old program's slots
 * (for effective-semester resolution) + the new program's target slots, produce
 * the new plan's initial content and the summary counts. No React, no Firestore
 * — PlanProvider applies the result and persists it through the normal
 * debounced save (to the NEW doc only).
 */

import {
  remapPlacements,
  type RemapPlacement,
  type RemapMark,
  type RemapCourse,
  type RemapTargetSlot,
} from "./remapPlacements";

/** The old plan's state as the seeder needs it (a subset of PlanState). */
export type PrevPlanSnapshot = {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  inProgressSlotIds: string[];
  /** courseId → course data (full Course objects qualify structurally). */
  selectedCourses: Record<string, RemapCourse>;
  slotOverrides: Record<string, { sem?: number; removed?: boolean }>;
  customSlots: { id: string; sem: number; title?: string }[];
};

/** The old program's template slots: id + semester (for effective-semester
 *  resolution), plus — for fixed course-kind slots — the template course itself,
 *  so a MARKED template course can travel (see buildCarryOverPlacements). */
export type OldProgramSlot = {
  id: string;
  suggested_semester: number;
  /** The slot's fixed template course (course-kind slots only), or null/absent.
   *  When the course data can't be resolved, the marked slot is skipped —
   *  never invent a course. */
  course?: RemapCourse | null;
};

export type PlanSeedResult = {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  inProgressSlotIds: string[];
  customSlots: { id: string; sem: number; title?: string }[];
  /** Course ids the seeded selections reference (for snapshot carry-over). */
  courseIds: string[];
  /** Summary counts for the toast: kept = every placement, matched = those
   *  that landed in a real target-program requirement slot. */
  kept: number;
  matched: number;
};

const clampSem = (sem: number) => Math.min(10, Math.max(1, sem));

/** What travels on a major switch:
 *
 *  1. Every USER PLACEMENT (slotSelections), with its EFFECTIVE semester (the
 *     old plan's slotOverrides win over the old template's suggested semester;
 *     custom slots carry their own) and its manual mark. Placements whose
 *     course data is gone (no snapshot) are skipped — nothing to carry.
 *
 *  2. Every MARKED TEMPLATE COURSE — a fixed course-kind slot with a completed
 *     or in-progress mark but NO placement. The mark is student-asserted truth
 *     ("I completed CS 3110") and must survive the switch, or the new board
 *     undercounts what the student has actually done.
 *
 *  Deliberately NOT carried:
 *  - UNMARKED template defaults: the template is a suggestion, and the new
 *    program brings its own suggestions — swapping them is the spec's principle.
 *  - WAIVED marks on slots with no course: a waiver identifies no course to
 *    carry; the mark stays behind on the old plan doc (which is never modified).
 *  - Marked template slots the student REMOVED (override.removed): "not in my
 *    plan" is also student-asserted truth.
 *  - Marked template courses whose course data can't be resolved — never invent. */
export function buildCarryOverPlacements(
  prev: PrevPlanSnapshot,
  oldProgramSlots: OldProgramSlot[]
): RemapPlacement[] {
  const templateSem = new Map(oldProgramSlots.map((s) => [s.id, s.suggested_semester]));
  const customSem = new Map(prev.customSlots.map((c) => [c.id, c.sem]));
  const placements: RemapPlacement[] = [];
  for (const [slotId, courseId] of Object.entries(prev.slotSelections)) {
    const course = prev.selectedCourses[courseId];
    if (!course) continue;
    const sem =
      prev.slotOverrides[slotId]?.sem ?? customSem.get(slotId) ?? templateSem.get(slotId) ?? 1;
    const mark: RemapMark | null = prev.completedSlotIds.includes(slotId)
      ? "completed"
      : prev.waivedSlotIds.includes(slotId)
        ? "waived"
        : prev.inProgressSlotIds.includes(slotId)
          ? "in-progress"
          : null;
    placements.push({ slotId, course, semester: clampSem(sem), mark });
  }

  // Marked template courses (rule 2 above). A course already carried by a user
  // placement isn't duplicated — a course fills one slot.
  const placedSlotIds = new Set(Object.keys(prev.slotSelections));
  const carriedCourseIds = new Set(placements.map((p) => p.course.id));
  for (const slot of oldProgramSlots) {
    if (!slot.course) continue; // not a fixed-course slot / unresolvable — never invent
    if (placedSlotIds.has(slot.id)) continue; // a placement already owns this slot
    if (prev.slotOverrides[slot.id]?.removed) continue; // student removed it
    // Only completed / in-progress marks are student truth about a COURSE;
    // waived-without-course carries nothing (see doc comment above).
    const mark: RemapMark | null = prev.completedSlotIds.includes(slot.id)
      ? "completed"
      : prev.inProgressSlotIds.includes(slot.id)
        ? "in-progress"
        : null;
    if (!mark) continue; // unmarked template default — the template is a suggestion
    if (carriedCourseIds.has(slot.course.id)) {
      // The course already travels via a placement. Don't duplicate it — but
      // the mark is still the student's truth about this course: if the
      // carrying placement has no mark of its own, it inherits this one.
      const carrier = placements.find((p) => p.course.id === slot.course!.id);
      if (carrier && carrier.mark === null) carrier.mark = mark;
      continue;
    }
    const sem = prev.slotOverrides[slot.id]?.sem ?? slot.suggested_semester;
    carriedCourseIds.add(slot.course.id);
    placements.push({ slotId: slot.id, course: slot.course, semester: clampSem(sem), mark });
  }
  return placements;
}

/**
 * Build the new plan's initial state from the previous plan. Returns null when
 * the previous plan had nothing to carry (no placements with course data) —
 * then the new plan simply starts empty and no toast is warranted.
 */
export function seedPlanFromPrevious(
  prev: PrevPlanSnapshot,
  oldProgramSlots: OldProgramSlot[],
  newTargetSlots: RemapTargetSlot[]
): PlanSeedResult | null {
  const placements = buildCarryOverPlacements(prev, oldProgramSlots);
  if (placements.length === 0) return null;

  // A fresh plan has no occupied targets; the re-mapper's own bookkeeping
  // prevents two carried courses claiming the same slot.
  const result = remapPlacements(placements, newTargetSlots);

  const slotSelections: Record<string, string> = {};
  const customSlots: PlanSeedResult["customSlots"] = [];
  for (const m of result.moves) slotSelections[m.toSlotId] = m.courseId;
  for (const cc of result.customCreations) {
    slotSelections[cc.slotId] = cc.courseId;
    customSlots.push({ id: cc.slotId, sem: cc.sem });
  }

  const completedSlotIds: string[] = [];
  const waivedSlotIds: string[] = [];
  const inProgressSlotIds: string[] = [];
  for (const t of result.markTransfers) {
    if (t.mark === "completed") completedSlotIds.push(t.toSlotId);
    else if (t.mark === "waived") waivedSlotIds.push(t.toSlotId);
    else inProgressSlotIds.push(t.toSlotId);
  }

  return {
    slotSelections,
    completedSlotIds,
    waivedSlotIds,
    inProgressSlotIds,
    customSlots,
    courseIds: [...new Set(Object.values(slotSelections))],
    kept: result.keptCount,
    matched: result.matchedCount,
  };
}

/** Is a loaded plan doc EMPTY of student content? (Missing docs surface as an
 *  empty created doc, so this one predicate covers both "missing" and "empty".)
 *  Only content counts — name/programId/overrides say nothing about prior work. */
export function planContentIsEmpty(plan: {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  inProgressSlotIds: string[];
  customSlots: unknown[];
}): boolean {
  return (
    Object.keys(plan.slotSelections).length === 0 &&
    plan.completedSlotIds.length === 0 &&
    plan.waivedSlotIds.length === 0 &&
    plan.inProgressSlotIds.length === 0 &&
    plan.customSlots.length === 0
  );
}
