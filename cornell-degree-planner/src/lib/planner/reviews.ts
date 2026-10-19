/**
 * reviews.ts (spec 013 §3) — PURE review helpers: the staleness rule, the
 * doc→summary / docs→course-view mappers, the divergence ("varies by
 * instructor") math, and the display formatters. No React, no Firestore. The
 * RmpAdapter is a thin Firestore shell over these mappers (same pure-core / IO-
 * shell split as scripts/roster-convert.ts), so every rule below is unit-tested
 * offline and the adapter can't drift from it.
 *
 * GUARDRAILS ENCODED HERE (spec §3e):
 *  - Stale-then-hidden, never wrong: a summary past the staleness cutoff is
 *    treated as ABSENT (returns null) — the scraper rots silently rather than
 *    showing an aged rating as current.
 *  - Rating + difficulty + link + capped snippet ONLY. These mappers never
 *    surface full review text; `topSnippet` is a ≤160-char field carried
 *    verbatim from the pipeline and gated by its own flag at the render site.
 */

import { parseRosterSlug, horizonForSemester, semesterTermYear } from "./horizon";
import type {
  ProfessorSummary,
  CourseReviewView,
  CourseProfessorEntry,
  CourseHistoryEntry,
} from "@/services/reviews";

/** Staleness cutoff (spec §3b): once a summary's fetch is older than this it
 *  auto-hides — the "as of" stamp aged past its shelf life. 90 days spans a
 *  semester + the pre-enrollment refresh window. */
export const STALE_AFTER_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Divergence thresholds (spec §3d) — the "varies by instructor" badge fires
 *  when the per-professor rating spread is at least this wide across at least
 *  this many rated instructors, each with at least this many ratings behind
 *  them (min-N so a single-review outlier can't mint a badge). */
export const VARIES_MIN_SPREAD = 1.0;
export const VARIES_MIN_RATED = 2;
export const VARIES_MIN_COUNT = 3;

/** Nominative branding ONLY (spec §3e guardrail 4) — the ONE place this string
 *  is minted. Never "built in", never an implied partnership. */
export const RMP_LABEL = "via RateMyProfessors";
/** Probable-tier hedge copy (spec §3c) — shown INSTEAD of a plain rating when a
 *  match is fuzzy; the rating still renders but visibly styled unverified. */
export const PROBABLE_HEDGE = "We think this is them — double-check on RMP";

/** The probable-match hedge, naming the RMP page's name when it differs from
 *  Cornell's (spec 016 D6): the name mismatch is the reason for the doubt. */
export function probableHedge(instructor: string, rmpName: string | null | undefined): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!rmpName || norm(rmpName) === norm(instructor)) return PROBABLE_HEDGE;
  return `We think this is them (RMP lists "${rmpName}") — double-check on RMP`;
}

// ─── The pipeline doc shapes these mappers consume (camelCase Firestore) ──────
// Mirrors ProfessorReviewsSchema / CourseInstructorHistorySchema in schemas.ts;
// kept as plain types here so this module stays zod-free and importable anywhere.
export type ProfessorReviewsDocLike = {
  netid: string;
  displayName?: string | null;
  match: { tier: "verified" | "probable"; candidateName?: string | null; url: string };
  rating: number | null;
  difficulty: number | null;
  count: number | null;
  topSnippet?: string | null;
  perCourse?: Array<{ courseId: string; rating: number | null; difficulty: number | null; count: number }>;
  fetchedAt?: unknown;
  source?: string;
};
export type CourseInstructorHistoryDocLike = {
  courseId: string;
  terms: Array<{ roster: string; instructors: Array<{ netid: string; name: string }> }>;
  fetchedAt?: unknown;
};

/**
 * Coerce a Firestore `fetchedAt` (Timestamp | Date | epoch-ms | ISO string) to
 * epoch millis, or null when it's absent/unparseable. Defensive: an unreadable
 * stamp reads as "no known fetch time" → treated as stale (hidden), never as
 * fresh — the honest failure direction.
 */
