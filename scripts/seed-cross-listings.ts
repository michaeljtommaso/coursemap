// scripts/seed-cross-listings.ts
// Push scripts/seed-data/cross-listings.json (roster cross-listing families,
// built by build-cross-listings.ts) to the catalog/meta doc's `crossListings`
// field, and nothing else. The app reads that field ONLY for a course's
// crossListedSubjects (the `crossListed` rule leaf); it never canonicalizes ids
// with it (catalog/meta `aliases` alone does that, seed-aliases.ts).
//
// Backends (the seed-minor-index.ts rules). Default: an offline dry run
// (validates the file and lists the LSP families; touches no Firestore).
// FIRESTORE_EMULATOR_HOST set: the emulator (dry run diffs against it; --apply
// writes). The LIVE project only with --live AND GOOGLE_APPLICATION_CREDENTIALS
// and FIRESTORE_EMULATOR_HOST unset; a live --apply first backs up the current
// catalog/meta doc to scripts/backups/ (gitignored).
//
// Before any write the new doc must pass the app's CatalogMetaSchema WITH the
// map kept (a map the schema would drop is refused), stay under 900 KB, and
// leave `aliases` untouched.
//
// Run (dry, offline):      npx tsx seed-cross-listings.ts
// Run (emulator write):    FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> npx tsx seed-cross-listings.ts --apply
// Run (live dry run):      npx tsx seed-cross-listings.ts --live
// Run (live write):        npx tsx seed-cross-listings.ts --live --apply
// Idempotent: the field is replaced with the file's map. Exit 0 ok, 1 refused or failed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { CatalogMetaSchema } from "../cornell-degree-planner/src/lib/schemas";
import { emulatorHost, initAdmin } from "./admin-app";
import { crossListingProblems, familiesWithSubject } from "./cross-listings";
import { CROSS_LISTINGS_FILE } from "./layer-authoring";
import { chooseBackend } from "./seed-minor-index";

const MAX_META_BYTES = 900_000;

/** The file's map, validated. Throws on a missing or malformed file. */
export function loadCrossListingsFile(file: string = CROSS_LISTINGS_FILE): Record<string, string> {
  if (!existsSync(file)) throw new Error(`${file} is missing (run build-cross-listings.ts)`);
  const raw = JSON.parse(readFileSync(file, "utf-8")) as { crossListings?: unknown };
  const map = raw.crossListings;
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error(`${file}: no crossListings map`);
  const problems = crossListingProblems(map as Record<string, string>);
  if (problems.length) throw new Error(`${file}: ${problems.slice(0, 5).join("; ")}`);
  return map as Record<string, string>;
}

/** Problems with writing `map` into this catalog/meta doc ([] = safe). */
export function metaWriteProblems(current: Record<string, unknown>, map: Record<string, string>): string[] {
  const out: string[] = [];
  const next = { ...current, crossListings: map };
  const parsed = CatalogMetaSchema.safeParse(next);
  if (!parsed.success) out.push(`catalog/meta would fail the app's schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  else if (parsed.data.crossListings === undefined) out.push("the app's schema would drop crossListings");
  const bytes = Buffer.byteLength(JSON.stringify(next), "utf-8");
  if (bytes > MAX_META_BYTES) out.push(`catalog/meta would be ${bytes} bytes (limit ${MAX_META_BYTES})`);
  return out;
}

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

const stable = (m: Record<string, string> | undefined) =>
  JSON.stringify(Object.keys(m ?? {}).sort().map((k) => [k, (m ?? {})[k]]));

async function main() {
  const argv = process.argv.slice(2);
  for (const a of argv) if (!["--apply", "--live"].includes(a)) fail(`unknown argument ${a} (usage: npx tsx seed-cross-listings.ts [--apply] [--live])`);
  const APPLY = argv.includes("--apply");
  const LIVE = argv.includes("--live");
  const backend = chooseBackend({ apply: APPLY, live: LIVE }, { emulatorHost: emulatorHost(), credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS != null });
  if (backend.kind === "refused") fail(backend.reason);

  console.log(`\n── seed-cross-listings (${APPLY ? "WRITE" : "DRY RUN"}, ${backend.kind}) ──`);
  let map: Record<string, string>;
  try {
    map = loadCrossListingsFile();
  } catch (e) {
    fail((e as Error).message);
  }
  const reps = new Set(Object.values(map));
  console.log(`   cross-listings.json: ${reps.size} families, ${Object.keys(map).length} member entries`);
  const lsp = familiesWithSubject(map, "LSP");
  console.log(`   LSP families (spot check): ${lsp.length}`);
  for (const ids of lsp.slice(0, 8)) console.log(`     ${ids.join(" ")}`);

  if (backend.kind === "offline") {
    const problems = metaWriteProblems({ aliases: {} }, map);
    for (const p of problems) console.error(`   ERROR ${p}`);
    if (problems.length) fail("the map would not load in the app; nothing written.");
    console.log("\nOFFLINE DRY RUN — no backend selected, so no Firestore was contacted. Nothing written.");
    return;
  }

  const db = initAdmin();
  const ref = db.collection("catalog").doc("meta");
  const snap = await ref.get();
  if (!snap.exists) fail("catalog/meta does not exist; seed the catalog first.");
  const current = snap.data() as Record<string, unknown>;
  const problems = metaWriteProblems(current, map);
  for (const p of problems) console.error(`   ERROR ${p}`);
  if (problems.length) fail("refused; nothing written.");

  const now = current.crossListings as Record<string, string> | undefined;
  const nowCount = now ? Object.keys(now).length : 0;
  const added = Object.keys(map).filter((k) => now?.[k] !== map[k]).length;
  const removed = Object.keys(now ?? {}).filter((k) => map[k] === undefined).length;
  console.log(`   catalog/meta crossListings: ${nowCount} entries now; ${added} new or changed, ${removed} removed`);
  console.log(`   catalog/meta aliases: ${Object.keys((current.aliases as object) ?? {}).length} (untouched)`);
  if (stable(now) === stable(map)) {
    console.log("\n   already up to date — nothing to write.");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Pass --apply to write.");
    return;
  }
  if (backend.kind === "live") {
    const dir = join(__dirname, "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `catalog-meta-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(current, null, 2) + "\n", "utf8");
    console.log(`   backup: ${file}`);
  }
  // update() replaces the whole map field (a map value is not merged key by key).
  await ref.update({ crossListings: map });
  const back = (await ref.get()).data() as Record<string, unknown>;
  const ok = stable(back.crossListings as Record<string, string>) === stable(map) && stable(back.aliases as Record<string, string>) === stable(current.aliases as Record<string, string>);
  if (!ok) fail("read-back differs from what was written (check catalog/meta by hand; the backup is above for a live run)");
  console.log(`\nSEED COMPLETE — wrote catalog/meta.crossListings (${Object.keys(map).length} entries) to the ${backend.kind}; read-back matches, aliases unchanged.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
