import { cn } from "@/lib/utils";
import type { SortMode } from "./useSortPreference";

/** The Still-needed sort switch (spec 014 D2): a two-button segmented control.
 *  Accessible names are exactly "By category" / "By semester" (DOM contract). */
const OPTIONS: { value: SortMode; label: string }[] = [
  { value: "category", label: "By category" },
  { value: "semester", label: "By semester" },
];

export function SortToggle({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sort requirements"
      className="mt-1 flex rounded-md border border-line bg-surface-2 p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-1.5 py-0.5 t-meta transition-colors",
            value === o.value ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-3 hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
