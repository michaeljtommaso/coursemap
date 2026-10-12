import { snapshotToCourse } from "@/lib/normalize/courseSnapshot";
import { columnPlacements, MAX_SEM } from "@/lib/planner/placementOps";
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
export type BoardColumn = { sem: number; cards: BoardCard[] };

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

/** Columns (every semester 1–8, plus 9–10 when used; cards by order) and the
 *  same cards flattened in board order (sem, then order). */
export function buildBoard(
  placements: Placement[],
  placedCourses: Record<string, Course>
): { columns: BoardColumn[]; cards: BoardCard[] } {
  const sems = new Set<number>(BASE_SEMS);
  for (const p of placements) if (p.sem >= 1 && p.sem <= MAX_SEM) sems.add(p.sem);
  const columns: BoardColumn[] = [...sems]
    .sort((a, b) => a - b)
    .map((sem) => ({
      sem,
      cards: columnPlacements(placements, sem).map((placement) => ({
        placement,
        course: courseForPlacement(placement, placedCourses),
      })),
    }));
  const cards = columns.flatMap((c) => c.cards);
  return { columns, cards };
}
