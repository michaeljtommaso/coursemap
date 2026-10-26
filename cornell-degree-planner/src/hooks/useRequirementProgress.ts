import { useDeferredValue, useEffect, useMemo } from "react";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { Requirement } from "@/lib/planner/satisfies";
import type { Layer } from "@/lib/planner/distribution/types";
import type { StudentPrefs } from "@/services/profile";
import { usePlan } from "@/hooks/usePlan";
import { useProgramData } from "@/hooks/useProgramData";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { enrichSelectedCourses } from "@/lib/planner/enrichCourses";
import { computeRequirementProgress, sameProgress } from "@/lib/planner/requirementProgress";
import { computeDistributionProgress } from "@/lib/planner/distributionProgress";
import { isDistributionFamily, programFamily } from "@/lib/planner/colleges";

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
 *
 * Spec 019 D3: the program's family picks the engine. Engineering programs
 * take the path above, unchanged; CAS and CALS programs go through
 * lib/planner/distributionProgress.ts (selectLayers → solve) with the
 * program's layers and the student's entry term / transfer answers.
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
  /** False for elective pools whose rule the app can't evaluate yet (a broad
   *  category like liberal studies, or a list with no member courses) — they
   *  never turn satisfied on their own; the panel says so instead of implying
   *  a gap. */
  checkable: boolean;
  /** The seat's matchable requirement (a course, pattern or attribute) — what
   *  a pick must satisfy. null for elective credit pools. */
  requirement: Requirement | null;
  /** For a "pick one of these" elective group (a list rule with explicit
   *  courses): its member course ids. Lets a blocked card point at the group
   *  as a pending choice while the group still needs a pick. */
  choiceCourseIds?: string[];
  /** For an elective pool: how far along it is (spec 019 D6). A pool is met
   *  only when both the course count and the credit total are reached. */
  poolProgress?: {
    courses: number;
    requiredCourses: number;
    credits: number;
    requiredCredits: number;
  };
  /** Distribution engine only (spec 019 D9) — absent on Engineering items. */
  dist?: DistributionItemInfo;
};

/**
 * Spec 019 D9 — what a Distribution-engine row adds to a RequirementItem. The
 * adapter (lib/planner/distributionProgress.ts) maps engine statuses onto the
 * shared RequirementStatus so every existing reader keeps working:
 *   met → "satisfied", partial → "partial", unmet → "unmet",
 *   waived → "waived", unchecked → "unmet" + checkable:false,
 *   confirm → "unmet" + checkable:false + dist.confirm.
 * The item's `id` is the waiver key `${layerId}:${rowId}`.
 */
export type DistributionItemInfo = {
  layerId: string;
  rowId: string;
  layerKind: "college" | "major" | "concentration";
  rowKind: "seat" | "pool" | "distribution" | "credits" | "anyOf" | "confirm";
  /** The engine's own status, for wording ("can't check" vs "confirm"). */
  engineStatus: "met" | "partial" | "unmet" | "unchecked" | "confirm" | "waived";
  /** "confirm with your advisor" row: outside the percentage. */
  confirm?: boolean;
  /** Why an "unchecked" row couldn't be proved. */
  reason?: "node-cap" | "engine-error" | "verify-rejected" | "bad-layer";
  coursesHave?: number;
  coursesNeed?: number;
  creditsHave?: number;
  creditsNeed?: number;
  /** Distribution rows: one chip per category, in authored order. */
  categories?: { id: string; label: string; filled: boolean; missing: boolean }[];
  /** "3 of 4 categories". */
  categoriesHave?: number;
  categoriesNeed?: number;
  /** anyOf rows: each option, and which one is furthest along (the one shown
   *  "in progress"; the met one when any is met). */
  options?: { label: string; status: RequirementStatus; fraction: number }[];
  activeOption?: number;
  /** Courses counted, as display codes ("CS 1110"), board order. */
  countedCodes: string[];
  note?: string;
};

export type RequirementGroup = {
  /** Stable group key (the category, or "other"; Distribution:
   *  `${layerId}:${group}`). */
  key: string;
  /** Display heading, e.g. "CS electives"; Distribution: "College · Distribution". */
  label: string;
  items: RequirementItem[];
  satisfiedCount: number;
  total: number;
};

