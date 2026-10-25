import { cn } from "@/lib/utils";

/** The first-run choice pill (FirstRun's year/credit pills), shared by the
 *  onboarding questions. `compact` is the Requirements/Majors panel size. */
export function choicePillClass(active: boolean, compact = false): string {
  return cn(
    "rounded-full border-[1.5px] transition-colors",
    compact ? "px-2.5 py-1 t-meta font-medium" : "px-4 py-2 t-body font-semibold",
    active
      ? "border-drop bg-drop-tint text-drop-text"
      : "border-line bg-surface text-ink-2 hover:border-drop hover:bg-drop-tint/60"
  );
}
