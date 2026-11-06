import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AnswerListEntry, RequirementItem } from "@/hooks/useRequirementProgress";
import { ReportRowForm } from "@/components/requirements/ReportRowControl";
import { RowQuestion } from "@/components/requirements/RowQuestion";
import { openForm, questionLine } from "@/components/requirements/rowQuestions";
import type { SaveAnswer } from "@/components/requirements/useAnswerActions";
import { CategoryGrid } from "./CategoryGrid";
import {
  INLINE_NAMES,
  codeFromId,
  countedNames,
  rowDetail,
  triedCategoryIds,
  triedCourseIdsOn,
  triedDelta,
  triedDeltaText,
} from "./pageModel";

/**
 * PageRow (spec 025 D8/D10/D11) — one requirement on the Requirements page,
 * laid out wide: label, how far along with what counts named (credit by its
 * name, D7), the category grid, the row's question (spec 020), and inline
 * actions — Find a class, Show on board, Waive, Looks wrong?. Classes being
 * tried show in blue, "+N if you take what you're trying", never as met.
 *
 * DOM contract (e2e, same as the rail row it replaces): the <li> carries
 * data-requirement=<id>, data-status=<status>, data-engine-status (Distribution
 * rows); spec 020 [data-row-question], [data-answer-line=<key>]; the tried
 * line [data-tried-delta].
 */

const DOT: Record<RequirementItem["status"], string> = {
  unmet: "border-[1.5px] border-ink-4 bg-transparent",
  partial: "border-[1.5px] border-drop bg-drop-tint",
  satisfied: "bg-complete",
  waived: "bg-waived",
};

const ACTION = "rounded px-1 py-0.5 t-meta font-semibold transition-colors hover:bg-surface-2";

export function PageRow({
  item,
  tried,
  codeOfPlacement,
  programId,
  formKey = null,
  onFormChange,
  answerEntry,
  onAnswer,
  onToggleWaive,
  onFindClass,
  onShowOnBoard,
}: {
  item: RequirementItem;
  /** The same row recomputed with the plan's tried classes (D11). */
  tried?: RequirementItem;
  /** placement id → "CS 2110". */
  codeOfPlacement: (placementId: string) => string;
  /** The plan's program, for "Looks wrong?" reports. */
  programId: string | null;
  formKey?: string | null;
  onFormChange?: (key: string | null) => void;
  answerEntry?: (key: string) => AnswerListEntry | undefined;
  onAnswer?: SaveAnswer;
  /** Absent → the row can't be waived (advisor rows). */
  onToggleWaive?: () => void;
  /** Absent → no Find a class (done, waived, or nothing to search for). */
  onFindClass?: () => void;
  /** Absent → nothing on the board counts here. */
  onShowOnBoard?: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const waived = item.status === "waived";
  // The REAL row's coverage: board placements only (tried classes are blue).
  const names = countedNames(item, [...new Set(item.coveredBy.map(codeOfPlacement))]);
  const detail = rowDetail(item, names);
  const delta = triedDelta(item, tried);
  const triedCodes = triedCourseIdsOn(item, tried).map(codeFromId);
  const triedCats = triedCategoryIds(item, tried);
  const chips = item.dist?.categories;
  const showCounting = !waived && (names.length > INLINE_NAMES || triedCodes.length > 0);

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
      className="flex flex-col gap-1.5 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[item.status])} aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className={cn("break-words t-body font-semibold", waived ? "text-ink-3" : "text-ink")}>{item.label}</p>
          <p className="break-words t-meta text-ink-3">{detail}</p>
          {item.dist?.note && !waived && <p className="break-words t-meta text-ink-4">{item.dist.note}</p>}
          {delta && (
            <p data-tried-delta className="t-meta font-semibold text-drop-text">
              {triedDeltaText(delta)}
            </p>
          )}
        </div>
      </div>

      {chips && chips.length > 0 && !waived && (
        <div className="pl-4">
          <CategoryGrid categories={chips} tried={triedCats} />
        </div>
      )}

      {showCounting && (
        <div className="flex flex-wrap items-center gap-1 pl-4" aria-label="Counting">
          <span className="t-label">Counting</span>
          {names.map((n) => (
            <span
              key={n}
              className="rounded-md border border-complete bg-complete-tint px-1.5 py-px t-meta font-semibold text-complete-text"
            >
              {n}
            </span>
          ))}
          {triedCodes.map((c) => (
            <span
              key={`tried-${c}`}
              data-tried-course
              className="rounded-md border border-dashed border-drop bg-drop-tint px-1.5 py-px t-meta font-semibold text-drop-text"
            >
              {c} · trying
            </span>
          ))}
        </div>
      )}

      {questions.length > 0 && !waived && (
        <div className="pl-4">
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
        <div className="flex flex-col pl-4">
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
        <div className="pl-2">
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
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-3">
        {onFindClass && (
          <button type="button" data-find-class onClick={onFindClass} className={cn(ACTION, "text-drop-text")}>
            Find a class
          </button>
        )}
        {onShowOnBoard && (
          <button type="button" data-show-on-board onClick={onShowOnBoard} className={cn(ACTION, "text-drop-text")}>
            Show on board
          </button>
        )}
        {onToggleWaive && (
          <button type="button" onClick={onToggleWaive} className={cn(ACTION, "font-normal text-ink-3 hover:text-ink")}>
            {waived ? "Remove waiver" : "Waive"}
          </button>
        )}
        {programId && (
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            aria-expanded={reporting}
            aria-label={`This looks wrong: ${item.label}`}
            className={cn(ACTION, "font-normal text-ink-3 hover:text-ink")}
          >
            Looks wrong?
          </button>
        )}
      </div>
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