export function toFetchedAtMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }
  // Firestore Timestamp — either the SDK object (.toMillis()) or a plain
  // {seconds,nanoseconds} shape after a JSON round-trip.
  if (typeof raw === "object") {
    const o = raw as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === "function") {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : null;
    }
    const secs = typeof o.seconds === "number" ? o.seconds : o._seconds;
    if (typeof secs === "number" && Number.isFinite(secs)) return secs * 1000;
  }
  if (typeof raw === "string") {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Stale-then-hidden (spec §3b): null (unknown fetch) OR older than the cutoff
 *  → true (hide the surface). Boundary is inclusive-fresh: exactly the cutoff
 *  age is still shown. */
export function isReviewStale(
  fetchedAtMs: number | null,
  nowMs: number,
  maxDays: number = STALE_AFTER_DAYS
): boolean {
  if (fetchedAtMs == null) return true;
  return nowMs - fetchedAtMs > maxDays * MS_PER_DAY;
}

/**
 * professorReviews doc → ProfessorSummary, or null when the doc is stale
 * (spec §3b auto-hide) — the adapter also returns null when the doc is ABSENT,
 * so together these are the whole "no data" story. The tier maps to the
 * interface's `confidence`; the deep link comes from `match.url`.
 */
export function summaryFromDoc(
  doc: ProfessorReviewsDocLike,
  nowMs: number
): ProfessorSummary | null {
  if (isReviewStale(toFetchedAtMs(doc.fetchedAt), nowMs)) return null;
  // RMP reports avgRating 0 for a professor with no ratings; that is "no
  // rating", never a 0.0 score, so the line links out instead of showing stars.
  const unrated = !doc.count;
  const summary: ProfessorSummary = {
    rating: unrated ? null : doc.rating,
    difficulty: unrated ? null : doc.difficulty,
    count: doc.count ?? 0,
    confidence: doc.match.tier,
    url: doc.match.url,
  };
  if (typeof doc.topSnippet === "string" && doc.topSnippet.length > 0) {
    summary.topSnippet = doc.topSnippet;
  }
  if (doc.match.tier === "probable" && doc.match.candidateName) {
    summary.rmpName = doc.match.candidateName;
  }
  return summary;
}

/** Chronological sort key for a roster slug ("FA25" < "SP26" < "FA26"), so the
 *  "most recent roster" is deterministic. Unparseable slugs sort last (0). */
function rosterKey(slug: string): number {
  const ty = parseRosterSlug(slug);
  if (!ty) return 0;
  const rank = ty.term === "SP" ? 1 : ty.term === "SU" ? 2 : ty.term === "FA" ? 3 : 4;
  return ty.year * 10 + rank;
}

/**
 * courseInstructorHistory + the joined professorReviews summaries → the
 * per-course review view (spec §3d). `summaries` is a per-netid lookup the
 * adapter has already staleness-filtered (a stale/absent summary is simply
 * omitted). Returns:
 *   - perProfessor: the MOST RECENT roster's instructors that have a live
 *     summary, one entry each (rating/difficulty/url/tier/count/snippet);
 *   - history: every (term, instructor) with a live summary, newest term first,
 *     each carrying the deep link — "show the data, student draws the
 *     conclusion".
 * null when nothing joins (no live summary for any instructor in any term) —
 * the honest empty state, never an empty shell.
 */
export function courseViewFromDocs(
  history: CourseInstructorHistoryDocLike | null,
  summaries: Map<string, ProfessorSummary>
): CourseReviewView | null {
  if (!history || !Array.isArray(history.terms) || history.terms.length === 0) {
    return null;
  }
  const terms = [...history.terms].sort((a, b) => rosterKey(b.roster) - rosterKey(a.roster));

  // perProfessor — the latest roster's instructors that have a live summary.
  const latest = terms[0];
  const perProfessor: CourseProfessorEntry[] = [];
  const seenNet = new Set<string>();
  for (const instr of latest?.instructors ?? []) {
    const s = summaries.get(instr.netid);
    if (!s || seenNet.has(instr.netid)) continue;
    seenNet.add(instr.netid);
    const entry: CourseProfessorEntry = {
      instructor: instr.name,
      netid: instr.netid,
      rating: s.rating,
      difficulty: s.difficulty,
      url: s.url,
      confidence: s.confidence,
      count: s.count,
    };
    if (s.topSnippet) entry.topSnippet = s.topSnippet;
    if (s.rmpName) entry.rmpName = s.rmpName;
    perProfessor.push(entry);
  }

  // history — every (term, instructor) with a live summary, newest first.
  const timeline: CourseHistoryEntry[] = [];
  for (const term of terms) {
    for (const instr of term.instructors ?? []) {
      const s = summaries.get(instr.netid);
      if (!s) continue;
      timeline.push({
        term: term.roster,
        instructor: instr.name,
        netid: instr.netid,
        rating: s.rating,
        url: s.url,
      });
    }
  }

  if (perProfessor.length === 0 && timeline.length === 0) return null;
  return { perProfessor, history: timeline };
}

/**
 * "Varies by instructor" (spec §3d) — true when the rated instructors (rating
 * present AND at least VARIES_MIN_COUNT ratings behind them) number at least
 * VARIES_MIN_RATED and their rating spread reaches VARIES_MIN_SPREAD. A pure
 * predicate so the badge decision is testable and identical on the card, the
 * panel, and the hub.
 */
export function variesByInstructor(
  entries: Array<{ rating: number | null; count?: number | null }>
): boolean {
  const ratings = entries
    .filter((e) => e.rating != null && (e.count ?? 0) >= VARIES_MIN_COUNT)
    .map((e) => e.rating as number);
  if (ratings.length < VARIES_MIN_RATED) return false;
  const spread = Math.max(...ratings) - Math.min(...ratings);
  return spread >= VARIES_MIN_SPREAD;
}

/** "4.2 ★" — one decimal, or null when there's no rating (never "N/A"). */
export function formatStars(rating: number | null): string | null {
  return rating == null ? null : `${rating.toFixed(1)} ★`;
}

/** "difficulty 3.1" — one decimal, or null when RMP has no difficulty score. */
export function formatDifficulty(difficulty: number | null): string | null {
  return difficulty == null ? null : `difficulty ${difficulty.toFixed(1)}`;
}

// ─── "Last time" line for future-term cards (spec 017 D8/D9) ──────────────────

const SEASON_NAME: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

/** "FA26" → "Fall 2026"; null for an unparseable slug (never guess a term). */
export function rosterTermLabel(slug: string | null | undefined): string | null {
  const ty = parseRosterSlug(slug);
  return ty ? `${SEASON_NAME[ty.term]} ${ty.year}` : null;
}

/** The most recent same-season term in a course's instructor history: its
 *  roster slug, its first listed instructor, and how many OTHER distinct
 *  instructors taught that term. */
export type SameSeasonEntry = { roster: string; netid: string; name: string; more: number };

/**
 * The newest term in `history` whose roster season matches `season` and that
 * names at least one instructor, or null when there is none. Terms with no
 * named instructor (staff / TBA) are skipped; the returned `roster` is the
 * term's own slug, so the line always says which term it reports.
 */
export function lastSameSeasonEntry(
  history: CourseInstructorHistoryDocLike | null | undefined,
  season: "FA" | "SP"
): SameSeasonEntry | null {
  if (!history || !Array.isArray(history.terms)) return null;
  const terms = history.terms
    .filter((t) => parseRosterSlug(t.roster)?.term === season)
    .sort((a, b) => rosterKey(b.roster) - rosterKey(a.roster));
  for (const term of terms) {
    const named = (term.instructors ?? []).filter((i) => i && i.netid && i.name);
    if (named.length === 0) continue;
    const first = named[0];
    const others = new Set(named.filter((i) => i.netid !== first.netid).map((i) => i.netid));
    return { roster: term.roster, netid: first.netid, name: first.name, more: others.size };
  }
  return null;
}

/**
 * The season of a plan column that is AFTER the enrollment term (horizon
 * "far"), or null when the column is the enrollment term, already past, or
 * when the target or entering year is unknown (no distance can be claimed).
 */
export function lastTimeSeason(
  sem: number,
  enteringYear: number | null,
  target: string | null | undefined
): "FA" | "SP" | null {
  if (!enteringYear || !parseRosterSlug(target)) return null;
  if (horizonForSemester(sem, enteringYear, target) !== "far") return null;
  return semesterTermYear(sem, enteringYear)?.term === "SP" ? "SP" : "FA";
}

/**
 * "Last fall (Fall 2026): Ada Lovelace · 4.0 ★ +1" (spec 017 D8). The term
 * label is part of the same string, so it always renders at the name's size
 * (D9: outside the enrollment term a rating never appears without the term it
 * came from). "≈" marks a probable match; with no live rating (or ratings
 * switched off → `summary` null) the line names the instructor only.
 *
 * "Last" is only said of a term that has already happened, i.e. one strictly
 * before the enrollment target. The newest same-season history term can BE the
 * target (its roster is published before it starts) or, in principle, later;
 * then the line names the term without "Last" ("Spring 2027: Ada Lovelace").
 * An unknown target can't prove the term is past, so it also drops "Last".
 */
export function lastTimeLine(
  columnSeason: "FA" | "SP",
  entry: SameSeasonEntry,
  summary: ProfessorSummary | null,
  target: string | null | undefined
): string | null {
  const term = rosterTermLabel(entry.roster);
  if (!term || !entry.name) return null;
  const word = columnSeason === "FA" ? "fall" : "spring";
  const past = !!parseRosterSlug(target) && rosterKey(entry.roster) < rosterKey(target as string);
  let line = past ? `Last ${word} (${term}): ${entry.name}` : `${term}: ${entry.name}`;
  const stars = summary ? formatStars(summary.rating) : null;
  if (stars) line += ` · ${summary?.confidence === "probable" ? "≈" : ""}${stars}`;
  if (entry.more > 0) line += ` +${entry.more}`;
  return line;
}
