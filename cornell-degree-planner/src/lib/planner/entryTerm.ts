/**
 * entryTerm.ts (spec 019 D10, Phase 2 deviation 7) — the student's first term
 * at Cornell as a roster slug ("FA25", "SP26"), and how it maps onto the
 * older `enteringYear` pref that labels the roadmap's semesters.
 *
 * The roadmap always starts with a fall column (semesters.ts: sem 1 = Fall of
 * enteringYear). A fall entrant's enteringYear is their start year. A spring
 * entrant's academic year began the previous fall, so their enteringYear is
 * the year before: Spring 2026 → 2025, which puts their first term in the
 * "Spring 2026" column (sem 2) and keeps the class year honest. Pure.
 */

export type EntrySeason = "FA" | "SP";

/** The start years first run offers (with Fall or Spring): the last three
 *  years, this year and next (an incoming student planning ahead), from the
 *  date rather than a list that goes stale. */
export function startYearOptions(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return [y - 3, y - 2, y - 1, y, y + 1];
}

const ENTRY_RE = /^(FA|SP)(\d{2})$/;

/** Season + four-digit year → roster slug ("FA", 2025 → "FA25"). */
export function entryTermFrom(season: EntrySeason, year: number): string {
  return `${season}${String(year % 100).padStart(2, "0")}`;
}

/** Roster slug → season + four-digit year, or null for anything but a fall or
 *  spring slug (summer/winter starts aren't offered). */
export function parseEntryTerm(term: string | null | undefined): { season: EntrySeason; year: number } | null {
  const m = term ? ENTRY_RE.exec(term) : null;
  if (!m) return null;
  return { season: m[1] as EntrySeason, year: 2000 + Number(m[2]) };
}

/** The enteringYear that labels the semesters for this start term (see the
 *  file comment): fall → that year, spring → the year before. */
export function enteringYearForEntryTerm(term: string | null | undefined): number | null {
  const parsed = parseEntryTerm(term);
  if (!parsed) return null;
  return parsed.season === "FA" ? parsed.year : parsed.year - 1;
}

/** A best guess to PRE-SELECT (never save) for a returning student who set
 *  a start year before start terms existed: they picked "Fall <year>". */
export function guessEntryFromEnteringYear(enteringYear: number | null): { season: EntrySeason; year: number } | null {
  return enteringYear ? { season: "FA", year: enteringYear } : null;
}
