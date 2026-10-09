import type { Course } from "@/types/db";
import {
  nearestColumn,
  resolveInsertionIndex,
  sameTarget,
  type DropTarget,
  type MeasuredCard,
  type MeasuredColumn,
} from "@/lib/drag/insertion";

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
 *              callback can never leave the body class or state stuck.
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
  /** The placeholder outline's viewport rect at drop time — where the ghost
   *  settles (the outline itself unmounts as the drop commits). */
  dropRect: OriginRect;
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
 *  - The index counts the column's other cards' midpoints above y.
 */
function resolveOver(x: number, y: number, moverId: string | null): DropTarget | null {
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

  const cards: MeasuredCard[] = [];
  for (const el of Array.from(colEl.querySelectorAll<HTMLElement>("[data-placement]"))) {
    const r = el.getBoundingClientRect();
    cards.push({ id: el.dataset.placement ?? "", top: r.top, height: r.height });
  }
  return { sem, index: resolveInsertionIndex(cards, y, moverId) };
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
      over: resolveOver(info.startX, info.startY, info.sourcePlacementId),
      phase: "dragging",
      drop: null,
      dropRect: null,
    };
    beginDragSelectionGuard();
    notify();
    notifyPosition();
    return sessionId;
  },

  /** Track the cursor (AppShell's document pointermove; also re-run after an
   *  edge auto-scroll moves the canvas under a still cursor). */
  move(x: number, y: number) {
    if (!_state || _state.phase !== "dragging") return;
    _state.currentX = x;
    _state.currentY = y;
    const over = resolveOver(x, y, _state.sourcePlacementId);
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
