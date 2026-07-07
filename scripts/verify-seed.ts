// scripts/verify-seed.ts
// Admin SDK spot-check of the seeded Firestore state (docs/specs/002 §10 verify).
// Run: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx verify-seed.ts

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "degree-planner-app";

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("GOOGLE_APPLICATION_CREDENTIALS unset.");
    process.exit(1);
  }
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  let ok = true;

  // Collection counts
  for (const [name, expected] of [
    ["courses", 50],
    ["programs", 4],
    ["catalogIndex", 1],
  ] as const) {
    const snap = await db.collection(name).count().get();
    const got = snap.data().count;
    const pass = got === expected;
    if (!pass) ok = false;
    console.log(`  ${name.padEnd(14)} count ${got} (expected ${expected}) ${pass ? "OK" : "MISMATCH"}`);
  }

  // programs/cornell-cs-bs-2026 → slots ≈ 40
  const cs = await db.doc("programs/cornell-cs-bs-2026").get();
  const csData = cs.data();
  const slotsLen = csData?.slots?.length ?? 0;
  const edgesLen = csData?.edges?.length ?? 0;
  const slotsOk = slotsLen >= 38 && slotsLen <= 42;
  if (!slotsOk) ok = false;
  console.log(`  programs/cornell-cs-bs-2026: slots ${slotsLen} (~40) ${slotsOk ? "OK" : "MISMATCH"}, edges ${edgesLen}`);

  // catalog/meta
  const meta = await db.doc("catalog/meta").get();
  const aliasCount = Object.keys(meta.data()?.aliases ?? {}).length;
  console.log(`  catalog/meta: aliases ${aliasCount} (expected 4) ${aliasCount === 4 ? "OK" : "MISMATCH"}`);
  if (aliasCount !== 4) ok = false;

  // CS-2110 has a nested prereqExpr
  const cs2110 = await db.doc("courses/CS-2110").get();
  const prereq = cs2110.data()?.prereqExpr;
  const nested = prereq && typeof prereq === "object" && "type" in prereq;
  if (!nested) ok = false;
  console.log(`  courses/CS-2110.prereqExpr nested object: ${nested ? "OK" : "MISSING"} → ${JSON.stringify(prereq)}`);

  // Spot-check a deep AND tree survived (CS-3410)
  const cs3410 = await db.doc("courses/CS-3410").get();
  const p3410 = cs3410.data()?.prereqExpr;
  const deep = p3410?.type === "and" && Array.isArray(p3410?.children) && p3410.children.length === 2;
  if (!deep) ok = false;
  console.log(`  courses/CS-3410.prereqExpr AND(2 children): ${deep ? "OK" : "MISSING"} → ${JSON.stringify(p3410)}`);

  // A course-kind slot carries its denormalized snapshot
  const firstCourseSlot = (csData?.slots ?? []).find((s: any) => s.kind === "course");
  const snapOk = firstCourseSlot?.courseTitle && firstCourseSlot?.creditsMin != null;
  console.log(`  CS first course-slot snapshot: ${snapOk ? "OK" : "MISSING"} → ${JSON.stringify({ id: firstCourseSlot?.id, courseTitle: firstCourseSlot?.courseTitle, creditsMin: firstCourseSlot?.creditsMin })}`);
  if (!snapOk) ok = false;

  console.log(ok ? "\nALL SPOT-CHECKS PASS." : "\nSPOT-CHECK FAILURES — investigate.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
