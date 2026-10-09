import { useCallback, useMemo } from "react";
import { patternToRegex } from "@/lib/planner/evaluatePrereq";
import {
  courseSatisfiesRequirement,
  matchesAttribute,
  type AttributeMatch,
} from "@/lib/planner/satisfies";
import { programToRequirements, type RequirementInstance } from "@/lib/planner/majorMatch";
import { programSlotsToMatchInput } from "@/lib/planner/matchAdapters";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { ProgramSlotWithData, QualifyingRule } from "@/types/db";

/**
 * useCourseFilters (spec 006 §E3) — ONE filter model + a pure predicate over
 * catalogIndex records, shared by /classes and the catalog drawer. Filter axes:
 * subject, level (first digit of the number), credits, offered term, has-prereqs,
 * favorites, and "relevant to my major" (matches the selected program's open
 * pattern/elective requirements). The predicate is pure and unit-tested; the hook
 * supplies the data-derived context (favorites set + relevance closure).
 *
 * Data note: the `offered` axis needs `offered` on index records (added to the
 * catalogIndex chunk schema, populated by the roster-sync rebuild). Until the
 * rebuild lands, records carry no `offered` and the offered control hides
 * (hasOffered=false); the predicate then excludes nothing on that axis.
 */

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
  opts?: { favorites?: Set<string> }
) {
  const favorites = opts?.favorites ?? EMPTY_SET;
  const { aliases } = useCatalogContext();

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

  const predicate = useCallback(
    (r: CatalogIndexRecord, f: CourseFilters) =>
      matchesFilters(r, f, { favorites, isRelevant, satisfiesRequirement }),
    [favorites, isRelevant, satisfiesRequirement]
  );

  return { predicate, subjects, hasOffered };
}

const EMPTY_SET: Set<string> = new Set();
