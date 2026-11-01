import { useState } from "react";
import type { AnswerListEntry } from "@/hooks/useRequirementProgress";
import type { SaveAnswer } from "./useAnswerActions";
import { RowQuestion } from "./RowQuestion";

/**
 * AnswersEditor (spec 020 D8) — the "Your answers" list under the panel's
 * start-answer editor: every course mark on this plan and every student fact,
 * each with its question, the answer, and change / clear. A mark whose course
 * is off the board is kept and shown as such; one no current layer asks any
 * more reads "No longer asked" and can only be cleared.
 *
 * DOM contract (e2e): root [data-answers-editor]; each entry
 * [data-answer-entry=<answer key>][data-answer-state=<state>].
 */

const STATE_BADGE: Partial<Record<AnswerListEntry["state"], string>> = {
  hidden: "Course not on your board",
  notAsked: "No longer asked",
};

const LINK = "rounded px-1 py-0.5 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-60";

export function AnswersEditor({ answers, onAnswer }: { answers: AnswerListEntry[]; onAnswer: SaveAnswer }) {
  const [changing, setChanging] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const clear = async (entry: AnswerListEntry) => {
    setClearing(entry.key);
    setError(null);
    try {
      await onAnswer(entry.scope, entry.key, null);
    } catch (err) {
      console.error("[answers] clear failed", err);
      setError({
        key: entry.key,
        message: err instanceof Error && err.message && !("code" in err) ? err.message : "Couldn't clear it. Try again.",
      });
    } finally {
      setClearing(null);
    }
  };

  return (
    <div data-answers-editor className="flex flex-col gap-1">
      <p className="t-meta font-semibold text-ink-2">Answers to questions</p>
      {answers.length === 0 ? (
        <p className="t-meta text-ink-3">
          You haven&apos;t answered any. Questions show on the requirements they could change.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {answers.map((a) => {
            const badge = STATE_BADGE[a.state];
            return (
              <li key={a.key} data-answer-entry={a.key} data-answer-state={a.state} className="flex flex-col gap-0.5">
                <p className="break-words t-meta text-ink-2">{a.prompt}</p>
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                  <span className="t-meta font-semibold text-ink-2">{a.valueLabel}</span>
                  {badge && (
                    <span className="rounded-md border border-line px-1 t-meta leading-tight text-ink-4">{badge}</span>
                  )}
                  {a.state !== "notAsked" && (
                    <button
                      type="button"
                      onClick={() => setChanging((k) => (k === a.key ? null : a.key))}
                      aria-expanded={changing === a.key}
                      aria-label={`Change your answer: ${a.prompt}`}
                      disabled={clearing === a.key}
                      className={LINK}
                    >
                      Change
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void clear(a)}
                    aria-label={`Clear your answer: ${a.prompt}`}
                    disabled={clearing === a.key}
                    className={LINK}
                  >
                    {clearing === a.key ? "Clearing…" : "Clear"}
                  </button>
                </div>
                {error?.key === a.key && (
                  <p className="break-words t-meta text-destructive-text" role="alert">
                    {error.message}
                  </p>
                )}
                {changing === a.key && (
                  <RowQuestion
                    question={{ key: a.key, scope: a.scope, prompt: a.prompt, detail: "", input: a.input }}
                    current={a.value}
                    inset={false}
                    onAnswer={(value) => onAnswer(a.scope, a.key, value)}
                    onClose={() => setChanging(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
