import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { recordToCourse } from "@/lib/catalog/recordToCourse";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";
import { TRY_CAP_TEXT, fillsOf, pickSuggestions, type FillTarget } from "./suggestions";

/**
 * TryStrip (spec 025 D10/D11) — the end of a group card with open rows: try
 * any class against this group, or one of a few suggested classes that would
 * fill something still open here (enrollment term's roster first). Each class
 * has **Try** / **Trying ✓** (tryCourse / untryCourse: counted "as if you took
 * it", in blue) and **+ <enrollment term>** (straight onto the board).
 *
 * Classes being tried that fill this group stay listed first, so the toggle a
 * student just pressed doesn't move out from under them.
 *
 * DOM: root [data-try-strip]; each class [data-try-course=<id>].
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

type Line = {
  id: string;
  code: string;
  title: string;
  fills: string[];
  record?: CatalogIndexRecord;
  /** Search results only: nothing open here would count it. */
  fillsNothing?: boolean;
};

const BTN = "whitespace-nowrap rounded-md border px-2 py-0.5 t-meta font-semibold transition-colors disabled:opacity-50";

export function TryStrip({
  targets,
  index,
  recordById,
  enrollmentTarget,
  termLabel,
  exclude,
  triedFills,
  actions,
}: {
  targets: readonly FillTarget[];
  index: readonly CatalogIndexRecord[];
  recordById: (id: string) => CatalogIndexRecord | undefined;
  enrollmentTarget: string | null;
  /** "Spring 2027" (the roster the suggestions prefer), or null. */
  termLabel: string | null;
  /** Courses never suggested: on the board, tried, earned by credit. */
  exclude: (id: string) => boolean;
  /** Tried course id → what it fills IN THIS GROUP (empty: nothing here). */
  triedFills: Record<string, string[]>;
  actions: TryActions;
}) {
  const [query, setQuery] = useState("");
  const [capHit, setCapHit] = useState(false);
  /** Tried from this strip this visit, with what it was shown filling. */
  const [triedHere, setTriedHere] = useState<Record<string, string[]>>({});
  const { results } = useCourseSearch(query);

  // The scan runs in a deferred render, so opening the page paints at once
  // and each card's suggestions land right after; a Try click rescans in the
  // background too. `exclude` and `targets` must keep their identity while
  // unchanged (the page memoizes both), or the deferred render never settles.
  const ready = useDeferredValue(true, false);
  const deferredExclude = useDeferredValue(exclude);
  const suggestions = useMemo(
    () => (ready ? pickSuggestions(index, targets, { enrollmentTarget, exclude: deferredExclude }) : null),
    [ready, index, targets, enrollmentTarget, deferredExclude]
  );

  const tried = new Set(actions.triedIds);
  const lineFor = (id: string, fills: string[], fillsNothing?: boolean): Line => {
    const r = recordById(id);
    return {
      id,
      code: r ? `${r.subject} ${r.number}` : id.replace(/-/g, " "),
      title: r?.title ?? "",
      fills,
      record: r,
      fillsNothing,
    };
  };

  // Tried classes that fill something here (the engine's say, or tried from
  // this strip), in the order tried. What this strip showed them filling
  // names the category; the engine's say names the row.
  const trying: Line[] = actions.triedIds
    .filter((id) => (triedFills[id]?.length ?? 0) > 0 || id in triedHere)
    .map((id) => lineFor(id, triedHere[id]?.length ? triedHere[id] : (triedFills[id] ?? [])));
  const tryingIds = new Set(trying.map((l) => l.id));
  const suggested: Line[] = (suggestions ?? [])
    .filter((s) => !tryingIds.has(s.record.id))
    .slice(0, Math.max(2, 4 - trying.length))
    .map((s) => lineFor(s.record.id, s.fills));
  const searched: Line[] = query.trim()
    ? results.slice(0, 5).map((c) => {
        const fills = fillsOf(recordById(c.id), targets);
        return { ...lineFor(c.id, fills, fills.length === 0), code: `${c.subject} ${c.number}`, title: c.title };
      })
    : [];

  const toggle = (line: Line) => {
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

  const add = (line: Line) => {
    if (!line.record) return;
    actions.onAdd(recordToCourse(line.record));
  };

  const row = (line: Line) => {
    const on = tried.has(line.id);
    const offTerm =
      !!enrollmentTarget && !!line.record?.roster && line.record.roster !== enrollmentTarget && !!termLabel;
    return (
      <li
        key={line.id}
        data-try-course={line.id}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
      >
        <span className="min-w-0">
          <span className="t-body font-bold text-ink">{line.code}</span>{" "}
          <span className="t-body text-ink-2">{line.title}</span>
          <span className="block truncate t-meta text-ink-3">
            {line.fillsNothing
              ? "Doesn't fill anything still open here"
              : line.fills.length > 0
                ? `Fills ${line.fills.join(", ")}`
                : ""}
            {offTerm && <span className="text-ink-4"> · Not on the {termLabel} roster</span>}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={on}
            onClick={() => toggle(line)}
            disabled={!on && actions.atCap}
            className={cn(
              BTN,
              on
                ? "border-dashed border-drop bg-drop-tint text-drop-text"
                : "border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink"
            )}
          >
            {on ? "Trying ✓" : "Try"}
          </button>
          {line.record && (
            <button
              type="button"
              data-add-to-term
              onClick={() => add(line)}
              className={cn(BTN, "border-drop text-drop-text hover:bg-drop-tint")}
            >
              {actions.addLabel}
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div data-try-strip className="flex flex-col gap-1.5 border-t border-line pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="t-label">Try a class</p>
        {termLabel && <p className="t-meta text-ink-4">{termLabel} roster first</p>}
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try any class… e.g. MUSIC 1101"
          aria-label="Try any class"
          className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2.5 t-body outline-none placeholder:text-ink-4 focus:border-ink focus:ring-1 focus:ring-ink"
        />
      </label>
      {searched.length > 0 && <ul className="flex flex-col gap-1">{searched.map(row)}</ul>}
      {query.trim() && searched.length === 0 && <p className="t-meta text-ink-3">No class matches that.</p>}
      {!query.trim() && (
        <ul className="flex flex-col gap-1" aria-label="Suggested classes">
          {trying.map(row)}
          {suggested.map(row)}
          {suggestions === null && <li className="t-meta text-ink-4">Finding classes…</li>}
          {suggestions !== null && trying.length === 0 && suggested.length === 0 && (
            <li className="t-meta text-ink-4">No suggestions here. Search for any class above.</li>
          )}
        </ul>
      )}
      {(actions.atCap || capHit) && (
        <p data-try-cap className="t-meta font-semibold text-ink-2" role="status">
          {TRY_CAP_TEXT}
        </p>
      )}
      <p className="t-meta text-drop-text">
        Blue means "if you take it". Tried classes aren't on your board; the planner will remind you.
      </p>
    </div>
  );
}
