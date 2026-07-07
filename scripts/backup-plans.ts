// scripts/backup-plans.ts
// Admin SDK dump of user plans + profiles to a dated JSON file (docs/specs/002 §8d).
//
// User plans are the only NON-regenerable data (catalog/programs come from the
// seed JSON in git). Run manually before any risky change; weekly during beta.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:   npx tsx backup-plans.ts
//        npx tsx backup-plans.ts --dry-run   (counts only, writes nothing)
//
// Output: backups/plans-YYYY-MM-DD-HHmmss.json  (backups/ is gitignored — user
// data never enters version control).

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";
const BACKUP_DIR = resolve(__dirname, "backups");

function fail(msg: string): never {
  console.error(`\nBACKUP ABORTED: ${msg}`);
  process.exit(1);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
        "before running a backup (never commit or echo that file)."
    );
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  // Enumerate every user doc, then each user's plans subcollection.
  const usersSnap = await db.collection("users").get();

  const dump: {
    exportedAt: string;
    projectId: string;
    users: Array<{
      uid: string;
      profile: FirebaseFirestore.DocumentData | null;
      plans: Array<{ id: string; data: FirebaseFirestore.DocumentData }>;
    }>;
  } = { exportedAt: new Date().toISOString(), projectId: PROJECT_ID, users: [] };

  let planCount = 0;
  for (const userDoc of usersSnap.docs) {
    const plansSnap = await db
      .collection("users")
      .doc(userDoc.id)
      .collection("plans")
      .get();
    const plans = plansSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    planCount += plans.length;
    dump.users.push({
      uid: userDoc.id,
      profile: userDoc.exists ? userDoc.data() : null,
      plans,
    });
  }

  console.log(`\n── backup-plans (${DRY_RUN ? "DRY RUN" : "WRITE"}) ──`);
  console.log(`   project: ${PROJECT_ID}`);
  console.log(`   users:   ${dump.users.length}`);
  console.log(`   plans:   ${planCount}`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = resolve(BACKUP_DIR, `plans-${stamp()}.json`);
  // Firestore Timestamps serialize as { _seconds, _nanoseconds } — good enough
  // for a human-restorable dump; a restore script would rehydrate them.
  writeFileSync(file, JSON.stringify(dump, null, 2), "utf-8");
  console.log(`\nBACKUP WRITTEN → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
