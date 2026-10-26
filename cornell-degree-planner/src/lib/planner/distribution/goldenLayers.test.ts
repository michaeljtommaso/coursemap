/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { lintLayer } from "./lintLayer";
import { describeGoldenFailure, runGoldenPlan, type GoldenFixture } from "./goldenPlan";
import type { Layer } from "./types";

/**
 * Golden plans for Distribution layers (spec 019 D4 step 4): every fixture in
 * scripts/seed-data/golden/layers/ names its layers by id, and its plan must
 * score exactly 100% with every course load-bearing. Layers are read from the
 * seed files at test time, so a layer edit that loosens or breaks a row fails
 * here. Fixtures are written by scripts/check-golden-layer.ts --write.
 */

/** Walk up from this file until we find scripts/seed-data. */
function findSeedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const SEED_DIR = findSeedDir();
const GOLDEN_LAYERS_DIR = join(SEED_DIR, "golden", "layers");

function jsonFilesUnder(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (recursive) out.push(...jsonFilesUnder(p, true));
    } else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

/** Every authored and test layer file, by layer id. */
function loadLayerFiles(): Map<string, { file: string; raw: unknown }> {
  const files = [...jsonFilesUnder(join(SEED_DIR, "layers"), true), ...jsonFilesUnder(join(SEED_DIR, "layers-test"), false)];
  const byId = new Map<string, { file: string; raw: unknown }>();
  for (const file of files) {
    const raw = readJson(file);
    const id = raw && typeof raw === "object" && "id" in raw ? String((raw as { id: unknown }).id) : null;
    if (!id) continue;
    if (byId.has(id)) throw new Error(`layer id ${id} appears in both ${byId.get(id)!.file} and ${file}`);
    byId.set(id, { file, raw });
  }
  return byId;
}

const LAYER_FILES = loadLayerFiles();
const FIXTURE_FILES = jsonFilesUnder(GOLDEN_LAYERS_DIR, false);

function resolveLayer(id: string): Layer {
  const entry = LAYER_FILES.get(id);
  if (!entry) throw new Error(`no layer file with id ${id} under seed-data/layers or seed-data/layers-test`);
  const parsed = LayerSchema.safeParse(entry.raw);
  if (!parsed.success) throw new Error(`${entry.file}: fails LayerSchema: ${parsed.error.message}`);
  const layer = parsed.data as Layer;
  const lint = lintLayer(layer);
  if (lint.length) throw new Error(`${entry.file}: lint errors:\n  ${lint.join("\n  ")}`);
  return layer;
}

describe("golden plans for Distribution layers", () => {
  it("has at least one fixture", () => {
    expect(FIXTURE_FILES.length).toBeGreaterThan(0);
  });

  for (const file of FIXTURE_FILES) {
    const fx = readJson(file) as GoldenFixture;
    it(`${fx.programId}: plan scores 100% and every course is load-bearing`, () => {
      expect(Array.isArray(fx.courses), `${file}: no courses (run check-golden-layer.ts --write)`).toBe(true);
      const layers = fx.layerIds.map(resolveLayer);
      const result = runGoldenPlan(layers, fx);
      expect(describeGoldenFailure(result), `${fx.programId} golden plan failed`).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});
