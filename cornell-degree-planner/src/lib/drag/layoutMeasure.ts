/**
 * layoutMeasure — DOM reads that see LAYOUT positions, not painted ones.
 *
 * Cards on the board can carry a transient translateY: the hover lift and the
 * gliding-neighbour animation (spec 014 DEFERRED → polish plan D1) both
 * animate `y`. getBoundingClientRect includes that transform, so anything
 * that decides geometry (drop hit-testing, connector edges, the glide's own
 * "where does this card rest?") subtracts it first.
 *
 * Coordinate spaces: the canvas uses CSS `zoom`, so rects are in VIEWPORT
 * pixels (zoomed) while a transform's translation and offsetWidth are in the
 * element's own LOCAL pixels (unzoomed). `zoomScale` converts between them.
 */

/** The element's current translateY in its own local (unzoomed) pixels. */
export function translateYOf(el: Element): number {
  if (typeof getComputedStyle !== "function" || typeof DOMMatrixReadOnly === "undefined") return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    return new DOMMatrixReadOnly(t).m42;
  } catch {
    return 0;
  }
}

/** Viewport pixels per local pixel for this element (the effective CSS zoom). */
export function zoomScale(el: HTMLElement): number {
  const w = el.offsetWidth;
  if (!(w > 0)) return 1;
  const s = el.getBoundingClientRect().width / w;
  return s > 0 ? s : 1;
}

/** The element's viewport rect with its translateY removed: where layout put it. */
export function layoutRect(
  el: Element,
  scale: number
): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top - translateYOf(el) * scale, width: r.width, height: r.height };
}
