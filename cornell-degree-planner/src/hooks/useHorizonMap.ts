import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { horizonForSemester, rosterOfferGate, type Horizon } from "@/lib/planner/horizon";
import { primarySection } from "@/lib/planner/sections";
import { findConflicts, type ConflictPlacement } from "@/lib/planner/conflicts";
import type { Course, CourseSection, ProgramSlotWithData } from "@/types/db";

/**
 * useHorizonMap (spec 012 §1/§4) — the parallel structure that delivers horizon
 * + near-column conflicts WITHOUT touching computeSlotStatusMap (the status
 * engine boundary stays frozen). Both the canvas (which provides it to cards via
 * HorizonContext) and CourseDetailPanel read from here, so the card face and the
 * panel never disagree.
 *
 * Horizon per column comes from the pure horizonForSemester (enteringYear from
 * the profile, enrollmentTarget from catalog/meta). Conflicts are computed only
 * over near-column placements that are actually offered this term — the
 * rosterOfferGate over course.roster (the sync's SLUG; ⚠️ NOT roster_id, which
 * is Cornell's numeric crseId — the 2026-07-11 root cause) — the honesty rule:
 * no meeting data, no conflict claim.
 *
 * Reads enriched courses via useEnrichedPlan so it sees real `sections` /
 * `roster` overlaid onto the display snapshots.
 *
 * Spec 014: `slots` are useBoard's engineSlots — one per placement, so every
 * key in `bySlot` (and every ConflictPlacement.slotId) is a PLACEMENT id, and
 * each slot's course is simply `slot.courses` (no picks / template fallback).
 */

export type SlotHorizon = {
  horizon: Horizon;
  /** near AND the placed course's `roster` slug === the target — the course is
   *  really offered this term (carries this roster's sections). */
  offeredThisTerm: boolean;
  /** near AND the course's `roster` is KNOWN and ≠ the target — safe to say
   *  "not offered this term". Distinct from !offeredThisTerm: a null roster
   *  (pre-fix docs, un-enriched snapshots) makes BOTH false — never claim
   *  from missing data. */
  notOfferedThisTerm: boolean;
  /** the primary section for the near face (instructor line / meeting chip /
   *  open-status dot). null unless offeredThisTerm and the course has sections. */
  primarySection: CourseSection | null;
  /** advisory: the display code of another near-column course this one meets at
   *  the same time as, or null. Never blocking (spec 012 §4). */
  conflictWith: string | null;
};

export type HorizonMap = {
  bySlot: Record<string, SlotHorizon>;
  /** The configured enrollment target ("FA26"), or null when unset. */
  targetSlug: string | null;
};

export function useHorizonMap(slots: ProgramSlotWithData[]): HorizonMap {
  const { enteringYear } = useAuth();
  const { enrollmentTarget } = useCatalogContext();
  // Enriched engine slots — one per placement (spec 014: id = placement id,
  // `courses` = the placed course with real sections/roster overlaid).
  const { enrichedSlots } = useEnrichedPlan(slots);

  return useMemo(() => {
    const slotHorizon = new Map<string, Horizon>();
    // Near-column, offered-this-term placements → pairwise conflict input. Near
    // maps to exactly one column (one term+year), so these are that column's
    // placed, offered courses.
    const nearPlacements: ConflictPlacement[] = [];

    for (const slot of enrichedSlots) {
      const h = horizonForSemester(slot.suggested_semester, enteringYear, enrollmentTarget);
      slotHorizon.set(slot.id, h);
      const course = slot.courses;
      // ⚠️ gate on course.roster (the sync's slug), NEVER roster_id (numeric
      // crseId — comparing it to a slug is always false; the 07-11 root cause).
      if (h === "near" && course && rosterOfferGate(course.roster, enrollmentTarget) === "offered") {
        nearPlacements.push({
          slotId: slot.id,
          courseId: course.id,
          courseCode: `${course.subject} ${course.number}`,
          sections: course.sections,
        });
      }
    }

    const conflicts = findConflicts(nearPlacements);
    const codeBySlot = new Map(nearPlacements.map((p) => [p.slotId, p.courseCode]));
    const conflictWith = new Map<string, string>();
    for (const c of conflicts) {
      // The collision is mutual — both slots get an advisory pointing at the
      // OTHER course. First conflict wins per slot (glanceable single line).
      if (!conflictWith.has(c.aSlotId)) conflictWith.set(c.aSlotId, codeBySlot.get(c.bSlotId) ?? "");
      if (!conflictWith.has(c.bSlotId)) conflictWith.set(c.bSlotId, codeBySlot.get(c.aSlotId) ?? "");
    }

    const bySlot: Record<string, SlotHorizon> = {};
    for (const slot of enrichedSlots) {
      const h = slotHorizon.get(slot.id) ?? "far";
      const course: Course | null = slot.courses;
      // Tri-state offer gate over course.roster (the slug — NOT roster_id):
      // "unknown" (null roster / no target) makes both flags false, so a
      // pre-fix doc or bare snapshot claims nothing either way.
      const gate = course && h === "near" ? rosterOfferGate(course.roster, enrollmentTarget) : "unknown";
      const offered = gate === "offered";
      bySlot[slot.id] = {
        horizon: h,
        offeredThisTerm: offered,
        notOfferedThisTerm: gate === "not-offered",
        primarySection: offered && course ? primarySection(course.sections) : null,
        conflictWith: conflictWith.get(slot.id) ?? null,
      };
    }

    return { bySlot, targetSlug: enrollmentTarget ?? null };
  }, [enrichedSlots, enteringYear, enrollmentTarget]);
}
