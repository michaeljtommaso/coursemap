import type { Course } from "@/types/db";

type DragPhase = "dragging" | "dropping";

export type DragInfo = {
  courseId: string;
  course: Course | null;
  sourceSlotId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  overSlotId: string | null;
  phase: DragPhase;
  dropTargetId: string | null;
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

export const dragState = {
  start(info: {
    courseId: string;
    course: Course | null;
    sourceSlotId: string | null;
    startX: number;
    startY: number;
  }) {
    _state = {
      ...info,
      currentX: info.startX,
      currentY: info.startY,
      overSlotId: null,
      phase: "dragging",
      dropTargetId: null,
    };
    notify();
  },

  move(x: number, y: number) {
    if (!_state || _state.phase !== "dragging") return;
    _state.currentX = x;
    _state.currentY = y;

    const els = document.elementsFromPoint(x, y);

    const slotEl = els.find(
      (el) =>
        (el as HTMLElement).dataset.slot && !el.closest("[data-drag-ghost]")
    ) as HTMLElement | undefined;
    const newSlotId = slotEl?.dataset.slot ?? null;

    if (newSlotId !== _state.overSlotId) {
      _state.overSlotId = newSlotId;
      notify();
    }

    notifyPosition();
  },

  startDrop(targetSlotId: string | null) {
    if (!_state) return;
    _state.phase = "dropping";
    _state.dropTargetId = targetSlotId;
    notify();
  },

  end() {
    _state = null;
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
