import type { PlanDoc } from "@/lib/schemas";

/**
 * Read-boundary bridge for plan docs. STAGE 2 (auth/plans) owns the real plan
 * read path (PlanProvider + services/plans.ts). Defined here now so the
 * normalizer surface is complete and stage 2 has the seam; the plan doc shape is
 * already camelCase-native (no Postgres snake_case legacy), so this is close to
 * identity plus defensive defaulting. Not consumed by any stage-1 read.
 */
export type NormalizedPlan = {
  name: string;
  programId: string;
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  courseSnapshots: Record<string, unknown>;
  schemaVersion: number;
};

export function normalizePlan(doc: PlanDoc): NormalizedPlan {
  return {
    name: doc.name,
    programId: doc.programId,
    slotSelections: doc.slotSelections ?? {},
    completedSlotIds: doc.completedSlotIds ?? [],
    waivedSlotIds: doc.waivedSlotIds ?? [],
    courseSnapshots: doc.courseSnapshots ?? {},
    schemaVersion: doc.schemaVersion ?? 1,
  };
}
