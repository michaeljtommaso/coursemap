import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";
import { CREDIT_EQUIVALENCIES, toCreditEntry } from "@/data/credit-equivalencies";

/**
 * CreditsDialog (spec 007 §2b/§5, Unit 7C2) — the editable credit-profile
 * surface, modeled on SignInDialog's portal/scrim/focus idiom (same blocking
 * backdrop, same Esc/outside-click/× close, same panel shell). Opened from
 * AccountButton's "My credits" menuitem or a card/panel "Add AP credit"
 * deep-link; open state lives in usePlannerStore (creditsOpen/setCreditsOpen,
 * mirroring signInOpen exactly).
 *
 * Content: every catalog entry from src/data/credit-equivalencies.ts, grouped
 * by kind (AP first), each row a toggle pill seeded from the student's saved
 * creditProfile. Save replaces the whole profile (AuthProvider.setCreditProfile
 * — whole-array write, no merge, same policy as setEnteringYear); Cancel
 * closes without saving.
 */

const KIND_LABEL: Record<string, string> = {
  ap: "AP",
  ib: "IB",
  transfer: "Transfer",
  placement: "Placement",
};
const KIND_ORDER = ["ap", "ib", "transfer", "placement"];

export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { creditProfile, setCreditProfile } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reseed from the saved profile every time the dialog opens (matches
  // SignInDialog's "clean slate on open" pattern).
  useEffect(() => {
    if (open) setSelected(new Set(creditProfile.map((e) => e.id)));
  }, [open, creditProfile]);

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

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const entries = CREDIT_EQUIVALENCIES.filter((e) => selected.has(e.id)).map(toCreditEntry);
    await setCreditProfile(entries);
    setSaving(false);
    onClose();
  };

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    entries: CREDIT_EQUIVALENCIES.filter((e) => e.kind === kind),
  })).filter((g) => g.entries.length > 0);

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
        className="relative flex max-h-[82vh] w-full max-w-md flex-col rounded-2xl border border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-6 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink text-canvas">
            <GraduationCap className="h-4 w-4" />
          </span>
          <h2 id="credits-title" className="t-headline">
            Your AP / IB / transfer credit
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
          <p className="mb-4 t-body text-ink-2">
            Mark what you&apos;re arriving with — we&apos;ll fold it into your
            prerequisites automatically.
          </p>
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.kind}>
                <p className="mb-1.5 t-label">{KIND_LABEL[group.kind] ?? group.kind}</p>
                <div className="flex flex-col gap-1">
                  {group.entries.map((entry) => {
                    const active = selected.has(entry.id);
                    return (
                      <button
                        key={entry.id}
                        onClick={() => toggle(entry.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                          active
                            ? "border-drop bg-drop-tint"
                            : "border-line bg-surface hover:bg-surface-2"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            active
                              ? "border-drop bg-drop text-canvas"
                              : "border-line-strong text-transparent"
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="flex-1 t-body">{entry.label}</span>
                        {entry.credits != null && (
                          <span className="num shrink-0 t-meta text-ink-3">
                            {entry.credits} cr
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-line px-6 py-4">
          <p className="mb-3 t-meta text-ink-4">
            Based on Cornell&apos;s published credit tables — verify with your
            college registrar.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-line-strong px-3.5 py-2 t-body font-semibold text-ink-2 transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-ink px-3.5 py-2 t-body font-semibold text-canvas transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
