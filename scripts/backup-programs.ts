// scripts/backup-programs.ts
// Save every programs/* doc to scripts/backups/programs-backup-<timestamp>.json
// (gitignored) so a program re-seed can be compared and rolled back exactly.
// Read-only: about one read per program (16 today).
//
// Run from scripts/:  npx tsx backup-programs.ts
// Then, after a re-seed:  npx tsx compare-programs.ts <that backup> <programId...>

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initAdmin, PROJECT_ID } from "./admin-app";

async function main() {
  const db = initAdmin();
  const snap = await db.collection("programs").get();
  const out: Record<string, unknown> = {};
  for (const d of snap.docs) out[d.id] = d.data();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(__dirname, "backups", `programs-backup-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ project: PROJECT_ID, programs: out }));
  console.log(`   project ${PROJECT_ID}: ${snap.size} program(s) → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
