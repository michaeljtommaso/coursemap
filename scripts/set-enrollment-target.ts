// scripts/set-enrollment-target.ts
// Sets (or clears) catalog/meta.enrollmentTarget — the single app-level roster
// slug ("FA26") naming the semester students are currently enrolling for
// (spec 012 §1). This value drives the near/far time-horizon: near-horizon
// cards show instructor/times/open-status; far cards honestly omit them.
//
// Touches ONLY the enrollmentTarget field on catalog/meta — no other field.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx set-enrollment-target.ts FA26           (DRY RUN — report only)
//   npx tsx set-enrollment-target.ts FA26 --apply   (LIVE — set the target)
//   npx tsx set-enrollment-target.ts --clear         (DRY RUN — report clear)
//   npx tsx set-enrollment-target.ts --clear --apply (LIVE — clear the target)

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const CLEAR = process.argv.includes("--clear");
const PROJECT_ID = "degree-planner-app";

// Roster slug shape — must mirror parseRosterSlug in src/lib/planner/horizon.ts
// (known 2-letter term + 2-digit year). A malformed slug would silently read as
// "no target" in the app, so reject it here rather than write garbage.
const SLUG_RE = /^(FA|SP|SU|WI)\d{2}$/;

function fail(msg: string): never {
  console.error(`\nSET-ENROLLMENT-TARGET ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account " +
        "key (never commit or echo that file)."
    );
  }

  // The first non-flag argument is the slug (ignored when --clear is given).
  const slugArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

  if (!CLEAR) {
    if (!slugArg) {
      fail("No roster slug given. Pass a slug like FA26, or --clear to unset.");
    }
    if (!SLUG_RE.test(slugArg)) {
      fail(`"${slugArg}" is not a valid roster slug (expected e.g. FA26 / SP27).`);
    }
  }

  const target = CLEAR ? null : slugArg!;
  console.log(
    `\n── set-enrollment-target (${APPLY ? "APPLY" : "DRY RUN"}) — project ${PROJECT_ID} ──`
  );
  console.log(`   action: ${CLEAR ? "CLEAR enrollmentTarget" : `set enrollmentTarget = "${target}"`}`);

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const ref = db.collection("catalog").doc("meta");

  const snap = await ref.get();
  if (!snap.exists) fail("catalog/meta not found — nothing to update.");
  const current = snap.get("enrollmentTarget");
  console.log(`   current enrollmentTarget:      ${current == null ? "(unset)" : `"${current}"`}`);

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to ${CLEAR ? "clear" : `set "${target}"`}.`
    );
    return;
  }

  // Touch ONLY enrollmentTarget — merge:true leaves every sibling field intact.
  await ref.set(
    { enrollmentTarget: CLEAR ? FieldValue.delete() : target },
    { merge: true }
  );

  console.log(`\n── APPLIED ──`);
  console.log(
    CLEAR
      ? "   cleared catalog/meta.enrollmentTarget."
      : `   catalog/meta.enrollmentTarget = "${target}".`
  );
  console.log(`\nSET-ENROLLMENT-TARGET COMPLETE.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
