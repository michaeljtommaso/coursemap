// scripts/seed-program-index.ts
// Build and seed `catalog/programIndex` (spec 019 D11): ONE doc listing every
// program, which the app's major picker reads instead of every program doc.
//
// Entries come from:
//   scripts/seed-data/programs-2025/*.json   Engineering-family slot files
//   scripts/seed-data/programs.json          the four legacy majors (…-bs-2026)
//   the blank canvas program                 (mirrors seed-blank-program.ts)
//   every MAJOR layer in scripts/seed-data/layers/ (family cas/cals; college from family)
//   --test adds the fictional test majors in scripts/seed-data/layers-test/
// Entries are majors only: college and concentration layers in the same folders
// are not programs (a concentration is chosen inside its major), so they add no
// entry. They still go through collectSeedLayers, so a broken one, or a
// concentration without its major, is an error here too.
// Overrides: scripts/seed-data/program-index-meta.json,
//   { "<programId>": { shortName?, twins?, url?, status? } }
//
// Defaults: every program is "visible"; `status: "hidden"` in the meta file
// pulls one from the pickers without deleting anything (spec 019 D11). `url` is the Cornell major page
// from src/data/program-links.ts when one is listed, else null. Twins are made
// symmetric, and a twin id that is not in the index is dropped with a warning.
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path (live), or
//        FIRESTORE_EMULATOR_HOST to rehearse on the emulator. Neither set: an
//        offline dry run (builds, validates and lists; no diff).
// Run (dry, default):  npx tsx seed-program-index.ts [--test]
// Run (write):         npx tsx seed-program-index.ts --apply [--test]
// `--test` is EMULATOR ONLY. The doc is replaced whole. A live --apply first
// backs up the current doc to scripts/backups/ (gitignored).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { ProgramIndexDocSchema } from "../cornell-degree-planner/src/lib/schemas";
import {
  COLLEGES,
  collegeIdFromName,
  type CollegeId,
  type ProgramFamily,
} from "../cornell-degree-planner/src/lib/planner/colleges";
import { programLinks } from "../cornell-degree-planner/src/data/program-links";
import { emulatorHost, initAdmin } from "./admin-app";
import { collectSeedLayers, DEFAULT_SEED_DIRS, stableJson, type SeedLayerDirs } from "./seed-layers";

const DATA_DIR = resolve(__dirname, "seed-data");
const META_FILE = join(DATA_DIR, "program-index-meta.json");

// The blank canvas program (seed-blank-program.ts BLANK_PROGRAM): keep in sync.
const BLANK = {
  id: "blank",
  name: "Start from scratch",
  shortName: "Blank",
  college: "Your own plan",
  catalogYear: 2025,
  totalCredits: null,
};

type SlotFileProgram = {
  id: string;
  name: string;
  shortName: string;
  college: string;
  catalogYear: number;
  totalCredits?: number | null;
};

const MetaSchema = z.record(
  z.string(),
  z
    .object({
      shortName: z.string().min(1).max(40).optional(),
      twins: z.array(z.string().max(80)).max(4).optional(),
      url: z.string().url().max(300).nullable().optional(),
      status: z.enum(["visible", "hidden"]).optional(),
    })
    .strict()
);
type Meta = z.infer<typeof MetaSchema>;

function slotFilePrograms(): SlotFileProgram[] {
  const dir = join(DATA_DIR, "programs-2025");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const p2025 = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as SlotFileProgram);
  const legacyRaw = JSON.parse(readFileSync(join(DATA_DIR, "programs.json"), "utf-8")) as
    | SlotFileProgram[]
    | { programs: SlotFileProgram[] };
  const legacy = Array.isArray(legacyRaw) ? legacyRaw : legacyRaw.programs;
  return [...legacy, ...p2025, BLANK];
}

/** A short name for a layer-backed major that has none in the meta file. */
function defaultShortName(name: string): string {
  const base = name.replace(/\s*\(.*\)\s*$/, "").replace(/,?\s+(B\.A\.|B\.S\.)$/, "");
  return base.length <= 40 ? base : base.slice(0, 40).trimEnd();
}

/** One index entry, as ProgramIndexEntrySchema (lib/schemas.ts) validates it. */
export type IndexEntry = {
  id: string;
  name: string;
  shortName: string;
  college: string;
  collegeId: CollegeId | null;
  family: ProgramFamily;
  twins: string[];
  url: string | null;
  status: "visible" | "hidden";
  catalogYear: number;
  totalCredits: number | null;
};

export type BuildResult = { entries: IndexEntry[]; warnings: string[]; errors: string[] };

