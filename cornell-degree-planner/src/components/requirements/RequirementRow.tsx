import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  AnswerListEntry,
  RequirementItem,
  RowAnswerInfo,
  RowQuestionInfo,
} from "@/hooks/useRequirementProgress";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { CategoryChips } from "./CategoryChips";
import { ReportRowForm } from "./ReportRowControl";
import { RowQuestion, type QuestionAsked } from "./RowQuestion";
import type { SaveAnswer } from "./useAnswerActions";

/**
 * One requirement in the Still-needed panel (spec 014 D2). The row's main
 * button does the status-appropriate thing (the panel decides: highlight the
 * covering cards, or open the catalog scoped to this requirement); the
 * trailing text actions waive / un-waive it and report it as wrong (spec 019
 * D15). Distribution rows (spec 019 D9) add their category chips under the
 * detail line.
 *
 * Spec 020 D3/D4: a row an answer could improve shows one question line
 * ("1 question · ENGL 2880 could count here") that opens the question inline;
 * a row counted with an answer shows "Counted because you said … · change".
 * Which form is open is the panel's (one at a time, so its header count can
 * open the first).
 *
 * DOM contract (Playwright, lane D): the <li> carries data-requirement=<id> and
 * data-status=<status>; Distribution rows also data-engine-status=<engine
 * status> (met / partial / unmet / unchecked / confirm / waived). Spec 020:
 * the question line [data-row-question], answered lines
 * [data-answer-line=<answer key>], the form [data-question-form].
 */

const DOT: Record<RequirementItem["status"], string> = {
  unmet: "border-[1.5px] border-ink-4 bg-transparent",
  partial: "border-[1.5px] border-drop bg-drop-tint",
  satisfied: "bg-complete",
  waived: "bg-waived",
};

/** "1 question · ENGL 2880 could count here"; a fact question names no course. */
function questionLine(questions: RowQuestionInfo[]): string {
  const n = questions.length;
  const count = `${n} ${n === 1 ? "question" : "questions"}`;
  const codes = [...new Set(questions.flatMap((q) => (q.courseCode ? [q.courseCode] : [])))];
  if (codes.length === 0) return `${count} · your answer could change this`;
  return `${count} · ${codes.join(", ")} could count here`;
}

/** The question the open form asks: one of the row's open questions, or an
 *  answered one being changed (re-asked with its stored value and "Clear my
 *  answer"). */
function openForm(
  formKey: string | null,
  open: RowQuestionInfo | null,
  canChange: boolean,
  answered: RowAnswerInfo[],
  answerEntry: ((key: string) => AnswerListEntry | undefined) | undefined
): { asked: QuestionAsked; current?: MarkValue } | null {
  if (open) return { asked: open };
  if (!formKey || !canChange) return null;
  const entry = answerEntry?.(formKey);
  if (entry) {
    return {
      asked: { key: entry.key, scope: entry.scope, prompt: entry.prompt, detail: "", input: entry.input },
      current: entry.value,
    };
  }
  // No list entry to re-ask from: offer the answer back as yes / no.
  const line = answered.find((a) => a.key === formKey);
  if (!line) return null;
  return {
    asked: { key: line.key, scope: line.scope, prompt: line.line, detail: "", input: { kind: "yesno" } },
    current: "yes",
  };
}

/** Hover-revealed on pointer devices; always visible on touch-only. */
const TRAILING_ACTION = cn(
  "shrink-0 rounded px-1 py-0.5 t-meta text-ink-4 transition-opacity hover:bg-surface-2 hover:text-ink",
  "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-hover:none)]:opacity-100"
);

