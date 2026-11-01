import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import {
  useRequirementProgress,
  type AnswerListEntry,
  type RequirementItem,
  type RequirementNotice,
} from "@/hooks/useRequirementProgress";
import { itemsBySemester } from "@/lib/planner/requirementProgress";
import { cn } from "@/lib/utils";
import {
  StudentContextQuestions,
  type StudentContextNeed,
} from "@/components/onboarding/StudentContextQuestions";
import { AnswersEditor } from "./AnswersEditor";
import { RequirementRow } from "./RequirementRow";
import { SortToggle } from "./SortToggle";
import { useSortPreference } from "./useSortPreference";
import { useAnswerActions } from "./useAnswerActions";

/**
 * StillNeededPanel (spec 014 D2) — the left-rail checklist of what the current
 * major still needs, replacing the legend and the slot-based progress.
 *
 * The board holds only courses; requirements are attribution (D1). A new board
 * is thin on purpose (D6: only fixed single-course requirements are placed), so
 * the copy frames the open items as "your choices", not as something missing.
 *
 *   By category (default): one block per requirement category with progress
 *     ("Electives · 1 of 3"), listing unmet/partial items. Satisfied + waived
 *     items collapse into "Satisfied (N)", naming the covering course(s).
 *   By semester: a flat list of the open items in suggested-semester order.
 *
 * Clicking a satisfied item highlights its covering cards on the board (click
 * again or Esc clears). Clicking an unmet item opens the catalog scoped to
 * courses that would satisfy it; a partly filled group does both. Each item
 * can be waived here.
 *
 * CAS and CALS programs (spec 019 D9) run on the Distribution engine: rows are
 * grouped by layer then heading ("College · Distribution"), pools read
 * "4 of 6 courses · 12 of 18 credits", distribution rows show category chips,
 * and the header names the catalog year. When the engine can't pick the
 * student's curriculum yet (`progress.notice`), the panel asks or explains
 * instead of showing rows.
 *
 * Spec 020 (ask the student): rows an answer could improve carry a question
 * line and an inline form (one form open across the panel); the header counts
 * the open questions and jumps to the first; "Your answers (N)" opens the
 * start-answer editor with every stored answer listed for change or clear.
 *
 * DOM contract (lane D Playwright): root [data-still-needed]; items
 * [data-requirement][data-status] (+ [data-engine-status] on Distribution
 * rows); notices [data-requirement-notice=<kind>]; sort buttons named
 * "By category" / "By semester". Spec 020: header count [data-question-count],
 * answers list [data-answers-editor].
 */

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** "2026-27" → "2026–27" (catalog years read with an en dash). */
function catalogYearLabel(year: string): string {
  return year.replace("-", "–");
}

const NOTICE_NEED: Partial<Record<RequirementNotice["kind"], StudentContextNeed>> = {
  "needs-entry-term": "entry-term",
  "needs-transfer": "transfer",
  "needs-transfer-standing": "transfer-standing",
};

const CONCENTRATION_TEXT = (min: number, max: number): string =>
  max > 1
    ? `Your major needs ${min === max ? `${max}` : `${min} to ${max}`} concentration${max === 1 ? "" : "s"} before its requirements are complete.`
    : "Your major needs a concentration before its requirements are complete.";

const NOTICE_TEXT: Record<RequirementNotice["kind"], string> = {
  "needs-entry-term": "Your college's requirements depend on when you started at Cornell.",
  "needs-transfer": "Your college's requirements depend on whether you transferred in.",
  "needs-transfer-standing": "Your college's requirements depend on the class standing you transferred in at.",
  "layers-unavailable": "This major's requirements couldn't be loaded. Try again later.",
  "under-review": "This major's requirements are being reviewed.",
};

/** "4 of 6 courses · 12 of 18 credits" — the parts a row states. */
function progressText(d: NonNullable<RequirementItem["dist"]>): string {
  const parts: string[] = [];
  if (d.categoriesNeed != null) parts.push(`${d.categoriesHave ?? 0} of ${d.categoriesNeed} categories`);
  if (d.coursesNeed != null && d.coursesNeed > 0 && (d.rowKind !== "seat" || d.categoriesNeed != null)) {
    parts.push(`${d.coursesHave ?? 0} of ${d.coursesNeed} courses`);
  }
  if (d.creditsNeed != null && d.creditsNeed > 0) parts.push(`${d.creditsHave ?? 0} of ${d.creditsNeed} credits`);
  return parts.join(" · ");
}

