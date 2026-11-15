import { useDeferredValue, useEffect, useMemo } from "react";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { AdditionalProgram, CatalogIndexRecord, CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { Requirement } from "@/lib/planner/satisfies";
import type { FactValue, Layer, MarkValue, SharingLimit } from "@/lib/planner/distribution/types";
import type { StudentPrefs } from "@/services/profile";
import { usePlan } from "@/hooks/usePlan";
import { useProgramData } from "@/hooks/useProgramData";
import { usePrograms } from "@/hooks/usePrograms";
import { useAdditionalProgramData, type LoadedProgram } from "@/hooks/useAdditionalProgramData";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { enrichSelectedCourses } from "@/lib/planner/enrichCourses";
import { computeRequirementProgress, sameProgress } from "@/lib/planner/requirementProgress";
import { computeDistributionProgress } from "@/lib/planner/distributionProgress";
import { isDistributionFamily, programFamily } from "@/lib/planner/colleges";
import {
  catalogTriedLookup,
  computeTriedProgress,
  sameTried,
} from "@/lib/planner/triedProgress";

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
 *
 * Spec 028: credit comes from useCreditProfile().resolved (exam entries
 * resolved for the student's college), and `tried` (D11) is the same engine
 * re-run with the plan's tried classes added after the last semester
 * (lib/planner/triedProgress.ts). The real groups / attribution never see
 * tried classes.
 *
 * Spec 037: the Engineering path also passes the student's entry term and
 * entering year (the liberal studies rules and the placements' terms) and the
 * class index's roster tags (credit courses granting a real catalog course).
 *
 * Spec 047: the plan's second major and minors (useAdditionalProgramData) are
 * engine inputs on both paths (their layers join the solve; overlap limits
 * re-solve), and so are the plan's countsFor marks (inside the course marks).
 * The result gains sections, overlap, held-back notes and fill candidates;
 * this hook adds what only it knows: fill candidates minus tried classes,
 * `triedOnlyFor` from the tried rerun, and `liveLayerIds` / `allLayersLoaded`
 * for D10's orphan pruning.
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
  /** Spec 028 D7: the credits counted here, named ("AP Calculus BC (5)",
   *  "Transfer: MATH 1920"), so a row never says only "Your credit". */
  creditLabels?: string[];
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
  layerKind: "college" | "major" | "concentration" | "minor";
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
  /** Distribution rows: one chip per category, in authored order. `codes`:
   *  the display codes of the counted courses filling it (board order). */
  categories?: { id: string; label: string; filled: boolean; missing: boolean; codes?: string[] }[];
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
  /** Spec 020: open questions whose "yes" would improve this row. */
  questions?: RowQuestionInfo[];
  /** Spec 020: answers this row is counted with ("Counted because you said …"). */
  answered?: RowAnswerInfo[];
  /** Spec 037 D8: this row needs a start answer to be checked in full (the
   *  Engineering liberal studies row while the entry term is unknown); the
   *  row is still shown, with `note` saying what's left out. */
  notice?: RequirementNotice;
};

/** Spec 020 — one open question on a row. `scope` says where the answer is
 *  stored: "mark" on the plan (setCourseMark), "fact" on the profile
 *  (setStudentAnswer). */
export type RowQuestionInfo = {
  key: string;
  scope: "mark" | "fact";
  prompt: string;
  detail: string;
  input: { kind: "yesno" } | { kind: "credits"; values: number[] };
  /** "ENGL 2880" (course questions). */
  courseCode?: string;
};

/** Spec 020 — an answer a row is counted with. */
export type RowAnswerInfo = { key: string; scope: "mark" | "fact"; line: string };

/** Spec 020 — one stored answer, for the "Your answers" list. `hidden`: the
 *  mark's course is off the board; `notAsked`: no current layer asks it. */
export type AnswerListEntry = {
  key: string;
  scope: "mark" | "fact";
  prompt: string;
  valueLabel: string;
  value: MarkValue;
  input: RowQuestionInfo["input"];
  state: "active" | "hidden" | "notAsked";
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
  /** Spec 047: the ProgramSection this group belongs to (its `id`). Absent on
   *  a plan with no extra programs, and from engines that don't set it yet. */
  sectionId?: string;
};

// ─── Spec 047: several programs on one plan ─────────────────────────────────

/** Which program a section is. */
export type ProgramSectionKind = "college" | "primary" | "secondMajor" | "minor";
/** `--program-1..4` (lib/planner/programColors.ts); the primary and the college have none. */
export type ProgramColor = 1 | 2 | 3 | 4;
/** One program's slice of the requirements (a page section, a rail group, a stack segment). */
export type ProgramSection = {
  /** The programId, or the college layer id. */
  id: string;
  kind: ProgramSectionKind;
  /** "Mathematics, B.A." / "Computer Science" / "Arts & Sciences". */
  name: string;
  /** "Mathematics" / "CS minor". */
  shortName: string;
  color: ProgramColor | null;
  /** 0–100. */
  pct: number;
  satisfiedCount: number;
  total: number;
  status: "ok" | "loading" | "unavailable";
};
/** A course an overlap limit keeps from counting for one program (spec 047 D7/D8). */
export type HeldBack = {
  courseId: string;
  /** The board placement, or null for a course that isn't placed (credit, tried). */
  placementId: string | null;
  /** The section (programId) it still counts for. */
  countsFor: string;
  /** The section (programId) it was held back from. */
  heldFrom: string;
};
/** Two programs whose shared courses a limit caps (spec 047 D7). */
export type OverlapPair = {
  /** Section ids (programIds); `a` is the earlier program. */
  a: string;
  b: string;
  limit: SharingLimit | "forbidden";
  /** The programId whose `sharing` set the binding (stricter) limit; for a
   *  "forbidden" pair, the side whose rule forbids it. The engine always sets
   *  it; optional only so hand-built fixtures may leave it out. */
  limitFrom?: string;
  /** Courses counting for both, after enforcement. */
  sharedCourseIds: string[];
  heldBack: HeldBack[];
  /** The greedy fallback was used (D7): progress may be understated, never overstated. */
  estimated: boolean;
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
  /** Spec 020: open questions across all rows (the panel header count). */
  openQuestionCount?: number;
  /** Spec 020: every stored mark on this plan and every stored fact. */
  answers?: AnswerListEntry[];
  /** Spec 020 D6: the college layer selectLayers chose (its id, e.g.
   *  "cals-college-pre2025"), so a share can record the rule set. */
  collegeLayerId?: string;
  /** Spec 028 D7: credit entry id → labels of the requirements its courses
   *  count toward (the Credit before Cornell section). */
  creditFills?: Record<string, string[]>;
  /** Spec 045 D6 (Distribution engine): credit before Cornell, total and how
   *  much the college's degree-total row counts after its cap. Absent with no
   *  credit, or on the Engineering engine. */
  creditCount?: { counted: number; total: number };
  /** Spec 028 D11: the same requirements solved with the plan's tried classes
   *  added. Absent when nothing is being tried. Major Match never sees it. */
  tried?: TriedProgress;
  // ── Spec 047 (extra programs). Top-level pct / satisfiedCount / total keep
  //    meaning the primary degree (D14); `attribution` keeps its labels,
  //    primary first, so existing readers don't change. All absent until the
  //    engine fills them. ──
  /** College, primary, then the additional programs in plan order. */
  sections?: ProgramSection[];
  /** Only pairs that have a limit. */
  overlap?: OverlapPair[];
  /** placementId → each label it counts toward, with the section it belongs to. */
  attributionDetail?: Record<string, { label: string; sectionId: string }[]>;
  /** placementId → the limits holding that course back. */
  heldBackByPlacement?: Record<string, HeldBack[]>;
  /** programId → D3 course ids (unmet seat rows, earliest-needed first, minus placed and tried). */
  fillCandidates?: Record<string, string[]>;
  /** programId → tried course ids counting only toward it (D10). */
  triedOnlyFor?: Record<string, string[]>;
  /** Every loaded layer id across all programs (D10 orphan pruning). */
  liveLayerIds?: string[];
  /** True when every program's layers loaded; pruning runs only then (D10). */
  allLayersLoaded?: boolean;
};

/** Spec 028 D11/D13 — "if you take what you're trying". */
export type TriedProgress = {
  /** The plan's tried course ids, in order. */
  courseIds: string[];
  /** Tried course ids that are NOT on the board (the rail reminder). */
  notOnBoard: string[];
  /** requirement item id → the item recomputed with tried classes added.
   *  Same ids as `groups[*].items[*].id`. */
  items: Record<string, RequirementItem>;
  /** tried course id → labels of the requirements it would count toward. */
  fills: Record<string, string[]>;
  /** Tried course ids no longer in the catalog (shown "no longer offered"). */
  missing: string[];
  /** Spec 047 D10: programId → tried ids (not on the board) that count only
   *  toward that extra program. Lifted to RequirementProgress.triedOnlyFor. */
  onlyFor?: Record<string, string[]>;
};

const EMPTY: RequirementProgress = { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
/** A Distribution program not solved yet (first render, or the deferred
 *  inputs still catching up after an engine switch). */
const DIST_PENDING: RequirementProgress = { ...EMPTY, engine: "distribution" };
const NO_CREDITS: CreditEntry[] = [];
const NO_WAIVERS: string[] = [];
const NO_MARKS: Record<string, MarkValue> = {};
const NO_FACTS: Record<string, FactValue> = {};

/** Spec 020 seam: lane 2a adds `studentContext.answers` and the plan's
 *  `courseMarks`; read both defensively so this works before and after. */
export function useStudentAnswers(): { marks: Record<string, MarkValue>; facts: Record<string, FactValue> } {
  const plan = usePlan();
  const { studentContext } = useAuth();
  const facts = studentContext.answers;
  const marks = plan.courseMarks;
  return useMemo(
    () => ({
      marks: marks && Object.keys(marks).length > 0 ? marks : NO_MARKS,
      facts: facts && Object.keys(facts).length > 0 ? facts : NO_FACTS,
    }),
    [marks, facts]
  );
}

// ── Module-level single-entry caches (shared across every hook instance) ──
type CacheArgs = readonly [
  ProgramSlotWithData[],
  Placement[],
  Record<string, Course>,
  Record<string, Course>,
  CreditEntry[],
  string[],
  Record<string, string>,
  // Spec 037: entry term, entering year, catalog roster tags by id.
  string | null,
  number | null,
  (id: string) => readonly string[] | undefined,
  // The plan's course marks (chosen credits on variable-credit courses).
  Record<string, MarkValue>,
  // Spec 047: the plan's program id and names, its extra programs, the
  // student's facts (the extra programs' questions), the index's unlocks.
  string,
  string,
  string,
  LoadedProgram[],
  Record<string, FactValue>,
  (id: string) => readonly string[] | undefined,
];
let lastArgs: CacheArgs | null = null;
let lastResult: RequirementProgress = EMPTY;

/** The Engineering engine on `args`, optionally on another board (the tried
 *  path adds virtual placements; everything else is the same input). */
function solveEngineering(
  args: CacheArgs,
  placements: Placement[] = args[1],
  placedCourses: Record<string, Course> = args[2]
): RequirementProgress {
  const [
    templateSlots,
    ,
    ,
    courseDetails,
    creditProfile,
    waived,
    aliases,
    entryTerm,
    enteringYear,
    catalogAttrs,
    courseMarks,
    programId,
    programName,
    programShortName,
    extraPrograms,
    facts,
    unlocks,
  ] = args;
  return templateSlots.length === 0
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
        entryTerm,
        enteringYear,
        catalogAttrs,
        courseMarks,
        ...(extraPrograms.length > 0
          ? {
              programId,
              extraPrograms,
              primaryName: { name: programName, shortName: programShortName },
              facts,
              unlocks,
            }
          : {}),
      });
}

function cachedProgress(args: CacheArgs): RequirementProgress {
  if (lastArgs && args.every((a, i) => a === lastArgs![i])) return lastResult;
  const next = solveEngineering(args);
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
  marks: Record<string, MarkValue>,
  facts: Record<string, FactValue>,
  programNames: Record<string, string>,
  // Spec 047: the plan's extra programs, the primary's names, the index's unlocks.
  extraPrograms: LoadedProgram[],
  programName: string,
  programShortName: string,
  unlocks: (id: string) => readonly string[] | undefined,
];
let lastDistArgs: DistArgs | null = null;
let lastDistResult: RequirementProgress = DIST_PENDING;

/** The Distribution engine on `args`, optionally on another board (the
 *  tried path adds virtual placements; everything else is the same input).
 *  `skipOpenQuestions`: the tried solve's questions are never shown, so it
 *  skips their extra solves. */
function solveDistribution(
  args: DistArgs,
  boardPlacements: Placement[] = args[9],
  boardCourses: Record<string, Course> = args[10],
  skipOpenQuestions = false
): RequirementProgress {
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
    ,
    ,
    courseDetails,
    creditProfile,
    waived,
    aliases,
    marks,
    facts,
    programNames,
    extraPrograms,
    programName,
    programShortName,
    unlocks,
  ] = args;
  return computeDistributionProgress({
    layers,
    layerErrors,
    programId,
    family,
    programStatus,
    ctx: { entryTerm, transfer, transferStanding, concentration },
    placements: boardPlacements,
    // Tag rules (ALC-AS, …) read the full docs' attrs.
    placedCourses: enrichSelectedCourses(boardCourses, courseDetails),
    creditProfile,
    waivedRequirementIds: waived,
    canonical: (id) => aliases[id] ?? id,
    aliases,
    courseDetails,
    // Spec 020 D4: answers are engine inputs (marks from this plan, facts
    // from the profile).
    answers: { marks, facts },
    programNames,
    ...(skipOpenQuestions ? { skipOpenQuestions: true } : {}),
    ...(extraPrograms.length > 0
      ? { extraPrograms, primaryName: { name: programName, shortName: programShortName }, unlocks }
      : {}),
  });
}

