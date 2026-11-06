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
  FieldPath,
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
    setDoc(doc(authed(BOB), `users/${ALICE}/plans/p2`), validNewPlan())
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
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p3`), validNewPlan({ hacked: true }))
  );
});
test("DENY: oversized plan name (>80)", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/p4`), validNewPlan({ name: "y".repeat(81) }))
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
// ── "in progress" manual state (spec 006 §B.1/§B.5) — purely additive ──
test("DENY (014 CONTRACT): retired inProgressSlotIds field on a plan", async () => {
  await assertFails(
    setDoc(
      doc(authed(ALICE), `users/${ALICE}/plans/ip1`),
      validPlan({ inProgressSlotIds: ["cs-s2-cs2110"] })
    )
  );
});
// A number has no .size() — evaluating the cap check throws, which Firestore
// rules treat as a failed condition (denied), not a bypass. A string was
// deliberately avoided here since strings also expose .size() (char length)
// and would slip past this particular check.
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
  await assertFails(setDoc(doc(authed(ALICE), "shares/s-plain"), validNewShare()));
});
test("DENY: share create inside the 30s cooldown", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastShareAt: new Date() });
  });
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-fast", validNewShare()));
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
  await assertFails(shareBatchCommit(authed(BOB), BOB, "s-forged", validNewShare()));
});
test("DENY: share with a forged (client-set) createdAt", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-time", validNewShare({ createdAt: new Date() }))
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
    shareBatchCommit(authed(ALICE), ALICE, "s-extra", validNewShare({ hacked: true }))
  );
});
// ── retired slot-shape share fields (spec 014 CONTRACT) ──
// validShare() is the pre-014 slot-shape fixture; after CONTRACT every share
// write must be the placement shape, so these old-shape cases assert denial.
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

// ── layers (spec 019) — public-read, admin-write only, like programs ──
test("public read: anyone reads layers", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "layers/cas-college-2025"), { id: "cas-college-2025", rows: [] });
  });
  await assertSucceeds(getDoc(doc(unauthed(), "layers/cas-college-2025")));
});
test("DENY: client write to layers (Admin-SDK-only)", async () => {
  await assertFails(setDoc(doc(authed(ALICE), "layers/hack"), { id: "hack", rows: [] }));
  await assertFails(setDoc(doc(unauthed(), "layers/hack2"), { id: "hack2" }));
});

