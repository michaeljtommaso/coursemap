import type { ReviewsProvider } from "./types";
import { NullAdapter } from "./NullAdapter";
import { RmpAdapter } from "./RmpAdapter";

/**
 * reviews/index.ts (spec 013 §3a) — provider SELECTION. App code calls
 * getReviewsProvider() (or the useReviews() hook) and never learns which
 * adapter it got. Choosing a provider is a one-constant config change here.
 *
 * REVIEWS_PROVIDER stays "null" by DEFAULT — the NullAdapter is the wired
 * default and the kill switch (every professor surface renders its honest empty
 * state, nothing crashes; the NullAdapter smoke test guards that). The
 * RmpAdapter is now BUILT and registered below, but flipping the constant to
 * "rmp" is THE LAUNCH SWITCH and is deliberately NOT flipped this session: the
 * professorReviews / courseInstructorHistory collections are empty until Michael
 * runs the offline pipeline (scripts/rmp-sync.ts + instructor-history-sync.ts),
 * so the shipped default must remain the NullAdapter. Do not flip it here.
 */

type ProviderKind = "null" | "rmp";

const REVIEWS_PROVIDER: ProviderKind = "null";

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
