import type { Course } from "@/types/db";

type DragPhase = "dragging" | "dropping" | "trashing";

export type DragInfo = {
  courseId: string;
  course: Course | null;
  sourceSlotId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  overSlotId: string | null;
  overTrashBin: boolean;
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
      overTrashBin: false,
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

    const trashEl = els.find((el) => (el as HTMLElement).dataset.trashBin);
    const newOverTrash = !!trashEl;

    const slotEl = els.find(
      (el) =>
        (el as HTMLElement).dataset.slot && !el.closest("[data-drag-ghost]")
    ) as HTMLElement | undefined;
    const newSlotId = newOverTrash ? null : (slotEl?.dataset.slot ?? null);

    let changed = false;
    if (newSlotId !== _state.overSlotId) {
      _state.overSlotId = newSlotId;
      changed = true;
    }
    if (newOverTrash !== _state.overTrashBin) {
      _state.overTrashBin = newOverTrash;
      changed = true;
    }
    if (changed) notify();

    notifyPosition();
  },

  startDrop(targetSlotId: string | null) {
    if (!_state) return;
    _state.phase = "dropping";
    _state.dropTargetId = targetSlotId;
    notify();
  },

  startTrashDrop() {
    if (!_state) return;
    _state.phase = "trashing";
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
