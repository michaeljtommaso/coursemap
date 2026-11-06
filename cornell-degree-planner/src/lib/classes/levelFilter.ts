/**
 * levelFilter.ts — the multi-select level pills (1000, 2000, …) on /classes
 * and in the catalog drawer. Pure, and kept out of useCourseFilters so the
 * filter components import no Firebase-backed module.
 */

/** Toggle one level in or out of the selection; sorted, and an empty
 *  selection clears the axis (undefined) so "no filters" stays detectable. */
export function toggleLevel(levels: readonly number[] | undefined, level: number): number[] | undefined {
  const cur = levels ?? [];
  const next = cur.includes(level) ? cur.filter((l) => l !== level) : [...cur, level].sort((a, b) => a - b);
  return next.length > 0 ? next : undefined;
}
