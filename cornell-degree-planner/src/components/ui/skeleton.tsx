import { cn } from "@/lib/utils";

/**
 * Skeleton primitive (spec 003 §5.3).
 *
 * Shimmer animates OPACITY only (so it themes for free via the surface-2
 * token — no per-theme color branch). aria-hidden so screen readers skip the
 * placeholder, and prefers-reduced-motion drops the animation to a static
 * tint. The keyframes live in globals.css (.skeleton-shimmer).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-shimmer rounded-md bg-surface-2", className)}
    />
  );
}

/** Catalog chip-row skeleton — mirrors the CourseChip list layout. */
export function CatalogChipSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-md border border-line px-2 py-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-1.5 h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Canvas slot-grid skeleton — a loose grid of card-shaped placeholders. */
export function CanvasSlotSkeleton({
  cols = 4,
  rows = 4,
}: {
  cols?: number;
  rows?: number;
}) {
  return (
    <div className="flex h-full items-start justify-center p-8" aria-hidden="true">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="flex flex-col gap-4">
            <Skeleton className="h-10 w-[200px] rounded-2xl" />
            {Array.from({ length: rows }).map((_, r) => (
              <Skeleton key={r} className="h-[90px] w-[200px] rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
