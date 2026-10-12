// scripts/seed-aliases.ts
// Push seed-data/aliases.json (cross-listing alias id → canonical id) to the
// catalog/meta doc's `aliases` field, and nothing else. seed-firestore.ts also
// writes catalog/meta, but as part of a full bootstrap that would overwrite
// the roster-synced catalog; this touches one field of one doc.
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path (live), or
//        FIRESTORE_EMULATOR_HOST to rehearse on the emulator.
// Run (dry, default):  npx tsx seed-aliases.ts          (reads catalog/meta, prints the diff)
// Run (write):         npx tsx seed-aliases.ts --apply
// Idempotent: the field is replaced with the file's map.

import { readFileSync } from "fs";
import { resolve } from "path";
import { initAdmin } from "./admin-app";

const APPLY = process.argv.includes("--apply");

async function main() {
  const file = resolve(__dirname, "seed-data", "aliases.json");
  const aliases = JSON.parse(readFileSync(file, "utf-8")) as Record<string, string>;
  for (const [from, to] of Object.entries(aliases)) {
    if (!/^[A-Z]+-\d+[A-Z]?$/.test(from) || !/^[A-Z]+-\d+[A-Z]?$/.test(to) || from === to) {
      throw new Error(`aliases.json: bad entry ${from} → ${to}`);
    }
  }

  const db = initAdmin();
  const ref = db.collection("catalog").doc("meta");
  const snap = await ref.get();
  if (!snap.exists) throw new Error("catalog/meta does not exist; seed the catalog first.");
  const current = (snap.get("aliases") as Record<string, string> | undefined) ?? {};

  const keys = [...new Set([...Object.keys(current), ...Object.keys(aliases)])].sort();
  const changes = keys.filter((k) => current[k] !== aliases[k]);
  console.log(`\n── seed-aliases (${APPLY ? "WRITE" : "DRY RUN"}) ──`);
  console.log(`   catalog/meta aliases: ${Object.keys(current).length} now, ${Object.keys(aliases).length} in aliases.json`);
  for (const k of changes) {
    console.log(`   ${k.padEnd(12)} ${current[k] ?? "(none)"} → ${aliases[k] ?? "(removed)"}`);
  }
  if (changes.length === 0) {
    console.log("   already up to date — nothing to write.");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Pass --apply to write.");
    return;
  }
  await ref.update({ aliases });
  console.log(`\nWROTE catalog/meta.aliases (${changes.length} change(s)).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
