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
  arrayUnion,
  deleteField,
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
    // inProgressSlotIds intentionally OMITTED from the default fixture — the
    // whole suite thus exercises the "old plan doc, field absent" shape by
    // default (spec 006 §B.5 additive-migration guarantee); tests below that
    // specifically target the new field pass it via overrides.
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
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p1`), validNewPlan())
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
  const db = authed(ALICE);
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/upd`), validNewPlan()));
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/upd`), {
      placements: [
        { id: "pl-1", courseId: "MATH-1910", sem: 1, order: 0 },
        { id: "pl-2", courseId: "CS-2110", sem: 2, order: 0 },
      ],
      completedIds: ["pl-1"],
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
// ── favoriteCourseIds (spec 006 §E4) — additive profile field, cap 200 ──
test("ALLOW: profile with favoriteCourseIds (new field, valid)", async () => {
  await assertSucceeds(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ favoriteCourseIds: ["CS-2110", "MATH-1910"] }))
  );
});
test("ALLOW: toggle a favorite via arrayUnion (the toggleFavorite path)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), { favoriteCourseIds: arrayUnion("CS-2110") })
  );
});
test("DENY: oversized favoriteCourseIds array (>200)", async () => {
  const big = Array.from({ length: 201 }, (_, i) => `C-${i}`);
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ favoriteCourseIds: big }))
  );
});
test("DENY: wrong-type favoriteCourseIds (not a list)", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ favoriteCourseIds: 42 }))
  );
});
test("ALLOW: profile without favoriteCourseIds still writes (old-doc pass-through)", async () => {
  await assertSucceeds(setDoc(doc(authed(BOB), `users/${BOB}`), validProfile()));
});

// ── pinnedCourseIds (spec 013 §2) — additive profile field, cap 8 ──
test("ALLOW: profile with pinnedCourseIds (new field, valid)", async () => {
  await assertSucceeds(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ pinnedCourseIds: ["CS-2110", "MATH-1910"] }))
  );
});
test("ALLOW: toggle a pin via arrayUnion (the togglePin path)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), { pinnedCourseIds: arrayUnion("CS-2110") })
  );
});
test("DENY: oversized pinnedCourseIds array (>8)", async () => {
  const big = Array.from({ length: 9 }, (_, i) => `C-${i}`);
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ pinnedCourseIds: big }))
  );
});
test("DENY: wrong-type pinnedCourseIds (not a list)", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ pinnedCourseIds: 42 }))
  );
});

// ── creditProfile (spec 007 §2) — AP/IB/transfer/placement, cap 60 ──
test("ALLOW: profile create with a valid creditProfile array", async () => {
  await assertSucceeds(
    setDoc(
      doc(authed(BOB), `users/${BOB}`),
      validProfile({
        creditProfile: [
          {
            id: "ap-calc-bc-5",
            kind: "ap",
            label: "AP Calculus BC (5)",
            satisfiesCourseIds: ["MATH-1910"],
            credits: 4,
          },
        ],
      })
    )
  );
});
test("ALLOW: profile update with a valid creditProfile array", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), {
      creditProfile: [
        {
          id: "ap-cs-a-5",
          kind: "ap",
          label: "AP Computer Science A (5)",
          satisfiesCourseIds: ["CS-1110"],
          credits: 4,
        },
      ],
    })
  );
});
test("DENY: oversized creditProfile array (>60)", async () => {
  const big = Array.from({ length: 61 }, (_, i) => ({
    id: `entry-${i}`,
    kind: "transfer",
    label: `Transfer ${i}`,
    satisfiesCourseIds: [],
  }));
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ creditProfile: big }))
  );
});
test("DENY: wrong-type creditProfile (not a list)", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ creditProfile: "not-a-list" }))
  );
});
test("DENY: unknown profile key alongside a valid creditProfile (allowlist intact)", async () => {
  await assertFails(
    setDoc(
      doc(authed(BOB), `users/${BOB}`),
      validProfile({
        creditProfile: [
          {
            id: "ap-calc-bc-5",
            kind: "ap",
            label: "AP Calculus BC (5)",
            satisfiesCourseIds: ["MATH-1910"],
          },
        ],
        role: "admin",
      })
    )
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
test("DENY (014 CONTRACT): retired v2 slot-shape plan (slotOverrides + customSlots)", async () => {
  await assertFails(
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

// ── "in progress" manual state (spec 006 §B.1/§B.5) — purely additive ──
test("DENY (014 CONTRACT): retired inProgressSlotIds field on a plan", async () => {
  await assertFails(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/ip1`),
      validPlan({ inProgressSlotIds: ["cs-s2-cs2110"] })
    )
  );
});
test("DENY: oversized inProgressSlotIds array (>150)", async () => {
  const big = Array.from({ length: 151 }, (_, i) => `slot-${i}`);
  await assertFails(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/ip2`),
      validPlan({ inProgressSlotIds: big })
    )
  );
});
// A number has no .size() — evaluating the cap check throws, which Firestore
// rules treat as a failed condition (denied), not a bypass. A string was
// deliberately avoided here since strings also expose .size() (char length)
// and would slip past this particular check.
test("DENY: wrong-type inProgressSlotIds (not a list)", async () => {
  await assertFails(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/ip3`),
      validPlan({ inProgressSlotIds: 42 })
    )
  );
});
// The default validPlan() fixture omits inProgressSlotIds entirely — every
// happy-path test above (create/read/partial-update) already proves an "old
// doc" without the field passes through unchanged. This test makes that
// guarantee explicit for the plan doc case.
test("ALLOW: a new-shape plan writes and accepts a name-only update (rename)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/ip4`), validNewPlan()));
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/ip4`), { name: "Renamed", updatedAt: new Date() })
  );
});

// ── spec 014: course-PLACEMENT plan shape (schemaVersion 3) — CONTRACT (new shape only) ──
// After the CONTRACT step the rules accept ONLY the placement shape; the
// old slot-shape fixtures above now assert denial. Caps mirror schemas.ts PlanSchema (80 each).
function validNewPlan(overrides = {}) {
  return {
    name: "My Plan",
    programId: "cornell-cs-bs-2026",
    placements: [
      { id: "p-1910", courseId: "MATH-1910", sem: 1, order: 0 },
      { id: "p-2110", courseId: "CS-2110", sem: 3, order: 0 },
    ],
    courseSnapshots: {
      "MATH-1910": { id: "MATH-1910", subject: "MATH", number: "1910", title: "Calc", creditsMin: 4, creditsMax: 4 },
      "CS-2110": { id: "CS-2110", subject: "CS", number: "2110", title: "OOP", creditsMin: 3, creditsMax: 3 },
    },
    completedIds: ["p-1910"],
    inProgressIds: [],
    waivedRequirementIds: ["cs-fws"],
    schemaVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
const ids = (n, prefix = "x") => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

test("ALLOW (014): owner creates a new-shape placement plan", async () => {
  await assertSucceeds(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n1`), validNewPlan())
  );
});
test("ALLOW (014): owner creates an EMPTY new-shape plan (createPlan defaults)", async () => {
  await assertSucceeds(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/n1e`),
      validNewPlan({ placements: [], courseSnapshots: {}, completedIds: [], waivedRequirementIds: [] })
    )
  );
});
test("ALLOW (014): owner content-update + rename of a new-shape plan (updatePlan shape)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/n2`), validNewPlan()));
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/n2`), {
      placements: [{ id: "p-2110", courseId: "CS-2110", sem: 4, order: 0 }],
      courseSnapshots: { "CS-2110": { id: "CS-2110" } },
      completedIds: [],
      inProgressIds: ["p-2110"],
      waivedRequirementIds: [],
      schemaVersion: 3,
      updatedAt: new Date(),
    })
  );
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/n2`), { name: "Renamed", updatedAt: new Date() })
  );
});
test("ALLOW (014): a legacy (old-shape) doc upgrades in place when the write deletes the old fields", async () => {
  // Exactly what services/plans.ts updatePlan sends for a content write.
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}/plans/existing`), {
      placements: [{ id: "p-1910", courseId: "MATH-1910", sem: 1, order: 0 }],
      courseSnapshots: { "MATH-1910": { id: "MATH-1910" } },
      completedIds: [],
      inProgressIds: [],
      waivedRequirementIds: [],
      schemaVersion: 3,
      slotSelections: deleteField(),
      completedSlotIds: deleteField(),
      waivedSlotIds: deleteField(),
      inProgressSlotIds: deleteField(),
      slotOverrides: deleteField(),
      customSlots: deleteField(),
      updatedAt: new Date(),
    })
  );
});
test("DENY (014): a MIXED doc (old fields kept + new fields added) matches neither shape", async () => {
  await assertFails(
    updateDoc(doc(authed(ALICE), `users/${ALICE}/plans/existing`), {
      placements: [],
      completedIds: [],
      inProgressIds: [],
      waivedRequirementIds: [],
      schemaVersion: 3,
      updatedAt: new Date(),
    })
  );
});
test("DENY (014): placements over the cap (>80)", async () => {
  const big = ids(81, "p").map((id, i) => ({ id, courseId: "CS-2110", sem: 1, order: i }));
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n3`), validNewPlan({ placements: big }))
  );
});
test("ALLOW (014): placements exactly at the cap (80)", async () => {
  const full = ids(80, "p").map((id, i) => ({ id, courseId: "CS-2110", sem: 1 + (i % 8), order: Math.floor(i / 8) }));
  await assertSucceeds(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n3ok`), validNewPlan({ placements: full }))
  );
});
test("DENY (014): completedIds / inProgressIds / waivedRequirementIds over the cap (>80)", async () => {
  const db = authed(ALICE);
  await assertFails(setDoc(doc(db, `users/${ALICE}/plans/n4a`), validNewPlan({ completedIds: ids(81) })));
  await assertFails(setDoc(doc(db, `users/${ALICE}/plans/n4b`), validNewPlan({ inProgressIds: ids(81) })));
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/plans/n4c`), validNewPlan({ waivedRequirementIds: ids(81) }))
  );
});
test("DENY (014): courseSnapshots over the new-shape cap (>80)", async () => {
  const big = {};
  for (let i = 0; i < 81; i++) big[`C-${i}`] = { id: `C-${i}` };
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n5`), validNewPlan({ courseSnapshots: big }))
  );
});
test("DENY (014): new-shape plan with an unknown field", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n6`), validNewPlan({ hacked: true }))
  );
});
test("DENY (014): wrong-type placements (map, not list)", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n7`), validNewPlan({ placements: { a: 1 } }))
  );
});
test("DENY (014): new-shape fields with an old schemaVersion", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/n8`), validNewPlan({ schemaVersion: 2 }))
  );
});
test("DENY (014): another user creates / updates a new-shape plan", async () => {
  await assertFails(setDoc(doc(authed(BOB), `users/${ALICE}/plans/n9`), validNewPlan()));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${ALICE}/plans/n9b`), validNewPlan());
  });
  await assertFails(
    updateDoc(doc(authed(BOB), `users/${ALICE}/plans/n9b`), { placements: [], updatedAt: new Date() })
  );
  await assertFails(getDoc(doc(authed(BOB), `users/${ALICE}/plans/n9b`)));
});
test("DENY (014): unauthenticated new-shape plan write", async () => {
  await assertFails(setDoc(doc(unauthed(), `users/${ALICE}/plans/n10`), validNewPlan()));
});
test("DENY (014 CONTRACT): the OLD slot-shape plan create is rejected", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/old1`), validPlan({ schemaVersion: 2 }))
  );
});

