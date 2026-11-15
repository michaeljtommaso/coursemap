import { useEffect, useMemo, useState } from "react";
import { useProgramContext, type ProgramData } from "@/contexts/ProgramProvider";
import { fetchLayer, fetchMinorIndex, peekMinorIndex, type ParsedLayer } from "@/services/layers";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { Layer, LayerSharing } from "@/lib/planner/distribution/types";

/**
 * useAdditionalProgramData (spec 047 D2/D12) — the layers of a plan's second
 * major and minors, loaded for the engine and the views.
 *
 *  - A second major: its major layer plus its chosen concentration layers, in
 *    the order chosen (through ProgramProvider's loader, so they share the
 *    cache with the primary program and Major Match).
 *  - A minor: its minor layer (services/layers.ts fetchLayer(id)), cached for
 *    the session.
 *
 * The hook starts its own reads (React runs a child's effects before its
 * parent's: a loader waiting on a provider's list has raced on cold loads
 * before; ProgramProvider's loader starts the program list itself).
 * Fails closed: a missing or rejected layer, a missing chosen concentration,
 * a layer of the wrong kind or a failed read makes that program
 * "unavailable"; the others are unaffected.
 *
 * useMinorIndex lists every minor for the add picker (one read of
 * `catalog/minorIndex`, services/layers.ts fetchMinorIndex, cached).
 */

export type LoadedProgram = {
  programId: string;
  kind: "major" | "minor";
  name: string;
  shortName: string;
  /** A second major: its major layer + chosen concentration layers; a minor: its minor layer. */
  layers: Layer[];
  /** From its major/minor layer. */
  sharing?: LayerSharing;
  status: "loading" | "ok" | "unavailable";
};

/** A finished load: the program's layers, or why it can't be used. */
type LoadResult = { status: "ok"; layers: Layer[] } | { status: "unavailable" };

/** Identifies one load: the same program with other concentrations is
 *  another load. */
function entryKey(p: AdditionalProgram): string {
  return `${p.kind}|${p.programId}|${(p.concentrationIds ?? []).join(",")}`;
}

/** A second major's layers out of its program data: the major layer, then
 *  each chosen concentration in order. Unavailable when any is missing. Pure. */
export function secondMajorLayers(
  data: ProgramData | null,
  programId: string,
  concentrationIds: readonly string[]
): LoadResult {
  const layers = data?.layers ?? [];
  const major = layers.find((l) => l.id === programId && l.kind === "major");
  if (!major) return { status: "unavailable" };
  const out: Layer[] = [major];
  for (const id of concentrationIds) {
    const c = layers.find(
      (l) => l.kind === "concentration" && l.programId === programId && l.concentrationId === id
    );
    if (!c) return { status: "unavailable" };
    out.push(c);
  }
  return { status: "ok", layers: out };
}

/** A minor's layer out of its read: only a valid layer of kind "minor". Pure. */
export function minorLayer(parsed: ParsedLayer | null): LoadResult {
  if (!parsed || !parsed.ok || parsed.layer.kind !== "minor") return { status: "unavailable" };
  return { status: "ok", layers: [parsed.layer] };
}

// Minor layers read this session, by id (a failed read is forgotten so the
// next load retries).
const minorLayerReads = new Map<string, Promise<ParsedLayer | null>>();

function readMinorLayer(id: string): Promise<ParsedLayer | null> {
  const cached = minorLayerReads.get(id);
  if (cached) return cached;
  const read = fetchLayer(id);
  minorLayerReads.set(id, read);
  read.catch(() => {
    if (minorLayerReads.get(id) === read) minorLayerReads.delete(id);
  });
  return read;
}

/** Test seam: forget the session's minor layers. */
export function resetMinorLayerCache(): void {
  minorLayerReads.clear();
}

export function useAdditionalProgramData(list: AdditionalProgram[]): {
  programs: LoadedProgram[];
  allLoaded: boolean;
} {
  const { programs: programList, loadProgramData } = useProgramContext();
  const hasMinor = list.some((p) => p.kind === "minor");
  const { entries: minorEntries } = useMinorIndex(hasMinor);
  const [results, setResults] = useState<Record<string, LoadResult>>({});

  // One effect run per distinct list (by content, not identity).
  const listKey = JSON.stringify(list.map((p) => [p.kind, p.programId, p.concentrationIds ?? []]));
  useEffect(() => {
    const entries = JSON.parse(listKey) as [AdditionalProgram["kind"], string, string[]][];
    let cancelled = false;
    const settle = (key: string, result: LoadResult) => {
      if (cancelled) return;
      setResults((r) => ({ ...r, [key]: result }));
    };
    for (const [kind, programId, concentrationIds] of entries) {
      const key = entryKey({ kind, programId, concentrationIds });
      if (kind === "major") {
        loadProgramData(programId).then(
          (data) => settle(key, secondMajorLayers(data, programId, concentrationIds)),
          (err) => {
            console.warn("[programs] second major failed to load", programId, err);
            settle(key, { status: "unavailable" });
          }
        );
      } else {
        readMinorLayer(programId).then(
          (parsed) => settle(key, minorLayer(parsed)),
          (err) => {
            console.warn("[programs] minor failed to load", programId, err);
            settle(key, { status: "unavailable" });
          }
        );
      }
    }
    return () => {
      cancelled = true;
    };
  }, [listKey, loadProgramData]);

  return useMemo(() => {
    const loaded = list.map((p): LoadedProgram => {
      const result = results[entryKey(p)];
      const layers = result?.status === "ok" ? result.layers : [];
      const own = layers[0];
      let name: string;
      let shortName: string;
      if (p.kind === "major") {
        const prog = programList.find((x) => x.id === p.programId);
        name = prog?.name || own?.name || p.programId;
        shortName = prog?.short_name || name;
      } else {
        const entry = minorEntries.find((e) => e.id === p.programId);
        name = entry?.name || own?.name || p.programId;
        shortName = entry?.shortName || name;
      }
      return {
        programId: p.programId,
        kind: p.kind,
        name,
        shortName,
        layers,
        ...(own?.sharing ? { sharing: own.sharing } : {}),
        status: result ? result.status : "loading",
      };
    });
    return { programs: loaded, allLoaded: loaded.every((p) => p.status !== "loading") };
    // `list` is read by content through listKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, results, programList, minorEntries]);
}

type MinorIndexState = { entries: MinorIndexEntry[]; status: "loading" | "ok" | "error" };

const NO_ENTRIES: MinorIndexEntry[] = [];

/**
 * Every minor for the add picker (spec 047 D12): one read of
 * `catalog/minorIndex` per session (a failed read is retried by the next
 * mount). `enabled` false skips the read (useAdditionalProgramData passes it
 * for a plan with no minors) and reports only what the session already has.
 */
export function useMinorIndex(enabled = true): MinorIndexState {
  const [state, setState] = useState<{ entries: MinorIndexEntry[] | null; failed: boolean }>(() => ({
    entries: peekMinorIndex(),
    failed: false,
  }));

  useEffect(() => {
    if (!enabled || state.entries) return;
    let cancelled = false;
    fetchMinorIndex().then(
      (entries) => {
        if (!cancelled) setState({ entries, failed: false });
      },
      () => {
        if (!cancelled) setState({ entries: null, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, state.entries]);

  return useMemo<MinorIndexState>(() => {
    if (state.entries) return { entries: state.entries, status: "ok" };
    return { entries: NO_ENTRIES, status: state.failed ? "error" : "loading" };
  }, [state]);
}
