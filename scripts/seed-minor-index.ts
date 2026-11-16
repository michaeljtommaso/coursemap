// scripts/seed-minor-index.ts
// Build and seed `catalog/minorIndex` (spec 047 D12): ONE doc listing every
// minor, which the app's add-a-minor picker reads. Kept apart from
// catalog/programIndex so a stale client never shows a minor as a major.
//
// Entries come from:
//   every MINOR layer in scripts/seed-data/layers/ (promote-layer.ts writes
//   them to layers/minors/): id, catalogYear, and name (the layer's name);
//   scripts/seed-data/minor-index.json, hand-kept, keyed by minor id:
//     { "<minorId>": { shortName, offeredBy, name?, notOpenTo?, onlyOpenTo?, visible? } }
//     shortName  the short label ("CS minor")
//     offeredBy  who offers it, as displayed; the picker groups by it
//     name       overrides the layer's name (optional)
//     notOpenTo  program-id prefixes whose majors may not take it (matched like
//                the `program` rule leaf: "cornell-mathematics-ba" also matches
//                "cornell-mathematics-ba-2026"); the picker lists it disabled
//     onlyOpenTo program-id prefixes it is ONLY open to (matched the same way):
//                closed to a plan unless its primary or second major matches
//                one; a prefix may not be in both lists
//     visible    false pulls it from the picker without deleting anything
// Every promoted minor needs an entry (an error otherwise). An entry whose
// minor is not promoted yet is skipped with a warning (entries may be written
// ahead of the layer). The doc must pass MinorIndexSchema.
//
// Backends. Default: an offline dry run (builds, validates and lists; touches
// no Firestore at all). FIRESTORE_EMULATOR_HOST set: the emulator (dry run
// diffs against it; --apply writes). The LIVE project only with --live AND
// GOOGLE_APPLICATION_CREDENTIALS and FIRESTORE_EMULATOR_HOST unset; a live
// --apply first backs up the current doc to scripts/backups/ (gitignored).
// Without --live no live project is ever contacted, even for a dry run.
//
// Run (dry, offline):     npx tsx seed-minor-index.ts
// Run (emulator write):   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx seed-minor-index.ts --apply
// Run (live write):       npx tsx seed-minor-index.ts --live --apply
// The doc is replaced whole. Exit 0 ok, 1 errors or refused.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { FieldValue } from "firebase-admin/firestore";
import { MinorIndexSchema, type MinorIndexEntry } from "../cornell-degree-planner/src/lib/schemas";
import { isProgramIdPrefix } from "../cornell-degree-planner/src/lib/planner/distribution/programPrefix";
import type { Layer } from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { emulatorHost, initAdmin } from "./admin-app";
import { MINOR_INDEX_ENTRIES } from "./layer-authoring";
import { collectSeedLayers, DEFAULT_SEED_DIRS, stableJson, type SeedLayerDirs } from "./seed-layers";

/** One hand-kept entry (minor-index.json). */
export type MinorIndexMeta = {
  shortName: string;
  offeredBy: string;
  name?: string;
  notOpenTo?: string[];
  onlyOpenTo?: string[];
  visible?: boolean;
};

const META_KEYS = ["shortName", "offeredBy", "name", "notOpenTo", "onlyOpenTo", "visible"];

/** Problems with the hand-kept file itself. */
export function metaProblems(meta: unknown): string[] {
  const out: string[] = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return ["minor-index.json must be an object keyed by minor id"];
  for (const [id, raw] of Object.entries(meta as Record<string, unknown>)) {
    if (!isProgramIdPrefix(id)) out.push(`${id}: not a minor id`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out.push(`${id}: entry must be an object`);
      continue;
    }
    const e = raw as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!META_KEYS.includes(k)) out.push(`${id}: unknown key "${k}"`);
    if (typeof e.shortName !== "string" || !e.shortName.trim()) out.push(`${id}: shortName is required`);
    if (typeof e.offeredBy !== "string" || !e.offeredBy.trim()) out.push(`${id}: offeredBy is required`);
    if (e.name !== undefined && (typeof e.name !== "string" || !e.name.trim())) out.push(`${id}: name must be a non-empty string`);
    if (e.visible !== undefined && typeof e.visible !== "boolean") out.push(`${id}: visible must be true or false`);
    for (const key of ["notOpenTo", "onlyOpenTo"] as const) {
      const list = e[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.length) out.push(`${id}: ${key} must be a non-empty list of program ids`);
      else for (const p of list) if (!isProgramIdPrefix(p)) out.push(`${id}: ${key} entry ${JSON.stringify(p)} is not a program id prefix`);
    }
    if (Array.isArray(e.notOpenTo) && Array.isArray(e.onlyOpenTo)) {
      for (const p of e.onlyOpenTo) if (e.notOpenTo.includes(p)) out.push(`${id}: ${JSON.stringify(p)} is in both notOpenTo and onlyOpenTo`);
    }
  }
  return out;
}

