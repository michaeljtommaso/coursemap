import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import type { MajorRef } from "@/lib/credit/limitScope";
import { CREDIT_CARD_KEY } from "./creditLines";
import { cardDomId } from "./pageModel";

/**
 * CreditTable (spec 045 D6) — "Credit before Cornell" as the first table group
 * on the Requirements page: Credit · Credits · Counts as, the total and how
 * much counts after the college's cap in the header with Edit, and the
 * college's limit sentence once (never under every exam). A credit with no
 * Cornell course reads "Elective credit · ask your major how it counts".
 * Replaces CreditCard.
 *
 * DOM: root id=cardDomId(CREDIT_CARD_KEY), [data-group-card=CREDIT_CARD_KEY]
 * (outline jumps and the in-view tracker read these), [data-credit-card];
 * each credit [data-credit-entry=<entry id>]; the cap line [data-credit-cap].
 *
 * CONTRACT STUB (spec 045 phase 0): props are final; lane B builds the body.
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

export function CreditTable(props: CreditTableProps) {
  return (
    <section
      id={cardDomId(CREDIT_CARD_KEY)}
      data-group-card={CREDIT_CARD_KEY}
      data-credit-card
      data-stub={props.resolved.length}
    />
  );
}
