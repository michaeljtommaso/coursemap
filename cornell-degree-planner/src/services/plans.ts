import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CourseMarksSchema, PlanSchema, PLAN_SCHEMA_VERSION } from "@/lib/schemas";
import {
  normalizePlan,
  isCurrentPlanShape,
  type NormalizedPlan,
  type PlanDocInput,
} from "@/lib/normalize/normalizePlan";
import type { Placement } from "@/types/plan";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { currentProgramContent, type CarryPlan } from "@/lib/guestCarryOver";
import { canonicalProgramId } from "@/lib/planner/legacyPrograms";

/**
 * Plans service — the ONLY module that touches Firestore for plan docs (house-standard
 * service-layer contract, docs/specs/002 §5/§6). No raw getDoc/onSnapshot outside
 * services/. Reads: snap.data() → Zod-validate → normalizer. Writes: Zod-validate
 * first, then write; serverTimestamp() is fine on direct SDK writes (never on
 * JSON-serialized values). Listeners DEGRADE to empty + console.warn + an error
 * flag — they never throw (an uncaught onSnapshot error crashes the SDK under
 * StrictMode, spec 002 §5).
 */

/** A loaded plan: the normalized doc plus its course marks (spec 020 D2;
 *  empty when the doc has none). Marks are not pruned to the placed courses:
 *  a removed course's mark is kept and reapplies when it is re-added (D5). */
export type LoadedPlan = NormalizedPlan & { courseMarks: Record<string, MarkValue> };

export type PlanListItem = {
  id: string;
  name: string;
  programId: string;
};

/** Fields a caller may supply when creating a plan (spec 014 placement model).
 *  serverTimestamps + schemaVersion are stamped here so callers can't set them
 *  wrong. */
export type CreatePlanInput = {
  name: string;
  programId: string;
  placements?: Placement[];
  courseSnapshots?: Record<string, unknown>;
  completedIds?: string[];
  inProgressIds?: string[];
  waivedRequirementIds?: string[];
  /** Spec 020 course marks (answer key → value); omitted or empty = none. */
  courseMarks?: Record<string, MarkValue>;
};

/** A partial update to a plan doc (client mutations). updatedAt is stamped here. */
export type UpdatePlanPatch = {
  name?: string;
  placements?: Placement[];
  courseSnapshots?: Record<string, unknown>;
  completedIds?: string[];
  inProgressIds?: string[];
  waivedRequirementIds?: string[];
  /** The WHOLE course-marks map (spec 020): replaces the stored map, so a
   *  cleared mark disappears. An empty map deletes the field. */
  courseMarks?: Record<string, MarkValue>;
  schemaVersion?: number;
};

/**
 * Fields of the retired slot model (schemaVersion ≤ 2). A content write to a
 * legacy doc DELETES them in the same update, so the doc becomes a pure
 * new-shape doc and keeps passing the plan allowlist after the rules CONTRACT
 * step drops the old shape (spec 014 expand-then-contract). Deleting an absent
 * field is a no-op, so this rides along on every content write.
 */
