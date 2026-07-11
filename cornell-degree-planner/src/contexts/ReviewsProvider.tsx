import { createContext, useContext, useMemo } from "react";
import { getReviewsProvider } from "@/services/reviews";
import type { ReviewsProvider } from "@/services/reviews";

/**
 * ReviewsProvider context (spec 013 §3a) — exposes the config-selected reviews
 * provider through React. Components read it via useReviews() and depend only on
 * the ReviewsProvider interface, never a concrete adapter. With the NullAdapter
 * wired (the default), useReviews() returns a provider whose reads resolve to
 * null, so zero professor UI renders — the kill switch, top to bottom.
 *
 * Defaults to getReviewsProvider() so a consumer outside the provider (tests,
 * isolation) still gets the configured adapter rather than throwing.
 */
const ReviewsContext = createContext<ReviewsProvider>(getReviewsProvider());

export function ReviewsProviderContext({ children }: { children: React.ReactNode }) {
  // The provider is a stable singleton from getReviewsProvider(); memo keeps the
  // context value reference-stable across renders.
  const provider = useMemo(() => getReviewsProvider(), []);
  return <ReviewsContext.Provider value={provider}>{children}</ReviewsContext.Provider>;
}

export function useReviews(): ReviewsProvider {
  return useContext(ReviewsContext);
}
