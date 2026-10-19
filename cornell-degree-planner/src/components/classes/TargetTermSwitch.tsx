import { CalendarCheck, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TargetTermSwitch (spec 017 D1) — the enrollment-term filter chip above the
 * /classes list. On, it reads as an active chip ("Showing Spring 2027 classes ·
 * Show all") so nobody takes the list for the whole catalog; off, the same spot
 * offers "Show only Spring 2027 classes". One toggle button (aria-pressed);
 * full width under 640px.
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
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={
        on
          ? `Only courses on the ${termLabel} roster are listed`
          : `List only courses on the ${termLabel} roster`
      }
      className={cn(
        "mb-3 flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left transition-colors sm:inline-flex sm:w-auto",
        on
          ? "border-drop bg-drop-tint text-drop-text"
          : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink"
      )}
    >
      {on ? (
        <>
          <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="t-body font-semibold">Showing {termLabel} classes</span>
          <span aria-hidden className="t-meta">·</span>
          <span className="t-body underline underline-offset-2">Show all</span>
        </>
      ) : (
        <>
          <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="t-body">Show only {termLabel} classes</span>
        </>
      )}
    </button>
  );
}
