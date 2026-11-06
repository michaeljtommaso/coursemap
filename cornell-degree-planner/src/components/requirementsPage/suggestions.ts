import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * suggestions (spec 025 D10) — the Try strip's "a few classes that would fill
 * something still open in this section". Pure.
 *
 * A target is one open thing a class could fill: an open row, or one missing
 * category of an open distribution row (so a suggestion can say "Historical").
 * Its `test` is the same predicate the Classes page's "Counts toward" filter
 * uses. Ranking is deliberately simple (spec DEFERRED): the enrollment term's
 * roster first, then other terms, lower-level courses first, one target at a
 * time so the open things share the slots.
 */

/** D12: shown at the tried-class cap (MAX_TRIED_COURSES). */
export const TRY_CAP_TEXT = "Up to 20 classes at a time";

export type FillTarget = {
  /** What it fills, as shown: "Historical", "First-Year Writing Seminars". */
  label: string;
  test: (r: CatalogIndexRecord) => boolean;
};

export type Suggestion = {
  record: CatalogIndexRecord;
  /** Labels of the targets it fills (most fill one). */
  fills: string[];
};

/** Matches collected per target before ranking (bounds the scan). */
const PER_TARGET = 16;

/** A stable start offset per target, so each target's list doesn't always
 *  begin at the alphabet's first subject. */
function offsetFor(label: string, n: number): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return n > 0 ? h % n : 0;
}

/** First digit of the course number: 1000-level before 4000-level. */
function level(r: CatalogIndexRecord): number {
  const d = parseInt(r.number[0] ?? "", 10);
  return Number.isNaN(d) ? 9 : d;
}

function collect(
  records: readonly CatalogIndexRecord[],
  test: (r: CatalogIndexRecord) => boolean,
  label: string,
  limit: number
): CatalogIndexRecord[] {
  const out: CatalogIndexRecord[] = [];
  const n = records.length;
  const start = offsetFor(label, n);
  for (let i = 0; i < n && out.length < limit; i++) {
    const r = records[(start + i) % n];
    if (test(r)) out.push(r);
  }
  return out.sort((a, b) => level(a) - level(b));
}

export function pickSuggestions(
  index: readonly CatalogIndexRecord[],
  targets: readonly FillTarget[],
  opts: {
    /** The enrollment term's roster slug ("SP27"), or null. */
    enrollmentTarget: string | null;
    /** Courses not to suggest (on the board, tried, earned by credit). */
    exclude: (id: string) => boolean;
    limit?: number;
  }
): Suggestion[] {
  const limit = opts.limit ?? 4;
  if (targets.length === 0 || index.length === 0 || limit <= 0) return [];
  const usable = index.filter((r) => !opts.exclude(r.id));
  const term = opts.enrollmentTarget;
  const onTerm = term ? usable.filter((r) => r.roster === term) : [];
  // "Other terms": a course with any roster or offered term on record. With
  // no enrollment term at all, every course with a known offering.
  const otherTerms = usable.filter((r) => (term ? r.roster !== term : true) && (!!r.roster || r.offered.length > 0));

  const lists = targets.map((t) => {
    const first = onTerm.length > 0 ? collect(onTerm, t.test, t.label, PER_TARGET) : [];
    return first.length > 0 ? first : collect(otherTerms, t.test, t.label, PER_TARGET);
  });

  // Round-robin across targets; a course matching several targets says so.
  const byId = new Map<string, Suggestion>();
  const order: Suggestion[] = [];
  const cursor = lists.map(() => 0);
  let progressed = true;
  while (order.length < limit && progressed) {
    progressed = false;
    for (let t = 0; t < lists.length && order.length < limit; t++) {
      const list = lists[t];
      while (cursor[t] < list.length) {
        const r = list[cursor[t]++];
        const seen = byId.get(r.id);
        if (seen) {
          if (!seen.fills.includes(targets[t].label)) seen.fills.push(targets[t].label);
          continue;
        }
        const s = { record: r, fills: [targets[t].label] };
        byId.set(r.id, s);
        order.push(s);
        progressed = true;
        break;
      }
    }
  }
  // Credit a picked course for every target it also fills.
  for (const s of order) {
    for (const t of targets) if (!s.fills.includes(t.label) && t.test(s.record)) s.fills.push(t.label);
  }
  return order;
}

/** The targets of a search result: which of the group's open things it fills. */
export function fillsOf(record: CatalogIndexRecord | undefined, targets: readonly FillTarget[]): string[] {
  if (!record) return [];
  return targets.filter((t) => t.test(record)).map((t) => t.label);
}
