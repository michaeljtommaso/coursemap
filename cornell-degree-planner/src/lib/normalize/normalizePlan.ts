import type { Placement } from "@/types/plan";
import { PLAN_SCHEMA_VERSION } from "@/lib/schemas";
import { MAX_PLACEMENTS, sanitizePlacements } from "@/lib/planner/placementOps";

/**
 * Read-boundary bridge for plan docs (spec 014 §D5). The doc shape is
 * camelCase-native, so this is defensive defaulting + repair:
 *
 *   - A doc with an OLDER schemaVersion (the v1/v2 slot model), or one missing
 *     `placements`, is read as EMPTY — no conversion code (spec 014 §D5: no
 *     real saved plans exist). PlanProvider then lays down the program's
 *     starting board (§D6), and the first write upgrades the doc in place.
 *   - Placements are sanitized (malformed / duplicate ids dropped, sems
 *     clamped, orders renumbered densely, capped at 80).
 *   - Manual marks are kept only for placements that exist, deduped, and held
 *     to one manual state per placement (completed wins over in progress).
 *   - courseSnapshots are trimmed to the courses actually placed.
 */
export type NormalizedPlan = {
  name: string;
  programId: string;
  placements: Placement[];
  /** courseId → stored display snapshot (camelCase), for placed courses only. */
  courseSnapshots: Record<string, unknown>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  schemaVersion: number;
  /** True when the doc predates the placement model and was read as empty. */
  legacy: boolean;
};

/** The loosely-typed doc fields normalizePlan reads (a parsed PlanDoc, or the
 *  bare name/programId/schemaVersion shell of a legacy doc). */
export type PlanDocInput = {
  name?: unknown;
  programId?: unknown;
  schemaVersion?: unknown;
  placements?: unknown;
  courseSnapshots?: unknown;
  completedIds?: unknown;
  inProgressIds?: unknown;
  waivedRequirementIds?: unknown;
};

/** Is this raw doc the current placement shape? (Older schemaVersion or no
 *  placements array → legacy → read as empty.) */
export function isCurrentPlanShape(doc: PlanDocInput): boolean {
  return (
    typeof doc.schemaVersion === "number" &&
    doc.schemaVersion >= PLAN_SCHEMA_VERSION &&
    Array.isArray(doc.placements)
  );
}

function idList(raw: unknown, keep: (id: string) => boolean, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string" || !v || seen.has(v) || !keep(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export function normalizePlan(doc: PlanDocInput): NormalizedPlan {
  const name = typeof doc.name === "string" ? doc.name : "";
  const programId = typeof doc.programId === "string" ? doc.programId : "";

  if (!isCurrentPlanShape(doc)) {
    return {
      name,
      programId,
      placements: [],
      courseSnapshots: {},
      completedIds: [],
      inProgressIds: [],
      waivedRequirementIds: [],
      schemaVersion: typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1,
      legacy: true,
    };
  }

  const placements = sanitizePlacements(doc.placements);
  const placementIds = new Set(placements.map((p) => p.id));
  const completedIds = idList(doc.completedIds, (id) => placementIds.has(id), MAX_PLACEMENTS);
  const completedSet = new Set(completedIds);
  const inProgressIds = idList(
    doc.inProgressIds,
    (id) => placementIds.has(id) && !completedSet.has(id),
    MAX_PLACEMENTS
  );
  const waivedRequirementIds = idList(doc.waivedRequirementIds, () => true, 80);

  const placedCourseIds = new Set(placements.map((p) => p.courseId));
  const rawSnaps =
    doc.courseSnapshots && typeof doc.courseSnapshots === "object"
      ? (doc.courseSnapshots as Record<string, unknown>)
      : {};
  const courseSnapshots: Record<string, unknown> = {};
  for (const [courseId, snap] of Object.entries(rawSnaps)) {
    if (placedCourseIds.has(courseId)) courseSnapshots[courseId] = snap;
  }

  return {
    name,
    programId,
    placements,
    courseSnapshots,
    completedIds,
    inProgressIds,
    waivedRequirementIds,
    schemaVersion: doc.schemaVersion as number,
    legacy: false,
  };
}
