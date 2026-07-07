import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchCatalogIndex, fetchCatalogMeta } from "@/services/catalog";
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
  /** Cross-listing map (ENGRD-2110 → CS-2110) from catalog/meta. Degrades to {}. */
  aliases: Record<string, string>;
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
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetchedRef = useRef(false);

  const refetch = useCallback(() => {
    fetchedRef.current = false;
    setReloadKey((k) => k + 1);
  }, []);

  // Session-owned provider. See ProgramProvider for why the state setters aren't
  // gated by a per-run cancel flag (StrictMode double-invoke + ref guard would
  // otherwise strand loading=true).
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    fetchCatalogIndex()
      .then((records) => setIndex(records))
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        fetchedRef.current = false; // allow retry
      })
      .finally(() => setLoading(false));
    // Aliases are an enhancement (Major Match canonicalization) — degrade to {}.
    fetchCatalogMeta()
      .then((meta) => setAliases((meta.aliases as Record<string, string>) ?? {}))
      .catch((err) => console.warn("[catalog] meta/aliases unavailable", err));
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
    () => ({ index, aliases, loading, error, refetch, search }),
    [index, aliases, loading, error, refetch, search]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogContext(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogContext must be used within CatalogProvider");
  return ctx;
}
