import { useEffect, useMemo, type ReactNode, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useRequirementProgress, type RequirementNotice } from "@/hooks/useRequirementProgress";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { cn } from "@/lib/utils";
import { buildRailBlocks, creditLineCredits, highlightStillValid, sameIds, type RailLine } from "./railLines";
import { TriedReminder } from "./TriedReminder";
import { RailProgramFold } from "./RailProgramFold";
import { useRailFold } from "./railFold";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import type { ProgramColor } from "@/hooks/useRequirementProgress";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * RailStillNeeded (spec 028 D9/D13) — "Still needed" in the planner rail as
 * one line per requirement group (name, thin bar, count), "All requirements →"
 * to the Requirements page, and the tried-classes reminder under the lines.
 * Every detail (rows, questions, waivers, advisor notes) lives on the page.
 *
 * A click on a line keeps the board link the old checklist had: a line with
 * an open row lights the cards already counting and opens the catalog scoped
 * to that row; a finished line toggles its cards' highlight. Esc clears it,
 * and leaving the planner never strands one.
 *
 * Spec 047 D6: the college's and the primary's lines stay as above; each
 * second major or minor follows as one folded line (RailProgramFold) that a
 * click unfolds to its own group lines. Which are unfolded is remembered per
 * plan (railFold.ts). A plan with no extra program renders exactly as before.
 *
 * DOM contract: [data-rail-still-needed] root; [data-rail-group] with
 * [data-group-key] per line ("credit" for Credit before Cornell);
 * [data-rail-notice=<kind>] for a notice line; [data-rail-program] per extra
 * program.
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

function GroupLine({
  line,
  lit,
  onClick,
  color = null,
}: {
  line: RailLine;
  lit: boolean;
  onClick: () => void;
  /** Spec 047: an extra program's lines fill in its color until done. */
  color?: ProgramColor | null;
}) {
  const triedFraction = line.need > 0 ? Math.min(1 - line.fraction, line.triedPlus / line.need) : 0;
  return (
    <Tooltip content={line.fullLabel}>
    <button
      type="button"
      data-rail-group
      data-group-key={line.key}
      data-done={line.done || undefined}
      aria-pressed={lit}
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors",
        lit ? "bg-drop-tint" : "hover:bg-surface-2"
      )}
    >
      <span className="line-clamp-2 break-words text-[11.5px] font-medium leading-snug text-ink">{line.name}</span>
      <span
        className={cn(
          "num text-[11px] font-semibold",
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
          <span
            className="block h-full bg-complete"
            style={{
              width: `${line.fraction * 100}%`,
              ...(color && !line.done ? { background: PROGRAM_COLOR_VAR[color] } : {}),
            }}
          />
          {triedFraction > 0 && <span className="block h-full bg-drop" style={{ width: `${triedFraction * 100}%` }} />}
        </span>
      )}
    </button>
    </Tooltip>
  );
}

export function RailStillNeeded({ columnSems }: { columnSems: number[] }) {
  const progress = useRequirementProgress();
  const { planProgramId, planId } = usePlan();
  const [openPrograms, toggleProgram] = useRailFold(planId);
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
  const conc = progress.concentrations;
  const concentrationName =
    conc && conc.chosen.length > 0
      ? conc.chosen.map((id) => conc.options.find((o) => o.id === id)?.name ?? id).join(", ")
      : null;
  const blocks = useMemo(
    () => buildRailBlocks(progress, { major: majorName, concentration: concentrationName }),
    [progress, majorName, concentrationName]
  );
  const lines = blocks.base;
  // Every line on the rail, for the highlight check (folded programs too).
  const allLines = useMemo(
    () => (blocks.extras.length === 0 ? blocks.base : [...blocks.base, ...blocks.extras.flatMap((b) => b.lines)]),
    [blocks]
  );
  const creditCredits = useMemo(() => creditLineCredits(resolved), [resolved]);

  // A highlight that no longer matches a line or a row (the plan changed) is
  // dropped rather than left lit. Not while requirements are still solving:
  // a highlight set by the Requirements page's "Show on board" must survive
  // the first render here.
  useEffect(() => {
    if (highlighted.length === 0 || progress.groups.length === 0) return;
    if (!highlightStillValid(highlighted, allLines, progress)) setHighlighted([]);
  }, [highlighted, allLines, progress, setHighlighted]);

  // Esc clears the highlight (only listening while something is lit).
  useEffect(() => {
    if (highlighted.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHighlighted([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [highlighted, setHighlighted]);

  // Leaving the planner never strands a highlight the RAIL set. A highlight
  // someone else set (the Requirements page's "Show on board", set just before
  // it navigates here) is left alone: React StrictMode's dev mount → cleanup →
  // mount would otherwise wipe it on arrival.
  const railSet = useRef<string[] | null>(null);
  const lightUp = (ids: string[]) => {
    railSet.current = ids;
    setHighlighted(ids);
  };
  const currentHighlight = useRef(highlighted);
  useEffect(() => {
    currentHighlight.current = highlighted;
  }, [highlighted]);
  useEffect(
    () => () => {
      const own = railSet.current;
      if (own != null && currentHighlight.current === own) setHighlighted([]);
    },
    [setHighlighted]
  );

  const activate = (line: RailLine) => {
    const open = line.firstOpen;
    if (open) {
      // Show what already counts AND find a class for what's left.
      lightUp(line.coveredBy);
      requestCatalogSearch("", { requirementId: open.id, requirementLabel: open.label });
      return;
    }
    if (line.coveredBy.length === 0) return; // waived, or met by credit only
    lightUp(sameIds(line.coveredBy, highlighted) ? [] : line.coveredBy);
  };

  const lineButton = (line: RailLine, color: ProgramColor | null = null) => (
    <GroupLine
      key={line.key}
      line={line}
      lit={line.coveredBy.length > 0 && sameIds(line.coveredBy, highlighted)}
      onClick={() => activate(line)}
      color={color}
    />
  );

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
        {lines.map((line) => lineButton(line))}
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
            <span className="num text-[11px] font-semibold text-ink-3">{creditCredits} cr</span>
          </button>
        )}
        {body}
        {programId &&
          blocks.extras.map((b) => (
            <RailProgramFold
              key={b.section.id}
              section={b.section}
              open={openPrograms.has(b.section.id)}
              forbidden={b.forbidden}
              onToggle={() => toggleProgram(b.section.id)}
            >
              {b.lines.length > 0 ? (
                b.lines.map((line) => lineButton(line, b.section.color))
              ) : (
                <p className="px-1.5 py-1 t-meta text-ink-3">
                  {b.section.status === "unavailable"
                    ? "Can't load this program right now"
                    : b.section.status === "loading"
                      ? "Loading requirements…"
                      : "Nothing to track here."}
                </p>
              )}
            </RailProgramFold>
          ))}
      </div>
      <TriedReminder tried={progress.tried} columnSems={columnSems} />
    </section>
  );
}
