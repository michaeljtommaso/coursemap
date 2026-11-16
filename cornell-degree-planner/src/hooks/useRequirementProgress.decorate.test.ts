import { describe, expect, it, vi } from "vitest";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { Layer } from "@/lib/planner/distribution/types";
import type { RequirementProgress } from "./useRequirementProgress";

// The hook module's React/context imports, stubbed: only the pure
// decorateProgress step is under test here.
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({}) }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => ({}) }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => ({ programs: [], loading: false }) }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({}) }));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => ({ resolved: [] }) }));
vi.mock("@/hooks/useAdditionalProgramData", () => ({ useAdditionalProgramData: () => ({ programs: [], allLoaded: true }) }));

import { decorateProgress, stableExtras } from "./useRequirementProgress";

const layer = (id: string, kind: Layer["kind"]): Layer =>
  ({ id, kind, family: "cas", name: id, catalogYear: "2026-27", rows: [] }) as Layer;
const PRIMARY = [layer("cas-college", "college"), layer("test-econ", "major"), layer("test-econ--fin", "concentration")];
const minor = (status: LoadedProgram["status"]): LoadedProgram => ({
  programId: "test-minor-data",
  kind: "minor",
  name: "Data",
  shortName: "Data minor",
  layers: status === "ok" ? [layer("test-minor-data", "minor")] : [],
  status,
});
const BASE: RequirementProgress = {
  groups: [],
  attribution: {},
  satisfiedCount: 0,
  total: 0,
  fillCandidates: { "test-minor-data": ["STAT-2000", "CS-1110", "CS-3780"] },
  tried: { courseIds: ["CS-1110"], notOnBoard: ["CS-1110"], items: {}, fills: {}, missing: [], onlyFor: { "test-minor-data": ["CS-1110"] } },
};

describe("decorateProgress (spec 047, the hook's own fields)", () => {
  it("every loaded layer is live; all loaded only when the primary and every extra are", () => {
    const ok = decorateProgress([BASE, [], {}, PRIMARY, [], true, [minor("ok")], true]);
    expect(ok.liveLayerIds).toEqual(["cas-college", "test-econ", "test-econ--fin", "test-minor-data"]);
    expect(ok.allLayersLoaded).toBe(true);
    expect(decorateProgress([BASE, [], {}, PRIMARY, [], true, [minor("loading")], false]).allLayersLoaded).toBe(false);
    expect(decorateProgress([BASE, [], {}, PRIMARY, [], true, [minor("unavailable")], true]).allLayersLoaded).toBe(false);
    expect(decorateProgress([BASE, [], {}, PRIMARY, ["test-econ--x"], true, [], true]).allLayersLoaded).toBe(false);
    expect(decorateProgress([BASE, [], {}, undefined, undefined, false, [], true]).allLayersLoaded).toBe(false);
  });

  it("fill candidates lose the tried classes (canonically); triedOnlyFor is lifted from the tried rerun", () => {
    const p = decorateProgress([BASE, ["CS-1112"], { "CS-1112": "CS-1110" }, PRIMARY, [], true, [minor("ok")], true]);
    expect(p.fillCandidates).toEqual({ "test-minor-data": ["STAT-2000", "CS-3780"] });
    expect(p.triedOnlyFor).toEqual({ "test-minor-data": ["CS-1110"] });
  });

  it("keeps its identity while the inputs do", () => {
    const args: Parameters<typeof decorateProgress>[0] = [BASE, [], {}, PRIMARY, [], true, [], true];
    expect(decorateProgress(args)).toBe(decorateProgress(args));
  });

  it("stableExtras: equal lists from different hook instances share one array", () => {
    const a = [minor("ok")];
    const b = [{ ...a[0] }];
    expect(stableExtras(a)).toBe(a);
    expect(stableExtras(b)).toBe(a);
    const changed = [{ ...a[0], status: "unavailable" as const }];
    expect(stableExtras(changed)).toBe(changed);
    expect(stableExtras([])).toEqual([]);
  });
});
