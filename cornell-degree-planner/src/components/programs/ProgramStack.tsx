import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { usePrograms } from "@/hooks/usePrograms";
import { usePlan } from "@/hooks/usePlan";
import { useRequirementProgress, type RequirementProgress } from "@/hooks/useRequirementProgress";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useProgramStore } from "@/store/useProgramStore";
import type { AdditionalProgram } from "@/lib/schemas";
import type { LayerSharing } from "@/lib/planner/distribution/types";
import { ProgressRing } from "./ProgressRing";
import { ProgramsPanel } from "./ProgramsPanel";
import { AddProgramPicker } from "./AddProgramPicker";
import { useProgramFlows } from "./useProgramFlows";
import { useProgramNames } from "./useProgramNames";
import { usePopoverDismiss } from "./usePopoverDismiss";
import {
  addButtons,
  entrySummary,
  extraEntries,
  primaryEntry,
  segmentValue,
  type ProgramEntry,
  type PickerRow,
} from "./programsModel";

/**
 * ProgramStack (spec 047 D5) — the top bar's program control, replacing the
 * major select: one segment per program on the plan (a progress ring, the
 * name, the percent or "3/6") and a "+" segment. Any segment opens "Your
 * programs"; its add buttons open the add picker. `folded` (the bar's compact
 * and menu stages, the 1024 px floor) keeps the primary's segment and folds
 * the extra programs into one segment of rings.
 *
 * The primary segment carries `data-tour="major"` (the tour's anchor) and
 * `#program-stack-primary` with `data-program-id` (the e2e hook);
 * "Change major" in the panel is `#program-select`.
 */

type Open = null | { view: "panel" } | { view: "picker"; tab: "major" | "minor" };

const SEGMENT =
  "inline-flex items-center gap-[7px] border-0 bg-transparent px-2.5 t-body font-semibold text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

export function ProgramStack({ folded }: { folded: boolean }) {
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { additionalPrograms, planId } = usePlan();
  const progress = useRequirementProgress();
  const { getProgramData } = useProgramContext();
  const { add, remove } = useProgramFlows(progress);

  const [open, setOpen] = useState<Open>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    if (refocus) openerRef.current?.focus();
  }, []);
  usePopoverDismiss(open !== null, [wrapRef], (reason) => close(reason === "escape"));

  // The panel takes focus when it opens (the picker focuses its search).
  useEffect(() => {
    if (open?.view === "panel") popRef.current?.focus();
  }, [open?.view]);

  // A plan or major switch closes whatever was open.
  const planKey = `${selectedProgramId}|${planId}`;
  const [seenKey, setSeenKey] = useState(planKey);
  if (seenKey !== planKey) {
    setSeenKey(planKey);
    setOpen(null);
  }

  if (!selectedProgramId) return null;

  const primaryProgram = programs.find((p) => p.id === selectedProgramId);
  const primary = primaryEntry(selectedProgramId, primaryProgram, progress);
  const expanded = open !== null;

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    openerRef.current = e.currentTarget;
    setOpen((o) => (o ? null : { view: "panel" }));
  };
  const segmentProps = {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": expanded,
    "aria-controls": expanded ? panelId : undefined,
    onClick: toggle,
  };

  // A layer's sharing, only when it is already in memory (never a fetch).
  const sharingOf = (id: string): LayerSharing | undefined =>
    getProgramData(id)?.layers?.find((l) => l.id === id || (l.kind !== "college" && l.kind !== "concentration" && l.programId === id))
      ?.sharing;

  return (
    <div ref={wrapRef} className="relative">
      <div
        id="program-stack"
        role="group"
        aria-label="Programs on this plan"
        className={cn(
          "flex h-[34px] items-stretch overflow-hidden rounded-[9px] border bg-surface",
          expanded ? "border-ink" : "border-line"
        )}
      >
        <Tooltip content={`${primary.name}${primary.status === "ok" ? ` · ${primary.pct}% done` : ""}`} placement="bottom">
          <button
            type="button"
            id="program-stack-primary"
            data-tour="major"
            data-program-id={selectedProgramId}
            data-program-name={primary.name}
            aria-label={`${entrySummary(primary)}. Your programs`}
            className={cn(SEGMENT, "pl-[9px]")}
            {...segmentProps}
          >
            <ProgressRing pct={primary.status === "ok" ? primary.pct : 0} color={null} />
            <span className="max-w-[12rem] truncate">{primary.shortName}</span>
            {!folded && segmentValue(primary) && (
              <span className="t-meta font-medium text-ink-3">{segmentValue(primary)}</span>
            )}
            <ChevronDown className="h-[11px] w-[11px] shrink-0 text-ink-3" aria-hidden />
          </button>
        </Tooltip>

        {additionalPrograms.length > 0 && (
          <ExtraSegments
            list={additionalPrograms}
            progress={progress}
            folded={folded}
            segmentProps={segmentProps}
          />
        )}

        <Tooltip content="Add a second major or minor" placement="bottom">
          <button
            type="button"
            aria-label="Add a second major or minor"
            className={cn(SEGMENT, "w-8 justify-center border-l border-line-faint bg-canvas px-0 text-ink-2")}
            {...segmentProps}
          >
            <Plus className="h-[13px] w-[13px]" aria-hidden />
          </button>
        </Tooltip>
      </div>

      {open && (
        <StackPopover
          open={open}
          popRef={popRef}
          panelId={panelId}
          primary={primary}
          primaryProgram={primaryProgram}
          primarySharing={sharingOf(selectedProgramId)}
          sharingOf={sharingOf}
          list={additionalPrograms}
          progress={progress}
          onAdd={(tab) => setOpen({ view: "picker", tab })}
          onPick={(row) => {
            add({ programId: row.id, kind: row.kind, shortName: row.shortName });
            close(true);
          }}
          onRemove={(id) => {
            remove(id);
            popRef.current?.focus();
          }}
          onClose={() => close(false)}
        />
      )}
    </div>
  );
}

