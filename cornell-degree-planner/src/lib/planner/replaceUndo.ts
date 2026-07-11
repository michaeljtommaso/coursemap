/**
 * replaceUndo.ts (spec 009 §2 / #5) — "drops never lie." Dropping (or clicking)
 * a course onto an OCCUPIED slot REPLACES the incumbent; an undo toast restores
 * the exact prior state. This pure builder computes, from the slot selections as
 * they stood BEFORE the assignment, everything the undo needs — so the restore
 * is correct for the single-step case regardless of how the UI wires it.
 *
 * assignSlot's semantics (PlanProvider): a course fills at most one slot, so
 * assigning it to `targetSlotId` (a) removes it from whatever slot it was in and
 * (b) overwrites the incumbent in the target. Exactly two slots can change:
 *   - the target (its prior occupant is displaced), and
 *   - the slot the incoming course vacated (if it was already placed).
 * Undo therefore restores those two slots to their prior selection.
 */

export type ReplacePlan = {
  /** The course displaced from the target slot (null when the target was empty
   *  — then it's a plain placement, not a replace, and no toast is warranted). */
  incumbentCourseId: string | null;
  /** The slot the incoming course was moved out of (null when it came from the
   *  catalog / wasn't placed yet). */
  vacatedSlotId: string | null;
  /** The exact prior selection for each slot the assignment changes. `null` =
   *  that slot should be cleared on undo (it was empty before). */
  undoSelections: Record<string, string | null>;
  /** True when the target held a DIFFERENT course — the only case that shows the
   *  replace/undo toast. */
  isReplace: boolean;
};

export function buildReplacePlan(
  prevSelections: Record<string, string>,
  targetSlotId: string,
  newCourseId: string
): ReplacePlan {
  const incumbentCourseId = prevSelections[targetSlotId] ?? null;

  // Where was the incoming course before this assignment? (It fills one slot, so
  // assigning it elsewhere vacates that slot.)
  let vacatedSlotId: string | null = null;
  for (const [sid, cid] of Object.entries(prevSelections)) {
    if (cid === newCourseId && sid !== targetSlotId) {
      vacatedSlotId = sid;
      break;
    }
  }

  const undoSelections: Record<string, string | null> = {};
  // Restore the target to its prior occupant (or clear it if it was empty).
  undoSelections[targetSlotId] = incumbentCourseId;
  // Put the incoming course back where it came from.
  if (vacatedSlotId) undoSelections[vacatedSlotId] = newCourseId;

  return {
    incumbentCourseId,
    vacatedSlotId,
    undoSelections,
    isReplace: incumbentCourseId !== null && incumbentCourseId !== newCourseId,
  };
}
