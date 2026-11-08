import type { ColumnRef, Placement } from "@/types/plan";

/**
 * terms.ts (spec 042 D3/D11) — the ONE place a board column becomes a time
 * position and a Cornell term. Pure: no React, no data fetching.
 *
 * A column is semester k (1..10) or the short term just before it. Time order
 * across the board uses `columnKey`: the short term before k is 2k − 1,
 * semester k is 2k, so a Summer sits between the Spring before it and the Fall
 * after it, and a Winter between a Fall and the Spring after it.
 *
 * Terms: column 1 is Fall of the entering year and Fall/Spring alternate by
 * parity (the semesters.ts math). A short term before a Fall is that year's
 * Summer; before a Spring it is that year's Winter session (January), so
 * Winter 2026 falls between Fall 2025 and Spring 2026.
 */

export type Season = "FA" | "SP" | "WI" | "SU";

/** Cornell's order of the four terms WITHIN a calendar year: the winter
 *  session (January) < spring < summer < fall. Matches termOrdinal in
 *  distribution/select.ts. */
export const SEASON_ORDER: Record<Season, number> = { WI: 0, SP: 1, SU: 2, FA: 3 };

/** At most this many short-term columns on a plan (spec 042 D4/D8) — keep in
 *  sync with schemas.ts PlanSchema.shortTerms and firestore.rules. */
export const MAX_SHORT_TERMS = 10;

const SEASON_NAME: Record<Season, string> = {
  FA: "Fall",
  SP: "Spring",
  WI: "Winter",
  SU: "Summer",
};

/** Time-order key of a column: short term before k = 2k − 1, semester k = 2k. */
export function columnKey(ref: ColumnRef): number {
  return 2 * ref.sem - (ref.shortTerm ? 1 : 0);
}

/** A placement's column, with `shortTerm` normalized to a boolean (only an
 *  exact `true` marks a short term). */
export function refOf(p: Pick<Placement, "sem" | "shortTerm">): ColumnRef {
  return { sem: p.sem, shortTerm: p.shortTerm === true };
}

/** Same column? (same sem, same short-term flag; a missing flag is false). */
export function sameColumn(a: ColumnRef, b: ColumnRef): boolean {
  return a.sem === b.sem && !!a.shortTerm === !!b.shortTerm;
}

/** A column target as either form: a plain number is a regular semester. */
export function toColumnRef(x: number | ColumnRef): ColumnRef {
  return typeof x === "number" ? { sem: x, shortTerm: false } : { sem: x.sem, shortTerm: !!x.shortTerm };
}

/** The season of the short term before semester `sem`: before a Fall (odd
 *  sem) it is a Summer, before a Spring (even sem) a Winter. */
export function shortTermSeason(sem: number): "SU" | "WI" {
  return sem % 2 === 1 ? "SU" : "WI";
}

/**
 * The Cornell term of a column. Regular semester k: odd → Fall of
 * enteringYear + (k−1)/2, even → Spring of enteringYear + k/2 (identical to
 * semesters.ts semesterLabel). Short term before k: the Summer before that
 * Fall (same year) or the Winter before that Spring (same year, January).
 *
 * `year`/`slug` are null when the entering year is unknown (null, undefined,
 * 0 or non-finite — the same "no year" test semesterLabel applies); the label
 * is then the bare season ("Summer").
 */
export function termOfColumn(
  ref: ColumnRef,
  enteringYear: number | null | undefined
): { season: Season; year: number | null; slug: string | null; label: string } {
  const k = ref.sem;
  const fallColumn = k % 2 === 1;
  const season: Season = ref.shortTerm ? shortTermSeason(k) : fallColumn ? "FA" : "SP";
  const name = SEASON_NAME[season];
  if (!enteringYear || !Number.isFinite(enteringYear)) {
    return { season, year: null, slug: null, label: name };
  }
  // The short term shares the calendar year of the semester it precedes.
  const year = fallColumn ? enteringYear + (k - 1) / 2 : enteringYear + k / 2;
  const yy = String(((year % 100) + 100) % 100).padStart(2, "0");
  return { season, year, slug: `${season}${yy}`, label: `${name} ${year}` };
}

/**
 * Repair an untrusted `shortTerms` list (plan / share docs, spec 042 D4): keep
 * integers 1..10, drop duplicates, sort ascending, cap at MAX_SHORT_TERMS.
 * Anything that isn't an array reads as none.
 */
export function sanitizeShortTerms(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const x of raw) {
    if (typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 10) set.add(x);
  }
  return [...set].sort((a, b) => a - b).slice(0, MAX_SHORT_TERMS);
}
