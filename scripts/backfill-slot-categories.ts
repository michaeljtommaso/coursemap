// scripts/backfill-slot-categories.ts
// Spec 006 §D1 — backfill the optional `category` field onto EVERY program slot
// across all 13 live College-of-Engineering majors (both the 2025 nine and the
// 2026 four), derived from the official flowchart taxonomy via the shared pure
// helper deriveSlotCategory() (cornell-degree-planner/src/lib/planner/slotCategory).
//
// Category set: math | science | core | liberal | elective | fws | pe.
//   - course/pattern slots → by subject (MATH→math, PHYS/CHEM/BIO/…→science,
//     FWIS→fws, PE→pe, everything engineering → core)
//   - elective slots → liberal (liberal-studies group) else elective
//
// This is ADDITIVE and rerunnable (deterministic derivation + set merge). It reads
// live programs/*, so it always covers the current 13 and never touches courses/
// catalog/catalogIndex. Existing slot fields are preserved (the full slots array
// is rewritten with `category` added; merge:true replaces only that array).
//
// Auth:  GOOGLE_APPLICATION_CREDENTIALS = service-account key path.
// Run (dry):   npx tsx backfill-slot-categories.ts --dry-run
// Run (write): npx tsx backfill-slot-categories.ts
//
// SANDBOX NOTE: this session has NO Firebase credentials — the script is shipped
// but NOT executed here. Run it (dry then write) locally against the live project
// as a seed/index/rules follow-up before the browser-verification pass.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  deriveSlotCategory,
  type SlotCategory,
} from "../cornell-degree-planner/src/lib/planner/slotCategory";

const DRY_RUN = process.argv.includes("--dry-run");
const PROJECT_ID = "degree-planner-app";

type RawGroup = {
  id?: string;
  qualifyingRule?: { type?: string; category?: string } | null;
};
type RawSlot = {
  id: string;
  kind: string;
  courseId?: string | null;
  pattern?: string | null;
  electiveGroupId?: string | null;
  category?: string | null;
  [k: string]: unknown;
};

function fail(msg: string): never {
  console.error(`\nBACKFILL ABORTED: ${msg}`);
  process.exit(1);
}

async function main() {
  if (DRY_RUN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail(
      "even --dry-run reads live programs/* to report real category counts — set GOOGLE_APPLICATION_CREDENTIALS first."
    );
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key.");
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const snap = await db.collection("programs").get();
  if (snap.empty) fail("no programs/* docs found");

  console.log(`\n── backfill-slot-categories (${DRY_RUN ? "DRY RUN" : "WRITE"}) ──`);
  console.log(`   target project: ${PROJECT_ID}`);
  console.log(`   programs found: ${snap.size}`);

  const totals: Record<SlotCategory, number> = {
    math: 0, science: 0, core: 0, liberal: 0, elective: 0, fws: 0, pe: 0,
  };

  let batch = db.batch();
  let ops = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const groupsById = new Map<string, RawGroup>(
      ((data.electiveGroups as RawGroup[]) ?? []).map((g) => [g.id ?? "", g])
    );
    const slots = (data.slots as RawSlot[]) ?? [];
    const perProgram: Record<SlotCategory, number> = {
      math: 0, science: 0, core: 0, liberal: 0, elective: 0, fws: 0, pe: 0,
    };

    const nextSlots = slots.map((s) => {
      const group = s.electiveGroupId ? groupsById.get(s.electiveGroupId) : null;
      const category = deriveSlotCategory(s, group);
      perProgram[category]++;
      totals[category]++;
      return { ...s, category };
    });

    const summary = (Object.keys(perProgram) as SlotCategory[])
      .filter((k) => perProgram[k] > 0)
      .map((k) => `${k} ${perProgram[k]}`)
      .join("  ");
    console.log(`     ${d.id.padEnd(26)} slots ${String(slots.length).padStart(3)}   ${summary}`);

    if (!DRY_RUN) {
      batch.set(
        db.collection("programs").doc(d.id),
        { slots: nextSlots, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      if (++ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }

  console.log(
    "\n   category totals:",
    (Object.keys(totals) as SlotCategory[]).map((k) => `${k}=${totals[k]}`).join("  ")
  );

  if (DRY_RUN) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }
  if (ops > 0) await batch.commit();
  console.log(`\nBACKFILL COMPLETE — categorized slots across ${snap.size} programs/*.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
