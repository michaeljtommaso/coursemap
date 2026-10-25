/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { lintLayer } from "./lintLayer";
import { appliesToMatches, selectLayers } from "./select";
import type { Layer, Row } from "./types";

/**
 * Every authored layer (the test fixtures here and, once they exist, the seed
 * files under scripts/seed-data/layers/) must parse with the strict schema and
 * lint clean; every plan fixture must name real layers and real rows.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const PLANS = join(FIXTURES, "plans");

function findRepoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scripts", "seed-data"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate the repo root (scripts/seed-data)");
}
const SEED_LAYERS = join(findRepoRoot(), "scripts", "seed-data", "layers");

function jsonFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFilesUnder(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const fixtureLayerFiles = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => join(FIXTURES, f));
const seedLayerFiles = jsonFilesUnder(SEED_LAYERS);

describe("layer files parse and lint clean", () => {
  it("has the three college fixtures", () => {
    expect(fixtureLayerFiles.map((f) => relative(FIXTURES, f))).toEqual(
      expect.arrayContaining(["cas-college.json", "cals-college-2025.json", "cals-college-pre2025.json"])
    );
  });

  it.each([...fixtureLayerFiles, ...seedLayerFiles].map((f) => [relative(HERE, f), f]))("%s", (_name, file) => {
    const parsed = LayerSchema.safeParse(readJson(file));
    expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    if (parsed.success) expect(lintLayer(parsed.data as Layer)).toEqual([]);
  });

  it.skipIf(seedLayerFiles.length > 0)("scripts/seed-data/layers has no files yet (seed part skipped)", () => {
    expect(seedLayerFiles).toEqual([]);
  });

  it("college fixtures use catalog year 2026-27 and kind college", () => {
    for (const f of fixtureLayerFiles) {
      const l = LayerSchema.parse(readJson(f));
      expect(l.kind, f).toBe("college");
      expect(l.catalogYear, f).toBe("2026-27");
    }
  });
});

// ── Plans ────────────────────────────────────────────────────────────────────

type PlanFile = {
  id: string;
  description: string;
  family: "cas" | "cals";
  ctx: { programId: string; entryTerm?: string | null; transfer?: "none" | "external" | "internal" | null };
  layers: string[];
  courses: { id: string; subject: string; number: string; credits: number; attrs?: { value: string }[] }[];
  expect: Record<string, string>;
  expectExactlyOneMet?: string[][];
};

const layersById = new Map<string, Layer>(
  [...fixtureLayerFiles, ...seedLayerFiles].map((f) => {
    const l = LayerSchema.parse(readJson(f)) as Layer;
    return [l.id, l];
  })
);

/** `${layerId}:${rowId}` → row, including anyOf children. */
function rowIndex(layer: Layer): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of layer.rows) {
    m.set(`${layer.id}:${r.id}`, r);
    if (r.kind === "anyOf") for (const c of r.rows) m.set(`${layer.id}:${c.id}`, c);
  }
  return m;
}

const planFiles = readdirSync(PLANS)
  .filter((f) => f.endsWith(".json"))
  .sort();
const STATUSES = ["met", "partial", "unmet", "confirm"];

describe("plan fixtures", () => {
  it("has a plan set", () => {
    expect(planFiles.length).toBeGreaterThanOrEqual(12);
  });

  it.each(planFiles)("%s names real layers and rows", (file) => {
    const plan = readJson(join(PLANS, file)) as PlanFile;
    expect(`${plan.id}.json`).toBe(file);
    expect(plan.description.length).toBeGreaterThan(0);
    expect(plan.ctx.programId).toBeTruthy();
    expect(plan.courses.length).toBeGreaterThan(0);
    for (const c of plan.courses) {
      expect(typeof c.id, c.id).toBe("string");
      expect(typeof c.subject, c.id).toBe("string");
      expect(typeof c.number, c.id).toBe("string");
      expect(c.credits, c.id).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(plan.courses.map((c) => c.id)).size).toBe(plan.courses.length);

    const rows = new Map<string, Row>();
    for (const id of plan.layers) {
      const layer = layersById.get(id);
      expect(layer, `layer ${id}`).toBeDefined();
      if (!layer) continue;
      expect(layer.family).toBe(plan.family);
      for (const [k, r] of rowIndex(layer)) rows.set(k, r);
    }

    const keys = [...Object.keys(plan.expect), ...(plan.expectExactlyOneMet ?? []).flat()];
    expect(keys.length, "a plan expects something").toBeGreaterThan(0);
    for (const key of keys) {
      const row = rows.get(key);
      expect(row, `expect key ${key}`).toBeDefined();
      if (row) expect(appliesToMatches(row.appliesTo, plan.ctx), `${key} applies to the plan's student`).toBe(true);
    }
    for (const [key, status] of Object.entries(plan.expect)) {
      expect(STATUSES, key).toContain(status);
      const row = rows.get(key);
      if (row) expect(status === "confirm", `${key}: confirm iff the row is a confirm row`).toBe(row.kind === "confirm");
    }
  });

  it.each(planFiles)("%s: the selector picks the plan's college layer for its student", (file) => {
    const plan = readJson(join(PLANS, file)) as PlanFile;
    const college = plan.layers.map((id) => layersById.get(id)).find((l) => l?.kind === "college");
    if (!college) return;
    const r = selectLayers([...layersById.values()], { family: plan.family, ...plan.ctx });
    expect(r.layers.find((l) => l.kind === "college")?.id).toBe(college.id);
  });
});
