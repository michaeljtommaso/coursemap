import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RequirementItem } from "@/hooks/useRequirementProgress";
import { CategoryChips } from "./CategoryChips";
import { ReportRowForm } from "./ReportRowControl";

/**
 * One requirement in the Still-needed panel (spec 014 D2). The row's main
 * button does the status-appropriate thing (the panel decides: highlight the
 * covering cards, or open the catalog scoped to this requirement); the
 * trailing text actions waive / un-waive it and report it as wrong (spec 019
 * D15). Distribution rows (spec 019 D9) add their category chips under the
 * detail line.
 *
 * DOM contract (Playwright, lane D): the <li> carries data-requirement=<id> and
 * data-status=<status>; Distribution rows also data-engine-status=<engine
 * status> (met / partial / unmet / unchecked / confirm / waived).
 */

const DOT: Record<RequirementItem["status"], string> = {
  unmet: "border-[1.5px] border-ink-4 bg-transparent",
  partial: "border-[1.5px] border-drop bg-drop-tint",
  satisfied: "bg-complete",
  waived: "bg-waived",
};

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
}) {
  const [reporting, setReporting] = useState(false);
  const waived = item.status === "waived";
  const highlightable = item.status === "satisfied" || item.status === "partial";
  const chips = item.dist?.categories;
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[item.status])} aria-hidden />
            <span className={cn("truncate t-body", waived && "text-ink-3")}>{item.label}</span>
          </span>
          <span className="block truncate pl-3.5 t-meta text-ink-4">{detail}</span>
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
