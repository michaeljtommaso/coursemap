import { horizonForSemester, rosterOfferGate } from "./horizon";
import { toColumnRef } from "./terms";
import type { ColumnRef } from "@/types/plan";

/**
 * armHighlight.ts (spec 017 D6) — which board column "Place on board" should
 * point at. Pure; the board only highlights it, and every column still accepts
 * the course (signal, never block).
 *
 * Returns the column (sem) whose term is the enrollment target, but only when
 * the course is on that term's roster and the plan actually renders such a
 * column. Null in every other case (course not on the target roster, roster or
 * target unknown, entering year unknown, or the plan has no target-term column),
 * so placing behaves exactly as before.
 *
 * `columnSems` may list plain semester numbers or board columns (spec 042); a
 * short-term column is never the enrollment term, so it is never returned —
 * the result is always a regular semester.
 */
export function targetHighlightSem(
  course: { roster?: string | null } | null | undefined,
  target: string | null | undefined,
  enteringYear: number | null,
  columnSems: readonly (number | ColumnRef)[]
): number | null {
  if (!course || rosterOfferGate(course.roster, target) !== "offered") return null;
  for (const col of columnSems) {
    const ref = toColumnRef(col);
    if (ref.shortTerm) continue;
    if (horizonForSemester(ref, enteringYear, target) === "near") return ref.sem;
  }
  return null;
}
