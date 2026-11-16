/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The service reads through firebase/firestore; stub the SDK calls and the app
// module so no Firebase app boots under test. Queries are recorded as plain
// objects so the tests can check what was asked for.
const getDoc = vi.fn();
const getDocs = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: { path: string }, ...wheres: unknown[]) => ({ path: ref.path, wheres }),
  getDoc: (ref: unknown) => getDoc(ref),
  getDocs: (ref: unknown) => getDocs(ref),
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import {
  fetchCollegeLayers,
  fetchConcentrationLayers,
  fetchLayer,
  fetchMinorIndex,
  parseLayer,
  peekMinorIndex,
  resetMinorIndexCache,
} from "./layers";
import casCollege from "@/lib/planner/distribution/fixtures/cas-college.json";
import { encodeLayerDoc } from "@/lib/planner/distribution/layerDoc";
import type { Layer } from "@/lib/planner/distribution/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEST_LAYERS = resolve(HERE, "..", "..", "..", "scripts", "seed-data", "layers-test");
const FIXTURE_DIR = resolve(HERE, "..", "lib", "planner", "distribution", "fixtures");

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function snap(data: unknown) {
  return { exists: () => data != null, data: () => data };
}

beforeEach(() => {
  getDoc.mockReset();
  getDocs.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseLayer — LayerSchema AND lintLayer (spec 019 D11)", () => {
  it("accepts a valid layer (the CAS college fixture)", () => {
    const r = parseLayer("cas-college", clone(casCollege));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.layer.id).toBe("cas-college");
  });

  it("rejects a schema failure", () => {
    const bad = { ...clone(casCollege), rows: [] };
    const r = parseLayer("cas-college", bad);
    expect(r).toMatchObject({ ok: false, id: "cas-college" });
    if (!r.ok) expect(r.error).toMatch(/^schema:/);
  });

  it("rejects a field the strict schema does not know (e.g. a stray updatedAt)", () => {
    const r = parseLayer("cas-college", { ...clone(casCollege), updatedAt: 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects a shape only the linter catches (duplicate row ids)", () => {
    const layer = clone(casCollege);
    layer.rows = [...layer.rows, layer.rows[0]];
    const r = parseLayer("cas-college", layer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^lint:.*duplicate row id/);
  });

  it("rejects a layer stored under another doc id", () => {
    const r = parseLayer("cals-college-2025", clone(casCollege));
    expect(r.ok).toBe(false);
  });
});

describe("layer reads", () => {
  it("fetchLayer reads layers/{id}; null when absent; a bad layer comes back rejected", async () => {
    getDoc.mockResolvedValueOnce(snap(encodeLayerDoc(clone(casCollege) as Layer)));
    const ok = await fetchLayer("cas-college");
    expect(getDoc.mock.calls[0][0]).toEqual({ path: "layers/cas-college" });
    expect(ok?.ok).toBe(true);

    getDoc.mockResolvedValueOnce(snap(null));
    expect(await fetchLayer("nope")).toBeNull();

    getDoc.mockResolvedValueOnce(snap({ id: "x" }));
    expect(await fetchLayer("x")).toMatchObject({ ok: false, id: "x" });
  });

  it("a layer with nested arrays (subjectGroups) round-trips through the stored doc", async () => {
    const pre = JSON.parse(readFileSync(join(FIXTURE_DIR, "cals-college-pre2025.json"), "utf-8")) as Layer;
    expect(JSON.stringify(pre)).toContain("subjectGroups");
    const stored = encodeLayerDoc(pre);
    // Firestore rejects an array directly inside an array; the stored doc has none.
    const nested = (v: unknown, inArray = false): boolean =>
      Array.isArray(v)
        ? inArray || v.some((x) => nested(x, true))
        : v !== null && typeof v === "object" && Object.values(v).some((x) => nested(x, false));
    expect(nested(stored)).toBe(false);
    getDoc.mockResolvedValueOnce(snap(stored));
    const r = await fetchLayer(pre.id);
    expect(r?.ok ? r.layer : r).toEqual(pre);
  });

  it("a doc whose query fields disagree with its layer is rejected", async () => {
    getDoc.mockResolvedValueOnce(snap({ ...encodeLayerDoc(clone(casCollege) as Layer), family: "cals" }));
    expect(await fetchLayer("cas-college")).toMatchObject({ ok: false, error: expect.stringContaining("disagree") });
  });

  it("fetchCollegeLayers queries family and kind", async () => {
    getDocs.mockResolvedValue({ docs: [{ id: "cas-college", data: () => encodeLayerDoc(clone(casCollege) as Layer) }] });
    const layers = await fetchCollegeLayers("cas");
    expect(getDocs.mock.calls[0][0]).toEqual({
      path: "layers",
      wheres: [
        { field: "family", op: "==", value: "cas" },
        { field: "kind", op: "==", value: "college" },
      ],
    });
    expect(layers).toHaveLength(1);
    expect(layers[0].ok).toBe(true);
  });

  it("fetchConcentrationLayers queries programId and kind", async () => {
    getDocs.mockResolvedValue({ docs: [] });
    expect(await fetchConcentrationLayers("test-cas-major")).toEqual([]);
    expect(getDocs.mock.calls[0][0]).toEqual({
      path: "layers",
      wheres: [
        { field: "programId", op: "==", value: "test-cas-major" },
        { field: "kind", op: "==", value: "concentration" },
      ],
    });
  });
});

describe("the fictional test majors (scripts/seed-data/layers-test) pass the read boundary", () => {
  const files = existsSync(TEST_LAYERS) ? readdirSync(TEST_LAYERS).filter((f) => f.endsWith(".json")).sort() : [];

  it("has both test majors", () => {
    expect(files).toEqual(["test-cals-major.json", "test-cas-major.json"]);
  });

  it.each(files)("%s", (file) => {
    const raw = JSON.parse(readFileSync(join(TEST_LAYERS, file), "utf-8")) as { id: string };
    const r = parseLayer(raw.id, raw);
    expect(r.ok ? "" : r.error).toBe("");
    if (r.ok) {
      expect(r.layer.kind).toBe("major");
      expect(r.layer.programId).toBe(r.layer.id);
      const kinds = new Set(r.layer.rows.map((row) => row.kind));
      for (const k of ["seat", "pool", "distribution", "anyOf", "confirm"]) expect(kinds).toContain(k);
    }
  });
});

describe("fetchMinorIndex (spec 047 D12)", () => {
  const entry = { id: "minor-cs", name: "Computer Science Minor", shortName: "CS minor", offeredBy: "Bowers CIS", catalogYear: "2026-27" };

  beforeEach(() => {
    resetMinorIndexCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads catalog/minorIndex once per session and parses it", async () => {
    getDoc.mockResolvedValue(snap({ entries: [entry, { ...entry, id: "minor-econ", notOpenTo: ["cas-econ"] }] }));
    expect(peekMinorIndex()).toBeNull();
    const [a, b] = await Promise.all([fetchMinorIndex(), fetchMinorIndex()]);
    expect(a.map((e) => e.id)).toEqual(["minor-cs", "minor-econ"]);
    expect(b).toBe(a);
    expect(await fetchMinorIndex()).toBe(a);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc.mock.calls[0][0]).toEqual({ path: "catalog/minorIndex" });
    expect(peekMinorIndex()).toBe(a);
  });

  it("reads [] when no minors are seeded yet", async () => {
    getDoc.mockResolvedValue(snap(null));
    expect(await fetchMinorIndex()).toEqual([]);
  });

  it("rejects a doc that fails the schema, and a failed read is retried next time", async () => {
    getDoc.mockResolvedValueOnce(snap({ entries: [{ ...entry, catalogYear: "next year" }] }));
    await expect(fetchMinorIndex()).rejects.toThrow(/minor index rejected/);
    getDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(fetchMinorIndex()).rejects.toThrow("offline");
    getDoc.mockResolvedValueOnce(snap({ entries: [entry] }));
    expect((await fetchMinorIndex()).map((e) => e.id)).toEqual(["minor-cs"]);
    expect(getDoc).toHaveBeenCalledTimes(3);
  });
});
