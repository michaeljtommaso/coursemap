import { ProfessorRatingsDocSchema, type CatalogIndexLead } from "@/lib/schemas";
import { isReviewStale } from "@/lib/planner/reviews";

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
 * course panel applies, so an aged rating never reads as current.
 */
export function ratingsFromDoc(data: unknown, nowMs: number): Map<string, ProfessorRating> {
  const out = new Map<string, ProfessorRating>();
  const parsed = ProfessorRatingsDocSchema.safeParse(data);
  if (!parsed.success) return out;
  for (const [netid, e] of Object.entries(parsed.data.ratings)) {
    if (isReviewStale(e.at, nowMs)) continue;
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
 * Does this lead lecturer clear the well-rated floor? Verified matches only (a
 * probable match is a guess and never passes); at least 5 reviews; a displayed
 * rating of 4.0 or more. No lead or no live rating → false.
 */
export function isWellRated(
  lead: CatalogIndexLead | null | undefined,
  ratings: ProfessorRatingsMap | null | undefined
): boolean {
  if (!lead || !ratings) return false;
  const r = ratings.get(lead.netid);
  if (!r || r.tier !== "verified") return false;
  return r.count >= WELL_RATED_MIN_COUNT && displayedRating(r.rating) >= WELL_RATED_MIN_RATING;
}
