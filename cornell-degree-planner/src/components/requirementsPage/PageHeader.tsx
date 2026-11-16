import { useEffect, useRef, useState } from "react";
import { TourLink } from "@/components/tour/TourLink";
import { Link } from "react-router-dom";
import { ArrowLeft, Info } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import { AnswersEditor } from "@/components/requirements/AnswersEditor";
import type { SaveAnswer } from "@/components/requirements/useAnswerActions";
import { catalogYearLabel } from "@/components/requirements/requirementText";
import { isCountsForKey, type CountsForChoice } from "@/components/requirements/programSections";

/**
 * PageHeader (spec 028 D8, spec 045 D10) — one line that wraps when narrow:
 * "← Back to planner" · "Requirements · <program>" · the "Try a class…"
 * search (the `search` slot) · a thin progress bar with "9 of 31 done" · the
 * open-question count (spec 020) · ⓘ · "Take the tour". The ⓘ popover holds
 * the catalog year, the college rule set (and the start answers that chose
 * it), the concentration, and "Your answers (N)".
 *
 * Spec 047 D6/D8: with extra programs the title names each by its short name,
 * "Requirements · Economics + Mathematics + CS minor"; "N of M done" counts every program (`allDone`, its tooltip per program),
 * and "Your answers" also lists where shared courses count (`choices`).
 *
 * DOM: [data-catalog-year], [data-college-version], [data-edit-start],
 * [data-concentration], [data-edit-concentration] inside the popover
 * [data-requirements-info]; [data-question-count] and [data-requirements-done]
 * on the line.
 */

const LINK = "text-ink-3 underline underline-offset-2 hover:text-ink";
const NO_NAMES: readonly string[] = [];

