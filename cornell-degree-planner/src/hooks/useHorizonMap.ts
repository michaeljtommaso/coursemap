import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { horizonForSemester, rosterOfferGate, type Horizon } from "@/lib/planner/horizon";
import { primarySection } from "@/lib/planner/sections";
import { findConflicts, type ConflictPlacement } from "@/lib/planner/conflicts";
import type { BoardCard } from "@/lib/planner/board";
import type { CourseSection } from "@/types/db";

/**
 * useHorizonMap (spec 012 §1/§4) — the parallel structure that delivers horizon
 * + near-column conflicts WITHOUT touching computeCardStatusMap (the status
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
 * Spec 014: `cards` are useBoard's cards — one per placement, so every key in
 * `byPlacement` (and every ConflictPlacement.placementId) is a PLACEMENT id.
 */

export type CardHorizon = {
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
  byPlacement: Record<string, CardHorizon>;
  /** The configured enrollment target ("FA26"), or null when unset. */
  targetSlug: string | null;
};

export function useHorizonMap(cards: BoardCard[]): HorizonMap {
  const { enteringYear } = useAuth();
  const { enrollmentTarget } = useCatalogContext();
  // Enriched cards — one per placement, each course with its real
  // sections/roster overlaid.
  const { enrichedCards } = useEnrichedPlan(cards);

  return useMemo(() => {
    const cardHorizon = new Map<string, Horizon>();
    // Near-column, offered-this-term placements → pairwise conflict input. Near
    // maps to exactly one column (one term+year), so these are that column's
    // placed, offered courses.
    const nearPlacements: ConflictPlacement[] = [];

    for (const { placement, course } of enrichedCards) {
      const h = horizonForSemester(placement.sem, enteringYear, enrollmentTarget);
      cardHorizon.set(placement.id, h);
      // ⚠️ gate on course.roster (the sync's slug), NEVER roster_id (numeric
      // crseId — comparing it to a slug is always false; the 07-11 root cause).
      if (h === "near" && rosterOfferGate(course.roster, enrollmentTarget) === "offered") {
        nearPlacements.push({
          placementId: placement.id,
          courseId: course.id,
          courseCode: `${course.subject} ${course.number}`,
          sections: course.sections,
        });
      }
    }

    const conflicts = findConflicts(nearPlacements);
    const codeById = new Map(nearPlacements.map((p) => [p.placementId, p.courseCode]));
    const conflictWith = new Map<string, string>();
    for (const c of conflicts) {
      // The collision is mutual — both cards get an advisory pointing at the
      // OTHER course. First conflict wins per card (glanceable single line).
      if (!conflictWith.has(c.aPlacementId)) {
        conflictWith.set(c.aPlacementId, codeById.get(c.bPlacementId) ?? "");
      }
      if (!conflictWith.has(c.bPlacementId)) {
        conflictWith.set(c.bPlacementId, codeById.get(c.aPlacementId) ?? "");
      }
    }

    const byPlacement: Record<string, CardHorizon> = {};
    for (const { placement, course } of enrichedCards) {
      const h = cardHorizon.get(placement.id) ?? "far";
      // Tri-state offer gate over course.roster (the slug — NOT roster_id):
      // "unknown" (null roster / no target) makes both flags false, so a
      // pre-fix doc or bare snapshot claims nothing either way.
      const gate = h === "near" ? rosterOfferGate(course.roster, enrollmentTarget) : "unknown";
      const offered = gate === "offered";
      byPlacement[placement.id] = {
        horizon: h,
        offeredThisTerm: offered,
        notOfferedThisTerm: gate === "not-offered",
        primarySection: offered ? primarySection(course.sections) : null,
        conflictWith: conflictWith.get(placement.id) ?? null,
      };
    }

    return { byPlacement, targetSlug: enrollmentTarget ?? null };
  }, [enrichedCards, enteringYear, enrollmentTarget]);
}
