import { X } from "lucide-react";

/**
 * TriedLine (spec 025 D11/D12) — near the page header, one compact line with
 * every class being tried: "Classes you're trying (N) · Clear", each class
 * with a remove ×. The 20 cap counts exactly these (a class that lands on the
 * board leaves the list, PlanProvider), so the student can always see what
 * fills it.
 *
 * DOM: [data-tried-line]; each class [data-tried-chip=<course id>];
 * [data-tried-clear-all].
 */
export function TriedLine({
  ids,
  codeOf,
  onRemove,
  onClear,
}: {
  ids: readonly string[];
  /** "HIST 1530" for a course id. */
  codeOf: (id: string) => string;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div
      data-tried-line
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-drop bg-drop-tint px-3 py-1.5"
    >
      <p className="t-meta font-semibold text-drop-text">
        Classes you&apos;re trying (<span className="num">{ids.length}</span>)
      </p>
      <span className="t-meta text-drop-text" aria-hidden>
        ·
      </span>
      <button
        type="button"
        data-tried-clear-all
        onClick={onClear}
        className="t-meta text-ink-3 underline underline-offset-2 hover:text-ink"
      >
        Clear
      </button>
      <ul className="flex flex-wrap gap-1" aria-label="Classes you're trying">
        {ids.map((id) => {
          const code = codeOf(id);
          return (
            <li
              key={id}
              data-tried-chip={id}
              className="inline-flex items-center gap-0.5 rounded border border-drop bg-surface py-0.5 pl-1.5 pr-0.5 t-meta font-semibold text-drop-text"
            >
              {code}
              <button
                type="button"
                aria-label={`Stop trying ${code}`}
                onClick={() => onRemove(id)}
                className="rounded p-0.5 text-drop-text hover:bg-drop-tint"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
