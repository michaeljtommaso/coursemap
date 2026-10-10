// scripts/parse-prereqs.ts
// Deterministic prereqText → PrereqExpr pipeline over the Firestore course
// catalog. Reads courses/{id}.prereqText / .coreqText (backfilled by
// roster-sync), parses them with prereq-grammar.ts, reports coverage, and
// (with --apply) writes prereqExpr/coreqExpr/prereqNotes gated by PROVENANCE,
// not nullness (spec 007 §3 decision 3/4).
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx parse-prereqs.ts                 (DRY RUN — read + stats + diff + samples)
//   npx tsx parse-prereqs.ts --apply         (LIVE — write clean|annotated, regen index)
//   --fallback SP26   roster consulted before clearing a tree whose prose went
//                     blank (default SP26); --refresh re-fetches it instead of
//                     using scripts/out/roster-cache/.
//
// Prose errata: seed-data/prereq-errata.json is applied to each course's prose
// before parsing (prereq-errata.ts). Entries whose `find` no longer matches are
// listed in the report so they can be re-checked or deleted.
//
// Blank prose: when a course's synced prose is blank but it still carries a
// parser-owned tree, the tree is cleared only if the fallback roster agrees —
// the course is absent there, its prose is blank there too, or that prose
// parses to no tree. Otherwise the tree is kept and reported as a conflict.
//
// Write gate (spec 007 §3 decision 3/4 — the inversion this unit implements):
//   • Writable parse classes: "clean" | "annotated" ONLY. "partial" and
//     "failed" rows are never written — they're quarantined to
//     scripts/out/prereq-quarantine.json instead (in BOTH dry-run and apply
//     modes), for hand review/promotion.
//   • A field (prereqExpr/prereqSource or coreqExpr/coreqSource) may be
//     written iff its *own* provenance is null/undefined OR starts with
//     "parsed" — i.e. never when prereqSource/coreqSource === "authored".
//     An "authored" stamp is honoured if present, but nothing stamps it any
//     more: corrections to Cornell's prose live in seed-data/prereq-errata.json
//     and still flow through the parser.
//   • Tree fields are written with update(), which replaces each field whole,
//     so keys from an older tree shape can't survive inside a rewritten one.
//   • Overwrite semantics: an existing "parsed-v1"/"parsed-v2" row MAY be
//     UPDATED when the freshly-parsed tree differs from what's stored — this
//     is the repair path (a rerunnable pipeline that fixes its own past
//     mistakes, e.g. MATH 1910's false MATH-1110 edge). Every write is
//     stamped prereqSource/coreqSource: "parsed-v2".
//   • prereqNotes (string[]) is written whenever the fresh parse's notes
//     differ from the stored ones and the row is writable, whether or not
//     prereqExpr itself is null. A re-parse yielding ZERO notes deletes a
//     stale prereqNotes field (FieldValue.delete()) rather than leaving old
//     prose behind — absent-field is the canonical "no notes" state.
//   • Sanity gate: refuse to --apply if the clean+annotated rate collapses
//     (data-shape change protection), same idea as before, recomputed against
//     the new class set.
//
// Idempotency:
//   • Re-running --apply is a no-op for rows where nothing changed (the tree
//     and notes are already exactly what a fresh parse would produce).
//   • prereqText/coreqText are kept (never deleted).
//   • After writes, catalogIndex chunks are regenerated so hasPrereqs dots
//     reflect the new trees (shared logic in catalog-index.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { parsePrereqs, type ParseClass, type ParseResult } from "./prereq-grammar";
import { treeEqual } from "./canonical-json";
import { buildIndexRecords, regenerateCatalogIndex, newUnlocksStats } from "./catalog-index";
import { applyErrata, loadErrata, type Erratum } from "./prereq-errata";
import { createRosterReader } from "./roster-prose";