export function RequirementRow({
  item,
  detail,
  highlighted,
  programId,
  onActivate,
  onToggleWaive,
  formKey = null,
  onFormChange,
  answerEntry,
  onAnswer,
}: {
  item: RequirementItem;
  /** The meta line under the label ("Find a class", "CS 4820", "Waived", …). */
  detail: string;
  /** Its covering cards are highlighted on the board right now. */
  highlighted: boolean;
  /** The plan's program, for "this looks wrong" reports. */
  programId: string | null;
  onActivate: () => void;
  /** Absent → the row can't be waived (confirm-with-your-advisor rows). */
  onToggleWaive?: () => void;
  /** Spec 020: the answer key whose question form is open on this row. */
  formKey?: string | null;
  /** Open (a key) or close (null) this row's question form. */
  onFormChange?: (key: string | null) => void;
  /** The stored answer behind an answered line, to re-ask it ("· change"). */
  answerEntry?: (key: string) => AnswerListEntry | undefined;
  /** Saves an answer; absent → the row shows no question or change controls. */
  onAnswer?: SaveAnswer;
}) {
  const [reporting, setReporting] = useState(false);
  const waived = item.status === "waived";
  const highlightable = item.status === "satisfied" || item.status === "partial";
  const chips = item.dist?.categories;
  const questions = onAnswer && onFormChange ? (item.dist?.questions ?? []) : [];
  const answered = item.dist?.answered ?? [];
  const canChange = !!onAnswer && !!onFormChange;

  const openIndex = formKey ? questions.findIndex((q) => q.key === formKey) : -1;
  const form = openForm(formKey, openIndex >= 0 ? questions[openIndex] : null, canChange, answered, answerEntry);

  return (
    <li
      data-requirement={item.id}
      data-status={item.status}
      data-checkable={item.checkable ? undefined : "false"}
      data-engine-status={item.dist?.engineStatus}
      className="group flex flex-col"
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onActivate}
          aria-pressed={highlightable ? highlighted : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-col rounded-md px-1.5 py-1 text-left transition-colors",
            highlighted ? "bg-drop-tint" : "hover:bg-surface-2"
          )}
        >
          <span className="flex min-w-0 items-start gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[item.status])} aria-hidden />
            <span className={cn("min-w-0 break-words t-body", waived && "text-ink-3")}>{item.label}</span>
          </span>
          {/* Wraps rather than truncates: "4 of 6 courses · 12 of 18 credits"
              must read in full in the 224 px rail (spec 019 States table). */}
          <span className="block break-words pl-3.5 t-meta text-ink-4">{detail}</span>
          {chips && chips.length > 0 && !waived && (
            <span className="mt-1 block pl-3.5">
              <CategoryChips categories={chips} />
            </span>
          )}
        </button>
        <div className="mt-1 flex shrink-0 flex-col items-end">
          {onToggleWaive && (
            <button type="button" onClick={onToggleWaive} className={TRAILING_ACTION}>
              {waived ? "Remove waiver" : "Waive"}
            </button>
          )}
          {programId && (
            <button
              type="button"
              onClick={() => setReporting((v) => !v)}
              aria-expanded={reporting}
              aria-label={`This looks wrong: ${item.label}`}
              className={cn(TRAILING_ACTION, reporting && "opacity-100")}
            >
              Looks wrong?
            </button>
          )}
        </div>
      </div>
      {questions.length > 0 && !waived && (
        <div className="pl-5 pr-1">
          <button
            type="button"
            data-row-question
            onClick={() => onFormChange?.(openIndex >= 0 ? null : questions[0].key)}
            aria-expanded={openIndex >= 0}
            className="rounded px-0.5 text-left t-meta font-medium text-drop-text underline-offset-2 hover:underline"
          >
            {questionLine(questions)}
          </button>
        </div>
      )}
      {answered.length > 0 && !waived && (
        <div className="flex flex-col pl-5 pr-1">
          {answered.map((a) => (
            <p key={a.key} data-answer-line={a.key} className="break-words t-meta text-ink-3">
              {a.line}
              {canChange && (
                <>
                  {" "}
                  ·{" "}
                  <button
                    type="button"
                    onClick={() => onFormChange?.(formKey === a.key ? null : a.key)}
                    aria-expanded={formKey === a.key}
                    aria-label={`Change your answer: ${a.line}`}
                    className="text-ink-3 underline underline-offset-2 hover:text-ink"
                  >
                    change
                  </button>
                </>
              )}
            </p>
          ))}
        </div>
      )}
      {form && onAnswer && onFormChange && (
        <RowQuestion
          key={form.asked.key}
          question={form.asked}
          current={form.current}
          position={
            openIndex >= 0 && questions.length > 1
              ? {
                  index: openIndex,
                  total: questions.length,
                  onNext: () => onFormChange(questions[(openIndex + 1) % questions.length].key),
                }
              : undefined
          }
          onAnswer={(value) => onAnswer(form.asked.scope, form.asked.key, value)}
          onClose={() => onFormChange(null)}
        />
      )}
      {reporting && programId && (
        <ReportRowForm
          programId={programId}
          layer={item.dist?.layerId ?? "program"}
          rowId={item.dist?.rowId ?? item.id}
          rowLabel={item.label}
          onClose={() => setReporting(false)}
        />
      )}
    </li>
  );
}
