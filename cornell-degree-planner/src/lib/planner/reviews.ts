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

import { parseRosterSlug } from "./horizon";
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
