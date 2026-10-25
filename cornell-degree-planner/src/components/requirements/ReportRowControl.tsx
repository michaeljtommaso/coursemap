import { useEffect, useRef, useState } from "react";
import { submitRequirementReport } from "@/services/reports";

/**
 * ReportRowForm (spec 019 D15) — the inline "this looks wrong" form under a
 * requirement row: an optional note and Send / Cancel. Sends one
 * requirementReports doc through services/reports.ts (the only writer);
 * Michael reviews them by hand.
 */

const NOTE_MAX = 500;

type SendState = "idle" | "sending" | "sent" | "rate-limited" | "error";

const MESSAGE: Partial<Record<SendState, string>> = {
  sent: "Thanks, sent.",
  "rate-limited": "You just sent one. Try again in a few seconds.",
  error: "Couldn't send. Try again.",
};

export function ReportRowForm({
  programId,
  layer,
  rowId,
  rowLabel,
  onClose,
}: {
  programId: string;
  /** Layer id for Distribution rows; "program" for Engineering rows. */
  layer: string;
  rowId: string;
  /** For the note's accessible name. */
  rowLabel: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // The row can unmount mid-send (the plan changes); never set state after.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    noteRef.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = async () => {
    setState("sending");
    const trimmed = note.trim();
    try {
      const result = await submitRequirementReport({
        programId,
        layer,
        rowId,
        ...(trimmed ? { note: trimmed } : {}),
      });
      if (mounted.current) setState(result);
    } catch (err) {
      console.error("[reports] requirement report failed", err);
      if (mounted.current) setState("error");
    }
  };

  const message = MESSAGE[state];

  if (state === "sent") {
    return (
      <div data-report-form className="flex items-center justify-between gap-2 pl-5 pr-1 pb-1">
        <p className="t-meta text-ink-3" role="status">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1 py-0.5 t-meta text-ink-4 hover:bg-surface-2 hover:text-ink"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      data-report-form
      className="flex flex-col gap-1 pb-1 pl-5 pr-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (state !== "sending") void send();
      }}
    >
      <textarea
        ref={noteRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        maxLength={NOTE_MAX}
        rows={2}
        placeholder="What looks wrong? (optional)"
        aria-label={`What looks wrong with ${rowLabel}? (optional)`}
        className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 t-meta outline-none focus:border-ink focus:ring-1 focus:ring-ink"
      />
      <div className="flex flex-wrap items-center justify-end gap-1">
        {message && (
          <p className="mr-auto t-meta text-ink-3" role="status">
            {message}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-md border border-line px-1.5 py-0.5 t-meta font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
