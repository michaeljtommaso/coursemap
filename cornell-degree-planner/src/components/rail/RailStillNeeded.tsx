import { useEffect, useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useRequirementProgress, type RequirementNotice } from "@/hooks/useRequirementProgress";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { cn } from "@/lib/utils";
import { buildRailLines, creditLineCredits, highlightStillValid, sameIds, type RailLine } from "./railLines";
import { TriedReminder } from "./TriedReminder";

/**
 * RailStillNeeded (spec 025 D9/D13) — "Still needed" in the planner rail as
 * one line per requirement group (name, thin bar, count), "All requirements →"
 * to the Requirements page, and the tried-classes reminder under the lines.
 * Every detail (rows, questions, waivers, advisor notes) lives on the page.
 *
 * A click on a line keeps the board link the old checklist had: a line with
 * an open row lights the cards already counting and opens the catalog scoped
 * to that row; a finished line toggles its cards' highlight. Esc clears it,
 * and leaving the planner never strands one.
 *
 * DOM contract: [data-rail-still-needed] root; [data-rail-group] with
 * [data-group-key] per line ("credit" for Credit before Cornell);
 * [data-rail-notice=<kind>] for a notice line.
 */

const NOTICE_LINE: Record<RequirementNotice["kind"] | "needs-concentration", string> = {
  "needs-entry-term": "Answer a question to see what you need",
  "needs-transfer": "Answer a question to see what you need",
  "needs-transfer-standing": "Answer a question to see what you need",
  "layers-unavailable": "Requirements couldn't load",
  "under-review": "This major's requirements are being reviewed",
  "needs-concentration": "Pick your concentration",
};

function NoticeLine({ kind }: { kind: keyof typeof NOTICE_LINE }) {
  return (
    <Link
      to="/requirements"
      data-rail-notice={kind}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 t-meta font-medium text-drop-text hover:bg-surface-2"
    >
      <span className="min-w-0 flex-1">{NOTICE_LINE[kind]}</span>
      <ArrowRight className="h-2.5 w-2.5 shrink-0" aria-hidden />
    </Link>
  );
}

function GroupLine({ line, lit, onClick }: { line: RailLine; lit: boolean; onClick: () => void }) {
  const triedFraction = line.need > 0 ? Math.min(1 - line.fraction, line.triedPlus / line.need) : 0;
  return (
    <button
      type="button"
      data-rail-group
      data-group-key={line.key}
      data-done={line.done || undefined}
      aria-pressed={lit}
      title={line.fullLabel}
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors",
        lit ? "bg-drop-tint" : "hover:bg-surface-2"
      )}
    >
      <span className="truncate text-[11.5px] font-medium text-ink">{line.name}</span>
      <span
        className={cn(
          "num text-[10.5px] font-semibold",
          lit ? "text-drop-text" : line.done ? "text-complete-text" : "text-ink-3"
        )}
      >
        {line.countText}
        {line.triedPlus > 0 && (
          <span data-tried-plus className="text-drop-text">
            {" "}
            +{line.triedPlus}
          </span>
        )}
      </span>
      {line.need > 0 && (
        <span className="col-span-2 flex h-[3px] overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="block h-full bg-complete" style={{ width: `${line.fraction * 100}%` }} />
          {triedFraction > 0 && <span className="block h-full bg-drop" style={{ width: `${triedFraction * 100}%` }} />}
        </span>
      )}
    </button>
  );
}

export function RailStillNeeded({ columnSems }: { columnSems: number[] }) {
  const progress = useRequirementProgress();
  const { planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const programId = planProgramId ?? selectedProgramId;
  const { programs } = usePrograms();
  const { resolved } = useCreditProfile();
  const highlighted = usePlannerStore((s) => s.highlightedPlacementIds);
  const setHighlighted = usePlannerStore((s) => s.setHighlightedPlacementIds);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);
  const navigate = useNavigate();

  const program = programs.find((p) => p.id === programId);
  const majorName = program ? program.short_name || program.name : null;
  const lines = useMemo(() => buildRailLines(progress, majorName), [progress, majorName]);
  const creditCredits = useMemo(() => creditLineCredits(resolved), [resolved]);

  // A highlight that no longer matches a line or a row (the plan changed) is
  // dropped rather than left lit. Not while requirements are still solving:
  // a highlight set by the Requirements page's "Show on board" must survive
  // the first render here.
  useEffect(() => {
    if (highlighted.length === 0 || progress.groups.length === 0) return;
    if (!highlightStillValid(highlighted, lines, progress)) setHighlighted([]);
  }, [highlighted, lines, progress, setHighlighted]);

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

  const activate = (line: RailLine) => {
    const open = line.firstOpen;
    if (open) {
      // Show what already counts AND find a class for what's left.
      setHighlighted(line.coveredBy);
      requestCatalogSearch("", { requirementId: open.id, requirementLabel: open.label });
      return;
    }
    if (line.coveredBy.length === 0) return; // waived, or met by credit only
    setHighlighted(sameIds(line.coveredBy, highlighted) ? [] : line.coveredBy);
  };

  const isDistribution = progress.engine === "distribution";
  let body: ReactNode;
  if (!programId) {
    body = <p className="px-1.5 t-meta text-ink-3">Pick a major and what it needs shows up here.</p>;
  } else if (progress.notice) {
    body = <NoticeLine kind={progress.notice.kind} />;
  } else if (lines.length === 0) {
    body = (
      <p className="px-1.5 t-meta text-ink-3">
        {isDistribution && progress.groups.length === 0
          ? "Loading requirements…"
          : "This board has no major requirements to track. Add any course you like."}
      </p>
    );
  } else {
    body = (
      <>
        {progress.concentrations?.needed && <NoticeLine kind="needs-concentration" />}
        {lines.map((line) => (
          <GroupLine
            key={line.key}
            line={line}
            lit={line.coveredBy.length > 0 && sameIds(line.coveredBy, highlighted)}
            onClick={() => activate(line)}
          />
        ))}
      </>
    );
  }

  return (
    <section data-rail-still-needed className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="t-label">Still needed</p>
        <Link
          to="/requirements"
          data-rail-all-requirements
          className="t-meta font-medium text-drop-text underline-offset-2 hover:underline"
        >
          All requirements →
        </Link>
      </div>
      <div className="-mx-1.5 flex min-h-0 flex-col gap-px overflow-y-auto">
        {creditCredits != null && (
          <button
            type="button"
            data-rail-group
            data-group-key="credit"
            onClick={() => navigate("/requirements")}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
          >
            <span className="truncate text-[11.5px] font-medium text-ink">Credit before Cornell</span>
            <span className="num text-[10.5px] font-semibold text-ink-3">{creditCredits} cr</span>
          </button>
        )}
        {body}
      </div>
      <TriedReminder tried={progress.tried} columnSems={columnSems} />
    </section>
  );
}
