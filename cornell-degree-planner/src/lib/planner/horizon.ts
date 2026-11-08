/**
 * horizon.ts (spec 012 §1) — the pure time-distance math behind the honesty
 * rule: "a card never displays data whose shelf life is shorter than the
 * card's distance." A plan column is `near` (the enrollment-target semester),
 * `past` (already behind the target), or `far` (everything else / unknown).
 *
 * Pure + unit-tested. No React, no data fetching. `enrollmentTarget` comes from
 * catalog/meta (CatalogProvider); `enteringYear` from the student's profile.
 */

import { SEASON_ORDER, type Season } from "@/lib/planner/terms";

export type Term = Season;
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

// Chronological rank of the four terms WITHIN a calendar year — Cornell's real
// order (terms.ts SEASON_ORDER, same as distribution/select.ts termOrdinal):
// the winter session is JANUARY, so WI26 sits between FA25 and SP26 (spec 042
// D11; it used to rank after FA). Strictly chronological:
// FA25 < WI26 < SP26 < SU26 < FA26.
const TERM_RANK: Record<Term, number> = SEASON_ORDER;
/** Chronological sort key of a (term, year): year * 10 + in-year rank. */
export function termKey(ty: TermYear): number {
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

/**
 * Offered-this-term gate (spec 012 §2/§5, near-face root-cause fix 2026-07-11):
 * compares a course's `roster` field — the SLUG the last sync ran against
 * ("FA26") — to the configured enrollmentTarget.
 *
 * ⚠️ This gate must NEVER be fed course.roster_id: despite the name, that field
 * is Cornell's numeric crseId ("358546"), so comparing it to a slug is always
 * false and every near card would lie ("not offered this term").
 *
 * - "offered"      — roster known AND equal to the target.
 * - "not-offered"  — roster known AND different (the course really isn't in
 *                    this term's roster — safe to say so).
 * - "unknown"      — roster OR target missing (pre-fix docs, snapshots, no
 *                    config): never claim from missing data — no near face and
 *                    no "not offered" line.
 */
export type RosterOfferGate = "offered" | "not-offered" | "unknown";
export function rosterOfferGate(
  courseRoster: string | null | undefined,
  target: string | null | undefined
): RosterOfferGate {
  if (!courseRoster || !target) return "unknown";
  return courseRoster === target ? "offered" : "not-offered";
}
