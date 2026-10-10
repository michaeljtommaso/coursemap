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
 * between cards resolve too. `cards` must be the column's RESTING layout
 * (restingLayout): measured against the live layout, the outline's own
 * displacement fed back into the index, so the same pointer position resolved
 * differently depending on the path the pointer took to get there.
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

/** One element of a column's card stack, in DOM order, as measured live.
 *  `top` is the transform-free layout position (an in-flight glide or hover
 *  lift subtracted); the outline only needs its height. */
export type ColumnItem =
  | { kind: "card"; id: string; top: number; height: number }
  | { kind: "outline"; height: number };

/**
 * A column's RESTING layout: where its cards sit with no drop outline and the
 * dragged card (if it is in this column) back in its home slot at its original
 * height — the board as it looked when the drag began. Hit-testing against
 * this instead of the live layout makes the insertion index a pure function of
 * the pointer position: the outline (and the hidden mover) move the cards on
 * screen but never the zones that pick the index, so the outline cannot push
 * its own target out from under a still pointer, and a point aimed at before
 * the drag resolves the same however the pointer travels there.
 *
 * Consistency with what is on screen: a card's resting top is where the
 * outline is drawn when it targets that card's slot, so a pointer in a card's
 * resting top half is over that outline, and a pointer in its resting bottom
 * half is over the card itself (the outline then sits below it). In the
 * dragged card's own column this holds to within the difference between the
 * outline's height and the dragged card's.
 *
 * `gap` is the stack's row gap; `mover.height` the dragged card's height at
 * drag start (its live node is hidden or shows a shorter placeholder). All
 * values share one coordinate space. The mover itself is left out.
 */
export function restingLayout(
  items: ColumnItem[],
  gap: number,
  mover: { id: string; height: number } | null = null
): MeasuredCard[] {
  const out: MeasuredCard[] = [];
  let shift = 0;
  for (const item of items) {
    if (item.kind === "outline") {
      shift -= item.height + gap;
      continue;
    }
    if (mover && item.id === mover.id) {
      shift += item.height > 0 ? mover.height - item.height : mover.height + gap;
      continue;
    }
    if (!(item.height > 0)) continue;
    out.push({ id: item.id, top: item.top + shift, height: item.height });
  }
  return out;
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