const RETIRED_PLAN_FIELDS = [
  "slotSelections",
  "completedSlotIds",
  "waivedSlotIds",
  "inProgressSlotIds",
  "slotOverrides",
  "customSlots",
] as const;

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
  cb: (result: { plan: LoadedPlan | null; error: boolean }) => void
): () => void {
  return onSnapshot(
    planDoc(uid, planId),
    (snap) => {
      if (!snap.exists()) {
        cb({ plan: null, error: false });
        return;
      }
      try {
        const raw = snap.data() as PlanDocInput;
        // An older-schemaVersion (slot-model) doc is read as EMPTY without
        // validating its retired fields (spec 014 §D5 — no conversion).
        let plan: LoadedPlan;
        if (isCurrentPlanShape(raw)) {
          const parsed = PlanSchema.parse(raw);
          plan = { ...normalizePlan(parsed), courseMarks: parsed.courseMarks ?? {} };
        } else {
          plan = {
            ...normalizePlan({ name: raw.name, programId: raw.programId, schemaVersion: raw.schemaVersion }),
            courseMarks: {},
          };
        }
        cb({ plan, error: false });
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
    placements: input.placements ?? [],
    courseSnapshots: input.courseSnapshots ?? {},
    completedIds: input.completedIds ?? [],
    inProgressIds: input.inProgressIds ?? [],
    waivedRequirementIds: input.waivedRequirementIds ?? [],
    // Spec 020: only written when there are marks, so a plan without any
    // stays the pre-020 shape.
    ...(input.courseMarks && Object.keys(input.courseMarks).length > 0
      ? { courseMarks: CourseMarksSchema.parse(input.courseMarks) }
      : {}),
    schemaVersion: PLAN_SCHEMA_VERSION, // v3 = placement model (spec 014 §D5)
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
 * relevant slice of PlanSchema so an oversized list is caught client-side
 * before the write (rules still enforce authoritatively). A CONTENT write
 * (one carrying placements) also deletes the retired slot-model fields, so a
 * legacy doc upgrades to a pure new-shape doc in the same write.
 */
export async function updatePlan(
  uid: string,
  planId: string,
  patch: UpdatePlanPatch
): Promise<void> {
  // Firestore rejects ANY undefined value and fails the whole write — strip
  // them (the patch is plain data; sentinels are added below, after this).
  const clean = JSON.parse(JSON.stringify(patch)) as UpdatePlanPatch;
  // Validate just the provided fields against a partial of the plan schema.
  PlanSchema.partial().parse(clean);
  // PlanSchema reads course marks tolerantly; a write checks them strictly
  // (malformed key or value, or more than MAX_COURSE_MARKS → rejected here).
  const marks: Record<string, unknown> = {};
  if (clean.courseMarks !== undefined) {
    const parsed = CourseMarksSchema.parse(clean.courseMarks);
    // The whole map replaces the stored one; no marks left deletes the field,
    // so a plan without marks keeps the pre-020 shape.
    marks.courseMarks = Object.keys(parsed).length > 0 ? parsed : deleteField();
  }
  const retired: Record<string, ReturnType<typeof deleteField>> = {};
  if (clean.placements !== undefined) {
    for (const f of RETIRED_PLAN_FIELDS) retired[f] = deleteField();
  }
  await updateDoc(planDoc(uid, planId), {
    ...clean,
    ...marks,
    ...retired,
    updatedAt: serverTimestamp(),
  });
}

/** Delete a plan doc (spec 005 §6 — the switcher's two-step delete). */
export async function deletePlan(uid: string, planId: string): Promise<void> {
  await deleteDoc(planDoc(uid, planId));
}

/** List a user's plans (id + display metadata) for the plan switcher (spec 004).
 *  A retired program id reads as its current id (spec 019 D12), matching what
 *  subscribePlan hands over for the same doc. */
export async function listPlans(uid: string): Promise<PlanListItem[]> {
  const snap = await getDocs(plansCol(uid));
  const items: PlanListItem[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    items.push({
      id: d.id,
      name: typeof data.name === "string" ? data.name : d.id,
      programId: typeof data.programId === "string" ? canonicalProgramId(data.programId) : "",
    });
  }
  return items;
}

/** Server timestamp → ms; null when absent or not a Timestamp. */
function toMillis(v: unknown): number | null {
  return v && typeof (v as { toMillis?: unknown }).toMillis === "function"
    ? (v as { toMillis: () => number }).toMillis()
    : null;
}

/**
 * Read every plan of `uid` with its full content and created/updated times, for
 * copying into another account (spec 018). A retired slot-shape doc comes back
 * `legacy` with empty content; a doc that fails validation is skipped. A
 * retired program id comes back as its current id with translated waivers
 * (spec 019 D12), so the copy is written under the new id.
 */
export async function readPlansForCarryOver(uid: string): Promise<CarryPlan[]> {
  const snap = await getDocs(plansCol(uid));
  const out: CarryPlan[] = [];
  for (const d of snap.docs) {
    const raw = d.data() as PlanDocInput;
    try {
      const legacy = !isCurrentPlanShape(raw);
      const p = legacy ? null : PlanSchema.parse(raw);
      out.push({
        id: d.id,
        createdAtMs: toMillis((raw as Record<string, unknown>).createdAt),
        updatedAtMs: toMillis((raw as Record<string, unknown>).updatedAt),
        legacy,
        content: currentProgramContent({
          name: typeof raw.name === "string" ? raw.name.slice(0, 80) : "My Plan",
          programId: typeof raw.programId === "string" ? raw.programId : "",
          placements: p?.placements ?? [],
          courseSnapshots: p?.courseSnapshots ?? {},
          completedIds: p?.completedIds ?? [],
          inProgressIds: p?.inProgressIds ?? [],
          waivedRequirementIds: p?.waivedRequirementIds ?? [],
          courseMarks: p?.courseMarks ?? {},
        }),
      });
    } catch (err) {
      console.warn("[plans] carry-over read skipped an invalid plan", d.id, err);
    }
  }
  return out;
}
