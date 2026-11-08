/**
 * Tooltip (spec 041) — the app's own hover help, replacing the browser's
 * `title` box. Ported from house-standard's shared tooltip.
 *
 *   <Tooltip content="Rename your plan"><button …>…</button></Tooltip>
 *
 * - Wraps ONE element. Hover opens it after `delay` ms; keyboard focus opens it
 *   at once. Escape, blur, mouse-leave, scroll, resize and a pointer press close
 *   it (a press starts drags on the board; the bubble must not ride along).
 * - Hover and keyboard only: touch gets nothing, as with `title`.
 * - The bubble is portalled to <body> so scroll areas and stacking contexts
 *   can't clip it; it prefers `placement`, flips top↔bottom when it wouldn't
 *   fit, and is clamped into the viewport.
 * - `role="tooltip"`, linked from the trigger with aria-describedby while open.
 *   It doesn't name the trigger: an icon-only control keeps its own aria-label.
 * - No `content` → the child renders untouched.
 * - A disabled child gets no mouse events, so it's wrapped in an inline span
 *   that does.
 * - `truncatedOnly`: open only when the trigger's text is cut off
 *   (scrollWidth > clientWidth), for `truncate` labels.
 * - A string `content` is also written to the trigger as `data-tooltip`, so
 *   static-markup tests and browser tests can find it.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

const GAP = 6; // px between trigger and bubble
const MARGIN = 8; // min px from the viewport edge

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  disabled?: boolean;
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

export type TooltipProps = {
  content: ReactNode;
  placement?: TooltipPlacement;
  /** Hover delay in ms (focus is immediate). */
  delay?: number;
  /** Only open when the trigger's text is cut off by an ellipsis. */
  truncatedOnly?: boolean;
  children: ReactNode;
};

/** True for keyboard focus (:focus-visible); true where the selector isn't supported. */
function isKeyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref && typeof ref === "object") (ref as { current: T | null }).current = node;
}

export function Tooltip({ content, placement = "top", delay = 400, truncatedOnly = false, children }: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: TooltipPlacement; ready: boolean }>({
    top: 0,
    left: 0,
    placement,
    ready: false,
  });

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      const el = triggerRef.current;
      if (truncatedOnly && el && el.scrollWidth <= el.clientWidth) return;
      if (immediate || delay <= 0) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay, truncatedOnly]
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos((p) => (p.ready ? { ...p, ready: false } : p));
  }, []);

  // Place the bubble against the trigger, flipping/clamping to stay on screen.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !bubbleRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const b = bubbleRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let place = placement;
    if (place === "top" && t.top - b.height - GAP < MARGIN) place = "bottom";
    else if (place === "bottom" && t.bottom + b.height + GAP > vh - MARGIN) place = "top";
    else if (place === "left" && t.left - b.width - GAP < MARGIN) place = "right";
    else if (place === "right" && t.right + b.width + GAP > vw - MARGIN) place = "left";

    let top: number;
    let left: number;
    if (place === "top" || place === "bottom") {
      top = place === "top" ? t.top - b.height - GAP : t.bottom + GAP;
      left = t.left + t.width / 2 - b.width / 2;
    } else {
      left = place === "left" ? t.left - b.width - GAP : t.right + GAP;
      top = t.top + t.height / 2 - b.height / 2;
    }
    left = Math.max(MARGIN, Math.min(left, vw - b.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - b.height - MARGIN));
    setPos({ top, left, placement: place, ready: true });
  }, [open, placement, content]);

  // While open: Escape closes; scroll/resize close (cheaper than re-tracking).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  useEffect(() => clearTimer, []);

  // One stable callback ref for the trigger that also feeds the child's own ref.
  const childRef = isValidElement(children) ? (children.props as TriggerProps).ref : undefined;
  const setTrigger = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childRef, node);
    },
    [childRef]
  );
  const setDisabledTrigger = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  if (content == null || content === false || content === "" || !isValidElement(children)) return <>{children}</>;

  const el = children as ReactElement<TriggerProps>;
  const props = el.props;
  const handlers = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      show(false);
      props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      hide();
      props.onMouseLeave?.(e);
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      // Only keyboard focus: a click also focuses, and the press already closed it.
      if (isKeyboardFocus(e.target)) show(true);
      props.onFocus?.(e);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      hide();
      props.onBlur?.(e);
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      hide();
      props.onPointerDown?.(e);
    },
  };
  const describedBy = open ? [props["aria-describedby"], tipId].filter(Boolean).join(" ") : props["aria-describedby"];
  const dataTooltip = typeof content === "string" ? content : undefined;

  const trigger = props.disabled ? (
    // Disabled controls fire no mouse events; the span takes the hover.
    <span
      ref={setDisabledTrigger}
      className="inline-flex"
      data-tooltip={dataTooltip}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
    >
      {children}
    </span>
  ) : (
    // cloneElement only attaches the ref and handlers; none of them run during render.
    // eslint-disable-next-line react-hooks/refs
    cloneElement(el, {
      ref: setTrigger,
      ...handlers,
      "aria-describedby": describedBy,
      ...(dataTooltip !== undefined ? { "data-tooltip": dataTooltip } : {}),
    } as Partial<TriggerProps>)
  );

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            data-placement={pos.placement}
            className="tooltip-bubble pointer-events-none fixed max-w-[320px] whitespace-normal rounded-md border border-line bg-surface px-2 py-1 text-left text-xs font-medium leading-snug text-ink-2 shadow-md"
            style={{ top: pos.top, left: pos.left, zIndex: "var(--z-tooltip)", visibility: pos.ready ? "visible" : "hidden" }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
