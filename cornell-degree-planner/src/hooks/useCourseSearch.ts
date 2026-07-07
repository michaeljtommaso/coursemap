import { useState, useEffect } from "react";
import { searchCourses } from "@/lib/db/courses";
import type { Course } from "@/types/db";

export function useCourseSearch(query: string) {
  const [results, setResults] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
  }, [query]);

  return { results, loading, error };
}
