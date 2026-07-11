import type { ReviewsProvider } from "./types";
import { NullAdapter } from "./NullAdapter";

/**
 * reviews/index.ts (spec 013 §3a) — provider SELECTION. App code calls
 * getReviewsProvider() (or the useReviews() hook) and never learns which
 * adapter it got. Choosing a provider is a one-constant config change here.
 *
 * REVIEWS_PROVIDER is hardcoded to "null" for now: the NullAdapter is the wired
 * default and the kill switch. The RmpAdapter lands NEXT UNIT — when it does,
 * this becomes a config-only swap (flip the constant / add the case), with no
 * component changes anywhere (the NullAdapter smoke test guards that).
 */

type ProviderKind = "null"; // widened to "null" | "rmp" next unit

const REVIEWS_PROVIDER: ProviderKind = "null";

// Module-level singleton — a provider is stateless config today; a future
// RmpAdapter may hold a preloaded cache, so building it once is the right shape.
let cached: ReviewsProvider | null = null;

export function getReviewsProvider(): ReviewsProvider {
  if (cached) return cached;
  switch (REVIEWS_PROVIDER) {
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
