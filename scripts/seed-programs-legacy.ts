// scripts/seed-programs-legacy.ts
// Re-upsert ONLY the 4 legacy program docs defined in seed-data/programs.json
// (cornell-cs-bs-2026, cornell-ece-bs-2026, cornell-me-bs-2026, cornell-ore-bs-2026)
// into Firestore programs/*, with byte-identical doc shapes to what seed-firestore.ts's
// program-build phase produces today: same slot composition (incl. attribute-kind FWS
// slots + their attributeMatch), patternTitle, denormalized course snapshots sourced
// from the local seed-data/courses.json, embedded elective groups, edges: [].
//
// WHY this script exists instead of just re-running seed-firestore.ts: seed-firestore.ts
// is a full-bootstrap tool. Its course-phase (courses/*) and index-phase (catalog/meta,
// catalogIndex/*) are unconditional full-collection writes sourced from the small local
// seed-data/courses.json — running them again would CLOBBER the live roster-synced
// catalog (thousands of docs kept current by the roster sync pipeline, not this repo's
// seed files). This script exists so a post-sync program-doc refresh (new attribute
// slots, patternTitle tweaks, elective-group edits, etc.) can be pushed WITHOUT ever
// touching courses/*, catalog/meta, or catalogIndex/*.
//
// Note: seed-data/slots.json, electiveGroups.json, and electiveQualifications.json are
// NOT read here (and aren't read by seed-firestore.ts's program phase either) — by the
// time convert-seed-sql.ts writes programs.json, each program's electiveGroups/slots
// arrays are already fully embedded (including courseIds on program-scoped groups).
// electiveQualifications.json only back-fills courseIds for the GLOBAL groups written
// to catalog/meta, which this script never touches.
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path (only required for
//        --apply; the dry-run path below never initializes the Admin SDK).
// Run (dry, default):  npx tsx seed-programs-legacy.ts
// Run (write):         npx tsx seed-programs-legacy.ts --apply
// Idempotent: deterministic ids + set({ merge: true }).

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { ProgramSchema, type ProgramDoc, type SlotDoc, type ElectiveGroupDoc } from "../cornell-degree-planner/src/lib/schemas";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "degree-planner-app"; // single project today (dev + prod alias)
const DATA_DIR = resolve(__dirname, "seed-data");

// Guardrail: this script only ever writes the 4 legacy programs.json ids. It must never
// grow to cover the 2025 CoE majors (those live in programs-2025/*.json + seed-programs-2025.ts).
const LEGACY_IDS = new Set([
  "cornell-cs-bs-2026",
  "cornell-ece-bs-2026",
  "cornell-me-bs-2026",
  "cornell-ore-bs-2026",
]);

// ── Raw JSON shapes (mirrors seed-firestore.ts's RawCourse/RawGroup/RawSlot/RawProgram) ──
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
  affiliationText: string | null;
  electiveGroups: RawGroup[];
  slots: RawSlot[];
  edges: { programId: string; from: string; to: string; type: string }[];
};

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, `${name}.json`), "utf-8")) as T;
}

// ── Doc assembly — copied verbatim from seed-firestore.ts's buildGroupDoc/buildSlotDoc/
// buildProgramDoc (program phase only; no course/catalog/index phases here). ──
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
  // Attribute-requirement match spec (spec 010 §2) — carried through for
  // kind "attribute" slots so satisfies/Find-a-class can evaluate them.
  if (s.attributeMatch != null) {
    (base as Record<string, unknown>).attributeMatch = s.attributeMatch;
  }
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

function buildProgramDoc(p: RawProgram, courseById: Map<string, RawCourse>): ProgramDoc {
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
    // Authored edges retired (spec 008 §2b) — the app derives wires from placed
    // courses' prereq/coreq trees; seeds write none. ProgramSchema defaults [].
    edges: [],
  };
  return ProgramSchema.parse(doc) as ProgramDoc;
}

async function main() {
  if (APPLY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
        "before --apply (never commit or echo that file)."
    );
  }

  // Dry-run reads only local seed files — no Admin SDK init, no network, no credentials.
  const courses = loadJson<RawCourse[]>("courses");
  const programs = loadJson<RawProgram[]>("programs");
  const courseById = new Map(courses.map((c) => [c.id, c]));

  for (const p of programs) {
    if (!LEGACY_IDS.has(p.id)) {
      fail(
        `unexpected program id ${p.id} in programs.json (expected one of: ${[...LEGACY_IDS].join(", ")}). ` +
          "This script only ever writes the 4 legacy programs — new programs belong in a sibling script."
      );
    }
  }

  const programDocs = programs.map((p) => buildProgramDoc(p, courseById));

  console.log(`\n── seed-programs-legacy (${APPLY ? "WRITE" : "DRY RUN"}) ──`);
  console.log(`   target project: ${PROJECT_ID}`);
  console.log("   scope: programs/* ONLY — courses/*, catalog/meta, catalogIndex/* not touched");
  console.log(`   programs to write: ${programDocs.length}`);
  for (const p of programDocs) {
    const byKind = new Map<string, number>();
    for (const s of p.slots as unknown as { kind: string }[]) {
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    }
    const kindsStr = [...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(
      `     ${p.id.padEnd(22)} slots ${String(p.slots.length).padStart(3)}  attribute ${String(
        byKind.get("attribute") ?? 0
      ).padStart(2)}  edges ${String(p.edges.length).padStart(3)}  groups ${String(
        p.electiveGroups.length
      ).padStart(2)}  (${kindsStr})`
    );
  }

  const sample = programDocs[0];
  console.log("\n── sample (first program, first slot) ──");
  console.log("  ", JSON.stringify({ id: sample.id, name: sample.name, firstSlot: sample.slots[0] }));

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Pass --apply to write (requires GOOGLE_APPLICATION_CREDENTIALS).");
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
  for (const p of programDocs) {
    batch.set(db.collection("programs").doc(p.id), p, { merge: true });
    ops++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  await batch.commit();

  console.log(`\nSEED COMPLETE — wrote ${programDocs.length} programs/* (legacy CS/ECE/MAE/ORIE 2026).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
