import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchProgramIndex, fetchProgram } from "@/services/programs";
import {
  fetchCollegeLayers,
  fetchConcentrationLayers,
  fetchLayer,
  type ParsedLayer,
} from "@/services/layers";
import { isDistributionFamily, programFamily } from "@/lib/planner/colleges";
import type { Program, ProgramSlotWithData } from "@/types/db";
import type { Layer, LayerFamily } from "@/lib/planner/distribution/types";

/**
 * ProgramProvider — owns the program list (fetch-once) and a cache-by-id of
 * program data, stale-while-revalidate on repeat visits (docs/specs/002 §5).
 * Only services/programs.ts and services/layers.ts touch Firestore; this caches.
 * Authored edges are dead (spec 008 §2b) — the cached data no longer carries an
 * edges array; the canvas derives its wires from placed courses.
 *
 * Exposes the raw async surface the thin hooks (usePrograms/useProgramData) wrap
 * so those hooks keep their exact { data..., loading, error, refetch } signatures
 * that Phase 1's error-with-retry UI consumes.
 *
 * Spec 019 D11: the list is the program index (one read). Program data loads by
 * the program's family: Engineering → its program doc's slots; CAS/CALS → its
 * layers (college versions of the family, the major layer, concentrations).
 * College layers are cached once per family, so Major Match loading every
 * major of one college reads them once, not once per major.
 */

/** One program's requirement data (spec 019 contract). Engineering family:
 *  `slots`. Distribution family (cas/cals): `slots` is [] (D9: no invented
 *  schedule) and `layers` holds every VALID layer the program can need — all
 *  college-layer versions of its family, its major layer, its concentration
 *  layers — for selectLayers to choose from. `layerErrors` names layers that
 *  failed LayerSchema/lintLayer (or were missing) and were dropped. */
export type ProgramData = {
  slots: ProgramSlotWithData[];
  layers?: Layer[];
  layerErrors?: string[];
};

/** What the loader reads through: the current list and the four service
 *  calls. Injected so the caching rules are testable without Firebase. */
export type ProgramDataLoaderDeps = {
  /** The program's entry in the current list (undefined: unknown or not loaded). */
  findProgram: (id: string) => Program | undefined;
  /** The list fetch while it runs, else null. */
  listPending: () => Promise<unknown> | null;
  fetchProgram: (id: string) => Promise<{ slots: ProgramSlotWithData[] } | null>;
  fetchLayer: (id: string) => Promise<ParsedLayer | null>;
  fetchCollegeLayers: (family: LayerFamily) => Promise<ParsedLayer[]>;
  fetchConcentrationLayers: (programId: string) => Promise<ParsedLayer[]>;
};

/** Split parsed layers into the valid ones and the ids that were rejected. */
function splitParsed(parsed: ParsedLayer[]): { layers: Layer[]; errors: string[] } {
  const layers: Layer[] = [];
  const errors: string[] = [];
  for (const p of parsed) {
    if (p.ok) layers.push(p.layer);
    else errors.push(p.id);
  }
  return { layers, errors };
}

