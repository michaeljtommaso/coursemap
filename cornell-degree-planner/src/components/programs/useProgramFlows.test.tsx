// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdditionalProgram } from "@/lib/schemas";
import type {
  HeldBack,
  OverlapPair,
  ProgramSection,
  RequirementGroup,
  RequirementItem,
} from "@/hooks/useRequirementProgress";
import { usePlannerStore } from "@/store/usePlannerStore";
import type { ProgramFlowsProgress } from "./useProgramFlows";

// Spec 047 D3/D8: the add flow's toast — the fill sentence, and when the add
// moved a course off a program already on the plan, a sentence and a Switch.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = {
  planId: "plan-1",
  additionalPrograms: [] as AdditionalProgram[],
  addProgram: vi.fn(() => "added"),
  removeProgram: vi.fn(),
  addTriedCourses: vi.fn((ids: string[]) => ({ added: ids, skipped: 0 })),
  setCountsFor: vi.fn(),
  waivedRequirementIds: [] as string[],
  courseMarks: {} as Record<string, string>,
  pruneOrphans: vi.fn(() => 0),
};
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));

const { useProgramFlows } = await import("./useProgramFlows");

const section = (id: string, kind: ProgramSection["kind"], shortName: string, status: ProgramSection["status"] = "ok"): ProgramSection => ({
  id,
  kind,
  name: shortName,
  shortName,
  color: null,
  pct: 0,
  satisfiedCount: 0,
  total: 0,
  status,
});
const row = (layerId: string, layerKind: "major" | "minor"): RequirementItem => ({
  id: `${layerId}:r`,
  label: "r",
  category: null,
  suggestedSem: null,
  status: "unmet",
  coveredBy: [],
  checkable: true,
  requirement: null,
  dist: { layerId, rowId: "r", layerKind, rowKind: "seat", engineStatus: "unmet", countedCodes: [] },
});
const group = (key: string, sectionId: string, item: RequirementItem): RequirementGroup => ({
  key,
  label: key,
  items: [item],
  satisfiedCount: 0,
  total: 1,
  sectionId,
});
const GROUPS = [group("econ", "economics", row("econ-ba", "major")), group("cs", "cs-minor", row("cs-minor-layer", "minor"))];
const ECON = section("economics", "primary", "Economics");
const held = (courseId: string, countsFor = "cs-minor", heldFrom = "economics"): HeldBack => ({
  courseId,
  placementId: null,
  countsFor,
  heldFrom,
});
const pair = (heldBack: HeldBack[]): OverlapPair => ({
  a: "economics",
  b: "cs-minor",
  limit: { maxCourses: 2 },
  limitFrom: "cs-minor",
  sharedCourseIds: [],
  heldBack,
  estimated: false,
});

const flows = {} as ReturnType<typeof useProgramFlows>;
function Harness({ progress }: { progress: ProgramFlowsProgress }) {
  const latest = useProgramFlows(progress);
  useEffect(() => {
    Object.assign(flows, latest);
  });
  return null;
}

let root: Root;
let host: HTMLElement;
const render = (progress: ProgramFlowsProgress) => act(() => root.render(<Harness progress={progress} />));
const toast = () => usePlannerStore.getState().toast;

/** Before: Economics alone. Add the CS minor, then its solve lands with `after`. */
function addCsMinor(after: OverlapPair[] | undefined, fill: string[] = ["CS-1110"]) {
  render({ sections: [ECON], groups: GROUPS, overlap: undefined, allLayersLoaded: true, liveLayerIds: ["econ-ba"] });
  act(() => void flows.add({ programId: "cs-minor", kind: "minor", shortName: "CS minor" }));
  plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
  render({
    sections: [ECON, section("cs-minor", "minor", "CS minor", "loading")],
    groups: GROUPS,
    overlap: undefined,
    allLayersLoaded: false,
    liveLayerIds: ["econ-ba"],
  });
  render({
    sections: [ECON, section("cs-minor", "minor", "CS minor")],
    groups: GROUPS,
    overlap: after,
    fillCandidates: { "cs-minor": fill },
    allLayersLoaded: true,
    liveLayerIds: ["econ-ba", "cs-minor-layer"],
  });
}

