import { useRef } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

/** Arrow-key step, px. Shift moves four steps. */
const STEP = 16;

/**
 * ResizeHandle — a vertical separator on one edge of a column, draggable to
 * change the column's width. Drag with a pointer, ←/→ by keyboard (Home/End
 * for the bounds), double-click to reset. `edge` is the side of the column the
 * handle sits on: "right" widens as the pointer moves right (a left rail),
 * "left" widens as it moves left (a right-hand panel). The parent must be
 * `relative`; the caller owns the width and clamps it in `onChange`.
 */
export function ResizeHandle({
  edge,
  width,
  min,
  max,
  onChange,
  onReset,
  label,
  getStartWidth,
  className,
  ...data
}: {
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onReset: () => void;
  label: string;
  /** The width a drag starts from, when `width` isn't the rendered one. */
  getStartWidth?: () => number;
  className?: string;
} & { [dataAttr: `data-${string}`]: boolean | string | undefined }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const sign = edge === "right" ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: getStartWidth?.() ?? width };
    document.body.classList.add("rail-resizing");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(drag.current.startWidth + sign * (e.clientX - drag.current.startX));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("rail-resizing");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? STEP * 4 : STEP) * sign;
    const start = getStartWidth?.() ?? width;
    const next =
      e.key === "ArrowRight"
        ? start + step
        : e.key === "ArrowLeft"
          ? start - step
          : e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
  };

  return (
    <Tooltip content="Drag to resize · double-click to reset" placement={edge === "right" ? "right" : "left"}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        {...data}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        className={cn(
          "group absolute inset-y-0 z-20 w-3 cursor-col-resize touch-none outline-none",
          edge === "right" ? "-right-1.5" : "-left-1.5",
          "focus-visible:[&>span]:bg-drop",
          className
        )}
      >
        {/* The visible line: hairline at rest, accent while hovered or dragged. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-drop group-active:bg-drop"
        />
      </div>
    </Tooltip>
  );
}
