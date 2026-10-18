import { cn } from "@/lib/utils";
import { usePlannerStore, type CardDensity } from "@/store/usePlannerStore";

const OPTIONS: { value: CardDensity; label: string; title: string }[] = [
  {
    value: "detailed",
    label: "Detailed",
    title: "Show everything on each card",
  },
  {
    value: "compact",
    label: "Compact",
    title: "Show just the code, title and status; click a card for the rest",
  },
];

/**
 * CardDensityControl — the Detailed / Compact switch for course cards, beside
 * the zoom presets in the canvas corner. Compact cards keep the code, credits,
 * title and status line; the attribution, instructor and the bottom meta row
 * (category · PRE · unlocks · terms) live in the detail panel a click away.
 * The choice is persisted in usePlannerStore (localStorage), like zoom.
 */
export function CardDensityControl() {
  const density = usePlannerStore((s) => s.cardDensity);
  const setDensity = usePlannerStore((s) => s.setCardDensity);

  return (
    <div
      className="flex items-center overflow-hidden rounded-lg border border-line bg-surface/90 shadow-md backdrop-blur"
      role="group"
      aria-label="Card detail"
    >
      {OPTIONS.map((o) => {
        const active = density === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setDensity(o.value)}
            aria-pressed={active}
            title={o.title}
            className={cn(
              "px-2.5 py-1 t-meta transition-colors",
              active ? "bg-ink text-canvas" : "text-ink-3 hover:bg-surface-2 hover:text-ink"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
