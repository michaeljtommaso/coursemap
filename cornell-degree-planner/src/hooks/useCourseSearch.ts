import { useState, useEffect } from "react";
import { useCatalogContext, recordToCourse } from "@/contexts/CatalogProvider";
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
 * relevant). When no predicate is supplied or no filter is active, the classic
 * substring search path runs unchanged.
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
  const { loading, error, refetch, search, index } = useCatalogContext();
  const [results, setResults] = useState<Course[]>([]);

  useEffect(() => {
    // Render-cost debounce only (data is already local).
    const timer = setTimeout(() => {
      if (!predicate || !anyFilterActive(filters)) {
        setResults(search(query));
        return;
      }
      // Filtered path — substring match (same normalization as search) AND the
      // shared predicate, projected to Course, capped at 40 like the base search.
      const q = query.trim();
      const idQ = q.toUpperCase().replace(/\s+/g, "-");
      const titleQ = q.toLowerCase();
      const matched = index
        .filter(
          (r) =>
            (!q || r.id.toUpperCase().includes(idQ) || r.title.toLowerCase().includes(titleQ)) &&
            predicate(r, filters!)
        )
        .slice(0, 40)
        .map(recordToCourse);
      setResults(matched);
    }, 100);
    return () => clearTimeout(timer);
  }, [query, filters, predicate, search, index]);

  return { results, loading, error, refetch };
}
