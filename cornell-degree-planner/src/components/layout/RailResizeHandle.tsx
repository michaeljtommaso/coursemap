import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  LEFT_RAIL_DEFAULT,
  LEFT_RAIL_MAX,
  LEFT_RAIL_MIN,
  usePlannerStore,
} from "@/store/usePlannerStore";

/** Arrow-key step, px. Shift moves four steps. */
const STEP = 16;

/**
 * RailResizeHandle — the left rail's right edge, draggable to widen the rail
 * (the Still-needed checklist wraps long CAS/CALS requirement names onto many
 * lines at the old fixed 224 px). A vertical separator: drag with a pointer,
 * ←/→ by keyboard (Home/End for the bounds), double-click to reset. The width
 * persists in usePlannerStore with the other view preferences.
 */
export function RailResizeHandle() {
  const width = usePlannerStore((s) => s.leftRailWidth);
  const setWidth = usePlannerStore((s) => s.setLeftRailWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    document.body.classList.add("rail-resizing");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(drag.current.startWidth + (e.clientX - drag.current.startX));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("rail-resizing");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const next =
      e.key === "ArrowRight"
        ? width + step
        : e.key === "ArrowLeft"
          ? width - step
          : e.key === "Home"
            ? LEFT_RAIL_MIN
            : e.key === "End"
              ? LEFT_RAIL_MAX
              : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={LEFT_RAIL_MIN}
      aria-valuemax={LEFT_RAIL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-rail-resize
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setWidth(LEFT_RAIL_DEFAULT)}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none",
        "focus-visible:[&>span]:bg-drop"
      )}
    >
      {/* The visible line: hairline at rest, accent while hovered or dragged. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-drop group-active:bg-drop"
      />
    </div>
  );
}
