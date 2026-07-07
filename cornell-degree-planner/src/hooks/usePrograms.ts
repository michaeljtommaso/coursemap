import { useState, useEffect, useCallback } from "react";
import { fetchPrograms } from "@/lib/db/programs";
import type { Program } from "@/types/db";

export function usePrograms() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Bump to re-run the fetch effect (Retry button — spec 003 §5.2).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPrograms()
      .then(setPrograms)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  return { programs, loading, error, refetch };
}
