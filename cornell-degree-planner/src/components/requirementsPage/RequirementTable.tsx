import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RequirementItem, TriedProgress } from "@/hooks/useRequirementProgress";
import {
  ADVISOR_CARD_KEY,
  amountDone,
  cardDomId,
  countedNames,
  countingText,
  foldGroup,
  foldLineText,
  formatAmount,
  groupAmount,
  rowProgress,
  type RowProgress,
} from "./pageModel";

/**
 * RequirementTable (spec 045 D1/D2/D11) — one requirement group as a compact
 * table: the title, a thin progress bar and "4 of 11" (with the tried
 * classes' blue "+N"), then one line per requirement — status dot ·
 * requirement · progress · what counts. Clicking a row selects it and opens
 * the side panel (RequirementPanel) with everything else.
 *
 * Finished and waived rows fold into one green line at the end ("✓ 4
 * finished · NS 1150, BIOG 1440 · 1 waived · Show"); Show lists them in place,
 * greyed. A group with nothing open shrinks to its header ("✓ All finished ·
 * Show"). Rows the app can't check never fold, and the selected row stays in
 * the table while selected.
 *
 * The advisor variant ("Check with your advisor (N)") is collapsed by
 * default, has no count and never folds.
 *
 * DOM: root id=cardDomId(key), [data-group-card=<key>] (outline jumps and the
 * in-view tracker), [data-requirement-group=<key>] (advisor: [data-advisor-card]
 * instead). Each row keeps the rail's contract — <li data-requirement=<id>
 * data-status data-engine-status data-checkable> — with the select button
 * [data-row-select] inside; [data-note-marker]; [data-row-tried] (+N); the
 * fold line [data-fold-line] and its toggle [data-fold-toggle].
 */

const DOT: Record<RequirementItem["status"], string> = {
  unmet: "border-[1.5px] border-ink-4 bg-transparent",
  partial: "border-[1.5px] border-drop bg-drop-tint",
  satisfied: "bg-complete",
  waived: "bg-waived",
};

const TONE: Record<RowProgress["tone"], string> = {
  done: "text-complete-text",
  waived: "text-waived-text",
  muted: "font-medium text-ink-4",
  plain: "text-ink-2",
};

/** Four columns shared by every line of the table (each line is a subgrid). */
const GRID = "grid grid-cols-[0.75rem_minmax(0,3fr)_max-content_minmax(0,2fr)] gap-x-3";
const LINE = "col-span-full grid grid-cols-subgrid";
/** The advisor group's rows container (its toggle's aria-controls). */
const ADVISOR_ROWS_ID = "advisor-rows";

export type TableGroup = { key: string; title: string; items: RequirementItem[] };

