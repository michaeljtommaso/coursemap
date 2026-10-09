import { cn } from "@/lib/utils";
import type { RequirementItem } from "@/hooks/useRequirementProgress";

/**
 * One requirement in the Still-needed panel (spec 014 D2). The row's main
 * button does the status-appropriate thing (the panel decides: highlight the
 * covering cards, or open the catalog scoped to this requirement); the trailing
 * text action waives / un-waives it.
 *
 * DOM contract (Playwright, lane D): the <li> carries data-requirement=<id> and
 * data-status=<status>.
 */

const DOT: Record<RequirementItem["status"], string> = {
  unmet: "border-[1.5px] border-ink-4 bg-transparent",
  partial: "border-[1.5px] border-drop bg-drop-tint",
  satisfied: "bg-complete",
  waived: "bg-waived",
};

export function RequirementRow({
  item,
  detail,
  highlighted,
  onActivate,
  onToggleWaive,
}: {
  item: RequirementItem;
  /** The meta line under the label ("Find a class", "CS 4820", "Waived", …). */
  detail: string;
  /** Its covering cards are highlighted on the board right now. */
  highlighted: boolean;
  onActivate: () => void;
  onToggleWaive: () => void;
}) {
  const waived = item.status === "waived";
  const highlightable = item.status === "satisfied" || item.status === "partial";
  return (
    <li
      data-requirement={item.id}
      data-status={item.status}
      data-checkable={item.checkable ? undefined : "false"}
      className="group flex items-start gap-1"
    >
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
      </button>
      <button
        type="button"
        onClick={onToggleWaive}
        className={cn(
          "mt-1 shrink-0 rounded px-1 py-0.5 t-meta text-ink-4 transition-opacity hover:bg-surface-2 hover:text-ink",
          // Hover-revealed on pointer devices; always visible on touch-only.
          "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-hover:none)]:opacity-100"
        )}
      >
        {waived ? "Remove waiver" : "Waive"}
      </button>
    </li>
  );
}
