// scripts/seed-firestore.ts
// Admin SDK batch writer — SQL-derived JSON → Firestore (docs/specs/002 §4 step 2).
//
// One-time setup: cd scripts && npm install
// Prereq:  run `npx tsx convert-seed-sql.ts` first (writes seed-data/*.json)
// Auth:    set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
//
// Run (dry):   npx tsx seed-firestore.ts --dry-run
// Run (write): npx tsx seed-firestore.ts
// Flags:       --project dev|prod   (default dev; single project today)
//
// Idempotent: deterministic IDs + set({ merge: true }). Zod-validates every
// record against the APP schemas (../cornell-degree-planner/src/lib/schemas.ts)
// before writing — same file the client validates reads against, so seed and read
// can't disagree on shape.

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  CourseSchema,
  ProgramSchema,
  CatalogMetaSchema,
  CatalogIndexChunkSchema,
  type CourseDoc,
  type ProgramDoc,
  type SlotDoc,
  type ElectiveGroupDoc,
} from "../cornell-degree-planner/src/lib/schemas";

const DRY_RUN = process.argv.includes("--dry-run");
const projIdx = process.argv.indexOf("--project");
const PROJECT_TARGET = projIdx !== -1 ? process.argv[projIdx + 1] : "dev";
const PROJECT_ID = "degree-planner-app"; // single project today (dev + prod alias)
const SEED_VERSION = 1;
const CHUNK_SIZE = 300; // ~300 records/chunk (spec §3)
const DATA_DIR = resolve(__dirname, "seed-data");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, `${name}.json`), "utf-8")) as T;
}

// ── Raw JSON shapes (from convert-seed-sql.ts) ──
type RawCourse = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  offered: string[];
  prereqExpr: unknown;
  coreqExpr: unknown;
};
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
  affiliationText: string | null;
  electiveGroups: RawGroup[];
  slots: RawSlot[];
  edges: { programId: string; from: string; to: string; type: string }[];
};

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

// ── Doc assembly ─────────────────────────────────────────────────────────────
function buildCourseDoc(c: RawCourse): CourseDoc {
  // updatedAt is injected as a serverTimestamp() sentinel at write time (below),
  // so it's left undefined here — the schema tolerates that and dry-run needs no
  // Admin SDK app initialized.
  return CourseSchema.parse({
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    creditsMin: c.creditsMin,
    creditsMax: c.creditsMax,
    description: null,
    offered: c.offered ?? [],
    prereqExpr: c.prereqExpr ?? null,
    coreqExpr: c.coreqExpr ?? null,
    rosterId: null,
    updatedAt: undefined,
  }) as CourseDoc;
}

