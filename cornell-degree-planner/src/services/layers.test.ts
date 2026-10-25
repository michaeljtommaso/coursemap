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

import { fetchCollegeLayers, fetchConcentrationLayers, fetchLayer, parseLayer } from "./layers";
import casCollege from "@/lib/planner/distribution/fixtures/cas-college.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEST_LAYERS = resolve(HERE, "..", "..", "..", "scripts", "seed-data", "layers-test");

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
    getDoc.mockResolvedValueOnce(snap(clone(casCollege)));
    const ok = await fetchLayer("cas-college");
    expect(getDoc.mock.calls[0][0]).toEqual({ path: "layers/cas-college" });
    expect(ok?.ok).toBe(true);

    getDoc.mockResolvedValueOnce(snap(null));
    expect(await fetchLayer("nope")).toBeNull();

    getDoc.mockResolvedValueOnce(snap({ id: "x" }));
    expect(await fetchLayer("x")).toMatchObject({ ok: false, id: "x" });
  });

  it("fetchCollegeLayers queries family and kind", async () => {
    getDocs.mockResolvedValue({ docs: [{ id: "cas-college", data: () => clone(casCollege) }] });
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
