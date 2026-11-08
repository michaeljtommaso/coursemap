import { snapshotToCourse } from "@/lib/normalize/courseSnapshot";
import { columnPlacements, MAX_SEM, MIN_SEM } from "@/lib/planner/placementOps";
import { columnKey } from "@/lib/planner/terms";
import type { Placement } from "@/types/plan";
import type { Course } from "@/types/db";

/**
 * board.ts (spec 014 §D1) — the PURE half of the board model (useBoard is the
 * React glue). Turns placements + their courses into render columns and into
 * the flat card list that the status engine, derived edges, horizon and
 * enrichment all read.
 */

/** One placed course on the board: the placement (id, column, order) and the
 *  course it holds. The unit every board engine evaluates. */
export type BoardCard = { placement: Placement; course: Course };
/** One render column (spec 042 D3): semester `sem`, or — with `shortTerm` —
 *  the short term just before it. `key` is its time key (terms.ts columnKey:
 *  short term before k = 2k − 1, semester k = 2k); columns come sorted by it. */
export type BoardColumn = { sem: number; shortTerm: boolean; key: number; cards: BoardCard[] };

/** Semesters that always render, even empty (an empty column is still a drop
 *  target). Later semesters (9–10) appear only when they hold a card. */
const BASE_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Resolve a placement's course: its snapshot from the plan, else one derived
 *  from the id (a placement is never dropped for want of display data). */
export function courseForPlacement(
  placement: Placement,
  placedCourses: Record<string, Course>
): Course {
  return placedCourses[placement.courseId] ?? snapshotToCourse(placement.courseId, null);
}

const validSem = (k: unknown): k is number =>
  typeof k === "number" && Number.isInteger(k) && k >= MIN_SEM && k <= MAX_SEM;

/**
 * Columns, in time order, and the same cards flattened in that order:
 *   - every semester 1–8, plus 9–10 when used;
 *   - a short-term column before semester k for every k in `shortTerms` (the
 *     plan's added short terms — spec 042 D4; deduped, values outside 1..10
 *     ignored) and for every k that holds a short-term placement.
 * Cards in each column are by order.
 */
export function buildBoard(
  placements: Placement[],
  placedCourses: Record<string, Course>,
  shortTerms: readonly number[] = []
): { columns: BoardColumn[]; cards: BoardCard[] } {
  const sems = new Set<number>(BASE_SEMS);
  const shorts = new Set<number>();
  for (const k of shortTerms) if (validSem(k)) shorts.add(k);
  for (const p of placements) {
    if (!(p.sem >= MIN_SEM && p.sem <= MAX_SEM)) continue;
    if (p.shortTerm === true) shorts.add(p.sem);
    else sems.add(p.sem);
  }
  const refs = [
    ...[...sems].map((sem) => ({ sem, shortTerm: false })),
    ...[...shorts].map((sem) => ({ sem, shortTerm: true })),
  ]
    .map((ref) => ({ ...ref, key: columnKey(ref) }))
    .sort((a, b) => a.key - b.key);
  const columns: BoardColumn[] = refs.map(({ sem, shortTerm, key }) => ({
    sem,
    shortTerm,
    key,
    cards: columnPlacements(placements, { sem, shortTerm }).map((placement) => ({
      placement,
      course: courseForPlacement(placement, placedCourses),
    })),
  }));
  const cards = columns.flatMap((c) => c.cards);
  return { columns, cards };
}