test("DENY: client write to catalog collections (Admin-SDK-only)", async () => {
  const db = authed(ALICE);
  await assertFails(setDoc(doc(db, "courses/CS-9999"), { id: "CS-9999" }));
  await assertFails(setDoc(doc(db, "programs/hack"), { id: "hack" }));
  await assertFails(setDoc(doc(db, "catalog/meta"), { seedVersion: 999 }));
  await assertFails(setDoc(doc(db, "catalogIndex/chunk-999"), { records: [] }));
});

// ── Reviews layer (spec 013 §3, Unit 13B) — public-read, admin-write only ──
// The offline RMP / roster-history pipeline (Admin SDK) is the ONLY writer;
// clients can read but never write, exactly like the catalog collections.
test("public read: anyone reads professorReviews / courseInstructorHistory", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adb = ctx.firestore();
    await setDoc(doc(adb, "professorReviews/al123"), {
      netid: "al123",
      match: { tier: "verified", url: "https://www.ratemyprofessors.com/professor/1" },
      rating: 4.2,
      difficulty: 3.1,
      count: 42,
    });
    await setDoc(doc(adb, "courseInstructorHistory/CS-2110"), {
      courseId: "CS-2110",
      terms: [{ roster: "FA25", instructors: [{ netid: "al123", name: "Ada Lovelace" }] }],
    });
  });
  await assertSucceeds(getDoc(doc(unauthed(), "professorReviews/al123")));
  await assertSucceeds(getDoc(doc(unauthed(), "courseInstructorHistory/CS-2110")));
});
test("DENY: client write to professorReviews (Admin-SDK-only)", async () => {
  const db = authed(ALICE);
  await assertFails(
    setDoc(doc(db, "professorReviews/hax"), {
      netid: "hax",
      match: { tier: "verified", url: "https://x" },
      rating: 5,
      difficulty: 1,
      count: 1,
    })
  );
  // Even an unauthenticated writer is denied.
  await assertFails(setDoc(doc(unauthed(), "professorReviews/hax2"), { netid: "hax2" }));
});
test("DENY: client write to courseInstructorHistory (Admin-SDK-only)", async () => {
  const db = authed(ALICE);
  await assertFails(
    setDoc(doc(db, "courseInstructorHistory/CS-9999"), {
      courseId: "CS-9999",
      terms: [],
    })
  );
  await assertFails(setDoc(doc(unauthed(), "courseInstructorHistory/CS-8888"), { courseId: "x" }));
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
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s1", validNewShare()));
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
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s-later", validNewShare()));
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
  await assertSucceeds(shareBatchCommit(db, ALICE, "s-imm", validNewShare()));
  await assertFails(updateDoc(doc(db, "shares/s-imm"), { planName: "edited" }));
  await assertFails(deleteDoc(doc(db, "shares/s-imm")));
});
test("DENY: share with extra keys", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-extra", validShare({ hacked: true }))
  );
});
// ── "in progress" manual state (spec 006 §B.1/§B.5) — purely additive ──
// The default validShare() fixture omits inProgressSlotIds — every share
// happy-path test above already proves a share snapshot WITHOUT the field
// (i.e. an old, pre-migration snapshot shape) still creates fine. These
// cases target the new field explicitly.
test("DENY (014 CONTRACT): retired slot-shape share WITH inProgressSlotIds", async () => {
  await assertFails(
    shareBatchCommit(
      authed(ALICE),
      ALICE,
      "s-ip1",
      validShare({ inProgressSlotIds: ["cs-s2-cs2110"] })
    )
  );
});
test("DENY: oversized inProgressSlotIds in share (>150)", async () => {
  const big = Array.from({ length: 151 }, (_, i) => `slot-${i}`);
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-ip2", validShare({ inProgressSlotIds: big }))
  );
});
test("DENY: wrong-type inProgressSlotIds in share (not a list)", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-ip3", validShare({ inProgressSlotIds: 42 }))
  );
});

