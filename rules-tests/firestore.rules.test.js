// Firestore rules deny-matrix (docs/specs/002 §8b).
// Run: cd rules-tests && npm run test:rules   (needs Java; firebase-tools boots
// the emulator via `emulators:exec`, which sets FIRESTORE_EMULATOR_HOST).
//
// Covers the non-negotiable deny matrix plus the happy paths. `shares` is OMITTED
// from the rules until spec 005, so here we assert /shares is fully default-denied.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "degree-planner-app";

let testEnv;

const ALICE = "alice-uid";
const BOB = "bob-uid";

function validPlan(overrides = {}) {
  return {
    name: "My Plan",
    programId: "cornell-cs-bs-2026",
    slotSelections: { "cs-s1-math1910": "MATH-1910" },
    completedSlotIds: [],
    waivedSlotIds: [],
    courseSnapshots: {},
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
function validProfile(overrides = {}) {
  return {
    createdAt: new Date(),
    displayName: null,
    authProvider: "anonymous",
    prefs: { theme: "light" },
    activePlanId: null,
    importedLocalPlan: false,
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed catalog + a plan with admin (rules bypassed) so read paths have data.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "courses/CS-2110"), { id: "CS-2110", title: "OOP" });
    await setDoc(doc(db, "programs/cornell-cs-bs-2026"), { id: "cornell-cs-bs-2026" });
    await setDoc(doc(db, "catalog/meta"), { seedVersion: 1 });
    await setDoc(doc(db, "catalogIndex/chunk-000"), { records: [] });
    await setDoc(doc(db, `users/${ALICE}/plans/existing`), validPlan());
    await setDoc(doc(db, `users/${ALICE}`), validProfile());
  });
});

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}
function unauthed() {
  return testEnv.unauthenticatedContext().firestore();
}

// ── HAPPY PATHS ──────────────────────────────────────────────────────────────
test("public read: anyone reads courses", async () => {
  await assertSucceeds(getDoc(doc(unauthed(), "courses/CS-2110")));
});
test("public read: anyone reads programs / catalog / catalogIndex", async () => {
  const db = unauthed();
  await assertSucceeds(getDoc(doc(db, "programs/cornell-cs-bs-2026")));
  await assertSucceeds(getDoc(doc(db, "catalog/meta")));
  await assertSucceeds(getDoc(doc(db, "catalogIndex/chunk-000")));
});
test("self write: owner creates a valid plan", async () => {
  await assertSucceeds(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p1`), validPlan())
  );
});
test("self write: owner creates a valid profile", async () => {
  await assertSucceeds(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile())
  );
});
test("self read: owner reads own plan and profile", async () => {
  const db = authed(ALICE);
  await assertSucceeds(getDoc(doc(db, `users/${ALICE}/plans/existing`)));
  await assertSucceeds(getDoc(doc(db, `users/${ALICE}`)));
});
test("self delete: owner deletes own plan", async () => {
  await assertSucceeds(
    deleteDoc(doc(authed(ALICE), `users/${ALICE}/plans/existing`))
  );
});
// Exercises the exact PARTIAL patch services/plans.ts updatePlan() emits (only
// the mutable fields + updatedAt) — the merged doc still satisfies hasOnly.
test("self write: owner partial-updates own plan (updatePlan shape)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}/plans/existing`), {
      slotSelections: { "cs-s1-math1910": "MATH-1910", "cs-s2-cs2110": "CS-2110" },
      completedSlotIds: ["cs-s1-math1910"],
      courseSnapshots: { "CS-2110": { id: "CS-2110" } },
      updatedAt: new Date(),
    })
  );
});
// Exercises the profile patch services/profile.ts updateProfile() emits during
// the localStorage import (activePlanId + importedLocalPlan).
test("self write: owner partial-updates own profile (import shape)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), {
      activePlanId: "some-plan-id",
      importedLocalPlan: true,
    })
  );
});

// ── DENY MATRIX ──────────────────────────────────────────────────────────────
test("DENY: cross-uid plan read", async () => {
  await assertFails(getDoc(doc(authed(BOB), `users/${ALICE}/plans/existing`)));
});
test("DENY: cross-uid plan write", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${ALICE}/plans/p2`), validPlan())
  );
});
test("DENY: cross-uid profile read", async () => {
  await assertFails(getDoc(doc(authed(BOB), `users/${ALICE}`)));
});
test("DENY: unauthenticated plan read", async () => {
  await assertFails(getDoc(doc(unauthed(), `users/${ALICE}/plans/existing`)));
});
test("DENY: profile with an extra (non-allowlisted) key", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ role: "admin" }))
  );
});
test("DENY: oversized displayName (>80)", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ displayName: "x".repeat(81) }))
  );
});
test("DENY: plan with extra (non-allowlisted) key", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p3`), validPlan({ hacked: true }))
  );
});
test("DENY: oversized plan name (>80)", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p4`), validPlan({ name: "y".repeat(81) }))
  );
});
test("DENY: oversized slotSelections map (>120)", async () => {
  const big = {};
  for (let i = 0; i < 121; i++) big[`slot-${i}`] = "CS-2110";
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p5`), validPlan({ slotSelections: big }))
  );
});
test("DENY: oversized courseSnapshots map (>150)", async () => {
  const big = {};
  for (let i = 0; i < 151; i++) big[`C-${i}`] = { id: `C-${i}` };
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p6`), validPlan({ courseSnapshots: big }))
  );
});
test("DENY: oversized completedSlotIds array (>150)", async () => {
  const big = Array.from({ length: 151 }, (_, i) => `slot-${i}`);
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p7`), validPlan({ completedSlotIds: big }))
  );
});
test("DENY: client write to catalog collections (Admin-SDK-only)", async () => {
  const db = authed(ALICE);
  await assertFails(setDoc(doc(db, "courses/CS-9999"), { id: "CS-9999" }));
  await assertFails(setDoc(doc(db, "programs/hack"), { id: "hack" }));
  await assertFails(setDoc(doc(db, "catalog/meta"), { seedVersion: 999 }));
  await assertFails(setDoc(doc(db, "catalogIndex/chunk-999"), { records: [] }));
});
test("DENY: /shares is fully denied (omitted until spec 005)", async () => {
  const db = authed(ALICE);
  await assertFails(getDoc(doc(db, "shares/abc")));
  await assertFails(
    setDoc(doc(db, "shares/abc"), { createdBy: ALICE, programId: "x" })
  );
});
test("DENY: arbitrary top-level collection (default deny)", async () => {
  const db = authed(ALICE);
  await assertFails(getDoc(doc(db, "secrets/x")));
  await assertFails(setDoc(doc(db, "secrets/x"), { a: 1 }));
});
