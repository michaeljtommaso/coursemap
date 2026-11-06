import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import { CREDIT_CARD_KEY, creditEarns, creditTotal, formatCr } from "./creditLines";
import { cardDomId } from "./pageModel";

/**
 * CreditCard (spec 025 D7) — "Credit before Cornell", the first group on the
 * Requirements page: every credit (resolved for the student's college), its
 * courses and credits, what it filled here, and what it couldn't and why
 * (limits, notes, "No credit in <college>"). Edit opens the credits dialog.
 *
 * DOM: root [data-credit-card]; each credit [data-credit-entry=<entry id>].
 */

export function CreditCard({
  resolved,
  college,
  fills,
  onEdit,
}: {
  resolved: readonly ResolvedCredit[];
  college: CreditCollege;
  /** progress.creditFills: entry id → requirement labels. Absent while the
   *  engine doesn't report it. */
  fills?: Record<string, string[]>;
  onEdit: () => void;
}) {
  const total = creditTotal(resolved);
  return (
    <section
      id={cardDomId(CREDIT_CARD_KEY)}
      data-credit-card
      data-group-card={CREDIT_CARD_KEY}
      className="flex scroll-mt-4 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="t-body font-bold text-ink">Credit before Cornell</h2>
        <span className="flex items-baseline gap-2">
          {total > 0 && (
            <span className="t-meta font-semibold text-ink-3">
              <span className="num">{formatCr(total)}</span> cr
            </span>
          )}
          {resolved.length > 0 && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded px-1 py-0.5 t-meta font-semibold text-drop-text hover:bg-surface-2"
            >
              Edit
            </button>
          )}
        </span>
      </div>
      {resolved.length === 0 ? (
        <p className="t-meta text-ink-3">
          None yet ·{" "}
          <button
            type="button"
            onClick={onEdit}
            className="font-semibold text-drop-text underline-offset-2 hover:underline"
          >
            Add credit
          </button>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {resolved.map((c) => {
            const filled = fills?.[c.id];
            return (
              <li key={c.id} data-credit-entry={c.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="t-body font-semibold text-ink">{c.label}</span>
                  <span className={c.earnsNothing ? "t-meta text-ink-4" : "t-meta text-ink-3"}>
                    {creditEarns(c, college)}
                  </span>
                </span>
                {filled && filled.length > 0 && (
                  <span className="t-meta text-complete-text">Counts toward {filled.join(", ")}</span>
                )}
                {filled && filled.length === 0 && !c.earnsNothing && (
                  <span className="t-meta text-ink-3">Doesn't fill a requirement here; counts toward your credits</span>
                )}
                {!c.earnsNothing &&
                  c.limits.map((l) => (
                    <span key={l} data-credit-limit className="self-start rounded bg-surface-2 px-1.5 py-px t-meta text-ink-2">
                      {l}
                    </span>
                  ))}
                {c.note && <span className="t-meta text-ink-4">{c.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
