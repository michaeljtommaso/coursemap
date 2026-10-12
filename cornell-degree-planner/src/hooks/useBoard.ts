import { useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useProgramData } from "@/hooks/useProgramData";
import { useProgramStore } from "@/store/useProgramStore";
import { buildBoard, type BoardCard, type BoardColumn } from "@/lib/planner/board";
import type { ProgramSlotWithData } from "@/types/db";

export type { BoardCard, BoardColumn } from "@/lib/planner/board";
export { buildBoard, courseForPlacement } from "@/lib/planner/board";

/**
 * useBoard (spec 014 §D1) — THE seam between the placement plan model and
 * everything that renders or evaluates the board. Replaces the slot-model
 * "effective slots" merge (template + overrides + custom slots).
 *
 *   columns       — one column per semester, cards sorted by `order`. Semesters
 *                   1–8 always render (an empty column is still a drop target);
 *                   later semesters (9–10) appear only when they hold a card.
 *   cards         — the same cards flattened in board order (sem, then order):
 *                   one per placement, what the status engine / derived edges /
 *                   horizon / enrichment evaluate.
 *   templateSlots — the program's template slots: the REQUIREMENTS (for the
 *                   catalog's "For my major" filter, relevance lines, and the
 *                   Still-needed checklist).
 *
 * The pure builders live in lib/planner/board.ts (re-exported here).
 */
export function useBoard(): {
  columns: BoardColumn[];
  cards: BoardCard[];
  templateSlots: ProgramSlotWithData[];
} {
  const { placements, placedCourses, planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  // The LOADED plan's program (fix pass P6): during a slow major switch the
  // old plan is still on screen, so its requirements must stay the old
  // program's until the new plan loads. Cached by ProgramProvider — repeat
  // callers share one program-doc read.
  const { slots: templateSlots } = useProgramData(planProgramId ?? selectedProgramId);

  const board = useMemo(() => buildBoard(placements, placedCourses), [placements, placedCourses]);

  return useMemo(
    () => ({ columns: board.columns, cards: board.cards, templateSlots }),
    [board, templateSlots]
  );
}
