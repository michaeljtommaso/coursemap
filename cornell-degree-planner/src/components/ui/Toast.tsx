import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlannerStore } from "@/store/usePlannerStore";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Toast (spec 009 §2/§4) — the app's one transient notice. Bottom-center, a
 * message plus an OPTIONAL single action (the replace/undo affordance; the C4
 * program-switch summary shows no action). Portal-rendered so no canvas
 * `overflow-hidden` clips it, auto-dismisses after 6s, and is announced politely
 * (`role="status"` / `aria-live="polite"`). Reduced motion skips the slide-in.
 *
 * State + the action callback live in usePlannerStore (showToast/dismissToast +
 * toastAction). This component is presentation only; there is exactly one
 * mounted in AppShell.
 */

const DISMISS_MS = 6000;

export function Toast() {
  const toast = usePlannerStore((s) => s.toast);
  const toastAction = usePlannerStore((s) => s.toastAction);
  const dismissToast = usePlannerStore((s) => s.dismissToast);
  const cardRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss. Keyed on `toast?.key` so each showToast restarts the timer.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismissToast, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [toast?.key, toast, dismissToast]);

  if (!toast) return null;

  const onAction = () => {
    toastAction?.();
    dismissToast();
  };

  const reduce = prefersReducedMotion();

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[var(--z-toast)] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        ref={cardRef}
        key={toast.key}
        style={reduce ? undefined : { animation: "toast-in .22s cubic-bezier(.2,.9,.3,1)" }}
        className="pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 shadow-xl"
      >
        <span className="t-body text-ink">{toast.message}</span>
        {toast.actionLabel && (
          <button
            onClick={onAction}
            className="flex-none rounded-md px-2 py-1 t-label font-bold text-drop-text transition-colors hover:bg-drop-tint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          onClick={dismissToast}
          aria-label="Dismiss"
          className="flex-none rounded px-1 t-label text-ink-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
        >
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}
