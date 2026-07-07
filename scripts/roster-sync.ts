// scripts/roster-sync.ts
// Cornell roster sync → Firestore via Admin SDK (docs/specs/002 §8g).
// Ports scripts/classagent.tsx (same Cornell API + subject list) off Supabase.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:   npx tsx roster-sync.ts --dry-run     (fetch + report, write nothing)
//        npx tsx roster-sync.ts               (LIVE upsert + index/snapshot regen)
//        ROSTER=SP26 npx tsx roster-sync.ts --dry-run   (override semester)
//
// WARNING: a LIVE full sync is a beta-gate decision (it rewrites the whole course
// catalog). Do not run it live without an explicit go — use --dry-run to inspect.
//
// What it does:
//   1. Fetch the 13 engineering subjects from the Cornell Classes API.
//   2. Batch-upsert courses/{id} with merge — PRESERVING hand-authored
//      prereqExpr/coreqExpr (they're never included in the write, so merge leaves
//      them intact). Credits validated 0 ≤ c ≤ 20 (NUMERIC(4,1) lesson).
//   3. Regenerate catalogIndex/* chunks from ALL courses (fresh titles/credits +
//      correct hasPrereqs from the preserved prereqExpr).
//   4. Regenerate the denormalized snapshot fields (courseTitle/creditsMin/
//      creditsMax + courseSubject/courseNumber) inside every programs/* doc so
//      course-kind slots can't drift for more than one sync cycle.

import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";
const ROSTER = process.env.ROSTER ?? "FA25";
const CHUNK_SIZE = 300; // mirror seed-firestore.ts (spec §3)
const SUBJECTS = [
  "CS", "ECE", "MAE", "ORIE", "ENGRD", "ENGRI", "ENGRG",
  "MATH", "PHYS", "CHEM", "CHEME", "CEE", "MSE",
];
const BASE = "https://classes.cornell.edu/api/2.0";

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
};

function fail(msg: string): never {
  console.error(`\nROSTER-SYNC ABORTED: ${msg}`);
  process.exit(1);
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
  };
}

async function main() {
  if (!DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
        "before a LIVE sync (never commit or echo that file)."
    );
  }

  console.log(`\n── roster-sync (${DRY_RUN ? "DRY RUN" : "LIVE"}) — roster ${ROSTER} ──`);
  console.log(`   subjects: ${SUBJECTS.join(", ")}\n`);

  // 1. Fetch all subjects.
  const fetched: CourseUpsert[] = [];
  for (const subject of SUBJECTS) {
    const classes = await fetchSubject(ROSTER, subject);
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
  console.log(`\n   total unique courses fetched: ${upserts.length}`);

  if (DRY_RUN) {
    const sample = upserts.find((c) => c.id === "CS-2110") ?? upserts[0];
    console.log("\n── sample upsert (prereqExpr/coreqExpr NOT written — merge preserves them) ──");
    console.log("  ", JSON.stringify(sample));
    console.log(
      `\n   would upsert ${upserts.length} courses/*, then regenerate catalogIndex/* ` +
        `(~${Math.ceil(upserts.length / CHUNK_SIZE)}+ chunks) and programs/* slot snapshots.`
    );
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  // ── LIVE ──
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  // 2. Batch-upsert courses with merge (prereqExpr/coreqExpr preserved).
  let batch = db.batch();
  let ops = 0;
  const flush = async (force = false) => {
    if (force || ops >= 400) {
      await batch.commit();
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
  const allCoursesSnap = await db.collection("courses").get();
  const allCourses = allCoursesSnap.docs
    .map((d) => d.data())
    .sort((a, b) =>
      String(a.subject).localeCompare(String(b.subject)) ||
      String(a.number).localeCompare(String(b.number))
    );
  const indexRecords = allCourses.map((c) => ({
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    creditsMin: c.creditsMin,
    creditsMax: c.creditsMax,
    hasPrereqs: c.prereqExpr != null,
  }));
  // Overwrite chunks; delete any stale trailing chunks from a previous larger sync.
  const newChunkCount = Math.max(1, Math.ceil(indexRecords.length / CHUNK_SIZE));
  batch = db.batch();
  ops = 0;
  for (let i = 0; i < newChunkCount; i++) {
    const id = `chunk-${String(i).padStart(3, "0")}`;
    const records = indexRecords.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    batch.set(db.collection("catalogIndex").doc(id), { records });
    ops++;
    await flush();
  }
  // Reap stale chunks beyond the new count.
  const existingChunks = await db.collection("catalogIndex").get();
  for (const d of existingChunks.docs) {
    const n = Number(d.id.replace("chunk-", ""));
    if (!Number.isNaN(n) && n >= newChunkCount) {
      batch.delete(d.ref);
      ops++;
      await flush();
    }
  }
  await flush(true);
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

  console.log("\nROSTER-SYNC COMPLETE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
