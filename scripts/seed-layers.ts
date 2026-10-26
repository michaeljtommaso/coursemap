// scripts/seed-layers.ts
// Seed the Distribution-engine requirement layers (spec 019 D11/D12) into
// Firestore `layers/{layerId}` (public read, Admin-SDK write). A major layer's
// id is its programId; a concentration's is "<programId>--<concentrationId>";
// college layers are "cas-college", "cals-college-2025", "cals-college-pre2025".
//
// Sources:
//   scripts/seed-data/layers/<family>/*.json      the authored layers (D12 folder):
//                                                  college, major and concentration
//                                                  layers, written by promote-layer.ts
//   --test adds:
//     scripts/seed-data/layers-test/*.json         fictional test majors (emulator / e2e only)
//     cornell-degree-planner/src/lib/planner/distribution/fixtures/*.json
//                                                  the Phase 2 college-layer fixtures; a
//                                                  fixture whose id an authored layer
//                                                  already has is SKIPPED (seed-data wins:
//                                                  Phase 5 re-authors the college layers
//                                                  under the same ids) and listed as such
//
// Every layer must pass the app's read boundary — LayerSchema AND lintLayer —
// or NOTHING is written (the app would drop it anyway). Layer ids must be unique
// (apart from the skipped fixtures above). A concentration needs its major among
// the seeded layers (same family): the app could never select it otherwise.
// College versions must be unambiguous: per family, when any college layer is
// seeded, exactly ONE of them has no layer-level appliesTo (the default
// version). None leaves a student outside every versioned layer with no college
// layer; two make the app's pickCollege report "ambiguous" for every student
// who matches no versioned layer. The Phase 2 fixtures count (--test).
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path (live), or
//        FIRESTORE_EMULATOR_HOST to rehearse on the emulator. Neither set: an
//        offline dry run (validates and lists; no diff against Firestore).
// Run (dry, default):  npx tsx seed-layers.ts [--test]
// Run (write):         npx tsx seed-layers.ts --apply [--test]
// `--test` is EMULATOR ONLY: refused unless FIRESTORE_EMULATOR_HOST is set.
// Writes replace each doc whole (no merge): the strict schema rejects a stale
// field a merge would leave behind. Layers no longer in the files are reported,
// never deleted. A live --apply first backs up the current layers to
// scripts/backups/ (gitignored).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { LayerSchema } from "../cornell-degree-planner/src/lib/schemas";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import type { Layer } from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { encodeLayerDoc } from "../cornell-degree-planner/src/lib/planner/distribution/layerDoc";
import { emulatorHost, initAdmin } from "./admin-app";

export const LAYERS_DIR = resolve(__dirname, "seed-data", "layers");
export const TEST_LAYERS_DIR = resolve(__dirname, "seed-data", "layers-test");
export const FIXTURE_LAYERS_DIR = resolve(
  __dirname,
  "..",
  "cornell-degree-planner",
  "src",
  "lib",
  "planner",
  "distribution",
  "fixtures"
);

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

export type SeedLayer = { file: string; layer: Layer };
/** `skipped`: Phase 2 fixtures left out because seed-data has a layer with their id. */
export type SeedLayerResult = { layers: SeedLayer[]; errors: string[]; skipped: string[] };
/** Where the layers are read from (overridable for the corpus). */
export type SeedLayerDirs = { layers: string; test: string; fixtures: string };
export const DEFAULT_SEED_DIRS: SeedLayerDirs = { layers: LAYERS_DIR, test: TEST_LAYERS_DIR, fixtures: FIXTURE_LAYERS_DIR };

/** Read, schema-check and lint every layer file. Pure apart from reading files.
 *  `test` adds the fictional test majors and the Phase 2 college fixtures
 *  (fixtures/plans/ holds plans, not layers, and is skipped); a fixture whose
 *  id an authored layer already has is skipped, not a duplicate. */
export function collectSeedLayers(opts: { test: boolean; dirs?: SeedLayerDirs }): SeedLayerResult {
  const dirs = opts.dirs ?? DEFAULT_SEED_DIRS;
  const authored = jsonFilesUnder(dirs.layers, true);
  const fixtureFiles = new Set(opts.test ? jsonFilesUnder(dirs.fixtures, false) : []);
  const files = [...authored, ...(opts.test ? jsonFilesUnder(dirs.test, false) : []), ...fixtureFiles];
  const layers: SeedLayer[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  const byId = new Map<string, string>();
  const authoredIds = new Set<string>();
  for (const file of files) {
    const name = relative(resolve(__dirname, ".."), file).split("\\").join("/");
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf-8"));
    } catch (e) {
      errors.push(`${name}: not valid JSON (${(e as Error).message})`);
      continue;
    }
    const rawId = raw && typeof raw === "object" && "id" in raw ? (raw as { id: unknown }).id : null;
    if (authored.includes(file) && typeof rawId === "string") authoredIds.add(rawId);
    if (fixtureFiles.has(file) && typeof rawId === "string" && authoredIds.has(rawId)) {
      skipped.push(`${name} (${rawId}: the authored layer in ${byId.get(rawId)} wins)`);
      continue;
    }
    const parsed = LayerSchema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) errors.push(`${name}: ${i.path.join(".") || "(root)"}: ${i.message}`);
      continue;
    }
    const layer = parsed.data as Layer;
    for (const msg of lintLayer(layer)) errors.push(`${name}: ${msg}`);
    if (layer.kind === "major" && layer.programId !== layer.id) {
      errors.push(`${name}: a major layer's id must be its programId (${layer.id} vs ${layer.programId})`);
    }
    // The app tells a concentration's load error from its major's by this
    // prefix; any other id would blank the whole major's panel.
    if (layer.kind === "concentration" && layer.id !== `${layer.programId}--${layer.concentrationId}`) {
      errors.push(`${name}: a concentration layer's id must be <programId>--<concentrationId> (${layer.id})`);
    }
    const prev = byId.get(layer.id);
    if (prev) errors.push(`${name}: layer id ${layer.id} also defined in ${prev}`);
    byId.set(layer.id, name);
    layers.push({ file: name, layer });
  }
  // A concentration is only ever selected with its major (select.ts).
  for (const { file, layer } of layers) {
    if (layer.kind !== "concentration") continue;
    const major = layers.find((l) => l.layer.id === layer.programId)?.layer;
    if (!major || major.kind !== "major") errors.push(`${file}: concentration ${layer.id} has no major layer ${layer.programId} among the seeded layers`);
    else if (major.family !== layer.family) errors.push(`${file}: concentration ${layer.id} is ${layer.family}, its major ${major.id} is ${major.family}`);
  }
  errors.push(...collegeDefaultProblems(layers));
  return { layers, errors, skipped };
}

