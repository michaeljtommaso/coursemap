// scripts/roster-sync.ts
// Cornell roster sync → Firestore via Admin SDK (docs/specs/002 §8g, 005 §10).
// Ports scripts/classagent.tsx (same Cornell API) off Supabase.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:   npx tsx roster-sync.ts --dry-run     (fetch + report, write nothing)
//        npx tsx roster-sync.ts               (LIVE upsert + index/snapshot regen)
//        ROSTER=SP26 npx tsx roster-sync.ts --dry-run       (override roster)
//        npx tsx roster-sync.ts --subjects CS,MATH --dry-run (targeted subjects)
//
// WARNING: a LIVE full sync is a beta-gate decision (it rewrites the whole course
// catalog). Do not run it live without an explicit go — use --dry-run to inspect.
//
// What it does (005 §10 — full catalog, no longer the 13 engineering subjects):
//   0. Resolve roster: ROSTER env override, else the latest AVAILABLE roster from
//      /config/rosters.json (version COMPLETE + real class data), default FA25.
//   1. Fetch ALL subjects for the roster from /config/subjects.json (or the
//      --subjects override list), then every class per subject (300ms delay).
//   2. Batch-upsert courses/{id} with merge — PRESERVING hand-authored
//      prereqExpr/coreqExpr (they're never included in the write, so merge leaves
//      them intact). Credits validated 0 ≤ c ≤ 20 (NUMERIC(4,1) lesson).
//   3. Regenerate catalogIndex/* chunks from ALL courses (fresh titles/credits +
//      correct hasPrereqs from the preserved prereqExpr). ~300-record chunks.
//   4. Regenerate the denormalized snapshot fields (courseTitle/creditsMin/
//      creditsMax + courseSubject/courseNumber) inside every programs/* doc so
//      course-kind slots can't drift for more than one sync cycle.
//   5. Print a summary (subjects fetched, courses upserted, chunks written, writes,
//      elapsed).

import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CHUNK_SIZE, buildIndexRecords, regenerateCatalogIndex } from "./catalog-index";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";
const BASE = "https://classes.cornell.edu/api/2.0";
const DEFAULT_ROSTER = "FA25";

// --subjects CS,MATH   → targeted re-run over just those subjects.
function parseSubjectsFlag(): string[] | null {
  const i = process.argv.indexOf("--subjects");
  if (i === -1) return null;
  const val = process.argv[i + 1];
  if (!val || val.startsWith("--")) {
    fail("--subjects requires a comma-separated list, e.g. --subjects CS,MATH");
  }
  return val
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
const SUBJECTS_OVERRIDE = parseSubjectsFlag();

void resolve; // (kept for parity with sibling scripts; no file IO here)

// Credits guard (spec §8g): plain JS numbers, 0 ≤ credits ≤ 20.
const CreditSchema = z.number().min(0).max(20);

type ClassRow = {
  subject: string;
  catalogNbr: string;
  titleLong: string;
  description?: string | null;
  lastTermsOffered?: string | null;
  crseId?: number | string;
  enrollGroups?: Array<{ unitsMinimum?: number; unitsMaximum?: number }>;
  // Free-text prereq/coreq fields. Verified live (FA26, 2026-07-07): the real
  // prose lives in catalogPrereq/catalogCoreq; catalogPrereqCoreq is empty in
  // this roster but kept as a fallback so the capture is robust to future data.
  catalogPrereq?: string | null;
  catalogCoreq?: string | null;
  catalogPrereqCoreq?: string | null;
};

type CourseUpsert = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  description: string | null;
  offered: string[];
  rosterId: string | null;
  // Raw catalog prereq/coreq text, captured verbatim for the parse-prereqs
  // pipeline. null when the field is absent/blank. prereqExpr/coreqExpr are NOT
  // written here — merge preserves any hand-authored trees.
  prereqText: string | null;
  coreqText: string | null;
};

function fail(msg: string): never {
  console.error(`\nROSTER-SYNC ABORTED: ${msg}`);
  process.exit(1);
}

// 0. Resolve the roster to sync. ROSTER env wins; otherwise pick the latest
// roster that is actually AVAILABLE: version COMPLETE and not just listed. The
// rosters.json list is chronological, so we scan from the end. A roster counts
// as available if its subjects endpoint returns a non-empty subject list.
async function resolveRoster(): Promise<string> {
  if (process.env.ROSTER) return process.env.ROSTER;
  try {
    const res = await fetch(`${BASE}/config/rosters.json`);
    if (!res.ok) {
      console.warn(`   rosters.json HTTP ${res.status}; falling back to ${DEFAULT_ROSTER}`);
      return DEFAULT_ROSTER;
    }
    const json = (await res.json()) as {
      data?: { rosters?: Array<{ slug: string; version?: { status?: string } }> };
    };
    const rosters = json.data?.rosters ?? [];
    // Walk newest → oldest; the first one whose subjects endpoint is populated wins.
    for (let i = rosters.length - 1; i >= 0; i--) {
      const r = rosters[i];
      if (r.version?.status !== "COMPLETE") continue;
      const sres = await fetch(`${BASE}/config/subjects.json?roster=${r.slug}`);
      if (!sres.ok) continue;
      const sjson = (await sres.json()) as { data?: { subjects?: unknown[] } };
      if ((sjson.data?.subjects?.length ?? 0) > 0) {
        return r.slug;
      }
    }
  } catch (e) {
    console.warn(`   roster resolution failed (${(e as Error).message}); using ${DEFAULT_ROSTER}`);
  }
  return DEFAULT_ROSTER;
}

