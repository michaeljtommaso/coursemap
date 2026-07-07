import { useState, useEffect, useCallback } from "react";
import { searchCourses } from "@/lib/db/courses";
import type { Course } from "@/types/db";

export function useCourseSearch(query: string) {
  const [results, setResults] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Bump to re-run the search effect (Retry button — spec 003 §5.2).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      searchCourses(query)
        .then(setResults)
        .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, reloadKey]);

  return { results, loading, error, refetch };
}