// ── spec 014: placement-shape share snapshots — CONTRACT (new shape only) ──
function validNewShare(overrides = {}) {
  return {
    createdBy: ALICE,
    createdAt: serverTimestamp(), // rules: must equal request.time
    planName: "CS",
    programId: "cornell-cs-bs-2026",
    programName: "Computer Science, B.S.",
    enteringYear: 2026,
    placements: [{ id: "p-1910", courseId: "MATH-1910", sem: 1, order: 0 }],
    courseSnapshots: { "MATH-1910": { id: "MATH-1910" } },
    completedIds: ["p-1910"],
    inProgressIds: [],
    waivedRequirementIds: [],
    schemaVersion: 3,
    ...overrides,
  };
}
test("ALLOW (014): batched new-shape share create; anyone can read it", async () => {
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s-n1", validNewShare()));
  await assertSucceeds(getDoc(doc(unauthed(), "shares/s-n1")));
});
test("DENY (014 CONTRACT): an OLD slot-shape share create is rejected", async () => {
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-o1", validShare()));
});
test("DENY (014): new-shape share over the cap (placements > 80)", async () => {
  const big = ids(81, "p").map((id, i) => ({ id, courseId: "CS-2110", sem: 1, order: i }));
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-n2", validNewShare({ placements: big }))
  );
});
test("DENY (014): new-shape share over the cap (completedIds > 80)", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-n2b", validNewShare({ completedIds: ids(81) }))
  );
});
test("DENY (014): new-shape share with an unknown field", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-n3", validNewShare({ hacked: true }))
  );
});
test("DENY (014): a MIXED share (old + new fields) matches neither shape", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-n4", validNewShare({ slotSelections: {} }))
  );
});
test("DENY (014): new-shape share with a forged createdBy (even batched)", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${BOB}`), validProfile());
  });
  await assertFails(shareBatchCommit(authed(BOB), BOB, "s-n5", validNewShare()));
});
test("DENY (014): new-shape share inside the 30s cooldown", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastShareAt: new Date() });
  });
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-n6", validNewShare()));
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
