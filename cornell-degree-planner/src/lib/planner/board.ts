import { courseCategory } from "@/lib/planner/slotCategory";
import { snapshotToCourse } from "@/lib/normalize/courseSnapshot";
import { columnPlacements, MAX_SEM } from "@/lib/planner/placementOps";
import type { Placement } from "@/types/plan";
import type { Course, ProgramSlotWithData } from "@/types/db";

/**
 * board.ts (spec 014 §D1) — the PURE half of the board adapter (useBoard is
 * the React glue). Turns placements + their courses into render columns and
 * into the engine's input: one synthesized course-kind ProgramSlotWithData per
 * placement, so the status engine / derived edges / horizon / enrichment keep
 * running unchanged internally (the engine-internal "slot" rename is a
 * deliberate follow-up).
 */

export type BoardCard = { placement: Placement; course: Course };
export type BoardColumn = { sem: number; cards: BoardCard[] };

/** Semesters that always render, even empty (an empty column is still a drop
 *  target). Later semesters (9–10) appear only when they hold a card. */
const BASE_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The engine's view of one placement: id = placement id, kind "course",
 *  courses = the course, suggested_semester = its column, slot_row = order. */
export function placementToEngineSlot(placement: Placement, course: Course): ProgramSlotWithData {
  return {
    id: placement.id,
    program_id: "_plan",
    kind: "course",
    course_id: course.id,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: placement.sem,
    slot_row: placement.order,
    category: courseCategory(course.subject),
    attribute_match: null,
    courses: course,
    elective_groups: null,
  };
}

/** Resolve a placement's course: its snapshot from the plan, else one derived
 *  from the id (a placement is never dropped for want of display data). */
export function courseForPlacement(
  placement: Placement,
  placedCourses: Record<string, Course>
): Course {
  return placedCourses[placement.courseId] ?? snapshotToCourse(placement.courseId, null);
}

/** Columns (every semester 1–8, plus 9–10 when used; cards by order) and the
 *  engine slots (board order: sem, then order). */
export function buildBoard(
  placements: Placement[],
  placedCourses: Record<string, Course>
): { columns: BoardColumn[]; engineSlots: ProgramSlotWithData[] } {
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
  const engineSlots = columns.flatMap((c) =>
    c.cards.map((card) => placementToEngineSlot(card.placement, card.course))
  );
  return { columns, engineSlots };
}
