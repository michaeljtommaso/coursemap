import type { ProgramSlotWithData, Course } from "@/types/db";
import type { ColumnRef } from "@/types/plan";
import { termOfColumn } from "./terms";

/**
 * Semester grouping + labeling for the roadmap canvas (spec 004 §1).
 *
 * With an entering year (profile.prefs.enteringYear) the columns read as the
 * student's ACTUAL semesters — "Fall 2026 · Freshman" — instead of the generic
 * "Sem 1". Odd semesters are Fall of (year + (sem-1)/2); even are Spring of
 * (year + sem/2). Class of = enteringYear + 4.
 */

const YEAR_WORDS = ["Freshman", "Freshman", "Sophomore", "Sophomore", "Junior", "Junior", "Senior", "Senior"];

export type SemesterLabel = {
  /** "Fall 2026" when enteringYear is known, else "Fall" */
  primary: string;
  /** "Freshman" / "Sophomore" … */
  yearWord: string;
  /** Calendar year, when known (for .num rendering) */
  calendarYear: number | null;
  sem: number;
  /** Spec 042: present (true) only on a short-term column's label
   *  (columnLabel); absent on every Fall/Spring label. */
  shortTerm?: true;
};

/**
 * A column's label. A plain number (or a ColumnRef without `shortTerm`) is a
 * regular semester and reads exactly as it always has; a short-term ColumnRef
 * reads as columnLabel does ("Summer 2026", no class-year word).
 */
export function semesterLabel(column: number | ColumnRef, enteringYear: number | null): SemesterLabel {
  if (typeof column !== "number" && column.shortTerm) return columnLabel(column, enteringYear);
  const sem = typeof column === "number" ? column : column.sem;
  const yearWord = YEAR_WORDS[sem - 1] ?? `Year ${Math.ceil(sem / 2)}`;
  // termOfColumn's label: "Fall 2026" with a known year, bare "Fall" without.
  const t = termOfColumn({ sem, shortTerm: false }, enteringYear);
  return { primary: t.label, yearWord, calendarYear: t.year, sem };
}

/**
 * Column-aware label (spec 042 D6/D11), through terms.ts termOfColumn. A
 * regular semester reads exactly as semesterLabel(sem). A short term reads as
 * its season and year — "Winter 2026", "Summer 2026" (bare "Winter" without an
 * entering year) — with an EMPTY `yearWord` (a short term is no class year)
 * and `shortTerm: true`; `sem` is the semester it precedes.
 */
export function columnLabel(ref: ColumnRef, enteringYear: number | null): SemesterLabel {
  if (!ref.shortTerm) return semesterLabel(ref.sem, enteringYear);
  const t = termOfColumn({ sem: ref.sem, shortTerm: true }, enteringYear);
  return { primary: t.label, yearWord: "", calendarYear: t.year, sem: ref.sem, shortTerm: true };
}

export function classOfYear(enteringYear: number | null): number | null {
  return enteringYear ? enteringYear + 4 : null;
}

/** Credits currently represented by a slot: the placed course's, else the
 *  template course's, else the elective group's min_credits. Null when unknown
 *  (e.g. an unfilled pattern slot). */
export function slotCredits(
  slot: ProgramSlotWithData,
  placedCourse: Course | null
): { min: number; max: number } | null {
  const c = placedCourse ?? (slot.kind === "course" ? slot.courses : null);
  if (c) return { min: c.credits_min, max: c.credits_max };
  if (slot.kind === "elective" && slot.elective_groups) {
    const m = slot.elective_groups.min_credits;
    return m != null ? { min: m, max: m } : null;
  }
  return null;
}

export function formatCredits(cr: { min: number; max: number } | null): string | null {
  if (!cr) return null;
  return cr.min === cr.max ? `${cr.min}` : `${cr.min}–${cr.max}`;
}


/**
 * A semester column's credit range — the ONE computation behind both the
 * column header's "N cr" and its footer's "N credits planned" (B2: the two
 * used to disagree — the footer counted empty elective slots' min_credits and
 * showed a min–max range, the header showed the engine's filled-only
 * credits_min sum). `min` is the same credits_min sum computeCardStatusMap's
 * semesterCredits measures the overload cap against; `max` adds the
 * variable-credit headroom. Render with formatCredits.
 */
export function columnCredits(
  courses: readonly Pick<Course, "credits_min" | "credits_max">[]
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const c of courses) {
    min += c.credits_min;
    max += c.credits_max;
  }
  return { min, max };
}
