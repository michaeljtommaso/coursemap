import { useState, useEffect } from "react";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { CourseFilters } from "@/hooks/useCourseFilters";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";

/**
 * Thin hook over CatalogProvider. SAME core signature as the Supabase-era hook —
 * { results, loading, error, refetch } — so CourseCatalog and Phase 1's
 * error-with-retry UI consume it unchanged (docs/specs/002 §5).
 *
 * Search is in-memory over the fetch-once catalog index (no network per
 * keystroke). A ~100ms debounce cuts render churn on fast typing.
 *
 * Spec 006 §E3: an optional `filters` + `predicate` narrow the results over the
 * shared CourseFilters model (subject/level/credits/offered/prereqs/favorites/
 * relevant). Results are ranked by rankSearch (exact subject → subject prefix →
 * title → other code hits) whether or not a filter is active.
 */

function anyFilterActive(f?: CourseFilters): boolean {
  // "Off" is always `undefined` (the filter UIs clear a toggle to undefined);
  // a stored `false` is a real value (hasPrereqs: false = "no prereqs").
  return !!f && Object.values(f).some((v) => v !== undefined);
}

export function useCourseSearch(
  query: string,
  filters?: CourseFilters,
  predicate?: (r: CatalogIndexRecord, f: CourseFilters) => boolean
): {
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
      // Both paths share the provider's ranked search (rankSearch); the filtered
      // path narrows by the shared predicate before ranking, capped at 40.
      const filter =
        predicate && anyFilterActive(filters)
          ? (r: CatalogIndexRecord) => predicate(r, filters!)
          : undefined;
      setResults(search(query, 40, filter));
    }, 100);
    return () => clearTimeout(timer);
  }, [query, filters, predicate, search]);

  return { results, loading, error, refetch };
}