async function fetchSubjectList(roster: string): Promise<string[]> {
  const url = `${BASE}/config/subjects.json?roster=${roster}`;
  const res = await fetch(url);
  if (!res.ok) fail(`subjects.json HTTP ${res.status} for roster ${roster}`);
  const json = (await res.json()) as { data?: { subjects?: Array<{ value: string }> } };
  const subjects = (json.data?.subjects ?? [])
    .map((s) => s.value)
    .filter(Boolean)
    .sort();
  if (subjects.length === 0) fail(`no subjects returned for roster ${roster}`);
  return subjects;
}

async function fetchSubject(roster: string, subject: string): Promise<ClassRow[]> {
  const url = `${BASE}/search/classes.json?roster=${roster}&subject=${subject}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  HTTP ${res.status} fetching ${subject}`);
    return [];
  }
  const json = (await res.json()) as { data?: { classes?: ClassRow[] } };
  return json.data?.classes ?? [];
}

function parseOffered(lastTermsOffered: string | null | undefined): string[] {
  if (!lastTermsOffered) return [];
  const seen = new Set<string>();
  for (const term of lastTermsOffered.split(",")) {
    const t = term.trim();
    if (t.endsWith("FA")) seen.add("FA");
    else if (t.endsWith("SP")) seen.add("SP");
    else if (t.endsWith("SU")) seen.add("SU");
    else if (t.endsWith("WI")) seen.add("WI");
  }
  return [...seen];
}

function rowToCourse(c: ClassRow): CourseUpsert | null {
  const rawMin = c.enrollGroups?.[0]?.unitsMinimum;
  const rawMax = c.enrollGroups?.[0]?.unitsMaximum;
  // Skip rows without parseable credits rather than write garbage.
  if (typeof rawMin !== "number" || typeof rawMax !== "number") return null;
  const min = CreditSchema.safeParse(rawMin);
  const max = CreditSchema.safeParse(rawMax);
  if (!min.success || !max.success) {
    console.warn(`  skip ${c.subject}-${c.catalogNbr}: credits out of range (${rawMin}/${rawMax})`);
    return null;
  }
  // Capture raw prereq/coreq prose. Prefer the split fields (populated on FA26);
  // fall back to the combined catalogPrereqCoreq field if a future roster uses it.
  const clean = (s: string | null | undefined): string | null => {
    if (typeof s !== "string") return null;
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 0 ? t : null;
  };
  const prereqText = clean(c.catalogPrereq) ?? clean(c.catalogPrereqCoreq);
  const coreqText = clean(c.catalogCoreq);
  return {
    id: `${c.subject}-${c.catalogNbr}`,
    subject: c.subject,
    number: c.catalogNbr,
    title: c.titleLong,
    creditsMin: rawMin,
    creditsMax: rawMax,
    description: c.description ?? null,
    offered: parseOffered(c.lastTermsOffered ?? null),
    rosterId: c.crseId != null ? String(c.crseId) : null,
    prereqText,
    coreqText,
  };
}