/** Spec 019 — why a Distribution program's requirements can't be shown yet:
 *  selectLayers needs an answer from the student, or a layer failed to load
 *  or validate. The panel asks / explains instead of guessing. */
export type RequirementNotice =
  | { kind: "needs-entry-term" }
  | { kind: "needs-transfer" }
  | { kind: "needs-transfer-standing" }
  | { kind: "layers-unavailable" }
  /** status:"hidden" major a student is already on (spec States table). */
  | { kind: "under-review" };

export type RequirementProgress = {
  groups: RequirementGroup[];
  /** placementId → labels of the requirements that placement counts toward. */
  attribution: Record<string, string[]>;
  satisfiedCount: number;
  total: number;
  /** Which engine produced this. Absent → "engineering". */
  engine?: "engineering" | "distribution";
  /** Distribution: "2026-27", named on the panel (D9/D10). */
  catalogYear?: string;
  /** Distribution: the college rule version in use (its layer's name, e.g.
   *  "… (pre-2025 curriculum)"), so a student can see which answers it
   *  followed and change them. */
  collegeVersion?: string;
  /** Distribution: 0–100, DistributionResult.pct. */
  pct?: number;
  notice?: RequirementNotice;
  /** Distribution: the major offers concentrations (spec 019 Phase 5). Rows
   *  are still shown; `needed` is set while the student has chosen too few
   *  (or too many) and must pick, so the panel can ask instead of implying
   *  the major is complete. */
  concentrations?: {
    min: number;
    max: number;
    options: { id: string; name: string }[];
    chosen: string[];
    needed: boolean;
  };
};

