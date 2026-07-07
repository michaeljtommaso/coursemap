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
  writeBatch,
  serverTimestamp,
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
// ── schemaVersion 2 mutability fields (spec 005 §9) ──
test("ALLOW: plan with slotOverrides + customSlots (v2 shape)", async () => {
  await assertSucceeds(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/v2a`),
      validPlan({
        slotOverrides: { "cs-s1-fwis": { removed: true }, "cs-s1-pe": { sem: 3 } },
        customSlots: [{ id: "cus-1", sem: 2, title: "Music elective" }],
        schemaVersion: 2,
      })
    )
  );
});
test("DENY: oversized slotOverrides map (>80)", async () => {
  const big = {};
  for (let i = 0; i < 81; i++) big[`slot-${i}`] = { removed: true };
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/v2b`), validPlan({ slotOverrides: big }))
  );
});
test("DENY: oversized customSlots array (>40)", async () => {
  const big = Array.from({ length: 41 }, (_, i) => ({ id: `cus-${i}`, sem: 1 }));
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/v2c`), validPlan({ customSlots: big }))
  );
});

test("DENY: client write to catalog collections (Admin-SDK-only)", async () => {
  const db = authed(ALICE);
  await assertFails(setDoc(doc(db, "courses/CS-9999"), { id: "CS-9999" }));
  await assertFails(setDoc(doc(db, "programs/hack"), { id: "hack" }));
  await assertFails(setDoc(doc(db, "catalog/meta"), { seedVersion: 999 }));
  await assertFails(setDoc(doc(db, "catalogIndex/chunk-999"), { records: [] }));
});
// ── shares (spec 005 §5 + rate limit, spec 002 §8c) ──
function validShare(overrides = {}) {
  return {
    createdBy: ALICE,
    createdAt: serverTimestamp(), // rules: must equal request.time
    planName: "CS",
    programId: "cornell-cs-bs-2026",
    programName: "Computer Science, B.S.",
    enteringYear: 2026,
    slotSelections: {},
    completedSlotIds: ["cs-s1-math1910"],
    waivedSlotIds: [],
    courseSnapshots: {},
    slotOverrides: {},
    customSlots: [],
    schemaVersion: 2,
    ...overrides,
  };
}
// The sanctioned create path: share + lastShareAt stamp in one atomic batch
// (mirrors services/shares.ts createShare).
function shareBatchCommit(db, uid, shareId, data) {
  const b = writeBatch(db);
  b.set(doc(db, `shares/${shareId}`), data);
  b.update(doc(db, `users/${uid}`), { lastShareAt: serverTimestamp() });
  return b.commit();
}

test("ALLOW: batched share create (stamp + share); ANYONE can read it", async () => {
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s1", validShare()));
  await assertSucceeds(getDoc(doc(unauthed(), "shares/s1")));
});
test("DENY: share create WITHOUT the lastShareAt batch stamp (rate-limit bypass)", async () => {
  await assertFails(setDoc(doc(authed(ALICE), "shares/s-plain"), validShare()));
});
test("DENY: share create inside the 30s cooldown", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastShareAt: new Date() });
  });
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-fast", validShare()));
});
test("ALLOW: share create after the cooldown has passed", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), {
      lastShareAt: new Date(Date.now() - 60_000),
    });
  });
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s-later", validShare()));
});
test("DENY: share with forged createdBy (even batched)", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${BOB}`), validProfile());
  });
  await assertFails(shareBatchCommit(authed(BOB), BOB, "s-forged", validShare()));
});
test("DENY: share with a forged (client-set) createdAt", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-time", validShare({ createdAt: new Date() }))
  );
});
test("DENY: share update/delete after create (immutable)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(shareBatchCommit(db, ALICE, "s-imm", validShare()));
  await assertFails(updateDoc(doc(db, "shares/s-imm"), { planName: "edited" }));
  await assertFails(deleteDoc(doc(db, "shares/s-imm")));
});
test("DENY: share with extra keys", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-extra", validShare({ hacked: true }))
  );
});
test("DENY: forging lastShareAt to a past time on the profile", async () => {
  await assertFails(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), {
      lastShareAt: new Date(Date.now() - 120_000),
    })
  );
});

test("DENY: arbitrary top-level collection (default deny)", async () => {
  const db = authed(ALICE);
  await assertFails(getDoc(doc(db, "secrets/x")));
  await assertFails(setDoc(doc(db, "secrets/x"), { a: 1 }));
});
