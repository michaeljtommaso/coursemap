import { useEffect, useRef, type RefObject } from "react";

/**
 * Close an open popover on Escape or a press outside `inside` (the popover and
 * the control that opened it). Presses on the planner tour's overlay belong to
 * the tour and never close it (the same rule as TopBarMenu).
 */
export function usePopoverDismiss(
  open: boolean,
  inside: RefObject<HTMLElement | null>[],
  onClose: (reason: "escape" | "outside") => void
) {
  const latest = useRef({ inside, onClose });
  useEffect(() => {
    latest.current = { inside, onClose };
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      latest.current.onClose("escape");
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (latest.current.inside.some((r) => r.current?.contains(t))) return;
      if ((t as Element).closest?.('[aria-label="Planner tour"]')) return;
      latest.current.onClose("outside");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);
}
