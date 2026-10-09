import type { Placement } from "@/types/plan";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * placementOps (spec 014 §D4/§D5/§D6) — the PURE edit operations on a plan's
 * Placement[]. No React, no Firestore: PlanProvider applies these and persists
 * the result; the drag engine and the "Move to…" menu call the same functions
 * (through the provider), so every path to an edit shares one set of rules.
 *
 * Invariants every export maintains on its OUTPUT:
 *   - `sem` is clamped to 1..10;
 *   - `order` is DENSE per semester (0..n-1, no gaps, no duplicates);
 *   - ordering is STABLE: ties (equal `order`, e.g. from a corrupt doc) keep
 *     their input order;
 *   - the array is sorted by (sem, order), so equal inputs give equal outputs.
 * Inputs are never mutated.
 */

/** Plan-wide placement cap — keep in sync with schemas.ts PlanSchema.placements
 *  and firestore.rules (placements.size() <= 80). */
export const MAX_PLACEMENTS = 80;
export const MIN_SEM = 1;
export const MAX_SEM = 10;

/** Clamp a semester into the board's 1..10 range (non-finite → 1). */
export function clampSem(sem: number): number {
  if (!Number.isFinite(sem)) return MIN_SEM;
  return Math.min(MAX_SEM, Math.max(MIN_SEM, Math.round(sem)));
}

function orderKey(order: number): number {
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

/** Re-establish the invariants: clamp sems, sort by (sem, order, input index),
 *  renumber `order` densely per semester. Unchanged placements keep their
 *  object identity. */
export function normalizePlacementOrder(placements: Placement[]): Placement[] {
  const indexed = placements.map((p, i) => {
    const sem = clampSem(p.sem);
    return { p: sem === p.sem ? p : { ...p, sem }, i };
  });
  indexed.sort(
    (a, b) => a.p.sem - b.p.sem || orderKey(a.p.order) - orderKey(b.p.order) || a.i - b.i
  );
  const out: Placement[] = [];
  let curSem = Number.NaN;
  let n = 0;
  for (const { p } of indexed) {
    if (p.sem !== curSem) {
      curSem = p.sem;
      n = 0;
    }
    out.push(p.order === n ? p : { ...p, order: n });
    n++;
  }
  return out;
}

/** The placements in one semester column, top to bottom. */
export function columnPlacements(placements: Placement[], sem: number): Placement[] {
  return placements
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.sem === sem)
    .sort((a, b) => orderKey(a.p.order) - orderKey(b.p.order) || a.i - b.i)
    .map(({ p }) => p);
}

/** Do two placement lists describe the same board (same ids at the same
 *  sem/order, same courses)? Order-insensitive in the array sense. */
export function sameBoard(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((p) => [p.id, p]));
  for (const p of b) {
    const q = byId.get(p.id);
    if (!q || q.sem !== p.sem || q.order !== p.order || q.courseId !== p.courseId) return false;
  }
  return true;
}

/** Splice `card` into `sem`'s column at `index` (undefined or past the end =
 *  append; negative = top), then renumber. `card` must not already be in the
 *  list. */
function spliceInto(
  placements: Placement[],
  card: { id: string; courseId: string },
  sem: number,
  index?: number
): Placement[] {
  const s = clampSem(sem);
  const base = normalizePlacementOrder(placements);
  const col = columnPlacements(base, s);
  const at =
    index === undefined || !Number.isFinite(index)
      ? col.length
      : Math.min(col.length, Math.max(0, Math.trunc(index)));
  const nextCol: Placement[] = [
    ...col.slice(0, at),
    { id: card.id, courseId: card.courseId, sem: s, order: at },
    ...col.slice(at),
  ].map((p, i) => (p.order === i ? p : { ...p, order: i }));
  return normalizePlacementOrder([...base.filter((p) => p.sem !== s), ...nextCol]);
}

/**
 * Insert a NEW placement into `sem` at `index` (omitted = append to the
 * bottom). Returns the input unchanged when the id already exists or the plan
 * is at MAX_PLACEMENTS — the caller decides how to tell the user (spec 014
 * States: "refused with a toast; never silent").
 */