const EMPTY: RequirementProgress = { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
/** A Distribution program not solved yet (first render, or the deferred
 *  inputs still catching up after an engine switch). */
const DIST_PENDING: RequirementProgress = { ...EMPTY, engine: "distribution" };
const NO_CREDITS: CreditEntry[] = [];
const NO_WAIVERS: string[] = [];

// ── Module-level single-entry caches (shared across every hook instance) ──
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

// Spec 019 — the Distribution path's own cache. Every entry is compared by
// identity (strings by value), so the many hook instances share one solve.
type DistArgs = readonly [
  programId: string,
  family: "cas" | "cals",
  programStatus: "visible" | "hidden",
  layers: Layer[] | undefined,
  layerErrors: string[] | undefined,
  entryTerm: StudentPrefs["entryTerm"],
  transfer: StudentPrefs["transfer"],
  transferStanding: StudentPrefs["transferStanding"],
  concentration: StudentPrefs["concentration"],
  placements: Placement[],
  placedCourses: Record<string, Course>,
  courseDetails: Record<string, Course>,
  creditProfile: CreditEntry[],
  waived: string[],
  aliases: Record<string, string>,
];
let lastDistArgs: DistArgs | null = null;
let lastDistResult: RequirementProgress = DIST_PENDING;

function cachedDistributionProgress(args: DistArgs): RequirementProgress {
  if (lastDistArgs && args.every((a, i) => a === lastDistArgs![i])) return lastDistResult;
  const [
    programId,
    family,
    programStatus,
    layers,
    layerErrors,
    entryTerm,
    transfer,
    transferStanding,
    concentration,
    placements,
    placedCourses,
    courseDetails,
    creditProfile,
    waived,
    aliases,
  ] = args;
  const next = computeDistributionProgress({
    layers,
    layerErrors,
    programId,
    family,
    programStatus,
    ctx: { entryTerm, transfer, transferStanding, concentration },
    placements,
    // Tag rules (ALC-AS, …) read the full docs' attrs.
    placedCourses: enrichSelectedCourses(placedCourses, courseDetails),
    creditProfile,
    waivedRequirementIds: waived,
    canonical: (id) => aliases[id] ?? id,
    aliases,
    courseDetails,
  });
  lastDistArgs = args;
  if (!sameProgress(next, lastDistResult)) lastDistResult = next;
  return lastDistResult;
}

export function useRequirementProgress(): RequirementProgress {
  const { placements, placedCourses, waivedRequirementIds, planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  // The LOADED plan's program, not the selection (fix pass P6): waivers and
  // requirements must match the plan on screen during a slow major switch.
  const programId = planProgramId ?? selectedProgramId;
  // Cached by ProgramProvider — every caller shares one program doc (and the
  // same slots array), which is what keeps the module cache hitting.
  const { slots: templateSlots, layers, layerErrors, loading: programLoading } = useProgramData(programId);
  const { programs, loading: programsLoading } = usePrograms();
  const { creditProfile, studentContext } = useAuth();
  const { aliases, courseDetails, ensureCourseDetails } = useCatalogContext();

  // Spec 019 D3 — the program's family picks the engine.
  const program = useMemo(() => programs.find((p) => p.id === programId), [programs, programId]);
  const family = programFamily(program);
  const distFamily = isDistributionFamily(family) ? family : null;
  const programStatus = program?.status === "hidden" ? "hidden" : "visible";

  // Full docs for the placed courses (≤ ~80 ids, deduped + session-cached in
  // CatalogProvider — never a catalog scan).
  const placedIds = useMemo(() => [...new Set(placements.map((p) => p.courseId))], [placements]);
  useEffect(() => {
    if (placedIds.length > 0) ensureCourseDetails(placedIds);
  }, [placedIds, ensureCourseDetails]);

  const credits = creditProfile.length > 0 ? creditProfile : NO_CREDITS;
  const waived = waivedRequirementIds.length > 0 ? waivedRequirementIds : NO_WAIVERS;

  const engineering = useMemo(
    () =>
      distFamily
        ? null
        : cachedProgress([
            templateSlots,
            placements,
            placedCourses,
            courseDetails,
            credits,
            waived,
            aliases,
          ] as const),
    [distFamily, templateSlots, placements, placedCourses, courseDetails, credits, waived, aliases]
  );

  // Distribution programs: a solve usually takes a few ms, but a hard board
  // can take ~0.7 s (spec 019 deviation 9). Its inputs go through
  // useDeferredValue so a drag commits at once and the solve runs in the
  // low-priority render that follows; the panel and cards keep the previous
  // result until it lands.
  const distArgs = useMemo<DistArgs | null>(
    () =>
      distFamily && programId
        ? [
            programId,
            distFamily,
            programStatus,
            // Loaded → its valid layers ([] when it has none: selectLayers
            // reports what's missing). Still loading → undefined (no rows yet).
            programLoading ? undefined : (layers ?? NO_LAYERS),
            layerErrors,
            studentContext.entryTerm,
            studentContext.transfer,
            studentContext.transferStanding,
            studentContext.concentration,
            placements,
            placedCourses,
            courseDetails,
            credits,
            waived,
            aliases,
          ]
        : null,
    [
      distFamily,
      programId,
      programStatus,
      programLoading,
      layers,
      layerErrors,
      studentContext.entryTerm,
      studentContext.transfer,
      studentContext.transferStanding,
      studentContext.concentration,
      placements,
      placedCourses,
      courseDetails,
      credits,
      waived,
      aliases,
    ]
  );
  const deferredDistArgs = useDeferredValue(distArgs);
  const distribution = useMemo(
    () => (deferredDistArgs ? cachedDistributionProgress(deferredDistArgs) : null),
    [deferredDistArgs]
  );

  // Until the program list lands the family is unknown: a CAS/CALS plan
  // would otherwise flash the Engineering path's "no major requirements"
  // (review: cold load). The panel reads this as "Loading requirements…".
  if (programId && !program && programsLoading) return DIST_PENDING;
  // A hidden major (index status, D11) a student is already on: its
  // requirements are being reviewed, whichever engine it runs on.
  if (programStatus === "hidden") return UNDER_REVIEW;
  if (engineering) return engineering;
  return distribution ?? DIST_PENDING;
}

const UNDER_REVIEW: RequirementProgress = { ...EMPTY, notice: { kind: "under-review" } };

const NO_LAYERS: Layer[] = [];
