import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { REQ_PANEL_MAX, REQ_PANEL_MIN, usePlannerStore } from "@/store/usePlannerStore";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { AnswerListEntry, RequirementItem } from "@/hooks/useRequirementProgress";
import { ReportRowForm } from "@/components/requirements/ReportRowControl";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import { RowQuestion } from "@/components/requirements/RowQuestion";
import { openForm, questionLine } from "@/components/requirements/rowQuestions";
import type { SaveAnswer } from "@/components/requirements/useAnswerActions";
import { CategoryGrid } from "./CategoryGrid";
import {
  INLINE_NAMES,
  codeFromId,
  countedNames,
  rowDetail,
  rowProgress,
  triedCategoryIds,
  triedCourseIdsOn,
  triedDelta,
  triedDeltaText,
} from "./pageModel";
import { TRY_CAP_TEXT, pickFromScan, scanTargets, type CandidateIndex, type FillTarget } from "./suggestions";
import { TryCourseRow, tryLineFor, useTryToggle, type TryActions, type TryLine } from "./tryCourse";

/**
 * RequirementPanel (spec 045 D3) — the side panel for the selected
 * requirement: where it sits ("Distribution · 1 of 2") and its full name; the
 * full note on an amber tint; how far along it is; its categories (filled
 * green, tried blue); its question and answers (spec 020); what the tried
 * classes add (blue, never met); Show on board, Waive / Remove waiver and
 * Looks wrong?; then **Classes that would fill this** (for exactly this
 * requirement, the enrollment term's roster first) with Try and
 * + <enrollment term>, and "Search all classes for this" (Classes with
 * "Counts toward" set).
 *
 * An advisor row's panel shows its note and Looks wrong? only.
 *
 * ✕ and Esc close it (the page owns Esc); focus moves into the panel when it
 * opens. Remounted per requirement (keyed by the page), so a form or a Try
 * from one row never carries over to the next.
 *
 * Cost: the suggestion scan (scanTargets) runs in a deferred render over the
 * page's candidate index and keys on board + credit only; a Try click only
 * re-picks.
 *
 * DOM: root [data-requirement-panel=<row id>] with the id the rows'
 * aria-controls name; [data-panel-note]; [data-row-start-term];
 * [data-tried-delta]; [data-tried-course]; spec 020 [data-row-question],
 * [data-answer-line=<key>]; [data-show-on-board]; [data-waive];
 * [data-report-row]; [data-panel-suggestions] with [data-try-course=<id>];
 * [data-try-cap]; [data-find-class].
 */

const ACTION = "rounded-md px-2.5 py-1 t-meta font-semibold transition-colors";
const QUIET = "rounded px-1.5 py-1 t-meta text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink";

export type PanelSuggestProps = {
  /** This requirement's open things (buildFillTargets over [item]). */
  targets: readonly FillTarget[];
  /** The page's catalog split (buildCandidates), built once per page. */
  candidates: CandidateIndex;
  /** Never suggested: on the board or earned by credit. */
  exclude: (id: string) => boolean;
  recordById: (id: string) => CatalogIndexRecord | undefined;
  enrollmentTarget: string | null;
  /** "Spring 2027", or null. */
  termLabel: string | null;
  /** Tried course id → what it fills on THIS requirement (empty: nothing). */
  triedFills: Record<string, string[]>;
  actions: TryActions;
};

