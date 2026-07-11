// scripts/instructor-history-sync.ts
// Cornell rosters → courseInstructorHistory Firestore sync (spec 013 §3d). Thin
// IO SHELL around scripts/instructor-history.ts (extract + merge are pure and
// corpus-tested there). Hits the SAME public Cornell API as roster-sync.ts, one
// subject at a time, throttled.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx instructor-history-sync.ts --rosters FA25 --subjects CS --dry-run   (smoke ONE)
//   npx tsx instructor-history-sync.ts --dry-run           (last 6 rosters, all subjects, no writes)
//   npx tsx instructor-history-sync.ts --apply             (LIVE — merge into courseInstructorHistory)

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { ClassRow } from "./roster-convert";
import {
  extractCourseInstructors,
  mergeRoster,
  type CourseHistoryDoc,
} from "./instructor-history";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "degree-planner-app";
const BASE = "https://classes.cornell.edu/api/2.0";
const DEFAULT_ROSTERS = ["FA23", "SP24", "FA24", "SP25", "FA25", "SP26"]; // last ~6

function fail(msg: string): never {
  console.error(`\nINSTRUCTOR-HISTORY-SYNC ABORTED: ${msg}`);
  process.exit(1);
}

function parseListFlag(flag: string): string[] | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) fail(`${flag} requires a comma-separated list.`);
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

async function fetchSubjectList(roster: string): Promise<string[]> {
  const res = await fetch(`${BASE}/config/subjects.json?roster=${roster}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { subjects?: Array<{ value: string }> } };
  return (json.data?.subjects ?? []).map((s) => s.value).filter(Boolean).sort();
}

async function fetchSubject(roster: string, subject: string): Promise<ClassRow[]> {
  const res = await fetch(`${BASE}/search/classes.json?roster=${roster}&subject=${subject}`);
  if (!res.ok) {
    console.error(`  HTTP ${res.status} fetching ${subject} @ ${roster}`);
    return [];
  }
  const json = (await res.json()) as { data?: { classes?: ClassRow[] } };
  return json.data?.classes ?? [];
}

async function main() {
  const rosters = parseListFlag("--rosters") ?? DEFAULT_ROSTERS;
  const subjectsOverride = parseListFlag("--subjects");
  console.log(`\n── instructor-history-sync (${APPLY ? "LIVE" : "DRY RUN"}) — rosters ${rosters.join(", ")} ──`);

  if (APPLY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("GOOGLE_APPLICATION_CREDENTIALS is unset (needed to write courseInstructorHistory).");
  }

  // Accumulate the merged history docs across all requested rosters IN MEMORY,
  // then upsert once at the end (merge per courseId). Rosters processed oldest→
  // newest so mergeRoster's newest-first ordering lands correctly regardless.
  const byCourse = new Map<string, CourseHistoryDoc>();
  let totalRows = 0;

  for (const roster of [...rosters].sort()) {
    const subjects = subjectsOverride ?? (await fetchSubjectList(roster));
    if (subjects.length === 0) {
      console.log(`   ${roster}: no subjects (roster unavailable?) — skipping`);
      continue;
    }
    console.log(`   ${roster}: ${subjects.length} subject(s)`);
    for (const subject of subjects) {
      const rows = await fetchSubject(roster, subject);
      totalRows += rows.length;
      const perCourse = extractCourseInstructors(rows);
      for (const [courseId, instructors] of perCourse) {
        byCourse.set(courseId, mergeRoster(byCourse.get(courseId) ?? null, courseId, roster, instructors));
      }
      await new Promise((r) => setTimeout(r, 300)); // be polite to the API
    }
  }

  console.log(`\n   courses with history: ${byCourse.size}   class rows scanned: ${totalRows}`);
  const sample = byCourse.get("CS-2110") ?? [...byCourse.values()][0];
  if (sample) console.log("   sample:", JSON.stringify(sample));

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to upsert ${byCourse.size} history doc(s).`);
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  let batch = db.batch();
  let ops = 0;
  let written = 0;
  for (const [courseId, doc] of byCourse) {
    batch.set(
      db.collection("courseInstructorHistory").doc(courseId),
      { ...doc, fetchedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    ops++;
    written++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  console.log(`\n── APPLIED ── upserted ${written} courseInstructorHistory doc(s).`);
  console.log("\nINSTRUCTOR-HISTORY-SYNC COMPLETE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
