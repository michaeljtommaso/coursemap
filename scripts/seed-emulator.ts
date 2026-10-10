// scripts/seed-emulator.ts
// Load a catalog snapshot into the LOCAL Firestore emulator, so the app
// (`npm run dev:emu`), the e2e suite and browser QA run without touching the
// live project.
//
// Run (emulators started with `npm --prefix cornell-degree-planner run emulators`):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx seed-emulator.ts
//     --from <file>          catalog JSON: { courses, catalogIndex, programs,
//                            catalog } maps of id → doc (default: the newest
//                            scripts/backups/catalog-backup-*.json)
//     --courses-from <file>  take `courses` from this file instead (e.g. an
//                            offline simulation of the live state)
//
// Refuses to run unless FIRESTORE_EMULATOR_HOST points at a local address.
// Backups hold Timestamps as {_seconds,_nanoseconds}; they are restored.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { emulatorHost, initAdmin } from "./admin-app";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function newestBackup(): string {
  const dir = join(__dirname, "backups");
  const file = readdirSync(dir)
    .filter((f) => f.startsWith("catalog-backup-") && f.endsWith(".json"))
    .sort()
    .pop();
  if (!file) throw new Error("no scripts/backups/catalog-backup-*.json found; pass --from <file>");
  return join(dir, file);
}

// JSON round-trips Firestore Timestamps as {_seconds,_nanoseconds}.
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o._seconds === "number" && typeof o._nanoseconds === "number") {
      return new Timestamp(o._seconds, o._nanoseconds);
    }
    return Object.fromEntries(keys.map((k) => [k, revive(o[k])]));
  }
  return v;
}

type Snapshot = Record<string, Record<string, Record<string, unknown>>>;

async function main() {
  if (!emulatorHost()) {
    console.error("FIRESTORE_EMULATOR_HOST is unset. This script only ever writes to the local emulator.");
    process.exit(1);
  }
  const db = initAdmin();
  const from = argValue("--from") ?? newestBackup();
  const snapshot = JSON.parse(readFileSync(from, "utf8")) as Snapshot;
  const coursesFrom = argValue("--courses-from");
  if (coursesFrom) {
    snapshot.courses = (JSON.parse(readFileSync(coursesFrom, "utf8")) as Snapshot).courses;
  }
  console.log(`   source: ${from}${coursesFrom ? ` (courses from ${coursesFrom})` : ""}`);

  const writer = db.bulkWriter();
  for (const [collection, docs] of Object.entries(snapshot)) {
    if (!docs || typeof docs !== "object") continue;
    let n = 0;
    for (const [id, data] of Object.entries(docs)) {
      writer.set(db.collection(collection).doc(id), revive(data) as Record<string, unknown>);
      n++;
    }
    console.log(`   ${collection}: ${n} doc(s)`);
  }
  await writer.close();
  console.log("\nEMULATOR SEEDED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
