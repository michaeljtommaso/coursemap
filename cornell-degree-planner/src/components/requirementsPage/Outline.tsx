import { cn } from "@/lib/utils";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import type { ProgramColor } from "@/hooks/useRequirementProgress";

/**
 * Outline (spec 028 D10) — the page's sticky left column: every group with
 * its progress, under section labels; a click jumps to the group; the group
 * in view is highlighted.
 *
 * Spec 047 D6: with several programs, each program's label is itself a jump
 * button (colored dot for an extra program, its percent), so the outline
 * jumps between sections as well as groups.
 *
 * DOM: each entry [data-outline-group=<group key>] (aria-current when in
 * view); a program heading [data-outline-section=<section key>].
 */

export type OutlineEntry = {
  key: string;
  label: string;
  /** "1 of 2", "8 cr", "✓"; empty for none. */
  progress: string;
  done?: boolean;
  /** Tried classes' blue addition. */
  plus?: number;
  muted?: boolean;
};

export type OutlineSection = {
  key: string;
  label: string | null;
  entries: OutlineEntry[];
  /** Spec 047: the label jumps to the program's section header. */
  program?: { color: ProgramColor | null; progress: string };
};

export function Outline({
  sections,
  active,
  onJump,
}: {
  sections: OutlineSection[];
  active: string | null;
  onJump: (key: string) => void;
}) {
  return (
    <nav aria-label="Requirement groups" className="flex flex-col gap-0.5">
      {sections.map((s) => (
        <div key={s.key} className="flex flex-col gap-0.5">
          {s.label && s.program ? (
            <button
              type="button"
              data-outline-section={s.key}
              onClick={() => onJump(s.key)}
              className="mt-3 flex items-center gap-2 rounded-md px-2 py-1 text-left t-body font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              {s.program.color && (
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: PROGRAM_COLOR_VAR[s.program.color] }}
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="num shrink-0 t-meta text-ink-3">{s.program.progress}</span>
            </button>
          ) : (
            s.label && <p className="mt-3 truncate px-2 t-label text-ink-4">{s.label}</p>
          )}
          {s.entries.map((e) => (
            <button
              key={e.key}
              type="button"
              data-outline-group={e.key}
              aria-current={active === e.key ? "location" : undefined}
              onClick={() => onJump(e.key)}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 rounded-md px-2 py-1 text-left t-body transition-colors",
                active === e.key ? "bg-drop-tint text-ink" : "hover:bg-surface-2",
                e.muted ? "text-ink-3" : "text-ink-2"
              )}
            >
              <span className="truncate">{e.label}</span>
              <span
                className={cn(
                  "num whitespace-nowrap t-meta font-semibold",
                  e.done ? "text-complete-text" : active === e.key ? "text-drop-text" : "text-ink-3"
                )}
              >
                {e.progress}
                {!!e.plus && e.plus > 0 && <span className="text-drop-text"> +{e.plus}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
