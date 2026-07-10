import { useCallback, useMemo } from "react";
import { patternToRegex } from "@/lib/planner/evaluatePrereq";
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
};

export type FilterContext = {
  favorites: Set<string>;
  /** Whether a record qualifies for the current program's open requirements. */
  isRelevant: (r: CatalogIndexRecord) => boolean;
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

export function useCourseFilters(
  index: CatalogIndexRecord[],
  slots: ProgramSlotWithData[],
  opts?: { favorites?: Set<string> }
) {
  const favorites = opts?.favorites ?? EMPTY_SET;

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

  const predicate = useCallback(
    (r: CatalogIndexRecord, f: CourseFilters) => matchesFilters(r, f, { favorites, isRelevant }),
    [favorites, isRelevant]
  );

  return { predicate, subjects, hasOffered };
}

const EMPTY_SET: Set<string> = new Set();
