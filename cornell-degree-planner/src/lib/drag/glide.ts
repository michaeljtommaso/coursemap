/**
 * glide (polish plan D1, spec 014 DEFERRED "gliding neighbour cards") — the
 * PURE half of the column FLIP: given where each element rested before a
 * React commit and where it rests now, the offset it must start gliding from
 * so the commit doesn't show as a jump. No DOM: useColumnGlide measures.
 *
 * Positions are in the column stack's LOCAL pixels (unzoomed), measured from
 * the stack's top, so they survive canvas scrolling and zoom changes.
 */

/** One element measured right after a commit. */
export type GlideSample = {
  /** Stable identity across renders (placement id, or a fixed key). */
  key: string;
  /** Resting (layout) top now — the transform subtracted. */
  rest: number;
  /** The translateY it is still painted with (an in-flight glide or lift). */
  translate: number;
};

/** An element to animate from translateY(`from`) to 0. */
export type Glide = { key: string; from: number };

/**
 * FLIP "invert": an element painted at `prevRest + translate` before the
 * commit now rests at `rest`, so it starts at `prevRest + translate - rest`
 * and glides to 0. Using the painted position (not just the old resting one)
 * lets a new glide pick up mid-flight from an interrupted one without a jump.
 *
 * Skipped: elements with no previous position (newly mounted, or hidden last
 * time — e.g. a card the drag ghost is about to land on), the `skip` key (the
 * dragged card: the ghost animates it, and DragGhost measures its final rect),
 * and sub-pixel offsets.
 */
export function planGlides(
  prev: ReadonlyMap<string, number>,
  now: GlideSample[],
  skip: string | null = null,
  minPx = 0.5
): Glide[] {
  const out: Glide[] = [];
  for (const s of now) {
    if (s.key === skip) continue;
    const before = prev.get(s.key);
    if (before === undefined) continue;
    const from = before + s.translate - s.rest;
    if (Math.abs(from) < minPx) continue;
    out.push({ key: s.key, from });
  }
  return out;
}