/** Build every index entry. Pure apart from reading the seed files. */
export function buildProgramIndex(opts: { test: boolean; layerDirs?: SeedLayerDirs }): BuildResult {
  const layerDirs = opts.layerDirs ?? DEFAULT_SEED_DIRS;
  const TEST_LAYERS_DIR = resolve(layerDirs.test);
  const warnings: string[] = [];
  const errors: string[] = [];
  const metaParsed = MetaSchema.safeParse(JSON.parse(readFileSync(META_FILE, "utf-8")));
  if (!metaParsed.success) {
    return {
      entries: [],
      warnings,
      errors: metaParsed.error.issues.map((i) => `program-index-meta.json: ${i.path.join(".")}: ${i.message}`),
    };
  }
  const meta: Meta = metaParsed.data;

  const raw: (Omit<IndexEntry, "twins" | "url" | "status"> & {
    defaultStatus: "visible" | "hidden";
    defaultUrl: string | null;
  })[] = [];

  for (const p of slotFilePrograms()) {
    raw.push({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      college: p.college,
      collegeId: collegeIdFromName(p.college),
      // Every slot file runs on the Engineering engine.
      family: "engineering",
      catalogYear: p.catalogYear,
      totalCredits: p.totalCredits ?? null,
      defaultStatus: "visible",
      defaultUrl: programLinks(p.shortName)?.majorPage ?? null,
    });
  }

  const layers = collectSeedLayers({ test: opts.test, dirs: layerDirs });
  errors.push(...layers.errors);
  for (const { layer } of layers.layers) {
    // Colleges and concentrations are not programs: no entry.
    if (layer.kind !== "major") continue;
    const college = COLLEGES.find((c) => c.id === layer.family)!;
    raw.push({
      id: layer.id,
      name: layer.name,
      shortName: meta[layer.id]?.shortName ?? defaultShortName(layer.name),
      college: college.name,
      collegeId: college.id,
      family: layer.family,
      catalogYear: Number(layer.catalogYear.slice(0, 4)),
      totalCredits: null,
      // Released layers are visible (spec 019 D16 was dropped: students report
      // errors from every row instead). Meta `status: "hidden"` pulls one.
      defaultStatus: "visible",
      defaultUrl: null,
    });
  }

  const ids = new Set<string>();
  for (const r of raw) {
    if (ids.has(r.id)) errors.push(`program id ${r.id} appears twice (slot file and layer?)`);
    ids.add(r.id);
  }
  // The test majors' meta entries are expected to be unused outside --test.
  const testIds = new Set(
    existsSync(TEST_LAYERS_DIR)
      ? readdirSync(TEST_LAYERS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
      : []
  );
  for (const id of Object.keys(meta)) {
    if (!ids.has(id) && !testIds.has(id)) {
      warnings.push(`program-index-meta.json names ${id}, which is not in the index (skipped)`);
    }
  }

  // Twins: from the meta file, symmetric, only ids that are in the index.
  const twins = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!twins.has(a)) twins.set(a, new Set());
    twins.get(a)!.add(b);
  };
  for (const [id, m] of Object.entries(meta)) {
    if (!ids.has(id)) continue;
    for (const t of m.twins ?? []) {
      if (!ids.has(t)) {
        warnings.push(`${id}: twin ${t} is not in the index (dropped)`);
        continue;
      }
      if (t === id) continue;
      link(id, t);
      link(t, id);
    }
  }

  const entries: IndexEntry[] = raw.map(({ defaultStatus, defaultUrl, ...r }) => {
    const m = meta[r.id];
    return {
      ...r,
      shortName: m?.shortName ?? r.shortName,
      twins: [...(twins.get(r.id) ?? [])].sort(),
      url: m?.url !== undefined ? m.url : defaultUrl,
      status: m?.status ?? defaultStatus,
    };
  });
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, warnings, errors };
}

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  const APPLY = process.argv.includes("--apply");
  const TEST = process.argv.includes("--test");
  if (TEST && !emulatorHost()) {
    fail("--test lists fictional test majors and is EMULATOR ONLY; set FIRESTORE_EMULATOR_HOST.");
  }
  const backend = emulatorHost() != null || process.env.GOOGLE_APPLICATION_CREDENTIALS != null;
  if (APPLY && !backend) {
    fail("--apply needs FIRESTORE_EMULATOR_HOST (emulator) or GOOGLE_APPLICATION_CREDENTIALS (live).");
  }

  console.log(`\n── seed-program-index (${APPLY ? "WRITE" : "DRY RUN"}${TEST ? ", --test" : ""}) ──`);
  const { entries, warnings, errors } = buildProgramIndex({ test: TEST });
  for (const w of warnings) console.log(`   WARN  ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`   ERROR ${e}`);
    fail(`${errors.length} error(s); nothing written.`);
  }
  const parsed = ProgramIndexDocSchema.safeParse({ entries });
  if (!parsed.success) {
    for (const i of parsed.error.issues) console.error(`   ERROR ${i.path.join(".")}: ${i.message}`);
    fail("the index does not match ProgramIndexDocSchema; nothing written.");
  }
  const doc = parsed.data;

  console.log(`   entries: ${doc.entries.length}`);
  for (const e of doc.entries) {
    console.log(
      `     ${e.id.padEnd(26)} ${e.family.padEnd(11)} ${String(e.collegeId).padEnd(11)} ${e.status.padEnd(7)} ` +
        `${e.shortName.padEnd(10)} twins [${e.twins.join(", ")}]  ${e.url ?? "(no url)"}`
    );
  }

  if (!backend) {
    console.log("\nOFFLINE DRY RUN — no backend configured, so no diff against Firestore. Nothing written.");
    return;
  }

  const db = initAdmin();
  const ref = db.collection("catalog").doc("programIndex");
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : null;
  const same = current != null && stableJson(current.entries) === stableJson(doc.entries);
  console.log(`   catalog/programIndex: ${current == null ? "absent (will be created)" : same ? "same" : "changed"}`);
  if (same) {
    console.log("\n   already up to date — nothing to write.");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Pass --apply to write.");
    return;
  }

  if (!emulatorHost() && current != null) {
    const dir = join(__dirname, "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `program-index-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(current, null, 2) + "\n", "utf8");
    console.log(`   backup: ${file}`);
  }

  await ref.set({ entries: doc.entries, updatedAt: FieldValue.serverTimestamp() });
  console.log(`\nSEED COMPLETE — wrote catalog/programIndex (${doc.entries.length} entries).`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
