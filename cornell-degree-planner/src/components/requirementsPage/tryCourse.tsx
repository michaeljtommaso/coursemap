import { useState } from "react";
import { cn } from "@/lib/utils";
import { recordToCourse } from "@/lib/catalog/recordToCourse";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";

/**
 * tryCourse (spec 028 D11, shared by spec 045's side panel and header search):
 * one class with **Try** / **Trying ✓** (counted "as if you took it", in blue)
 * and **+ <enrollment term>** (straight onto the board), plus the toggle logic
 * every list of such classes uses.
 *
 * DOM: each class [data-try-course=<id>]; its add button [data-add-to-term];
 * a search result already on the board [data-on-board].
 */

export type TryActions = {
  triedIds: readonly string[];
  atCap: boolean;
  /** False when it couldn't be tried (already tried, or at the cap). */
  onTry: (courseId: string) => boolean;
  onUntry: (courseId: string) => void;
  /** Put it on the board in the enrollment term (or arm it for the board). */
  onAdd: (course: Course) => void;
  /** "+ Spring 2027", or "Place on board" with no enrollment term known. */
  addLabel: string;
};

export type TryLine = {
  id: string;
  code: string;
  title: string;
  /** What it would fill (requirement or category names). */
  fills: string[];
  record?: CatalogIndexRecord;
  /** A hint line that replaces "Fills …" (search results: here or elsewhere). */
  hint?: string;
  /** Already on the board: no buttons, says so. */
  onBoard?: boolean;
};

export function tryLineFor(
  id: string,
  fills: string[],
  recordById: (id: string) => CatalogIndexRecord | undefined,
  hint?: string
): TryLine {
  const r = recordById(id);
  return {
    id,
    code: r ? `${r.subject} ${r.number}` : id.replace(/-/g, " "),
    title: r?.title ?? "",
    fills,
    record: r,
    hint,
  };
}

/**
 * Try / untry with the cap: `capHit` turns on when a Try was refused at the
 * cap; `triedHere` remembers what each class was shown filling when tried
 * from this list, so a just-tried class keeps its line.
 */
export function useTryToggle(actions: TryActions) {
  const [capHit, setCapHit] = useState(false);
  const [triedHere, setTriedHere] = useState<Record<string, string[]>>({});
  const tried = new Set(actions.triedIds);
  const toggle = (line: TryLine) => {
    if (tried.has(line.id)) {
      actions.onUntry(line.id);
      setCapHit(false);
      return;
    }
    if (!actions.onTry(line.id)) {
      if (actions.atCap) setCapHit(true);
      return;
    }
    setTriedHere((m) => ({ ...m, [line.id]: line.fills }));
  };
  return { tried, toggle, capHit, triedHere };
}

const BTN = "whitespace-nowrap rounded-md border px-2 py-0.5 t-meta font-semibold transition-colors disabled:opacity-50";

export function TryCourseRow({
  line,
  tried,
  actions,
  onToggle,
  enrollmentTarget,
  termLabel,
}: {
  line: TryLine;
  /** Is this class being tried? */
  tried: boolean;
  actions: TryActions;
  onToggle: (line: TryLine) => void;
  enrollmentTarget: string | null;
  /** "Spring 2027", or null. */
  termLabel: string | null;
}) {
  const offTerm =
    !!enrollmentTarget && !!line.record?.roster && line.record.roster !== enrollmentTarget && !!termLabel;
  return (
    <li
      data-try-course={line.id}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
    >
      <span className="min-w-0">
        <span className="t-body font-bold text-ink">{line.code}</span>{" "}
        <span className="t-body text-ink-2">{line.title}</span>
        <span className="block truncate t-meta text-ink-3">
          {line.onBoard ? "" : line.hint ? line.hint : line.fills.length > 0 ? `Fills ${line.fills.join(", ")}` : ""}
          {offTerm && <span className="text-ink-4"> · Not on the {termLabel} roster</span>}
        </span>
      </span>
      {line.onBoard ? (
        <span data-on-board className="t-meta font-semibold text-ink-3">
          On your board
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={tried}
            onClick={() => onToggle(line)}
            disabled={!tried && actions.atCap}
            className={cn(
              BTN,
              tried
                ? "border-dashed border-drop bg-drop-tint text-drop-text"
                : "border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink"
            )}
          >
            {tried ? "Trying ✓" : "Try"}
          </button>
          {line.record && (
            <button
              type="button"
              data-add-to-term
              onClick={() => line.record && actions.onAdd(recordToCourse(line.record))}
              className={cn(BTN, "border-drop text-drop-text hover:bg-drop-tint")}
            >
              {actions.addLabel}
            </button>
          )}
        </span>
      )}
    </li>
  );
}
