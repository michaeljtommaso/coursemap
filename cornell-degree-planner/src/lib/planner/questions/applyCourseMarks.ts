import type { DistCourse, Layer, MarkValue } from "../distribution/types";
import { questionRef } from "./keys";

const identity = (id: string) => id;

/**
 * applyCourseMarks (spec 020 D9) — the credit marks as a course transform.
 *
 *  - creditsTaken: a numeric mark that is one of the question's `values` sets
 *    that course's `credits` (for every row; `creditsMax` is unchanged).
 *  - sequenceDone: a "yes" mark sets the anchor course's `credits` to the
 *    sequence's `credits`.
 *
 * Callers apply it once, before solving, so the engine and the independent
 * checker see the same courses. Questions come from `layers` (a mark whose
 * question no layer asks does nothing); a course matches when its id, through
 * `canonical`, equals the question's course. Pure: returns a new array and
 * never mutates `courses` or its elements. Later questions win when two set
 * the same course.
 */
export function applyCourseMarks(
  courses: DistCourse[],
  layers: readonly Layer[],
  marks: Record<string, MarkValue>,
  canonical: (id: string) => string = identity
): DistCourse[] {
  const credits = new Map<string, number>();
  for (const layer of layers) {
    for (const q of layer.questions ?? []) {
      if (q.type !== "creditsTaken" && q.type !== "sequenceDone") continue;
      const value = marks[questionRef(layer.id, q)];
      const course = canonical(q.course);
      if (q.type === "creditsTaken") {
        if (typeof value === "number" && q.values.includes(value)) credits.set(course, value);
      } else if (value === "yes") {
        credits.set(course, q.credits);
      }
    }
  }
  if (credits.size === 0) return courses.slice();
  return courses.map((c) => {
    const value = credits.get(canonical(c.id));
    return value === undefined || value === c.credits ? c : { ...c, credits: value };
  });
}
