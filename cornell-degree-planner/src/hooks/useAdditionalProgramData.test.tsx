// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { Layer } from "@/lib/planner/distribution/types";
import type { ProgramSlotWithData } from "@/types/db";

// useAdditionalProgramData / useMinorIndex (spec 047) against a mocked
// program loader and layers service: a second major's layers come from the
// loader (major layer + chosen concentrations, in order), a minor's from
// fetchLayer(id); names from the program list / minor index; each program
// fails closed on its own.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layer = (over: Partial<Layer>): Layer =>
  ({ id: "x", kind: "major", family: "cas", name: "X", catalogYear: "2026-27", rows: [], ...over }) as Layer;
const MATH_MAJOR = layer({ id: "cas-math-ba", programId: "cas-math-ba", name: "Mathematics major", sharing: { minors: "none" } });
const MATH_STATS = layer({ id: "cas-math-ba--stats", kind: "concentration", programId: "cas-math-ba", concentrationId: "stats" });
const MATH_PURE = layer({ id: "cas-math-ba--pure", kind: "concentration", programId: "cas-math-ba", concentrationId: "pure" });
const CS_MINOR = layer({ id: "minor-cs", kind: "minor", family: "other", programId: "minor-cs", name: "CS minor layer" });
const CS_ENTRY: MinorIndexEntry = {
  id: "minor-cs",
  name: "Computer Science Minor",
  shortName: "CS minor",
  offeredBy: "Bowers CIS",
  catalogYear: "2026-27",
};

const loadProgramData = vi.fn();
const programCtx = {
  programs: [
    { id: "cas-math-ba", name: "Mathematics, B.A.", short_name: "Mathematics", college: "" },
    { id: "test-eng-cs-bs", name: "Test Computer Science, B.S.", short_name: "Test CS", college: "College of Engineering" },
  ],
  loadProgramData,
};
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => programCtx }));

const layersSvc = vi.hoisted(() => ({
  fetchLayer: vi.fn(),
  fetchMinorIndex: vi.fn(),
  peekMinorIndex: vi.fn(() => null),
}));
vi.mock("@/services/layers", () => layersSvc);

const { useAdditionalProgramData, useMinorIndex, resetMinorLayerCache, secondMajorLayers, secondMajorData, minorLayer } =
  await import("./useAdditionalProgramData");

type Out = ReturnType<typeof useAdditionalProgramData>;
let out: Out;
let index: ReturnType<typeof useMinorIndex>;
function Probe({ list }: { list: AdditionalProgram[] }) {
  const value = useAdditionalProgramData(list);
  const minors = useMinorIndex();
  useEffect(() => {
    out = value;
    index = minors;
  });
  return null;
}

