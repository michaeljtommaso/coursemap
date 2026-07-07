// One-off probe: read a user's profile + plans (Admin SDK). Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=<key> npx tsx probe-user.ts <uid>
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS is not set");
  process.exit(1);
}
const uid = process.argv[2];
if (!uid) { console.error("usage: probe-user.ts <uid>"); process.exit(1); }

initializeApp({ credential: applicationDefault(), projectId: "degree-planner-app" });
const db = getFirestore();

async function main() {
  const profile = await db.doc(`users/${uid}`).get();
  console.log("profile exists:", profile.exists);
  if (profile.exists) {
    const d = profile.data()!;
    console.log("profile:", JSON.stringify({
      authProvider: d.authProvider, activePlanId: d.activePlanId,
      importedLocalPlan: d.importedLocalPlan, prefs: d.prefs,
    }));
  }
  const plans = await db.collection(`users/${uid}/plans`).get();
  console.log("plans count:", plans.size);
  for (const p of plans.docs) {
    const d = p.data();
    console.log(`plan ${p.id}:`, JSON.stringify({
      name: d.name, programId: d.programId,
      completedSlotIds: d.completedSlotIds,
      slotSelections: d.slotSelections,
      waivedCount: (d.waivedSlotIds ?? []).length,
      snapshotCount: Object.keys(d.courseSnapshots ?? {}).length,
      schemaVersion: d.schemaVersion,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.(),
    }));
  }
}
main();
