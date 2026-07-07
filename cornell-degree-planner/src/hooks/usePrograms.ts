import { useState, useEffect } from "react";
import { fetchPrograms } from "@/lib/db/programs";
import type { Program } from "@/types/db";

export function usePrograms() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    fetchPrograms()
      .then(setPrograms)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
  }, []);

  return { programs, loading, error };
}