// ── requirementReports (spec 019 D15) — create-only, 1 per 10s per user ──
const GUEST = "guest-uid";
function guest() {
  return testEnv
    .authenticatedContext(GUEST, { firebase: { sign_in_provider: "anonymous" } })
    .firestore();
}
function google(uid) {
  return testEnv
    .authenticatedContext(uid, { firebase: { sign_in_provider: "google.com" } })
    .firestore();
}
function validReport(uid, overrides = {}) {
  return {
    uid,
    programId: "cas-english-ba",
    layer: "cas-college-2025",
    rowId: "fws",
    note: "FWS should count here",
    createdAt: serverTimestamp(), // rules: must equal request.time
    ...overrides,
  };
}
// The sanctioned create path: report + lastReportAt stamp in one atomic batch
// (mirrors services/reports.ts submitRequirementReport).
function reportBatchCommit(db, uid, reportId, data) {
  const b = writeBatch(db);
  b.set(doc(db, `requirementReports/${reportId}`), data);
  b.update(doc(db, `users/${uid}`), { lastReportAt: serverTimestamp() });
  return b.commit();
}
async function seedProfile(uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${uid}`), validProfile(overrides));
  });
}

test("ALLOW: an anonymous guest creates a batched report", async () => {
  await seedProfile(GUEST);
  await assertSucceeds(reportBatchCommit(guest(), GUEST, "r-guest", validReport(GUEST)));
});
test("ALLOW: a Google user creates a batched report (no note)", async () => {
  await seedProfile(BOB, { authProvider: "google" });
  const { note: _omit, ...noNote } = validReport(BOB);
  await assertSucceeds(reportBatchCommit(google(BOB), BOB, "r-google", noNote));
});
test("ALLOW: a note exactly at the cap (500)", async () => {
  await assertSucceeds(
    reportBatchCommit(authed(ALICE), ALICE, "r-500", validReport(ALICE, { note: "n".repeat(500) }))
  );
});
test("DENY: report with a forged uid (even batched)", async () => {
  await seedProfile(BOB);
  await assertFails(reportBatchCommit(authed(BOB), BOB, "r-forged", validReport(ALICE)));
});
test("DENY: report with an extra key", async () => {
  await assertFails(
    reportBatchCommit(authed(ALICE), ALICE, "r-extra", validReport(ALICE, { hacked: true }))
  );
});
test("DENY: report missing a required key (rowId)", async () => {
  const { rowId: _omit, ...noRow } = validReport(ALICE);
  await assertFails(reportBatchCommit(authed(ALICE), ALICE, "r-norow", noRow));
});
test("DENY: report note over the cap (>500)", async () => {
  await assertFails(
    reportBatchCommit(authed(ALICE), ALICE, "r-501", validReport(ALICE, { note: "n".repeat(501) }))
  );
});
test("DENY: report with a wrong-type note", async () => {
  await assertFails(
    reportBatchCommit(authed(ALICE), ALICE, "r-note-num", validReport(ALICE, { note: 42 }))
  );
});
test("DENY: report programId over the cap (>80) / layer and rowId over 120", async () => {
  const db = authed(ALICE);
  await assertFails(
    reportBatchCommit(db, ALICE, "r-prog", validReport(ALICE, { programId: "p".repeat(81) }))
  );
  await assertFails(
    reportBatchCommit(db, ALICE, "r-layer", validReport(ALICE, { layer: "l".repeat(121) }))
  );
  await assertFails(
    reportBatchCommit(db, ALICE, "r-row", validReport(ALICE, { rowId: "r".repeat(121) }))
  );
});
test("DENY: report with an empty rowId", async () => {
  await assertFails(reportBatchCommit(authed(ALICE), ALICE, "r-empty", validReport(ALICE, { rowId: "" })));
});
test("DENY: report with a forged (client-set) createdAt", async () => {
  await assertFails(
    reportBatchCommit(authed(ALICE), ALICE, "r-time", validReport(ALICE, { createdAt: new Date() }))
  );
});
test("DENY: report WITHOUT the lastReportAt batch stamp (rate-limit bypass)", async () => {
  await assertFails(setDoc(doc(authed(ALICE), "requirementReports/r-plain"), validReport(ALICE)));
});
test("DENY: unauthenticated report", async () => {
  await assertFails(setDoc(doc(unauthed(), "requirementReports/r-anon"), validReport(ALICE)));
});
test("DENY: a second report inside the 10s cooldown", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastReportAt: new Date() });
  });
  await assertFails(reportBatchCommit(authed(ALICE), ALICE, "r-fast", validReport(ALICE)));
});
test("DENY: two reports back to back (the second hits the cooldown)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(reportBatchCommit(db, ALICE, "r-first", validReport(ALICE)));
  await assertFails(reportBatchCommit(db, ALICE, "r-second", validReport(ALICE)));
});
test("DENY: deleting your own profile (no client delete; it would reset the rate-limit stamps)", async () => {
  await assertFails(deleteDoc(doc(authed(ALICE), `users/${ALICE}`)));
});
test("DENY: delete-then-recreate the profile to dodge the report cooldown", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastReportAt: new Date() });
  });
  const db = authed(ALICE);
  await assertFails(deleteDoc(doc(db, `users/${ALICE}`)));
  await assertFails(reportBatchCommit(db, ALICE, "r-dodge", validReport(ALICE)));
});
test("ALLOW: a report after the cooldown has passed", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), {
      lastReportAt: new Date(Date.now() - 11_000),
    });
  });
  await assertSucceeds(reportBatchCommit(authed(ALICE), ALICE, "r-later", validReport(ALICE)));
});
test("ALLOW: the report and share cooldowns are independent", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { lastShareAt: new Date() });
  });
  await assertSucceeds(reportBatchCommit(authed(ALICE), ALICE, "r-indep", validReport(ALICE)));
});
test("DENY: report read / update / delete (create-only)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(reportBatchCommit(db, ALICE, "r-imm", validReport(ALICE)));
  await assertFails(getDoc(doc(db, "requirementReports/r-imm")));
  await assertFails(getDoc(doc(unauthed(), "requirementReports/r-imm")));
  await assertFails(updateDoc(doc(db, "requirementReports/r-imm"), { note: "edited" }));
  await assertFails(deleteDoc(doc(db, "requirementReports/r-imm")));
});
test("DENY: forging lastReportAt on the profile (not request.time)", async () => {
  await assertFails(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), {
      lastReportAt: new Date(Date.now() - 120_000),
    })
  );
});
test("ALLOW: stamping lastReportAt with the server time alone", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), { lastReportAt: serverTimestamp() })
  );
});

// ── spec 020 (ask the student): course marks, student facts, share rule set — EXPAND ──
// Caps mirror schemas.ts MAX_COURSE_MARKS (80) / MAX_FACT_ANSWERS (30) and the
// prefs key cap (services/profile.ts MAX_PREFS_KEYS, 20). Old docs without the
// new fields stay valid (the 014 fixtures above have none).
const marks = (n) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:BIOMI-${4000 + i}`, 3]));
const facts = (n) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`studentFact:honorsProgram:p${i}`, "yes"]));
const FWS_MARK = "usedAs:cas-college/fws@ENGL-2880";

