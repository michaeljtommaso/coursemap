import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchCatalogIndex } from "@/services/catalog";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";

/**
 * CatalogProvider — fetch-once-and-cache the catalogIndex chunks, then search in
 * memory (docs/specs/002 §3/§5). useRef guard prevents a double-fetch under
 * StrictMode; exposes an error+retry surface the Phase 1 UI consumes.
 *
 * Preserves the old searchCourses normalization: a query like "CS 1110" is
 * uppercased + space→dash ("CS-1110") for id/code matching, while the raw query
 * matches the title case-insensitively.
 */

type CatalogContextValue = {
  index: CatalogIndexRecord[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  search: (query: string, limit?: number) => Course[];
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

// A compact index record is display-complete for search results; project it to
// the Course shape the catalog UI renders (unknown fields default harmlessly).
function recordToCourse(r: CatalogIndexRecord): Course {
  return {
    id: r.id,
    subject: r.subject,
    number: r.number,
    title: r.title,
    credits_min: r.creditsMin,
    credits_max: r.creditsMax,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    roster_id: null,
    updated_at: new Date(0).toISOString(),
  };
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<CatalogIndexRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetchedRef = useRef(false);

  const refetch = useCallback(() => {
    fetchedRef.current = false;
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCatalogIndex()
      .then((records) => {
        if (!cancelled) setIndex(records);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          fetchedRef.current = false; // allow retry
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const search = useCallback(
    (query: string, limit = 40): Course[] => {
      const q = query.trim();
      if (!q) {
        return [...index]
          .sort(
            (a, b) =>
              a.subject.localeCompare(b.subject) || a.number.localeCompare(b.number)
          )
          .slice(0, limit)
          .map(recordToCourse);
      }
      // "CS 1110" → "CS-1110" for id/code matching; raw for title (old searchCourses).
      const idQ = q.toUpperCase().replace(/\s+/g, "-");
      const titleQ = q.toLowerCase();
      const matches = index.filter(
        (r) =>
          r.id.toUpperCase().includes(idQ) ||
          r.title.toLowerCase().includes(titleQ)
      );
      return matches.slice(0, limit).map(recordToCourse);
    },
    [index]
  );

  const value = useMemo(
    () => ({ index, loading, error, refetch, search }),
    [index, loading, error, refetch, search]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogContext(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogContext must be used within CatalogProvider");
  return ctx;
}
