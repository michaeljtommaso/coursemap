import type { ColumnRef, Placement } from "@/types/plan";
import { semesterLabel } from "@/lib/planner/semesters";
import { columnKey, MAX_SHORT_TERMS, termOfColumn } from "@/lib/planner/terms";

/**
 * boardColumns (spec 042 D12) — the small, pure UI helpers every surface that
 * lists or names board columns shares: the board's column list in time order
 * (for "Move to…"), a column's display name, and the target form the plan
 * actions take. Pure: no React.
 */

/** One column as a "Move to…" style target: its ref and time key. */
export type ColumnTarget = { sem: number; shortTerm: boolean; key: number };

/** Semesters that always render (mirrors lib/planner/board.ts). */
const BASE_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

const validSem = (k: unknown): k is number =>
  typeof k === "number" && Number.isInteger(k) && k >= 1 && k <= 10;

/**
 * The board's columns in time order, without building cards: semesters 1–8,
 * 9–10 when used, and a short term before k for every k in `shortTerms` or
 * holding a short-term placement. The same rules as buildBoard, so the list
 * matches what the board renders.
 */
export function boardColumnTargets(
  placements: readonly Pick<Placement, "sem" | "shortTerm">[],
  shortTerms: readonly number[] = []
): ColumnTarget[] {
  const sems = new Set<number>(BASE_SEMS);
  const shorts = new Set<number>();
  for (const k of shortTerms) if (validSem(k)) shorts.add(k);
  for (const p of placements) {
    if (!validSem(p.sem)) continue;
    if (p.shortTerm === true) shorts.add(p.sem);
    else sems.add(p.sem);
  }
  return [
    ...[...sems].map((sem) => ({ sem, shortTerm: false })),
    ...[...shorts].map((sem) => ({ sem, shortTerm: true })),
  ]
    .map((ref) => ({ ...ref, key: columnKey(ref) }))
    .sort((a, b) => a.key - b.key);
}

/**
 * A column's display name. Regular: "Fall 2026" (no entering year: "Fall ·
 * Freshman"). Short term: "Summer 2026" (no entering year: "Summer · before
 * Sem 3", since a bare season would be ambiguous in a list).
 */
export function columnName(ref: ColumnRef, enteringYear: number | null): string {
  if (ref.shortTerm) {
    const t = termOfColumn(ref, enteringYear);
    return t.year !== null ? t.label : `${t.label} · before Sem ${ref.sem}`;
  }
  const l = semesterLabel(ref.sem, enteringYear);
  return enteringYear ? l.primary : `${l.primary} · ${l.yearWord}`;
}

/**
 * The detail panel's column name (its placement line and prereq-chip notes):
 * a semester without its calendar year, "Fall of year 2"; a short term by its
 * real term, "Summer 2026" (without an entering year: "Summer before Fall of
 * year 2").
 */
export function termOfYear(
  ref: Pick<Placement, "sem" | "shortTerm"> | ColumnRef,
  enteringYear: number | null
): string {
  const semester = `${semesterLabel(ref.sem, null).primary} of year ${Math.ceil(ref.sem / 2)}`;
  if (ref.shortTerm !== true) return semester;
  const t = termOfColumn({ sem: ref.sem, shortTerm: true }, enteringYear);
  return t.year !== null ? t.label : `${t.label} before ${semester}`;
}

/** "Add Summer 2026" / "Add Winter 2027" — or "Add summer" / "Add winter"
 *  without an entering year — for the gap before semester `sem` (spec 042 D2). */
export function addShortTermLabel(sem: number, enteringYear: number | null): string {
  const t = termOfColumn({ sem, shortTerm: true }, enteringYear);
  return t.year !== null ? `Add ${t.label}` : `Add ${t.label.toLowerCase()}`;
}

/**
 * Which semester columns get a gap "+" before them (spec 042 D2/D8/D9): every
 * rendered Fall/Spring column whose gap has no short term yet — the first
 * column included — and none at all once the plan has MAX_SHORT_TERMS. The
 * count is the larger of the short-term columns on the board and the stored
 * list, so a short term the board shows always counts toward the cap.
 */
export function shortTermGapSems(
  columns: readonly { sem: number; shortTerm: boolean }[],
  storedShortTerms: number
): Set<number> {
  const taken = new Set(columns.filter((c) => c.shortTerm).map((c) => c.sem));
  if (Math.max(taken.size, storedShortTerms) >= MAX_SHORT_TERMS) return new Set();
  return new Set(columns.filter((c) => !c.shortTerm && !taken.has(c.sem)).map((c) => c.sem));
}

/** The target the plan actions take for a column: a plain semester number for
 *  a regular column (the pre-042 form), a ColumnRef for a short term. */
export function columnTarget(ref: ColumnRef): number | ColumnRef {
  return ref.shortTerm ? { sem: ref.sem, shortTerm: true } : ref.sem;
}