/**
 * The per-id program-data cache behind loadProgramData: cache-by-id, in-flight
 * dedupe, and a per-family cache of college layers. A failed read is never
 * cached (the next call retries); a null (no such program doc) isn't either.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function createProgramDataLoader(deps: ProgramDataLoaderDeps) {
  const cache = new Map<string, ProgramData>();
  const inflight = new Map<string, Promise<ProgramData | null>>();
  const collegeLayers = new Map<LayerFamily, Promise<ParsedLayer[]>>();

  const loadCollegeLayers = (family: LayerFamily): Promise<ParsedLayer[]> => {
    const cached = collegeLayers.get(family);
    if (cached) return cached;
    const p = deps.fetchCollegeLayers(family).catch((err) => {
      collegeLayers.delete(family); // retried next time
      throw err;
    });
    collegeLayers.set(family, p);
    return p;
  };

  // Distribution family (D9): no slots; every valid layer the program can
  // need. A missing major layer is named in layerErrors (its rows can't be
  // checked), not reported as "program not found".
  const loadDistribution = async (id: string, family: LayerFamily): Promise<ProgramData> => {
    const [college, major, concentrations] = await Promise.all([
      loadCollegeLayers(family),
      deps.fetchLayer(id),
      deps.fetchConcentrationLayers(id),
    ]);
    const c = splitParsed(college);
    const m = splitParsed(major ? [major] : []);
    const k = splitParsed(concentrations);
    return {
      slots: [],
      layers: [...c.layers, ...m.layers, ...k.layers],
      layerErrors: [...c.errors, ...(major ? m.errors : [id]), ...k.errors],
    };
  };

  const fetchData = async (id: string): Promise<ProgramData | null> => {
    // The family comes from the program's list entry. While the list is still
    // loading, wait for it (a Distribution major has no program doc to fall
    // back on); an unknown id or a failed list → the Engineering path.
    const pending = deps.listPending();
    if (pending && !deps.findProgram(id)) await pending.catch(() => undefined);
    const family = programFamily(deps.findProgram(id));
    return isDistributionFamily(family) ? loadDistribution(id, family) : deps.fetchProgram(id);
  };

  return {
    get: (id: string): ProgramData | undefined => cache.get(id),
    load: (id: string): Promise<ProgramData | null> => {
      const cached = cache.get(id);
      if (cached) return Promise.resolve(cached); // fetch-once (SWR handled by the hook)
      const running = inflight.get(id);
      if (running) return running;
      const p = fetchData(id)
        .then((data) => {
          if (data) cache.set(id, data);
          inflight.delete(id);
          return data;
        })
        .catch((err) => {
          inflight.delete(id);
          throw err;
        });
      inflight.set(id, p);
      return p;
    },
  };
}

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

  // The latest list (and the list fetch while it runs): the loader is stable
  // and must pick a program's family from the CURRENT list.
  const programsRef = useRef<Program[]>([]);
  const listPromiseRef = useRef<Promise<unknown> | null>(null);

  // id → data cache; held in a ref (mutations don't need to re-render the
  // provider, the consuming hook holds the rendered copy). Created once.
  // Session-owned provider (mounted once above the shell). The ref guard dedupes
  // the fetch across StrictMode's double-invoke; we deliberately DON'T tie the
  // state setters to a per-run cancel flag — the first (only) fetch must be
  // allowed to resolve, or StrictMode's second run (which the ref short-circuits)
  // would leave loading stuck true forever.
  //
  // startList is also the loader's way in: React runs a child's effects before
  // its parent's, so on a cold load PlanProvider asks for the plan's program
  // BEFORE the effect below has started the list. The loader starts it here
  // instead of seeing "no list, nothing pending" and sending a CAS/CALS major
  // down the Engineering path (programs/{id} doesn't exist → "not found").
  // Returns the in-flight fetch, or null once the list has settled.
  const startList = useCallback((): Promise<void> | null => {
    if (listFetchedRef.current) return listPromiseRef.current as Promise<void> | null;
    listFetchedRef.current = true;
    const listPromise: Promise<void> = fetchProgramIndex()
      .then((list) => {
        programsRef.current = list;
        setPrograms(list);
      })
      .catch((err) => {
        setProgramsError(err instanceof Error ? err : new Error(String(err)));
        listFetchedRef.current = false; // allow retry
      })
      .finally(() => {
        setProgramsLoading(false);
        if (listPromiseRef.current === listPromise) listPromiseRef.current = null;
      });
    listPromiseRef.current = listPromise;
    return listPromise;
  }, []);

  const loaderRef = useRef<ReturnType<typeof createProgramDataLoader> | null>(null);
  const loader = useCallback(() => {
    loaderRef.current ??= createProgramDataLoader({
      findProgram: (id) => programsRef.current.find((p) => p.id === id),
      listPending: () => startList(),
      fetchProgram,
      fetchLayer,
      fetchCollegeLayers,
      fetchConcentrationLayers,
    });
    return loaderRef.current;
  }, [startList]);

  // A retry resets the visible state here, in the event, so the effect below
  // only ever sets state from async results (loading starts true on mount).
  const refetchPrograms = useCallback(() => {
    listFetchedRef.current = false;
    setProgramsLoading(true);
    setProgramsError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    startList();
  }, [reloadKey, startList]);

  const getProgramData = useCallback((id: string) => loader().get(id), [loader]);
  const loadProgramData = useCallback((id: string) => loader().load(id), [loader]);

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
