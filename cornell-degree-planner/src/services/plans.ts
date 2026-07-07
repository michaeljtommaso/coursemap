import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PlanSchema } from "@/lib/schemas";
import { normalizePlan, type NormalizedPlan } from "@/lib/normalize/normalizePlan";

/**
 * Plans service — the ONLY module that touches Firestore for plan docs (house-standard
 * service-layer contract, docs/specs/002 §5/§6). No raw getDoc/onSnapshot outside
 * services/. Reads: snap.data() → Zod-validate → normalizer. Writes: Zod-validate
 * first, then write; serverTimestamp() is fine on direct SDK writes (never on
 * JSON-serialized values). Listeners DEGRADE to empty + console.warn + an error
 * flag — they never throw (an uncaught onSnapshot error crashes the SDK under
 * StrictMode, spec 002 §5).
 */

export type PlanListItem = {
  id: string;
  name: string;
  programId: string;
};

/** Fields a caller may supply when creating a plan. serverTimestamps + schemaVersion
 *  are stamped here so callers can't set them wrong. */
export type CreatePlanInput = {
  name: string;
  programId: string;
  slotSelections?: Record<string, string>;
  completedSlotIds?: string[];
  waivedSlotIds?: string[];
  courseSnapshots?: Record<string, unknown>;
  slotOverrides?: Record<string, { sem?: number; removed?: true }>;
  customSlots?: { id: string; sem: number; title?: string }[];
};

/** A partial update to a plan doc (client mutations). updatedAt is stamped here. */
export type UpdatePlanPatch = {
  name?: string;
  slotSelections?: Record<string, string>;
  completedSlotIds?: string[];
  waivedSlotIds?: string[];
  courseSnapshots?: Record<string, unknown>;
  slotOverrides?: Record<string, { sem?: number; removed?: true }>;
  customSlots?: { id: string; sem: number; title?: string }[];
  schemaVersion?: number;
};

function plansCol(uid: string) {
  return collection(db, "users", uid, "plans");
}
function planDoc(uid: string, planId: string) {
  return doc(db, "users", uid, "plans", planId);
}

/**
 * Subscribe to the active plan doc. Returns the unsubscribe fn directly. The
 * callback receives the normalized plan, or null when the doc doesn't exist.
 * On a listener error we log + emit an error flag and null the plan — never throw.
 */
export function subscribePlan(
  uid: string,
  planId: string,
  cb: (result: { plan: NormalizedPlan | null; error: boolean }) => void
): () => void {
  return onSnapshot(
    planDoc(uid, planId),
    (snap) => {
      if (!snap.exists()) {
        cb({ plan: null, error: false });
        return;
      }
      try {
        const parsed = PlanSchema.parse(snap.data());
        cb({ plan: normalizePlan(parsed), error: false });
      } catch (err) {
        // A corrupt/oversized doc that somehow slipped past rules: degrade.
        console.warn("[plans] plan doc failed validation; degrading", err);
        cb({ plan: null, error: true });
      }
    },
    (err) => {
      console.warn("[plans] subscribePlan listener error; degrading", err);
      cb({ plan: null, error: true });
    }
  );
}

/**
 * Create a plan doc under a caller-supplied id (planId). Zod-validates the full
 * payload against PlanSchema (UX defense; rules are the real boundary) before
 * writing. createdAt/updatedAt are serverTimestamp() sentinels.
 */
export async function createPlan(
  uid: string,
  planId: string,
  input: CreatePlanInput
): Promise<void> {
  const payload = {
    name: input.name,
    programId: input.programId,
    slotSelections: input.slotSelections ?? {},
    completedSlotIds: input.completedSlotIds ?? [],
    waivedSlotIds: input.waivedSlotIds ?? [],
    courseSnapshots: input.courseSnapshots ?? {},
    slotOverrides: input.slotOverrides ?? {},
    customSlots: input.customSlots ?? [],
    schemaVersion: 2, // v2 = mutability fields (spec 005 §9)
  };
  // Validate the JSON-serializable shape (no serverTimestamps in the parsed
  // object — those are added after, since Zod can't see through the sentinel).
  PlanSchema.parse({ ...payload, createdAt: new Date(), updatedAt: new Date() });
  await setDoc(planDoc(uid, planId), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Patch an existing plan doc. Only the mutable fields are patchable; updatedAt is
 * always refreshed. We validate the patched FIELDS individually against the
 * relevant slice of PlanSchema so an oversized map is caught client-side before
 * the write (rules still enforce authoritatively).
 */
export async function updatePlan(
  uid: string,
  planId: string,
  patch: UpdatePlanPatch
): Promise<void> {
  // Validate just the provided fields against a partial of the plan schema.
  PlanSchema.partial().parse(patch);
  await updateDoc(planDoc(uid, planId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** List a user's plans (id + display metadata) for the plan switcher (spec 004). */
export async function listPlans(uid: string): Promise<PlanListItem[]> {
  const snap = await getDocs(plansCol(uid));
  const items: PlanListItem[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    items.push({
      id: d.id,
      name: typeof data.name === "string" ? data.name : d.id,
      programId: typeof data.programId === "string" ? data.programId : "",
    });
  }
  return items;
}
