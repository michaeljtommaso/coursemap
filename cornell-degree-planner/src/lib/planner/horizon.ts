/**
 * horizon.ts (spec 012 §1) — the pure time-distance math behind the honesty
 * rule: "a card never displays data whose shelf life is shorter than the
 * card's distance." A plan column is `near` (the enrollment-target semester),
 * `past` (already behind the target), or `far` (everything else / unknown).
 *
 * Pure + unit-tested. No React, no data fetching. `enrollmentTarget` comes from
 * catalog/meta (CatalogProvider); `enteringYear` from the student's profile.
 */

export type Term = "FA" | "SP" | "SU" | "WI";
export type TermYear = { term: Term; year: number };
export type Horizon = "near" | "far" | "past";

const TERMS: readonly Term[] = ["FA", "SP", "SU", "WI"];

/**
 * Parse a Cornell roster slug ("FA26") → { term, year } | null. Defensive by
 * design: any shape that isn't <known 2-letter term><2-digit year> returns null
 * so a malformed/absent config value degrades to "no target" (→ everything far)
 * rather than throwing. "26" → 2026.
 */
export function parseRosterSlug(slug: string | null | undefined): TermYear | null {
  if (!slug) return null;
  const m = /^([A-Za-z]{2})(\d{2})$/.exec(slug.trim());
  if (!m) return null;
  const term = m[1].toUpperCase() as Term;
  if (!TERMS.includes(term)) return null;
  const yy = parseInt(m[2], 10);
  if (Number.isNaN(yy)) return null;
  return { term, year: 2000 + yy };
}

/**
 * The (term, year) a plan column maps to — reusing semesters.ts's math: odd sem
 * = Fall, even = Spring; Fall year = enteringYear + (sem-1)/2, Spring year =
 * enteringYear + sem/2. Null when enteringYear is unknown (the app can't place
 * the column on the calendar, so it can't claim a horizon).
 */
export function semesterTermYear(sem: number, enteringYear: number | null): TermYear | null {
  if (!enteringYear) return null;
  const term: Term = sem % 2 === 1 ? "FA" : "SP";
  const year = term === "FA" ? enteringYear + (sem - 1) / 2 : enteringYear + sem / 2;
  return { term, year };
}

// Chronological rank of the four terms WITHIN a calendar year. Only FA/SP are
// ever generated as plan columns, so this ordering exists purely to make the
// past/far comparison total; SU/WI are a best-effort placement (a target rarely
// names them). For the exercised FA/SP path the key is strictly chronological:
// FA25 (253) < SP26 (261) < FA26 (263).
const TERM_RANK: Record<Term, number> = { SP: 1, SU: 2, FA: 3, WI: 4 };
function termKey(ty: TermYear): number {
  return ty.year * 10 + TERM_RANK[ty.term];
}

/**
 * near iff the column's term+year exactly equals the parsed target; past iff
 * strictly before it; far otherwise. enteringYear OR target null (or a
 * malformed target slug) → "far" for EVERYTHING — the honest default: no near
 * horizon until the app knows both, and no "past" claim we can't substantiate.
 */
export function horizonForSemester(
  sem: number,
  enteringYear: number | null,
  target: string | null | undefined
): Horizon {
  const t = parseRosterSlug(target ?? null);
  const s = semesterTermYear(sem, enteringYear);
  if (!t || !s) return "far";
  const sk = termKey(s);
  const tk = termKey(t);
  if (sk === tk) return "near";
  if (sk < tk) return "past";
  return "far";
}
