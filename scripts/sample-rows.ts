// scripts/sample-rows.ts
// The hand-check sampler (spec 019 D4 step 5 / D16): a reproducible, seeded
// random draw of requirement rows for one college family, written as a sheet a
// reviewer checks row by row against the catalog page. Zero wrong rows in the
// draw releases the family; any wrong row sends that major back through
// authoring, and a NEW seed is drawn afterwards (a fixed seed must never be
// re-checked until it passes).
//
// Run (from scripts/):
//   npx tsx sample-rows.ts --family cas|cals --seed <int> [--count 150]
//                          [--layers <dir>]... [--out <dir>] [--verify <draw.json>]
//
//   --layers  folders of layer JSON files, searched recursively (default:
//             seed-data/layers/<family>/). Only layers of --family are drawn.
//   --out     where <family>-seed<N>.md and .json go (default: the private
//             hand-check folder under docs/provenance/).
//   --verify  recompute the recorded draw (family, seed, count) on the current
//             layers: exit 0 if identical, 1 if any row or the draw changed.
//
// The universe is every RowUnit (top-level rows, anyOf children, confirm rows
// included), sorted by (layer id, unit order in the file) so the draw does not
// depend on file-system order. universeHash covers every row's full content and
// each layer's own fields (name, appliesTo, catalogYear, …), so any edit to a
// layer is detectable. A row's quote comes from docs/provenance/<id>/merged.json
// only when that draft's layer is this exact layer; otherwise the sheet says the
// quote is from another version. Exit: 0 ok, 1 verify mismatch, 2 bad usage.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { LayerSchema } from "../cornell-degree-planner/src/lib/schemas";
import { canonicalStringify } from "./canonical-json";
import {
  HANDCHECK_DIR,
  LAYERS_DIR,
  PROVENANCE_FILES,
  REPO_ROOT,
  describeRow,
  provenanceDir,
  quotesFor,
  readDraft,
  rowUnits,
  type Draft,
  type Layer,
  type RowUnit,
} from "./layer-authoring";

export type Family = "cas" | "cals";

// ─── PRNG ───────────────────────────────────────────────────────────────────

/** mulberry32: a small, well-mixed 32-bit PRNG. Same seed → same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Universe ───────────────────────────────────────────────────────────────

export type LayerInput = { file: string; layer: Layer };

/** A layer's own fields: everything but its rows. */
export type LayerFields = Omit<Layer, "rows">;

export function layerFields(layer: Layer): LayerFields {
  const out: Partial<Layer> = { ...layer };
  delete out.rows;
  return out as LayerFields;
}

export type UniverseItem = {
  layerId: string;
  layerName: string;
  /** The unit's layer, without rows: hashed with the unit. */
  layer: LayerFields;
  /** Position of the unit within its layer (rowUnits order). */
  order: number;
  unit: RowUnit;
};

export type UniverseLayer = { id: string; name: string; file: string; units: number; hash: string };

export type Universe = { family: Family; layers: UniverseLayer[]; items: UniverseItem[] };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Layers of `family`, sorted by id, flattened to their row units in file order. */
export function buildUniverse(inputs: LayerInput[], family: Family): Universe {
  const mine = inputs.filter((i) => i.layer.family === family);
  const seen = new Map<string, string>();
  for (const i of mine) {
    const prior = seen.get(i.layer.id);
    if (prior) throw new Error(`layer id ${i.layer.id} appears in both ${prior} and ${i.file}`);
    seen.set(i.layer.id, i.file);
  }
  const sorted = [...mine].sort((a, b) => (a.layer.id < b.layer.id ? -1 : a.layer.id > b.layer.id ? 1 : 0));
  const layers: UniverseLayer[] = [];
  const items: UniverseItem[] = [];
  for (const { file, layer } of sorted) {
    const units = rowUnits(layer);
    const fields = layerFields(layer);
    units.forEach((unit, order) => items.push({ layerId: layer.id, layerName: layer.name, layer: fields, order, unit }));
    layers.push({
      id: layer.id,
      name: layer.name,
      file,
      units: units.length,
      hash: sha256(canonicalStringify({ layer: fields, units: units.map((u) => [u.key, u.row]) })),
    });
  }
  return { family, layers, items };
}

/** sha256 over each layer's own fields (in item order) and the canonical
 *  [layerId, key, row] list: any row edit, or any layer-level edit, changes it. */