beforeEach(() => {
  plan.additionalPrograms = [];
  plan.courseMarks = {};
  vi.clearAllMocks();
  usePlannerStore.getState().dismissToast();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useProgramFlows add toast (D3 + D8)", () => {
  it("nothing moved: the fill sentence alone, no action", () => {
    addCsMinor([pair([])]);
    expect(toast()?.message).toBe("Added 1 required class for CS minor to Tried.");
    expect(toast()?.actionLabel).toBeNull();
  });

  it("one course moved off the primary: the fill sentence, then the move, with Switch", () => {
    addCsMinor([pair([held("ECON-3120")])]);
    expect(toast()?.message).toBe(
      "Added 1 required class for CS minor to Tried. ECON 3120 now counts for the CS minor (overlap limit). It can count for Economics instead."
    );
    expect(toast()?.actionLabel).toBe("Switch");
    act(() => usePlannerStore.getState().toastAction?.());
    expect(plan.setCountsFor).toHaveBeenCalledWith("ECON-3120", "econ-ba");
  });

  it("Switch makes room first when the mark would hit the cap", () => {
    plan.courseMarks = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, "yes"]));
    addCsMinor([pair([held("ECON-3120")])]);
    act(() => usePlannerStore.getState().toastAction?.());
    expect(plan.pruneOrphans).toHaveBeenCalledWith(["econ-ba", "cs-minor-layer"]);
    expect(plan.pruneOrphans.mock.invocationCallOrder[0]).toBeLessThan(plan.setCountsFor.mock.invocationCallOrder[0]);
  });

  it("several moved: a count, no action", () => {
    addCsMinor([pair([held("ECON-3120"), held("ECON-3130"), held("ECON-3140")])]);
    expect(toast()?.message).toBe(
      "Added 1 required class for CS minor to Tried. 3 courses now count for the CS minor instead of Economics (overlap limit). You can switch any of them on its card."
    );
    expect(toast()?.actionLabel).toBeNull();
  });

  it("held back from the NEW program only: nothing moved off an existing one", () => {
    addCsMinor([pair([held("CS-2110", "economics", "cs-minor")])], []);
    expect(toast()?.message).toBe("Your board already covers CS minor's required classes.");
    expect(toast()?.actionLabel).toBeNull();
  });

  it("an entry already held back before the add is not news", () => {
    const before = [pair([held("ECON-3120")])];
    render({ sections: [ECON], groups: GROUPS, overlap: before });
    act(() => void flows.add({ programId: "cs-minor", kind: "minor", shortName: "CS minor" }));
    plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
    render({
      sections: [ECON, section("cs-minor", "minor", "CS minor")],
      groups: GROUPS,
      overlap: before,
      fillCandidates: { "cs-minor": ["CS-1110"] },
    });
    expect(toast()?.message).toBe("Added 1 required class for CS minor to Tried.");
  });

  it("no layer to count it for: the sentence without Switch", () => {
    render({ sections: [ECON], groups: [], overlap: undefined });
    act(() => void flows.add({ programId: "cs-minor", kind: "minor", shortName: "CS minor" }));
    plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
    render({
      sections: [ECON, section("cs-minor", "minor", "CS minor")],
      groups: [],
      overlap: [pair([held("ECON-3120")])],
      fillCandidates: { "cs-minor": [] },
    });
    expect(toast()?.message).toBe(
      "Your board already covers CS minor's required classes. ECON 3120 now counts for the CS minor (overlap limit). It can count for Economics instead."
    );
    expect(toast()?.actionLabel).toBeNull();
  });
});

describe("useProgramFlows beside an Undo toast (audit #4)", () => {
  const showUndo = () =>
    act(() => usePlannerStore.getState().showToast("Removed Mathematics", { actionLabel: "Undo", onAction: () => {} }));

  it("the fill toast waits for an open Undo toast instead of overwriting it", () => {
    showUndo();
    addCsMinor([pair([])]);
    expect(toast()?.message).toBe("Removed Mathematics");
    expect(toast()?.actionLabel).toBe("Undo");
    expect(plan.addTriedCourses).toHaveBeenCalledWith(["CS-1110"]); // the fill itself isn't held back
    act(() => usePlannerStore.getState().dismissToast());
    expect(toast()?.message).toBe("Added 1 required class for CS minor to Tried.");
  });

  it("a deferred toast keeps its Switch action", () => {
    showUndo();
    addCsMinor([pair([held("ECON-3120")])]);
    act(() => usePlannerStore.getState().dismissToast());
    expect(toast()?.actionLabel).toBe("Switch");
    act(() => usePlannerStore.getState().toastAction?.());
    expect(plan.setCountsFor).toHaveBeenCalledWith("ECON-3120", "econ-ba");
  });

  it("a deferred toast is dropped when its program is removed meanwhile", () => {
    showUndo();
    addCsMinor([pair([])]);
    act(() => flows.remove("cs-minor"));
    act(() => usePlannerStore.getState().dismissToast());
    expect(toast()).toBeNull();
  });

  it("a plain toast showing is replaced as before", () => {
    act(() => usePlannerStore.getState().showToast("Saved"));
    addCsMinor([pair([])]);
    expect(toast()?.message).toBe("Added 1 required class for CS minor to Tried.");
  });
});

describe("useProgramFlows remove right after a fill (audit #7)", () => {
  it("drops the classes this session's fill added even when triedOnlyFor hasn't caught up", () => {
    addCsMinor([pair([])], ["CS-1110", "CS-2110"]);
    // The solve that reports the fill's classes as tried-only hasn't landed.
    render({
      sections: [ECON, section("cs-minor", "minor", "CS minor")],
      groups: GROUPS,
      overlap: [pair([])],
      triedOnlyFor: {},
      allLayersLoaded: true,
      liveLayerIds: ["econ-ba", "cs-minor-layer"],
    });
    act(() => flows.remove("cs-minor"));
    expect(plan.removeProgram).toHaveBeenCalledWith("cs-minor", ["CS-1110", "CS-2110"]);
  });

  it("with a fresh triedOnlyFor: its list plus the fill's, once each", () => {
    addCsMinor([pair([])], ["CS-1110"]);
    render({
      sections: [ECON, section("cs-minor", "minor", "CS minor")],
      groups: GROUPS,
      overlap: [pair([])],
      triedOnlyFor: { "cs-minor": ["CS-1110", "CS-4780"] },
      allLayersLoaded: true,
      liveLayerIds: ["econ-ba", "cs-minor-layer"],
    });
    act(() => flows.remove("cs-minor"));
    expect(plan.removeProgram).toHaveBeenCalledWith("cs-minor", ["CS-1110", "CS-4780"]);
  });
});
