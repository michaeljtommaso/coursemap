import { ArrowRight } from "lucide-react";

/**
 * Major Match as one link line (spec 028 D9): "Major Match: Economics 34% →",
 * or the empty-state copy as the link. Opens the Majors panel.
 */
export function MajorMatchLink({
  top,
  ready,
  boardEmpty,
  onOpen,
}: {
  /** The top match, when Major Match has run and it counts something. */
  top: { name: string; pct: number } | null;
  ready: boolean;
  boardEmpty: boolean;
  onOpen: () => void;
}) {
  const text = top
    ? null
    : ready || boardEmpty
      ? "Add courses to your board and they'll point at a major."
      : "See which majors your courses point to.";
  return (
    <button
      type="button"
      data-rail-major-match
      onClick={onOpen}
      className="group flex w-full items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-left t-meta text-ink-3 transition-colors hover:border-drop hover:text-ink"
    >
      <span className={top ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1"}>
        {top ? (
          <>
            Major Match: <span className="font-semibold text-ink-2">{top.name}</span>{" "}
            <span className="num font-semibold text-ink-2">{top.pct}%</span>
          </>
        ) : (
          text
        )}
      </span>
      <ArrowRight className="h-2.5 w-2.5 shrink-0" aria-hidden />
    </button>
  );
}
