/**
 * Requirement reports service (spec 019 D15) — the ONLY module that writes
 * `requirementReports/*` ("this looks wrong" on a requirement row).
 *
 * CONTRACT (Phase 3, lane D implements; stub until then):
 *  - Create-only, for signed-in and guest users. Atomic batch with the
 *    `users/{uid}.lastReportAt = serverTimestamp()` rate-limit stamp, exactly
 *    like services/shares.ts (rules: one report per 10 s per user).
 *  - Resolves "sent", or "rate-limited" when the rules refuse a report sent
 *    inside the 10 s window; any other failure throws.
 */

export type RequirementReportInput = {
  programId: string;
  /** Layer id for Distribution rows; "program" for Engineering-family rows. */
  layer: string;
  rowId: string;
  note?: string;
};

export async function submitRequirementReport(
  input: RequirementReportInput
): Promise<"sent" | "rate-limited"> {
  void input;
  throw new Error("submitRequirementReport: not implemented");
}
