import type { PlanDoc, SlotOverride, CustomSlot } from "@/lib/schemas";

/**
 * Read-boundary bridge for plan docs. The plan doc shape is camelCase-native,
 * so this is close to identity plus defensive defaulting — which is exactly
 * what makes schemaVersion upgrades safe: v1 docs (no slotOverrides/
 * customSlots) normalize to empty structures and re-save as v2 on next write.
 */
export type NormalizedPlan = {
  name: string;
  programId: string;
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  courseSnapshots: Record<string, unknown>;
  slotOverrides: Record<string, SlotOverride>;
  customSlots: CustomSlot[];
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
    slotOverrides: (doc.slotOverrides ?? {}) as Record<string, SlotOverride>,
    customSlots: (doc.customSlots ?? []) as CustomSlot[],
    schemaVersion: doc.schemaVersion ?? 1,
  };
}
