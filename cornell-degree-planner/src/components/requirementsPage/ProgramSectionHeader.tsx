import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import type { ProgramSection } from "@/hooks/useRequirementProgress";
import { SECTION_KIND_LABEL } from "@/components/requirements/programSections";
import { useProgramStore } from "@/store/useProgramStore";
import { engineeringPairNote } from "@/lib/planner/engineeringDoubleMajor";

/**
 * ProgramSectionHeader (spec 047 D6/D8/D14) — one program's block on the
 * Requirements page when the plan holds several: a header button (chevron,
 * colored dot for an extra program, name, kind, its own bar and percent) that
 * folds the program's group tables (open by default); under it, the overlap
 * line of each limited pair this program is the later side of, and the
 * "can't be combined" warning in place of a plain percent (D14) — also used
 * for a minor a major on the plan isn't open to (D12). A second major that
 * offers concentrations shows its chooser under the header (D2); while one
 * is still needed the status reads "Needs a concentration", not a silent 99%.
 * An Engineering second major shows its pair's note under the header (D15:
 * every allowed pair says courses may count toward both majors and to confirm
 * with both advisors; EnvE with CE or BE adds the coordinators' approval
 * first), read against the plan's primary.
 *
 * DOM: [data-program-section=<id>][data-open]; the header button
 * [data-program-section-toggle] (aria-expanded); [data-overlap-line];
 * [data-program-warning]; [data-program-note]; [data-program-section-status].
 */
export function ProgramSectionHeader({
  section,
  domId,
  open,
  onToggle,
  overlapLines,
  forbiddenText,
  concentration = null,
  children,
}: {
  section: ProgramSection;
  /** The header's DOM id (the outline jumps to it). */
  domId: string;
  open: boolean;
  onToggle: () => void;
  /** Overlap lines shown under the header (this program is the later one). */
  overlapLines: string[];
  /** D14: set when this program can't be combined with an earlier one. */
  forbiddenText: string | null;
  /** D2: a second major's concentration chooser, and whether one is still needed. */
  concentration?: { needed: boolean; chooser: ReactNode } | null;
  children: ReactNode;
}) {
  const bodyId = useId();
  const primaryId = useProgramStore((s) => s.selectedProgramId);
  const note = section.kind === "secondMajor" && primaryId && !forbiddenText ? engineeringPairNote(primaryId, section.id) : null;
  const color = section.color ? PROGRAM_COLOR_VAR[section.color] : null;
  const pct = Math.max(0, Math.min(100, Math.round(section.pct)));
  const status =
    section.status === "loading"
      ? "Loading…"
      : section.status === "unavailable"
        ? "Can't load right now"
        : forbiddenText
          ? "Can't combine"
          : concentration?.needed
            ? "Needs a concentration"
            : `${pct}%`;
  const warn = section.status === "unavailable" || !!forbiddenText || !!concentration?.needed;
  const showBar = section.status === "ok" && !forbiddenText && !concentration?.needed;
  return (
    <section data-program-section={section.id} data-open={open || undefined} className="flex flex-col gap-3">
      <h2 id={domId} className="mt-2 scroll-mt-4">
        <button
          type="button"
          data-program-section-toggle
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex w-full items-center gap-2.5 rounded-md py-1 text-left transition-colors hover:bg-surface-2"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
          <span className="min-w-0 truncate t-body font-semibold text-ink">{section.name}</span>
          <span className="shrink-0 t-meta text-ink-3">{SECTION_KIND_LABEL[section.kind]}</span>
          {showBar && (
            <span className="ml-auto block h-[5px] w-[120px] shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{ width: `${pct}%`, background: pct >= 100 ? "var(--complete)" : (color ?? "var(--text)") }}
              />
            </span>
          )}
          <span
            data-program-section-status
            className={cn(
              "num shrink-0 whitespace-nowrap text-right t-meta",
              showBar ? "w-10" : "ml-auto",
              warn ? "font-semibold text-available-text" : "text-ink-2"
            )}
          >
            {status}
          </span>
        </button>
      </h2>
      {forbiddenText && (
        <p data-program-warning role="note" className="-mt-1 rounded-md bg-available-tint px-3 py-2 t-meta text-available-text">
          {forbiddenText}
        </p>
      )}
      {note && (
        <p data-program-note role="note" className="-mt-1 t-meta text-ink-3">
          {note}
        </p>
      )}
      {concentration && <div className="-mt-1">{concentration.chooser}</div>}
      {overlapLines.map((line) => (
        <p key={line} data-overlap-line className="-mt-1 t-meta text-ink-3">
          {line}
        </p>
      ))}
      {open && (
        <div id={bodyId} className="flex flex-col gap-4">
          {section.status === "unavailable" ? (
            <p className="t-body text-ink-3">This program&apos;s requirements can&apos;t load right now. Your other programs still work.</p>
          ) : section.status === "loading" ? (
            <p className="t-body text-ink-3">Loading requirements…</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
