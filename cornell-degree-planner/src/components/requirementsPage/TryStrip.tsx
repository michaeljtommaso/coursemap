import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import type { CatalogIndexRecord } from "@/lib/schemas";
import {
  TRY_CAP_TEXT,
  pickFromScan,
  scanTargets,
  searchHint,
  searchHintText,
  type CandidateIndex,
  type FillTarget,
} from "./suggestions";
import { TryCourseRow, tryLineFor, useTryToggle, type TryActions, type TryLine } from "./tryCourse";

export type { TryActions } from "./tryCourse";

/**
 * TryStrip (spec 028 D10/D11) — the end of a group card with open rows: try
 * any class against this group, or one of a few suggested classes that would
 * fill something still open here (enrollment term's roster first). Each class
 * has **Try** / **Trying ✓** (tryCourse / untryCourse: counted "as if you took
 * it", in blue) and **+ <enrollment term>** (straight onto the board).
 *
 * Classes being tried that fill this group stay listed first, so the toggle a
 * student just pressed doesn't move out from under them. A search result
 * already on the board says "On your board" and offers neither button. A
 * search result that fills nothing in this card names what it fills in the
 * page's other cards, since a tried class counts wherever it fits.
 *
 * Cost: the catalog scan (scanTargets) runs over the page's candidate index
 * and keys on board + credit only; tried classes are skipped while picking,
 * so a Try click never rescans.
 *
 * DOM: root [data-try-strip]; each class [data-try-course=<id>].
 */

export function TryStrip({
  targets,
  elsewhere,
  candidates,
  recordById,
  enrollmentTarget,
  termLabel,
  exclude,
  isOnBoard,
  triedFills,
  actions,
}: {
  targets: readonly FillTarget[];
  /** The page's other cards' open things, labelled with their card
   *  (elsewhereTargets): a search result's hint when nothing here fits. */
  elsewhere: readonly FillTarget[];
  /** The page's catalog split (buildCandidates), built once per page. */
  candidates: CandidateIndex;
  recordById: (id: string) => CatalogIndexRecord | undefined;
  enrollmentTarget: string | null;
  /** "Spring 2027" (the roster the suggestions prefer), or null. */
  termLabel: string | null;
  /** Courses never suggested: on the board or earned by credit (not the
   *  tried ones: those are skipped after the scan). */
  exclude: (id: string) => boolean;
  /** On the board (canonical ids): search results say so. */
  isOnBoard: (id: string) => boolean;
  /** Tried course id → what it fills IN THIS GROUP (empty: nothing here). */
  triedFills: Record<string, string[]>;
  actions: TryActions;
}) {
  const [query, setQuery] = useState("");
  const { results } = useCourseSearch(query);

  // The scan runs in a deferred render, so opening the page paints at once
  // and each card's suggestions land right after. `exclude`, `targets` and
  // `candidates` must keep their identity while unchanged (the page memoizes
  // them), or the deferred render never settles. Tried ids are not part of
  // the scan's key: a Try click only re-picks from the scan.
  const ready = useDeferredValue(true, false);
  const deferredExclude = useDeferredValue(exclude);
  const scan = useMemo(
    () => (ready ? scanTargets(candidates, targets, deferredExclude) : null),
    [ready, candidates, targets, deferredExclude]
  );
  const triedKey = actions.triedIds;
  const suggestions = useMemo(
    () => (scan ? pickFromScan(scan, targets, { skip: new Set(triedKey) }) : null),
    [scan, targets, triedKey]
  );

  /** Tried from this strip this visit, with what it was shown filling (useTryToggle). */
  const { tried, toggle, capHit, triedHere } = useTryToggle(actions);
  const lineFor = (id: string, fills: string[], hint?: string): TryLine => tryLineFor(id, fills, recordById, hint);

  // Tried classes that fill something here (the engine's say, or tried from
  // this strip), in the order tried. What this strip showed them filling
  // names the category; the engine's say names the row.
  const trying: TryLine[] = actions.triedIds
    .filter((id) => (triedFills[id]?.length ?? 0) > 0 || id in triedHere)
    .map((id) => lineFor(id, triedHere[id]?.length ? triedHere[id] : (triedFills[id] ?? [])));
  const tryingIds = new Set(trying.map((l) => l.id));
  const suggested: TryLine[] = (suggestions ?? [])
    .filter((s) => !tryingIds.has(s.record.id))
    .slice(0, Math.max(2, 4 - trying.length))
    .map((s) => lineFor(s.record.id, s.fills));
  const searched: TryLine[] = query.trim()
    ? results.slice(0, 5).map((c) => {
        const onBoard = isOnBoard(c.id);
        const h = onBoard ? null : searchHint(recordById(c.id), targets, elsewhere);
        return {
          ...lineFor(c.id, h?.fills ?? [], h ? searchHintText(h) : undefined),
          code: `${c.subject} ${c.number}`,
          title: c.title,
          onBoard,
        };
      })
    : [];

  const row = (line: TryLine) => (
    <TryCourseRow
      key={line.id}
      line={line}
      tried={tried.has(line.id)}
      actions={actions}
      onToggle={toggle}
      enrollmentTarget={enrollmentTarget}
      termLabel={termLabel}
    />
  );

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
