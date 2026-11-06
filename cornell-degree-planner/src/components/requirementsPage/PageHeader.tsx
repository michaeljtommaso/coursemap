import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Info } from "lucide-react";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import { AnswersEditor } from "@/components/requirements/AnswersEditor";
import type { SaveAnswer } from "@/components/requirements/useAnswerActions";
import { catalogYearLabel } from "@/components/requirements/requirementText";

/**
 * PageHeader (spec 025 D8) — one line: "Requirements · <program>" and
 * "3 of 13 done ⓘ". The ⓘ popover holds the catalog year, the college rule
 * set (and the start answers that chose it), the concentration, and "Your
 * answers (N)". The open-question count (spec 020) stays on the line.
 *
 * DOM (moved here from the rail panel): [data-catalog-year],
 * [data-college-version], [data-edit-start], [data-concentration],
 * [data-edit-concentration] inside the popover [data-requirements-info];
 * [data-question-count] on the line.
 */

const LINK = "text-ink-3 underline underline-offset-2 hover:text-ink";

export function PageHeader({
  programName,
  progress,
  triedCount,
  onOpenFirstQuestion,
  onAnswer,
}: {
  programName: string | null;
  progress: RequirementProgress;
  triedCount: number;
  onOpenFirstQuestion: () => void;
  onAnswer: SaveAnswer;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [editingConcentration, setEditingConcentration] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const isDistribution = progress.engine === "distribution";
  const answers = progress.answers ?? [];
  const questionCount = progress.openQuestionCount ?? 0;
  const conc = progress.concentrations;
  const hasInfo = isDistribution && (!!progress.catalogYear || !!progress.collegeVersion || !!conc);
  const showCount = progress.total > 0 && !progress.notice;

  // Esc and a click outside close the popover.
  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [infoOpen]);

  return (
    <header className="relative z-[var(--z-topbar)] flex shrink-0 items-center gap-4 border-b border-line bg-surface/70 px-5 py-3">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to planner
      </Link>
      <h1 className="min-w-0 truncate t-headline">
        Requirements{programName ? ` · ${programName}` : ""}
      </h1>
      <div ref={popRef} className="relative ml-auto flex shrink-0 items-center gap-3">
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
        {showCount && (
          <p data-requirements-done className="t-body text-ink-2">
            <span className="num">{progress.satisfiedCount}</span> of <span className="num">{progress.total}</span> done
            {triedCount > 0 && (
              <span className="text-drop-text">
                {" "}
                · trying <span className="num">{triedCount}</span> {triedCount === 1 ? "class" : "classes"}
              </span>
            )}
          </p>
        )}
        {hasInfo && (
          <button
            type="button"
            aria-label="About these requirements"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
            className="rounded-full p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        )}
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
                {answers.length > 0 ? (
                  <>
                    Your answers (<span className="num">{answers.length}</span>)
                  </>
                ) : (
                  "Your answers"
                )}
              </button>
              {showAnswers && (
                <div className="mt-1.5">
                  <AnswersEditor answers={answers} onAnswer={onAnswer} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
