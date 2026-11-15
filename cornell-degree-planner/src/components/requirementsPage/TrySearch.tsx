import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import type { CatalogIndexRecord } from "@/lib/schemas";
import { Tooltip } from "@/components/ui/Tooltip";
import { TRY_CAP_TEXT, fillsOf, type FillTarget, type GroupTargets } from "./suggestions";
import { TryCourseRow, tryLineFor, useTryToggle, type TryActions, type TryLine } from "./tryCourse";

/**
 * TrySearch (spec 045 D10) — the Requirements page header's "Try a class…"
 * search: a result names everything the class would fill on the page, with
 * Try and + <enrollment term>; the classes being tried sit beside it as
 * chips (× untries, Clear empties). Replaces the per-group Try strips' search
 * and the TriedLine.
 *
 * Results open in a dropdown under the input: Esc or a click outside closes
 * it, ↓/↑ move between the results' first buttons (Tab works too).
 *
 * DOM: root [data-try-search]; each result [data-try-course=<id>]; the chip
 * list [data-tried-line], each tried chip [data-tried-chip=<id>], Clear
 * [data-tried-clear-all]; each no-longer-offered line [data-tried-missing=<id>];
 * the cap text [data-try-cap].
 */
export type TrySearchProps = {
  /** Every group's open fill targets, labelled with its group (the page's). */
  groupTargets: readonly GroupTargets[];
  recordById: (id: string) => CatalogIndexRecord | undefined;
  enrollmentTarget: string | null;
  /** "Spring 2027", or null. */
  termLabel: string | null;
  /** On the board (canonical ids): a result says "On your board". */
  isOnBoard: (id: string) => boolean;
  actions: TryActions;
  /** Course id → "ANSC 3800" for the tried chips. */
  codeOf: (id: string) => string;
  onClearTried: () => void;
  /** Tried course ids no longer offered: "<code> is no longer offered · Remove". */
  missingTried: readonly string[];
  /** 1024–1279px: an icon button that expands into the search in place. */
  compact?: boolean;
};

const RESULT_LIMIT = 5;
const NOTHING_OPEN = "Doesn't fill anything still open here";

/** Every open thing on the page as one list. A label two groups share (the
 *  same category in two layers) is told apart by its group's title. */
function pageTargets(groups: readonly GroupTargets[]): FillTarget[] {
  const groupsByLabel = new Map<string, Set<string>>();
  for (const g of groups) {
    for (const t of g.targets) {
      const keys = groupsByLabel.get(t.label) ?? new Set<string>();
      keys.add(g.key);
      groupsByLabel.set(t.label, keys);
    }
  }
  return groups.flatMap((g) =>
    g.targets.map((t) => ({
      label: (groupsByLabel.get(t.label)?.size ?? 0) > 1 ? `${t.label} (${g.title})` : t.label,
      test: t.test,
    }))
  );
}

/** "Fills: One ethics course, Historical analysis", each label once. */
function fillsText(fills: readonly string[]): string {
  return fills.length > 0 ? `Fills: ${fills.join(", ")}` : NOTHING_OPEN;
}

