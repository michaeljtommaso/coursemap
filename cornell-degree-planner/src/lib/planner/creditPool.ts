import type { CreditEntry } from "@/lib/schemas";
import type { ResolvedCredit } from "@/lib/credit/types";
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
 *  engine can say WHICH credit covers a placed course ("Covered by AP
 *  Calculus BC (5)", spec 028 D7) instead of only folding it silently into
 *  prereq pools. A placement-only award's courses count here (placement
 *  satisfies prerequisites) though they never fill a requirement. */
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

/** The id prefix of a credit-only pool course (creditOnlyCourseId). */
export const CREDIT_ONLY_PREFIX = "credit:";

/**
 * Spec 028: the pool course id for credit that names NO Cornell course (AP
 * Biology's 8 credits, a language exam's 3, a "No Cornell equivalent" transfer)
 * — `credit:<entry id>` — or null when the entry has courses, no credits, is
 * placement only, or earns nothing in this college. buildMatchPool adds one
 * such course per entry (empty subject and number, so only credit-total and
 * credit-kind rules can count it); creditEntryByCourse names it.
 */
export function creditOnlyCourseId(
  entry: CreditEntry & { placementOnly?: boolean; earnsNothing?: boolean; courseOptions?: string[][] }
): string | null {
  if (entry.placementOnly || entry.earnsNothing) return null;
  if (entry.satisfiesCourseIds.length > 0) return null;
  if ((entry.courseOptions ?? []).some((set) => set.length > 0)) return null;
  if (!(typeof entry.credits === "number" && entry.credits > 0)) return null;
  return `${CREDIT_ONLY_PREFIX}${entry.id}`;
}

/** Is this a credit-only pool course id (no Cornell course behind it)? Display
 *  code should name the credit entry, never show this id as a course code. */
export function isCreditOnlyCourseId(id: string): boolean {
  return id.startsWith(CREDIT_ONLY_PREFIX);
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
 *
 * Resolved credit (spec 028, useCreditProfile().resolved) knows each course's
 * share (`courseCredits`), so an entry counts per course instead: an exam
 * granting CHEM 2070 + 2080 still adds 2080's share when 2070 is already on
 * the board. A placement-only award adds nothing and claims no course. An
 * "X or Y" award (`courseOptions`) is one grant, counted as buildMatchPool
 * counts it: nothing when any of its courses is already counted from the board
 * (`countedCourseIds`), else the shares of its FIRST option's courses that no
 * earlier entry counted — AP Chemistry (CHEM 2070 & 2071) plus A-Level
 * Chemistry A (that pair or 2090 & 2091, and 2080 & 2081) adds 4 + 4.
 */
export function creditProfileCredits(
  entries: readonly (CreditEntry &
    Partial<Pick<ResolvedCredit, "courseCredits" | "placementOnly" | "courseOptions">>)[],
  countedCourseIds: ReadonlySet<string> = new Set()
): number {
  let total = 0;
  const counted = new Set(countedCourseIds);
  for (const entry of entries) {
    if (entry.placementOnly) continue;
    const shares = entry.courseCredits;
    const options = entry.courseOptions?.filter((set) => set.length > 0) ?? [];
    const hasOptions = options.length > 0;
    if (shares && hasOptions) {
      // "X or Y" (mirrors buildMatchPool): nothing once an option course is on
      // the board; else the first option's courses no earlier entry counted.
      if (options.flat().some((id) => countedCourseIds.has(id))) continue;
      for (const id of options[0]) {
        if (counted.has(id)) continue;
        counted.add(id);
        total += shares[id] ?? 0;
      }
      continue;
    }
    if (shares && !hasOptions && entry.satisfiesCourseIds.length > 0) {
      for (const id of entry.satisfiesCourseIds) {
        if (counted.has(id)) continue;
        counted.add(id);
        total += shares[id] ?? 0;
      }
      continue;
    }
    if (entry.satisfiesCourseIds.some((id) => counted.has(id))) continue;
    for (const id of entry.satisfiesCourseIds) counted.add(id);
    total += entry.credits ?? 0;
  }
  return total;
}

/**
 * Spec 028 D7 — which credit entry carries each credit course into a match
 * pool, so a requirement row can name it ("AP Calculus BC (5)") instead of
 * "Your credit". Keyed by CANONICAL course id; mirrors buildMatchPool + the
 * engines' first-wins dedup exactly: a course on the board wins over the same
 * course from credit (it isn't credit's to name), the first entry granting a
 * course wins over later ones, and a placement-only award never enters the
 * pool. Credit naming no course is keyed by its credit-only id
 * (creditOnlyCourseId: `credit:<entry id>`).
 */
export function creditEntryByCourse<
  E extends CreditEntry & { placementOnly?: boolean; earnsNothing?: boolean; courseOptions?: string[][] },
>(
  entries: readonly E[],
  boardCourseIds: Iterable<string>,
  canonical: (id: string) => string = (id) => id
): Map<string, E> {
  const onBoard = new Set<string>();
  for (const id of boardCourseIds) onBoard.add(canonical(id));
  const out = new Map<string, E>();
  for (const entry of entries) {
    if (entry.placementOnly) continue;
    // Credit naming no Cornell course enters the pool as one credit-only course.
    const creditOnly = creditOnlyCourseId(entry);
    if (creditOnly) {
      if (!out.has(creditOnly)) out.set(creditOnly, entry);
      continue;
    }
    let ids = entry.satisfiesCourseIds;
    const options = entry.courseOptions?.filter((set) => set.length > 0);
    if (options && options.length > 0) {
      // "X or Y": only the first option's courses enter the pool, and none
      // when any option's course is on the board (buildMatchPool).
      if (options.flat().some((id) => onBoard.has(canonical(id)))) continue;
      ids = options[0];
    }
    for (const id of ids) {
      const cid = canonical(id);
      if (onBoard.has(cid) || out.has(cid)) continue;
      out.set(cid, entry);
    }
  }
  return out;
}

/** Spec 046 D4: how a credit entry is named where it counts. A transfer the
 *  student placed ("Counts toward") reads "… (you said)". */
export function creditEntryLabel(entry: Pick<CreditEntry, "label" | "kind" | "countsToward">): string {
  return entry.kind === "transfer" && entry.countsToward ? `${entry.label} (you said)` : entry.label;
}

/** Append `value` to the list at `key` once (insertion order kept). */
export function pushUnique(map: Record<string, string[]>, key: string, value: string): void {
  const list = (map[key] ??= []);
  if (!list.includes(value)) list.push(value);
}