function cachedDistributionProgress(args: DistArgs): RequirementProgress {
  if (lastDistArgs && args.every((a, i) => a === lastDistArgs![i])) return lastDistResult;
  const next = solveDistribution(args);
  lastDistArgs = args;
  if (!sameProgress(next, lastDistResult)) lastDistResult = next;
  return lastDistResult;
}

// ── Spec 028 D11: tried classes ─────────────────────────────────────────────
/** What the tried result depends on beyond the engine's own inputs. */
type TriedArgs = readonly [
  triedCourseIds: string[],
  index: CatalogIndexRecord[],
  indexReady: boolean,
];

/** id → index record, built once per loaded index (shared by every caller). */
let lastIndex: CatalogIndexRecord[] | null = null;
let lastIndexById: ReadonlyMap<string, CatalogIndexRecord> = new Map();
function indexById(index: CatalogIndexRecord[]): ReadonlyMap<string, CatalogIndexRecord> {
  if (index !== lastIndex) {
    lastIndex = index;
    lastIndexById = new Map(index.map((r) => [r.id, r]));
  }
  return lastIndexById;
}

/** Roster tags by course id from the loaded index, one function per index
 *  (a stable cache key for every hook instance). */
let lastAttrsIndex: CatalogIndexRecord[] | null = null;
let lastAttrsLookup: (id: string) => readonly string[] | undefined = () => undefined;
function catalogAttrsLookup(index: CatalogIndexRecord[]): (id: string) => readonly string[] | undefined {
  if (index !== lastAttrsIndex) {
    lastAttrsIndex = index;
    const byId = indexById(index);
    lastAttrsLookup = (id) => byId.get(id)?.attrs;
  }
  return lastAttrsLookup;
}

