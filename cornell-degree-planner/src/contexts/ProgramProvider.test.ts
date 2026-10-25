import { describe, it, expect, vi } from "vitest";
import type { Program, ProgramSlotWithData } from "@/types/db";
import type { Layer, LayerFamily } from "@/lib/planner/distribution/types";
import type { ParsedLayer } from "@/services/layers";

// The provider module imports the Firestore services; stub them so no
// Firebase app boots. The loader under test gets its reads injected.
vi.mock("@/services/programs", () => ({ fetchProgramIndex: vi.fn(), fetchProgram: vi.fn() }));
vi.mock("@/services/layers", () => ({
  fetchLayer: vi.fn(),
  fetchCollegeLayers: vi.fn(),
  fetchConcentrationLayers: vi.fn(),
}));

const { createProgramDataLoader } = await import("./ProgramProvider");

// ── Fixtures ──────────────────────────────────────────────────────────────────
function program(id: string, family?: Program["family"]): Program {
  return {
    id,
    name: id,
    short_name: id,
    college: "x",
    catalog_year: 2026,
    total_credits: null,
    affiliation_text: null,
    created_at: new Date(0).toISOString(),
    ...(family ? { family } : {}),
  };
}

function layer(id: string, kind: Layer["kind"], family: LayerFamily, programId?: string): Layer {
  return {
    id,
    kind,
    family,
    name: id,
    catalogYear: "2026-27",
    ...(programId ? { programId } : {}),
    rows: [],
  };
}
const ok = (l: Layer): ParsedLayer => ({ ok: true, layer: l });
const bad = (id: string): ParsedLayer => ({ ok: false, id, error: "lint: broken" });

const SLOTS = [{ id: "s1" }] as unknown as ProgramSlotWithData[];

type Overrides = Partial<Parameters<typeof createProgramDataLoader>[0]>;

function setup(list: Program[], over: Overrides = {}) {
  const deps = {
    findProgram: (id: string) => list.find((p) => p.id === id),
    listPending: () => null,
    fetchProgram: vi.fn(async () => ({ slots: SLOTS })),
    fetchLayer: vi.fn(async (id: string): Promise<ParsedLayer | null> => ok(layer(id, "major", "cas", id))),
    fetchCollegeLayers: vi.fn(async (family: LayerFamily) => [ok(layer(`${family}-college`, "college", family))]),
    fetchConcentrationLayers: vi.fn(async (): Promise<ParsedLayer[]> => []),
    ...over,
  };
  return { deps, loader: createProgramDataLoader(deps) };
}

// ── Branching by family ───────────────────────────────────────────────────────
describe("createProgramDataLoader — family branching (spec 019 D11)", () => {
  it("an Engineering-family program loads its program doc's slots (no layer reads)", async () => {
    const { deps, loader } = setup([program("cornell-cs-bs-2026", "engineering")]);
    const data = await loader.load("cornell-cs-bs-2026");
    expect(data).toEqual({ slots: SLOTS });
    expect(deps.fetchProgram).toHaveBeenCalledWith("cornell-cs-bs-2026");
    expect(deps.fetchLayer).not.toHaveBeenCalled();
    expect(deps.fetchCollegeLayers).not.toHaveBeenCalled();
  });

  it("a program with no family (an old program doc) takes the Engineering path", async () => {
    const { deps, loader } = setup([program("legacy")]);
    await loader.load("legacy");
    expect(deps.fetchProgram).toHaveBeenCalledTimes(1);
  });

  it("an id not in the list takes the Engineering path", async () => {
    const { deps, loader } = setup([]);
    await loader.load("unknown");
    expect(deps.fetchProgram).toHaveBeenCalledWith("unknown");
    expect(deps.fetchLayer).not.toHaveBeenCalled();
  });

  it("a CAS program loads college + major + concentration layers, no slots", async () => {
    const conc = layer("test-cas-major--a", "concentration", "cas", "test-cas-major");
    const { deps, loader } = setup([program("test-cas-major", "cas")], {
      fetchConcentrationLayers: vi.fn(async () => [ok(conc)]),
    });
    const data = await loader.load("test-cas-major");
    expect(deps.fetchProgram).not.toHaveBeenCalled();
    expect(deps.fetchCollegeLayers).toHaveBeenCalledWith("cas");
    expect(deps.fetchLayer).toHaveBeenCalledWith("test-cas-major");
    expect(deps.fetchConcentrationLayers).toHaveBeenCalledWith("test-cas-major");
    expect(data?.slots).toEqual([]);
    expect(data?.layers?.map((l) => l.id)).toEqual(["cas-college", "test-cas-major", "test-cas-major--a"]);
    expect(data?.layerErrors).toEqual([]);
  });

  it("CALS keeps every college-layer version for selectLayers to choose from", async () => {
    const { loader } = setup([program("m", "cals")], {
      fetchCollegeLayers: vi.fn(async () => [
        ok(layer("cals-college-2025", "college", "cals")),
        ok(layer("cals-college-pre2025", "college", "cals")),
      ]),
    });
    const data = await loader.load("m");
    expect(data?.layers?.filter((l) => l.kind === "college").map((l) => l.id)).toEqual([
      "cals-college-2025",
      "cals-college-pre2025",
    ]);
  });
});

