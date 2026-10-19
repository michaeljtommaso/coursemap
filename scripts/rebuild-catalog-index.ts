// scripts/rebuild-catalog-index.ts
// Regenerate the catalogIndex chunks from the current course docs, with no other
// change to the catalog. Spec 017 added two index fields (`roster`, `lead`) that
// only a rebuild fills in; before this script, the index was rebuilt only as a
// side effect of roster-sync / parse-prereqs / hotfix-prereqs.
//
// Uses the shared builder in ./catalog-index (buildIndexRecords +
// regenerateCatalogIndex), so the chunks it writes are byte-for-byte what those
// scripts would write.
//
// DRY RUN by default: reads everything, builds the records and reports, writes
// nothing. --apply writes the chunks (and deletes stale trailing ones).
//
// Cost on the live project (shared daily read quota — budget it):
//   reads   ≈ 8,900 course docs + 1 catalog/meta + ~23 existing chunks
//           (+ ~23 more on --apply, when regenerateCatalogIndex lists the chunks
//           to reap stale ones)
//   writes  ≈ 23 chunk docs on --apply, 0 on a dry run
//
// Setup: cd scripts && npm install
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = the service-account key path, or
//        FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 to run against the emulator.
// Run:
//   npx tsx rebuild-catalog-index.ts            (DRY RUN — report only)
//   npx tsx rebuild-catalog-index.ts --apply    (write the rebuilt chunks)

import { initAdmin, PROJECT_ID } from "./admin-app";
import {
  buildIndexRecords,
  regenerateCatalogIndex,
  newUnlocksStats,
  CHUNK_SIZE,
} from "./catalog-index";

const APPLY = process.argv.includes("--apply");

const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  console.log(`\n── rebuild-catalog-index (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`);
  const db = initAdmin();

  const [coursesSnap, metaSnap, oldChunksSnap] = await Promise.all([
    db.collection("courses").get(),
    db.collection("catalog").doc("meta").get(),
    db.collection("catalogIndex").get(),
  ]);
  const enrollmentTarget = metaSnap.get("enrollmentTarget");
  const target = typeof enrollmentTarget === "string" && enrollmentTarget ? enrollmentTarget : null;

  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const unlocksStats = newUnlocksStats();
  const records = buildIndexRecords(courses, unlocksStats);

  const withRoster = records.filter((r) => r.roster != null).length;
  const onTarget = target ? records.filter((r) => r.roster === target).length : 0;
  const withLead = records.filter((r) => r.lead != null).length;
  const withMore = records.filter((r) => (r.lead?.more ?? 0) > 0).length;
  const chunkCount = Math.max(1, Math.ceil(records.length / CHUNK_SIZE));

  let oldBytes = 0;
  let oldRecords = 0;
  for (const d of oldChunksSnap.docs) {
    const recs = d.get("records");
    if (Array.isArray(recs)) {
      oldBytes += jsonBytes(recs);
      oldRecords += recs.length;
    }
  }
  let newBytes = 0;
  for (let i = 0; i < chunkCount; i++) newBytes += jsonBytes(records.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));

  console.log(`   course docs read:      ${coursesSnap.size}`);
  console.log(`   index records built:   ${records.length}`);
  console.log(`   with roster:           ${withRoster}`);
  console.log(
    `   roster = target:       ${target ? `${onTarget} (enrollmentTarget ${target})` : "— (catalog/meta.enrollmentTarget unset)"}`
  );
  console.log(`   with lead lecturer:    ${withLead} (${withMore} with +N others)`);
  console.log(`   unlocks cap overflow:  ${unlocksStats.overflowCount}`);
  console.log(`   chunks:                ${chunkCount} new · ${oldChunksSnap.size} existing (${oldRecords} records)`);
  const growth = oldBytes > 0 ? ` (${(((newBytes - oldBytes) / oldBytes) * 100).toFixed(1)}%)` : "";
  console.log(`   approx JSON size:      ${kb(oldBytes)} before → ${kb(newBytes)} after${growth}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to write the chunks.");
    return;
  }

  const { chunkCount: written, ops } = await regenerateCatalogIndex(db, records);
  console.log(`\n   regenerated catalogIndex: ${written} chunk(s), ${ops} write op(s).`);
  console.log("\nREBUILD COMPLETE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
