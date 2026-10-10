import type { Course } from "@/types/db";
import {
  nearestColumn,
  resolveInsertionIndex,
  restingLayout,
  sameTarget,
  type ColumnItem,
  type DropTarget,
  type MeasuredColumn,
} from "@/lib/drag/insertion";
import { layoutRect, zoomScale } from "@/lib/drag/layoutMeasure";

export type { DropTarget } from "@/lib/drag/insertion";

/**
 * dragState (spec 014 §D3/§D4) — the drag engine's singleton state machine +
 * pub/sub. One kind of drag: a COURSE travels, either off the board (a placed
 * card — `sourcePlacementId` is its placement id, the drop MOVES it) or out of
 * the catalog (`sourcePlacementId` null, the drop ADDS a placement).
 *
 * Lifecycle (every path ends in end()):
 *   start()  — useDragSource crossed the threshold / long-press. Mints a
 *              UNIQUE session id (DragGhost's commit guard keys on it, so the
 *              same card dragged twice commits twice — sweep D3).
 *   move()   — AppShell's document pointermove: hit-tests the insertion point
 *              {sem, index} under the cursor (`over`).
 *   drop()   — AppShell's pointerup: phase → "dropping", `drop` = the last
 *              `over` (null = no target → the ghost returns home).
 *   cancel() — Esc / pointercancel / window blur: phase → "dropping", no target.
 *   end()    — DragGhost, when its (decorative) drop animation finishes; plus a
 *              fallback timer armed by drop()/cancel() so a lost animation
 *              callback can never leave the body class or state stuck. AppShell
 *              also calls it on unmount (fix pass D4).
 *
 * Pointer identity (fix pass D1): a drag belongs to the pointer that started
 * it (`pointerId`, bound by useDragSource). AppShell ignores pointermove / up /
 * cancel from any other pointer, so a second finger or a palm on a tablet
 * can't steer the ghost or commit the drop.
 */

type DragPhase = "dragging" | "dropping";

/** The source element's viewport rect at drag start (spec 006 §F1). A failed
 *  drop springs the ghost back HERE before vanishing, so a mis-drop reads as
 *  "returned home" rather than "disappeared." Null when unavailable. */
export type OriginRect = { left: number; top: number; width: number; height: number } | null;

export type DragInfo = {
  /** Unique per drag gesture — never reused, even for the same course. */
  sessionId: string;
  courseId: string;
  course: Course;
  /** The placement being moved (a board card), or null (a catalog row). */
  sourcePlacementId: string | null;
  /** A board card's own position at drag start — dropping there is a no-op. */
  home: DropTarget | null;
  /** Source rect at drag start (spec 006 §F1) — failed-drop return target. */
  originRect: OriginRect;
  /** The source element, re-measured at drop time (the canvas may have
   *  scrolled mid-drag); originRect is the fallback when it's gone/hidden. */
  sourceEl: HTMLElement | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  /** Insertion point under the cursor while dragging (null = no target). */
  over: DropTarget | null;
  phase: DragPhase;
  /** Resolved at drop(): where the course lands (null = cancelled / no target). */
  drop: DropTarget | null;
  /** The placeholder outline's viewport rect at drop time — the FALLBACK
   *  landing spot. DragGhost prefers the committed card itself
   *  (measureLandedCard): a fast flick can release before React has rendered
   *  the outline at the release-point target (fix pass D3). */
  dropRect: OriginRect;
  /** The pointer that owns this drag (null = not bound yet / unknown). */
  pointerId: number | null;
};

/** Ms after drop()/cancel() before end() is forced, should DragGhost's
 *  animation callback never arrive (unmounted ghost, cancelled tween). */
const END_FALLBACK_MS = 1200;

/** Px a cursor in an inter-column gap may be from a column and still target it. */
const GAP_SNAP_PX = 32;

let _state: DragInfo | null = null;
let _seq = 0;
let _endTimer: ReturnType<typeof setTimeout> | null = null;
const _listeners = new Set<() => void>();
const _positionListeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}
function notifyPosition() {
  _positionListeners.forEach((fn) => fn());
}

function mintSessionId(): string {
  _seq += 1;
  return `drag-${Date.now().toString(36)}-${_seq}`;
}

function clearEndTimer() {
  if (_endTimer !== null) {
    clearTimeout(_endTimer);
    _endTimer = null;
  }
}

// Text-selection guard (bug sweep D6): toggled on <body> for the lifetime of
// any drag (dropped, cancelled, or returned home) — see globals.css. The
// canvas itself is also user-select:none (RoadmapCanvas), so this covers the
// rest of the page while a ghost is in flight.
const DRAG_ACTIVE_CLASS = "dragging-active";

function beginDragSelectionGuard() {
  if (typeof document === "undefined") return;
  document.body.classList.add(DRAG_ACTIVE_CLASS);
  // A selection can already exist from the pointerdown→threshold window;
  // user-select:none blocks new selection but doesn't clear that one.
  if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
}

function endDragSelectionGuard() {
  if (typeof document === "undefined") return;
  document.body.classList.remove(DRAG_ACTIVE_CLASS);
}

