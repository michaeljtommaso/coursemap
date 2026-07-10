/**
 * Canvas zoom (spec 006 §F2 / triage #15) — pure geometry, no DOM, so the
 * scale-compensation math is unit-testable in isolation.
 *
 * The canvas content element is scaled with `transform: scale(z)` and
 * `transform-origin: top left`. Because a CSS transform does NOT change layout
 * box size, two things need explicit compensation:
 *
 *  1. Scroll extent — the scroller still sees the content's UNSCALED layout box,
 *     so we wrap it in a sizing div whose pixel size is the scaled size
 *     (`scaledExtent`). Measure the content's `offsetWidth/offsetHeight` (both
 *     transform-independent) and multiply by z.
 *
 *  2. EdgeLayer geometry — EdgeLayer measures cards with `getBoundingClientRect`
 *     (which IS transform-affected) relative to the content element. With
 *     origin top-left, the content's own rect origin is the transform's fixed
 *     point, so `rect - base` yields a delta already multiplied by z. Dividing
 *     by z (`unscaleRect`) recovers the content-space (unscaled) coordinate the
 *     SVG — itself inside the scaled content — must draw in.
 */

/** Zoom presets (spec 006 §F2): 100 / 85 / 70 / 55%. Index 0 is the default. */
export const ZOOM_PRESETS = [1, 0.85, 0.7, 0.55] as const;
export type ZoomLevel = (typeof ZOOM_PRESETS)[number];

export const DEFAULT_ZOOM: ZoomLevel = 1;

/** Clamp an arbitrary persisted number back onto a known preset (defends against
 *  a hand-edited or stale localStorage value). Nearest preset wins. */
export function normalizeZoom(z: number | undefined | null): ZoomLevel {
  if (typeof z !== "number" || !Number.isFinite(z)) return DEFAULT_ZOOM;
  let best: ZoomLevel = ZOOM_PRESETS[0];
  let bestGap = Infinity;
  for (const p of ZOOM_PRESETS) {
    const gap = Math.abs(p - z);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best;
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Recover the unscaled, content-space rect of an element from its scaled
 * viewport rect and the content element's scaled viewport rect (the base).
 * `scale` is the applied zoom; scale=1 is a pass-through (identity).
 */
export function unscaleRect(
  el: { left: number; top: number; width: number; height: number },
  base: { left: number; top: number },
  scale: number
): Rect {
  const z = scale || 1;
  return {
    x: (el.left - base.left) / z,
    y: (el.top - base.top) / z,
    w: el.width / z,
    h: el.height / z,
  };
}

/** Scaled pixel extent of the sizing div that keeps scroll bounds honest. */
export function scaledExtent(
  naturalWidth: number,
  naturalHeight: number,
  scale: number
): { width: number; height: number } {
  const z = scale || 1;
  return { width: naturalWidth * z, height: naturalHeight * z };
}
