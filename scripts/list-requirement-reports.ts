// scripts/list-requirement-reports.ts
// Lists "this looks wrong" requirement reports (spec 019 D15), newest first,
// for review by hand. READ-ONLY: nothing is written or deleted.
//
// COST: each run reads one document per report listed (up to --limit; an empty
// result still costs one read), against the free plan's daily Firestore read
// quota. Keep --limit modest.
//
// Run (from scripts/):
//   npx tsx list-requirement-reports.ts              (newest 50)
//   npx tsx list-requirement-reports.ts --limit 10
// Backend: GOOGLE_APPLICATION_CREDENTIALS (live) or FIRESTORE_EMULATOR_HOST.

import type { Timestamp } from "firebase-admin/firestore";
import { initAdmin } from "./admin-app";

const DEFAULT_LIMIT = 50;

function fail(msg: string): never {
  console.error(`\nLIST-REQUIREMENT-REPORTS ABORTED: ${msg}`);
  process.exit(1);
}

function parseLimit(argv: string[]): number {
  const i = argv.indexOf("--limit");
  if (i === -1) return DEFAULT_LIMIT;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) fail(`--limit needs a positive whole number (got "${argv[i + 1] ?? ""}").`);
  return n;
}

/** Enough of a uid to group reports by sender without printing it whole. */
function shortUid(uid: unknown): string {
  return typeof uid === "string" && uid.length > 8 ? `${uid.slice(0, 6)}…` : String(uid ?? "?");
}

function when(createdAt: unknown): string {
  const ts = createdAt as Timestamp | undefined;
  return typeof ts?.toDate === "function" ? ts.toDate().toISOString() : "(no time)";
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  console.log(`\n── list-requirement-reports (newest ${limit}) ──`);
  const db = initAdmin();
  const snap = await db
    .collection("requirementReports")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  if (snap.empty) {
    console.log("   no reports.");
    return;
  }
  for (const d of snap.docs) {
    const r = d.data();
    console.log(
      `\n${when(r.createdAt)}  ${r.programId}  ${r.layer} / ${r.rowId}  (from ${shortUid(r.uid)})`
    );
    if (typeof r.note === "string" && r.note) console.log(`   "${r.note}"`);
  }
  console.log(`\n   ${snap.size} report(s) listed (${snap.size} read(s)).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
