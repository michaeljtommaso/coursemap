import { useCallback, useMemo } from "react";
import { patternToRegex } from "@/lib/planner/evaluatePrereq";
import {
  courseSatisfiesRequirement,
  evaluate,
  matchesAttribute,
  type AttributeMatch,
} from "@/lib/planner/satisfies";
import { programToRequirements, type RequirementInstance } from "@/lib/planner/majorMatch";
import { programSlotsToMatchInput } from "@/lib/planner/matchAdapters";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { PrereqExpr, ProgramSlotWithData, QualifyingRule } from "@/types/db";

/**
 * useCourseFilters (spec 006 §E3) — ONE filter model + a pure predicate over
 * catalogIndex records, shared by /classes and the catalog drawer. Filter axes:
 * subject, level (first digit of the number), credits, offered term, has-prereqs,
 * "prereqs met by" my taken / in-progress / planned courses (multi-select),
 * favorites, and "relevant to my major" (matches the selected program's open
 * pattern/elective requirements). The predicate is pure and unit-tested; the hook
 * supplies the data-derived context (favorites set + relevance closure).
 *
 * Data note: the `offered` axis needs `offered` on index records (added to the
 * catalogIndex chunk schema, populated by the roster-sync rebuild). Until the
 * rebuild lands, records carry no `offered` and the offered control hides
 * (hasOffered=false); the predicate then excludes nothing on that axis.
 */

/** A course's status on the student's own plan: marked complete (or covered by
 *  AP/transfer credit), in progress, or placed on the board but neither. */
export type PlanStatus = "taken" | "in-progress" | "planned";

/** The plan's courses grouped by status, as the ids and display codes the
 *  prerequisite evaluator reads. */
export type PlanPools = Record<PlanStatus, { ids: Set<string>; codes: Set<string> }>;

/**
 * Group the board's courses by status for the "Prereqs met by" filter.
 * AP/transfer credit counts as taken. A course placed twice lands in each of
 * its statuses' pools (the filter only ever unions pools).
 */
export function buildPlanPools(
  cards: { placementId: string; course: { id: string; subject: string; number: string } }[],
  completedIds: readonly string[],
  inProgressIds: readonly string[],
  credit: { ids: ReadonlySet<string>; codes: ReadonlySet<string> }
): PlanPools {
  const pools: PlanPools = {
    taken: { ids: new Set(), codes: new Set() },
    "in-progress": { ids: new Set(), codes: new Set() },
    planned: { ids: new Set(), codes: new Set() },
  };
  const completed = new Set(completedIds);
  const inProgress = new Set(inProgressIds);
  for (const { placementId, course } of cards) {
    const status: PlanStatus = completed.has(placementId)
      ? "taken"
      : inProgress.has(placementId)
        ? "in-progress"
        : "planned";
    pools[status].ids.add(course.id);
    pools[status].codes.add(`${course.subject} ${course.number}`);
  }
  for (const id of credit.ids) pools.taken.ids.add(id);
  for (const code of credit.codes) pools.taken.codes.add(code);
  return pools;
}

/**
 * The courses whose prerequisites could possibly be met by the pools of these
 * statuses: everything those pools' courses unlock (the index's reverse
 * prerequisite edges). Only these need their full doc fetched and evaluated;
 * any other course with prerequisites can't be covered by the plan.
 */
export function prereqCandidates(
  pools: PlanPools,
  statuses: readonly PlanStatus[],
  unlocksOf: (courseId: string) => readonly string[] | undefined,
  canonical: (id: string) => string = (id) => id
): Set<string> {
  const out = new Set<string>();
  for (const st of statuses) {
    for (const id of pools[st].ids) {
      for (const key of new Set([id, canonical(id)])) {
        for (const u of unlocksOf(key) ?? []) out.add(u);
      }
    }
  }
  return out;
}

/** The expression with its soft ("usually needs X — or an equivalent") parts
 *  made firm: X itself must be there. */
function firmExpr(expr: PrereqExpr): PrereqExpr {
  switch (expr.type) {
    case "advisory":
      return firmExpr(expr.expr);
    case "and":
    case "or":
      return { type: expr.type, children: expr.children.map(firmExpr) };
    default:
      return expr;
  }
}

/**
 * Would the courses with these statuses cover this prerequisite expression?
 * Unlike the board, a soft ("or equivalent") requirement counts as firm here:
 * the filter answers "do the courses I'm counting cover it", so "Needs CS 2110
 * or equivalent" stays hidden while CS 2110 is only planned. AP/transfer credit
 * is already in the taken pool.
 */
export function prereqsMetByPools(
  expr: PrereqExpr | null | undefined,
  pools: PlanPools,
  statuses: readonly PlanStatus[],
  canonical: (id: string) => string = (id) => id
): boolean {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const st of statuses) {
    for (const id of pools[st].ids) ids.add(id);
    for (const c of pools[st].codes) codes.add(c);
  }
  const firm = expr ? firmExpr(expr) : expr;
  return evaluate(firm, { completedIds: ids, completedCodes: codes, canonical }).state !== "blocked";
}

