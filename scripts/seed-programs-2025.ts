// scripts/seed-programs-2025.ts
// Seed the 9 NEW 2025 College-of-Engineering major programs (cornell-<code>-bs-2025)
// built from the official flowcharts (docs/reference/flowcharts/2025-*.jpg) into
// Firestore programs/*. Does NOT touch the existing 4 (…-bs-2026) program docs,
// nor courses/catalog/catalogIndex.
//
// Reuses seed-firestore.ts's doc-assembly conventions (ProgramSchema-validated,
// denormalized course snapshots on course-kind slots) but sources the snapshots
// from the LIVE courses/* collection (4,472 docs) rather than the small local
// seed courses.json — so every course-kind slot carries the true title/credits.
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path.
// Run (dry):   npx tsx seed-programs-2025.ts --dry-run
// Run (write): npx tsx seed-programs-2025.ts
// Idempotent: deterministic ids + set({ merge: true }).

import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ProgramSchema, type ProgramDoc } from "../cornell-degree-planner/src/lib/schemas";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";
const DATA_DIR = resolve(__dirname, "seed-data", "programs-2025");

type RawGroup = {
  id: string;
  programId: string | null;
  name: string;
  description: string | null;
  qualifyingRule: unknown;
  minCredits: number;
  advisorApproval: boolean;
  notes: string | null;
  courseIds?: string[];
};
type RawSlot = {
  id: string;
  programId: string;
  kind: string;
  courseId: string | null;
  pattern: string | null;
  patternTitle: string | null;
  // Attribute-requirement match spec (spec 010 §2) — present on kind "attribute".
  attributeMatch?: unknown;
  electiveGroupId: string | null;
  suggestedSemester: number;
  slotRow: number;
};
type RawProgram = {
  id: string;
  name: string;
  shortName: string;
  college: string;
  catalogYear: number;
  totalCredits: number | null;
  affiliationText: string | null;
  electiveGroups: RawGroup[];
  slots: RawSlot[];
  edges: { programId: string; from: string; to: string; type: string }[];
};
type LiveCourse = { subject: string; number: string; title: string; creditsMin: number; creditsMax: number };

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

function buildGroupDoc(g: RawGroup) {
  return {
    id: g.id,
    name: g.name,
    description: g.description ?? null,
    qualifyingRule: g.qualifyingRule as { type: string },
    minCredits: g.minCredits,
    advisorApproval: g.advisorApproval ?? false,
    notes: g.notes ?? null,
    courseIds: g.courseIds ?? [],
  };
}

// Denormalize course-kind slots from the LIVE course docs (same snapshot fields
// as seed-firestore.ts: courseTitle/creditsMin/creditsMax + courseSubject/courseNumber).
function buildSlotDoc(s: RawSlot, courseById: Map<string, LiveCourse>) {
  const base: Record<string, unknown> = {
    id: s.id,
    kind: s.kind,
    courseId: s.courseId ?? null,
    pattern: s.pattern ?? null,
    patternTitle: s.patternTitle ?? null,
    electiveGroupId: s.electiveGroupId ?? null,
    suggestedSemester: s.suggestedSemester,
    slotRow: s.slotRow,
    courseTitle: null,
    creditsMin: null,
    creditsMax: null,
  };
  // Attribute-requirement match spec (spec 010 §2) — carried through for
  // kind "attribute" slots (e.g. the FWS requirement).
  if (s.attributeMatch != null) base.attributeMatch = s.attributeMatch;
  if (s.kind === "course" && s.courseId) {
    const c = courseById.get(s.courseId);
    if (!c) fail(`slot ${s.id} references course ${s.courseId} not present in live catalog`);
    base.courseTitle = c!.title;
    base.creditsMin = c!.creditsMin;
    base.creditsMax = c!.creditsMax;
    base.courseSubject = c!.subject;
    base.courseNumber = c!.number;
  }
  return base;
}

