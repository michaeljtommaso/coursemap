import type { Course } from "@/types/db";

type DragPhase = "dragging" | "dropping";

/**
 * Drag modes (spec 005 §9):
 *  - "course": a course travels (from the catalog or out of a slot). Drop on a
 *    slot places it; drop on a column background re-homes it into a new custom
 *    slot in that semester.
 *  - "slot": an UNFILLED card travels — the slot itself moves to the semester
 *    whose column background it's dropped on.
 */
export type DragMode = "course" | "slot";

export type DragInfo = {
  mode: DragMode;
  /** Stable key for the ghost lifecycle (courseId in course mode, slotId in slot mode). */
  dragKey: string;
  courseId: string | null;
  course: Course | null;
  /** course mode: the slot the course came from (null = catalog). slot mode: the moving slot. */
  sourceSlotId: string | null;
  /** slot mode: display strings for the ghost. */
  slotLabel: { eyebrow: string; title: string } | null;
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
  }) {
    _state = {
      mode: "course",
      dragKey: info.courseId,
      ...info,
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
  }) {
    _state = {
      mode: "slot",
      dragKey: info.slotId,
      courseId: null,
      course: null,
      sourceSlotId: info.slotId,
      slotLabel: info.slotLabel,
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
