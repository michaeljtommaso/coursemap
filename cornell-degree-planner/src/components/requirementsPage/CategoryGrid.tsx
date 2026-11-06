import { cn } from "@/lib/utils";
import type { DistributionItemInfo } from "@/hooks/useRequirementProgress";

/**
 * CategoryGrid (spec 028 D8) — a distribution row's categories as a grid of
 * short chips, two to five across depending on the column's width: met
 * filled green, open dashed, and (D11) a category a tried class would fill
 * dashed blue. Same per-chip hooks as the rail's CategoryChips
 * ([data-category][data-filled]) plus [data-tried].
 */
export function CategoryGrid({
  categories,
  tried,
}: {
  categories: NonNullable<DistributionItemInfo["categories"]>;
  /** Category ids the tried classes would fill. */
  tried?: ReadonlySet<string>;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1" aria-label="Categories">
      {categories.map((c) => {
        const isTried = !c.filled && !!tried?.has(c.id);
        return (
          <li
            key={c.id}
            data-category={c.id}
            data-filled={c.filled ? "true" : "false"}
            data-tried={isTried ? "true" : undefined}
            title={c.label}
            className={cn(
              "truncate rounded-md border px-1.5 py-0.5 t-meta leading-tight",
              c.filled
                ? "border-complete bg-complete-tint text-complete-text"
                : isTried
                  ? "border-dashed border-drop bg-drop-tint text-drop-text"
                  : c.missing
                    ? "border-dashed border-line-strong text-ink-3"
                    : "border-line text-ink-4"
            )}
          >
            {c.label}
            <span className="sr-only">
              {c.filled ? " (counted)" : isTried ? " (if you take what you're trying)" : c.missing ? " (still needed)" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
