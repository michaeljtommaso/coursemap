import type { MarkValue } from "./distribution/types";

/**
 * chosenCredits.ts — the credits a student says they took a variable-credit
 * course for ("1–4 cr" → 3).
 *
 * The choice lives in the plan's course marks under the same key as the
 * requirement question that asks it (`creditsTaken:<course id>`, spec 020), so
 * the course card and that question are one answer and can't disagree. One
 * value per course: a course placed twice shares it.
 *
 * A choice counts only on a variable-credit course and only inside its
 * catalog range; anything else is ignored and the course counts as before
 * (its minimum). Pure.
 */

export function creditsMarkKey(courseId: string): string {
  return `creditsTaken:${courseId}`;
}

/** The course has a credit range ("1–4"), not one fixed figure. */
export function isVariableCredit(min: number, max: number): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && max > min;
}

/** The chosen credits for a course, or null when none applies. */
export function chosenCredits(
  marks: Readonly<Record<string, MarkValue>> | undefined,
  courseId: string,
  min: number,
  max: number
): number | null {
  if (!marks || !isVariableCredit(min, max)) return null;
  const value = marks[creditsMarkKey(courseId)];
  return typeof value === "number" && value >= min && value <= max ? value : null;
}

/** The course with its chosen credits as a fixed figure, for totals and
 *  labels; the same object when no choice applies. */
export function withChosenCredits<T extends { credits_min: number; credits_max: number }>(
  course: T,
  marks: Readonly<Record<string, MarkValue>> | undefined,
  courseId: string
): T {
  const chosen = chosenCredits(marks, courseId, course.credits_min, course.credits_max);
  return chosen === null ? course : { ...course, credits_min: chosen, credits_max: chosen };
}

/** Most buttons the picker shows before it switches to a number field. */
export const MAX_CREDIT_BUTTONS = 8;

/**
 * The values to offer as buttons: whole numbers across the range, or halves
 * when the range has a half at either end (0.5–1.5 → 0.5, 1, 1.5). Null when
 * there would be more than MAX_CREDIT_BUTTONS (1–15): the picker asks for a
 * number instead.
 */
export function creditChoices(min: number, max: number): number[] | null {
  if (!isVariableCredit(min, max)) return null;
  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.5;
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  if (count > MAX_CREDIT_BUTTONS) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((min + i * step) * 2) / 2);
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

/** A typed value the picker accepts: inside the range, in halves. */
export function parseCreditInput(text: string, min: number, max: number): number | null {
  const n = Number(text.trim());
  if (!text.trim() || !Number.isFinite(n) || n < min || n > max) return null;
  return Number.isInteger(n * 2) ? n : null;
}