/** One single-entry cache per engine: the key is the engine's args, the real
 *  result they produced, and the tried args, compared element by element
 *  (every hook instance builds its own tuples around shared values). The
 *  result keeps its identity while it is structurally unchanged. */
type TriedCache = { key: readonly unknown[] | null; result: TriedProgress | undefined };
const engineeringTried: TriedCache = { key: null, result: undefined };
const distributionTried: TriedCache = { key: null, result: undefined };

function cachedTried(
  cache: TriedCache,
  engineArgs: readonly unknown[],
  base: RequirementProgress,
  tried: TriedArgs,
  compute: () => TriedProgress | undefined
): TriedProgress | undefined {
  const key = [...engineArgs, base, ...tried];
  if (cache.key && cache.key.length === key.length && key.every((a, i) => a === cache.key![i])) {
    return cache.result;
  }
  const next = compute();
  cache.key = key;
  if (!sameTried(next, cache.result)) cache.result = next;
  return cache.result;
}

function triedFor(
  base: RequirementProgress,
  tried: TriedArgs,
  board: { placements: Placement[]; placedCourses: Record<string, Course>; courseDetails: Record<string, Course>; aliases: Record<string, string> },
  solve: (placements: Placement[], placedCourses: Record<string, Course>) => RequirementProgress
): TriedProgress | undefined {
  const [triedCourseIds, index, indexReady] = tried;
  // Nothing to show against: a notice, or requirements still loading.
  if (triedCourseIds.length === 0 || base.groups.length === 0) return undefined;
  return computeTriedProgress({
    triedCourseIds,
    placements: board.placements,
    placedCourses: board.placedCourses,
    base,
    canonical: (id) => board.aliases[id] ?? id,
    lookup: catalogTriedLookup(indexById(index), board.courseDetails, indexReady),
    solve,
  });
}