const APPLY = process.argv.includes("--apply");
const REFRESH = process.argv.includes("--refresh");
function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const FALLBACK_ROSTER = argValue("--fallback", "SP26");
const PROJECT_ID = "degree-planner-app";
// Stamped on every field this script writes (both fresh writes and repairs).
const WRITE_SOURCE = "parsed-v2";
const OUT_DIR = join(__dirname, "out");
const QUARANTINE_PATH = join(OUT_DIR, "prereq-quarantine.json");

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
  prereqNotes?: unknown;
  prereqSource?: string | null;
  coreqSource?: string | null;
  [k: string]: unknown;
};

type Row = {
  id: string;
  doc: CourseDoc;
  result: ParseResult;
  // "clean" | "annotated" — the only classes ever eligible to write anything.
  rowWritable: boolean;
  prereqSourceOk: boolean;
  coreqSourceOk: boolean;
  prereqChanged: boolean;
  coreqChanged: boolean;
  notesChanged: boolean;
  // what --apply would actually write (respects the provenance + writable gate)
  willWritePrereq: boolean;
  willWriteCoreq: boolean;
  willWriteNotes: boolean;
  // course ids present in the OLD tree that are absent from the NEW tree —
  // i.e. the falsely-hard edges being repaired.
  prereqRemovedIds: string[];
  coreqRemovedIds: string[];
  // Errata applied to this course's prose before parsing.
  errataApplied: Erratum[];
  // Blank-prose clear (see header): why the stored tree is being cleared, and
  // the notes to keep (from the fallback roster's prose), or null.
  clearReason: string | null;
  clearNotes: string[] | null;
};

// A field's provenance permits a parser write iff it's null/undefined
// ("never parsed") or starts with "parsed" (our own prior output) — never
// "authored" (spec 007 §3 decision 4).
function allowsWrite(source: unknown): boolean {
  if (source == null) return true;
  return typeof source === "string" && source.startsWith("parsed");
}

// Tree comparison is treeEqual (canonical-json.ts) — key-order-insensitive,
// because Firestore reads don't guarantee the write-time key order and a raw
// JSON.stringify comparison would flag every parsed row as "changed" forever.

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Walk a PrereqExpr (or raw Firestore JSON shaped like one) and collect every
// course/concurrent id, descending through advisory wraps.
function collectCourseIds(expr: unknown, out: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  const e = expr as Record<string, unknown>;
  if ((e.type === "course" || e.type === "concurrent") && typeof e.id === "string") {
    out.add(e.id);
    return;
  }
  if (e.type === "advisory") {
    collectCourseIds(e.expr, out);
    return;
  }
  if (Array.isArray(e.children)) {
    for (const c of e.children) collectCourseIds(c, out);
  }
}

// Course ids present in `oldExpr` that vanished in `newExpr` — the falsely-hard
// edges a repair removes (e.g. MATH 1910's phantom MATH-1110 requirement).
function removedCourseIds(oldExpr: unknown, newExpr: unknown): string[] {
  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  collectCourseIds(oldExpr, oldIds);
  collectCourseIds(newExpr, newIds);
  return [...oldIds].filter((id) => !newIds.has(id));
}

function classifyAll(docs: CourseDoc[], errata: Erratum[]): Row[] {
  return docs.map((doc) => {
    const corrected = applyErrata(
      doc.id,
      typeof doc.prereqText === "string" ? doc.prereqText : null,
      typeof doc.coreqText === "string" ? doc.coreqText : null,
      errata
    );
    const result = parsePrereqs(corrected.prereqText, corrected.coreqText);

    const rowWritable = result.cls === "clean" || result.cls === "annotated";
    const prereqSourceOk = allowsWrite(doc.prereqSource);
    const coreqSourceOk = allowsWrite(doc.coreqSource);
    const prereqChanged = !treeEqual(doc.prereqExpr, result.prereqExpr);
    const coreqChanged = !treeEqual(doc.coreqExpr, result.coreqExpr);
    const notesChanged = !arraysEqual(asStringArray(doc.prereqNotes), result.prereqNotes);

    const willWritePrereq = rowWritable && prereqSourceOk && prereqChanged;
    const willWriteCoreq = rowWritable && coreqSourceOk && coreqChanged;
    // prereqNotes is a single doc field alongside prereqExpr — gated on the
    // same (prereq-side) provenance, per prereqSource being the primary stamp.
    // Fires on ANY difference, including notes → no notes: a re-parse that
    // yields zero notes must CLEAR a previously-written prereqNotes array
    // (applyWrites deletes the field), not leave stale prose behind.
    const willWriteNotes = rowWritable && prereqSourceOk && notesChanged;

    return {
      id: doc.id,
      doc,
      result,
      rowWritable,
      prereqSourceOk,
      coreqSourceOk,
      prereqChanged,
      coreqChanged,
      notesChanged,
      willWritePrereq,
      willWriteCoreq,
      willWriteNotes,
      prereqRemovedIds: willWritePrereq ? removedCourseIds(doc.prereqExpr, result.prereqExpr) : [],
      coreqRemovedIds: willWriteCoreq ? removedCourseIds(doc.coreqExpr, result.coreqExpr) : [],
      errataApplied: corrected.applied,
      clearReason: null,
      clearNotes: null,
    };
  });
}

