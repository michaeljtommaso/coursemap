/**
 * insertion (spec 014 §D4) — the PURE geometry behind "a drop inserts at a
 * position". No DOM: dragState measures the column's cards and hands the
 * numbers here, so the rules are unit-testable.
 *
 * Index semantics match PlanProvider.movePlacement / placementOps
 * .movePlacementTo: `index` is the position in the TARGET column AFTER the
 * mover has been taken out (0 = top, n = append). A catalog drag has no mover.
 */

/** A drop position: semester column + insertion index (see module doc). */
export type DropTarget = { sem: number; index: number };

/** One card as measured in viewport space (getBoundingClientRect). */
export type MeasuredCard = { id: string; top: number; height: number };

/** One column as measured in viewport space. */
export type MeasuredColumn = { sem: number; left: number; right: number };

/**
 * Where a drop at viewport `y` lands among a column's cards: before the
 * hovered card if the cursor is in its top half, after it otherwise — i.e. the
 * number of (non-mover) cards whose vertical midpoint is above `y`. Above the
 * first card → 0 (top); the empty space below the last card → append.
 *
 * Counting midpoints (rather than "the card under the cursor") makes the gaps
 * between cards resolve too, and gives natural hysteresis once the placeholder
 * outline pushes the cards below it down: the cursor has to cross a card's
 * (shifted) midpoint before the index flips back, so the outline never
 * oscillates under a still cursor.
 *
 * Zero-height cards (a hidden in-flight source) are ignored.
 */
export function resolveInsertionIndex(
  cards: MeasuredCard[],
  y: number,
  moverId: string | null = null
): number {
  let index = 0;
  for (const c of cards) {
    if (c.id === moverId) continue;
    if (!(c.height > 0)) continue;
    if (c.top + c.height / 2 < y) index++;
  }
  return index;
}

/**
 * The column a cursor in the canvas but over no column (the gap between two
 * columns) belongs to: the horizontally nearest column within `maxGap` px, or
 * null when every column is farther away than that.
 */
export function nearestColumn(
  columns: MeasuredColumn[],
  x: number,
  maxGap: number
): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const c of columns) {
    const gap = x < c.left ? c.left - x : x > c.right ? x - c.right : 0;
    if (gap < bestGap) {
      bestGap = gap;
      best = c.sem;
    }
  }
  return bestGap <= maxGap ? best : null;
}

/** Same drop position (both null counts as the same). */
export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sem === b.sem && a.index === b.index;
}

/**
 * A card dropped back on its own position is a no-op (spec 014 States). With
 * the mover-excluded index semantics, "its own position" is exactly its
 * original column + original index.
 */
export function isNoopMove(home: DropTarget | null, target: DropTarget): boolean {
  return home !== null && sameTarget(home, target);
}