/** The meta line for a Distribution row (spec 019 D9 / States table). */
function distDetail(it: RequirementItem, codes: string[]): string {
  const d = it.dist!;
  if (it.status === "waived") return "Waived";
  if (d.engineStatus === "confirm") return "Confirm with your advisor";
  if (d.engineStatus === "unchecked") return "Can't check this automatically";
  const counted = d.countedCodes.length > 0 ? d.countedCodes : codes;
  if (it.status === "satisfied") {
    // Totals and distributions count many courses: say how far, not which.
    if (d.rowKind === "credits" || d.rowKind === "distribution") {
      const howFar = progressText(d);
      if (howFar) return howFar;
    }
    return counted.length > 0 ? counted.join(", ") : "Your credit";
  }
  if (d.rowKind === "anyOf" && d.activeOption != null && it.status === "partial") {
    const howFar = progressText(d);
    return `Option ${d.activeOption + 1} in progress${howFar ? `: ${howFar}` : ""}`;
  }
  if (it.status === "partial") {
    const howFar = d.rowKind === "anyOf" ? "" : progressText(d);
    return howFar || `Partly: ${counted.join(", ") || "your credit"}`;
  }
  return "Find a class";
}

export function StillNeededPanel() {
  const progress = useRequirementProgress();
  const { placements, placedCourses, toggleWaivedRequirement, planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const programId = planProgramId ?? selectedProgramId;
  const isDistribution = progress.engine === "distribution";
  const highlighted = usePlannerStore((s) => s.highlightedPlacementIds);
  const setHighlighted = usePlannerStore((s) => s.setHighlightedPlacementIds);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);
  const [sort, setSort] = useSortPreference();
  const [showSatisfied, setShowSatisfied] = useState(false);
  // Spec 019 review F4: the start answers pick the college rule version, so
  // they must stay changeable (a mis-click would otherwise lock the wrong rules).
  const [editingStart, setEditingStart] = useState(false);
  const [editingConcentration, setEditingConcentration] = useState(false);
  // Spec 020: the one question form open in the panel (row + answer key).
  const [openForm, setOpenForm] = useState<{ rowId: string; key: string } | null>(null);
  const saveAnswer = useAnswerActions();
  const answers = useMemo(() => progress.answers ?? [], [progress.answers]);
  const answerByKey = useMemo(() => {
    const map = new Map<string, AnswerListEntry>();
    for (const a of answers) map.set(a.key, a);
    return map;
  }, [answers]);
  const answerEntry = useCallback((key: string) => answerByKey.get(key), [answerByKey]);

  // placement id → course code, for "covered by CS 2110" lines.
  const codeByPlacement = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of placements) {
      const c = placedCourses[p.courseId];
      map.set(p.id, c ? `${c.subject} ${c.number}` : p.courseId.replace(/-/g, " "));
    }
    return map;
  }, [placements, placedCourses]);

  const allItems = useMemo(() => progress.groups.flatMap((g) => g.items), [progress]);
  const doneItems = useMemo(
    () => allItems.filter((it) => it.status === "satisfied" || it.status === "waived"),
    [allItems]
  );
  const openBySemester = useMemo(() => itemsBySemester(progress), [progress]);

  // The highlight is a snapshot of one item's coverage. When the plan changes
  // so no item's coverage matches it anymore, drop it rather than leave stale
  // cards lit.
  useEffect(() => {
    if (highlighted.length === 0) return;
    if (!allItems.some((it) => it.coveredBy.length > 0 && sameIds(it.coveredBy, highlighted))) {
      setHighlighted([]);
    }
  }, [allItems, highlighted, setHighlighted]);

  // Esc clears the highlight (only listening while something is lit).
  useEffect(() => {
    if (highlighted.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHighlighted([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [highlighted, setHighlighted]);

  // Leaving the planner never strands a highlight.
  useEffect(() => () => setHighlighted([]), [setHighlighted]);

  const isHighlighted = useCallback(
    (it: RequirementItem) => it.coveredBy.length > 0 && sameIds(it.coveredBy, highlighted),
    [highlighted]
  );

  const activate = useCallback(
    (it: RequirementItem) => {
      // "Confirm with your advisor": nothing on the board or in the catalog
      // can answer it.
      if (it.dist?.confirm) return;
      if (it.status === "unmet") {
        setHighlighted([]);
        requestCatalogSearch("", { requirementId: it.id, requirementLabel: it.label });
        return;
      }
      // A partly filled group (2 of 10 CS electives) still needs courses: show
      // the ones counting AND open the catalog for the rest. Every partial
      // Distribution row still needs courses the same way.
      if (it.status === "partial" && (it.poolProgress || it.dist)) {
        setHighlighted(it.coveredBy);
        requestCatalogSearch("", { requirementId: it.id, requirementLabel: it.label });
        return;
      }
      if (it.coveredBy.length === 0) return; // waived, or covered by credit only
      setHighlighted(isHighlighted(it) ? [] : it.coveredBy);
    },
    [isHighlighted, requestCatalogSearch, setHighlighted]
  );

  const detailFor = useCallback(
    (it: RequirementItem, withSem: boolean): string => {
      const codes = it.coveredBy.map((id) => codeByPlacement.get(id) ?? "a course");
      if (it.dist) return distDetail(it, codes);
      switch (it.status) {
        case "waived":
          return "Waived";
        case "satisfied":
          return codes.length > 0 ? codes.join(", ") : "Your credit";
        case "partial": {
          const p = it.poolProgress;
          const counted = codes.join(", ") || "your credit";
          if (!p) return `Partly: ${counted}`;
          // Courses short → say how many courses; courses met but credits short → say credits.
          const howFar =
            p.courses < p.requiredCourses
              ? `${p.courses} of ${p.requiredCourses} courses`
              : `${p.credits} of ${p.requiredCredits} credits`;
          return `${howFar}: ${counted}`;
        }
        case "unmet":
          if (!it.checkable) return "Can't check this automatically — confirm with your advisor";
          return withSem && it.suggestedSem != null
            ? `Semester ${it.suggestedSem} · find a class`
            : "Find a class";
      }
    },
    [codeByPlacement]
  );

  const row = (it: RequirementItem, withSem = false) => (
    <RequirementRow
      key={it.id}
      item={it}
      detail={detailFor(it, withSem)}
      highlighted={isHighlighted(it)}
      programId={programId}
      onActivate={() => activate(it)}
      // Advisor-confirmed rows aren't the student's to waive.
      onToggleWaive={it.dist?.confirm ? undefined : () => toggleWaivedRequirement(it.id)}
      formKey={openForm?.rowId === it.id ? openForm.key : null}
      onFormChange={(key) => setOpenForm(key ? { rowId: it.id, key } : null)}
      answerEntry={answerEntry}
      onAnswer={saveAnswer}
    />
  );

  // ── Notices (spec 019): the engine needs an answer, or can't run ──
  if (programId && progress.notice) {
    const need = NOTICE_NEED[progress.notice.kind];
    return (
      <section data-still-needed className="flex flex-col gap-1">
        <p className="t-label">Still needed</p>
        <div data-requirement-notice={progress.notice.kind} className="flex flex-col gap-1.5">
          <p className="t-meta text-ink-3">{NOTICE_TEXT[progress.notice.kind]}</p>
          {need && <StudentContextQuestions need={need} compact />}
        </div>
      </section>
    );
  }

  // ── Empty states ──
  if (!selectedProgramId || progress.total === 0) {
    return (
      <section data-still-needed className="flex flex-col gap-1">
        <p className="t-label">Still needed</p>
        <p className="t-meta text-ink-3">
          {!selectedProgramId
            ? "Pick a major and what it needs shows up here."
            : isDistribution && progress.groups.length === 0
              ? "Loading requirements…"
              : "This board has no major requirements to track. Add any course you like."}
        </p>
      </section>
    );
  }

  // Open = still unmet or partly met. Engineering: exactly total − satisfied;
  // Distribution adds the advisor-confirmed rows, which stay out of the count.
  const openCount = allItems.filter((it) => it.status === "unmet" || it.status === "partial").length;
  const onlyConfirmLeft = isDistribution && progress.satisfiedCount === progress.total;
  const questionCount = progress.openQuestionCount ?? 0;
  // The header count opens the first row with a question, in the order shown.
  const openFirstQuestion = () => {
    const shown =
      sort === "category"
        ? progress.groups.flatMap((g) => g.items.filter((it) => it.status === "unmet" || it.status === "partial"))
        : openBySemester;
    const first = shown.find((it) => it.status !== "waived" && (it.dist?.questions?.length ?? 0) > 0);
    if (first) setOpenForm({ rowId: first.id, key: first.dist!.questions![0].key });
  };

  return (
    <section data-still-needed className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="t-label">Still needed</p>
          <p className="t-meta text-ink-4">
            <span className="num">{progress.satisfiedCount}</span> of{" "}
            <span className="num">{progress.total}</span> done
          </p>
        </div>
        {isDistribution && progress.catalogYear && (
          <p data-catalog-year className="t-meta text-ink-4">
            Requirements from the <span className="num">{catalogYearLabel(progress.catalogYear)}</span> Cornell
            catalog
          </p>
        )}
        {isDistribution &&
          progress.collegeVersion &&
          (editingStart ? (
            <div data-edit-start className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-2">
              <StudentContextQuestions edit compact onDone={() => setEditingStart(false)} />
              {/* Spec 020 D8: the start answers plus every stored answer. */}
              <div className="border-t border-line pt-1.5">
                <AnswersEditor answers={answers} onAnswer={saveAnswer} />
              </div>
              <button
                type="button"
                onClick={() => setEditingStart(false)}
                className="self-start t-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Close
              </button>
            </div>
          ) : (
            <p data-college-version className="t-meta text-ink-4">
              College rules: {progress.collegeVersion}.{" "}
              <button
                type="button"
                onClick={() => setEditingStart(true)}
                className="text-ink-3 underline underline-offset-2 hover:text-ink"
              >
                {answers.length > 0 ? (
                  <>
                    Your answers (<span className="num">{answers.length}</span>)
                  </>
                ) : (
                  "Your answers"
                )}
              </button>
            </p>
          ))}
        {isDistribution && progress.concentrations?.needed && (
          <div data-requirement-notice="needs-concentration" className="flex flex-col gap-1.5">
            <p className="t-meta text-ink-3">
              {CONCENTRATION_TEXT(progress.concentrations.min, progress.concentrations.max)}
            </p>
            <StudentContextQuestions need="concentration" compact />
          </div>
        )}
        {isDistribution &&
          progress.concentrations &&
          !progress.concentrations.needed &&
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
                className="self-start t-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p data-concentration className="t-meta text-ink-4">
              Concentration:{" "}
              {progress.concentrations.chosen.length > 0
                ? progress.concentrations.chosen
                    .map((id) => progress.concentrations!.options.find((o) => o.id === id)?.name ?? id)
                    .join(", ")
                : "none"}
              .{" "}
              <button
                type="button"
                onClick={() => setEditingConcentration(true)}
                className="text-ink-3 underline underline-offset-2 hover:text-ink"
              >
                Change your concentration
              </button>
            </p>
          ))}
        <p className="t-meta text-ink-3">
          {progress.concentrations?.needed
            ? "Pick your concentration to see everything your major needs."
            : openCount === 0
            ? "Everything your major needs is on your board."
            : onlyConfirmLeft
              ? "Everything we can check is on your board. Confirm the rest with your advisor."
              : "Courses you choose go on your board. Here's what your major still needs."}
        </p>
        {questionCount > 0 && (
          <button
            type="button"
            data-question-count={questionCount}
            onClick={openFirstQuestion}
            className="self-start rounded px-0.5 t-meta font-medium text-drop-text underline-offset-2 hover:underline"
          >
            <span className="num">{questionCount}</span> {questionCount === 1 ? "question" : "questions"}
          </button>
        )}
        {openCount > 0 && <SortToggle value={sort} onChange={setSort} />}
      </div>

      <div className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5">
        {openCount > 0 &&
          (sort === "category" ? (
            <div className="flex flex-col gap-3">
              {progress.groups.map((g) => {
                const open = g.items.filter((it) => it.status === "unmet" || it.status === "partial");
                if (open.length === 0) return null;
                return (
                  <div key={g.key} data-requirement-group={g.key}>
                    <p className="mb-0.5 t-meta font-semibold text-ink-2">
                      {g.label}
                      {/* A group of advisor-confirmed rows only has nothing to count. */}
                      {g.total > 0 && (
                        <>
                          {" "}
                          · <span className="num">{g.satisfiedCount}</span> of{" "}
                          <span className="num">{g.total}</span>
                        </>
                      )}
                    </p>
                    <ul className="flex flex-col">{open.map((it) => row(it))}</ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="flex flex-col">{openBySemester.map((it) => row(it, true))}</ul>
          ))}

        {doneItems.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => setShowSatisfied((v) => !v)}
              aria-expanded={showSatisfied}
              className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left t-meta font-semibold text-ink-2 transition-colors hover:bg-surface-2"
            >
              <ChevronRight
                className={cn("h-3 w-3 shrink-0 transition-transform", showSatisfied && "rotate-90")}
                aria-hidden
              />
              Satisfied (<span className="num">{doneItems.length}</span>)
            </button>
            {showSatisfied && <ul className="mt-0.5 flex flex-col">{doneItems.map((it) => row(it))}</ul>}
          </div>
        )}
      </div>
    </section>
  );
}