// Errata that matched nothing: the course has no doc, or its prose no longer
// contains `find` (Cornell fixed or rewrote it). Reported for re-checking.
function unmatchedErrata(rows: Row[], errata: Erratum[]): { entry: Erratum; why: string }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return errata
    .filter((e) => !byId.get(e.courseId)?.errataApplied.includes(e))
    .map((e) => ({ entry: e, why: byId.has(e.courseId) ? "find text no longer in the prose" : "no course doc" }));
}

// Blank-prose clears (see header). A row qualifies when its synced prose is
// blank, it still carries a tree, and that tree is parser-owned. The fallback
// roster must agree before anything is cleared.
async function resolveBlankProseClears(
  rows: Row[],
  errata: Erratum[]
): Promise<{ cleared: Row[]; kept: { row: Row; why: string }[] }> {
  const candidates = rows.filter(
    (r) =>
      r.result.cls === "empty" &&
      (r.doc.prereqExpr != null || r.doc.coreqExpr != null) &&
      r.prereqSourceOk &&
      r.coreqSourceOk
  );
  const cleared: Row[] = [];
  const kept: { row: Row; why: string }[] = [];
  if (candidates.length === 0) return { cleared, kept };

  const reader = createRosterReader({ refresh: REFRESH });
  const fallback = await reader.proseFor(
    candidates.map((r) => r.id),
    [FALLBACK_ROSTER]
  );
  for (const r of candidates) {
    const fb = fallback.get(r.id) ?? null;
    let reason: string | null = null;
    let notes: string[] = [];
    if (!fb) {
      reason = `blank prose; not listed in ${FALLBACK_ROSTER}`;
    } else if (!fb.prereq && !fb.coreq) {
      reason = `blank prose; blank in ${FALLBACK_ROSTER} too`;
    } else {
      const corrected = applyErrata(r.id, fb.prereq, fb.coreq, errata);
      const parsed = parsePrereqs(corrected.prereqText, corrected.coreqText);
      if (parsed.prereqExpr == null && parsed.coreqExpr == null) {
        reason = `blank prose; ${FALLBACK_ROSTER} prose names no course`;
        notes = parsed.prereqNotes;
      } else {
        kept.push({ row: r, why: `${FALLBACK_ROSTER} prose still names courses: ${fb.prereq ?? ""} ${fb.coreq ?? ""}`.trim() });
        continue;
      }
    }
    r.clearReason = reason;
    r.clearNotes = notes;
    r.willWritePrereq = r.doc.prereqExpr != null;
    r.willWriteCoreq = r.doc.coreqExpr != null;
    r.willWriteNotes = !arraysEqual(asStringArray(r.doc.prereqNotes), notes);
    r.prereqRemovedIds = removedCourseIds(r.doc.prereqExpr, null);
    r.coreqRemovedIds = removedCourseIds(r.doc.coreqExpr, null);
    cleared.push(r);
  }
  return { cleared, kept };
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
  const withText = rows.filter((r) => r.result.cls !== "empty");
  const total = withText.length;
  const count = (c: ParseClass) => withText.filter((r) => r.result.cls === c).length;
  const pct = (c: ParseClass) => (total ? ((count(c) / total) * 100).toFixed(1) : "0.0");

  console.log(`\n── PARSE COVERAGE ──`);
  console.log(`   total course docs:            ${rows.length}`);
  console.log(`   docs with prereq/coreq text:  ${total}`);
  console.log(`   clean:     ${count("clean")}  (${pct("clean")}%)`);
  console.log(`   annotated: ${count("annotated")}  (${pct("annotated")}%)`);
  console.log(`   partial:   ${count("partial")}  (${pct("partial")}%)  [quarantined, never written]`);
  console.log(`   failed:    ${count("failed")}  (${pct("failed")}%)  [quarantined, never written]`);
  const good = count("clean") + count("annotated");
  console.log(`   clean+annotated rate: ${total ? ((good / total) * 100).toFixed(1) : "0.0"}%`);

  const wouldWritePrereq = rows.filter((r) => r.willWritePrereq).length;
  const wouldWriteCoreq = rows.filter((r) => r.willWriteCoreq).length;
  const wouldWriteNotes = rows.filter((r) => r.willWriteNotes).length;
  const wouldWriteAny = rows.filter(
    (r) => r.willWritePrereq || r.willWriteCoreq || r.willWriteNotes
  ).length;
  // Note: computed after resolveBlankProseClears, so clears are included.
  const blockedByAuthored = rows.filter(
    (r) =>
      r.rowWritable &&
      ((!r.prereqSourceOk && r.prereqChanged) || (!r.coreqSourceOk && r.coreqChanged))
  ).length;

  console.log(`\n── WOULD WRITE (provenance-gated: null/undefined/"parsed-*", never "authored") ──`);
  console.log(`   prereqExpr writes:  ${wouldWritePrereq}`);
  console.log(`   coreqExpr writes:   ${wouldWriteCoreq}`);
  console.log(`   prereqNotes writes: ${wouldWriteNotes}`);
  console.log(`   courses touched:    ${wouldWriteAny}  (+ prereqSource/coreqSource stamp: "${WRITE_SOURCE}")`);
  console.log(`   rows skipped — authored provenance would've differed: ${blockedByAuthored}`);

  return { total, good, wouldWriteAny };
}

