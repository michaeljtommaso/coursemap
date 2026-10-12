import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchCatalogIndex,
  fetchCatalogMeta,
  fetchCoursesByIds,
} from "@/services/catalog";
import { rankSearch } from "@/lib/catalog/rankSearch";
import { recordToCourse } from "@/lib/catalog/recordToCourse";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";

/**
 * CatalogProvider — fetch-once-and-cache the catalogIndex chunks, then search in
 * memory (docs/specs/002 §3/§5). useRef guard prevents a double-fetch under
 * StrictMode; exposes an error+retry surface the Phase 1 UI consumes.
 *
 * Search keeps the old searchCourses match set (a query like "CS 1110" matches
 * ids as "CS-1110"; the raw query matches titles case-insensitively) and ranks
 * it via src/lib/catalog/rankSearch (bug-sweep K2).
 *
 * Also owns the on-demand full-course-doc cache (courseDetails): the compact
 * search index carries no prereq/coreq/offered data, so the card-status engine
 * and catalog chips fetch full docs here for the SPECIFIC ids they need — batched
 * by 10, deduped, session-cached. Never a catalog scan.
 */

type CatalogContextValue = {
  index: CatalogIndexRecord[];
  /** Cross-listing map (ENGRD-2110 → CS-2110) from catalog/meta. Degrades to {}. */
  aliases: Record<string, string>;
  /** Enrollment-target roster slug ("FA26") from catalog/meta (spec 012 §1) —
   *  the semester students are enrolling for, driving the near/far horizon.
   *  null until we set it (docs predate the field) → everything reads "far". */
  enrollmentTarget: string | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Ranked in-memory search (see rankSearch). `filter` narrows before ranking. */
  search: (
    query: string,
    limit?: number,
    filter?: (r: CatalogIndexRecord) => boolean
  ) => Course[];
  /** Full course docs (real prereq/coreq/offered) keyed by id, fetched on demand
   *  for the ids passed to ensureCourseDetails. The compact search index never
   *  carries exprs, so this is the ONLY in-app source of them. */
  courseDetails: Record<string, Course>;
  /** Ensure the full docs for these ids are cached. Batched, deduped across the
   *  session (each id fetched at most once), and STRICTLY the ids passed — never
   *  a catalog scan. Cheap no-op once an id is cached or in flight. */
  ensureCourseDetails: (ids: string[]) => void;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<CatalogIndexRecord[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [enrollmentTarget, setEnrollmentTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetchedRef = useRef(false);

  // On-demand full-course-doc cache (real prereq/coreq/offered). Session-lived:
  // a map that only ever grows, so plan switches / re-renders / re-searches never
  // refetch an id. `requestedRef` tracks ids already fetched OR in flight
  // (including ids that came back missing) so the same id is never requested
  // twice — this is what makes a full-catalog scan impossible by construction.
  const [courseDetails, setCourseDetails] = useState<Record<string, Course>>({});
  const requestedRef = useRef<Set<string>>(new Set());

  const ensureCourseDetails = useCallback((ids: string[]) => {
    const missing = ids.filter((id) => id && !requestedRef.current.has(id));
    if (missing.length === 0) return;
    // Mark requested up front so a concurrent/rapid caller can't double-fetch.
    for (const id of missing) requestedRef.current.add(id);
    fetchCoursesByIds(missing)
      .then((courses) => {
        if (courses.length === 0) return;
        setCourseDetails((prev) => {
          const next = { ...prev };
          for (const c of courses) next[c.id] = c;
          return next;
        });
      })
      .catch((err) => {
        console.warn("[catalog] course-detail fetch failed", err);
        // Un-mark so a later render can retry these ids.
        for (const id of missing) requestedRef.current.delete(id);
      });
  }, []);

  // A retry resets the visible state here, in the event, so the effect below
  // only ever sets state from async results (loading starts true on mount).
  const refetch = useCallback(() => {
    fetchedRef.current = false;
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // Session-owned provider. See ProgramProvider for why the state setters aren't
  // gated by a per-run cancel flag (StrictMode double-invoke + ref guard would
  // otherwise strand loading=true).
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchCatalogIndex()
      .then((records) => setIndex(records))
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        fetchedRef.current = false; // allow retry
      })
      .finally(() => setLoading(false));
    // Aliases + enrollmentTarget come from catalog/meta — both enhancements that
    // degrade gracefully (aliases → {}, enrollmentTarget → null / all far).
    fetchCatalogMeta()
      .then((meta) => {
        setAliases((meta.aliases as Record<string, string>) ?? {});
        const target = meta.enrollmentTarget;
        setEnrollmentTarget(typeof target === "string" ? target : null);
      })
      .catch((err) => console.warn("[catalog] meta/aliases unavailable", err));
  }, [reloadKey]);

  // Ranked in-memory search over the loaded index (src/lib/catalog/rankSearch:
  // exact subject → subject prefix → title → other code hits). Never fetches.
  const search = useCallback(
    (query: string, limit = 40, filter?: (r: CatalogIndexRecord) => boolean): Course[] =>
      rankSearch(index, query, { limit, aliases, filter }).map(recordToCourse),
    [index, aliases]
  );

  const value = useMemo(
    () => ({
      index,
      aliases,
      enrollmentTarget,
      loading,
      error,
      refetch,
      search,
      courseDetails,
      ensureCourseDetails,
    }),
    [index, aliases, enrollmentTarget, loading, error, refetch, search, courseDetails, ensureCourseDetails]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogContext(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogContext must be used within CatalogProvider");
  return ctx;
}
