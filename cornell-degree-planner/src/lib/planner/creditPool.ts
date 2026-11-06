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
 *  Calculus BC (5)", spec 025 D7) instead of only folding it silently into
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
 * Resolved credit (spec 025, useCreditProfile().resolved) knows each course's
 * share (`courseCredits`), so an entry counts per course instead: an exam
 * granting CHEM 2070 + 2080 still adds 2080's share when 2070 is already on
 * the board. A placement-only award adds nothing and claims no course. An
 * "X or Y" award (`courseOptions`) is one grant: its total, unless any of its
 * courses is already counted (then nothing, as before).
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
    const hasOptions = (entry.courseOptions?.length ?? 0) > 0;
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
 * Spec 025 D7 — which credit entry carries each credit course into a match
 * pool, so a requirement row can name it ("AP Calculus BC (5)") instead of
 * "Your credit". Keyed by CANONICAL course id; mirrors buildMatchPool + the
 * engines' first-wins dedup exactly: a course on the board wins over the same
 * course from credit (it isn't credit's to name), the first entry granting a
 * course wins over later ones, and a placement-only award never enters the
 * pool.
 */
export function creditEntryByCourse<E extends CreditEntry & { placementOnly?: boolean; courseOptions?: string[][] }>(
  entries: readonly E[],
  boardCourseIds: Iterable<string>,
  canonical: (id: string) => string = (id) => id
): Map<string, E> {
  const onBoard = new Set<string>();
  for (const id of boardCourseIds) onBoard.add(canonical(id));
  const out = new Map<string, E>();
  for (const entry of entries) {
    if (entry.placementOnly) continue;
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

/** Append `value` to the list at `key` once (insertion order kept). */
export function pushUnique(map: Record<string, string[]>, key: string, value: string): void {
  const list = (map[key] ??= []);
  if (!list.includes(value)) list.push(value);
}
