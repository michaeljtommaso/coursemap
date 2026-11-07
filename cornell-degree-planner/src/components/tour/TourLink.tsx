import { CirclePlay } from "lucide-react";
import { useTourStore } from "@/store/useTourStore";
import type { TourId } from "./tourSteps";

/** "Take the tour" — replays a page's tour on demand (spec 033). */
export function TourLink({ tour }: { tour: TourId }) {
  const start = useTourStore((s) => s.start);
  return (
    <button
      type="button"
      onClick={() => start(tour)}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 t-meta text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <CirclePlay className="h-3.5 w-3.5" aria-hidden />
      Take the tour
    </button>
  );
}