async function main() {
  const startedAt = Date.now();

  if (!DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
        "before a LIVE sync (never commit or echo that file)."
    );
  }

  const ROSTER = await resolveRoster();

  console.log(`\n── roster-sync (${DRY_RUN ? "DRY RUN" : "LIVE"}) — roster ${ROSTER} ──`);

  // 1. Resolve subject list (full catalog, or --subjects override).
  const subjects = SUBJECTS_OVERRIDE ?? (await fetchSubjectList(ROSTER));
  console.log(
    `   ${SUBJECTS_OVERRIDE ? "targeted" : "full-catalog"} subjects: ${subjects.length}` +
      (SUBJECTS_OVERRIDE ? ` (${subjects.join(", ")})` : "")
  );
  console.log("");

  // 1b. Fetch every class per subject.
  const fetched: CourseUpsert[] = [];
  let failedSubjects: string[] = [];
  for (const subject of subjects) {
    const classes = await fetchSubject(ROSTER, subject);
    if (classes.length === 0) failedSubjects.push(subject);
    let kept = 0;
    for (const c of classes) {
      const row = rowToCourse(c);
      if (row) {
        fetched.push(row);
        kept++;
      }
    }
    console.log(`   ${subject.padEnd(6)} fetched ${String(classes.length).padStart(4)}  kept ${kept}`);
    await new Promise((r) => setTimeout(r, 300)); // be polite to the API
  }

  // Dedupe by id (a subject can list cross-listed dupes); last wins.
  const byId = new Map<string, CourseUpsert>();
  for (const c of fetched) byId.set(c.id, c);
  const upserts = [...byId.values()];
  const projectedChunks = Math.max(1, Math.ceil(upserts.length / CHUNK_SIZE));

  console.log(`\n   total unique courses fetched: ${upserts.length}`);

  // Sanity gate (005 §10): full-catalog scrape should be ~100+ subjects and
  // ~3500–6000 courses. Wildly outside → STOP rather than corrupt the catalog.
  // (Skipped for --subjects targeted re-runs, which are intentionally small.)
  if (!SUBJECTS_OVERRIDE) {
    if (subjects.length < 100) {
      fail(
        `only ${subjects.length} subjects fetched (expected 100+). Aborting — ` +
          `subjects.json may have changed shape. Nothing written.`
      );
    }
    if (upserts.length < 3000 || upserts.length > 8000) {
      fail(
        `${upserts.length} courses is outside the sane 3500–6000 range. Aborting ` +
          `to avoid corrupting the catalog. Nothing written.`
      );
    }
  }

  if (DRY_RUN) {
    const sample = upserts.find((c) => c.id === "CS-2110") ?? upserts[0];
    console.log("\n── sample upsert (prereqExpr/coreqExpr NOT written — merge preserves them;");
    console.log("   prereqText/coreqText ARE written for the parse-prereqs pipeline) ──");
    console.log("  ", JSON.stringify(sample));
    const withPrereqText = upserts.filter((c) => c.prereqText).length;
    const withCoreqText = upserts.filter((c) => c.coreqText).length;
    console.log(
      `\n   courses carrying prereqText: ${withPrereqText}  coreqText: ${withCoreqText}`
    );
    console.log("\n── DRY-RUN PROJECTION ──");
    console.log(`   subjects:        ${subjects.length}`);
    console.log(`   courses:         ${upserts.length}`);
    console.log(`   projected chunks: ${projectedChunks}`);
    if (failedSubjects.length) {
      console.log(`   empty/failed subjects (${failedSubjects.length}): ${failedSubjects.join(", ")}`);
    }
    console.log(
      `\n   would upsert ${upserts.length} courses/*, then regenerate catalogIndex/* ` +
        `(${projectedChunks} chunk(s)) and programs/* slot snapshots.`
    );
    console.log(`\nDRY RUN — nothing written. (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    return;
  }

  // ── LIVE ──
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  let writeCount = 0; // total document ops committed (batch write budget tracking)

  // 2. Batch-upsert courses with merge (prereqExpr/coreqExpr preserved).
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
  const now = FieldValue.serverTimestamp();
  for (const c of upserts) {
    batch.set(db.collection("courses").doc(c.id), { ...c, updatedAt: now }, { merge: true });
    ops++;
    await flush();
  }
  await flush(true);
  console.log(`\n   upserted ${upserts.length} courses (merge — prereq/coreq preserved).`);

  // 3. Regenerate catalogIndex from ALL courses (fresh read → correct hasPrereqs).
  //    Chunk logic is shared with parse-prereqs via scripts/catalog-index.ts.
  const allCoursesSnap = await db.collection("courses").get();
  const allCourses = allCoursesSnap.docs.map((d) => d.data());
  const indexRecords = buildIndexRecords(allCourses);
  const { chunkCount: newChunkCount, ops: indexOps } = await regenerateCatalogIndex(
    db,
    indexRecords
  );
  writeCount += indexOps;
  console.log(`   regenerated catalogIndex: ${newChunkCount} chunk(s), ${indexRecords.length} records.`);

  // 4. Regenerate program-doc slot snapshots from fresh course data.
  const courseById = new Map(allCourses.map((c) => [c.id, c]));
  const programsSnap = await db.collection("programs").get();
  batch = db.batch();
  ops = 0;
  let touchedPrograms = 0;
  for (const progDoc of programsSnap.docs) {
    const data = progDoc.data();
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const newSlots = slots.map((s: Record<string, unknown>) => {
      if (s.kind !== "course" || !s.courseId) return s;
      const c = courseById.get(s.courseId as string);
      if (!c) return s; // course not in catalog — leave snapshot as-is
      return {
        ...s,
        courseTitle: c.title,
        creditsMin: c.creditsMin,
        creditsMax: c.creditsMax,
        courseSubject: c.subject,
        courseNumber: c.number,
      };
    });
    batch.set(progDoc.ref, { slots: newSlots }, { merge: true });
    ops++;
    touchedPrograms++;
    await flush();
  }
  await flush(true);
  console.log(`   regenerated slot snapshots in ${touchedPrograms} program(s).`);

  // 5. Summary.
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\n── SUMMARY ──");
  console.log(`   roster:            ${ROSTER}`);
  console.log(`   subjects fetched:  ${subjects.length}`);
  console.log(`   courses upserted:  ${upserts.length}`);
  console.log(`   catalogIndex chunks written: ${newChunkCount}`);
  console.log(`   programs touched:  ${touchedPrograms}`);
  console.log(`   total document writes: ${writeCount}`);
  if (failedSubjects.length) {
    console.log(`   empty/failed subjects (${failedSubjects.length}): ${failedSubjects.join(", ")}`);
  }
  console.log(`   elapsed:           ${elapsed}s`);
  console.log("\nROSTER-SYNC COMPLETE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
