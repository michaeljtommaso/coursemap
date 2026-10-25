/**
 * waiverTranslation.ts (spec 019 D12) — carry a plan's saved waivers across a
 * move from the Engineering-format requirement files to college layers.
 *
 * Engineering-format waivers are keyed by requirement id; layer waivers are
 * keyed `${layerId}:${rowId}`. Information Science and Communication are the
 * only majors that make this move. This is wired in Phase 5, when their CALS
 * layers exist and the old-id → row map is authored alongside them.
 */

/** Old requirement id → `${layerId}:${rowId}`, or null when the requirement
 *  has no counterpart (the waiver is dropped). */
export type WaiverMap = Record<string, string | null>;

/**
 * Translate saved waiver ids through `map`. An id the map doesn't name is kept
 * as-is (already translated, or not part of the move); a null mapping drops
 * the waiver. The result keeps the input order with duplicates removed (two
 * old requirements can fold into one row).
 */
export function translateWaivers(waivedIds: string[], map: WaiverMap): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of waivedIds) {
    const next = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : id;
    if (next === null || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}