/** `base` with `tried` attached, one object per (base, tried) pair so the
 *  returned progress keeps its identity while neither changes. */
let lastCombinedBase: RequirementProgress | null = null;
let lastCombinedTried: TriedProgress | undefined;
let lastCombined: RequirementProgress | null = null;
function withTried(base: RequirementProgress, tried: TriedProgress | undefined): RequirementProgress {
  if (!tried) return base;
  if (lastCombined && lastCombinedBase === base && lastCombinedTried === tried) return lastCombined;
  lastCombinedBase = base;
  lastCombinedTried = tried;
  lastCombined = { ...base, tried };
  return lastCombined;
}

/** The resolved credit list with a stable identity across hook instances
 *  (each caller's useCreditProfile memo is its own; the module caches above
 *  compare by identity, so equal lists must share one array). */
let lastCreditsIn: CreditEntry[] | null = null;
let lastCreditsOut: CreditEntry[] = NO_CREDITS;
function stableCredits(resolved: CreditEntry[]): CreditEntry[] {
  if (resolved.length === 0) return NO_CREDITS;
  if (resolved === lastCreditsIn) return lastCreditsOut;
  lastCreditsIn = resolved;
  if (JSON.stringify(resolved) !== JSON.stringify(lastCreditsOut)) lastCreditsOut = resolved;
  return lastCreditsOut;
}