/** Per family with any college layer: exactly one has no layer-level appliesTo. */
export function collegeDefaultProblems(layers: SeedLayer[]): string[] {
  const out: string[] = [];
  for (const family of ["cas", "cals"] as const) {
    const colleges = layers.filter((l) => l.layer.kind === "college" && l.layer.family === family);
    if (!colleges.length) continue;
    const defaults = colleges.filter((l) => l.layer.appliesTo == null);
    const list = (xs: SeedLayer[]) => xs.map((l) => `${l.layer.id} (${l.file})`).join(", ");
    if (!defaults.length)
      out.push(`${family}: college layers ${list(colleges)} all have an appliesTo, so a student matching none of them has no college layer: exactly one must have none (the default version)`);
    else if (defaults.length > 1)
      out.push(`${family}: ${defaults.length} college layers have no appliesTo (${list(defaults)}): exactly one may be the default version, or the app reports an ambiguous college for every student`);
  }
  return out;
}

/** Stable JSON for change detection (key order independent). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  const APPLY = process.argv.includes("--apply");
  const TEST = process.argv.includes("--test");
  if (TEST && !emulatorHost()) {
    fail("--test seeds fictional test majors and is EMULATOR ONLY; set FIRESTORE_EMULATOR_HOST.");
  }
  const backend = emulatorHost() != null || process.env.GOOGLE_APPLICATION_CREDENTIALS != null;
  if (APPLY && !backend) {
    fail("--apply needs FIRESTORE_EMULATOR_HOST (emulator) or GOOGLE_APPLICATION_CREDENTIALS (live).");
  }

  console.log(`\n── seed-layers (${APPLY ? "WRITE" : "DRY RUN"}${TEST ? ", --test" : ""}) ──`);
  if (!existsSync(LAYERS_DIR)) console.log(`   (no ${relative(resolve(__dirname, ".."), LAYERS_DIR)} folder yet: no authored layers)`);

  const { layers, errors, skipped } = collectSeedLayers({ test: TEST });
  for (const s of skipped) console.log(`   skipped fixture ${s}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`   ERROR ${e}`);
    fail(`${errors.length} layer error(s); nothing written.`);
  }
  console.log(`   layers: ${layers.length} valid (LayerSchema + lintLayer)`);
  if (layers.length === 0) {
    console.log("\nNothing to seed.");
    return;
  }

  if (!backend) {
    for (const { file, layer } of layers) {
      console.log(
        `     ${layer.id.padEnd(28)} ${layer.kind.padEnd(13)} ${layer.family.padEnd(5)} rows ${String(layer.rows.length).padStart(2)}  ${file}`
      );
    }
    console.log("\nOFFLINE DRY RUN — no backend configured, so no diff against Firestore. Nothing written.");
    return;
  }

  const db = initAdmin();
  const current = await db.collection("layers").get();
  const currentById = new Map(current.docs.map((d) => [d.id, d.data()]));
  const changes: SeedLayer[] = [];
  for (const entry of layers) {
    const now = currentById.get(entry.layer.id);
    const state = now == null ? "new" : stableJson(now) === stableJson(encodeLayerDoc(entry.layer)) ? "same" : "changed";
    if (state !== "same") changes.push(entry);
    console.log(
      `     ${entry.layer.id.padEnd(28)} ${entry.layer.kind.padEnd(13)} ${entry.layer.family.padEnd(5)} rows ${String(entry.layer.rows.length).padStart(2)}  ${state}`
    );
  }
  const seeded = new Set(layers.map((l) => l.layer.id));
  for (const id of currentById.keys()) {
    if (!seeded.has(id)) console.log(`     ${id.padEnd(28)} in Firestore, not in the files (left alone)`);
  }
  if (changes.length === 0) {
    console.log("\n   already up to date — nothing to write.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN — ${changes.length} layer(s) would be written. Pass --apply to write.`);
    return;
  }

  if (!emulatorHost()) {
    const dir = join(__dirname, "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `layers-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(Object.fromEntries(currentById), null, 2) + "\n", "utf8");
    console.log(`   backup: ${file}`);
  }

  const batch = db.batch();
  for (const { layer } of changes) batch.set(db.collection("layers").doc(layer.id), encodeLayerDoc(layer));
  await batch.commit();
  console.log(`\nSEED COMPLETE — wrote ${changes.length} layers/* doc(s).`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
