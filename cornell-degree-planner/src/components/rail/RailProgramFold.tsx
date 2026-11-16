import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import type { ProgramSection } from "@/hooks/useRequirementProgress";
import { programSummary } from "./railLines";

/**
 * RailProgramFold (spec 047 D6, canvas variant D) — one extra program (a
 * second major or a minor) in the rail's "Still needed": folded, a single
 * line (chevron, colored dot, name, "4 of 10") over a thin bar in the
 * program's color; unfolded, its group lines (`children`), which behave like
 * the primary's. The header is a real button with aria-expanded.
 *
 * DOM: [data-rail-program=<program id>][data-open]; the header
 * [data-rail-program-toggle].
 */
export function RailProgramFold({
  section,
  open,
  forbidden,
  onToggle,
  children,
}: {
  section: ProgramSection;
  open: boolean;
  forbidden: boolean;
  onToggle: () => void;
  /** The program's group lines, shown unfolded. */
  children: ReactNode;
}) {
  const bodyId = useId();
  const summary = programSummary(section, forbidden);
  const color = section.color ? PROGRAM_COLOR_VAR[section.color] : "var(--text)";
  const pct = Math.max(0, Math.min(100, section.pct));
  return (
    <div data-rail-program={section.id} data-open={open || undefined} className="flex flex-col gap-px">
      <button
        type="button"
        data-rail-program-toggle
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
      >
        <ChevronDown
          className={cn("h-3 w-3 shrink-0 text-ink-3 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="truncate text-[11.5px] font-semibold text-ink-2">
          {section.shortName || section.name}
          <span className="sr-only">{section.kind === "minor" ? " minor" : " second major"}</span>
        </span>
        {!open ? (
          <span
            data-rail-program-summary
            className={cn(
              "num whitespace-nowrap text-[11px] font-semibold",
              summary.tone === "done"
                ? "text-complete-text"
                : summary.tone === "warn"
                  ? "text-available-text"
                  : "text-ink-3"
            )}
          >
            {summary.text}
          </span>
        ) : (
          <span />
        )}
        {!open && section.status === "ok" && (
          <span className="col-span-4 flex h-[3px] overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span
              className="block h-full"
              style={{ width: `${pct}%`, background: summary.tone === "done" ? "var(--complete)" : color }}
            />
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-px pl-3">
          {forbidden && (
            <p data-rail-program-warning className="px-1.5 py-1 t-meta font-medium text-available-text">
              Can&apos;t be combined with another program on this plan
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