const NO_TRIED: string[] = [];
const NO_ADDITIONAL: AdditionalProgram[] = [];
const NO_EXTRAS: LoadedProgram[] = [];

/** The loaded extra programs with one identity across hook instances (each
 *  caller's useAdditionalProgramData memo is its own; the module caches
 *  compare by identity, so equal lists must share one array, or every course
 *  card would re-solve). Equal: same programs, statuses, names, sharing and
 *  the very same layer objects. */
let lastExtras: LoadedProgram[] = NO_EXTRAS;
function sameLoaded(a: LoadedProgram, b: LoadedProgram): boolean {
  return (
    a.programId === b.programId &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.name === b.name &&
    a.shortName === b.shortName &&
    JSON.stringify(a.sharing ?? null) === JSON.stringify(b.sharing ?? null) &&
    a.layers.length === b.layers.length &&
    a.layers.every((l, i) => l === b.layers[i])
  );
}
export function stableExtras(programs: LoadedProgram[]): LoadedProgram[] {
  if (programs.length === 0) return NO_EXTRAS;
  if (programs === lastExtras) return lastExtras;
  if (programs.length === lastExtras.length && programs.every((p, i) => sameLoaded(p, lastExtras[i]))) {
    return lastExtras;
  }
  lastExtras = programs;
  return lastExtras;
}

/** Spec 047 D3: the index's `unlocks` by course id, one function per index. */
let lastUnlocksIndex: CatalogIndexRecord[] | null = null;
let lastUnlocksLookup: (id: string) => readonly string[] | undefined = () => undefined;
function unlocksLookup(index: CatalogIndexRecord[]): (id: string) => readonly string[] | undefined {
  if (index !== lastUnlocksIndex) {
    lastUnlocksIndex = index;
    const byId = indexById(index);
    lastUnlocksLookup = (id) => byId.get(id)?.unlocks;
  }
  return lastUnlocksLookup;
}

/** What the hook adds to an engine's result (spec 047). */
type DecorateArgs = readonly [
  progress: RequirementProgress,
  tried: string[],
  aliases: Record<string, string>,
  primaryLayers: Layer[] | undefined,
  primaryLayerErrors: string[] | undefined,
  primaryLoaded: boolean,
  extras: LoadedProgram[],
  extrasLoaded: boolean,
];
let lastDecorateArgs: DecorateArgs | null = null;
let lastDecorated: RequirementProgress | null = null;

