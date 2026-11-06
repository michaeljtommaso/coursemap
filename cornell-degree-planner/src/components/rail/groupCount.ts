import type { RequirementItem, TriedProgress } from "@/hooks/useRequirementProgress";

/**
 * groupCount.ts (spec 028 D9/D10/D11) — the ONE count a requirement group
 * states, shared by the planner rail and the Requirements page so both always
 * show the same numbers. Pure; reads `progress.groups` only.
 *
 * Count rule:
 *  - Advisor rows (`confirm`) are left out.
 *  - A group of ONE row that carries its own counts states that row's count
 *    still binding: a distribution row its categories, then (once they're
 *    covered) its course floor, then its credit floor; a credits row its
 *    credits; a pool (or an anyOf row's active option) its courses, then its
 *    credits once the courses are reached.
 *  - Any other group counts its rows: done (met or waived) of checkable.
 *  - "Done" always comes from the rows' status, never from the count: a row
 *    whose numbers are reached but whose engine says partial is not done.
 *  - Tried classes (D11) add `plus` in the same count, read from
 *    `progress.tried.items`. Tried never marks a group done.
 */

export type CountMeasure = "categories" | "courses" | "credits" | "poolCredits";
export type Count = { have: number; need: number };

/** An advisor-only ("confirm with your advisor") row. */
export const isConfirm = (it: RequirementItem): boolean =>
  it.dist?.confirm === true || it.dist?.rowKind === "confirm";
export const isDone = (it: RequirementItem): boolean => it.status === "satisfied" || it.status === "waived";
export const isOpen = (it: RequirementItem): boolean => it.status === "unmet" || it.status === "partial";

/** The count a row states for one measure, or null when it has none. */
export function readCount(it: RequirementItem, m: CountMeasure): Count | null {
  const d = it.dist;
  const p = it.poolProgress;
  switch (m) {
    case "categories":
      return d?.categoriesNeed != null ? { have: d.categoriesHave ?? 0, need: d.categoriesNeed } : null;
    case "credits":
    case "poolCredits":
      if (d?.creditsNeed != null && d.creditsNeed > 0) return { have: d.creditsHave ?? 0, need: d.creditsNeed };
      if (p && p.requiredCredits > 0) return { have: p.credits, need: p.requiredCredits };
      return null;
    case "courses":
      if (d?.coursesNeed != null && d.coursesNeed > 0) return { have: d.coursesHave ?? 0, need: d.coursesNeed };
      if (p && p.requiredCourses > 0) return { have: p.courses, need: p.requiredCourses };
      return null;
  }
}

/** The measures a row can state, in the order they bind; [] for none. */
function measuresOf(it: RequirementItem): CountMeasure[] {
  const d = it.dist;
  if (d) {
    if (d.rowKind === "distribution" && d.categoriesNeed != null) return ["categories", "courses", "poolCredits"];
    if (d.rowKind === "credits") return ["credits"];
    if (d.rowKind === "pool" || (d.rowKind === "anyOf" && d.activeOption != null)) return ["courses", "poolCredits"];
    return [];
  }
  return it.poolProgress ? ["courses", "poolCredits"] : [];
}

/**
 * Which of its own counts a row states: the first one still short, else the
 * first it has. Null for a waived row or a row with no counts of its own (a
 * single-course seat, an anyOf with no option started).
 */
export function bindingMeasure(it: RequirementItem): CountMeasure | null {
  if (it.status === "waived") return null;
  let first: CountMeasure | null = null;
  for (const m of measuresOf(it)) {
    const c = readCount(it, m);
    if (!c || c.need <= 0) continue;
    if (c.have < c.need) return m;
    first ??= m;
  }
  return first;
}

/** What the tried classes add to one row in its binding count (0 = nothing;
 *  null = the row has no count of its own). Never past what the row needs. */
export function triedPlusOn(real: RequirementItem, tried: RequirementItem | undefined): number | null {
  const m = bindingMeasure(real);
  if (!m) return null;
  if (!tried || isDone(real) || isConfirm(real)) return 0;
  const a = readCount(real, m);
  const b = readCount(tried, m);
  if (!a || !b) return 0;
  const n = Math.min(b.have, a.need) - Math.min(a.have, a.need);
  return n > 0 ? Math.round(n * 10) / 10 : 0;
}

export type GroupCount = {
  /** Capped at `need`. */
  have: number;
  need: number;
  /** The single row's binding measure, or null when the group counts rows. */
  measure: CountMeasure | null;
  /** Every counted row is met or waived (from status, never the numbers). */
  done: boolean;
  /** The tried classes' addition in the same count (0 = none). */
  plus: number;
};

/** A group's count, or null when it holds only advisor rows. */
export function groupCount(items: readonly RequirementItem[], tried?: TriedProgress): GroupCount | null {
  const rows = items.filter((it) => !isConfirm(it));
  if (rows.length === 0) return null;
  const triedRow = (it: RequirementItem): RequirementItem => tried?.items[it.id] ?? it;

  const measure = rows.length === 1 ? bindingMeasure(rows[0]) : null;
  if (measure) {
    const row = rows[0];
    const count = readCount(row, measure)!;
    const done = isDone(row);
    return {
      have: Math.min(count.have, count.need),
      need: count.need,
      measure,
      done,
      plus: tried ? (triedPlusOn(row, tried.items[row.id]) ?? 0) : 0,
    };
  }
  // Rows the app can check (or that are done anyway, e.g. waived).
  const counted = rows.filter((it) => it.checkable || isDone(it));
  const have = counted.filter(isDone).length;
  const done = counted.length > 0 && counted.every(isDone);
  const triedHave = counted.filter((it) => isDone(triedRow(it))).length;
  return {
    have,
    need: counted.length,
    measure: null,
    done,
    plus: tried && !done ? Math.max(0, triedHave - have) : 0,
  };
}