export function TrySearch({
  groupTargets,
  recordById,
  enrollmentTarget,
  termLabel,
  isOnBoard,
  actions,
  codeOf,
  onClearTried,
  missingTried,
  compact = false,
}: TrySearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { results } = useCourseSearch(query);
  const { tried, toggle, capHit } = useTryToggle(actions);

  const targets = useMemo(() => pageTargets(groupTargets), [groupTargets]);
  const showInput = !compact || expanded;
  const hasQuery = query.trim().length > 0;
  const dropdown = open && hasQuery && showInput;

  const lines: TryLine[] = hasQuery
    ? results.slice(0, RESULT_LIMIT).map((c) => {
        const onBoard = isOnBoard(c.id);
        const fills = onBoard ? [] : [...new Set(fillsOf(recordById(c.id), targets))];
        return {
          ...tryLineFor(c.id, fills, recordById, onBoard ? undefined : fillsText(fills)),
          code: `${c.subject} ${c.number}`,
          title: c.title,
          onBoard,
        };
      })
    : [];

  const collapse = () => {
    setOpen(false);
    if (compact && !query.trim()) {
      setExpanded(false);
      return true;
    }
    return false;
  };

  // A click outside closes the dropdown (and folds an empty compact search).
  useEffect(() => {
    if (!open && !expanded) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (compact && !inputRef.current?.value.trim()) setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, expanded, compact]);

  // The compact search takes focus as it expands.
  useEffect(() => {
    if (compact && expanded) inputRef.current?.focus();
  }, [compact, expanded]);

  /** Each result's first button (Try, or nothing on the board). */
  const resultButtons = () =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-try-course]") ?? [])]
      .map((li) => li.querySelector<HTMLElement>("button"))
      .filter((b): b is HTMLElement => !!b);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (dropdown) {
        e.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      } else if (compact && expanded) {
        e.preventDefault();
        if (collapse()) toggleRef.current?.focus();
      }
      return;
    }
    if (!dropdown || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const buttons = resultButtons();
    if (buttons.length === 0) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") buttons[at < 0 ? 0 : Math.min(at + 1, buttons.length - 1)].focus();
    else if (at <= 0) inputRef.current?.focus();
    else buttons[at - 1].focus();
  };

  const capShown = actions.atCap || capHit;
  const triedIds = actions.triedIds;

  return (
    <div ref={rootRef} data-try-search onKeyDown={onKeyDown} className="relative flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {compact && !expanded ? (
          <Tooltip content="Try a class">
            <button
              ref={toggleRef}
              type="button"
              aria-label="Try a class"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="rounded-md border border-line bg-surface p-1.5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        ) : (
          <label className="relative block w-60 shrink-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Try a class…"
              aria-label="Try a class"
              aria-expanded={dropdown}
              aria-controls={dropdown ? "try-search-results" : undefined}
              className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2.5 t-body outline-none placeholder:text-ink-4 focus:border-ink focus:ring-1 focus:ring-ink"
            />
          </label>
        )}
        {triedIds.length > 0 && (
          <ul data-tried-line aria-label="Classes you're trying" className="flex flex-wrap items-center gap-1">
            {triedIds.map((id) => {
              const code = codeOf(id);
              return (
                <li
                  key={id}
                  data-tried-chip={id}
                  className="inline-flex items-center gap-0.5 rounded border border-dashed border-drop bg-drop-tint py-0.5 pl-1.5 pr-0.5 t-meta font-semibold text-drop-text"
                >
                  {code}
                  <button
                    type="button"
                    aria-label={`Stop trying ${code}`}
                    onClick={() => actions.onUntry(id)}
                    className="rounded p-0.5 text-drop-text hover:bg-surface"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              );
            })}
            {triedIds.length >= 2 && (
              <li>
                <button
                  type="button"
                  data-tried-clear-all
                  onClick={onClearTried}
                  className="rounded px-1 t-meta text-ink-3 underline underline-offset-2 hover:text-ink"
                >
                  Clear
                </button>
              </li>
            )}
          </ul>
        )}
        {capShown && (
          <p data-try-cap role="status" className="t-meta font-semibold text-ink-2">
            {TRY_CAP_TEXT}
          </p>
        )}
      </div>

      {missingTried.map((id) => {
        const code = codeOf(id);
        return (
          <p key={id} data-tried-missing={id} className="t-meta text-drop-text">
            <span className="font-semibold">{code}</span> is no longer offered ·{" "}
            <button
              type="button"
              onClick={() => actions.onUntry(id)}
              className="font-semibold underline underline-offset-2"
            >
              Remove
            </button>
          </p>
        );
      })}

      {dropdown && (
        <div
          id="try-search-results"
          data-try-results
          className={cn(
            "absolute top-full z-10 mt-1.5 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-lg border border-line bg-surface p-2 shadow-[var(--shadow-xl)]",
            // Compact sits at the header's right end: open leftward so the
            // list stays inside a narrow window.
            compact ? "right-0" : "left-0"
          )}
        >
          {lines.length > 0 ? (
            <ul ref={listRef} aria-label="Classes to try" className="flex flex-col gap-1">
              {lines.map((line) => (
                <TryCourseRow
                  key={line.id}
                  line={line}
                  tried={tried.has(line.id)}
                  actions={actions}
                  onToggle={toggle}
                  enrollmentTarget={enrollmentTarget}
                  termLabel={termLabel}
                />
              ))}
            </ul>
          ) : (
            <p className="px-1 t-meta text-ink-3">No class matches that.</p>
          )}
          <p className="px-1 t-meta text-drop-text">
            Blue means &quot;if you take it&quot;. Tried classes aren&apos;t on your board.
          </p>
        </div>
      )}
    </div>
  );
}
