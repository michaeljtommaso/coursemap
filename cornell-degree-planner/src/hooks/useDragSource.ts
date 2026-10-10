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
 * Pointer identity + teardown (fix pass D1/D2): the drag is bound to the
 * pointer that started it, the post-drag listeners react only to THAT
 * pointer's release, and they also tear down on window blur, when the drag
 * ends, and on a POST_DRAG_MAX_MS backstop.
 *
 * Never preventDefault()s the pointerdown — that would kill touch scrolling in
 * the catalog list.
 */

export const DRAG_THRESHOLD_PX = 6;
export const LONG_PRESS_MS = 250;
/** Hard backstop (fix pass D2): post-drag listeners are torn down at most this
 *  long after the drag stops being "dragging", whatever else happens. Counted
 *  from the release, not the start — a drag itself may last any length. */
export const POST_DRAG_MAX_MS = 2000;

export type DragStartPoint = { x: number; y: number; pointerType: string; pointerId: number };

/**
 * Tear-down wiring shared by the post-drag listeners (fix pass D2). Before,
 * they were removed only on the NEXT pointerup/pointercancel anywhere — after
 * a blur-cancelled drag (Alt-Tab mid-drag) the user's first real click was
 * swallowed, and on touch the non-passive touchmove blocker could freeze page
 * scrolling until the next tap. Now `cleanup` also runs:
 *   - on window blur,
 *   - when dragState returns to null (the drag fully ended) — unless
 *     `endOnNull: false` (click suppression: an Esc-cancelled drag may still
 *     be pressed, and its release click must still be swallowed),
 *   - `POST_DRAG_MAX_MS` after the drag leaves the "dragging" phase (backstop),
 *   - immediately if there is no active drag at all (with endOnNull),
 *   - and, with `endOnRelease`, as soon as the drag leaves "dragging".
 * Returns the detach for these watchers (cleanup must call it).
 */
function watchDragEnd(
  cleanup: () => void,
  { endOnRelease = false, endOnNull = true }: { endOnRelease?: boolean; endOnNull?: boolean } = {}
): () => void {
  let backstop: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    const s = dragState.get();
    if (!s && endOnNull) return cleanup();
    if (s?.phase === "dragging") return;
    if (endOnRelease) return cleanup();
    if (backstop === null) backstop = setTimeout(cleanup, POST_DRAG_MAX_MS);
  };
  const unsub = dragState.subscribe(check);
  window.addEventListener("blur", cleanup);
  // Defer the initial check so `cleanup` can't run before the caller has
  // finished attaching its own listeners.
  queueMicrotask(check);
  return () => {
    if (backstop !== null) clearTimeout(backstop);
    backstop = null;
    unsub();
    window.removeEventListener("blur", cleanup);
  };
}

/** Swallow the one click a completed drag produces. Removed shortly after the
 *  drag's OWN pointer is released whether or not a click arrives (a
 *  cross-element drag may click a common ancestor; a touch drag usually
 *  produces none) — and on blur / drag end / the backstop (watchDragEnd). */
export function suppressNextClick(pointerId: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    cleanup();
  };
  const onRelease = (ev: PointerEvent) => {
    // A second finger lifting is not this drag's release (fix pass D1).
    if (ev.pointerId !== pointerId) return;
    if (timer === null) timer = setTimeout(cleanup, 50);
  };
  function cleanup() {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerup", onRelease, true);
    document.removeEventListener("pointercancel", onRelease, true);
    unwatch();
  }
  window.addEventListener("click", swallow, true);
  document.addEventListener("pointerup", onRelease, true);
  document.addEventListener("pointercancel", onRelease, true);
  // endOnNull: false — after an Esc-cancel the button may still be held, and
  // the click its eventual release produces must still be swallowed; the
  // release (+50ms), blur, or the backstop tears this down instead.
  const unwatch = watchDragEnd(cleanup, { endOnNull: false });
}

const blockContextMenu = (ev: Event) => ev.preventDefault();

/** For a touch drag: block native scrolling + the context menu until the
 *  drag's own finger lifts (or the drag stops being "dragging", or the window
 *  blurs — watchDragEnd), and pin touch-action on the pressed element. */
export function holdTouchGesture(el: HTMLElement, pointerId: number) {
  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = "none";
  let done = false;
  const blockScroll = (ev: TouchEvent) => {
    if (ev.cancelable) ev.preventDefault();
  };
  const release = () => {
    if (done) return;
    done = true;
    el.style.touchAction = prevTouchAction;
    document.removeEventListener("touchmove", blockScroll);
    document.removeEventListener("contextmenu", blockContextMenu, true);
    document.removeEventListener("pointerup", onPointerEnd, true);
    document.removeEventListener("pointercancel", onPointerEnd, true);
    unwatch();
  };
  // Only the drag's own pointer ends the hold — a second finger lifting must
  // not restore native scrolling mid-drag (fix pass D1).
  const onPointerEnd = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) release();
  };
  document.addEventListener("touchmove", blockScroll, { passive: false });
  document.addEventListener("contextmenu", blockContextMenu, true);
  document.addEventListener("pointerup", onPointerEnd, true);
  document.addEventListener("pointercancel", onPointerEnd, true);
  const unwatch = watchDragEnd(release, { endOnRelease: true });
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
        onStartRef.current({ x, y, pointerType, pointerId });
        // onStart may decline (nothing to drag) — then there's nothing to own.
        if (dragState.get()?.phase !== "dragging") return;
        // The drag belongs to THIS pointer (fix pass D1) — covers callers that
        // don't pass pointerId to dragState.start themselves.
        dragState.bindPointer(pointerId);
        suppressNextClick(pointerId);
        if (isTouch) holdTouchGesture(el, pointerId);
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