test("ALLOW (020): owner creates a plan with course marks and rewrites the whole map", async () => {
  const db = authed(ALICE);
  await assertSucceeds(
    setDoc(doc(db, `users/${ALICE}/plans/m1`), validNewPlan({ courseMarks: { [FWS_MARK]: "yes" } }))
  );
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/m1`), {
      courseMarks: { [FWS_MARK]: "no", "creditsTaken:BIOMI-4850": 3 },
      updatedAt: new Date(),
    })
  );
});
test("ALLOW (020): owner deletes the marks field when the last mark is cleared", async () => {
  const db = authed(ALICE);
  await assertSucceeds(
    setDoc(doc(db, `users/${ALICE}/plans/m2`), validNewPlan({ courseMarks: { [FWS_MARK]: "yes" } }))
  );
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/m2`), { courseMarks: deleteField(), updatedAt: new Date() })
  );
});
test("ALLOW (020): old-shape plan without courseMarks still creates and updates (expand-first)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/m3`), validNewPlan()));
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/m3`), { completedIds: [], updatedAt: new Date() })
  );
});
test("ALLOW (020): course marks exactly at the cap (80)", async () => {
  await assertSucceeds(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/m4`), validNewPlan({ courseMarks: marks(80) }))
  );
});
test("DENY (020): course marks over the cap (81)", async () => {
  const db = authed(ALICE);
  await assertFails(setDoc(doc(db, `users/${ALICE}/plans/m5`), validNewPlan({ courseMarks: marks(81) })));
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/m5`), validNewPlan()));
  await assertFails(updateDoc(doc(db, `users/${ALICE}/plans/m5`), { courseMarks: marks(81) }));
});
test("DENY (020): wrong-type courseMarks (a list, not a map)", async () => {
  await assertFails(
    setDoc(doc(authed(ALICE), `users/${ALICE}/plans/m6`), validNewPlan({ courseMarks: [FWS_MARK] }))
  );
});
test("DENY (020): another user writes course marks on someone else's plan", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${ALICE}/plans/m7`), validNewPlan());
  });
  await assertFails(
    updateDoc(doc(authed(BOB), `users/${ALICE}/plans/m7`), { courseMarks: { [FWS_MARK]: "yes" } })
  );
  await assertFails(
    setDoc(doc(authed(BOB), `users/${ALICE}/plans/m8`), validNewPlan({ courseMarks: { [FWS_MARK]: "yes" } }))
  );
});

