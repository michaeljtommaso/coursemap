import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { EXAM_TABLES } from "@/data/credit-tables";
import type { ExamTables } from "@/lib/credit/types";
import { CreditsEditor } from "@/components/credits/CreditsEditor";
import {
  EMPTY_DRAFT,
  draftChanged,
  draftFromProfile,
  draftToEntries,
  type CreditDraft,
} from "@/components/credits/creditDraft";

/**
 * CreditsDialog (spec 007 §2b/§5, Unit 7C2) — the editable credit-profile
 * surface, modeled on SignInDialog's portal/scrim/focus idiom (same blocking
 * backdrop, same Esc/outside-click/× close, same panel shell). Opened from
 * AccountButton's "My credits" menuitem or a card/panel "Add AP credit"
 * deep-link; open state lives in usePlannerStore (creditsOpen/setCreditsOpen,
 * mirroring signInOpen exactly).
 *
 * Content (spec 025): the shared CreditsEditor (exam score buttons + transfer
 * courses), seeded from the student's saved creditProfile each time the
 * dialog opens. Save replaces the whole profile (AuthProvider.setCreditProfile
 * — whole-array write, no merge, same policy as setEnteringYear); Cancel
 * closes without saving.
 */

export function CreditsDialog({
  open,
  onClose,
  tables = EXAM_TABLES,
}: {
  open: boolean;
  onClose: () => void;
  /** Injected by tests; the app uses the bundled tables. */
  tables?: ExamTables | null;
}) {
  const { creditProfile, setCreditProfile } = useAuth();
  const [draft, setDraft] = useState<CreditDraft>(EMPTY_DRAFT);
  // SignInDialog's state-machine idiom (idle | loading | error): a failed
  // write must return to an actionable state — Save re-enabled, selections
  // intact, a quiet inline error — never a forever-disabled "Saving…".
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const panelRef = useRef<HTMLDivElement>(null);

  // Reseed from the saved profile every time the dialog opens (matches
  // SignInDialog's "clean slate on open" pattern). Done during render on the
  // closed→open transition (React's "adjust state when a prop changes"
  // idiom) rather than in an effect — no cascading render, and a background
  // profile refresh while the dialog is open can't clobber in-progress picks.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(draftFromProfile(creditProfile, tables));
      setStatus("idle");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus management — same shape as SignInDialog: move focus in on open,
  // restore it on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    if (status === "saving") return;
    // Nothing changed: close without a write.
    if (!draftChanged(draft, creditProfile, tables)) {
      onClose();
      return;
    }
    setStatus("saving");
    const entries = draftToEntries(draft, tables);
    try {
      await setCreditProfile(entries);
      onClose();
    } catch (err) {
      // Real error to the console for debugging; students get calm generic
      // copy, never a Firestore error code. Selections stay — retry is one click.
      console.warn("[credits] setCreditProfile failed", err);
      setStatus("error");
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-title"
    >
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-6 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink text-canvas">
            <GraduationCap className="h-4 w-4" />
          </span>
          <h2 id="credits-title" className="t-headline">
            Your AP, IB and transfer credit
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 rounded-md p-1 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <CreditsEditor draft={draft} onChange={setDraft} tables={tables} />
        </div>

        <div className="border-t border-line px-6 py-4">
          <p className="mb-3 t-meta text-ink-4">
            Based on Cornell&apos;s published credit tables — verify with your
            college registrar.
          </p>
          {status === "error" && (
            <p className="mb-2 t-meta text-destructive-text">
              Couldn&apos;t save your credits — check your connection and try again.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-line-strong px-3.5 py-2 t-body font-semibold text-ink-2 transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="flex-1 rounded-lg bg-ink px-3.5 py-2 t-body font-semibold text-canvas transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {status === "saving" ? "Saving…" : status === "error" ? "Try again" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