export type CourseFilters = {
  subject?: string;
  /** First digit of the course number (1 → 1000-level, 2 → 2000-level, …). */
  level?: number;
  /** A credit value the course can be taken for (creditsMin ≤ c ≤ creditsMax). */
  credits?: number;
  /** Term token FA / SP / SU / WI. */
  offered?: string;
  hasPrereqs?: boolean;
  favoritesOnly?: boolean;
  relevantToMajor?: boolean;
  /** "Prereqs met by" multi-select: keep courses whose prerequisites are
   *  covered by the plan's courses with ANY of these statuses (courses with no
   *  prerequisites always pass). Empty or absent = no narrowing on this axis. */
  prereqsMetBy?: PlanStatus[];
  /** Attribute requirement (spec 010 §2) — matches a record on title/attrs via
   *  the shared satisfies.matchesAttribute. Seeded when an attribute slot's
   *  "Find a class" opens the drawer (e.g. FWS). */
  attribute?: AttributeMatch;
  /** Spec 014 D2 — restrict to courses that would satisfy this program
   *  requirement (a requirement id from useRequirementProgress). Seeded when an
   *  unmet Still-needed item is clicked. */
  requirementId?: string;
  /** Human label for the removable requirement chip (display only; ignored by
   *  the pure predicate). E.g. "CS electives". */
  requirementLabel?: string;
  /** Human label for the removable attribute chip (display only; ignored by the
   *  pure predicate). E.g. "First-Year Writing Seminar". */
  attributeLabel?: string;
};

/** Evaluate an attribute filter against a lean catalog index record. A
 *  title-startsWith "FWS:" predicate uses the derived `fws` flag; other title
 *  predicates fall back to the record title; attrs.value tests the record's
 *  attr values. Predicate semantics live in satisfies.matchesAttribute. */
export function recordMatchesAttribute(
  r: CatalogIndexRecord,
  match: AttributeMatch
): boolean {
  return matchesAttribute(
    { title: r.title, attrValues: r.attrs, fws: r.fws },
    match
  );
}

export type FilterContext = {
  favorites: Set<string>;
  /** Whether a record qualifies for the current program's open requirements. */
  isRelevant: (r: CatalogIndexRecord) => boolean;
  /** Spec 014 D2 — would this record satisfy the given program requirement?
   *  Absent = the requirement axis is not evaluated (passes). */
  satisfiesRequirement?: (r: CatalogIndexRecord, requirementId: string) => boolean;
  /** Are this course's prerequisites covered by the plan's courses with these
   *  statuses? false while its prerequisites are still loading. Absent =
   *  nothing on the plan covers anything. */
  prereqsMetBy?: (courseId: string, statuses: readonly PlanStatus[]) => boolean;
};

/** PURE predicate — the unit-tested core (spec 006 §E3 / DoD). */
export function matchesFilters(
  r: CatalogIndexRecord,
  f: CourseFilters,
  ctx: FilterContext
): boolean {
  if (f.subject && r.subject !== f.subject) return false;
  if (f.level != null) {
    const digit = parseInt(r.number[0] ?? "", 10);
    if (digit !== f.level) return false;
  }
  if (f.credits != null) {
    if (!(r.creditsMin <= f.credits && f.credits <= r.creditsMax)) return false;
  }
  if (f.offered && !r.offered.includes(f.offered)) return false;
  if (f.hasPrereqs != null && r.hasPrereqs !== f.hasPrereqs) return false;
  if (f.favoritesOnly && !ctx.favorites.has(r.id)) return false;
  if (f.relevantToMajor && !ctx.isRelevant(r)) return false;
  if (f.prereqsMetBy && f.prereqsMetBy.length > 0 && r.hasPrereqs) {
    if (!ctx.prereqsMetBy?.(r.id, f.prereqsMetBy)) return false;
  }
  if (f.attribute && !recordMatchesAttribute(r, f.attribute)) return false;
  if (f.requirementId && ctx.satisfiesRequirement && !ctx.satisfiesRequirement(r, f.requirementId)) {
    return false;
  }
  return true;
}

/** Id-computable elective qualification (mirrors useMajorMatch's `qualifies` —
 *  list/category need server data we don't ship client-side). */
function qualifies(rule: QualifyingRule, subject: string, num: number): boolean {
  switch (rule.type) {
    case "open":
      return true;
    case "level":
      return subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    case "outside":
      return !rule.exclude_subjects.includes(subject);
    case "list":
    case "category":
      return false;
  }
}

/**
 * Would this index record satisfy ONE program requirement (spec 014 D2)? The
 * same predicates the matcher uses (satisfies.courseSatisfiesRequirement for
 * course/pattern seats, matchesAttribute for attribute seats, the id-computable
 * pool rules for elective pools), evaluated over the lean index record — no
 * doc fetch. A NON-computable pool (list/category rules — no client data) can't
 * narrow anything, so it passes every record rather than claiming nothing fits.
 */
