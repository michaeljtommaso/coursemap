import { cn } from "@/lib/utils";
import type { DistributionItemInfo } from "@/hooks/useRequirementProgress";

/**
 * CategoryChips (spec 019 D9) — one chip per category of a distribution row,
 * in authored order: filled when a course on the board counts there, dashed
 * when the row still needs it (so the missing ones are named). Wraps at phone
 * width.
 */
export function CategoryChips({
  categories,
}: {
  categories: NonNullable<DistributionItemInfo["categories"]>;
}) {
  return (
    <span className="flex flex-wrap gap-1" role="list" aria-label="Categories">
      {categories.map((c) => (
        <span
          key={c.id}
          role="listitem"
          data-category={c.id}
          data-filled={c.filled ? "true" : "false"}
          className={cn(
            "rounded-md border px-1.5 py-px t-meta leading-tight",
            c.filled
              ? "border-complete bg-complete-tint text-complete-text"
              : c.missing
                ? "border-dashed border-line-strong text-ink-3"
                : "border-line text-ink-4"
          )}
        >
          {c.label}
          <span className="sr-only">{c.filled ? " (counted)" : c.missing ? " (still needed)" : ""}</span>
        </span>
      ))}
    </span>
  );
}