function buildGroupDoc(g: RawGroup): ElectiveGroupDoc {
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

function buildSlotDoc(s: RawSlot, courseById: Map<string, RawCourse>): SlotDoc {
  const base: SlotDoc = {
    id: s.id,
    kind: s.kind as SlotDoc["kind"],
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
  // Denormalized display snapshot for course-kind slots (+ subject/number as
  // extra display fields the .passthrough() schema tolerates — GridSlotNode
  // renders `${subject} ${number}`).
  if (s.kind === "course" && s.courseId) {
    const c = courseById.get(s.courseId);
    if (!c) fail(`slot ${s.id} references missing course ${s.courseId}`);
    base.courseTitle = c!.title;
    base.creditsMin = c!.creditsMin;
    base.creditsMax = c!.creditsMax;
    (base as Record<string, unknown>).courseSubject = c!.subject;
    (base as Record<string, unknown>).courseNumber = c!.number;
  }
  return base;
}

function buildProgramDoc(
  p: RawProgram,
  courseById: Map<string, RawCourse>
): ProgramDoc {
  const doc = {
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    college: p.college,
    catalogYear: p.catalogYear,
    totalCredits: null,
    affiliationText: p.affiliationText ?? null,
    electiveGroups: p.electiveGroups.map(buildGroupDoc),
    slots: p.slots.map((s) => buildSlotDoc(s, courseById)),
    edges: p.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
  };
  return ProgramSchema.parse(doc) as ProgramDoc;
}

async function main() {
  if (!DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
        "before a real seed run (never commit or echo that file)."
    );
  }

  const courses = loadJson<RawCourse[]>("courses");
  const aliases = loadJson<Record<string, string>>("aliases");
  const globalGroupsRaw = loadJson<RawGroup[]>("electiveGroups").filter(
    (g) => g.programId === null
  );
  const qualifications = loadJson<Record<string, string[]>>(
    "electiveQualifications"
  );
  const programs = loadJson<RawProgram[]>("programs");

  const courseById = new Map(courses.map((c) => [c.id, c]));

  // ── Assemble + validate ──
  const courseDocs = courses.map(buildCourseDoc);
  const programDocs = programs.map((p) => buildProgramDoc(p, courseById));

  const globalElectiveGroups = globalGroupsRaw.map((g) =>
    buildGroupDoc({ ...g, courseIds: qualifications[g.id] ?? [] })
  );
  const catalogMeta = CatalogMetaSchema.parse({
    aliases,
    globalElectiveGroups,
    seedVersion: SEED_VERSION,
    syncedAt: undefined,
  });

  // catalogIndex chunks
  const indexRecords = courses.map((c) => ({
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    creditsMin: c.creditsMin,
    creditsMax: c.creditsMax,
    hasPrereqs: c.prereqExpr != null,
  }));
  const chunks: { id: string; records: typeof indexRecords }[] = [];
  for (let i = 0; i < indexRecords.length; i += CHUNK_SIZE) {
    const id = `chunk-${String(chunks.length).padStart(3, "0")}`;
    const records = indexRecords.slice(i, i + CHUNK_SIZE);
    CatalogIndexChunkSchema.parse({ records });
    chunks.push({ id, records });
  }

  // ── Report counts ──
  console.log(`\n── seed-firestore (${DRY_RUN ? "DRY RUN" : "WRITE"}) ──`);
  console.log(`   target project: ${PROJECT_ID} (--project ${PROJECT_TARGET})`);
  console.log("   counts to write:");
  console.log(`     courses/*            ${courseDocs.length}`);
  console.log(`     catalog/meta         1  (aliases ${Object.keys(aliases).length}, globalElectiveGroups ${globalElectiveGroups.length})`);
  console.log(`     catalogIndex/*       ${chunks.length}  (${indexRecords.length} records)`);
  console.log(`     programs/*           ${programDocs.length}`);
  for (const p of programDocs) {
    console.log(
      `       ${p.id.padEnd(24)} slots ${String(p.slots.length).padStart(3)}  edges ${String(
        p.edges.length
      ).padStart(3)}  groups ${p.electiveGroups.length}`
    );
  }

  if (DRY_RUN) {
    const sampleCourse = courses.find((c) => c.id === "CS-2110");
    console.log("\n── sample docs (one per collection) ──");
    console.log("  courses/CS-2110:");
    console.log("   ", JSON.stringify({ ...buildCourseDoc(sampleCourse!), updatedAt: "<serverTimestamp @write>" }));
    console.log("  catalog/meta (truncated):");
    console.log("   ", JSON.stringify({ ...catalogMeta, aliases, globalElectiveGroups: `<${globalElectiveGroups.length} groups>` }));
    console.log(`  catalogIndex/${chunks[0].id} (first record):`);
    console.log("   ", JSON.stringify(chunks[0].records[0]));
    const csProg = programDocs.find((p) => p.id === "cornell-cs-bs-2026")!;
    console.log("  programs/cornell-cs-bs-2026 (meta + first slot + first edge):");
    console.log("   ", JSON.stringify({
      id: csProg.id, name: csProg.name, shortName: csProg.shortName,
      slotsLen: csProg.slots.length, edgesLen: csProg.edges.length,
      firstSlot: csProg.slots[0], firstEdge: csProg.edges[0],
    }));
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  // ── Write (batched, idempotent set-with-merge) ──
  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
  const db = getFirestore();

  let batch = db.batch();
  let ops = 0;
  const flushIfFull = async () => {
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  const serverNow = FieldValue.serverTimestamp();
  for (const c of courseDocs) {
    batch.set(
      db.collection("courses").doc(c.id),
      { ...c, updatedAt: serverNow },
      { merge: true }
    );
    ops++;
    await flushIfFull();
  }
  batch.set(
    db.collection("catalog").doc("meta"),
    { ...catalogMeta, syncedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  ops++;
  await flushIfFull();
  for (const ch of chunks) {
    batch.set(db.collection("catalogIndex").doc(ch.id), { records: ch.records }, { merge: true });
    ops++;
    await flushIfFull();
  }
  for (const p of programDocs) {
    batch.set(db.collection("programs").doc(p.id), p, { merge: true });
    ops++;
    await flushIfFull();
  }
  await batch.commit();

  console.log("\nSEED COMPLETE — all docs written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