function toRect(r: DOMRect): OriginRect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Hit-test the insertion point under (x, y). The canvas uses CSS `zoom`, so
 * getBoundingClientRect and elementsFromPoint are both in VIEWPORT space —
 * everything here stays in viewport space too.
 *
 *  - Only a point whose TOPMOST element is inside the canvas scroller counts:
 *    the catalog drawer, the detail panel, menus and the zoom control all
 *    overlay the canvas, and elementsFromPoint would otherwise "see through"
 *    them into the columns underneath.
 *  - The column is the [data-column] under the point, else (an inter-column
 *    gap) the horizontally nearest column within GAP_SNAP_PX.
 *  - The index counts the column's other cards' midpoints above y, measured
 *    in the column's RESTING layout (insertion.restingLayout): no outline, the
 *    mover back home, and no in-flight transforms (hover lift, gliding
 *    neighbours). So the index depends only on where the pointer is, never on
 *    where the outline happens to be drawn or how far a glide has got.
 */
function resolveOver(
  x: number,
  y: number,
  mover: { id: string; height: number } | null
): DropTarget | null {
  if (typeof document === "undefined" || typeof document.elementsFromPoint !== "function") {
    return null;
  }
  const els = document
    .elementsFromPoint(x, y)
    .filter((el) => !el.closest("[data-drag-ghost]"));
  const top = els[0];
  if (!top || !top.closest("[data-canvas-scroll]")) return null;

  let colEl = els.find(
    (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.column !== undefined
  );
  if (!colEl) {
    const all = Array.from(document.querySelectorAll<HTMLElement>("[data-column]"));
    const measured: (MeasuredColumn & { el: HTMLElement })[] = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      measured.push({ sem: Number(el.dataset.column), left: r.left, right: r.right, el });
    }
    const sem = nearestColumn(measured, x, GAP_SNAP_PX);
    colEl = sem === null ? undefined : measured.find((c) => c.sem === sem)?.el;
  }
  if (!colEl) return null;
  const sem = Number(colEl.dataset.column);
  if (!Number.isFinite(sem)) return null;

  const stack = colEl.querySelector<HTMLElement>("[data-column-cards]");
  const scale = zoomScale(colEl);
  const items: ColumnItem[] = [];
  for (const el of Array.from(stack?.children ?? [])) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.dataset.dropOutline !== undefined) {
      items.push({ kind: "outline", height: el.getBoundingClientRect().height });
    } else if (el.dataset.placement !== undefined) {
      const r = layoutRect(el, scale);
      items.push({ kind: "card", id: el.dataset.placement, top: r.top, height: r.height });
    }
  }
  const gap = stack ? (parseFloat(getComputedStyle(stack).rowGap) || 0) * scale : 0;
  const cards = restingLayout(items, gap, mover);
  return { sem, index: resolveInsertionIndex(cards, y, mover?.id ?? null) };
}

/** The in-flight card for resolveOver: its id and its height at drag start. */
function moverOf(
  sourcePlacementId: string | null,
  originRect: OriginRect
): { id: string; height: number } | null {
  return sourcePlacementId ? { id: sourcePlacementId, height: originRect?.height ?? 0 } : null;
}

export const dragState = {
  start(info: {
    course: Course;
    sourcePlacementId: string | null;
    home?: DropTarget | null;
    startX: number;
    startY: number;
    originRect?: OriginRect;
    sourceEl?: HTMLElement | null;
    /** The pointer driving the drag. useDragSource also binds it right after
     *  onStart (bindPointer), for callers that don't pass it. */
    pointerId?: number | null;
  }): string {
    clearEndTimer();
    const sessionId = mintSessionId();
    _state = {
      sessionId,
      courseId: info.course.id,
      course: info.course,
      sourcePlacementId: info.sourcePlacementId,
      home: info.home ?? null,
      originRect: info.originRect ?? null,
      sourceEl: info.sourceEl ?? null,
      startX: info.startX,
      startY: info.startY,
      currentX: info.startX,
      currentY: info.startY,
      over: resolveOver(
        info.startX,
        info.startY,
        moverOf(info.sourcePlacementId, info.originRect ?? null)
      ),
      phase: "dragging",
      drop: null,
      dropRect: null,
      pointerId: info.pointerId ?? null,
    };
    beginDragSelectionGuard();
    notify();
    notifyPosition();
    return sessionId;
  },

  /** Bind the active drag to the pointer that started it. No-op without an
   *  active drag, or when it is already bound. */
  bindPointer(pointerId: number) {
    if (!_state || _state.phase !== "dragging" || _state.pointerId !== null) return;
    _state = { ..._state, pointerId };
  },

  /** Does `pointerId` drive the active drag? An unbound drag accepts any
   *  pointer (back-compat); no drag → false. */
  ownsPointer(pointerId: number): boolean {
    if (!_state) return false;
    return _state.pointerId === null || _state.pointerId === pointerId;
  },

  /** Track the cursor (AppShell's document pointermove; also re-run after an
   *  edge auto-scroll moves the canvas under a still cursor). */
  move(x: number, y: number) {
    if (!_state || _state.phase !== "dragging") return;
    _state.currentX = x;
    _state.currentY = y;
    const over = resolveOver(x, y, moverOf(_state.sourcePlacementId, _state.originRect));
    if (!sameTarget(over, _state.over)) {
      _state = { ..._state, over };
      notify();
    }
    notifyPosition();
  },

  /** Release: land on the current insertion point (or return home if none). */
  drop() {
    if (!_state || _state.phase !== "dragging") return;
    const target = _state.over;
    let dropRect: OriginRect = null;
    if (target && typeof document !== "undefined") {
      const outline = document.querySelector<HTMLElement>("[data-drop-outline]");
      if (outline) dropRect = toRect(outline.getBoundingClientRect());
    }
    _state = { ..._state, phase: "dropping", drop: target, dropRect, over: null };
    armEndFallback(_state.sessionId);
    notify();
  },

  /** Esc / pointercancel / blur: no commit; the ghost returns home. */
  cancel() {
    if (!_state || _state.phase !== "dragging") return;
    _state = { ..._state, phase: "dropping", drop: null, dropRect: null, over: null };
    armEndFallback(_state.sessionId);
    notify();
  },

  /**
   * Finish the drag. With a session id, only that session is ended (a late
   * animation callback from a previous drag can't kill the next one). Always
   * safe to call; idempotent.
   */
  end(sessionId?: string) {
    if (_state && sessionId !== undefined && _state.sessionId !== sessionId) return;
    clearEndTimer();
    const had = _state !== null;
    _state = null;
    endDragSelectionGuard();
    if (had) notify();
  },

  get(): DragInfo | null {
    return _state;
  },

  subscribe(fn: () => void): () => void {
    _listeners.add(fn);
    return () => {
      _listeners.delete(fn);
    };
  },

  subscribeToPosition(fn: () => void): () => void {
    _positionListeners.add(fn);
    return () => {
      _positionListeners.delete(fn);
    };
  },
};