export function recordSatisfiesRequirement(
  r: CatalogIndexRecord,
  req: RequirementInstance,
  canonical: (id: string) => string = (id) => id
): boolean {
  if (req.kind === "pool") {
    if (!req.computable) return true;
    return qualifies(req.rule, r.subject, parseInt(r.number, 10));
  }
  if (req.req.kind === "attribute") return recordMatchesAttribute(r, req.req.match);
  return courseSatisfiesRequirement(
    { id: r.id, subject: r.subject, number: r.number, title: r.title },
    req.req,
    canonical
  );
}

/** Build the requirement-id predicate for a program's template slots. An id
 *  that isn't one of this program's requirements (e.g. a stale seed after a
 *  program switch) narrows nothing. */
export function buildRequirementPredicate(
  slots: ProgramSlotWithData[],
  canonical: (id: string) => string = (id) => id
): (r: CatalogIndexRecord, requirementId: string) => boolean {
  const byId = new Map<string, RequirementInstance>();
  for (const req of programToRequirements(programSlotsToMatchInput(slots))) byId.set(req.id, req);
  return (r, requirementId) => {
    const req = byId.get(requirementId);
    return req ? recordSatisfiesRequirement(r, req, canonical) : true;
  };
}

export function useCourseFilters(
  index: CatalogIndexRecord[],
  slots: ProgramSlotWithData[],
  opts?: { favorites?: Set<string>; planPools?: PlanPools }
) {
  const favorites = opts?.favorites ?? EMPTY_SET;
  const planPools = opts?.planPools;
  const { aliases, courseDetails } = useCatalogContext();

  const subjects = useMemo(
    () => [...new Set(index.map((r) => r.subject))].sort((a, b) => a.localeCompare(b)),
    [index]
  );

  const hasOffered = useMemo(() => index.some((r) => r.offered.length > 0), [index]);

  // Relevance: a record counts if it satisfies any of the program's OPEN
  // requirements — an unfilled pattern slot's pattern, or an elective group's
  // id-computable qualifying rule. (Fixed course slots aren't "open" discovery.)
  const isRelevant = useMemo(() => {
    const patterns: RegExp[] = [];
    const rules: QualifyingRule[] = [];
    for (const s of slots) {
      if (s.kind === "pattern" && s.pattern) patterns.push(patternToRegex(s.pattern));
      else if (s.kind === "elective" && s.elective_groups) rules.push(s.elective_groups.qualifying_rule);
    }
    return (r: CatalogIndexRecord): boolean => {
      const code = `${r.subject} ${r.number}`;
      if (patterns.some((re) => re.test(code))) return true;
      const num = parseInt(r.number, 10);
      return rules.some((rule) => qualifies(rule, r.subject, num));
    };
  }, [slots]);

  // Requirement scope (spec 014 D2) — the current program's requirements,
  // evaluated in memory over the already-loaded index (never a catalog scan).
  const satisfiesRequirement = useMemo(
    () => buildRequirementPredicate(slots, (id) => aliases[id] ?? id),
    [slots, aliases]
  );

  // "Prereqs met by": only the courses the chosen pools unlock can pass; their
  // prerequisite trees come from the full docs (ClassesPage fetches exactly
  // these via `prereqCandidatesFor`).
  const unlocksOf = useMemo(() => {
    const m = new Map(index.map((r) => [r.id, r.unlocks]));
    return (id: string) => m.get(id);
  }, [index]);
  const canonical = useCallback((id: string) => aliases[id] ?? id, [aliases]);
  const prereqCandidatesFor = useCallback(
    (statuses: readonly PlanStatus[]) =>
      planPools ? prereqCandidates(planPools, statuses, unlocksOf, canonical) : new Set<string>(),
    [planPools, unlocksOf, canonical]
  );
  // Per-status candidate sets; a course is a candidate for a selection when any
  // selected status's courses unlock it.
  const candidatesByStatus = useMemo(
    () => ({
      taken: prereqCandidatesFor(["taken"]),
      "in-progress": prereqCandidatesFor(["in-progress"]),
      planned: prereqCandidatesFor(["planned"]),
    }),
    [prereqCandidatesFor]
  );
  const prereqsMetBy = useCallback(
    (id: string, statuses: readonly PlanStatus[]): boolean => {
      if (!planPools) return false;
      if (!statuses.some((st) => candidatesByStatus[st].has(id))) return false;
      const doc = courseDetails[id];
      if (!doc) return false; // still loading
      return prereqsMetByPools(doc.prereq_expr, planPools, statuses, canonical);
    },
    [planPools, candidatesByStatus, courseDetails, canonical]
  );

  const predicate = useCallback(
    (r: CatalogIndexRecord, f: CourseFilters) =>
      matchesFilters(r, f, {
        favorites,
        isRelevant,
        satisfiesRequirement,
        prereqsMetBy,
      }),
    [favorites, isRelevant, satisfiesRequirement, prereqsMetBy]
  );

  return { predicate, subjects, hasOffered, prereqCandidatesFor };
}

const EMPTY_SET: Set<string> = new Set();
