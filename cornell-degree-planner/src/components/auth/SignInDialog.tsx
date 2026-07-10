import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cloud, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * SignInDialog (spec 006 §C1) — the app's FIRST true modal. Everything else in
 * the app confirms inline (two-step) or slides a visual-only drawer; this one
 * deliberately blocks. Rationale (spec 006 §C1/§C2): "Save your plan" used to
 * fire a cold Google popup with no explanation (triage #23) — the dialog IS the
 * explanation. It states the value before the popup opens.
 *
 * Contrast with the catalog drawer's `pointer-events-none` backdrop: here the
 * backdrop is BLOCKING (real scrim, catches the outside-click). Painted at
 * `--z-modal` (above the TopBar and its trapped dropdown subtree, above the
 * sidebar drawer). Esc / outside-click / × all close it.
 *
 * State machine over one linkGoogle() call (AuthProvider):
 *   idle    → the Google button
 *   loading → popup open (button busy)
 *   cancelled → user closed the popup: back to idle, NO error (triage #22)
 *   linked  → success; on `fellBackToSignIn` a note names it ("signed into your
 *             existing account"), then the dialog closes (isAnonymous flips and
 *             the trigger disappears anyway)
 *   error   → inline message, retryable
 */

type Status = "idle" | "loading" | "linked" | "error";

export function SignInDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { linkGoogle } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [fellBack, setFellBack] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to a clean slate every time it opens; clear any pending auto-close.
  useEffect(() => {
    if (open) {
      setStatus("idle");
      setFellBack(false);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  // Esc closes — but never mid-popup (the popup owns focus then anyway).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "loading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, status, onClose]);

  if (!open) return null;

  const handleGoogle = async () => {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const { fellBackToSignIn, cancelled } = await linkGoogle();
      if (cancelled) {
        // User closed the popup — their choice, not a failure (triage #22).
        setStatus("idle");
        return;
      }
      setFellBack(fellBackToSignIn);
      setStatus("linked");
      // They're signed in now; let the success note land, then close.
      closeTimer.current = setTimeout(onClose, 1600);
    } catch (err) {
      console.warn("[signin] linkGoogle failed", err);
      setStatus("error");
    }
  };

  const onBackdrop = () => {
    if (status !== "loading") onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-title"
    >
      {/* Blocking scrim — real pointer events (unlike the drawer's scrim). */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onBackdrop}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl"
      >
        <button
          onClick={onClose}
          disabled={status === "loading"}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <div className="mb-1 rounded-2xl bg-ink p-2.5 text-canvas">
            <Cloud className="h-5 w-5" />
          </div>
          <h2 id="signin-title" className="t-headline">
            Save your plan
          </h2>
          <p className="t-body text-ink-2">
            Sign in with Google and your plan is saved to your account — reach it
            from any device, and your share links stay yours. Your Cornell email
            is a Google account.
          </p>
        </div>

        {status === "linked" ? (
          <div className="mt-5 flex flex-col items-center gap-1.5 rounded-lg border border-complete/40 bg-complete-tint px-4 py-3 text-center">
            <Check className="h-5 w-5 text-complete-text" />
            <p className="t-body font-semibold text-complete-text">
              {fellBack ? "Signed into your existing account" : "Your plan is saved"}
            </p>
            <p className="t-meta text-complete-text/80">
              {fellBack
                ? "We found the account you'd used before and switched you to it."
                : "It'll follow you to any device from now on."}
            </p>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={handleGoogle}
              disabled={status === "loading"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 t-body font-semibold transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              <GoogleGlyph />
              {status === "loading" ? "Opening Google…" : "Continue with Google"}
            </button>
            {status === "error" && (
              <p className="t-meta text-center text-destructive-text">
                Something went wrong signing in. Please try again.
              </p>
            )}
            <p className="t-meta text-center text-ink-4">
              You can keep planning without signing in — this just saves it.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Google "G" mark — inline SVG (no asset dependency, themes for free since the
 *  brand colors are fixed, on a neutral surface in both light and dark). */
function GoogleGlyph() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18a13.2 13.2 0 0 1 0-8.36v-5.7H4.34a22 22 0 0 0 0 19.76l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.94 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
