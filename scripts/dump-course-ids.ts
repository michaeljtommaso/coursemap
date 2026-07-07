// scripts/dump-course-ids.ts
// One-off helper: dump the live Firestore courses/* catalog (id → display fields)
// to a local JSON cache, used to validate course_id references while digitizing
// the 2025 engineering flowcharts (spec 005 program build). Read-only.
//
// Run: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx dump-course-ids.ts <outfile.json>
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync } from "fs";

const PROJECT_ID = "degree-planner-app";
const OUT = process.argv[2] || "course-ids.json";

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("GOOGLE_APPLICATION_CREDENTIALS unset.");
    process.exit(1);
  }
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const snap = await db
    .collection("courses")
    .select("subject", "number", "title", "creditsMin", "creditsMax")
    .get();
  const ids: Record<
    string,
    { subject: string; number: string; title: string; creditsMin: number; creditsMax: number }
  > = {};
  snap.forEach((d) => {
    const x = d.data();
    ids[d.id] = {
      subject: x.subject,
      number: x.number,
      title: x.title,
      creditsMin: x.creditsMin,
      creditsMax: x.creditsMax,
    };
  });
  writeFileSync(OUT, JSON.stringify(ids, null, 0));
  console.log(`wrote ${Object.keys(ids).length} course ids to ${OUT}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