export function RequirementTable({
  group,
  variant = "group",
  tried,
  codeOfPlacement,
  selectedId,
  panelId,
  onSelect,
}: {
  group: TableGroup;
  /** "advisor": the collapsed "Check with your advisor (N)" group. */
  variant?: "group" | "advisor";
  tried?: TriedProgress;
  /** placement id → "CS 2110". */
  codeOfPlacement: (placementId: string) => string;
  selectedId: string | null;
  /** The side panel's id (each row's aria-controls). */
  panelId: string;
  onSelect: (item: RequirementItem) => void;
}) {
  const advisor = variant === "advisor";
  const [expanded, setExpanded] = useState(false);
  const namesOf = (it: RequirementItem) => countedNames(it, [...new Set(it.coveredBy.map(codeOfPlacement))]);

  const fold = advisor ? null : foldGroup(group.items, selectedId);
  const folded = new Set([...(fold?.finished ?? []), ...(fold?.waived ?? [])].map((it) => it.id));
  const rows = advisor ? (expanded ? group.items : []) : expanded ? group.items : fold!.shown;
  const foldText = fold ? foldLineText(fold, namesOf) : "";
  const allFinished = !!fold?.allFinished;

  const row = (it: RequirementItem) => {
    const selected = it.id === selectedId;
    const triedRow = advisor ? undefined : tried?.items[it.id];
    const p = rowProgress(it, triedRow);
    const counting = countingText(it, namesOf(it));
    const greyed = folded.has(it.id);
    const note = it.dist?.note;
    return (
      <li
        key={it.id}
        data-requirement={it.id}
        data-status={it.status}
        data-checkable={it.checkable ? undefined : "false"}
        data-engine-status={it.dist?.engineStatus}
        className={cn(LINE, "border-t border-line")}
      >
        <button
          type="button"
          data-row-select
          aria-controls={panelId}
          aria-expanded={selected}
          onClick={() => onSelect(it)}
          className={cn(
            LINE,
            "items-center px-5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-drop",
            selected ? "bg-drop-tint shadow-[inset_3px_0_0_var(--drop)]" : "hover:bg-surface-2"
          )}
        >
          <span className={cn("h-2.5 w-2.5 justify-self-center rounded-full", DOT[it.status])} aria-hidden />
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Wraps rather than truncates: the codes at the end of a label
                tell similar rows apart. */}
            <span className={cn("min-w-0 break-words t-body", greyed ? "font-medium text-ink-3" : "font-semibold text-ink")}>
              {it.label}
            </span>
            {note && (
              <Tooltip content="Has a note">
                <span
                  data-note-marker
                  role="img"
                  aria-label="Has a note"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-available t-meta font-bold leading-none text-available-text"
                >
                  i
                </span>
              </Tooltip>
            )}
          </span>
          <span className={cn("num whitespace-nowrap t-meta font-semibold", greyed ? "text-ink-4" : TONE[p.tone])}>
            {p.text}
            {p.plus > 0 && (
              <span data-row-tried className="text-drop-text">
                {" "}
                +{p.plus}
                <span className="sr-only"> if you take what you&apos;re trying</span>
              </span>
            )}
          </span>
          <Tooltip content={counting === "—" ? undefined : counting} truncatedOnly>
            <span
              className={cn(
                "truncate t-meta",
                counting === "—" ? "text-ink-4" : greyed ? "font-semibold text-ink-3" : "font-semibold text-complete-text"
              )}
            >
              {counting}
            </span>
          </Tooltip>
        </button>
      </li>
    );
  };

  if (advisor) {
    return (
      <section
        id={cardDomId(ADVISOR_CARD_KEY)}
        data-advisor-card
        data-group-card={ADVISOR_CARD_KEY}
        className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-dashed border-line-strong bg-surface"
      >
        <h2 className="px-5 pt-3 t-headline font-bold">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={ADVISOR_ROWS_ID}
            className="flex items-center gap-1.5 text-left"
          >
            <ChevronRight
              className={cn("h-4 w-4 shrink-0 text-ink-3 transition-transform", expanded && "rotate-90")}
              aria-hidden
            />
            <span>
              Check with your advisor (<span className="num">{group.items.length}</span>)
            </span>
          </button>
        </h2>
        <p className="pb-3 pl-[2.625rem] pr-5 t-meta text-ink-3">
          The app can&apos;t check these from your board. They don&apos;t count toward your progress here.
        </p>
        <div id={ADVISOR_ROWS_ID}>{rows.length > 0 && <ul className={GRID}>{rows.map(row)}</ul>}</div>
      </section>
    );
  }

  const a = groupAmount(group, tried);
  const done = amountDone(a);
  const pct = a.need > 0 ? Math.min(100, Math.round((a.have / a.need) * 100)) : 0;
  const toggle = (
    <button
      type="button"
      data-fold-toggle
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      className="whitespace-nowrap rounded px-1 t-meta font-semibold text-complete-text underline-offset-2 hover:underline"
    >
      ✓ All finished · {expanded ? "Hide" : "Show"}
    </button>
  );

  return (
    <section
      id={cardDomId(group.key)}
      data-group-card={group.key}
      data-requirement-group={group.key}
      className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex items-center gap-4 px-5 py-3">
        <h2 className="min-w-0 flex-1 truncate t-headline font-bold">{group.title}</h2>
        {allFinished ? (
          toggle
        ) : (
          a.need > 0 && (
            <>
              <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="block h-full rounded-full bg-complete" style={{ width: `${pct}%` }} />
              </span>
              <span className="whitespace-nowrap t-meta font-semibold text-ink-3">
                {done ? <span className="text-complete-text">Done</span> : <span className="num">{formatAmount(a)}</span>}
                {a.plus > 0 && (
                  <span data-group-tried className="text-drop-text">
                    {" "}
                    <span className="num">+{a.plus}</span>
                    <span className="sr-only"> if you take what you&apos;re trying</span>
                  </span>
                )}
              </span>
            </>
          )
        )}
      </div>
      {rows.length > 0 && (
        <ul className={GRID}>
          <li aria-hidden className={cn(LINE, "border-t border-line bg-surface-2 px-5 py-1.5 t-label text-ink-4")}>
            <span />
            <span>Requirement</span>
            <span>Progress</span>
            <span>Counting</span>
          </li>
          {rows.map(row)}
        </ul>
      )}
      {!allFinished && foldText && (
        <button
          type="button"
          data-fold-line
          data-fold-toggle
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-3 border-t border-line bg-complete-tint px-5 py-2.5 text-left text-complete-text"
        >
          <span
            aria-hidden
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-complete t-meta font-bold leading-none text-surface"
          >
            ✓
          </span>
          <Tooltip content={foldText} truncatedOnly>
            <span className="min-w-0 flex-1 truncate t-meta font-semibold">{foldText}</span>
          </Tooltip>
          <span className="t-meta font-semibold">{expanded ? "Hide" : "Show"}</span>
        </button>
      )}
    </section>
  );
}
