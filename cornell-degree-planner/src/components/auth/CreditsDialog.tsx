import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { EXAM_TABLES } from "@/data/credit-tables";
import type { ExamTables } from "@/lib/credit/types";
import { CreditsEditor } from "@/components/credits/CreditsEditor";
import type { ExamFills } from "@/components/credits/ExamRow";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
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
 * Content (spec 028): the shared CreditsEditor (exam score buttons + transfer
 * courses), seeded from the student's saved creditProfile each time the
 * dialog opens. Spec 045 D4/D8: ~980px wide with the editor's side list, the
 * roomy type scale; header and footer stay put and only the editor's right
 * pane scrolls. Save replaces the whole profile (AuthProvider.setCreditProfile
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
  // What each saved exam fills on the board, so the editor words its lines
  // the way the Requirements page's credit card does.
  const { creditFills } = useRequirementProgress();
  const examFills = useMemo<ExamFills>(() => {
    const out: ExamFills = {};
    for (const e of creditProfile) {
      const requirements = creditFills?.[e.id];
      if (e.exam && e.score && requirements) out[e.exam] = { score: e.score, requirements };
    }
    return out;
  }, [creditProfile, creditFills]);
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
  // restore it on close, and keep Tab cycling inside the panel (first/last
  // wrap). Controls in a hidden section, and roving tabs out of the Tab
  // order, don't count as first or last.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.tabIndex >= 0 && !el.closest("[hidden]"));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => {
      window.removeEventListener("keydown", onTab);
      previouslyFocused?.focus?.();
    };
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
        className="type-roomy relative flex h-[800px] max-h-[88vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-6 py-4">
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

        <CreditsEditor
          draft={draft}
          onChange={setDraft}
          tables={tables}
          examFills={examFills}
          className="flex-1"
        />

        <div className="flex items-center gap-3 border-t border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="t-meta text-ink-4">
              Based on Cornell&apos;s published credit tables — verify with your
              college registrar.
            </p>
            {status === "error" && (
              <p className="mt-1 t-meta text-destructive-text">
                Couldn&apos;t save your credits — check your connection and try again.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onClose}
              className="min-h-11 rounded-lg border border-line-strong px-6 t-body font-semibold text-ink-2 transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="min-h-11 rounded-lg bg-ink px-7 t-body font-semibold text-canvas transition-colors hover:opacity-90 disabled:opacity-60"
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
