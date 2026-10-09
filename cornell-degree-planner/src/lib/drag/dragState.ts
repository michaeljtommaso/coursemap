import type { Course } from "@/types/db";

type DragPhase = "dragging" | "dropping";

/** The source element's viewport rect at drag start (spec 006 §F1). A failed
 *  drop springs the ghost back HERE before vanishing, so a mis-drop reads as
 *  "returned home" rather than "disappeared." Captured from the drag source's
 *  getBoundingClientRect(); null when unavailable (e.g. the catalog drawer
 *  closed mid-drag), in which case DragGhost keeps the old vanish. */
export type OriginRect = { left: number; top: number; width: number; height: number } | null;

/**
 * Drag modes:
 *  - "course": a course travels (from the catalog, or a board card — then
 *    `sourceSlotId` is its PLACEMENT id, spec 014). DragGhost commits the drop
 *    as add/move-placement into the target column.
 *  - "slot": legacy (spec 005 §9 unfilled-slot moves); nothing starts it in
 *    the placement model. Retired with the drag-engine rework (spec 014 §D3).
 */
export type DragMode = "course" | "slot";

export type DragInfo = {
  mode: DragMode;
  /** Stable key for the ghost lifecycle (courseId in course mode, slotId in slot mode). */
  dragKey: string;
  courseId: string | null;
  course: Course | null;
  /** course mode: the placement the course came from (null = catalog). slot mode: the moving placement. */
  sourceSlotId: string | null;
  /** slot mode: display strings for the ghost. */
  slotLabel: { eyebrow: string; title: string } | null;
  /** Source rect at drag start (spec 006 §F1) — failed-drop return target. */
  originRect: OriginRect;
  /** The source DOM element itself, so a failed drop can RE-measure it at drop
   *  time — the canvas may have scrolled mid-drag, making originRect stale.
   *  Falls back to originRect when disconnected (e.g. drawer closed mid-drag). */
  sourceEl: HTMLElement | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  overSlotId: string | null;
  overColumnSem: number | null;
  phase: DragPhase;
  dropTargetId: string | null;
  dropColumnSem: number | null;
};

let _state: DragInfo | null = null;
const _listeners = new Set<() => void>();
const _positionListeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}
function notifyPosition() {
  _positionListeners.forEach((fn) => fn());
}

// Bug #3 (triage): the custom drag system has no native drag image, so
// without this a fast pointermove during drag selects surrounding text.
// Toggled on document.body for the lifetime of any drag (course or slot,
// dropped or cancelled) — see `globals.css` for the paired rule — so every
// drag source (catalog chips, roadmap slot cards) is covered without each
// one wiring up its own listeners.
const DRAG_ACTIVE_CLASS = "dragging-active";

function beginDragSelectionGuard() {
  document.body.classList.add(DRAG_ACTIVE_CLASS);
  // A selection can already exist from the pointerdown→threshold window;
  // user-select:none blocks new selection but doesn't clear that one.
  window.getSelection()?.removeAllRanges();
}

function endDragSelectionGuard() {
  document.body.classList.remove(DRAG_ACTIVE_CLASS);
}

export const dragState = {
  start(info: {
    courseId: string;
    course: Course | null;
    sourceSlotId: string | null;
    startX: number;
    startY: number;
    originRect?: OriginRect;
    sourceEl?: HTMLElement | null;
  }) {
    _state = {
      mode: "course",
      dragKey: info.courseId,
      ...info,
      originRect: info.originRect ?? null,
      sourceEl: info.sourceEl ?? null,
      slotLabel: null,
      currentX: info.startX,
      currentY: info.startY,
      overSlotId: null,
      overColumnSem: null,
      phase: "dragging",
      dropTargetId: null,
      dropColumnSem: null,
    };
    beginDragSelectionGuard();
    notify();
  },

  startSlotMove(info: {
    slotId: string;
    slotLabel: { eyebrow: string; title: string };
    startX: number;
    startY: number;
    originRect?: OriginRect;
    sourceEl?: HTMLElement | null;
  }) {
    _state = {
      mode: "slot",
      dragKey: info.slotId,
      courseId: null,
      course: null,
      sourceSlotId: info.slotId,
      slotLabel: info.slotLabel,
      originRect: info.originRect ?? null,
      sourceEl: info.sourceEl ?? null,
      startX: info.startX,
      startY: info.startY,
      currentX: info.startX,
      currentY: info.startY,
      overSlotId: null,
      overColumnSem: null,
      phase: "dragging",
      dropTargetId: null,
      dropColumnSem: null,
    };
    beginDragSelectionGuard();
    notify();
  },

  move(x: number, y: number) {
    if (!_state || _state.phase !== "dragging") return;
    _state.currentX = x;
    _state.currentY = y;

    const els = document.elementsFromPoint(x, y);

    // Slots only accept COURSES; in slot mode we track columns exclusively.
    const slotEl =
      _state.mode === "course"
        ? (els.find(
            (el) =>
              (el as HTMLElement).dataset.slot && !el.closest("[data-drag-ghost]")
          ) as HTMLElement | undefined)
        : undefined;
    const newSlotId = slotEl?.dataset.slot ?? null;

    const colEl = els.find(
      (el) => (el as HTMLElement).dataset.column && !el.closest("[data-drag-ghost]")
    ) as HTMLElement | undefined;
    const newColumnSem = colEl ? Number(colEl.dataset.column) : null;

    if (newSlotId !== _state.overSlotId || newColumnSem !== _state.overColumnSem) {
      _state.overSlotId = newSlotId;
      _state.overColumnSem = newColumnSem;
      notify();
    }

    notifyPosition();
  },

  startDrop(targetSlotId: string | null, targetColumnSem: number | null = null) {
    if (!_state) return;
    _state.phase = "dropping";
    _state.dropTargetId = targetSlotId;
    _state.dropColumnSem = targetColumnSem;
    notify();
  },

  end() {
    _state = null;
    // Runs on every path out of a drag — successful drop, drop on empty
    // space, and pointercancel (see AppShell's handleCancel) all funnel
    // through DragGhost into this call — so the selection guard never gets
    // stuck on.
    endDragSelectionGuard();
    notify();
  },

  get(): DragInfo | null {
    return _state;
  },

  subscribe(fn: () => void): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  subscribeToPosition(fn: () => void): () => void {
    _positionListeners.add(fn);
    return () => _positionListeners.delete(fn);
  },
};
