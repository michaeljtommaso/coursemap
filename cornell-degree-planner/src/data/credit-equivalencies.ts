/**
 * Credit-equivalency loader (spec 007 §2 — the AP/IB → Cornell credit table).
 *
 * Starter table authored from Cornell Engineering's officially published AP
 * credit table, fetched 2026-07-11:
 *   https://www.duffield.cornell.edu/registrar/advanced-placement-ap-and-transfer-credit/advanced-placement-ap-credit-table/2025-2026-advanced-placement-credit-table/
 * Confirmed entries: AP Calculus BC (5) → MATH 1910,
 * 4 cr; AP Chemistry (5) → CHEM 2090 & 2091, 4 cr; AP Physics C: Mechanics (5)
 * → PHYS 1112, 3 cr (the published table also notes the student must still
 * enroll in PHYS 1110 — a caveat this v1 table does not model); AP Physics C:
 * E&M (5) → PHYS 2213, 4 cr; AP Computer Science A (5) → CS 1110, 4 cr.
 *
 * EVERY entry ships `provisional: true` regardless of the web fetch above
 * (spec 007 §2 binding decision) — the top-50 hand audit (a later unit)
 * clears them for real. No UI consumes this yet; it exists so
 * lib/planner/creditPool.ts and the (later) onboarding step have real seed
 * data to build against, and so the shape typechecks end-to-end today.
 */
import type { CreditEntry } from "@/lib/schemas";
import raw from "./credit-equivalencies.json";

/** A catalog row: the same shape as a CreditEntry, plus `provisional` — the
 *  catalog is the OFFERED table a student picks from; a CreditEntry is what
 *  lands in their profile once they've picked one (provisional stripped). */
export type CatalogCreditEquivalency = CreditEntry & { provisional: boolean };

export const CREDIT_EQUIVALENCIES: CatalogCreditEquivalency[] =
  raw as CatalogCreditEquivalency[];

/** Strip the catalog-only `provisional` flag — the shape that lands in a
 *  student's profile once they've picked a catalog row (spec 007 §2b, Unit
 *  7C2 — the credits dialog + FirstRun onboarding step both call this). */
export function toCreditEntry(entry: CatalogCreditEquivalency): CreditEntry {
  const { id, kind, label, satisfiesCourseIds, credits } = entry;
  return { id, kind, label, satisfiesCourseIds, credits };
}
