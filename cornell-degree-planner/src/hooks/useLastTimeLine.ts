import { useEffect, useState } from "react";
import { useReviews } from "@/contexts/ReviewsProvider";
import { FEATURES } from "@/config/features";
import { getInstructorHistory } from "@/services/instructorHistory";
import { lastSameSeasonEntry, lastTimeLine } from "@/lib/planner/reviews";

/**
 * useLastTimeLine (spec 017 D8) — the "Last fall (Fall 2026): Martin Graef ·
 * 4.0 ★" line for a course placed in a column after the enrollment term.
 *
 * Lazy: nothing is read until a caller passes a course id AND a season (only
 * future-column cards and the panel's far view do). The history doc comes from
 * the shared per-course cache (one read per course per session); the rating
 * comes from the reviews provider, which caches per professor and resolves null
 * when ratings are off or stale, leaving the name alone. Resolves to null while
 * loading and whenever there's nothing honest to say, so callers render
 * nothing in those cases (no placeholder, no layout reserved).
 */
export function useLastTimeLine(
  courseId: string | null,
  season: "FA" | "SP" | null
): string | null {
  const reviews = useReviews();
  const key = courseId && season ? `${courseId}|${season}` : null;
  const [result, setResult] = useState<{ key: string; line: string | null } | null>(null);

  useEffect(() => {
    if (!courseId || !season || !key) return;
    let cancelled = false;
    void (async () => {
      const history = await getInstructorHistory(courseId);
      const entry = lastSameSeasonEntry(history, season);
      if (!entry) {
        if (!cancelled) setResult({ key, line: null });
        return;
      }
      const summary = FEATURES.rateMyProfessor
        ? await reviews.getProfessorSummary(entry.netid).catch(() => null)
        : null;
      if (!cancelled) setResult({ key, line: lastTimeLine(season, entry, summary) });
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, season, key, reviews]);

  return result && result.key === key ? result.line : null;
}