type SegmentProps = {
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

/** The extra programs' segments; folded, one segment of rings. A component of
 *  its own so the minor index is read only by plans that have extras. */
function ExtraSegments({
  list,
  progress,
  folded,
  segmentProps,
}: {
  list: AdditionalProgram[];
  progress: RequirementProgress;
  folded: boolean;
  segmentProps: SegmentProps;
}) {
  const { lookup } = useProgramNames();
  const entries = extraEntries(list, progress.sections, lookup);
  const ring = (e: ProgramEntry) => <ProgressRing key={e.id} pct={e.status === "ok" ? e.pct : 0} color={e.color} />;

  if (folded) {
    const label = entries.map(entrySummary).join(", ");
    return (
      <Tooltip content={label} placement="bottom">
        <button
          type="button"
          aria-label={`${label}. Your programs`}
          className={cn(SEGMENT, "gap-0.5 border-l border-line-faint px-2")}
          {...segmentProps}
        >
          {entries.map(ring)}
        </button>
      </Tooltip>
    );
  }
  return (
    <>
      {entries.map((e) => {
        const value = segmentValue(e);
        return (
          <Tooltip key={e.id} content={entrySummary(e)} placement="bottom">
            <button
              type="button"
              data-program-segment={e.id}
              aria-label={`${entrySummary(e)}. Your programs`}
              className={cn(SEGMENT, "border-l border-line-faint")}
              {...segmentProps}
            >
              {ring(e)}
              <span className="max-w-[10rem] truncate">{e.shortName}</span>
              {value && <span className="t-meta font-medium text-ink-3">{value}</span>}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

/** The open panel or picker. Mounted only while open, so the minor index is
 *  read on demand. */
function StackPopover({
  open,
  popRef,
  panelId,
  primary,
  primaryProgram,
  primarySharing,
  sharingOf,
  list,
  progress,
  onAdd,
  onPick,
  onRemove,
  onClose,
}: {
  open: Exclude<Open, null>;
  popRef: React.RefObject<HTMLDivElement | null>;
  panelId: string;
  primary: ProgramEntry;
  primaryProgram: ReturnType<typeof usePrograms>["programs"][number] | undefined;
  primarySharing: LayerSharing | undefined;
  sharingOf: (id: string) => LayerSharing | undefined;
  list: AdditionalProgram[];
  progress: RequirementProgress;
  onAdd: (tab: "major" | "minor") => void;
  onPick: (row: PickerRow) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const { lookup, shortNameOf: indexShortName } = useProgramNames();
  const entries = [primary, ...extraEntries(list, progress.sections, lookup)];
  const shortNameOf = (id: string) => entries.find((e) => e.id === id)?.shortName ?? indexShortName(id);
  const availability = addButtons({ list, primaryProgram, primarySharing });

  if (open.view === "picker") {
    return (
      <AddProgramPicker
        ref={popRef}
        id={panelId}
        initialTab={open.tab}
        add={availability}
        onPick={onPick}
        ctx={{ primaryId: primary.id, primaryProgram, list, shortNameOf, sharingOf }}
      />
    );
  }
  return (
    <ProgramsPanel
      ref={popRef}
      id={panelId}
      entries={entries}
      overlap={progress.overlap ?? []}
      add={availability}
      shortNameOf={shortNameOf}
      onAdd={onAdd}
      onRemove={onRemove}
      onClose={onClose}
    />
  );
}