// Diff report (spec 007 §3a) — the damage report: every falsely-hard edge the
// old parser invented, every advisory that used to be a false hard block.
function reportDiff(rows: Row[]) {
  const prereqNew = rows.filter((r) => r.willWritePrereq && r.doc.prereqExpr == null);
  const prereqChangedTrees = rows.filter((r) => r.willWritePrereq && r.doc.prereqExpr != null);
  const prereqRemoved = prereqChangedTrees.filter((r) => r.prereqRemovedIds.length > 0);

  const coreqNew = rows.filter((r) => r.willWriteCoreq && r.doc.coreqExpr == null);
  const coreqChangedTrees = rows.filter((r) => r.willWriteCoreq && r.doc.coreqExpr != null);
  const coreqRemoved = coreqChangedTrees.filter((r) => r.coreqRemovedIds.length > 0);

  console.log(`\n── DIFF REPORT (prereqExpr) ──`);
  console.log(`   new writes (was null):                 ${prereqNew.length}`);
  console.log(`   changed trees (was set, now differs):  ${prereqChangedTrees.length}`);
  console.log(`   of which removed a course node:        ${prereqRemoved.length}`);

  console.log(`\n── DIFF REPORT (coreqExpr) ──`);
  console.log(`   new writes (was null):                 ${coreqNew.length}`);
  console.log(`   changed trees (was set, now differs):  ${coreqChangedTrees.length}`);
  console.log(`   of which removed a course node:        ${coreqRemoved.length}`);

  const byId = new Map<string, Row>();
  for (const r of [...prereqChangedTrees, ...coreqChangedTrees]) byId.set(r.id, r);
  const samples = [...byId.values()].slice(0, 20);

  console.log(`\n── SAMPLE CHANGED ROWS — ${samples.length} of ${byId.size} ──`);
  for (const r of samples) {
    console.log(`\n  ${r.id}`);
    if (r.willWritePrereq && r.doc.prereqExpr != null) {
      console.log(`    old prereqExpr: ${JSON.stringify(r.doc.prereqExpr)}`);
      console.log(`    new prereqExpr: ${JSON.stringify(r.result.prereqExpr)}`);
      if (r.prereqRemovedIds.length) {
        console.log(`    REMOVED-COURSE-NODE: ${r.prereqRemovedIds.join(", ")}`);
      }
    }
    if (r.willWriteCoreq && r.doc.coreqExpr != null) {
      console.log(`    old coreqExpr: ${JSON.stringify(r.doc.coreqExpr)}`);
      console.log(`    new coreqExpr: ${JSON.stringify(r.result.coreqExpr)}`);
      if (r.coreqRemovedIds.length) {
        console.log(`    REMOVED-COURSE-NODE: ${r.coreqRemovedIds.join(", ")}`);
      }
    }
  }

  return {
    prereqNew: prereqNew.length,
    prereqChanged: prereqChangedTrees.length,
    prereqRemoved: prereqRemoved.length,
    coreqNew: coreqNew.length,
    coreqChanged: coreqChangedTrees.length,
    coreqRemoved: coreqRemoved.length,
  };
}

