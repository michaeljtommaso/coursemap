import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * unlockGhosts (spec 008 §3b, Unit 8C) — the pure ordering/filtering behind the
 * hover "unlocks" ghost cluster. Kept out of the component so the nearest-level
 * ordering, the placed-filter, and the hovered-self filter are table-testable.
 *
 * Given the hovered placed course's unlock ids (from buildUnlocksMap), produce
 * the ordered, filtered list of index records to render as ghost chips:
 *   - drop the hovered course itself and anything already placed on the plan,
 *   - drop ids with no index record (can't render a chip without its data),
 *   - order NEAREST course-level first relative to the hovered course
 *     (thousands-digit distance, then numeric, then id) — so CS 2110 surfaces
 *     3000-level unlocks before 4000-level (spec 008 §3b).
 * The component caps the VISIBLE set (default 6) and hides the rest behind a
 * "+N more" affordance — this helper returns the full ordered list.
 */

function levelOf(number: string): number {
  const n = parseInt(number, 10);
  return Number.isFinite(n) ? Math.floor(n / 1000) : 0;
}

function numericOf(number: string): number {
  const n = parseInt(number, 10);
  return Number.isFinite(n) ? n : 0;
}

export function selectUnlockGhosts(
  unlockIds: string[],
  hovered: { id: string; number: string },
  placedCourseIds: Set<string>,
  recordById: Map<string, CatalogIndexRecord>
): CatalogIndexRecord[] {
  const hoveredLevel = levelOf(hovered.number);
  const seen = new Set<string>();
  const records: CatalogIndexRecord[] = [];
  for (const id of unlockIds) {
    if (id === hovered.id || placedCourseIds.has(id) || seen.has(id)) continue;
    const rec = recordById.get(id);
    if (!rec) continue;
    seen.add(id);
    records.push(rec);
  }
  return records.sort((a, b) => {
    const da = Math.abs(levelOf(a.number) - hoveredLevel);
    const db = Math.abs(levelOf(b.number) - hoveredLevel);
    return da - db || numericOf(a.number) - numericOf(b.number) || a.id.localeCompare(b.id);
  });
}
