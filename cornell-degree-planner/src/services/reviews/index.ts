import type { ReviewsProvider } from "./types";
import { NullAdapter } from "./NullAdapter";
import { RmpAdapter } from "./RmpAdapter";

/**
 * reviews/index.ts (spec 013 §3a) — provider SELECTION. App code calls
 * getReviewsProvider() (or the useReviews() hook) and never learns which
 * adapter it got. Choosing a provider is a one-constant config change here.
 *
 * LAUNCH SWITCH FLIPPED 2026-07-11 (Michael-authorized): the offline pipeline
 * has run — professorReviews holds 1,210 rated professors (1,149 verified + 61
 * probable of 2,554 roster instructors) and courseInstructorHistory holds
 * 11,314 course timelines (FA23–SP26) — so the RmpAdapter is now the live
 * provider. Flipping back to "null" is the kill switch: every professor
 * surface reverts to its honest empty state (NullAdapter smoke test guards
 * that), no other change needed.
 */

type ProviderKind = "null" | "rmp";

const REVIEWS_PROVIDER: ProviderKind = "rmp";

/**
 * Snippet kill switch (spec 013 §3e guardrail 2) — the top-review snippet is
 * the ONE real copyright-adjacent surface, so it rides its OWN flag independent
 * of REVIEWS_PROVIDER. Default true (the search-engine-snippet posture Michael
 * approved), but a challenge can drop the snippet ALONE by flipping this to
 * false while ratings + links keep working. Read by the render sites, which
 * additionally gate it to verified-tier matches only.
 */
export const SNIPPET_ENABLED = true;

// Module-level singleton — the RmpAdapter holds a per-session in-memory cache,
// so building it once (and reusing it across every surface) is the right shape.
let cached: ReviewsProvider | null = null;

export function getReviewsProvider(): ReviewsProvider {
  if (cached) return cached;
  switch (REVIEWS_PROVIDER) {
    case "rmp":
      cached = new RmpAdapter();
      break;
    case "null":
    default:
      cached = new NullAdapter();
  }
  return cached;
}

export type { ReviewsProvider } from "./types";
export type {
  ProfessorSummary,
  CourseReviewView,
  CourseProfessorEntry,
  CourseHistoryEntry,
} from "./types";
