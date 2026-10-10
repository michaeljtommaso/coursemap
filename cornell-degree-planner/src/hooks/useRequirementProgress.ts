import { useEffect, useMemo } from "react";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { Requirement } from "@/lib/planner/satisfies";
import { usePlan } from "@/hooks/usePlan";
import { useProgramData } from "@/hooks/useProgramData";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { enrichSelectedCourses } from "@/lib/planner/enrichCourses";
import { computeRequirementProgress, sameProgress } from "@/lib/planner/requirementProgress";

/**
 * useRequirementProgress (spec 014 D1/D2) — the current program's requirements,
 * attributed to the courses on the board by majorMatch.assign (position-
 * independent). Feeds the Still-needed panel (groups) and the course cards'
 * "counts toward" labels (attribution).
 *
 * The pure transformation lives in lib/planner/requirementProgress.ts (unit-
 * tested). This hook is React glue: it gathers the inputs from the shared
 * contexts and runs it through a module-level last-inputs cache, so the many
 * callers (every course card reads `attribution`) share ONE computation per
 * plan change, and the returned object keeps its identity whenever the result
 * is structurally unchanged (e.g. a reorder that moves no attribution).
 */

export type RequirementStatus = "unmet" | "partial" | "satisfied" | "waived";

export type RequirementItem = {
  /** Requirement id (the program template slot id / elective-group id). */
  id: string;
  /** Student-facing label, e.g. "CS 2110" or "CS Major Elective". */
  label: string;
  category: SlotCategory | null;
  /** Suggested semester from the template (for the by-semester sort). */
  suggestedSem: number | null;
  status: RequirementStatus;
  /** Placement ids whose courses count toward this requirement. */
  coveredBy: string[];
  /** False for elective pools whose rule (a course list or a broad category
   *  like liberal studies) the app can't evaluate yet — they never turn
   *  satisfied on their own; the panel says so instead of implying a gap. */
  checkable: boolean;
  /** The seat's matchable requirement (a course, pattern or attribute) — what
   *  a pick must satisfy. null for elective credit pools. */
  requirement: Requirement | null;
  /** For a "pick one of these" elective group (a list rule with explicit
   *  courses): its member course ids. Lets a blocked card point at the group
   *  as a pending choice even though the pool itself isn't checkable. */
  choiceCourseIds?: string[];
};

export type RequirementGroup = {
  /** Stable group key (the category, or "other"). */
  key: string;
  /** Display heading, e.g. "CS electives". */
  label: string;
  items: RequirementItem[];
  satisfiedCount: number;
  total: number;
};

export type RequirementProgress = {
  groups: RequirementGroup[];
  /** placementId → labels of the requirements that placement counts toward. */
  attribution: Record<string, string[]>;
  satisfiedCount: number;
  total: number;
};

const EMPTY: RequirementProgress = { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
const NO_CREDITS: CreditEntry[] = [];
const NO_WAIVERS: string[] = [];

// ── Module-level single-entry cache (shared across every hook instance) ──
type CacheArgs = readonly [
  ProgramSlotWithData[],
  Placement[],
  Record<string, Course>,
  Record<string, Course>,
  CreditEntry[],
  string[],
  Record<string, string>,
];
let lastArgs: CacheArgs | null = null;
let lastResult: RequirementProgress = EMPTY;

function cachedProgress(args: CacheArgs): RequirementProgress {
  if (lastArgs && args.every((a, i) => a === lastArgs![i])) return lastResult;
  const [templateSlots, placements, placedCourses, courseDetails, creditProfile, waived, aliases] =
    args;
  const next =
    templateSlots.length === 0
      ? EMPTY
      : computeRequirementProgress({
          templateSlots,
          placements,
          // Overlay full docs (attrs/title) so attribute requirements (FWS, …)
          // see real data; same ref when nothing is cached yet.
          placedCourses: enrichSelectedCourses(placedCourses, courseDetails),
          creditProfile,
          waivedRequirementIds: waived,
          canonical: (id) => aliases[id] ?? id,
        });
  lastArgs = args;
  if (!sameProgress(next, lastResult)) lastResult = next;
  return lastResult;
}

export function useRequirementProgress(): RequirementProgress {
  const { placements, placedCourses, waivedRequirementIds, planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  // Cached by ProgramProvider — every caller shares one program doc (and the
  // same slots array), which is what keeps the module cache hitting.
  // The LOADED plan's program, not the selection (fix pass P6): waivers and
  // requirements must match the plan on screen during a slow major switch.
  const { slots: templateSlots } = useProgramData(planProgramId ?? selectedProgramId);
  const { creditProfile } = useAuth();
  const { aliases, courseDetails, ensureCourseDetails } = useCatalogContext();

  // Full docs for the placed courses (≤ ~80 ids, deduped + session-cached in
  // CatalogProvider — never a catalog scan).
  const placedIds = useMemo(() => [...new Set(placements.map((p) => p.courseId))], [placements]);
  useEffect(() => {
    if (placedIds.length > 0) ensureCourseDetails(placedIds);
  }, [placedIds, ensureCourseDetails]);

  const credits = creditProfile.length > 0 ? creditProfile : NO_CREDITS;
  const waived = waivedRequirementIds.length > 0 ? waivedRequirementIds : NO_WAIVERS;

  return useMemo(
    () =>
      cachedProgress([
        templateSlots,
        placements,
        placedCourses,
        courseDetails,
        credits,
        waived,
        aliases,
      ] as const),
    [templateSlots, placements, placedCourses, courseDetails, credits, waived, aliases]
  );
}
