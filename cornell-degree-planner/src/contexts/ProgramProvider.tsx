import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchPrograms, fetchProgram } from "@/services/programs";
import type { Program, ProgramSlotWithData } from "@/types/db";

/**
 * ProgramProvider — owns the program list (fetch-once) and a cache-by-id of
 * program data (slots), stale-while-revalidate on repeat visits
 * (docs/specs/002 §5). Only services/programs.ts touches Firestore; this caches.
 * Authored edges are dead (spec 008 §2b) — the cached data no longer carries an
 * edges array; the canvas derives its wires from placed courses.
 *
 * Exposes the raw async surface the thin hooks (usePrograms/useProgramData) wrap
 * so those hooks keep their exact { data..., loading, error, refetch } signatures
 * that Phase 1's error-with-retry UI consumes.
 */

type ProgramData = { slots: ProgramSlotWithData[] };

type ProgramContextValue = {
  // list
  programs: Program[];
  programsLoading: boolean;
  programsError: Error | null;
  refetchPrograms: () => void;
  // per-id data cache
  getProgramData: (id: string) => ProgramData | undefined; // cached, if present
  loadProgramData: (id: string) => Promise<ProgramData | null>;
};

const ProgramContext = createContext<ProgramContextValue | null>(null);

export function ProgramProvider({ children }: { children: React.ReactNode }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsError, setProgramsError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const listFetchedRef = useRef(false);

  // id → data cache; a plain ref (mutations don't need to re-render the provider,
  // the consuming hook holds the rendered copy).
  const cacheRef = useRef<Map<string, ProgramData>>(new Map());
  const inflightRef = useRef<Map<string, Promise<ProgramData | null>>>(new Map());

  // A retry resets the visible state here, in the event, so the effect below
  // only ever sets state from async results (loading starts true on mount).
  const refetchPrograms = useCallback(() => {
    listFetchedRef.current = false;
    setProgramsLoading(true);
    setProgramsError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // Session-owned provider (mounted once above the shell). The ref guard dedupes
  // the fetch across StrictMode's double-invoke; we deliberately DON'T tie the
  // state setters to a per-run cancel flag — the first (only) fetch must be
  // allowed to resolve, or StrictMode's second run (which the ref short-circuits)
  // would leave loading stuck true forever.
  useEffect(() => {
    if (listFetchedRef.current) return;
    listFetchedRef.current = true;
    fetchPrograms()
      .then((list) => setPrograms(list))
      .catch((err) => {
        setProgramsError(err instanceof Error ? err : new Error(String(err)));
        listFetchedRef.current = false; // allow retry
      })
      .finally(() => setProgramsLoading(false));
  }, [reloadKey]);

  const getProgramData = useCallback((id: string) => cacheRef.current.get(id), []);

  const loadProgramData = useCallback(
    async (id: string): Promise<ProgramData | null> => {
      const cached = cacheRef.current.get(id);
      if (cached) return cached; // fetch-once (stale-while-revalidate handled by hook)
      const inflight = inflightRef.current.get(id);
      if (inflight) return inflight;
      const p = fetchProgram(id)
        .then((data) => {
          if (data) cacheRef.current.set(id, data);
          inflightRef.current.delete(id);
          return data;
        })
        .catch((err) => {
          inflightRef.current.delete(id);
          throw err;
        });
      inflightRef.current.set(id, p);
      return p;
    },
    []
  );

  const value = useMemo(
    () => ({
      programs,
      programsLoading,
      programsError,
      refetchPrograms,
      getProgramData,
      loadProgramData,
    }),
    [programs, programsLoading, programsError, refetchPrograms, getProgramData, loadProgramData]
  );

  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
}

export function useProgramContext(): ProgramContextValue {
  const ctx = useContext(ProgramContext);
  if (!ctx) throw new Error("useProgramContext must be used within ProgramProvider");
  return ctx;
}
