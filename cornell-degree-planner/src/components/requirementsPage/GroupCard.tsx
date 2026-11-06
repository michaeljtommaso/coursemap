import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequirementItem, TriedProgress } from "@/hooks/useRequirementProgress";
import { ADVISOR_CARD_KEY, amountDone, cardDomId, formatAmount, groupAmount, type PageGroup } from "./pageModel";

/**
 * GroupCard (spec 028 D10) — one requirement group on the Requirements page:
 * its name and progress (with the tried classes' blue "+N", D11), every row,
 * then the Try strip when something here is still open.
 *
 * DOM: [data-group-card=<group key>], [data-requirement-group=<group key>].
 */
export function GroupCard({
  group,
  tried,
  renderRow,
  strip,
}: {
  group: PageGroup;
  tried?: TriedProgress;
  renderRow: (item: RequirementItem) => ReactNode;
  strip?: ReactNode;
}) {
  const a = groupAmount(group, tried);
  const done = amountDone(a);
  return (
    <section
      id={cardDomId(group.key)}
      data-group-card={group.key}
      data-requirement-group={group.key}
      className="flex scroll-mt-4 flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-body font-bold text-ink">{group.title}</h2>
        {a.need > 0 && (
          <span className="t-meta font-semibold text-ink-3">
            {done ? (
              <span className="text-complete-text">Done</span>
            ) : (
              <span className="num">{formatAmount(a)}</span>
            )}
            {a.plus > 0 && (
              <span data-group-tried className="text-drop-text">
                {" "}
                · <span className="num">+{a.plus}</span> if you take what you&apos;re trying
              </span>
            )}
          </span>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line">{group.items.map(renderRow)}</ul>
      {strip}
    </section>
  );
}

/**
 * AdvisorCard (spec 028 D8) — every "confirm with your advisor" row, last on
 * the page and collapsed by default. Nothing on the board or in the catalog
 * can answer these, so they are left out of every count.
 *
 * DOM: [data-advisor-card], [data-group-card="advisor"].
 */
export function AdvisorCard({
  items,
  renderRow,
}: {
  items: RequirementItem[];
  renderRow: (item: RequirementItem) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      id={cardDomId(ADVISOR_CARD_KEY)}
      data-advisor-card
      data-group-card={ADVISOR_CARD_KEY}
      className="flex scroll-mt-4 flex-col gap-1 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden />
        <h2 className="t-body font-bold text-ink">
          Check with your advisor (<span className="num">{items.length}</span>)
        </h2>
      </button>
      <p className="pl-5 t-meta text-ink-3">
        The app can&apos;t check these from your board. They don&apos;t count toward your progress here.
      </p>
      {open && <ul className="flex flex-col divide-y divide-line">{items.map(renderRow)}</ul>}
    </section>
  );
}