export function RequirementPanel({
  id,
  item,
  where,
  advisor = false,
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
  onClose,
  suggest,
}: {
  /** The id the table rows' aria-controls name. */
  id: string;
  item: RequirementItem;
  /** The breadcrumb's group: "Distribution", "Check with your advisor". */
  where: string;
  advisor?: boolean;
  /** The same row recomputed with the plan's tried classes (D11). */
  tried?: RequirementItem;
  codeOfPlacement: (placementId: string) => string;
  /** The plan's program, for "Looks wrong?" reports. */
  programId: string | null;
  formKey?: string | null;
  onFormChange?: (key: string | null) => void;
  answerEntry?: (key: string) => AnswerListEntry | undefined;
  onAnswer?: SaveAnswer;
  /** Absent → it can't be waived (advisor rows). */
  onToggleWaive?: () => void;
  /** Absent → no "Search all classes for this" (done, waived, can't check). */
  onFindClass?: () => void;
  /** Absent → nothing on the board counts here. */
  onShowOnBoard?: () => void;
  onClose: () => void;
  /** Absent → no class suggestions (advisor rows, nothing to fill). */
  suggest?: PanelSuggestProps;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Null = the built-in responsive width; a number once the edge is dragged.
  const panelWidth = usePlannerStore((s) => s.reqPanelWidth);
  const setPanelWidth = usePlannerStore((s) => s.setReqPanelWidth);
  const [reporting, setReporting] = useState(false);

  // Focus moves into the panel when it opens.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const waived = item.status === "waived";
  // The REAL row's coverage: board placements only (tried classes are blue).
  const names = countedNames(item, [...new Set(item.coveredBy.map(codeOfPlacement))]);
  const detail = rowDetail(item, names);
  const progress = rowProgress(item, tried);
  const delta = triedDelta(item, tried);
  const triedCodes = triedCourseIdsOn(item, tried).map(codeFromId);
  const triedCats = triedCategoryIds(item, tried);
  const chips = item.dist?.categories;
  const note = item.dist?.note;
  const showCounting = !waived && !advisor && (names.length > INLINE_NAMES || triedCodes.length > 0);

  const questions = !advisor && onAnswer && onFormChange ? (item.dist?.questions ?? []) : [];
  const answered = advisor ? [] : (item.dist?.answered ?? []);
  const canChange = !!onAnswer && !!onFormChange;
  const openIndex = formKey ? questions.findIndex((q) => q.key === formKey) : -1;
  const form = advisor
    ? null
    : openForm(formKey, openIndex >= 0 ? questions[openIndex] : null, canChange, answered, answerEntry);

  // The wrapper owns the width (so the left-edge handle doesn't scroll with
  // the panel's content); 45vw keeps the tables usable however wide it's set.
  const measured = () => wrapRef.current?.getBoundingClientRect().width ?? REQ_PANEL_MIN;
  return (
    <div
      ref={wrapRef}
      data-requirement-panel-wrap
      className={cn("relative flex max-w-[45vw] shrink-0", panelWidth === null && "w-[23.75rem] xl:w-[25rem]")}
      style={panelWidth === null ? undefined : { width: panelWidth }}
    >
      <ResizeHandle
        edge="left"
        width={panelWidth ?? 400}
        getStartWidth={measured}
        min={REQ_PANEL_MIN}
        max={REQ_PANEL_MAX}
        onChange={setPanelWidth}
        onReset={() => setPanelWidth(null)}
        label="Resize the details panel"
        data-panel-resize
      />
      <aside
        ref={rootRef}
        id={id}
        data-requirement-panel={item.id}
        aria-label="Requirement details"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto border-l border-line bg-surface px-5 py-4 outline-none"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="t-label text-ink-4">
              {where}
              {!advisor && !waived && progress.text ? ` · ${progress.text}` : ""}
            </p>
            <h2 className="mt-1 break-words t-body font-semibold text-ink">{item.label}</h2>
          </div>
          <Tooltip content="Close (Esc)">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        </div>

        {!advisor && <p className="break-words t-meta text-ink-3">{detail}</p>}

        {note && !waived && (
          <p data-panel-note className="break-words rounded-md bg-available-tint px-3 py-2.5 t-body font-normal text-available-text">
            {note}
          </p>
        )}

        {/* Spec 037 D8: Engineering liberal studies asks for the start term here. */}
        {!advisor && item.dist?.notice?.kind === "needs-entry-term" && !waived && (
          <div data-row-start-term>
            <StudentContextQuestions need="entry-term" compact />
          </div>
        )}

        {delta && (
          <p data-tried-delta className="t-meta font-semibold text-drop-text">
            {triedDeltaText(delta)}
          </p>
        )}

        {!advisor && chips && chips.length > 0 && !waived && <CategoryGrid categories={chips} tried={triedCats} />}

        {showCounting && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Counting">
            <span className="t-label text-ink-4">Counting</span>
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
          <button
            type="button"
            data-row-question
            onClick={() => onFormChange?.(openIndex >= 0 ? null : questions[0].key)}
            aria-expanded={openIndex >= 0}
            className="self-start rounded px-0.5 text-left t-meta font-medium text-drop-text underline-offset-2 hover:underline"
          >
            {questionLine(questions)}
          </button>
        )}
        {answered.length > 0 && !waived && (
          <div className="flex flex-col">
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

        <div className="flex flex-wrap items-center gap-1.5">
          {onShowOnBoard && (
            <button
              type="button"
              data-show-on-board
              onClick={onShowOnBoard}
              className={cn(ACTION, "border border-line-strong text-ink hover:bg-surface-2")}
            >
              Show on board
            </button>
          )}
          {onToggleWaive && (
            <button type="button" data-waive onClick={onToggleWaive} className={QUIET}>
              {waived ? "Remove waiver" : "Waive"}
            </button>
          )}
          {programId && (
            <button
              type="button"
              data-report-row
              onClick={() => setReporting((v) => !v)}
              aria-expanded={reporting}
              aria-label={`This looks wrong: ${item.label}`}
              className={QUIET}
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

        {!advisor && (suggest || onFindClass) && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {suggest && <PanelSuggestions {...suggest} />}
            {onFindClass && (
              <button
                type="button"
                data-find-class
                onClick={onFindClass}
                className="self-start rounded px-0.5 t-meta font-semibold text-drop-text underline-offset-2 hover:underline"
              >
                Search all classes for this ›
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** "Classes that would fill this": the classes being tried that fill it
 *  first (so a toggle never moves out from under the student), then a few
 *  suggestions from the deferred catalog scan. */
function PanelSuggestions({
  targets,
  candidates,
  exclude,
  recordById,
  enrollmentTarget,
  termLabel,
  triedFills,
  actions,
}: PanelSuggestProps) {
  // The scan runs in a deferred render, so opening the panel paints at once
  // and the classes land right after. `exclude`, `targets` and `candidates`
  // keep their identity while unchanged (the page memoizes them), or the
  // deferred render never settles. Tried ids are not part of the scan's key.
  const ready = useDeferredValue(true, false);
  const deferredExclude = useDeferredValue(exclude);
  const scan = useMemo(
    () => (ready ? scanTargets(candidates, targets, deferredExclude) : null),
    [ready, candidates, targets, deferredExclude]
  );
  const triedKey = actions.triedIds;
  const suggestions = useMemo(
    () => (scan ? pickFromScan(scan, targets, { skip: new Set(triedKey) }) : null),
    [scan, targets, triedKey]
  );

  const { tried, toggle, capHit, triedHere } = useTryToggle(actions);
  const lineFor = (id: string, fills: string[]): TryLine => tryLineFor(id, fills, recordById);

  const trying: TryLine[] = actions.triedIds
    .filter((id) => (triedFills[id]?.length ?? 0) > 0 || id in triedHere)
    .map((id) => lineFor(id, triedHere[id]?.length ? triedHere[id] : (triedFills[id] ?? [])));
  const tryingIds = new Set(trying.map((l) => l.id));
  const suggested: TryLine[] = (suggestions ?? [])
    .filter((s) => !tryingIds.has(s.record.id))
    .slice(0, Math.max(2, 4 - trying.length))
    .map((s) => lineFor(s.record.id, s.fills));

  const row = (line: TryLine) => (
    <TryCourseRow
      key={line.id}
      line={line}
      tried={tried.has(line.id)}
      actions={actions}
      onToggle={toggle}
      enrollmentTarget={enrollmentTarget}
      termLabel={termLabel}
    />
  );

  return (
    <div data-panel-suggestions className="flex flex-col gap-2">
      <p className="t-label text-ink-4">
        Classes that would fill this{termLabel ? ` · ${termLabel} first` : ""}
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="Classes that would fill this">
        {trying.map(row)}
        {suggested.map(row)}
        {suggestions === null && <li className="t-meta text-ink-4">Finding classes…</li>}
        {suggestions !== null && trying.length === 0 && suggested.length === 0 && (
          <li className="t-meta text-ink-4">No suggestions for this one. Search all classes below.</li>
        )}
      </ul>
      {(actions.atCap || capHit) && (
        <p data-try-cap className="t-meta font-semibold text-ink-2" role="status">
          {TRY_CAP_TEXT}
        </p>
      )}
      <p className="t-meta text-drop-text">Try shows in blue what a class would fill, without putting it on your board.</p>
    </div>
  );
}