/**
 * Spec 047 — the result with:
 *  - `fillCandidates` minus the plan's tried classes (D3: never suggest a
 *    class the student is already trying);
 *  - `triedOnlyFor` lifted from the tried rerun (D10);
 *  - `liveLayerIds`: every loaded layer id — all the primary program's layers
 *    (college versions, major, concentrations) and every extra program's —
 *    and `allLayersLoaded`, false while anything is loading, missing or
 *    unavailable (D10: orphan pruning runs only then).
 * Keeps identity while its inputs do.
 */
export function decorateProgress(args: DecorateArgs): RequirementProgress {
  if (lastDecorateArgs && lastDecorated && args.every((a, i) => a === lastDecorateArgs![i])) return lastDecorated;
  const [progress, tried, aliases, primaryLayers, primaryLayerErrors, primaryLoaded, extras, extrasLoaded] = args;
  const live = new Set<string>();
  for (const l of primaryLayers ?? []) live.add(l.id);
  for (const p of extras) for (const l of p.layers) live.add(l.id);
  const allLayersLoaded =
    primaryLoaded &&
    (primaryLayerErrors ?? []).length === 0 &&
    extrasLoaded &&
    extras.every((p) => p.status === "ok");
  let fillCandidates = progress.fillCandidates;
  if (fillCandidates && tried.length > 0) {
    const canon = (id: string) => aliases[id] ?? id;
    const trying = new Set(tried.map(canon));
    fillCandidates = Object.fromEntries(
      Object.entries(fillCandidates).map(([id, list]) => [id, list.filter((c) => !trying.has(canon(c)))])
    );
  }
  const onlyFor = progress.tried?.onlyFor;
  const next: RequirementProgress = {
    ...progress,
    ...(fillCandidates ? { fillCandidates } : {}),
    ...(onlyFor ? { triedOnlyFor: onlyFor } : {}),
    liveLayerIds: [...live],
    allLayersLoaded,
  };
  lastDecorateArgs = args;
  lastDecorated = lastDecorated && sameProgress(next, lastDecorated) ? lastDecorated : next;
  return lastDecorated;
}

