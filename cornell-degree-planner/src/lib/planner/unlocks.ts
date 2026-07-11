import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * unlocks.ts (spec 008 §3a, Unit 8A) — the app-side view over the sync-time-
 * computed forward "unlocks" reverse index. The heavy lifting (walking every
 * course's prereqExpr/coreqExpr tree, expanding pattern refs against the whole
 * catalog) happens ONCE at sync time in scripts/catalog-index.ts
 * (buildUnlocksIndex) and ships as plain `unlocks: string[]` on each
 * CatalogIndexRecord — CatalogProvider already loads these chunks, so this
 * module is a pure, memo-friendly reshape into a Map, never a second scan of
 * course docs (read-budget law).
 */

export type UnlocksMap = Map<string, string[]>;

/**
 * Build courseId -> unlocks[] from the loaded catalog index records. Pure —
 * call once per catalog-index load (e.g. useMemo keyed on `index`), not per
 * render.
 *
 * Cross-listing (spec 005 §2b's alias map, e.g. ENGRD-2110 <-> CS-2110):
 * a canonical course and its alias(es) are the SAME real-world course, so
 * their unlocks lists are merged into ONE entry rather than splitting a
 * course's forward reach across two keys. Decision: the merged Set is stored
 * under the CANONICAL id, and every alias id is then pointed at that SAME
 * array — so a lookup by either the canonical or the alias id (unlockCount,
 * a future hover handler) finds the merged entry with a single map access,
 * with no canonicalization needed at read time.
 */
export function buildUnlocksMap(
  records: CatalogIndexRecord[],
  aliases: Record<string, string> = {}
): UnlocksMap {
  const canonical = (id: string): string => aliases[id] ?? id;

  const grouped = new Map<string, Set<string>>();
  for (const r of records) {
    const key = canonical(r.id);
    let set = grouped.get(key);
    if (!set) {
      set = new Set();
      grouped.set(key, set);
    }
    for (const u of r.unlocks) set.add(canonical(u));
  }

  const out: UnlocksMap = new Map();
  for (const [canonicalId, set] of grouped) {
    out.set(canonicalId, [...set].sort((a, b) => a.localeCompare(b)));
  }
  // Point every alias id at its canonical entry's SAME array (see decision
  // above) so both id forms resolve identically.
  for (const [aliasId, canonicalId] of Object.entries(aliases)) {
    const arr = out.get(canonicalId);
    if (arr) out.set(aliasId, arr);
  }

  return out;
}

/** Number of OTHER courses `courseId` unlocks. 0 for an id absent from the map
 *  (never on the board, or a catalog-index chunk predating this field). */
export function unlockCount(map: UnlocksMap, courseId: string): number {
  return map.get(courseId)?.length ?? 0;
}
