// scripts/parse-prereqs.ts
// Deterministic prereqText → PrereqExpr pipeline over the Firestore course
// catalog. Reads courses/{id}.prereqText / .coreqText (backfilled by
// roster-sync), parses them with prereq-grammar.ts, reports coverage, and
// (with --apply) writes prereqExpr/coreqExpr ONLY where the existing value is
// null AND the parse class is clean or partial — never overwriting the ~50
// hand-authored canonical trees.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx parse-prereqs.ts                 (DRY RUN — read + stats + samples)
//   npx tsx parse-prereqs.ts --apply         (LIVE — write null-only, regen index)
//
// Idempotency / safety:
//   • --apply writes prereqExpr/coreqExpr only where the field is currently null.
//   • Re-running --apply is a no-op for already-stamped courses.
//   • prereqSource: "parsed-v1" is stamped on every course we write.
//   • prereqText is kept (never deleted).
//   • After writes, catalogIndex chunks are regenerated so hasPrereqs dots reflect
//     the new trees (shared logic in catalog-index.ts).

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { parsePrereqs, type ParseClass, type ParseResult } from "./prereq-grammar";
import { buildIndexRecords, regenerateCatalogIndex } from "./catalog-index";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "degree-planner-app";
const PARSE_SOURCE = "parsed-v1";

function fail(msg: string): never {
  console.error(`\nPARSE-PREREQS ABORTED: ${msg}`);
  process.exit(1);
}

type CourseDoc = {
  id: string;
  prereqText?: string | null;
  coreqText?: string | null;
  prereqExpr?: unknown;
  coreqExpr?: unknown;
  prereqSource?: string | null;
  [k: string]: unknown;
};

type Row = {
  id: string;
  doc: CourseDoc;
  result: ParseResult;
  // what --apply would actually write (respects null-only rule)
  willWritePrereq: boolean;
  willWriteCoreq: boolean;
};

function classifyAll(docs: CourseDoc[]): Row[] {
  const rows: Row[] = [];
  for (const doc of docs) {
    const prereqText = typeof doc.prereqText === "string" ? doc.prereqText : null;
    const coreqText = typeof doc.coreqText === "string" ? doc.coreqText : null;
    const result = parsePrereqs(prereqText, coreqText);

    const writable = result.cls === "clean" || result.cls === "partial";
    const prereqIsNull = doc.prereqExpr == null;
    const coreqIsNull = doc.coreqExpr == null;

    rows.push({
      id: doc.id,
      doc,
      result,
      willWritePrereq: writable && prereqIsNull && result.prereqExpr != null,
      willWriteCoreq: writable && coreqIsNull && result.coreqExpr != null,
    });
  }
  return rows;
}

// Deterministic "random" sampler: order by a cheap hash of the id, then stride.
function pickSamples(rows: Row[], k = 20): Row[] {
  const hash = (s: string) => s.split("").reduce((x, ch) => x + ch.charCodeAt(0), 0);
  const arr = [...rows].sort((a, b) => hash(a.id) - hash(b.id));
  const step = Math.max(1, Math.floor(arr.length / k));
  const out: Row[] = [];
  for (let i = 0; i < arr.length && out.length < k; i += step) out.push(arr[i]);
  return out;
}

function reportStats(rows: Row[]) {
  const withText = rows.filter(
    (r) => r.result.cls !== "empty"
  );
  const total = withText.length;
  const count = (c: ParseClass) => withText.filter((r) => r.result.cls === c).length;
  const pct = (c: ParseClass) => (total ? ((count(c) / total) * 100).toFixed(1) : "0.0");

  const existingPrereqTrees = rows.filter((r) => r.doc.prereqExpr != null).length;
  const existingCoreqTrees = rows.filter((r) => r.doc.coreqExpr != null).length;
  const wouldWritePrereq = rows.filter((r) => r.willWritePrereq).length;
  const wouldWriteCoreq = rows.filter((r) => r.willWriteCoreq).length;
  const wouldWriteAny = rows.filter((r) => r.willWritePrereq || r.willWriteCoreq).length;

  console.log(`\n── PARSE COVERAGE ──`);
  console.log(`   total course docs:            ${rows.length}`);
  console.log(`   docs with prereq/coreq text:  ${total}`);
  console.log(`   clean:   ${count("clean")}  (${pct("clean")}%)`);
  console.log(`   partial: ${count("partial")}  (${pct("partial")}%)`);
  console.log(`   failed:  ${count("failed")}  (${pct("failed")}%)`);
  const good = count("clean") + count("partial");
  console.log(`   clean+partial rate: ${total ? ((good / total) * 100).toFixed(1) : "0.0"}%`);

  console.log(`\n── EXISTING TREES (never overwritten) ──`);
  console.log(`   courses with prereqExpr already set: ${existingPrereqTrees}`);
  console.log(`   courses with coreqExpr already set:  ${existingCoreqTrees}`);

  console.log(`\n── WOULD WRITE (null-only, clean|partial) ──`);
  console.log(`   new prereqExpr writes: ${wouldWritePrereq}`);
  console.log(`   new coreqExpr writes:  ${wouldWriteCoreq}`);
  console.log(`   courses touched:       ${wouldWriteAny}  (+ prereqSource stamp)`);

  return { total, good, wouldWriteAny, existingPrereqTrees };
}

