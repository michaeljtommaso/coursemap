import { useEffect, useRef, useState } from "react";
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
 * Once a choice stands it folds to one line, "Concentration: Applied
 * Mathematics · Change"; Change opens the pills again, and a single-choice
 * pick (or Done) folds it back. While a choice is still needed it stays open
 * with its prompt.
 *
 * Shown in the "Your programs" panel row and in the program's Requirements
 * section. DOM: [data-concentration-chooser=<programId>][data-needed];
 * [data-concentration-prompt]; folded, [data-concentration-summary] and
 * [data-concentration-change]; pills [data-concentration-option=<id>]
 * (aria-pressed); [data-concentration-done].
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
  const [editing, setEditing] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const foldedRef = useRef<HTMLButtonElement>(null);
  // Folded only once a choice stands; while one is needed (or an optional one
  // has none picked) the pills stay open.
  const folded = !c.needed && c.chosen.length > 0 && !editing;

  // Opening via Change moves focus to the pressed pill; folding back returns
  // it to Change, so the keyboard never lands on a removed element.
  const focusAfter = useRef<"pills" | "change" | null>(null);
  useEffect(() => {
    if (focusAfter.current === "pills") {
      (groupRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
        groupRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    } else if (focusAfter.current === "change") foldedRef.current?.focus();
    focusAfter.current = null;
  }, [folded]);

  const names = c.chosen.map((id) => c.options.find((o) => o.id === id)?.name ?? id).join(", ");
  if (folded) {
    return (
      <div data-concentration-chooser={c.programId} className="flex min-w-0 items-baseline gap-1 t-meta text-ink-3">
        <p data-concentration-summary className="min-w-0 truncate" title={names}>
          {c.chosen.length > 1 ? "Concentrations" : "Concentration"}: <span className="font-semibold text-ink">{names}</span>
        </p>
        <span aria-hidden>·</span>
        <button
          ref={foldedRef}
          type="button"
          data-concentration-change
          aria-expanded={false}
          aria-label={`Change the ${label}`}
          onClick={() => {
            focusAfter.current = "pills";
            setEditing(true);
          }}
          className="shrink-0 rounded font-semibold text-drop-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
        >
          Change
        </button>
      </div>
    );
  }

  const fold = () => {
    focusAfter.current = "change";
    setEditing(false);
  };
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
        <div className="flex items-baseline justify-between gap-2">
          <p className="t-meta text-ink-3">{single ? "Concentration" : `Concentrations (up to ${c.max})`}</p>
          {editing && c.chosen.length > 0 && (
            <button
              type="button"
              data-concentration-done
              onClick={fold}
              className="shrink-0 rounded t-meta font-semibold text-drop-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            >
              Done
            </button>
          )}
        </div>
      )}
      <div ref={groupRef} role="group" aria-label={label} className="flex flex-wrap gap-1">
        {c.options.map((o) => {
          const pressed = c.chosen.includes(o.id);
          const off = !pressed && !single && atMax;
          const onClick = () => {
            if (single && pressed) {
              if (c.min === 0) onChange([]);
              else if (editing) fold();
              return;
            }
            onChange(toggledConcentrations(c, o.id));
            // A single-choice swap is the whole edit: fold back to the line.
            if (single && editing) fold();
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
