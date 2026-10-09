// scripts/hotfix-prereqs.ts
// Apply a small, hand-verified list of prerequisite corrections to live course
// docs, then regenerate catalogIndex (hasPrereqs dots + the unlocks index) the
// same way parse-prereqs.ts does.
//
// Every correction is compare-and-set: it is written ONLY if the live tree still
// equals the known-bad value recorded below. If the doc has drifted, it is
// skipped and reported — never overwritten blind. Prior values are backed up to
// scripts/out/ before any write.
//
// Provenance is left as-is ("authored"), which keeps parse-prereqs.ts from
// overwriting the fix until the authored-override model is reworked.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:   npx tsx hotfix-prereqs.ts            (DRY RUN — report only)
//        npx tsx hotfix-prereqs.ts --apply    (LIVE — write + regenerate index)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { treeEqual } from "./canonical-json";
import { buildIndexRecords, regenerateCatalogIndex, newUnlocksStats } from "./catalog-index";

const PROJECT_ID = "degree-planner-app";
const APPLY = process.argv.includes("--apply");

type Tree = unknown;
type Correction = { id: string; expectBad: Tree; fixed: Tree; why: string };

// Source: docs/audits/2026-10-09-prereq-accuracy-audit.md, fix F1.
const CORRECTIONS: Correction[] = [
  {
    id: "MATH-1910",
    expectBad: { type: "course", id: "MATH-1110" },
    fixed: null,
    why:
      "Cornell lists no course prerequisite (\"…at least one course in differential and integral " +
      "calculus (e.g., MATH 1110), or equivalent AP credit\"); the v1 parser read the e.g. as a requirement.",
  },
  {
    id: "CS-1112",
    expectBad: { type: "course", id: "MATH-1110" },
    fixed: { type: "advisory", expr: { type: "course", id: "MATH-1110" }, note: "or equivalent" },
    why: "Cornell: \"MATH 1110 or equivalent\" — advisory, never a hard block.",
  },
];

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key (never echo it).");
    process.exit(1);
  }
  console.log(`\n── hotfix-prereqs (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`);
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const refs = CORRECTIONS.map((c) => db.collection("courses").doc(c.id));
  const snaps = await db.getAll(...refs);
  const backup: Record<string, unknown> = {};
  const toWrite: Correction[] = [];

  for (const [i, c] of CORRECTIONS.entries()) {
    const snap = snaps[i];
    if (!snap.exists) {
      console.log(`   ✗ ${c.id}: no course doc — skipped`);
      continue;
    }
    const data = snap.data() ?? {};
    backup[c.id] = { prereqExpr: data.prereqExpr ?? null, prereqSource: data.prereqSource ?? null };
    if (treeEqual(data.prereqExpr ?? null, c.fixed)) {
      console.log(`   = ${c.id}: already fixed`);
    } else if (treeEqual(data.prereqExpr ?? null, c.expectBad)) {
      console.log(`   → ${c.id}: ${JSON.stringify(c.expectBad)}  ⇒  ${JSON.stringify(c.fixed)}`);
      console.log(`     ${c.why}`);
      toWrite.push(c);
    } else {
      console.log(`   ! ${c.id}: live value drifted (${JSON.stringify(data.prereqExpr)}) — skipped, re-audit`);
    }
  }

  if (!APPLY || toWrite.length === 0) {
    console.log(APPLY ? "\nNothing to write." : `\nDRY RUN — nothing written. ${toWrite.length} correction(s) pending; re-run with --apply.`);
    return;
  }

  const outDir = join(process.cwd(), "out");
  mkdirSync(outDir, { recursive: true });
  const backupPath = join(outDir, `hotfix-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\n   backup → ${backupPath}`);

  // update() replaces the field wholesale (no merge residue inside the tree).
  const batch = db.batch();
  for (const c of toWrite) {
    batch.update(db.collection("courses").doc(c.id), {
      prereqExpr: c.fixed,
      prereqHotfix: { date: new Date().toISOString().slice(0, 10), ref: "prereq-accuracy-audit F1" },
    });
  }
  await batch.commit();
  console.log(`   wrote ${toWrite.length} course doc(s).`);

  const allSnap = await db.collection("courses").get();
  const allCourses = allSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const records = buildIndexRecords(allCourses, newUnlocksStats());
  const { chunkCount, ops } = await regenerateCatalogIndex(db, records);
  console.log(`   regenerated catalogIndex: ${chunkCount} chunk(s), ${ops} op(s).`);

  const verify = await db.getAll(...toWrite.map((c) => db.collection("courses").doc(c.id)));
  for (const [i, c] of toWrite.entries()) {
    const ok = treeEqual(verify[i].data()?.prereqExpr ?? null, c.fixed);
    console.log(`   ${ok ? "✓" : "✗"} verify ${c.id}`);
  }
  const unlocksOf1110 = records.find((r) => r.id === "MATH-1110")?.unlocks ?? [];
  console.log(`   MATH-1110 unlocks MATH-1910 in index: ${unlocksOf1110.includes("MATH-1910")}`);
  console.log("\nHOTFIX COMPLETE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
