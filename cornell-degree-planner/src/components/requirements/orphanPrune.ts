import { useCallback } from "react";
import { usePlan } from "@/hooks/usePlan";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { MAX_COURSE_MARKS } from "@/lib/schemas";

/**
 * orphanPrune.ts (spec 047 D10) — the cap guard for waiver and answer writes.
 *
 * Waivers and course answers each cap at 80 per plan, and a removed program's
 * entries stay stored (inert). When a write would add a NEW entry past its
 * cap, the plan's orphans (entries naming a layer no program on the plan has)
 * are dropped first, so the write that follows lands; this is the "prune,
 * then retry once" of D10, done before the write so the student never sees a
 * cap toast that the prune would have avoided. Pruning runs only when every
 * program's layers loaded: with a layer missing, its own entries would look
 * orphaned. With nothing to prune, the write refuses with today's cap toast.
 */

const NO_IDS: string[] = [];
const NO_MARKS: Record<string, MarkValue> = {};

/** Waivers per plan (rules: waivedRequirementIds.size() <= 80). */
export const WAIVER_CAP = 80;

export type RoomKind = "waiver" | "mark";

/** Whether this write would add a new entry to a list already at its cap. */
export function writeNeedsRoom(
  kind: RoomKind,
  key: string,
  value: MarkValue | null,
  plan: { waivedRequirementIds: readonly string[]; courseMarks: Readonly<Record<string, MarkValue>> }
): boolean {
  if (kind === "waiver") {
    return !plan.waivedRequirementIds.includes(key) && plan.waivedRequirementIds.length >= WAIVER_CAP;
  }
  return value !== null && !(key in plan.courseMarks) && Object.keys(plan.courseMarks).length >= MAX_COURSE_MARKS;
}

/** Whether pruning may run now (D10's guard). */
export function canPrune(progress: Pick<RequirementProgress, "allLayersLoaded" | "liveLayerIds">): boolean {
  return progress.allLayersLoaded === true && (progress.liveLayerIds?.length ?? 0) > 0;
}

/**
 * Returns `makeRoom(kind, key, value)`: call it right before a waiver toggle
 * or a course-mark write. It prunes orphans only when that write would hit
 * the cap and pruning is safe; otherwise it does nothing.
 */
export function useMakeRoom(
  progress: Pick<RequirementProgress, "allLayersLoaded" | "liveLayerIds">
): (kind: RoomKind, key: string, value?: MarkValue | null) => void {
  const { waivedRequirementIds = NO_IDS, courseMarks = NO_MARKS, pruneOrphans } = usePlan();
  const { allLayersLoaded, liveLayerIds } = progress;
  return useCallback(
    (kind, key, value = "yes") => {
      if (!writeNeedsRoom(kind, key, value, { waivedRequirementIds, courseMarks })) return;
      if (!canPrune({ allLayersLoaded, liveLayerIds }) || !pruneOrphans) return;
      pruneOrphans(liveLayerIds!);
    },
    [waivedRequirementIds, courseMarks, pruneOrphans, allLayersLoaded, liveLayerIds]
  );
}
