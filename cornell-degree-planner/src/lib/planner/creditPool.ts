import type { CreditEntry } from "@/lib/schemas";
import type { CreditCourses } from "./computeSlotStatusMap";

/**
 * creditPool.ts (spec 007 §2) — bridges the persisted credit profile
 * (CreditEntry[], profile-level) into the CreditCourses shape
 * computeSlotStatusMap's evaluate() already accepts as its final param.
 *
 * Pure + memoization-friendly: same input reference in, same-shaped (new)
 * Set-pair out. Callers (useSlotStatus) should useMemo this over the
 * creditProfile array so identity is stable across renders.
 */

/** Union every entry's satisfiesCourseIds into one credit pool, deduped.
 *  ids = the course ids verbatim (dash form, "MATH-1910"); codes = the same
 *  ids with dashes replaced by spaces ("MATH 1910") to match courseCode()'s
 *  form, so pattern leaves (which test against codes) also see the credit. */
export function buildCreditCourses(entries: CreditEntry[]): CreditCourses {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const entry of entries) {
    for (const id of entry.satisfiesCourseIds) {
      ids.add(id);
      codes.add(id.replace(/-/g, " "));
    }
  }
  return { ids, codes };
}
