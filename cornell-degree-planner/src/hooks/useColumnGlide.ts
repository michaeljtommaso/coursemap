import { useLayoutEffect, useRef, type RefObject } from "react";
import { animate, spring } from "animejs";
import { dragState } from "@/lib/drag/dragState";
import { planGlides, type GlideSample } from "@/lib/drag/glide";
import { translateYOf, zoomScale } from "@/lib/drag/layoutMeasure";
import { prefersReducedMotion } from "@/lib/motion";

/** A short, barely-bouncy settle (polish plan D1: about 180–220ms). */
const GLIDE_EASE = () => spring({ bounce: 0.12, duration: 200 });

/**
 * useColumnGlide (polish plan D1; spec 014 DEFERRED "gliding neighbour
 * cards") — FLIP for one column's card stack. When the drop outline opens or
 * moves, the dragged card leaves its column, or a drop / removal / undo
 * changes the cards, the stack's children glide from where they were painted
 * to their new layout slots instead of jumping. The layout itself still
 * changes instantly (spec 014 §D4), so hit-testing and commits never wait on
 * an animation: the commit stays synchronous (spec 009 §5) and dragState
 * hit-tests resting layout positions, never these in-flight transforms.
 *
 * Children are matched by `data-placement` (cards) or `data-glide` (other
 * stack members, e.g. the "+ Add a class" button); the outline itself doesn't
 * move, the cards slide off it. Every commit re-measures each child's resting
 * top (local px from the stack's top, so scroll and zoom don't matter), but
 * only a change of `trigger` animates: the outline's target, the dragged
 * card's visibility, the card order. Never per pointermove, since the column
 * only re-renders when one of those changes.
 *
 * Reduced motion: no glide; the stack reflows instantly, as before D1.
 */
export function useColumnGlide(stackRef: RefObject<HTMLElement | null>, trigger: string) {
  const restRef = useRef<Map<string, number>>(new Map());
  const triggerRef = useRef(trigger);

  // No deps on purpose: every commit refreshes the resting positions, so the
  // next glide starts from where the cards really were.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const changed = triggerRef.current !== trigger;
    triggerRef.current = trigger;

    // Read everything first, then write (no layout thrash on a long column).
    const scale = zoomScale(stack);
    const base = stack.getBoundingClientRect().top;
    const els = new Map<string, HTMLElement>();
    const samples: GlideSample[] = [];
    for (const el of Array.from(stack.children)) {
      if (!(el instanceof HTMLElement)) continue;
      const key = el.dataset.placement ?? el.dataset.glide;
      if (!key) continue;
      const r = el.getBoundingClientRect();
      if (!(r.height > 0)) continue; // hidden: no resting slot this commit
      const translate = translateYOf(el);
      samples.push({ key, rest: (r.top - base) / scale - translate, translate });
      els.set(key, el);
    }
    const prev = restRef.current;
    restRef.current = new Map(samples.map((s) => [s.key, s.rest]));
    if (!changed || prefersReducedMotion()) return;

    const skip = dragState.get()?.sourcePlacementId ?? null;
    for (const { key, from } of planGlides(prev, samples, skip)) {
      const el = els.get(key);
      // The [from, 0] keyframes render `from` synchronously, before paint, and
      // replace any glide or hover lift already running on the element.
      if (el) animate(el, { y: [from, 0], ease: GLIDE_EASE() });
    }
  });
}
