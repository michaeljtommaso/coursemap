import { useState, useEffect } from "react";
import { fetchPrograms } from "@/lib/db/programs";
import type { Program } from "@/types/db";

export function usePrograms() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPrograms()
      .then(setPrograms)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { programs, loading };
}
