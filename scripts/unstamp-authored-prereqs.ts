// scripts/unstamp-authored-prereqs.ts
// Retires the blanket "authored" provenance stamp (docs/plans/2026-10-10-prereq-
// data-fixes-plan.md, A2). Every course doc whose prereqSource or coreqSource is
// "authored" gets that field set to null, so parse-prereqs.ts owns its trees
// again. Only the provenance fields are written — never a tree.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx unstamp-authored-prereqs.ts          (DRY RUN — list + backup only)
//   npx tsx unstamp-authored-prereqs.ts --apply  (LIVE — clear the stamps)
//
// Safety:
//   • Both modes first write a JSON backup of every matched doc's trees and
//     provenance to scripts/backups/ (gitignored).
//   • Each write is compare-and-set: a transaction re-reads the doc and only
//     clears a field that still reads "authored".

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "degree-planner-app";
const APPLY = process.argv.includes("--apply");
const AUTHORED = "authored";

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key (never echo it).");
    process.exit(1);
  }
  console.log(`\n── unstamp-authored-prereqs (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`);
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const [byPrereq, byCoreq] = await Promise.all([
    db.collection("courses").where("prereqSource", "==", AUTHORED).get(),
    db.collection("courses").where("coreqSource", "==", AUTHORED).get(),
  ]);
  const docs = new Map([...byPrereq.docs, ...byCoreq.docs].map((d) => [d.id, d]));
  const ids = [...docs.keys()].sort();
  console.log(`   courses carrying an "authored" stamp: ${ids.length}`);

  const backup: Record<string, unknown> = {};
  for (const id of ids) {
    const d = docs.get(id)!.data();
    backup[id] = {
      prereqSource: d.prereqSource ?? null,
      coreqSource: d.coreqSource ?? null,
      prereqExpr: d.prereqExpr ?? null,
      coreqExpr: d.coreqExpr ?? null,
      prereqNotes: d.prereqNotes ?? null,
    };
    console.log(
      `   ${id.padEnd(12)} prereqSource=${d.prereqSource ?? "—"} coreqSource=${d.coreqSource ?? "—"}`
    );
  }
  const dir = join(__dirname, "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `unstamp-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2) + "\n", "utf8");
  console.log(`   backup: ${file}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to clear ${ids.length} stamp(s).`);
    return;
  }

  let cleared = 0;
  let skipped = 0;
  for (const id of ids) {
    const ref = db.collection("courses").doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data() ?? {};
      const update: Record<string, null> = {};
      if (d.prereqSource === AUTHORED) update.prereqSource = null;
      if (d.coreqSource === AUTHORED) update.coreqSource = null;
      if (Object.keys(update).length === 0) {
        skipped++;
        return;
      }
      tx.update(ref, update);
      cleared++;
    });
  }
  console.log(`\n   cleared: ${cleared}  skipped (changed since read): ${skipped}`);
  console.log(`\nUNSTAMP COMPLETE. Next: parse-prereqs.ts dry run.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
