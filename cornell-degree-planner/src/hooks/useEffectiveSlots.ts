import { useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import type { ProgramSlotWithData, QualifyingRule } from "@/types/db";

/**
 * useEffectiveSlots (spec 005 §9) — THE single merge point between the program
 * template and the student's plan-level edits. Everything downstream (canvas,
 * sidebars, catalog prereq math, Major Match pool) consumes effective slots:
 *
 *   effective = template slots (drop removed, remap overridden semesters)
 *             ∪ custom slots (synthetic generic buckets)
 *
 * hidden = removed template slots, grouped by their CURRENT semester, for the
 * per-column restore affordance.
 */

const CUSTOM_GROUP = {
  id: "_custom",
  program_id: null,
  name: "Any course",
  description: "A slot you added — drop any course in, or leave it general.",
  qualifying_rule: { type: "open" } as QualifyingRule,
  min_credits: 3, // planning estimate; real credits take over once a course lands
  advisor_approval: false,
  notes: null,
};

export function toSyntheticSlot(c: {
  id: string;
  sem: number;
  title?: string;
}): ProgramSlotWithData {
  return {
    id: c.id,
    program_id: "_plan",
    kind: "elective",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: CUSTOM_GROUP.id,
    suggested_semester: c.sem,
    slot_row: 900, // appended after template rows within the column
    category: "elective", // a user-added "any course" bucket is a free elective
    courses: null,
    elective_groups: c.title ? { ...CUSTOM_GROUP, name: c.title } : CUSTOM_GROUP,
  };
}

export type EffectiveSlotsResult = {
  effectiveSlots: ProgramSlotWithData[];
  hiddenBySem: Map<number, ProgramSlotWithData[]>;
  hiddenCount: number;
};

/** Pure merge — also consumed by the read-only ShareView (spec 005 §5). */
export function mergeEffectiveSlots(
  slots: ProgramSlotWithData[],
  slotOverrides: Record<string, { sem?: number; removed?: true }>,
  customSlots: { id: string; sem: number; title?: string }[]
): EffectiveSlotsResult {
  const effective: ProgramSlotWithData[] = [];
  const hiddenBySem = new Map<number, ProgramSlotWithData[]>();
  let hiddenCount = 0;

  for (const s of slots) {
    const o = slotOverrides[s.id];
    const sem = o?.sem ?? s.suggested_semester;
    if (o?.removed) {
      const list = hiddenBySem.get(sem) ?? [];
      list.push(s);
      hiddenBySem.set(sem, list);
      hiddenCount++;
      continue;
    }
    effective.push(
      o?.sem != null && o.sem !== s.suggested_semester
        ? { ...s, suggested_semester: o.sem }
        : s
    );
  }

  customSlots.forEach((c, i) => {
    const synthetic = toSyntheticSlot(c);
    effective.push({ ...synthetic, slot_row: 900 + i });
  });

  return { effectiveSlots: effective, hiddenBySem, hiddenCount };
}

export function useEffectiveSlots(slots: ProgramSlotWithData[]): EffectiveSlotsResult {
  const { slotOverrides, customSlots } = usePlan();
  return useMemo(
    () => mergeEffectiveSlots(slots, slotOverrides, customSlots),
    [slots, slotOverrides, customSlots]
  );
}
