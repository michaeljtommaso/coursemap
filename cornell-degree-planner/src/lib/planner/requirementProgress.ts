import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { MarkValue } from "./distribution/types";
import { assign, programToRequirements, type RequirementInstance } from "./majorMatch";
import { buildMatchPool, programSlotsToMatchInput, type PoolCreditEntry } from "./matchAdapters";
import { columnKey, refOf } from "./terms";
import { creditEntryByCourse, creditEntryLabel, pushUnique } from "./creditPool";
import { SLOT_CATEGORIES, groupIsLiberal } from "./slotCategory";
import { enteringYearForEntryTerm } from "./entryTerm";
import {
  applyLiberalStudies,
  liberalStudiesCohort,
  liberalStudiesGroups,
  liberalStudiesRules,
  type LiberalStudiesOutcome,
} from "./liberalStudies";
import type {
  DistributionItemInfo,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  RequirementStatus,
} from "@/hooks/useRequirementProgress";

/**
 * requirementProgress.ts (spec 014 D1/D2) — the PURE core behind
 * useRequirementProgress: the current program's requirements, attributed to
 * the courses on the board by majorMatch.assign (position-independent).
 *
 *   requirements = programToRequirements(programSlotsToMatchInput(templateSlots))
 *                  — one seat per course/pattern/attribute slot, one credit
 *                  pool per DISTINCT elective group (several elective slots of
 *                  one group collapse into that one pool).
 *   courses      = every placement's course (board order, a retake counted
 *                  once) + the credit profile's synthetic courses.
 *
 * Credit is named where it counts (spec 028 D7): an item counted by a credit
 * course carries that entry's label in `creditLabels`, and `creditFills` maps
 * each credit entry id to the requirements its courses count toward.
 *
 * Liberal studies (spec 037): after the matcher, the liberal studies pool is
 * judged by its group rules (applyLiberalStudies — which courses count, and
 * the swap with advisor-approved seats), and its item carries `dist` like a
 * CAS distribution row: one chip per group, courses, credits and groups
 * counted. The rules follow the student's entry term, else entering year;
 * with neither, the item says so and leaves Group 7's minimum out (D8).
 *
 * Waived requirements are taken OUT of the assignment before it runs, so a
 * course is never consumed by a requirement the student waived — it stays free
 * to fill another one. Waived items still appear (status "waived").
 *
 * Output shape is the useRequirementProgress contract (types live there).
 */

export type RequirementProgressInput = {
  /** The current program's template slots (useBoard().templateSlots). */
  templateSlots: ProgramSlotWithData[];
  placements: Placement[];
  /** courseId → course (enriched when available, so attribute seats see attrs). */
  placedCourses: Record<string, Course>;
  /** Saved or resolved (useCreditProfile().resolved) credit entries. */
  creditProfile: PoolCreditEntry[];
  waivedRequirementIds: string[];
  /** Cross-listing canonicalizer (alias map); identity by default. */
  canonical?: (id: string) => string;
  /** Spec 037 D8: the student's entry term ("FA25") and entering year pick
   *  the liberal studies rules; the entering year (else the entry term's)
   *  also dates each placement for the petitions list. */
  entryTerm?: string | null;
  enteringYear?: number | null;
  /** Spec 037 D4: catalog roster tags by course id (the class index), so a
   *  credit course granting a real catalog course counts with its tags. */
  catalogAttrs?: (id: string) => readonly string[] | undefined;
  /** The plan's course marks: chosen credits on variable-credit courses. */
  courseMarks?: Readonly<Record<string, MarkValue>>;
};

/** Spec 037 D8: shown on the liberal studies row while the entering class is
 *  unknown (the same wording as the start-term notice). */
export const LIBERAL_STUDIES_NEEDS_ENTRY_NOTE =
  "Your college's requirements depend on when you started at Cornell. Add your start term to check Race & Equity.";
/** Spec 037 D2: an entrant before Fall 2020. */
export const LIBERAL_STUDIES_OLDER_POLICY_NOTE =
  "You started before Fall 2020, when an older liberal studies policy applied. This uses the Fall 2020 – Spring 2024 rules; check yours with your advisor.";

/** Group heading per category — the plural, list-heading form of
 *  CATEGORY_META's labels ("CS electives"-style headings read as a list). */
export const GROUP_LABELS: Record<SlotCategory | "other", string> = {
  math: "Math",
  science: "Science",
  core: "Engineering core",
  liberal: "Liberal studies",
  elective: "Electives",
  fws: "Writing seminars",
  pe: "Phys ed",
  other: "Other requirements",
};