let root: Root;
beforeEach(() => {
  resetMinorLayerCache();
  loadProgramData.mockReset().mockResolvedValue({ slots: [], layers: [MATH_MAJOR, MATH_PURE, MATH_STATS] });
  layersSvc.fetchLayer.mockReset().mockResolvedValue({ ok: true, layer: CS_MINOR });
  layersSvc.fetchMinorIndex.mockReset().mockResolvedValue([CS_ENTRY]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

const render = (list: AdditionalProgram[]) => act(async () => root.render(<Probe list={list} />));

describe("useAdditionalProgramData (spec 047)", () => {
  it("loads a second major (major layer + chosen concentrations in order) and a minor, with names", async () => {
    const list: AdditionalProgram[] = [
      { programId: "cas-math-ba", kind: "major", concentrationIds: ["stats", "pure"] },
      { programId: "minor-cs", kind: "minor" },
    ];
    await render(list);
    await act(async () => {});
    expect(out.allLoaded).toBe(true);
    expect(out.programs).toEqual([
      {
        programId: "cas-math-ba",
        kind: "major",
        name: "Mathematics, B.A.",
        shortName: "Mathematics",
        layers: [MATH_MAJOR, MATH_STATS, MATH_PURE],
        sharing: { minors: "none" },
        status: "ok",
      },
      {
        programId: "minor-cs",
        kind: "minor",
        name: "Computer Science Minor",
        shortName: "CS minor",
        layers: [CS_MINOR],
        status: "ok",
      },
    ]);
    expect(loadProgramData).toHaveBeenCalledWith("cas-math-ba");
    expect(layersSvc.fetchLayer).toHaveBeenCalledWith("minor-cs");
    expect(index).toEqual({ entries: [CS_ENTRY], status: "ok" });
  });

  it("reports loading until every read lands, and starts its reads itself", async () => {
    let finish!: (v: unknown) => void;
    layersSvc.fetchLayer.mockReturnValue(new Promise((r) => (finish = r)));
    await render([{ programId: "minor-cs", kind: "minor" }]);
    expect(out.allLoaded).toBe(false);
    expect(out.programs[0]).toMatchObject({ status: "loading", layers: [] });
    await act(async () => finish({ ok: true, layer: CS_MINOR }));
    expect(out.allLoaded).toBe(true);
    expect(out.programs[0].status).toBe("ok");
  });

  it("fails closed per program: a missing minor layer, a rejected one, a failed read", async () => {
    layersSvc.fetchLayer.mockImplementation(async (id: string) => {
      if (id === "minor-gone") return null;
      if (id === "minor-bad") return { ok: false, id, error: "schema" };
      if (id === "minor-wrongkind") return { ok: true, layer: MATH_MAJOR };
      throw new Error("offline");
    });
    await render([
      { programId: "minor-gone", kind: "minor" },
      { programId: "minor-bad", kind: "minor" },
      { programId: "minor-wrongkind", kind: "minor" },
    ]);
    await act(async () => {});
    expect(out.programs.map((p) => p.status)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(out.programs[0].name).toBe("minor-gone"); // no index entry, no layer: its id
    expect(out.allLoaded).toBe(true);
  });

  it("a second major whose chosen concentration is missing, or whose load fails, is unavailable", async () => {
    await render([{ programId: "cas-math-ba", kind: "major", concentrationIds: ["gone"] }]);
    await act(async () => {});
    expect(out.programs[0].status).toBe("unavailable");
    loadProgramData.mockRejectedValue(new Error("offline"));
    await render([{ programId: "cas-math-ba", kind: "major" }]);
    await act(async () => {});
    expect(out.programs[0].status).toBe("unavailable");
  });

  it("an Engineering second major loads as its template (spec 047 D15), named from the program list", async () => {
    const slots = [{ id: "cs-s3-cs2110" }] as unknown as ProgramSlotWithData[];
    loadProgramData.mockResolvedValue({ slots });
    await render([{ programId: "test-eng-cs-bs", kind: "major" }]);
    await act(async () => {});
    expect(out.programs[0]).toEqual({
      programId: "test-eng-cs-bs",
      kind: "major",
      name: "Test Computer Science, B.S.",
      shortName: "Test CS",
      layers: [],
      template: slots,
      status: "ok",
    });
    expect(out.allLoaded).toBe(true);
  });

  it("an Engineering second major with no slots fails closed", async () => {
    loadProgramData.mockResolvedValue({ slots: [] });
    await render([{ programId: "test-eng-cs-bs", kind: "major" }]);
    await act(async () => {});
    expect(out.programs[0].status).toBe("unavailable");
    expect(out.programs[0].template).toBeUndefined();
  });

  it("an empty list is loaded at once", async () => {
    await render([]);
    expect(out).toEqual({ programs: [], allLoaded: true });
  });

  it("reads each minor layer once per session", async () => {
    await render([{ programId: "minor-cs", kind: "minor" }]);
    await act(async () => {});
    await render([
      { programId: "minor-cs", kind: "minor" },
      { programId: "cas-math-ba", kind: "major" },
    ]);
    await act(async () => {});
    expect(layersSvc.fetchLayer).toHaveBeenCalledTimes(1);
    expect(out.programs.map((p) => p.status)).toEqual(["ok", "ok"]);
  });
});

describe("pure pickers", () => {
  it("secondMajorLayers needs the major layer itself", () => {
    expect(secondMajorLayers({ slots: [], layers: [MATH_STATS] }, "cas-math-ba", [])).toEqual({ status: "unavailable" });
    expect(secondMajorLayers(null, "cas-math-ba", [])).toEqual({ status: "unavailable" });
  });
  it("secondMajorData reads the data's shape: layers for a Distribution major, a template for Engineering", () => {
    const slots = [{ id: "s1" }] as unknown as ProgramSlotWithData[];
    expect(secondMajorData({ slots }, "test-eng-cs-bs", [])).toEqual({ status: "ok", layers: [], template: slots });
    expect(secondMajorData({ slots: [] }, "test-eng-cs-bs", [])).toEqual({ status: "unavailable" });
    // Engineering majors have no concentrations: a chosen one can't be honoured.
    expect(secondMajorData({ slots }, "test-eng-cs-bs", ["x"])).toEqual({ status: "unavailable" });
    expect(secondMajorData(null, "test-eng-cs-bs", [])).toEqual({ status: "unavailable" });
    expect(secondMajorData({ slots: [], layers: [MATH_MAJOR] }, "cas-math-ba", [])).toEqual({
      status: "ok",
      layers: [MATH_MAJOR],
    });
  });
  it("minorLayer takes only a valid minor layer", () => {
    expect(minorLayer({ ok: true, layer: CS_MINOR })).toEqual({ status: "ok", layers: [CS_MINOR] });
    expect(minorLayer(null)).toEqual({ status: "unavailable" });
  });
});

describe("useMinorIndex", () => {
  it("reports an error when the index can't be read", async () => {
    layersSvc.fetchMinorIndex.mockRejectedValue(new Error("offline"));
    await render([]);
    await act(async () => {});
    expect(index).toEqual({ entries: [], status: "error" });
  });
});