/** The index entries from the promoted minor layers and the hand-kept file. Pure. */
export function buildMinorIndex(minors: Layer[], meta: Record<string, MinorIndexMeta>): { entries: MinorIndexEntry[]; errors: string[]; warnings: string[] } {
  const errors = metaProblems(meta);
  const warnings: string[] = [];
  const entries: MinorIndexEntry[] = [];
  const ids = new Set<string>();
  for (const layer of minors) {
    if (layer.kind !== "minor") {
      errors.push(`${layer.id} is a ${layer.kind} layer, not a minor`);
      continue;
    }
    if (ids.has(layer.id)) errors.push(`minor ${layer.id} appears twice`);
    ids.add(layer.id);
    const m = meta[layer.id];
    if (!m) {
      errors.push(`minor ${layer.id} has no entry in minor-index.json (shortName, offeredBy, notOpenTo, onlyOpenTo)`);
      continue;
    }
    const e: MinorIndexEntry = { id: layer.id, name: m.name ?? layer.name, shortName: m.shortName, offeredBy: m.offeredBy, catalogYear: layer.catalogYear };
    if (m.notOpenTo?.length) e.notOpenTo = [...m.notOpenTo];
    if (m.onlyOpenTo?.length) e.onlyOpenTo = [...m.onlyOpenTo];
    if (m.visible !== undefined) e.visible = m.visible;
    entries.push(e);
  }
  for (const id of Object.keys(meta)) if (!ids.has(id)) warnings.push(`minor-index.json lists ${id}, which is not promoted yet (skipped)`);
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const parsed = MinorIndexSchema.safeParse({ entries });
  if (!parsed.success) for (const i of parsed.error.issues) errors.push(`MinorIndexSchema: ${i.path.join(".")}: ${i.message}`);
  return { entries, errors, warnings };
}

/** Where the index may be written: decided from the flags and environment. */
export type Backend = { kind: "offline" } | { kind: "emulator"; host: string } | { kind: "live" } | { kind: "refused"; reason: string };

export function chooseBackend(opts: { apply: boolean; live: boolean }, env: { emulatorHost: string | null; credentials: boolean }): Backend {
  if (env.emulatorHost) {
    if (opts.live) return { kind: "refused", reason: "--live and FIRESTORE_EMULATOR_HOST are exclusive: unset one" };
    return { kind: "emulator", host: env.emulatorHost };
  }
  if (opts.live) {
    if (!env.credentials) return { kind: "refused", reason: "--live needs GOOGLE_APPLICATION_CREDENTIALS" };
    return { kind: "live" };
  }
  if (opts.apply) return { kind: "refused", reason: "--apply needs FIRESTORE_EMULATOR_HOST (emulator), or --live with GOOGLE_APPLICATION_CREDENTIALS (live)" };
  return { kind: "offline" };
}

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  for (const a of argv) if (!["--apply", "--live"].includes(a)) fail(`unknown argument ${a} (usage: npx tsx seed-minor-index.ts [--apply] [--live])`);
  const APPLY = argv.includes("--apply");
  const LIVE = argv.includes("--live");
  const backend = chooseBackend({ apply: APPLY, live: LIVE }, { emulatorHost: emulatorHost(), credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS != null });
  if (backend.kind === "refused") fail(backend.reason);

  console.log(`\n── seed-minor-index (${APPLY ? "WRITE" : "DRY RUN"}, ${backend.kind}) ──`);
  const dirs: SeedLayerDirs = DEFAULT_SEED_DIRS;
  const layers = collectSeedLayers({ test: false, dirs });
  if (layers.errors.length) {
    for (const e of layers.errors) console.error(`   ERROR ${e}`);
    fail(`${layers.errors.length} layer error(s); nothing written.`);
  }
  if (!existsSync(MINOR_INDEX_ENTRIES)) fail(`${MINOR_INDEX_ENTRIES} is missing`);
  const meta = JSON.parse(readFileSync(MINOR_INDEX_ENTRIES, "utf-8")) as Record<string, MinorIndexMeta>;
  const minors = layers.layers.map((l) => l.layer).filter((l) => l.kind === "minor");
  const { entries, errors, warnings } = buildMinorIndex(minors, meta);
  for (const w of warnings) console.log(`   WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`   ERROR ${e}`);
    fail(`${errors.length} error(s); nothing written.`);
  }
  console.log(`   entries: ${entries.length}`);
  for (const e of entries)
    console.log(`     ${e.id.padEnd(40)} ${e.shortName.padEnd(20)} ${e.offeredBy.padEnd(32)} ${e.visible === false ? "hidden " : "visible"}  not open to [${(e.notOpenTo ?? []).join(", ")}]${e.onlyOpenTo ? `  only open to [${e.onlyOpenTo.join(", ")}]` : ""}`);

  if (backend.kind === "offline") {
    console.log("\nOFFLINE DRY RUN — no backend selected, so no Firestore was contacted. Nothing written.");
    return;
  }
  const db = initAdmin();
  const ref = db.collection("catalog").doc("minorIndex");
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : null;
  const same = current != null && stableJson(current.entries) === stableJson(entries);
  console.log(`   catalog/minorIndex: ${current == null ? "absent (will be created)" : same ? "same" : "changed"}`);
  if (same) {
    console.log("\n   already up to date — nothing to write.");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Pass --apply to write.");
    return;
  }
  if (backend.kind === "live" && current != null) {
    const dir = join(__dirname, "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `minor-index-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(current, null, 2) + "\n", "utf8");
    console.log(`   backup: ${file}`);
  }
  await ref.set({ entries, updatedAt: FieldValue.serverTimestamp() });
  console.log(`\nSEED COMPLETE — wrote catalog/minorIndex (${entries.length} entries) to the ${backend.kind}.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
