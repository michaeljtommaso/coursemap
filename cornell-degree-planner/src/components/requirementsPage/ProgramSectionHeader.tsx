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
  tried = null,
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
  /** The tried classes counting toward this program's rows (most came in
   *  when it was added, D3), and how to clear them. Null or 0: no line. */
  tried?: { count: number; onClear: () => void } | null;
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
  const triedCount = tried?.count ?? 0;
  return (
    // Group cards inside sit below the pinned header when the outline jumps
    // to them (--group-scroll-mt, read by RequirementTable / CreditTable).
    <section
      data-program-section={section.id}
      data-open={open || undefined}
      className="flex flex-col gap-3 [--group-scroll-mt:4.5rem]"
    >
      {/* The program is the page's top level: bigger than its group titles,
          with its color bar, and pinned to the top of the scroller while
          its groups scroll under it (a second major's "Science" vs the
          first's). */}
      <h2 id={domId} className="sticky top-0 z-[5] -mx-6 mt-3 scroll-mt-0 bg-canvas px-6 pb-2 pt-3">
        <button
          type="button"
          data-program-section-toggle
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2"
        >
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-ink-3 transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <span className="h-5 w-1.5 shrink-0 rounded-full" style={{ background: color ?? "var(--text)" }} aria-hidden />
          <span className="min-w-0 truncate t-headline" style={{ fontSize: "calc(var(--fs-headline) * 1.2)" }}>
            {section.name}
          </span>
          <span className="shrink-0 t-label">{SECTION_KIND_LABEL[section.kind]}</span>
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
      {triedCount > 0 && open && (
        <p
          data-program-tried
          role="note"
          className="-mt-1 flex flex-wrap items-center gap-x-2 rounded-md border border-dashed border-drop bg-drop-tint px-3 py-2 t-meta text-drop-text"
        >
          <span>
            <span className="num font-semibold">{triedCount}</span> tried {triedCount === 1 ? "class counts" : "classes count"}{" "}
            toward {section.shortName || section.name}, in blue: as if you take {triedCount === 1 ? "it" : "them"}, but{" "}
            {triedCount === 1 ? "it isn't" : "they aren't"} on your board yet.
          </span>
          <button
            type="button"
            data-program-tried-clear
            onClick={tried?.onClear}
            className="font-semibold underline underline-offset-2 hover:text-ink"
          >
            Clear {triedCount === 1 ? "it" : "them"}
          </button>
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
