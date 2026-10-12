import type { CreditEntry } from "@/lib/schemas";
import type { CreditCourses, CreditSource } from "./computeCardStatusMap";

/**
 * creditPool.ts (spec 007 §2) — bridges the persisted credit profile
 * (CreditEntry[], profile-level) into the CreditCourses shape
 * computeCardStatusMap's evaluate() already accepts as its final param.
 *
 * Pure + memoization-friendly: same input reference in, same-shaped (new)
 * Set-pair out. Callers (useCardStatus) should useMemo this over the
 * creditProfile array so identity is stable across renders.
 */

/** Union every entry's satisfiesCourseIds into one credit pool, deduped.
 *  ids = the course ids verbatim (dash form, "MATH-1910"); codes = the same
 *  ids with dashes replaced by spaces ("MATH 1910") to match courseCode()'s
 *  form, so pattern leaves (which test against codes) also see the credit.
 *  sources = course id → the entry that grants it (first entry wins), so the
 *  engine can say WHICH credit covers a placed course ("Covered by your AP
 *  credit") instead of only folding it silently into prereq pools. */
export function buildCreditCourses(entries: CreditEntry[]): CreditCourses {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const sources = new Map<string, CreditSource>();
  for (const entry of entries) {
    for (const id of entry.satisfiesCourseIds) {
      ids.add(id);
      codes.add(id.replace(/-/g, " "));
      if (!sources.has(id)) sources.set(id, { kind: entry.kind, label: entry.label });
    }
  }
  return { ids, codes, sources };
}

/**
 * Credits the credit profile adds toward the degree total (spec 007 §2c:
 * "Credits attached to a CreditEntry count toward credit totals"). An entry
 * counts its authored `credits` (entries without a figure add 0 — never a
 * guessed number in a progress total) UNLESS one of the courses it satisfies
 * is already counted from the board (`countedCourseIds`, e.g. the completed
 * placements' course ids) — a student who marks MATH 1910 done AND has AP Calc
 * BC must not earn those 4 credits twice. Likewise two entries granting the
 * same course (an AP score and a transfer course both "MATH 1910") count once
 * — the first entry wins. Pure; the journey rail adds this to its
 * earned-credit sum.
 */
export function creditProfileCredits(
  entries: CreditEntry[],
  countedCourseIds: ReadonlySet<string> = new Set()
): number {
  let total = 0;
  const counted = new Set(countedCourseIds);
  for (const entry of entries) {
    if (entry.satisfiesCourseIds.some((id) => counted.has(id))) continue;
    for (const id of entry.satisfiesCourseIds) counted.add(id);
    total += entry.credits ?? 0;
  }
  return total;
}
