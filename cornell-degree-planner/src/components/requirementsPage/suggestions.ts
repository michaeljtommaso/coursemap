import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * suggestions (spec 028 D10) — the Try strip's "a few classes that would fill
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

/** The catalog split once per page (the index and the enrollment term are
 *  its only inputs): the enrollment term's roster, and every other course
 *  with a known offering. Every Try strip scans these, never the raw index. */
export type CandidateIndex = {
  onTerm: readonly CatalogIndexRecord[];
  otherTerms: readonly CatalogIndexRecord[];
};

export function buildCandidates(index: readonly CatalogIndexRecord[], enrollmentTarget: string | null): CandidateIndex {
  const term = enrollmentTarget;
  const onTerm: CatalogIndexRecord[] = [];
  const otherTerms: CatalogIndexRecord[] = [];
  for (const r of index) {
    if (term && r.roster === term) onTerm.push(r);
    // "Other terms": a course with any roster or offered term on record. With
    // no enrollment term at all, every course with a known offering.
    else if (!!r.roster || r.offered.length > 0) otherTerms.push(r);
  }
  return { onTerm, otherTerms };
}

function collect(
  records: readonly CatalogIndexRecord[],
  test: (r: CatalogIndexRecord) => boolean,
  exclude: (id: string) => boolean,
  label: string,
  limit: number
): CatalogIndexRecord[] {
  const out: CatalogIndexRecord[] = [];
  const n = records.length;
  const start = offsetFor(label, n);
  for (let i = 0; i < n && out.length < limit; i++) {
    const r = records[(start + i) % n];
    if (!exclude(r.id) && test(r)) out.push(r);
  }
  return out.sort((a, b) => level(a) - level(b));
}

/** A scan's result: each target's matches, and every matched course's
 *  target labels (in target order), so picking needs no further tests. */
export type TargetScan = {
  lists: CatalogIndexRecord[][];
  fillsById: Map<string, string[]>;
};

/**
 * The expensive half: each target's first matches over the candidates (the
 * enrollment term's roster first, else other terms), skipping `exclude`
 * (board and credit — never the tried classes, so a Try click doesn't
 * rescan). Memoize on (candidates, targets, exclude).
 */
export function scanTargets(
  candidates: CandidateIndex,
  targets: readonly FillTarget[],
  exclude: (id: string) => boolean
): TargetScan {
  const lists = targets.map((t) => {
    const first = candidates.onTerm.length > 0 ? collect(candidates.onTerm, t.test, exclude, t.label, PER_TARGET) : [];
    return first.length > 0 ? first : collect(candidates.otherTerms, t.test, exclude, t.label, PER_TARGET);
  });
  const fillsById = new Map<string, string[]>();
  for (const list of lists) {
    for (const r of list) {
      if (!fillsById.has(r.id)) fillsById.set(r.id, targets.filter((t) => t.test(r)).map((t) => t.label));
    }
  }
  return { lists, fillsById };
}

/**
 * The cheap half: round-robin across targets so the open things share the
 * slots, skipping `skip` (the classes already tried — listed by the strip
 * itself). A course matching several targets says so.
 */
export function pickFromScan(
  scan: TargetScan,
  targets: readonly FillTarget[],
  opts: { skip?: ReadonlySet<string>; limit?: number } = {}
): Suggestion[] {
  const limit = opts.limit ?? 4;
  const skip = opts.skip;
  const { lists, fillsById } = scan;
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
        if (skip?.has(r.id) || byId.has(r.id)) continue;
        const label = targets[t].label;
        const others = (fillsById.get(r.id) ?? []).filter((l) => l !== label);
        const s = { record: r, fills: [label, ...others] };
        byId.set(r.id, s);
        order.push(s);
        progressed = true;
        break;
      }
    }
  }
  return order;
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
  const scan = scanTargets(buildCandidates(index, opts.enrollmentTarget), targets, opts.exclude);
  return pickFromScan(scan, targets, { limit });
}

/** The targets of a search result: which of the group's open things it fills. */
export function fillsOf(record: CatalogIndexRecord | undefined, targets: readonly FillTarget[]): string[] {
  if (!record) return [];
  return targets.filter((t) => t.test(record)).map((t) => t.label);
}