function printSamples(rows: Row[]) {
  for (const cls of ["clean", "annotated", "partial", "failed"] as ParseClass[]) {
    const inClass = rows.filter((r) => r.result.cls === cls);
    console.log(`\n── ${cls.toUpperCase()} — ${Math.min(20, inClass.length)} random samples ──`);
    for (const r of pickSamples(inClass, 20)) {
      const willWrite = r.willWritePrereq || r.willWriteCoreq || r.willWriteNotes;
      console.log(`\n  ${r.id}${willWrite ? "  [would write]" : ""}`);
      if (r.doc.prereqText) console.log(`    prereqText: ${r.doc.prereqText}`);
      if (r.doc.coreqText) console.log(`    coreqText:  ${r.doc.coreqText}`);
      console.log(`    → ${JSON.stringify({ prereqExpr: r.result.prereqExpr, coreqExpr: r.result.coreqExpr })}`);
      if (r.result.notes.length) console.log(`    notes: ${r.result.notes.join("; ")}`);
      if (r.result.prereqNotes.length) console.log(`    prereqNotes: ${r.result.prereqNotes.join("; ")}`);
    }
  }
}

// Quarantine (spec 007 §3 decision 3) — "partial" and "failed" rows are NEVER
// written; they're dumped here for hand review/promotion, in BOTH dry-run and
// apply modes.
function writeQuarantine(rows: Row[]): number {
  const quarantined = rows.filter((r) => r.result.cls === "partial" || r.result.cls === "failed");
  const entries = quarantined.map((r) => ({
    courseId: r.id,
    prereqText: typeof r.doc.prereqText === "string" ? r.doc.prereqText : null,
    coreqText: typeof r.doc.coreqText === "string" ? r.doc.coreqText : null,
    candidatePrereqExpr: r.result.prereqExpr,
    candidateCoreqExpr: r.result.coreqExpr,
    notes: r.result.notes,
    prereqNotes: r.result.prereqNotes,
    cls: r.result.cls,
  }));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(QUARANTINE_PATH, JSON.stringify(entries, null, 2) + "\n", "utf8");
  return entries.length;
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
    if (!r.willWritePrereq && !r.willWriteCoreq && !r.willWriteNotes) continue;
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Stamp provenance ONLY on the field we actually wrote, so a course whose
    // prereqExpr is hand-authored but whose coreqExpr we parsed doesn't get a
    // misleading prereqSource.
    if (r.willWritePrereq) {
      update.prereqExpr = r.result.prereqExpr;
      update.prereqSource = WRITE_SOURCE;
    }
    if (r.willWriteCoreq) {
      update.coreqExpr = r.result.coreqExpr;
      update.coreqSource = WRITE_SOURCE;
    }
    if (r.willWriteNotes) {
      // Empty result → delete the field entirely: absent-field is the natural
      // "no notes" state (CourseSchema treats prereqNotes as optional), and a
      // repair must not leave stale prose from an earlier parse behind.
      const notes = r.clearNotes ?? r.result.prereqNotes;
      update.prereqNotes = notes.length > 0 ? notes : FieldValue.delete();
    }
    // update() replaces each named field whole (no deep merge), so a rewritten
    // tree can't keep keys from the shape it replaced.
    batch.update(db.collection("courses").doc(r.id), update);
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

  const errata = loadErrata();
  const rows = classifyAll(docs, errata);
  const clears = await resolveBlankProseClears(rows, errata);
  const stats = reportStats(rows);

  console.log(`\n── PROSE ERRATA (seed-data/prereq-errata.json) ──`);
  console.log(`   applied: ${rows.filter((r) => r.errataApplied.length > 0).length} course(s)`);
  for (const r of rows.filter((x) => x.errataApplied.length > 0)) {
    console.log(`     ${r.id}: ${r.errataApplied.map((e) => `"${e.find}" → "${e.replace}"`).join("; ")}`);
  }
  const stale = unmatchedErrata(rows, errata);
  console.log(`   errata no longer matching: ${stale.length}${stale.length ? " — re-check or delete:" : ""}`);
  for (const s of stale) console.log(`     ${s.entry.courseId} "${s.entry.find}" (${s.why})`);

  console.log(`\n── BLANK-PROSE CLEARS (fallback ${FALLBACK_ROSTER} must agree) ──`);
  console.log(`   cleared: ${clears.cleared.length}`);
  for (const r of clears.cleared) {
    console.log(`     ${r.id}: ${r.clearReason} (was ${JSON.stringify(r.doc.prereqExpr ?? null)} / co ${JSON.stringify(r.doc.coreqExpr ?? null)})`);
  }
  console.log(`   kept (fallback disagrees): ${clears.kept.length}`);
  for (const k of clears.kept) console.log(`     ${k.row.id}: ${k.why}`);
  reportDiff(rows);
  printSamples(rows);
  const quarantineCount = writeQuarantine(rows);
  console.log(`\n── QUARANTINE ──`);
  console.log(
    `   partial+failed rows written (dry-run and apply, always): ${quarantineCount} → scripts/out/prereq-quarantine.json`
  );

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to write ${stats.wouldWriteAny} ` +
        `course(s) and regenerate catalogIndex.`
    );
    return;
  }

  // Sanity gate: refuse to apply if the clean+annotated rate collapsed (data
  // shape change) — protects the catalog from a broken parser run.
  const rate = stats.total ? stats.good / stats.total : 0;
  if (rate < 0.5) {
    fail(
      `clean+annotated rate is ${(rate * 100).toFixed(1)}% (< 50%). Refusing to apply — ` +
        `the prereq text shape may have changed. Nothing written.`
    );
  }

  console.log(`\n── APPLYING (provenance-gated: clean|annotated, never "authored") ──`);
  const courseWrites = await applyWrites(db, rows);
  console.log(`   wrote ${courseWrites} course update(s).`);

  // Regenerate catalogIndex so hasPrereqs dots reflect the new trees.
  const allSnap = await db.collection("courses").get();
  const allCourses = allSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const unlocksStats = newUnlocksStats();
  const records = buildIndexRecords(allCourses, unlocksStats);
  const { chunkCount, ops: indexOps } = await regenerateCatalogIndex(db, records);
  const withPrereqs = records.filter((r) => r.hasPrereqs).length;
  console.log(
    `   regenerated catalogIndex: ${chunkCount} chunk(s); hasPrereqs=true on ${withPrereqs} records.`
  );
  console.log(
    `   unlocks index: ${records.filter((r) => r.unlocks.length > 0).length} course(s) unlock ≥1 other course` +
      ` (cap-overflow: ${unlocksStats.overflowCount})`
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