function buildProgramDoc(p: RawProgram, courseById: Map<string, LiveCourse>): ProgramDoc {
  const doc = {
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    college: p.college,
    catalogYear: p.catalogYear,
    totalCredits: p.totalCredits ?? null,
    affiliationText: p.affiliationText ?? null,
    electiveGroups: p.electiveGroups.map(buildGroupDoc),
    slots: p.slots.map((s) => buildSlotDoc(s, courseById)),
    // Authored edges retired (spec 008 §2b) — the app derives wires from placed
    // courses' prereq/coreq trees; seeds write none. ProgramSchema defaults [].
    edges: [],
  };
  return ProgramSchema.parse(doc) as ProgramDoc;
}

function loadPrograms(): RawProgram[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) fail(`no program JSONs found in ${DATA_DIR}`);
  return files.map((f) => JSON.parse(readFileSync(resolve(DATA_DIR, f), "utf-8")) as RawProgram);
}

// Gather the set of course ids referenced by course-kind slots + list-group courseIds.
function referencedCourseIds(programs: RawProgram[]): Set<string> {
  const ids = new Set<string>();
  for (const p of programs) {
    for (const s of p.slots) if (s.kind === "course" && s.courseId) ids.add(s.courseId);
    for (const g of p.electiveGroups) for (const c of g.courseIds ?? []) ids.add(c);
  }
  return ids;
}

async function main() {
  if (!DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key before a real seed run.");
  }
  const programs = loadPrograms();

  // Guardrail: only 2025 ids, never overwrite the existing 2026 four.
  for (const p of programs) {
    if (!/^cornell-[a-z]+-bs-2025$/.test(p.id)) fail(`unexpected program id ${p.id} (expected cornell-<code>-bs-2025)`);
  }

  // Need Admin SDK to read live course snapshots even in dry-run (so the dry-run
  // report reflects real denormalized data). If creds are unset in dry-run, fall
  // back to empty snapshots but still validate shapes.
  const wantLive = process.env.GOOGLE_APPLICATION_CREDENTIALS != null;
  const courseById = new Map<string, LiveCourse>();
  if (wantLive) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    const db = getFirestore();
    const need = [...referencedCourseIds(programs)];
    // Fetch referenced course docs individually (getAll in chunks of 300).
    for (let i = 0; i < need.length; i += 300) {
      const refs = need.slice(i, i + 300).map((id) => db.doc(`courses/${id}`));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const x = snap.data()!;
          courseById.set(snap.id, {
            subject: x.subject,
            number: x.number,
            title: x.title,
            creditsMin: x.creditsMin,
            creditsMax: x.creditsMax,
          });
        }
      }
    }
    const missing = need.filter((id) => !courseById.has(id));
    if (missing.length) fail(`these referenced course ids are absent from live courses/*: ${missing.join(", ")}`);
  } else {
    console.log("  (dry-run without creds: skipping live snapshot fetch; course-kind slots will have null snapshots)");
  }

  const programDocs = programs.map((p) => buildProgramDoc(p, courseById));

  console.log(`\n── seed-programs-2025 (${DRY_RUN ? "DRY RUN" : "WRITE"}) ──`);
  console.log(`   target project: ${PROJECT_ID}`);
  console.log(`   programs to write: ${programDocs.length}`);
  for (const p of programDocs) {
    const courseSlots = p.slots.filter((s: any) => s.kind === "course").length;
    console.log(
      `     ${p.id.padEnd(26)} slots ${String(p.slots.length).padStart(3)}  (course ${String(courseSlots).padStart(2)})  edges ${String(p.edges.length).padStart(3)}  groups ${p.electiveGroups.length}`
    );
  }

  if (DRY_RUN) {
    const sample = programDocs[0];
    const firstCourseSlot = (sample.slots as any[]).find((s) => s.kind === "course");
    console.log("\n── sample (first program, first course-slot snapshot) ──");
    console.log("  ", JSON.stringify({ id: sample.id, name: sample.name, firstCourseSlot }));
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  const db = getFirestore();
  let batch = db.batch();
  let ops = 0;
  for (const p of programDocs) {
    batch.set(db.collection("programs").doc(p.id), { ...p, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    ops++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  await batch.commit();
  console.log(`\nSEED COMPLETE — wrote ${programDocs.length} programs/*  (2025 CoE majors).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