test("ALLOW (020): owner writes student facts as one prefs.answers map (the updatePrefs path)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}`), {
      "prefs.answers": { "studentFact:honorsProgram:cas-linguistics": "yes" },
    })
  );
  await assertSucceeds(updateDoc(doc(db, `users/${ALICE}`), { "prefs.answers": {} }));
});
test("ALLOW (020): student facts exactly at the cap (30)", async () => {
  await assertSucceeds(updateDoc(doc(authed(ALICE), `users/${ALICE}`), { "prefs.answers": facts(30) }));
});
test("DENY (020): student facts over the cap (31)", async () => {
  await assertFails(updateDoc(doc(authed(ALICE), `users/${ALICE}`), { "prefs.answers": facts(31) }));
  await assertFails(
    setDoc(doc(authed(BOB), `users/${BOB}`), validProfile({ prefs: { theme: "light", answers: facts(31) } }))
  );
});
test("ALLOW (020): owner writes one student fact by FieldPath (the answer path) and clears it with deleteField", async () => {
  const db = authed(ALICE);
  const ref = doc(db, `users/${ALICE}`);
  const key = "studentFact:writingSeminar:cas-college/fws@ENGL-2880";
  await assertSucceeds(updateDoc(ref, new FieldPath("prefs", "answers", key), "yes"));
  // A second tab's answer to another key leaves the first one in place.
  await assertSucceeds(
    updateDoc(ref, new FieldPath("prefs", "answers", "studentFact:honorsProgram:cas-linguistics"), "no")
  );
  const after = (await getDoc(ref)).data();
  assert.deepEqual(after.prefs.answers, { [key]: "yes", "studentFact:honorsProgram:cas-linguistics": "no" });
  await assertSucceeds(updateDoc(ref, new FieldPath("prefs", "answers", key), deleteField()));
  assert.deepEqual((await getDoc(ref)).data().prefs.answers, { "studentFact:honorsProgram:cas-linguistics": "no" });
});
test("DENY (020): a one-key student fact that would make 31 answers (the cap holds per key)", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/${ALICE}`), { "prefs.answers": facts(30) });
  });
  const ref = doc(authed(ALICE), `users/${ALICE}`);
  await assertFails(updateDoc(ref, new FieldPath("prefs", "answers", "studentFact:honorsProgram:p30"), "yes"));
  // Changing or clearing an answer at the cap still works.
  await assertSucceeds(updateDoc(ref, new FieldPath("prefs", "answers", "studentFact:honorsProgram:p0"), "no"));
  await assertSucceeds(updateDoc(ref, new FieldPath("prefs", "answers", "studentFact:honorsProgram:p1"), deleteField()));
});
test("DENY (020): wrong-type prefs.answers (a list, not a map)", async () => {
  await assertFails(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), { "prefs.answers": ["studentFact:honorsProgram:x"] })
  );
});
test("DENY (020): another user writes someone else's student facts", async () => {
  await assertFails(
    updateDoc(doc(authed(BOB), `users/${ALICE}`), {
      "prefs.answers": { "studentFact:honorsProgram:cas-linguistics": "yes" },
    })
  );
});
test("ALLOW (020): every prefs key the app writes, together (8 keys, under the cap)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), {
      prefs: {
        theme: "dark",
        enteringYear: 2025,
        entryTerm: "FA25",
        transfer: "none",
        transferStanding: null,
        college: "cas",
        concentration: { programId: "cas-english-ba", ids: ["poetry"] },
        answers: { "studentFact:honorsProgram:cas-linguistics": "yes" },
      },
    })
  );
});
test("ALLOW / DENY (020): prefs key cap — 20 keys accepted, 21 rejected", async () => {
  const keys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
  const db = authed(ALICE);
  await assertSucceeds(updateDoc(doc(db, `users/${ALICE}`), { prefs: keys(20) }));
  await assertFails(updateDoc(doc(db, `users/${ALICE}`), { prefs: keys(21) }));
  await assertFails(updateDoc(doc(db, `users/${ALICE}`), { "prefs.k20": 20 }));
});
test("DENY (020): prefs that is not a map", async () => {
  await assertFails(updateDoc(doc(authed(ALICE), `users/${ALICE}`), { prefs: "light" }));
});
test("ALLOW (020): a profile without prefs.answers still writes (old-doc pass-through)", async () => {
  await assertSucceeds(
    updateDoc(doc(authed(ALICE), `users/${ALICE}`), { "prefs.theme": "dark", activePlanId: "p1" })
  );
});

test("ALLOW (020): share with course marks, college rule set and concentrations", async () => {
  await assertSucceeds(
    shareBatchCommit(
      authed(ALICE),
      ALICE,
      "s-q1",
      validNewShare({
        courseMarks: { [FWS_MARK]: "yes", "creditsTaken:BIOMI-4850": 3 },
        collegeRuleSet: "cals-college-pre2025",
        concentrationIds: ["mcb", "genetics", "neuro"],
      })
    )
  );
  await assertSucceeds(getDoc(doc(unauthed(), "shares/s-q1")));
});
test("ALLOW (020): old-shape share without the new fields (expand-first)", async () => {
  await assertSucceeds(shareBatchCommit(authed(ALICE), ALICE, "s-q2", validNewShare()));
});
test("DENY (020): share with more than 3 concentrationIds", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-q3", validNewShare({ concentrationIds: ["a", "b", "c", "d"] }))
  );
});
test("DENY (020): share course marks over the cap (81) or not a map", async () => {
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-q4", validNewShare({ courseMarks: marks(81) })));
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-q4b", validNewShare({ courseMarks: [FWS_MARK] })));
});
test("DENY (020): share collegeRuleSet over 40 characters, malformed, or not a string", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-q5", validNewShare({ collegeRuleSet: "a".repeat(41) }))
  );
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-q5b", validNewShare({ collegeRuleSet: "CAS College!" }))
  );
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-q5c", validNewShare({ collegeRuleSet: 7 })));
});
test("DENY (020): share carrying personal facts (answers / entryTerm) — shape lock", async () => {
  await assertFails(
    shareBatchCommit(
      authed(ALICE),
      ALICE,
      "s-q6",
      validNewShare({ answers: { "studentFact:honorsProgram:cas-linguistics": "yes" } })
    )
  );
  await assertFails(shareBatchCommit(authed(ALICE), ALICE, "s-q7", validNewShare({ entryTerm: "FA25" })));
});

// ── Spec 028 D12: tried classes on the plan (triedCourseIds, list, <= 20) ────
test("ALLOW (025): plan without triedCourseIds still creates and updates (field absent)", async () => {
  const db = authed(ALICE);
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/t0`), validNewPlan()));
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/t0`), { completedIds: [], updatedAt: new Date() })
  );
});
test("ALLOW (025): plan with triedCourseIds exactly at the cap (20), on create and update", async () => {
  const db = authed(ALICE);
  await assertSucceeds(
    setDoc(doc(db, `users/${ALICE}/plans/t1`), validNewPlan({ triedCourseIds: ids(20, "CS") }))
  );
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/t1`), { triedCourseIds: ["MATH-2930"], updatedAt: new Date() })
  );
  await assertSucceeds(
    updateDoc(doc(db, `users/${ALICE}/plans/t1`), { triedCourseIds: deleteField(), updatedAt: new Date() })
  );
});
test("DENY (025): triedCourseIds over the cap (21), on create and update", async () => {
  const db = authed(ALICE);
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/plans/t2`), validNewPlan({ triedCourseIds: ids(21, "CS") }))
  );
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/plans/t2`), validNewPlan()));
  await assertFails(
    updateDoc(doc(db, `users/${ALICE}/plans/t2`), { triedCourseIds: ids(21, "CS"), updatedAt: new Date() })
  );
});
test("DENY (025): wrong-type triedCourseIds (a map or a string, not a list)", async () => {
  const db = authed(ALICE);
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/plans/t3`), validNewPlan({ triedCourseIds: { "CS-2110": true } }))
  );
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/plans/t3b`), validNewPlan({ triedCourseIds: "CS-2110" }))
  );
});
test("DENY (025): another user writes triedCourseIds on a plan", async () => {
  await assertFails(
    setDoc(doc(authed(BOB), `users/${ALICE}/plans/t4`), validNewPlan({ triedCourseIds: ["CS-2110"] }))
  );
});
test("DENY (025): a share carrying triedCourseIds (tried classes stay out of shares)", async () => {
  await assertFails(
    shareBatchCommit(authed(ALICE), ALICE, "s-t1", validNewShare({ triedCourseIds: ["CS-2110"] }))
  );
});