const GROUP_ORDER: (SlotCategory | "other")[] = [...SLOT_CATEGORIES, "other"];

type ReqMeta = { category: SlotCategory | null; suggestedSem: number | null };

/** Category + suggested semester per requirement id. Seats read their own slot;
 *  a pool reads the first (earliest) elective slot of its group, falling back
 *  to liberal-vs-elective by the group itself when no slot carries a category. */
function requirementMeta(templateSlots: ProgramSlotWithData[]): Map<string, ReqMeta> {
  const meta = new Map<string, ReqMeta>();
  for (const s of templateSlots) {
    const sem = Number.isFinite(s.suggested_semester) ? s.suggested_semester : null;
    if (s.kind === "elective") {
      const gid = s.elective_group_id ?? s.elective_groups?.id;
      if (!gid) continue;
      const prev = meta.get(gid);
      const fallback: SlotCategory = groupIsLiberal({
        id: gid,
        qualifyingRule: s.elective_groups?.qualifying_rule as { type?: string; category?: string } | undefined,
      })
        ? "liberal"
        : "elective";
      const category = prev?.category ?? s.category ?? fallback;
      const suggestedSem =
        prev?.suggestedSem != null && sem != null
          ? Math.min(prev.suggestedSem, sem)
          : (prev?.suggestedSem ?? sem);
      meta.set(gid, { category, suggestedSem });
    } else {
      meta.set(s.id, { category: s.category ?? null, suggestedSem: sem });
    }
  }
  return meta;
}

function poolMinCredits(r: RequirementInstance): number {
  return r.kind === "pool" ? r.minCredits : r.credits;
}

