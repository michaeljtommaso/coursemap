import { useState, useEffect } from "react";
import { searchCourses } from "@/lib/db/courses";
import type { Course } from "@/types/db";

export function useCourseSearch(query: string) {
  const [results, setResults] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      searchCourses(query)
        .then(setResults)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return { results, loading };
}
