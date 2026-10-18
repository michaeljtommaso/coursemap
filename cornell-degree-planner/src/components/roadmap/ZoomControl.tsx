import { cn } from "@/lib/utils";
import { usePlannerStore } from "@/store/usePlannerStore";
import { ZOOM_PRESETS } from "@/lib/canvas/zoom";
import { CardDensityControl } from "@/components/roadmap/CardDensityControl";

/**
 * ZoomControl (spec 006 §F2 / triage #15) — a small segmented control pinned to
 * the canvas's bottom-right corner. Presets only (100 / 85 / 70 / 55%); the
 * chosen level is persisted in usePlannerStore (localStorage). It sits ABOVE the
 * scrolling canvas but is not part of it, so it never scrolls away. The card
 * Detailed / Compact switch (CardDensityControl) shares the corner.
 */
export function ZoomControl() {
  const zoom = usePlannerStore((s) => s.zoom);
  const setZoom = usePlannerStore((s) => s.setZoom);

  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
      <CardDensityControl />
      <div
        className="flex items-center overflow-hidden rounded-lg border border-line bg-surface/90 shadow-md backdrop-blur"
        role="group"
        aria-label="Canvas zoom"
      >
        {ZOOM_PRESETS.map((preset) => {
          const active = zoom === preset;
          return (
            <button
              key={preset}
              onClick={() => setZoom(preset)}
              aria-pressed={active}
              className={cn(
                "px-2.5 py-1 t-meta tabular-nums transition-colors",
                active
                  ? "bg-ink text-canvas"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              )}
              title={`Zoom to ${Math.round(preset * 100)}%`}
            >
              <span className="num">{Math.round(preset * 100)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