export function useRequirementProgress(): RequirementProgress {
  const { placements, placedCourses, waivedRequirementIds, planProgramId, triedCourseIds, additionalPrograms } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  // The LOADED plan's program, not the selection (fix pass P6): waivers and
  // requirements must match the plan on screen during a slow major switch.
  const programId = planProgramId ?? selectedProgramId;
  // Cached by ProgramProvider — every caller shares one program doc (and the
  // same slots array), which is what keeps the module cache hitting.
  const { slots: templateSlots, layers, layerErrors, loading: programLoading } = useProgramData(programId);
  const { programs, loading: programsLoading } = usePrograms();
  const { studentContext, enteringYear } = useAuth();
  // Spec 028 D3: credit resolved for the student's college (exam entries
  // carry what their score earns there), never the raw saved list.
  const { resolved: resolvedCredits } = useCreditProfile();
  const {
    aliases,
    courseDetails,
    ensureCourseDetails,
    index,
    loading: catalogLoading,
    error: catalogError,
  } = useCatalogContext();
  const { marks, facts } = useStudentAnswers();
  // Spec 047: the plan's second major and minors (keyed on content inside).
  const loaded = useAdditionalProgramData(additionalPrograms ?? NO_ADDITIONAL);
  const extras = stableExtras(loaded.programs);
  const extrasLoaded = loaded.allLoaded;

  // Spec 019 D3 — the program's family picks the engine.
  const program = useMemo(() => programs.find((p) => p.id === programId), [programs, programId]);
  // Names for fact questions about another program (spec 020 studentFact).
  const programNames = useMemo(() => Object.fromEntries(programs.map((p) => [p.id, p.name])), [programs]);
  const family = programFamily(program);
  const distFamily = isDistributionFamily(family) ? family : null;
  const programStatus = program?.status === "hidden" ? "hidden" : "visible";
  const programName = program?.name ?? programId ?? "";
  const programShortName = program?.short_name ?? programName;
  const unlocks = unlocksLookup(index);

  // Full docs for the placed courses (≤ ~80 ids, deduped + session-cached in
  // CatalogProvider — never a catalog scan).
  // Tried classes too (≤ 20): their tag rules and credits need the same docs.
  const tried = triedCourseIds && triedCourseIds.length > 0 ? triedCourseIds : NO_TRIED;
  const placedIds = useMemo(
    () => [...new Set([...placements.map((p) => p.courseId), ...tried])],
    [placements, tried]
  );
  useEffect(() => {
    if (placedIds.length > 0) ensureCourseDetails(placedIds);
  }, [placedIds, ensureCourseDetails]);

  const credits = stableCredits(resolvedCredits);
  const waived = waivedRequirementIds.length > 0 ? waivedRequirementIds : NO_WAIVERS;

  // The index is "ready" (an absent id means "no longer offered") once it
  // loaded without error; until then an unknown tried id is just pending.
  const indexReady = !catalogLoading && !catalogError && index.length > 0;
  const triedArgs = useMemo<TriedArgs>(() => [tried, index, indexReady], [tried, index, indexReady]);

  const engineering = useMemo(() => {
    if (distFamily) return null;
    const args: CacheArgs = [
      templateSlots,
      placements,
      placedCourses,
      courseDetails,
      credits,
      waived,
      aliases,
      studentContext.entryTerm,
      enteringYear,
      catalogAttrsLookup(index),
      marks,
      programId ?? "",
      programName,
      programShortName,
      extras,
      facts,
      unlocks,
    ];
    const base = cachedProgress(args);
    const t = cachedTried(engineeringTried, args, base, triedArgs, () =>
      triedFor(base, triedArgs, { placements, placedCourses, courseDetails, aliases }, (pl, pc) =>
        solveEngineering(args, pl, pc)
      )
    );
    return withTried(base, t);
  }, [
    distFamily,
    templateSlots,
    placements,
    placedCourses,
    courseDetails,
    credits,
    waived,
    aliases,
    studentContext.entryTerm,
    enteringYear,
    index,
    triedArgs,
    marks,
    programId,
    programName,
    programShortName,
    extras,
    facts,
    unlocks,
  ]);

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
            marks,
            facts,
            programNames,
            extras,
            programName,
            programShortName,
            unlocks,
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
      marks,
      facts,
      programNames,
      extras,
      programName,
      programShortName,
      unlocks,
    ]
  );
  const deferredDistArgs = useDeferredValue(distArgs);
  // The tried solve is a second solve: deferred with the first.
  const deferredTriedArgs = useDeferredValue(triedArgs);
  const distribution = useMemo(() => {
    if (!deferredDistArgs) return null;
    const args = deferredDistArgs;
    const base = cachedDistributionProgress(args);
    const t = cachedTried(distributionTried, args, base, deferredTriedArgs, () =>
      triedFor(
        base,
        deferredTriedArgs,
        { placements: args[9], placedCourses: args[10], courseDetails: args[11], aliases: args[14] },
        (pl, pc) => solveDistribution(args, pl, pc, true)
      )
    );
    return withTried(base, t);
  }, [deferredDistArgs, deferredTriedArgs]);

  // Until the program list lands the family is unknown: a CAS/CALS plan
  // would otherwise flash the Engineering path's "no major requirements"
  // (review: cold load). The panel reads this as "Loading requirements…".
  const out =
    programId && !program && programsLoading
      ? DIST_PENDING
      : // A hidden major (index status, D11) a student is already on: its
        // requirements are being reviewed, whichever engine it runs on.
        programStatus === "hidden"
        ? UNDER_REVIEW
        : (engineering ?? distribution ?? DIST_PENDING);
  // Spec 047: a result still waiting on its engine (pending, or the deferred
  // solve catching up) can't vouch that every layer is loaded.
  const solved = out !== DIST_PENDING && !(distFamily && deferredDistArgs !== distArgs);
  return decorateProgress([
    out,
    tried,
    aliases,
    distFamily ? layers : NO_LAYERS,
    distFamily ? layerErrors : undefined,
    solved && !programLoading && (!distFamily || layers != null),
    extras,
    extrasLoaded,
  ]);
}

const UNDER_REVIEW: RequirementProgress = { ...EMPTY, notice: { kind: "under-review" } };

const NO_LAYERS: Layer[] = [];