function printSamples(rows: Row[]) {
  for (const cls of ["clean", "partial", "failed"] as ParseClass[]) {
    const inClass = rows.filter((r) => r.result.cls === cls);
    console.log(`\n── ${cls.toUpperCase()} — ${Math.min(20, inClass.length)} random samples ──`);
    for (const r of pickSamples(inClass, 20)) {
      console.log(`\n  ${r.id}${r.willWritePrereq || r.willWriteCoreq ? "  [would write]" : ""}`);
      if (r.doc.prereqText) console.log(`    prereqText: ${r.doc.prereqText}`);
      if (r.doc.coreqText) console.log(`    coreqText:  ${r.doc.coreqText}`);
      console.log(`    → ${JSON.stringify({ prereqExpr: r.result.prereqExpr, coreqExpr: r.result.coreqExpr })}`);
      if (r.result.notes.length) console.log(`    notes: ${r.result.notes.join("; ")}`);
    }
  }
}

async function applyWrites(db: Firestore, rows: Row[]): Promise<number> {
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

  for (const r of rows) {
    if (!r.willWritePrereq && !r.willWriteCoreq) continue;
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Stamp provenance ONLY on the field we actually wrote, so a course whose
    // prereqExpr is hand-authored but whose coreqExpr we parsed doesn't get a
    // misleading prereqSource. prereqSource stays the primary/back-compatible
    // stamp for prereq writes; coreqSource marks parsed coreqs.
    if (r.willWritePrereq) {
      update.prereqExpr = r.result.prereqExpr;
      update.prereqSource = PARSE_SOURCE;
    }
    if (r.willWriteCoreq) {
      update.coreqExpr = r.result.coreqExpr;
      update.coreqSource = PARSE_SOURCE;
    }
    batch.set(db.collection("courses").doc(r.id), update, { merge: true });
    ops++;
    await flush();
  }
  await flush(true);
  return writeCount;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account " +
        "key (never commit or echo that file)."
    );
  }

  console.log(`\n── parse-prereqs (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`);

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const snap = await db.collection("courses").get();
  const docs: CourseDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  console.log(`   read ${docs.length} course docs.`);

  const rows = classifyAll(docs);
  const stats = reportStats(rows);
  printSamples(rows);

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to write ${stats.wouldWriteAny} ` +
        `course(s) and regenerate catalogIndex.`
    );
    return;
  }

  // Sanity gate: refuse to apply if the clean+partial rate collapsed (data shape
  // change) — protects the catalog from a broken parser run.
  const rate = stats.total ? stats.good / stats.total : 0;
  if (rate < 0.5) {
    fail(
      `clean+partial rate is ${(rate * 100).toFixed(1)}% (< 50%). Refusing to apply — ` +
        `the prereq text shape may have changed. Nothing written.`
    );
  }

  console.log(`\n── APPLYING (null-only, clean|partial) ──`);
  const courseWrites = await applyWrites(db, rows);
  console.log(`   wrote ${courseWrites} course update(s).`);

  // Regenerate catalogIndex so hasPrereqs dots reflect the new trees.
  const allSnap = await db.collection("courses").get();
  const allCourses = allSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const records = buildIndexRecords(allCourses);
  const { chunkCount, ops: indexOps } = await regenerateCatalogIndex(db, records);
  const withPrereqs = records.filter((r) => r.hasPrereqs).length;
  console.log(
    `   regenerated catalogIndex: ${chunkCount} chunk(s); hasPrereqs=true on ${withPrereqs} records.`
  );

  console.log(`\n── SUMMARY ──`);
  console.log(`   course writes:        ${courseWrites}`);
  console.log(`   catalogIndex ops:     ${indexOps}`);
  console.log(`   total document writes: ${courseWrites + indexOps}`);
  console.log(`   courses now showing a prereq dot: ${withPrereqs}`);
  console.log(`\nPARSE-PREREQS COMPLETE.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
