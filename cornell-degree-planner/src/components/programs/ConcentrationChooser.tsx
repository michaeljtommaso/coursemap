import { cn } from "@/lib/utils";
import { concentrationPrompt, toggledConcentrations, type ConcentrationChoice } from "./programsModel";

/**
 * A second major's concentration chooser (spec 047 D2): one pill per
 * concentration its layers offer. A single-choice major swaps on click (a
 * pressed pill clears only when none is required); a multi-choice one toggles,
 * up to its max (never past 3). Each click saves to the plan. While too few
 * are chosen it leads with "Choose a concentration to finish Mathematics" —
 * the program can't finish until then, so it never sits at a silent 99%.
 *
 * Shown in the "Your programs" panel row and in the program's Requirements
 * section. DOM: [data-concentration-chooser=<programId>][data-needed];
 * [data-concentration-prompt]; pills [data-concentration-option=<id>]
 * (aria-pressed).
 */
export function ConcentrationChooser({
  choice: c,
  onChange,
}: {
  choice: ConcentrationChoice;
  onChange: (ids: string[]) => void;
}) {
  const single = c.max === 1;
  const atMax = c.chosen.length >= c.max;
  const label = single ? `${c.shortName} concentration` : `${c.shortName} concentrations (up to ${c.max})`;
  return (
    <div
      data-concentration-chooser={c.programId}
      data-needed={c.needed || undefined}
      className="flex flex-col gap-1.5"
    >
      {c.needed ? (
        <p
          data-concentration-prompt
          role="note"
          className="rounded-md border border-available bg-available-tint px-2 py-1.5 t-meta leading-snug text-available-text"
        >
          {concentrationPrompt(c)}
        </p>
      ) : (
        <p className="t-meta text-ink-3">{single ? "Concentration" : `Concentrations (up to ${c.max})`}</p>
      )}
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {c.options.map((o) => {
          const pressed = c.chosen.includes(o.id);
          const off = !pressed && !single && atMax;
          const onClick = () => {
            if (single && pressed) {
              if (c.min === 0) onChange([]);
              return;
            }
            onChange(toggledConcentrations(c, o.id));
          };
          return (
            <button
              key={o.id}
              type="button"
              data-concentration-option={o.id}
              aria-pressed={pressed}
              disabled={off}
              onClick={onClick}
              className={cn(
                "h-6 max-w-full truncate rounded-md border px-2 t-meta font-semibold transition-colors",
                pressed
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
                off && "cursor-default opacity-50 hover:bg-surface hover:text-ink-2"
              )}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
