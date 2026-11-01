import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RowQuestionInfo } from "@/hooks/useRequirementProgress";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { choicePillClass } from "@/components/onboarding/choicePill";

/**
 * RowQuestion (spec 020 D3, D8) — the inline question form under a
 * requirement row, opened like "Looks wrong?": the question, a plain line on
 * what a "yes" does, and Yes / No (or one button per allowed credit value).
 * Answering saves through the caller and closes the form; an answer the
 * caller refuses (over the cap, malformed) keeps it open with the reason. A
 * write that fails later is reported by the caller's toast. Reopened from "· change" or the "Your answers"
 * list, it marks the current answer and offers "Clear my answer".
 *
 * Focus moves to the first answer on open and back to whatever opened it on
 * close; Escape closes. The form is named by its prompt.
 *
 * DOM contract (e2e): the form carries data-question-form=<answer key>.
 */

export type QuestionAsked = Pick<RowQuestionInfo, "key" | "scope" | "prompt" | "detail" | "input">;

const SAVE_FAILED = "Couldn't save your answer. Try again.";

/** A readable reason: the setters reject with plain-language Errors; anything
 *  carrying a Firebase `code` is not meant for the student. */
function reason(err: unknown): string {
  if (err instanceof Error && err.message && !("code" in err)) return err.message;
  return SAVE_FAILED;
}

function choices(input: QuestionAsked["input"]): { value: MarkValue; label: string }[] {
  if (input.kind === "credits") {
    return input.values.map((n) => ({ value: n, label: `${n} ${n === 1 ? "credit" : "credits"}` }));
  }
  return [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];
}

export function RowQuestion({
  question,
  current,
  position,
  onAnswer,
  onClose,
  inset = true,
}: {
  question: QuestionAsked;
  /** The stored answer, when reopened to change it. */
  current?: MarkValue;
  /** Several open questions on one row: which this is, and the way to the next. */
  position?: { index: number; total: number; onNext: () => void };
  /** Save the answer (null clears it). Rejects when it couldn't be saved. */
  onAnswer: (value: MarkValue | null) => Promise<void>;
  onClose: () => void;
  /** Indented under a requirement row (false in the "Your answers" list). */
  inset?: boolean;
}) {
  const promptId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  // The row can unmount mid-save (a yes moves it to Satisfied); never set
  // state after.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Whatever opened the form gets focus back when it closes, if it's still
    // on the page (answering can remove the question line itself).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.scrollIntoView?.({ block: "nearest" });
    firstRef.current?.focus();
    return () => {
      mounted.current = false;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const save = async (value: MarkValue | null) => {
    setSaving(true);
    setError(null);
    try {
      await onAnswer(value);
      if (mounted.current) onClose();
    } catch (err) {
      console.error("[answers] save failed", err);
      if (mounted.current) {
        setError(reason(err));
        setSaving(false);
      }
    }
  };

  const answered = current !== undefined;

  return (
    <form
      ref={formRef}
      data-question-form={question.key}
      aria-labelledby={promptId}
      aria-busy={saving || undefined}
      className={cn("flex flex-col gap-1.5 pb-1", inset && "pl-5 pr-1")}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Escape and Cancel work while saving too: the save carries on (a
        // failed write still shows the usual toast); the form just closes.
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-0.5">
        {position && position.total > 1 && (
          <p className="t-meta text-ink-4">
            Question <span className="num">{position.index + 1}</span> of <span className="num">{position.total}</span>
          </p>
        )}
        <p id={promptId} className="break-words t-meta font-semibold text-ink-2">
          {question.prompt}
        </p>
        {question.detail && <p className="break-words t-meta text-ink-3">{question.detail}</p>}
      </div>
      <div role="group" aria-labelledby={promptId} className="flex flex-wrap gap-1">
        {choices(question.input).map((c, i) => (
          <button
            key={String(c.value)}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            disabled={saving}
            onClick={() => void save(c.value)}
            aria-pressed={answered ? current === c.value : undefined}
            className={cn(choicePillClass(current === c.value, true), "disabled:opacity-60")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="break-words t-meta text-destructive-text" role="alert">
          {error}
        </p>
      )}
      {saving && (
        <p className="t-meta text-ink-3" role="status">
          Saving…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {answered && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(null)}
            className="rounded px-1.5 py-0.5 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-60"
          >
            Clear my answer
          </button>
        )}
        {position && position.total > 1 && (
          <button
            type="button"
            disabled={saving}
            onClick={position.onNext}
            className="rounded px-1.5 py-0.5 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-60"
          >
            Next question
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
