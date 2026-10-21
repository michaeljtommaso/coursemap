import { ProfessorRatingsDocSchema, type CatalogIndexRecord } from "@/lib/schemas";
import { isReviewStale } from "@/lib/planner/reviews";
import { parseRosterSlug } from "@/lib/planner/horizon";

/**
 * Professor ratings for the /classes directory (spec 017 D4/D5/D7) — the pure
 * half: the catalog/professorRatings doc → a per-netid map (stale entries
 * dropped with the panel's 90-day rule), and the "well-rated" test the filter
 * chip uses. No fetching here; services/professorRatings.ts owns the one read.
 */

export type RatingTier = "verified" | "probable";

export type ProfessorRating = {
  rating: number;
  count: number;
  tier: RatingTier;
  fetchedAtMs: number;
};

export type ProfessorRatingsMap = ReadonlyMap<string, ProfessorRating>;

export const EMPTY_RATINGS: ProfessorRatingsMap = new Map();

/** The well-rated chip's floor: "4+ ★, 5+ reviews". */
export const WELL_RATED_MIN_RATING = 4.0;
export const WELL_RATED_MIN_COUNT = 5;

/**
 * Raw doc data → live ratings. A doc that doesn't parse yields an empty map
 * (names still show); a single bad entry is dropped by the schema; an entry
 * fetched more than STALE_AFTER_DAYS ago is dropped here, the same cutoff the
 * course panel applies, so an aged rating never reads as current. An entry with
 * no reviews (c 0) or no positive rating is dropped too: the panel treats a
 * zero-review professor as unrated, so the row must not show "0.0 ★".
 */
export function ratingsFromDoc(data: unknown, nowMs: number): Map<string, ProfessorRating> {
  const out = new Map<string, ProfessorRating>();
  const parsed = ProfessorRatingsDocSchema.safeParse(data);
  if (!parsed.success) return out;
  for (const [netid, e] of Object.entries(parsed.data.ratings)) {
    if (isReviewStale(e.at, nowMs)) continue;
    if (e.c <= 0 || e.r <= 0) continue;
    out.set(netid, {
      rating: e.r,
      count: e.c,
      tier: e.t === "v" ? "verified" : "probable",
      fetchedAtMs: e.at,
    });
  }
  return out;
}

/** The rating as the row displays it (one decimal), so the filter and the row
 *  can never disagree about a 3.95 that shows as "4.0 ★". */
export function displayedRating(rating: number): number {
  return Math.round(rating * 10) / 10;
}

/**
 * The rating a /classes row shows for its lead lecturer, or null when the row
 * shows the name alone. Shared by the row (targetFilter.leadLine) and the
 * well-rated chip so the two can never disagree. A rating is joined only when
 * the lead has a netid (a name-only lead is never matched to anyone) and the
 * course's roster is known: either the enrollment term itself or a parseable
 * term the row can label ("Fall 2026: …"), never bare (spec 013 guardrail 3 as
 * amended by spec 017 D9).
 */
export function rowRating(
  record: Pick<CatalogIndexRecord, "lead" | "roster">,
  target: string | null | undefined,
  ratings: ProfessorRatingsMap | null | undefined
): ProfessorRating | null {
  const lead = record.lead;
  if (!lead || !ratings) return null;
  const netid = lead.netid.trim();
  if (!netid || !lead.name.trim()) return null;
  const roster = record.roster;
  if (!roster) return null;
  if (roster !== target && !parseRosterSlug(roster)) return null;
  return ratings.get(netid) ?? null;
}

/**
 * Does this row's lead lecturer clear the well-rated floor? Judged on exactly
 * the rating the row shows (rowRating): no roster, a name-only lead, or no live
 * rating → false. Verified matches only (a probable match is a guess and never
 * passes); at least 5 reviews; a displayed rating of 4.0 or more.
 */
export function isWellRated(
  record: Pick<CatalogIndexRecord, "lead" | "roster">,
  ratings: ProfessorRatingsMap | null | undefined,
  target?: string | null
): boolean {
  const r = rowRating(record, target, ratings);
  if (!r || r.tier !== "verified") return false;
  return r.count >= WELL_RATED_MIN_COUNT && displayedRating(r.rating) >= WELL_RATED_MIN_RATING;
}

/**
 * Whether /classes offers the well-rated chip (spec 017 D7): only with the
 * ratings feature on AND the ratings read settled with at least one entry. Off,
 * loading, or an empty/missing ratings doc all hide it (never a filter that
 * would narrow the list to nothing).
 */
export function wellRatedChipVisible(enabled: boolean, ready: boolean, size: number): boolean {
  return enabled && ready && size > 0;
}
