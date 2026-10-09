import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import {
  useRequirementProgress,
  type RequirementItem,
} from "@/hooks/useRequirementProgress";
import { itemsBySemester } from "@/lib/planner/requirementProgress";
import { cn } from "@/lib/utils";
import { RequirementRow } from "./RequirementRow";
import { SortToggle } from "./SortToggle";
import { useSortPreference } from "./useSortPreference";

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
 * Clicking a satisfied/partial item highlights its covering cards on the board
 * (click again or Esc clears). Clicking an unmet item opens the catalog scoped
 * to courses that would satisfy it. Each item can be waived here.
 *
 * DOM contract (lane D Playwright): root [data-still-needed]; items
 * [data-requirement][data-status]; sort buttons named "By category" /
 * "By semester".
 */

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function StillNeededPanel() {
  const progress = useRequirementProgress();
  const { placements, placedCourses, toggleWaivedRequirement } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const highlighted = usePlannerStore((s) => s.highlightedPlacementIds);
  const setHighlighted = usePlannerStore((s) => s.setHighlightedPlacementIds);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);
  const [sort, setSort] = useSortPreference();
  const [showSatisfied, setShowSatisfied] = useState(false);

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
      if (it.status === "unmet") {
        setHighlighted([]);
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
      switch (it.status) {
        case "waived":
          return "Waived";
        case "satisfied":
          return codes.length > 0 ? codes.join(", ") : "Your credit";
        case "partial":
          return `Partly: ${codes.join(", ") || "your credit"}`;
        case "unmet":
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
      onActivate={() => activate(it)}
      onToggleWaive={() => toggleWaivedRequirement(it.id)}
    />
  );

  // ── Empty states ──
  if (!selectedProgramId || progress.total === 0) {
    return (
      <section data-still-needed className="flex flex-col gap-1">
        <p className="t-label">Still needed</p>
        <p className="t-meta text-ink-3">
          {selectedProgramId
            ? "This board has no major requirements to track. Add any course you like."
            : "Pick a major and what it needs shows up here."}
        </p>
      </section>
    );
  }

  const openCount = progress.total - progress.satisfiedCount;

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
        <p className="t-meta text-ink-3">
          {openCount > 0
            ? "Courses you choose go on your board. Here's what your major still needs."
            : "Everything your major needs is on your board."}
        </p>
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
                      {g.label} · <span className="num">{g.satisfiedCount}</span> of{" "}
                      <span className="num">{g.total}</span>
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