export function universeHash(items: UniverseItem[]): string {
  const layers = new Map<string, LayerFields>();
  for (const i of items) if (!layers.has(i.layerId)) layers.set(i.layerId, i.layer);
  return sha256(
    canonicalStringify({
      layers: [...layers.entries()],
      items: items.map((i) => [i.layerId, i.unit.key, i.unit.row]),
    }),
  );
}

// ─── Draw ───────────────────────────────────────────────────────────────────

export type Drawn = { items: UniverseItem[]; warning: string | null };

/** Partial Fisher–Yates without replacement over the (sorted) universe, then
 *  presented in universe order: layer by layer, rows in file order. */
export function drawSample(universe: UniverseItem[], seed: number, count: number): Drawn {
  const n = universe.length;
  if (count >= n) {
    return {
      items: [...universe],
      warning: `asked for ${count} rows but the universe has only ${n}: taking every row`,
    };
  }
  const rand = mulberry32(seed);
  const idx = universe.map((_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const picked = idx.slice(0, count).sort((a, b) => a - b);
  return { items: picked.map((i) => universe[i]), warning: null };
}

// ─── Draw record (the .json beside the sheet) ───────────────────────────────

export type DrawRecord = {
  family: Family;
  seed: number;
  count: number;
  universeSize: number;
  universeHash: string;
  layers: { id: string; file: string; units: number; hash: string }[];
  items: { n: number; layerId: string; key: string }[];
};

export function drawRecord(universe: Universe, seed: number, count: number, drawn: Drawn): DrawRecord {
  return {
    family: universe.family,
    seed,
    count,
    universeSize: universe.items.length,
    universeHash: universeHash(universe.items),
    layers: universe.layers.map(({ id, file, units, hash }) => ({ id, file, units, hash })),
    items: drawn.items.map((it, i) => ({ n: i + 1, layerId: it.layerId, key: it.unit.key })),
  };
}

/** What differs between a recorded draw and a recomputation; [] = identical. */
export function compareDraws(recorded: DrawRecord, current: DrawRecord): string[] {
  const out: string[] = [];
  if (recorded.universeHash !== current.universeHash) {
    out.push(`universe hash changed: ${recorded.universeHash.slice(0, 12)}… → ${current.universeHash.slice(0, 12)}…`);
  }
  if (recorded.universeSize !== current.universeSize) out.push(`universe size changed: ${recorded.universeSize} → ${current.universeSize}`);
  const oldLayers = new Map((recorded.layers ?? []).map((l) => [l.id, l]));
  const newLayers = new Map(current.layers.map((l) => [l.id, l]));
  for (const [id, l] of oldLayers) {
    const now = newLayers.get(id);
    if (!now) out.push(`layer ${id} is gone`);
    else if (l.hash !== now.hash) out.push(`layer ${id} changed (${l.units} → ${now.units} units)`);
  }
  for (const id of newLayers.keys()) if (!oldLayers.has(id)) out.push(`layer ${id} is new`);
  const key = (i: { layerId: string; key: string }) => `${i.layerId} ${i.key}`;
  const oldItems = recorded.items.map(key);
  const newItems = current.items.map(key);
  if (oldItems.join("\n") !== newItems.join("\n")) {
    const oldSet = new Set(oldItems);
    const newSet = new Set(newItems);
    const dropped = oldItems.filter((k) => !newSet.has(k));
    const added = newItems.filter((k) => !oldSet.has(k));
    out.push(`drawn rows differ: ${dropped.length} no longer drawn, ${added.length} newly drawn`);
    for (const k of dropped) out.push(`  - ${k}`);
    for (const k of added) out.push(`  + ${k}`);
    if (!dropped.length && !added.length) out.push("  (same rows, different order)");
  }
  return out;
}

// ─── Sheet ──────────────────────────────────────────────────────────────────

/** A unit's quote fragments; "stale" when the provenance draft is a different
 *  version of the layer (its quotes may not back these rows); null for none. */
export type QuoteLookup = (layerId: string, unit: RowUnit) => string[] | "stale" | null;

export const STALE_QUOTE_TEXT = "(quote from a different version of this layer — re-run the chain or re-promote)";

/** The quotes `draft` holds for `unit`, trusted only when the draft's layer is
 *  `layer` exactly (canonically: key order does not matter). */
export function draftQuote(draft: Draft | null, layer: Layer | undefined, unit: RowUnit): string[] | "stale" | null {
  if (!draft) return null;
  if (!layer || canonicalStringify(draft.layer) !== canonicalStringify(layer)) return "stale";
  const q = quotesFor(draft, unit);
  return q.length ? q : null;
}

/** Quotes from docs/provenance/<layerId>/merged.json, when that draft exists,
 *  checked against the layers being sampled. */
export function provenanceQuotes(layers: Layer[]): QuoteLookup {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const cache = new Map<string, Draft | null>();
  return (layerId, unit) => {
    if (!cache.has(layerId)) {
      let draft: Draft | null = null;
      try {
        const p = join(provenanceDir(layerId), PROVENANCE_FILES.merged);
        if (existsSync(p)) draft = readDraft(p);
      } catch {
        draft = null;
      }
      cache.set(layerId, draft);
    }
    return draftQuote(cache.get(layerId) ?? null, byId.get(layerId), unit);
  };
}

export function renderHandcheckMarkdown(record: DrawRecord, drawn: Drawn, quotes: QuoteLookup): string {
  const L: string[] = [];
  L.push(`# Hand check: ${record.family.toUpperCase()} rows, seed ${record.seed}`);
  L.push("");
  L.push("## How to use this sheet");
  L.push("");
  L.push("1. For each row below, open the source URL and find the named section.");
  L.push("2. Read the row's rule in plain English and its quote, then compare with the page.");
  L.push('   Tick **right** when the row says exactly what the page says (courses, counts, credits, flags, who it applies to).');
  L.push("   Tick **wrong** for anything else, and say why in the note.");
  L.push("3. **0 wrong → the family is released.** Any wrong row → that major goes back through");
  L.push("   authoring, and a NEW seed is drawn for the next sitting (never re-check this one).");
  L.push(`4. Before you start, confirm the layers have not changed since this draw:`);
  L.push(`   \`npx tsx sample-rows.ts --verify <this sheet's .json>\` (from scripts/) must exit 0.`);
  L.push("");
  const quoted = drawn.items.map((it) => quotes(it.layerId, it.unit));
  const stale = quoted.filter((q) => q === "stale").length;
  L.push(`Drawn ${record.items.length} of ${record.universeSize} rows (asked for ${record.count}) from ${record.layers.length} layer(s).`);
  L.push(`Universe hash: \`${record.universeHash}\``);
  if (drawn.warning) L.push(`\n> **Warning:** ${drawn.warning}.`);
  if (stale) {
    L.push(
      `\n> **Warning:** ${stale} row(s) have no usable quote: the provenance draft is a different version of the layer. Re-run the chain or re-promote before checking them.`,
    );
  }
  L.push("");

  let currentLayer: string | null = null;
  drawn.items.forEach((it, i) => {
    if (it.layerId !== currentLayer) {
      currentLayer = it.layerId;
      L.push(`## ${it.layerName} (\`${it.layerId}\`)`);
      L.push("");
    }
    const row = it.unit.row;
    const parent = it.unit.parentId ? ` (one option of \`${it.unit.parentId}\`)` : "";
    L.push(`### ${i + 1}. ${row.label}`);
    L.push("");
    L.push(`- Layer: ${it.layerName} (\`${it.layerId}\`)`);
    L.push(`- Row: \`${it.unit.key}\`, kind ${row.kind}${parent}`);
    L.push(`- Rule: ${describeRow(row)}`);
    L.push(`- Source: ${row.source.url} — section "${row.source.anchor}"`);
    const q = quoted[i];
    if (q === "stale") L.push(`- Quote: ${STALE_QUOTE_TEXT}`);
    else if (q) {
      L.push("- Quote:");
      for (const f of q) L.push(`  > ${f.replace(/\s+/g, " ").trim()}`);
    } else L.push("- Quote: (no provenance quote)");
    L.push("");
    L.push("- [ ] right  - [ ] wrong  — note:");
    L.push("");
  });
  return L.join("\n");
}

// ─── Args + IO ──────────────────────────────────────────────────────────────

export type SampleArgs = {
  family: Family | null;
  seed: number | null;
  count: number;
  layers: string[];
  out: string;
  verify: string | null;
};

export const USAGE =
  "usage: npx tsx sample-rows.ts --family cas|cals --seed <int> [--count 150] [--layers <dir>]... [--out <dir>] [--verify <draw.json>]";

export function parseSampleArgs(argv: string[]): SampleArgs | { error: string } {
  const out: SampleArgs = { family: null, seed: null, count: 150, layers: [], out: HANDCHECK_DIR, verify: null };
  const int = (flag: string, v: string | undefined, min: number) => {
    if (v == null || !/^-?\d+$/.test(v)) throw new Error(`${flag} needs an integer`);
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < min) throw new Error(`${flag} must be an integer >= ${min}`);
    return n;
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      const next = () => {
        const v = argv[++i];
        if (v == null || v.startsWith("--")) throw new Error(`${a} needs a value`);
        return v;
      };
      if (a === "--family") {
        const f = next();
        if (f !== "cas" && f !== "cals") throw new Error("--family must be cas or cals");
        out.family = f;
      } else if (a === "--seed") out.seed = int(a, argv[++i], 0);
      else if (a === "--count") out.count = int(a, argv[++i], 1);
      else if (a === "--layers") out.layers.push(next());
      else if (a === "--out") out.out = next();
      else if (a === "--verify") out.verify = next();
      else throw new Error(`unknown argument ${a}`);
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!out.verify && (out.family == null || out.seed == null)) return { error: "--family and --seed are required (or --verify)" };
  return out;
}

function jsonFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return dir.endsWith(".json") ? [dir] : [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFilesUnder(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

/** Every layer file under the dirs (bare layers; a file that fails the schema is an error). */
export function readLayerDirs(dirs: string[]): LayerInput[] {
  const out: LayerInput[] = [];
  for (const dir of dirs) {
    for (const file of jsonFilesUnder(dir)) {
      const parsed = LayerSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
      if (!parsed.success) throw new Error(`${file}: not a valid layer: ${parsed.error.issues[0]?.message ?? "schema"}`);
      out.push({ file: relative(REPO_ROOT, file).split("\\").join("/"), layer: parsed.data as Layer });
    }
  }
  return out;
}

function computeDraw(family: Family, seed: number, count: number, dirs: string[]) {
  const inputs = readLayerDirs(dirs);
  const universe = buildUniverse(inputs, family);
  const drawn = drawSample(universe.items, seed, count);
  return { inputs, universe, drawn, record: drawRecord(universe, seed, count, drawn) };
}

function main(): number {
  const args = parseSampleArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`${args.error}\n${USAGE}`);
    return 2;
  }

  if (args.verify) {
    let recorded: DrawRecord;
    try {
      recorded = JSON.parse(readFileSync(resolve(args.verify), "utf-8")) as DrawRecord;
    } catch (e) {
      console.error(`cannot read ${args.verify}: ${(e as Error).message}`);
      return 2;
    }
    if ((recorded.family !== "cas" && recorded.family !== "cals") || typeof recorded.seed !== "number" || typeof recorded.count !== "number") {
      console.error(`${args.verify}: not a draw record (needs family, seed, count)`);
      return 2;
    }
    const dirs = args.layers.length ? args.layers.map((d) => resolve(d)) : [join(LAYERS_DIR, recorded.family)];
    const { record } = computeDraw(recorded.family, recorded.seed, recorded.count, dirs);
    const diffs = compareDraws(recorded, record);
    if (diffs.length) {
      console.log(`Draw ${recorded.family} seed ${recorded.seed} no longer matches the layers:`);
      for (const d of diffs) console.log(`  ${d}`);
      return 1;
    }
    console.log(`Draw ${recorded.family} seed ${recorded.seed}: identical (${record.items.length} rows, hash ${record.universeHash.slice(0, 12)}…).`);
    return 0;
  }

  const family = args.family!;
  const seed = args.seed!;
  const dirs = args.layers.length ? args.layers.map((d) => resolve(d)) : [join(LAYERS_DIR, family)];
  const { inputs, universe, drawn, record } = computeDraw(family, seed, args.count, dirs);
  if (!universe.items.length) {
    console.error(`No ${family} layers under ${dirs.join(", ")}.`);
    return 2;
  }
  if (drawn.warning) console.warn(`Warning: ${drawn.warning}.`);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${family}-seed${seed}`);
  writeFileSync(`${base}.md`, renderHandcheckMarkdown(record, drawn, provenanceQuotes(inputs.map((i) => i.layer))));
  writeFileSync(`${base}.json`, JSON.stringify(record, null, 2) + "\n");
  console.log(`Drew ${record.items.length} of ${record.universeSize} ${family} rows from ${universe.layers.length} layer(s).`);
  console.log(`Wrote ${base}.md and ${base}.json`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