export function insertPlacement(
  placements: Placement[],
  card: { id: string; courseId: string },
  sem: number,
  index?: number
): Placement[] {
  if (placements.some((p) => p.id === card.id)) return placements;
  if (placements.length >= MAX_PLACEMENTS) return placements;
  return spliceInto(placements, card, sem, index);
}

/**
 * Move placement `id` to `sem` at `index`, where `index` is the position in
 * the TARGET column AFTER the mover has been taken out (0 = top; past the end
 * = append). Works within one column (up or down) and across columns. Returns
 * the SAME array reference when the id is unknown or the move changes nothing,
 * so callers can skip a write.
 */
export function movePlacementTo(
  placements: Placement[],
  id: string,
  sem: number,
  index: number
): Placement[] {
  const mover = placements.find((p) => p.id === id);
  if (!mover) return placements;
  const without = placements.filter((p) => p.id !== id);
  const next = spliceInto(without, mover, sem, index);
  return sameBoard(normalizePlacementOrder(placements), next) ? placements : next;
}

/** Remove placement `id`, closing the gap in its column. Same reference back
 *  when the id is unknown. */
export function removePlacementById(placements: Placement[], id: string): Placement[] {
  if (!placements.some((p) => p.id === id)) return placements;
  return normalizePlacementOrder(placements.filter((p) => p.id !== id));
}

/** Where a card sits: its column and 0-based index within it, or null. */
export function positionOf(
  placements: Placement[],
  id: string
): { sem: number; index: number } | null {
  const p = placements.find((x) => x.id === id);
  if (!p) return null;
  const index = columnPlacements(placements, p.sem).findIndex((x) => x.id === id);
  return { sem: p.sem, index };
}

/**
 * The (sem, index) that puts a card directly ABOVE `targetId` — the drop
 * position for "dropped onto that card". `moverId` (an existing placement
 * being moved) is excluded first, matching movePlacementTo's index semantics.
 * Null when the target is unknown or is the mover itself.
 */
export function positionBefore(
  placements: Placement[],
  targetId: string,
  moverId?: string | null
): { sem: number; index: number } | null {
  if (moverId && moverId === targetId) return null;
  const rest = moverId ? placements.filter((p) => p.id !== moverId) : placements;
  return positionOf(rest, targetId);
}

/** Validate + repair a raw (untrusted) placement list from a doc: drops
 *  malformed entries and duplicate ids (first wins), clamps sems, renumbers
 *  orders densely, and caps at MAX_PLACEMENTS. */
export function sanitizePlacements(raw: unknown): Placement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Placement[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    if (typeof o.courseId !== "string" || !o.courseId) continue;
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      courseId: o.courseId,
      sem: typeof o.sem === "number" ? o.sem : MIN_SEM,
      order: typeof o.order === "number" ? o.order : Number.MAX_SAFE_INTEGER,
    });
    if (out.length >= MAX_PLACEMENTS) break;
  }
  return normalizePlacementOrder(out);
}

/**
 * The starting board for a program (spec 014 §D6): one placement per FIXED
 * single-course requirement (kind "course" with a resolvable course), in its
 * suggested semester, ordered by template order (slot_row, then input order).
 * Pattern / elective / attribute requirements are NOT placed — they live in
 * the "Still needed" checklist; the app never picks a course for the user.
 */
export function startingPlacements(
  templateSlots: ProgramSlotWithData[],
  newId: () => string = () => crypto.randomUUID()
): Placement[] {
  const fixed = templateSlots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind === "course" && s.courses != null)
    .sort(
      (a, b) =>
        clampSem(a.s.suggested_semester) - clampSem(b.s.suggested_semester) ||
        a.s.slot_row - b.s.slot_row ||
        a.i - b.i
    )
    .slice(0, MAX_PLACEMENTS);
  const counters = new Map<number, number>();
  return fixed.map(({ s }) => {
    const sem = clampSem(s.suggested_semester);
    const order = counters.get(sem) ?? 0;
    counters.set(sem, order + 1);
    return { id: newId(), courseId: s.courses!.id, sem, order };
  });
}
