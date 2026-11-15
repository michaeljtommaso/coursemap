import { cn } from "@/lib/utils";
import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import type { MajorRef } from "@/lib/credit/limitScope";
import { collegeLimitsFor } from "@/lib/credit/resolve";
import { EXAM_TABLES } from "@/data/credit-tables";
import {
  CREDIT_CARD_KEY,
  creditCapText,
  creditCountsAs,
  creditCreditsText,
  creditHeaderText,
  creditName,
  creditRowNotes,
  creditRuleText,
  creditTotal,
  type CountsAs,
} from "./creditLines";
import { cardDomId } from "./pageModel";

/**
 * CreditTable (spec 045 D6) — "Credit before Cornell" as the first table group
 * on the Requirements page: Credit · Credits · Counts as, the total and how
 * much counts after the college's cap in the header with Edit, the
 * college's limit sentence once as a muted line (never under every exam), and
 * an amber line with the student's numbers when the cap bites. A credit with no
 * Cornell course reads "Elective credit · ask your major how it counts".
 * Replaces CreditCard.
 *
 * DOM: root id=cardDomId(CREDIT_CARD_KEY), [data-group-card=CREDIT_CARD_KEY]
 * (outline jumps and the in-view tracker read these), [data-credit-card];
 * each credit [data-credit-entry=<entry id>]; the college's sentence
 * [data-credit-rule]; the cap warning [data-credit-cap].
 */
export type CreditTableProps = {
  resolved: readonly ResolvedCredit[];
  college: CreditCollege;
  /** The chosen major: limit lines written for other majors are left out. */
  major?: MajorRef | null;
  /** progress.creditFills: entry id → requirement labels. */
  fills?: Record<string, string[]>;
  /** progress.creditCount: total credit and how much the college counts. */
  creditCount?: { counted: number; total: number };
  onEdit: () => void;
};

const COLS = "grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1.25fr)] gap-x-3";

const COUNTS_AS_TONE: Record<CountsAs["kind"], string> = {
  fills: "font-semibold text-complete-text",
  courses: "font-semibold text-complete-text",
  elective: "text-ink-2",
  none: "text-ink-4",
};

const BUTTON =
  "shrink-0 rounded-md border border-line-strong px-3 py-1 t-meta font-semibold text-ink transition-colors hover:bg-surface-2";

export function CreditTable({ resolved, college, major = null, fills, creditCount, onEdit }: CreditTableProps) {
  const collegeLimits = collegeLimitsFor(college, EXAM_TABLES);
  const header = creditHeaderText(resolved, college, creditCount);
  const rule = creditRuleText(collegeLimits, creditTotal(resolved) > 0 || (creditCount?.total ?? 0) > 0);
  const cap = creditCapText(collegeLimits, creditCount);
  const empty = resolved.length === 0;

  return (
    <section
      id={cardDomId(CREDIT_CARD_KEY)}
      data-group-card={CREDIT_CARD_KEY}
      data-credit-card
      className="scroll-mt-4 overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <h2 id="credit-table-title" className="flex-1 t-body font-bold text-ink">
          Credit before Cornell
        </h2>
        {header && <span className="num t-meta font-semibold text-ink-2">{header}</span>}
        {!empty && (
          <button type="button" onClick={onEdit} className={BUTTON}>
            Edit
          </button>
        )}
      </div>

      {rule && (
        <p data-credit-rule className="border-t border-line px-5 py-2.5 t-meta text-ink-3">
          {rule}
        </p>
      )}

      {cap && (
        <p data-credit-cap className="border-t border-line bg-available-tint px-5 py-2.5 t-meta text-available-text">
          {cap}
        </p>
      )}

      {empty ? (
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <p className="t-body text-ink-3">No credit added yet</p>
          <button type="button" onClick={onEdit} className={BUTTON}>
            Add
          </button>
        </div>
      ) : (
        <div role="table" aria-labelledby="credit-table-title" className="border-t border-line">
          <div role="row" className={cn(COLS, "bg-surface-2 px-5 py-2")}>
            <span role="columnheader" className="t-label">
              Credit
            </span>
            <span role="columnheader" className="t-label">
              Credits
            </span>
            <span role="columnheader" className="t-label">
              Counts as
            </span>
          </div>
          {resolved.map((c) => {
            const filled = fills?.[c.id];
            const countsAs = creditCountsAs(c, college, filled);
            const notes = creditRowNotes(c, major, filled, collegeLimits);
            return (
              <div
                key={c.id}
                role="row"
                data-credit-entry={c.id}
                className={cn(COLS, "items-baseline border-t border-line px-5 py-2.5")}
              >
                <span role="rowheader" className="min-w-0 t-body font-bold text-ink">
                  {creditName(c)}
                </span>
                <span role="cell" className="num t-body text-ink-2">
                  {creditCreditsText(c)}
                </span>
                <span role="cell" className="flex min-w-0 flex-col gap-0.5">
                  <span data-credit-counts-as={countsAs.kind} className={cn("t-meta", COUNTS_AS_TONE[countsAs.kind])}>
                    {countsAs.text}
                  </span>
                  {notes.limits.map((l) => (
                    <span key={l} data-credit-limit className="t-meta text-ink-3">
                      {l}
                    </span>
                  ))}
                  {notes.note && <span className="t-meta text-ink-4">{notes.note}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
