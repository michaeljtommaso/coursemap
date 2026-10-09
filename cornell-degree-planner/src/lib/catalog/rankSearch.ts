import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * rankSearch: the one in-memory course search over the already-loaded catalog
 * index. Pure: it never fetches. Shared by CatalogProvider.search (the planner
 * drawer), the filtered useCourseSearch path, and the /classes directory.
 *
 * Which records match is unchanged from the old substring search (id contains
 * the code-normalized query, or title contains the raw query), plus two
 * additions: compact codes ("CS3110"), and cross-listed alias codes
 * ("ENGRD 2110" finds CS 2110 via catalog/meta aliases).
 *
 * The ORDER is new (bug-sweep K2). Old results came back in index order
 * (subject A→Z), so "CS" opened on AEM courses and "CS 3" put BCS 3302 above
 * CS 3110. Tiers, best first:
 *   0  exact subject: subject === query subject (and number starts with the
 *      query number, if one was typed). Sorted by number.
 *   1  subject prefix: subject starts with the query subject ("MA" → MAE, MATH).
 *   2  title starts with the query, or a title word does.
 *   3  title contains the query anywhere.
 *   4  any other code substring hit ("CS-3" inside "BCS-3302").
 * Ties break by subject, then number (numeric-aware).
 */

/** A query that reads as a course code: "CS", "CS 31", "cs-3110", "CS3110", "3110". */
export type CodeQuery = { subject: string; number: string };

const CODE_RE = /^([A-Z]+)?[\s-]*(\d+[A-Z]?)?$/;

export function parseCodeQuery(query: string): CodeQuery | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const m = CODE_RE.exec(q);
  if (!m || (!m[1] && !m[2])) return null;
  return { subject: m[1] ?? "", number: m[2] ?? "" };
}

const TIER_SUBJECT_EXACT = 0;
const TIER_SUBJECT_PREFIX = 1;
const TIER_TITLE_PREFIX = 2;
const TIER_TITLE_CONTAINS = 3;
const TIER_CODE_SUBSTRING = 4;
const NO_MATCH = Infinity;

/** Tier for one subject/number pair against a parsed code query. */
function codeTier(subject: string, number: string, code: CodeQuery): number {
  const subj = subject.toUpperCase();
  const num = number.toUpperCase();
  if (code.number && !num.startsWith(code.number)) return NO_MATCH;
  if (!code.subject) return TIER_SUBJECT_EXACT; // bare number: "3110"
  if (subj === code.subject) return TIER_SUBJECT_EXACT;
  if (subj.startsWith(code.subject)) return TIER_SUBJECT_PREFIX;
  return NO_MATCH;
}

function titleTier(title: string, titleQ: string): number {
  const t = title.toLowerCase();
  const at = t.indexOf(titleQ);
  if (at === -1) return NO_MATCH;
  if (at === 0 || /[^a-z0-9]/.test(t[at - 1])) return TIER_TITLE_PREFIX;
  return TIER_TITLE_CONTAINS;
}

/** "ENGRD-2110" → { subject: "ENGRD", number: "2110" }. */
function splitId(id: string): { subject: string; number: string } {
  const dash = id.lastIndexOf("-");
  return dash === -1
    ? { subject: id, number: "" }
    : { subject: id.slice(0, dash), number: id.slice(dash + 1) };
}

// canonical id → alias ids, built once per aliases object.
const reverseAliasCache = new WeakMap<Record<string, string>, Map<string, string[]>>();

function aliasesByTarget(aliases: Record<string, string>): Map<string, string[]> {
  let rev = reverseAliasCache.get(aliases);
  if (!rev) {
    rev = new Map();
    for (const [alias, target] of Object.entries(aliases)) {
      const list = rev.get(target);
      if (list) list.push(alias);
      else rev.set(target, [alias]);
    }
    reverseAliasCache.set(aliases, rev);
  }
  return rev;
}

const compareCode = (a: CatalogIndexRecord, b: CatalogIndexRecord) =>
  a.subject.localeCompare(b.subject) ||
  a.number.localeCompare(b.number, undefined, { numeric: true });

export type RankSearchOptions = {
  /** Max results (default: all). */
  limit?: number;
  /** Cross-listing map from catalog/meta (ENGRD-2110 → CS-2110). */
  aliases?: Record<string, string>;
  /** Extra narrowing (the shared CourseFilters predicate). */
  filter?: (r: CatalogIndexRecord) => boolean;
};

type PreparedQuery = {
  raw: string;
  code: CodeQuery | null;
  idQ: string;
  compactQ: string;
  titleQ: string;
};

function prepareQuery(query: string): PreparedQuery {
  const raw = query.trim();
  const idQ = raw.toUpperCase().replace(/\s+/g, "-");
  return {
    raw,
    code: parseCodeQuery(raw),
    idQ,
    compactQ: idQ.replace(/-/g, ""),
    titleQ: raw.toLowerCase(),
  };
}

function scorePrepared(
  r: CatalogIndexRecord,
  pq: PreparedQuery,
  aliasIds: readonly string[]
): number {
  if (!pq.raw) return TIER_SUBJECT_EXACT;

  let best = NO_MATCH;
  if (pq.code) {
    best = codeTier(r.subject, r.number, pq.code);
    for (const alias of aliasIds) {
      const a = splitId(alias);
      best = Math.min(best, codeTier(a.subject, a.number, pq.code));
    }
  }
  if (best <= TIER_SUBJECT_PREFIX) return best;

  best = titleTier(r.title, pq.titleQ);
  if (best < NO_MATCH) return best;

  const id = r.id.toUpperCase();
  if (id.includes(pq.idQ) || id.replace(/-/g, "").includes(pq.compactQ)) {
    return TIER_CODE_SUBSTRING;
  }
  for (const alias of aliasIds) {
    if (alias.toUpperCase().includes(pq.idQ)) return TIER_CODE_SUBSTRING;
  }
  return NO_MATCH;
}

/** Score one record: lower is better, Infinity = no match. Exported for tests. */
export function scoreRecord(
  r: CatalogIndexRecord,
  query: string,
  aliasIds: readonly string[] = []
): number {
  return scorePrepared(r, prepareQuery(query), aliasIds);
}

export function rankSearch(
  records: readonly CatalogIndexRecord[],
  query: string,
  opts: RankSearchOptions = {}
): CatalogIndexRecord[] {
  const { limit = Infinity, aliases, filter } = opts;
  const rev = aliases ? aliasesByTarget(aliases) : null;
  const pq = prepareQuery(query);

  const scored: { r: CatalogIndexRecord; tier: number }[] = [];
  for (const r of records) {
    if (filter && !filter(r)) continue;
    const tier = scorePrepared(r, pq, rev?.get(r.id) ?? []);
    if (tier !== NO_MATCH) scored.push({ r, tier });
  }
  scored.sort((a, b) => a.tier - b.tier || compareCode(a.r, b.r));
  return (limit === Infinity ? scored : scored.slice(0, limit)).map((s) => s.r);
}
