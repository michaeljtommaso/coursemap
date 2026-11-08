import { Plus } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { addShortTermLabel } from "@/components/roadmap/boardColumns";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The gap "+" (spec 042 D2/D8/D9) — a small (20px), muted, always-visible
 * circle in the gap just BEFORE semester column `sem`. A click adds the short
 * term before that semester: a Summer before a Fall, a Winter before a Spring.
 * The same on touch (no hover-only reveal); it brightens on hover and focus.
 *
 * SemesterColumn renders it inside its sticky header, absolutely positioned
 * into the 40px column gap, so it rides at header height and never changes
 * the column layout (columns don't move when it appears or disappears).
 * Shown only when the gap has no short term yet and the plan is under
 * MAX_SHORT_TERMS (RoadmapCanvas decides).
 */
export function AddShortTermButton({
  sem,
  enteringYear,
}: {
  sem: number;
  enteringYear: number | null;
}) {
  const { addShortTerm } = usePlan();
  const label = addShortTermLabel(sem, enteringYear);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!addShortTerm(sem)) return;
    // This button unmounts with the new column; move keyboard focus onto the
    // new column's remove button so focus doesn't fall back to <body>.
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-short-term-before="${sem}"] [data-remove-short-term]`)
        ?.focus({ preventScroll: true })
    );
  };

  return (
    <Tooltip content={label}>
      <button
        type="button"
        data-add-short-term={sem}
        aria-label={label}
        onClick={onClick}
        className="absolute -left-[30px] top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-4 transition-colors hover:border-ink-3 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
