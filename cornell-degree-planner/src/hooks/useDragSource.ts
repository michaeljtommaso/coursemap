import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { dragState } from "@/lib/drag/dragState";

/**
 * useDragSource (spec 014 §D3/§D7) — the ONE drag-start detector shared by
 * board cards and catalog rows, so the two can never drift again.
 *
 * Mouse / pen: pointerdown records the start point and attaches DOCUMENT-level
 * pointermove / pointerup / pointercancel listeners. Once the pointer travels
 * more than DRAG_THRESHOLD_PX the listeners detach and `onStart` fires (from
 * there AppShell's document listeners own the gesture). A release under the
 * threshold just detaches — the element's own click handler runs as a click.
 * Document listeners (not element handlers, not pointer capture) keep firing
 * after the pointer leaves the small source box and survive the source
 * re-rendering or unmounting mid-gesture (the July audit's root cause).
 *
 * Touch: a drag starts only after a LONG_PRESS_MS hold that hasn't moved past
 * the threshold; moving first is a scroll and abandons the press. Once held,
 * the element gets `touch-action: none` and a non-passive document touchmove
 * listener blocks native scrolling for the rest of the gesture; contextmenu
 * (Android long-press menu) is blocked while pressed. The `.drag-source` class
 * (globals.css) suppresses the iOS callout and selection.
 *
 * The click the browser synthesizes after a real drag is swallowed (capture
 * phase, one-shot) so a drag never opens the detail panel / arms a course.
 *
 * Never preventDefault()s the pointerdown — that would kill touch scrolling in
 * the catalog list.
 */

export const DRAG_THRESHOLD_PX = 6;
export const LONG_PRESS_MS = 250;

export type DragStartPoint = { x: number; y: number; pointerType: string };

/** Swallow the one click a completed drag produces. Removed shortly after the
 *  pointer is released whether or not a click arrives (a cross-element drag
 *  may click a common ancestor; a touch drag usually produces none). */
function suppressNextClick() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    cleanup();
  };
  const onRelease = () => {
    if (timer === null) timer = setTimeout(cleanup, 50);
  };
  function cleanup() {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerup", onRelease, true);
    document.removeEventListener("pointercancel", onRelease, true);
  }
  window.addEventListener("click", swallow, true);
  document.addEventListener("pointerup", onRelease, true);
  document.addEventListener("pointercancel", onRelease, true);
}

const blockContextMenu = (ev: Event) => ev.preventDefault();

/** For a touch drag: block native scrolling + the context menu until the
 *  finger lifts, and pin touch-action on the pressed element. */
function holdTouchGesture(el: HTMLElement) {
  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = "none";
  const blockScroll = (ev: TouchEvent) => {
    if (ev.cancelable) ev.preventDefault();
  };
  const release = () => {
    el.style.touchAction = prevTouchAction;
    document.removeEventListener("touchmove", blockScroll);
    document.removeEventListener("contextmenu", blockContextMenu, true);
    document.removeEventListener("pointerup", release, true);
    document.removeEventListener("pointercancel", release, true);
  };
  document.addEventListener("touchmove", blockScroll, { passive: false });
  document.addEventListener("contextmenu", blockContextMenu, true);
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
}

export function useDragSource({
  onStart,
  disabled = false,
}: {
  /** Called once per gesture when it becomes a drag; start dragState here. */
  onStart: (p: DragStartPoint) => void;
  disabled?: boolean;
}): { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void } {
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onStartRef.current = onStart;
  });

  // Detach of the press currently being watched (null when idle).
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !e.isPrimary) return;
      if (e.pointerType !== "touch" && e.button !== 0) return;
      if (dragState.get()?.phase === "dragging") return;
      detachRef.current?.();

      const el = e.currentTarget;
      const pointerId = e.pointerId;
      const pointerType = e.pointerType;
      const isTouch = pointerType === "touch";
      const sx = e.clientX;
      const sy = e.clientY;
      let lastX = sx;
      let lastY = sy;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const detach = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        document.removeEventListener("contextmenu", blockContextMenu, true);
        if (detachRef.current === detach) detachRef.current = null;
      };

      const begin = (x: number, y: number) => {
        detach();
        suppressNextClick();
        if (isTouch) holdTouchGesture(el);
        onStartRef.current({ x, y, pointerType });
      };

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        lastX = ev.clientX;
        lastY = ev.clientY;
        const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (dist <= DRAG_THRESHOLD_PX) return;
        // Touch: moving before the hold completes is a scroll, not a drag.
        if (isTouch) detach();
        else begin(ev.clientX, ev.clientY);
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        detach(); // sub-threshold release → the element's click runs as a click
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      if (isTouch) {
        document.addEventListener("contextmenu", blockContextMenu, true);
        timer = setTimeout(() => {
          timer = null;
          begin(lastX, lastY);
        }, LONG_PRESS_MS);
      }
      detachRef.current = detach;
    },
    [disabled]
  );

  return { onPointerDown };
}
