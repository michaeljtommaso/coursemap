import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { Layer, LayerSharing } from "@/lib/planner/distribution/types";

/**
 * useAdditionalProgramData (spec 047 D2/D12) — the layers of a plan's second
 * major and minors, loaded for the engine and the views.
 *
 *  - A second major: its major layer plus its chosen concentration layers.
 *  - A minor: its minor layer (services/layers.ts fetchLayer(id)).
 *
 * useMinorIndex lists every minor for the add picker (one read of
 * `catalog/minorIndex`, services/layers.ts fetchMinorIndex).
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

// Stable results, so a caller's effects don't re-run every render.
const NO_PROGRAMS = { programs: [] as LoadedProgram[], allLoaded: true };
const NO_MINORS = { entries: [] as MinorIndexEntry[], status: "ok" as const };

// spec 047 stub — plan-state lane
export function useAdditionalProgramData(list: AdditionalProgram[]): {
  programs: LoadedProgram[];
  allLoaded: boolean;
} {
  void list;
  return NO_PROGRAMS;
}

// spec 047 stub — plan-state lane
export function useMinorIndex(): { entries: MinorIndexEntry[]; status: "loading" | "ok" | "error" } {
  return NO_MINORS;
}
