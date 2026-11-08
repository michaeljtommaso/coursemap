import { CalendarCheck, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * TargetTermSwitch (spec 017 D1) — the enrollment-term filter chip above the
 * /classes list. It is status text plus one plain action button, so a screen
 * reader hears what the list shows and what the button will do, never a toggle
 * whose name changes under it:
 *   on  → "Showing Spring 2027 classes"  [Show all]
 *   off → "Showing all classes"          [Show only Spring 2027 classes]
 * On, the chip reads as active (tinted) so nobody takes the list for the whole
 * catalog; off, it keeps the same bordered chip with an icon, in neutral.
 * Full width under 640px.
 */
export function TargetTermSwitch({
  on,
  termLabel,
  onChange,
}: {
  on: boolean;
  /** "Spring 2027". */
  termLabel: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <div
      data-testid="target-term-switch"
      className={cn(
        "mb-3 flex w-full items-center gap-2 rounded-md border px-3 py-1.5 sm:inline-flex sm:w-auto",
        // Same chip frame in both states (border + icon); only the fill and
        // emphasis change. Off uses the strong border on a neutral well so it
        // still reads as a chip, not loose text, in light and dark themes.
        on ? "border-drop bg-drop-tint text-drop-text" : "border-line-strong bg-surface-2 text-ink-2"
      )}
    >
      {on ? (
        <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className={cn("t-body", on && "font-semibold")} aria-live="polite">
        {on ? `Showing ${termLabel} classes` : "Showing all classes"}
      </span>
      <span aria-hidden className="t-meta">
        ·
      </span>
      <Tooltip content={on ? "List every course in the catalog" : `List only courses on the ${termLabel} roster`}>
        <button
          type="button"
          onClick={() => onChange(!on)}
          className="rounded-sm text-left t-body underline underline-offset-2 transition-colors hover:text-ink"
        >
          {on ? "Show all" : `Show only ${termLabel} classes`}
        </button>
      </Tooltip>
    </div>
  );
}