export function PageHeader({
  programName,
  progress,
  onOpenFirstQuestion,
  onAnswer,
  search,
  primaryShortName = null,
  extraProgramNames = NO_NAMES,
  allDone,
  doneBreakdown,
  choices = [],
}: {
  programName: string | null;
  progress: RequirementProgress;
  onOpenFirstQuestion: () => void;
  onAnswer: SaveAnswer;
  /** Spec 045 D10: the "Try a class" search (TrySearch), between the title
   *  and the progress. CONTRACT (phase 0): lane B places it. */
  search?: React.ReactNode;
  /** Spec 047: the primary's short name ("CS"), used once the plan holds more. */
  primaryShortName?: string | null;
  /** Spec 047: the second major's and minors' short names, in order. */
  extraProgramNames?: readonly string[];
  /** Spec 047 D6: done of total over every program (else the primary's). */
  allDone?: { satisfied: number; total: number };
  /** "CS: 13 of 31 · ORE: 3 of 14": the done count's tooltip with several programs. */
  doneBreakdown?: string;
  /** Spec 047 D8: the plan's "count it for X" choices. */
  choices?: CountsForChoice[];
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [editingConcentration, setEditingConcentration] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const isDistribution = progress.engine === "distribution";
  const answers = progress.answers ?? [];
  const satisfied = allDone?.satisfied ?? progress.satisfiedCount;
  const total = allDone?.total ?? progress.total;
  const questionCount = progress.openQuestionCount ?? 0;
  // countsFor choices are listed on their own (the engine may list them too).
  const answerCount = answers.filter((a) => !isCountsForKey(a.key)).length + choices.length;
  const conc = progress.concentrations;
  const hasInfo = isDistribution && (!!progress.catalogYear || !!progress.collegeVersion || !!conc);
  const showCount = total > 0 && !progress.notice;

  // Esc and a click outside close the popover. The Esc is the popover's
  // alone: caught before the page's own Esc handler (capture phase) and
  // marked handled, so it doesn't also close the side panel.
  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setInfoOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [infoOpen]);

  // Several programs: every one by its short name ("CS + ORE + Business minor").
  const names =
    programName && extraProgramNames.length > 0
      ? [primaryShortName || programName, ...extraProgramNames].join(" + ")
      : programName;
  const title = `Requirements${names ? ` · ${names}` : ""}`;
  const doneLine = (
    <p data-requirements-done className="t-body font-semibold text-ink">
      <span className="num">{satisfied}</span> of <span className="num">{total}</span> done
    </p>
  );
  const pct = total > 0 ? Math.round((satisfied / total) * 100) : 0;

  return (
    <header className="relative z-[var(--z-topbar)] flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface/70 px-5 py-3">
      <Link
        to="/"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to planner
      </Link>
      <Tooltip content={title} truncatedOnly>
        <h1 className="min-w-0 max-w-full shrink truncate t-headline">{title}</h1>
      </Tooltip>
      {search}
      <div ref={popRef} className="relative ml-auto flex shrink-0 flex-wrap items-center gap-3">
        {showCount && (
          <div className="flex items-center gap-2.5">
            <div
              role="progressbar"
              aria-label="Requirements done"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={satisfied}
              className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2"
            >
              <div className="h-full rounded-full bg-complete" style={{ width: `${pct}%` }} />
            </div>
            {/* Tried classes are counted beside the search ("Trying N
                classes"), so this line is only what's done. */}
            {doneBreakdown ? <Tooltip content={doneBreakdown}>{doneLine}</Tooltip> : doneLine}
          </div>
        )}
        {questionCount > 0 && (
          <button
            type="button"
            data-question-count={questionCount}
            onClick={onOpenFirstQuestion}
            className="rounded px-0.5 t-meta font-semibold text-drop-text underline-offset-2 hover:underline"
          >
            <span className="num">{questionCount}</span> {questionCount === 1 ? "question" : "questions"}
          </button>
        )}
        {hasInfo && (
          <Tooltip content="About these requirements">
            <button
              type="button"
              aria-label="About these requirements"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
              className="rounded-full p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        )}
        <TourLink tour="requirements" />
        {hasInfo && infoOpen && (
          <div
            data-requirements-info
            role="dialog"
            aria-label="About these requirements"
            className="absolute right-0 top-full mt-2 flex max-h-[70vh] w-[22rem] flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-xl)]"
          >
            {progress.catalogYear && (
              <p data-catalog-year className="t-meta text-ink-3">
                Requirements from the <span className="num">{catalogYearLabel(progress.catalogYear)}</span> Cornell
                catalog
              </p>
            )}
            {progress.collegeVersion &&
              (editingStart ? (
                <div data-edit-start className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-2">
                  <StudentContextQuestions edit compact onDone={() => setEditingStart(false)} />
                  <button type="button" onClick={() => setEditingStart(false)} className={`self-start t-meta ${LINK}`}>
                    Close
                  </button>
                </div>
              ) : (
                <p data-college-version className="t-meta text-ink-3">
                  College rules: {progress.collegeVersion}.{" "}
                  <button type="button" onClick={() => setEditingStart(true)} className={LINK}>
                    Change
                  </button>
                </p>
              ))}
            {conc &&
              !conc.needed &&
              (editingConcentration ? (
                <div data-edit-concentration className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-2">
                  <StudentContextQuestions
                    need="concentration"
                    edit
                    compact
                    onDone={() => setEditingConcentration(false)}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingConcentration(false)}
                    className={`self-start t-meta ${LINK}`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p data-concentration className="t-meta text-ink-3">
                  Concentration:{" "}
                  {conc.chosen.length > 0
                    ? conc.chosen.map((id) => conc.options.find((o) => o.id === id)?.name ?? id).join(", ")
                    : "none"}
                  .{" "}
                  <button type="button" onClick={() => setEditingConcentration(true)} className={LINK}>
                    Change
                  </button>
                </p>
              ))}
            <div className="border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setShowAnswers((v) => !v)}
                aria-expanded={showAnswers}
                className={`t-meta ${LINK}`}
              >
                {answerCount > 0 ? (
                  <>
                    Your answers (<span className="num">{answerCount}</span>)
                  </>
                ) : (
                  "Your answers"
                )}
              </button>
              {showAnswers && (
                <div className="mt-1.5">
                  <AnswersEditor answers={answers} onAnswer={onAnswer} choices={choices} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