/** The pure transformation (unit-tested). */
export function computeRequirementProgress(input: RequirementProgressInput): RequirementProgress {
  const {
    templateSlots,
    placements,
    placedCourses,
    creditProfile,
    waivedRequirementIds,
    canonical = (id: string) => id,
    entryTerm = null,
    enteringYear = null,
    catalogAttrs,
    courseMarks,
  } = input;

  const requirements = programToRequirements(programSlotsToMatchInput(templateSlots));
  if (requirements.length === 0) {
    return { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
  }

  const waived = new Set(waivedRequirementIds);
  const active = requirements.filter((r) => !waived.has(r.id));

  const { cohort, olderPolicy } = liberalStudiesCohort(entryTerm, enteringYear);
  const boardYear = enteringYear ?? enteringYearForEntryTerm(entryTerm);
  const pool = buildMatchPool({
    placements,
    placedCourses,
    creditProfile,
    ...(courseMarks ? { courseMarks } : {}),
    ...(boardYear != null ? { enteringYear: boardYear } : {}),
    ...(catalogAttrs ? { catalogAttrs } : {}),
  });
  const matcher = assign(pool, active, canonical, { liberalStudiesCohort: cohort });
  // Spec 037 D6/D7: the liberal studies pool judged by its group rules.
  const ls = applyLiberalStudies({
    courses: pool,
    requirements: active,
    assignment: matcher,
    canonical,
    cohort,
    olderPolicy,
  });
  const result = ls?.assignment ?? matcher;
  // canonical id → display code ("ECON 1110"), first wins.
  const codeOf = new Map<string, string>();
  for (const c of pool) {
    const cid = canonical(c.id);
    if (!codeOf.has(cid) && c.subject) codeOf.set(cid, `${c.subject} ${c.number}`.trim());
  }

  // canonical course id → the ONE placement that carries it into the pool:
  // board order (time — terms.ts columnKey, so a short term sorts before its
  // semester — then order), first wins — mirrors buildMatchPool's dedup, so a
  // course placed twice is attributed to its first placement only.
  const placementByCourse = new Map<string, string>();
  const ordered = placements
    .map((p, i) => ({ p, i, key: columnKey(refOf(p)) }))
    .sort((a, b) => a.key - b.key || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    const cid = canonical(p.courseId);
    if (!placementByCourse.has(cid)) placementByCourse.set(cid, p.id);
  }

  // requirement id → covering placement ids + counted credits + counted courses.
  const coveredBy = new Map<string, string[]>();
  const countedCredits = new Map<string, number>();
  const countedCourses = new Map<string, number>();
  // Spec 028 D7: credit courses (not on the board) → the entry carrying them.
  const creditByCourse = creditEntryByCourse(
    creditProfile,
    placements.map((p) => p.courseId),
    canonical
  );
  const creditLabels: Record<string, string[]> = {};
  const creditEntryIds: Record<string, string[]> = {};
  // The matcher lists every requirement still short (a pool short on courses OR
  // credits — spec 019 D6), so "missing" is the one source of "not yet met".
  const stillShort = new Set(result.missing.map((m) => m.requirementId));
  for (const m of result.matched) {
    countedCredits.set(m.requirementId, (countedCredits.get(m.requirementId) ?? 0) + m.credits);
    countedCourses.set(m.requirementId, (countedCourses.get(m.requirementId) ?? 0) + 1);
    const pid = placementByCourse.get(m.courseId);
    if (!pid) {
      // Satisfied by credit (no placement on the board): name the entry.
      const entry = creditByCourse.get(m.courseId);
      if (entry) {
        pushUnique(creditLabels, m.requirementId, creditEntryLabel(entry));
        pushUnique(creditEntryIds, m.requirementId, entry.id);
      }
      continue;
    }
    const list = coveredBy.get(m.requirementId) ?? [];
    list.push(pid);
    coveredBy.set(m.requirementId, list);
  }

  const meta = requirementMeta(templateSlots);
  // list-rule group id → its explicit member courses (for the choice state).
  const listMembers = new Map<string, string[]>();
  for (const s of templateSlots) {
    const g = s.elective_groups;
    if (g && g.qualifying_rule?.type === "list" && g.course_ids && g.course_ids.length > 0) {
      listMembers.set(g.id, g.course_ids);
    }
  }
  const labelById = new Map(requirements.map((r) => [r.id, r.label]));

  const items: RequirementItem[] = requirements.map((r) => {
    const m = meta.get(r.id) ?? { category: null, suggestedSem: null };
    const lsHere = ls && ls.requirementId === r.id && !waived.has(r.id) ? ls : null;
    let status: RequirementStatus;
    if (waived.has(r.id)) {
      status = "waived";
    } else if (lsHere) {
      status = STATUS_OF_ROW[lsHere.row.status];
    } else {
      const courses = countedCourses.get(r.id) ?? 0;
      if (courses <= 0) status = "unmet";
      else if (stillShort.has(r.id)) status = "partial";
      else status = "satisfied";
    }
    return {
      id: r.id,
      label: r.label,
      category: m.category,
      suggestedSem: m.suggestedSem,
      status,
      coveredBy: status === "waived" ? [] : (coveredBy.get(r.id) ?? []),
      checkable: r.kind !== "pool" || r.computable,
      requirement: r.kind === "seat" ? r.req : null,
      ...(r.kind === "pool" && listMembers.has(r.id) ? { choiceCourseIds: listMembers.get(r.id) } : {}),
      ...(status !== "waived" && creditLabels[r.id] ? { creditLabels: creditLabels[r.id] } : {}),
      ...(lsHere ? { dist: liberalStudiesDist(lsHere, codeOf) } : {}),
      ...(r.kind === "pool" && r.computable && !lsHere
        ? {
            poolProgress: {
              courses: countedCourses.get(r.id) ?? 0,
              requiredCourses: r.requiredCourses,
              credits: countedCredits.get(r.id) ?? 0,
              requiredCredits: poolMinCredits(r),
            },
          }
        : {}),
    };
  });

  // Attribution: placement → labels of the requirements it counts toward.
  const attribution: Record<string, string[]> = {};
  for (const [reqId, pids] of coveredBy) {
    const label = labelById.get(reqId);
    if (!label) continue;
    for (const pid of pids) (attribution[pid] ??= []).push(label);
  }

  // Credit entry id → the requirements its courses count toward (D7).
  const creditFills: Record<string, string[]> = {};
  for (const [reqId, entryIds] of Object.entries(creditEntryIds)) {
    const label = labelById.get(reqId);
    if (!label || waived.has(reqId)) continue;
    for (const id of entryIds) pushUnique(creditFills, id, label);
  }

  // Group by category (stable taxonomy order), items by suggested sem then label.
  const byKey = new Map<string, RequirementItem[]>();
  for (const it of items) {
    const key = it.category ?? "other";
    const list = byKey.get(key) ?? [];
    list.push(it);
    byKey.set(key, list);
  }
  const isDone = (it: RequirementItem) => it.status === "satisfied" || it.status === "waived";
  const groups: RequirementGroup[] = [];
  for (const key of GROUP_ORDER) {
    const list = byKey.get(key);
    if (!list || list.length === 0) continue;
    list.sort(compareBySemester);
    groups.push({
      key,
      label: GROUP_LABELS[key],
      items: list,
      satisfiedCount: list.filter(isDone).length,
      total: list.length,
    });
  }

  return {
    groups,
    attribution,
    satisfiedCount: items.filter(isDone).length,
    total: items.length,
    ...(Object.keys(creditFills).length > 0 ? { creditFills } : {}),
  };
}

const STATUS_OF_ROW: Record<LiberalStudiesOutcome["row"]["status"], RequirementStatus> = {
  met: "satisfied",
  partial: "partial",
  unmet: "unmet",
};

/** The liberal studies item's `dist`, shaped like a CAS distribution row's
 *  (spec 037 D9): one chip per group, filled when a counted course is in it,
 *  missing (dashed) while the row still needs it. */
function liberalStudiesDist(ls: LiberalStudiesOutcome, codeOf: Map<string, string>): DistributionItemInfo {
  const { row } = ls;
  const have = new Set(row.categoriesHave);
  const missing = new Set(row.missingCategories);
  const rules = liberalStudiesRules(ls.cohort);
  const categoriesNeed = rules.minGroups;
  // A group with a required minimum (Race & Equity for Fall 2024 entrants) is
  // one of the groups the row needs: while it's unmet, the other groups count
  // toward the rest only, so six courses in three other groups read "2 of 3
  // groups". Rows without a minimum (2020–24, unknown entry) count plainly.
  const unmetRequired = ls.cohortUnknown
    ? []
    : Object.keys(rules.groupMinCredits).filter((g) => missing.has(g));
  const groupsCounted = row.categoriesHave.filter((g) => !unmetRequired.includes(g)).length;
  const categoriesHave = Math.min(groupsCounted, categoriesNeed - unmetRequired.length);
  // The detail line reads "18 of 18 credits · 3 of 3 groups" once a
  // figure is reached, never "6 of 3"; the chips still show every group filled.
  const creditsHave = row.creditsNeed > 0 ? Math.min(row.creditsHave, row.creditsNeed) : row.creditsHave;
  const notes = [
    ...(ls.cohortUnknown ? [LIBERAL_STUDIES_NEEDS_ENTRY_NOTE] : []),
    ...(ls.olderPolicy ? [LIBERAL_STUDIES_OLDER_POLICY_NOTE] : []),
  ];
  return {
    layerId: "engineering",
    rowId: "liberal-studies",
    layerKind: "college",
    rowKind: "distribution",
    engineStatus: row.status,
    coursesHave: row.coursesHave,
    coursesNeed: row.coursesNeed,
    creditsHave,
    creditsNeed: row.creditsNeed,
    categories: liberalStudiesGroups(ls.cohort).map((g) => ({
      id: g.id,
      label: g.label,
      filled: have.has(g.id),
      missing: missing.has(g.id),
    })),
    categoriesHave: Math.max(0, categoriesHave),
    categoriesNeed,
    countedCodes: row.counted.map((id) => codeOf.get(id) ?? id.replace(/-/g, " ")),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    ...(ls.cohortUnknown ? { notice: { kind: "needs-entry-term" as const } } : {}),
  };
}

/** Suggested semester ascending (unknown last), then label. */
export function compareBySemester(a: RequirementItem, b: RequirementItem): number {
  const sa = a.suggestedSem ?? Number.POSITIVE_INFINITY;
  const sb = b.suggestedSem ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.label.localeCompare(b.label);
}

/** The "By semester" view: every not-yet-done item (unmet + partial), flat, in
 *  suggested-semester order. */
export function itemsBySemester(progress: RequirementProgress): RequirementItem[] {
  return progress.groups
    .flatMap((g) => g.items)
    .filter((it) => it.status === "unmet" || it.status === "partial")
    .sort(compareBySemester);
}

/** Structural equality for the hook's reference-stability guard. */
export function sameProgress(a: RequirementProgress, b: RequirementProgress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Labels worth showing on a card: drops any requirement label that just
 *  repeats the card's own course code (a fixed course requirement like
 *  "MATH 1910" on the MATH 1910 card), so only informative attributions
 *  ("CS Major Elective") render. Cross-listing dashes/spacing are ignored. */
export function meaningfulAttribution(
  labels: readonly string[] | undefined,
  course: { subject: string; number: string } | null | undefined
): string[] {
  if (!labels || labels.length === 0) return [];
  if (!course) return [...labels];
  const norm = (s: string) => s.replace(/-/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const own = norm(`${course.subject} ${course.number}`);
  return labels.filter((l) => norm(l) !== own);
}
