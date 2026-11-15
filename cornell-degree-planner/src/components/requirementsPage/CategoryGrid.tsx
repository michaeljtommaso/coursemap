import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DistributionItemInfo } from "@/hooks/useRequirementProgress";

/**
 * CategoryGrid (spec 028 D8) — a distribution row's categories as a grid of
 * short chips, two to five across depending on the column's width: met
 * filled green, open dashed, and (D11) a category a tried class would fill
 * dashed blue. A filled chip also names the course(s) filling it. Same per-chip hooks as the rail's CategoryChips
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
        // A filled chip names the course filling it ("Historical Analysis · HIST 1500").
        const text = c.filled && c.codes && c.codes.length > 0 ? `${c.label} · ${c.codes.join(", ")}` : c.label;
        return (
          <Tooltip key={c.id} content={text} truncatedOnly>
          <li
            data-category={c.id}
            data-filled={c.filled ? "true" : "false"}
            data-tried={isTried ? "true" : undefined}
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
            {text}
            <span className="sr-only">
              {c.filled ? " (counted)" : isTried ? " (if you take what you're trying)" : c.missing ? " (still needed)" : ""}
            </span>
          </li>
          </Tooltip>
        );
      })}
    </ul>
  );
}
