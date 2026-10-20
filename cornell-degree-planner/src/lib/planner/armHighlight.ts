import { horizonForSemester, rosterOfferGate } from "./horizon";

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
 */
export function targetHighlightSem(
  course: { roster?: string | null } | null | undefined,
  target: string | null | undefined,
  enteringYear: number | null,
  columnSems: readonly number[]
): number | null {
  if (!course || rosterOfferGate(course.roster, target) !== "offered") return null;
  for (const sem of columnSems) {
    if (horizonForSemester(sem, enteringYear, target) === "near") return sem;
  }
  return null;
}
