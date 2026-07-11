// scripts/stamp-authored-prereqs.ts
// Stamps prereqSource: "authored" / coreqSource: "authored" on every course doc
// whose id appears in the hand-authored seed (scripts/seed-data/courses.json).
// This marks those rows permanently off-limits to parse-prereqs.ts's write gate
// (spec 007 §3 decision 4) — the parser must never touch hand-authored trees,
// including a deliberate `null` ("this course has no prereqs", e.g. MATH 1910).
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx stamp-authored-prereqs.ts          (DRY RUN — read + report only)
//   npx tsx stamp-authored-prereqs.ts --apply  (LIVE — stamp provenance)
//
// Touches ONLY prereqSource/coreqSource on the matched docs — never prereqExpr,
// coreqExpr, or any other field.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "degree-planner-app";
const AUTHORED = "authored";
const SEED_PATH = join(__dirname, "seed-data", "courses.json");

function fail(msg: string): never {
  console.error(`\nSTAMP-AUTHORED-PREREQS ABORTED: ${msg}`);
  process.exit(1);
}

function loadAuthoredIds(): string[] {
  const raw = readFileSync(SEED_PATH, "utf8");
  const parsed = JSON.parse(raw) as Array<{ id?: unknown }>;
  const ids = parsed
    .map((c) => c.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account " +
        "key (never commit or echo that file)."
    );
  }

  const ids = loadAuthoredIds();
  console.log(`\n── stamp-authored-prereqs (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`);
  console.log(`   authored course ids in seed-data/courses.json: ${ids.length}`);

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  // Read once: fetch exactly the matched docs (getAll, not a full collection
  // scan) so we can report what would change without touching anything else.
  const refs = ids.map((id) => db.collection("courses").doc(id));
  const snaps = refs.length ? await db.getAll(...refs) : [];

  const existing = snaps.filter((s) => s.exists);
  const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
  const alreadyStamped = existing.filter(
    (s) => s.get("prereqSource") === AUTHORED && s.get("coreqSource") === AUTHORED
  );
  const toStamp = existing.filter(
    (s) => !(s.get("prereqSource") === AUTHORED && s.get("coreqSource") === AUTHORED)
  );

  console.log(`   matched Firestore docs:        ${existing.length}`);
  console.log(
    `   missing from Firestore:        ${missing.length}` +
      (missing.length
        ? `  (${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""})`
        : "")
  );
  console.log(`   already stamped authored:      ${alreadyStamped.length}`);
  console.log(`   would stamp:                   ${toStamp.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to stamp ${toStamp.length} course doc(s).`);
    return;
  }

  let writeCount = 0;
  let batch = db.batch();
  let ops = 0;
  const flush = async (force = false) => {
    if ((force && ops > 0) || ops >= 400) {
      await batch.commit();
      writeCount += ops;
      batch = db.batch();
      ops = 0;
    }
  };

  for (const s of toStamp) {
    // Touch ONLY prereqSource/coreqSource — no other field, not even
    // updatedAt, per this script's one job.
    batch.set(s.ref, { prereqSource: AUTHORED, coreqSource: AUTHORED }, { merge: true });
    ops++;
    await flush();
  }
  await flush(true);

  console.log(`\n── APPLIED ──`);
  console.log(`   stamped ${writeCount} course doc(s): prereqSource/coreqSource = "authored".`);
  console.log(`\nSTAMP-AUTHORED-PREREQS COMPLETE.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
