import { useState, useEffect } from "react";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { Course } from "@/types/db";

/**
 * Thin hook over CatalogProvider. SAME signature as the Supabase-era hook —
 * { results, loading, error, refetch } — so CourseCatalog and Phase 1's
 * error-with-retry UI consume it unchanged (docs/specs/002 §5).
 *
 * Search is now in-memory over the fetch-once catalog index (no network per
 * keystroke). The old 250ms network debounce is gone; a ~100ms debounce remains
 * purely to cut render churn on fast typing (spec §3). `loading`/`error` reflect
 * the one-time index fetch — the retry button reloads the index.
 */
export function useCourseSearch(query: string): {
  results: Course[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { loading, error, refetch, search } = useCatalogContext();
  const [results, setResults] = useState<Course[]>([]);

  useEffect(() => {
    // Render-cost debounce only (data is already local).
    const timer = setTimeout(() => {
      setResults(search(query));
    }, 100);
    return () => clearTimeout(timer);
  }, [query, search]);

  return { results, loading, error, refetch };
}