function armEndFallback(sessionId: string) {
  clearEndTimer();
  _endTimer = setTimeout(() => {
    _endTimer = null;
    dragState.end(sessionId);
  }, END_FALLBACK_MS);
}

/**
 * The committed card's viewport rect once React has rendered it at its landing
 * spot (fix pass D3): placement `placementId` inside column `target.sem`, at
 * the resolved index (clamped — past the end means appended). Null while the
 * DOM still shows the card somewhere else (the commit hasn't rendered yet) or
 * it can't be found, so the caller can retry next frame or fall back to the
 * outline rect captured at drop().
 */
export function measureLandedCard(placementId: string, target: DropTarget): OriginRect {
  if (typeof document === "undefined") return null;
  const col = document.querySelector<HTMLElement>(`[data-column="${target.sem}"]`);
  if (!col) return null;
  const cards = Array.from(col.querySelectorAll<HTMLElement>("[data-placement]"));
  const at = cards.findIndex((el) => el.dataset.placement === placementId);
  if (at < 0 || at !== Math.min(target.index, cards.length - 1)) return null;
  const r = cards[at].getBoundingClientRect();
  return r.width > 0 ? toRect(r) : null;
}

/** Which canvas edges may auto-scroll during the current drag (fix pass D7). */
export type EdgeArming = { left: boolean; right: boolean; up: boolean; down: boolean };

export const DISARMED_EDGES: EdgeArming = { left: false, right: false, up: false, down: false };

/**
 * Edge auto-scroll velocity for a pointer at (x, y) — pure, so the rules are
 * unit-testable (AppShell supplies the DOM probe).
 *
 *  - Only while the pointer is over the canvas itself: never while it is over
 *    the catalog drawer, the detail panel or any other overlay.
 *  - "Near an edge" = a point `edge` px further out is NOT canvas, i.e. the
 *    canvas edge that is actually visible (at the drawer's edge when it's open).
 *  - Each edge is ARMED only once the pointer has been over the canvas outside
 *    that edge's zone during this drag. A catalog drag starts inside the drawer
 *    and enters the canvas THROUGH the drawer-side zone; without arming, that
 *    crossing scrolled the board 140–154px under the user (the e2e run).
 *    Deliberately returning to an edge still scrolls.
 */
export function edgeScrollVelocity(
  inCanvas: (x: number, y: number) => boolean,
  x: number,
  y: number,
  armed: EdgeArming,
  edge: number,
  speed: number
): { velX: number; velY: number; armed: EdgeArming } {
  if (!inCanvas(x, y)) return { velX: 0, velY: 0, armed };
  const atRight = !inCanvas(x + edge, y);
  const atLeft = !inCanvas(x - edge, y);
  const atDown = !inCanvas(x, y + edge);
  const atUp = !inCanvas(x, y - edge);
  const next: EdgeArming = {
    right: armed.right || !atRight,
    left: armed.left || !atLeft,
    down: armed.down || !atDown,
    up: armed.up || !atUp,
  };
  const velX = atRight && next.right ? speed : atLeft && next.left ? -speed : 0;
  const velY = atDown && next.down ? speed : atUp && next.up ? -speed : 0;
  return { velX, velY, armed: next };
}
