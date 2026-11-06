import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import { collegeShortName } from "@/lib/planner/colleges";
import { codeFromId } from "./pageModel";

/** The Credit before Cornell card's wording (spec 025 D7). Pure. */

export const CREDIT_CARD_KEY = "credit";

export function formatCr(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Total credits the student brings (entries that earn something here). */
export function creditTotal(resolved: readonly ResolvedCredit[]): number {
  return resolved.reduce((sum, c) => sum + (c.earnsNothing || c.placementOnly ? 0 : (c.credits ?? 0)), 0);
}

/** The line under a credit's name: "MATH 1910 · 4 cr", "Placement out of …". */
export function creditEarns(c: ResolvedCredit, college: CreditCollege): string {
  if (c.earnsNothing) return college ? `No credit in ${collegeShortName(college)}` : "No credit at this score";
  const codes = c.satisfiesCourseIds.map(codeFromId);
  if (c.placementOnly) return codes.length > 0 ? `Placement out of ${codes.join(", ")} · no credit` : "Placement only · no credit";
  const cr = c.credits != null ? `${formatCr(c.credits)} cr` : "";
  if (codes.length > 0) return cr ? `${codes.join(" + ")} · ${cr}` : codes.join(" + ");
  return cr ? `${cr} (no specific course)` : "Counts toward your credit total";
}
