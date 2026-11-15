import { useDeferredValue, useMemo } from "react";
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
 * keystroke). The results are derived from the query, never stored, so they
 * always belong to the query they're returned with: the query is deferred
 * (useDeferredValue) so typing stays responsive, and `query` says which query
 * `results` are for. A timer-based debounce used to hold the previous query's
 * results (for "" that's the whole catalog A→Z: AAP, AAS, …) until it fired,
 * which a background tab can stretch to seconds.
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
  /** The query `results` are for: the deferred query, which can trail the
   *  one passed in for a render while React catches up. */
  query: string;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { loading, error, refetch, search } = useCatalogContext();
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    // Both paths share the provider's ranked search (rankSearch); the filtered
    // path narrows by the shared predicate before ranking, capped at 40.
    const filter =
      predicate && anyFilterActive(filters) ? (r: CatalogIndexRecord) => predicate(r, filters!) : undefined;
    return search(deferredQuery, 40, filter);
  }, [deferredQuery, filters, predicate, search]);

  return { results, query: deferredQuery, loading, error, refetch };
}
