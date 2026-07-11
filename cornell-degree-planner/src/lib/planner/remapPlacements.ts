/**
 * remapPlacements.ts (spec 009 §4 / C4) — "switching majors never deletes
 * placements." A PURE, deterministic re-mapper: given the placements whose slot
 * ids no longer exist in the target program (orphans) and the target program's
 * slots, it decides where each placed course goes — never dropping one.
 *
 * Priority for each orphaned course (first available wins):
 *   1. an UNFILLED slot with the exact same fixed course id,
 *   2. an UNFILLED pattern slot the course matches,
 *   3. an UNFILLED attribute slot the course matches,
 *   4. an UNFILLED elective slot whose qualifying rule accepts it (computable
 *      rules only),
 *   5. otherwise a NEW plan-owned custom slot in the course's original semester.
 *
 * A slot's manual mark (completed / waived / in-progress) travels WITH its
 * placement to the new slot id. Deterministic: input order is preserved and the
 * matching passes run tier-by-tier, so the same inputs always yield the same
 * plan. Custom slot ids are derived from the old slot id (stable), which makes a
 * re-run — and therefore a switch-back — idempotent.
 *
 * This module is engine-shaped (no React, no Firestore): the caller
 * (PlanProvider) resolves courses + semesters and applies the returned plan.
 */

import { courseSatisfiesRequirement } from "./satisfies";
import type { AttributeMatch, QualifyingRule } from "@/types/db";

export type RemapMark = "completed" | "waived" | "in-progress";

export type RemapCourse = {
  id: string;
  subject: string;
  number: string;
  title?: string | null;
  attrs?: { value: string }[] | null;
};

/** An existing placement whose slot id is gone from the target program. */
export type RemapPlacement = {
  /** The old (now-invalid) slot id the course sat in. */
  slotId: string;
  course: RemapCourse;
  /** The course's original semester (caller-resolved; used for a fresh custom
   *  slot). */
  semester: number;
  /** The old slot's manual mark, if any — travels with the placement. */
  mark: RemapMark | null;
};

/** A candidate slot in the TARGET program the re-mapper may fill. */
export type RemapTargetSlot = {
  id: string;
  kind: "course" | "pattern" | "elective" | "attribute";
  courseId?: string | null;
  pattern?: string | null;
  attributeMatch?: AttributeMatch | null;
  qualifyingRule?: QualifyingRule | null;
};

export type RemapMove = { fromSlotId: string; toSlotId: string; courseId: string };
export type RemapCustomCreation = { slotId: string; sem: number; courseId: string };
export type RemapMarkTransfer = { fromSlotId: string; toSlotId: string; mark: RemapMark };

export type RemapResult = {
  /** Placements moved into an existing target-program slot. */
  moves: RemapMove[];
  /** Placements that needed a fresh plan-owned custom slot. */
  customCreations: RemapCustomCreation[];
  /** Manual marks that follow their placement to the new slot id. */
  markTransfers: RemapMarkTransfer[];
  /** How many orphans landed in a real target-program requirement slot. */
  matchedCount: number;
  /** Total orphans handled (all are kept). */
  keptCount: number;
};

function electiveRuleAccepts(rule: QualifyingRule, courseId: string): boolean {
  const [subject, numberStr] = courseId.split("-");
  const num = parseInt(numberStr ?? "", 10);
  switch (rule.type) {
    case "open":
      return true;
    case "level":
      return subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    case "outside":
      return !rule.exclude_subjects.includes(subject);
    case "list":
    case "category":
      return false; // not computable client-side — can't claim a fit
  }
}

/** Does `course` fit `slot` at the given priority tier? */
function fitsTier(
  course: RemapCourse,
  slot: RemapTargetSlot,
  tier: 0 | 1 | 2 | 3,
  canonical: (id: string) => string
): boolean {
  switch (tier) {
    case 0:
      return (
        slot.kind === "course" &&
        !!slot.courseId &&
        courseSatisfiesRequirement(course, { kind: "course", courseId: slot.courseId }, canonical)
      );
    case 1:
      return (
        slot.kind === "pattern" &&
        !!slot.pattern &&
        courseSatisfiesRequirement(course, { kind: "pattern", pattern: slot.pattern })
      );
    case 2:
      return (
        slot.kind === "attribute" &&
        !!slot.attributeMatch &&
        courseSatisfiesRequirement(course, { kind: "attribute", match: slot.attributeMatch })
      );
    case 3:
      return (
        slot.kind === "elective" &&
        !!slot.qualifyingRule &&
        electiveRuleAccepts(slot.qualifyingRule, course.id)
      );
  }
}

/**
 * Compute the re-mapping plan. `occupiedSlotIds` are target slots already filled
 * (by placements that stayed valid) — they can't be reused. `customSlotId` mints
 * a deterministic id from the old slot id so re-runs are idempotent.
 */
export function remapPlacements(
  placements: RemapPlacement[],
  targetSlots: RemapTargetSlot[],
  occupiedSlotIds: Iterable<string> = [],
  canonical: (id: string) => string = (id) => id,
  customSlotId: (oldSlotId: string) => string = (o) => `cus-remap-${o}`
): RemapResult {
  const taken = new Set<string>(occupiedSlotIds);
  const moves: RemapMove[] = [];
  const customCreations: RemapCustomCreation[] = [];
  const markTransfers: RemapMarkTransfer[] = [];

  for (const p of placements) {
    let toSlotId: string | null = null;
    // Tier-by-tier: exact course > pattern > attribute > elective.
    for (const tier of [0, 1, 2, 3] as const) {
      for (const slot of targetSlots) {
        if (taken.has(slot.id)) continue;
        if (fitsTier(p.course, slot, tier, canonical)) {
          toSlotId = slot.id;
          break;
        }
      }
      if (toSlotId) break;
    }

    if (toSlotId) {
      taken.add(toSlotId);
      moves.push({ fromSlotId: p.slotId, toSlotId, courseId: p.course.id });
      if (p.mark) markTransfers.push({ fromSlotId: p.slotId, toSlotId, mark: p.mark });
    } else {
      const newId = customSlotId(p.slotId);
      customCreations.push({ slotId: newId, sem: p.semester, courseId: p.course.id });
      if (p.mark) markTransfers.push({ fromSlotId: p.slotId, toSlotId: newId, mark: p.mark });
    }
  }

  return {
    moves,
    customCreations,
    markTransfers,
    matchedCount: moves.length,
    keptCount: placements.length,
  };
}
