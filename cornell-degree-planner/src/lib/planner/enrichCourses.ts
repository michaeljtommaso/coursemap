import type { Course } from "@/types/db";
import type { BoardCard } from "./board";

/**
 * Course-detail enrichment (spec 006 §B.2 data feed).
 *
 * The card-status engine (computeCardStatusMap) is only as good as the courses
 * it's handed. Template slot snapshots (normalizeProgram) and plan course
 * snapshots (PlanProvider) deliberately carry `prereq_expr: null`,
 * `coreq_expr: null`, `offered: []` — the freshness-sensitive fields live on
 * `courses/{id}` and are fetched on demand (services/catalog.fetchCoursesByIds).
 *
 * These pure helpers overlay a fetched full-doc cache onto the display-only
 * snapshots so the engine sees real prereq/coreq/offered data, WITHOUT touching
 * the engine itself. When no detail is cached for a course, the snapshot passes
 * through unchanged (engine reads null → status stays neutral, as before).
 */

/** Overlay the freshness-sensitive fields from a cached full doc onto a
 *  display snapshot. Display fields (title, credits) stay from the snapshot —
 *  it's what the template/plan intends to show. Returns the SAME object when no
 *  detail exists or nothing would change, so memoized consumers stay stable. */
export function enrichCourse(
  course: Course,
  details: Record<string, Course>
): Course {
  const d = details[course.id];
  if (!d) return course;
  if (
    course.prereq_expr === d.prereq_expr &&
    course.coreq_expr === d.coreq_expr &&
    course.offered === d.offered &&
    course.description === d.description &&
    course.forbidden_overlaps === d.forbidden_overlaps &&
    course.prereq_notes === d.prereq_notes &&
    course.attrs === d.attrs &&
    course.sections === d.sections &&
    course.components === d.components &&
    course.roster === d.roster
  ) {
    return course;
  }
  // forbidden_overlaps + prereq_notes + attrs/sections/components MUST overlay
  // too — the snapshots carry [] and without this the engine never sees a
  // snapshot course's overlap/notes/attribute/section data (the "starved
  // engine" bug class from July: snapshots lie by omission). Spec 010 §5
  // extends the same rationale to the Unit 10A fields.
  return {
    ...course,
    prereq_expr: d.prereq_expr,
    coreq_expr: d.coreq_expr,
    offered: d.offered,
    description: course.description ?? d.description,
    forbidden_overlaps: d.forbidden_overlaps,
    prereq_notes: d.prereq_notes,
    attrs: d.attrs,
    sections: d.sections,
    components: d.components,
    // roster (the sync's slug, spec 012 near-face fix) rides the same overlay:
    // snapshots carry null, and without this the horizon gates would never see
    // which term a placed course's sections belong to.
    roster: d.roster,
  };
}

/** Enrich the course snapshot on every board card. Returns the same array
 *  reference (and the same card objects) when nothing changed. */
export function enrichCards(
  cards: BoardCard[],
  details: Record<string, Course>
): BoardCard[] {
  if (Object.keys(details).length === 0) return cards;
  let changed = false;
  const next = cards.map((card) => {
    const enriched = enrichCourse(card.course, details);
    if (enriched === card.course) return card;
    changed = true;
    return { ...card, course: enriched };
  });
  return changed ? next : cards;
}

/** Enrich the plan's user-placed course map. Same-reference when unchanged. */
export function enrichSelectedCourses(
  placedCourses: Record<string, Course>,
  details: Record<string, Course>
): Record<string, Course> {
  if (Object.keys(details).length === 0) return placedCourses;
  let changed = false;
  const next: Record<string, Course> = {};
  for (const [id, course] of Object.entries(placedCourses)) {
    const enriched = enrichCourse(course, details);
    if (enriched !== course) changed = true;
    next[id] = enriched;
  }
  return changed ? next : placedCourses;
}

/** Every course id that is placed on the current plan (one per distinct
 *  course, in board order). This is the ≤~60 id set we fetch full docs for —
 *  never the whole catalog. */
export function collectPlanCourseIds(cards: BoardCard[]): string[] {
  const ids = new Set<string>();
  for (const { course } of cards) ids.add(course.id);
  return [...ids];
}
