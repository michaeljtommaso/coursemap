import { doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { RequirementReportSchema } from "@/lib/schemas";

/**
 * Requirement reports service (spec 019 D15) — the ONLY module that writes
 * `requirementReports/*` ("this looks wrong" on a requirement row).
 *
 *  - Create-only, for signed-in and guest users. Atomic batch with the
 *    `users/{uid}.lastReportAt = serverTimestamp()` rate-limit stamp, exactly
 *    like services/shares.ts (rules: one report per 10 s per user).
 *  - Resolves "sent", or "rate-limited" when a report is attempted inside the
 *    10 s window; any other failure throws.
 *
 * RATE LIMIT: firestore.rules is the boundary (getAfter() checks the stamp and
 * the previous stamp must be ≥10 s old). The in-memory cooldown below only
 * spares a write the rules would refuse, and tells a refusal caused by the
 * limiter apart from a real failure.
 */

export const REPORT_COOLDOWN_MS = 10_000;
/** A permission-denied this soon after a successful send is the limiter (the
 *  slack covers clock skew between this browser and the server). */
const RECENT_SEND_MS = 2 * REPORT_COOLDOWN_MS;

export type RequirementReportInput = {
  programId: string;
  /** Layer id for Distribution rows; "program" for Engineering-family rows. */
  layer: string;
  rowId: string;
  note?: string;
};

let lastSentAt: number | null = null;

/** Test seam: forget the last successful send. */
export function resetReportRateLimit(): void {
  lastSentAt = null;
}

export async function submitRequirementReport(
  input: RequirementReportInput
): Promise<"sent" | "rate-limited"> {
  if (lastSentAt !== null && Date.now() - lastSentAt < REPORT_COOLDOWN_MS) {
    return "rate-limited";
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("submitRequirementReport: no signed-in user");

  const note = input.note?.trim();
  const report = {
    uid,
    programId: input.programId,
    layer: input.layer,
    rowId: input.rowId,
    ...(note ? { note } : {}),
  };
  RequirementReportSchema.parse({ ...report, createdAt: new Date() });

  const batch = writeBatch(db);
  batch.set(doc(db, "requirementReports", crypto.randomUUID()), {
    ...report,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, "users", uid), { lastReportAt: serverTimestamp() });
  try {
    await batch.commit();
  } catch (err) {
    const denied = (err as { code?: string })?.code === "permission-denied";
    if (denied && lastSentAt !== null && Date.now() - lastSentAt < RECENT_SEND_MS) {
      return "rate-limited";
    }
    throw err;
  }
  lastSentAt = Date.now();
  return "sent";
}