// ── Errors ────────────────────────────────────────────────────────────────────
describe("createProgramDataLoader — layer errors", () => {
  it("a missing major layer is named in layerErrors (data, not 'program not found')", async () => {
    const { loader } = setup([program("m", "cas")], { fetchLayer: vi.fn(async () => null) });
    const data = await loader.load("m");
    expect(data).not.toBeNull();
    expect(data?.layers?.map((l) => l.id)).toEqual(["cas-college"]);
    expect(data?.layerErrors).toEqual(["m"]);
  });

  it("rejected layers are dropped and named", async () => {
    const { loader } = setup([program("m", "cals")], {
      fetchCollegeLayers: vi.fn(async () => [ok(layer("cals-college-2025", "college", "cals")), bad("cals-college-pre2025")]),
      fetchLayer: vi.fn(async () => bad("m")),
      fetchConcentrationLayers: vi.fn(async () => [bad("m--x")]),
    });
    const data = await loader.load("m");
    expect(data?.layers?.map((l) => l.id)).toEqual(["cals-college-2025"]);
    expect(data?.layerErrors).toEqual(["cals-college-pre2025", "m", "m--x"]);
  });

  it("a failed read rejects, is not cached, and is retried", async () => {
    const fetchCollegeLayers = vi
      .fn<(f: LayerFamily) => Promise<ParsedLayer[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([ok(layer("cas-college", "college", "cas"))]);
    const { loader } = setup([program("m", "cas")], { fetchCollegeLayers });
    await expect(loader.load("m")).rejects.toThrow("offline");
    expect(loader.get("m")).toBeUndefined();
    const data = await loader.load("m");
    expect(data?.layers?.map((l) => l.id)).toEqual(["cas-college", "m"]);
    expect(fetchCollegeLayers).toHaveBeenCalledTimes(2);
  });
});

// ── Caching ───────────────────────────────────────────────────────────────────
describe("createProgramDataLoader — caching", () => {
  it("college layers are read ONCE per family across majors (Major Match loads ~45 majors)", async () => {
    const { deps, loader } = setup([program("a", "cas"), program("b", "cas"), program("c", "cals")]);
    const [a, b] = await Promise.all([loader.load("a"), loader.load("b")]);
    await loader.load("c");
    expect(deps.fetchCollegeLayers).toHaveBeenCalledTimes(2); // cas once, cals once
    expect(deps.fetchCollegeLayers).toHaveBeenNthCalledWith(1, "cas");
    expect(deps.fetchCollegeLayers).toHaveBeenNthCalledWith(2, "cals");
    expect(deps.fetchLayer).toHaveBeenCalledTimes(3); // each major's own layer
    expect(a?.layers?.[0]).toBe(b?.layers?.[0]); // the same college layer object
  });

  it("caches by id and dedupes concurrent loads", async () => {
    const { deps, loader } = setup([program("m", "cas")]);
    const [x, y] = await Promise.all([loader.load("m"), loader.load("m")]);
    expect(x).toBe(y);
    expect(deps.fetchLayer).toHaveBeenCalledTimes(1);
    expect(loader.get("m")).toBe(x);
    expect(await loader.load("m")).toBe(x);
    expect(deps.fetchLayer).toHaveBeenCalledTimes(1);
  });

  it("a null program (no program doc) is not cached", async () => {
    const { deps, loader } = setup([], { fetchProgram: vi.fn(async () => null) });
    expect(await loader.load("gone")).toBeNull();
    expect(loader.get("gone")).toBeUndefined();
    await loader.load("gone");
    expect(deps.fetchProgram).toHaveBeenCalledTimes(2);
  });
});

// ── The list loading race ─────────────────────────────────────────────────────
describe("createProgramDataLoader — while the list loads", () => {
  it("waits for the list before picking a family", async () => {
    const list: Program[] = [];
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    const { deps, loader } = setup(list, {
      findProgram: (id) => list.find((p) => p.id === id),
      listPending: () => pending,
    });
    const load = loader.load("m");
    list.push(program("m", "cas")); // the index arrives
    release();
    const data = await load;
    expect(deps.fetchProgram).not.toHaveBeenCalled();
    expect(data?.layers?.map((l) => l.id)).toEqual(["cas-college", "m"]);
  });

  it("a failed list falls back to the Engineering path", async () => {
    const { deps, loader } = setup([], { listPending: () => Promise.reject(new Error("no list")) });
    await loader.load("m");
    expect(deps.fetchProgram).toHaveBeenCalledWith("m");
  });
});
