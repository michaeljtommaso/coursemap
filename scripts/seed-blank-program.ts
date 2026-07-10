// scripts/seed-blank-program.ts
// Seed the single "blank" program doc (spec 006 §F5 / triage #26): a real
// programs/blank document with ZERO slots, edges, and elective groups. Because
// it's a genuine program, every programId gate in the app works unchanged
// (PlanProvider resolution, LeftSidebar, RoadmapCanvas/FirstRun) — the rejected
// alternative was first-class null-program plans, which would touch every gate.
//
// A student on the blank program builds by dragging catalog courses onto a
// column (addCustomSlot, cap 40, semesters 1–10). With totalCredits null, the
// LeftSidebar credit target falls back to 120; Major Match keeps ranking real
// majors against whatever's placed — the north-star nudge toward picking one.
//
// Does NOT touch any other program doc, nor courses/catalog/catalogIndex.
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path.
// Run (dry):   npx tsx seed-blank-program.ts --dry-run
// Run (write): npx tsx seed-blank-program.ts
// Idempotent: fixed id "blank" + set({ merge: true }).

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ProgramSchema, type ProgramDoc } from "../cornell-degree-planner/src/lib/schemas";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";

// The blank program (spec 006 §F5). catalogYear is required by the schema; 2025
// keeps it in the current catalog band without implying a real flowchart. The
// college line reads as "Your own plan" in the LeftSidebar footer.
const BLANK_PROGRAM = {
  id: "blank",
  name: "Start from scratch",
  shortName: "Blank",
  college: "Your own plan",
  catalogYear: 2025,
  totalCredits: null,
  affiliationText: null,
  electiveGroups: [],
  slots: [],
  edges: [],
};

function fail(msg: string): never {
  console.error(`\nSEED ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key before a real seed run.");
  }

  // Validate the shape against the same schema the read boundary enforces.
  const doc: ProgramDoc = ProgramSchema.parse(BLANK_PROGRAM) as ProgramDoc;

  console.log(`\n── seed-blank-program (${DRY_RUN ? "DRY RUN" : "WRITE"}) ──`);
  console.log(`   target project: ${PROJECT_ID}`);
  console.log(
    `   programs/${doc.id}  slots ${doc.slots.length}  edges ${doc.edges.length}  groups ${doc.electiveGroups.length}`
  );
  console.log(`   name "${doc.name}"  short "${doc.shortName}"  college "${doc.college}"`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  await db
    .collection("programs")
    .doc(doc.id)
    .set({ ...doc, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  console.log(`\nSEED COMPLETE — wrote programs/${doc.id} (blank canvas program).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
