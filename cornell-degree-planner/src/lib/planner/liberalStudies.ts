import { LIBERAL_STUDIES, type Cohort, type GroupDef } from "@/data/liberal-studies";
import { assign, type Assignment, type MatchCourse, type PoolRequirement, type RequirementInstance } from "./majorMatch";
import { evaluateStandaloneRow, type StandaloneRowResult } from "./distribution";
import { termOrdinal } from "./distribution/select";
import type { DistCourse, DistributionRow } from "./distribution/types";
import type { QualifyingRule } from "@/types/db";
import type { ColumnRef } from "@/types/plan";
import { termOfColumn, toColumnRef } from "./terms";

/**
 * liberalStudies.ts (spec 037) — Engineering's liberal studies requirement:
 * which courses count, in which of the seven groups, and the group rules.
 *
 * Which courses count (D2): a roster tag whose base (split at the LAST hyphen)
 * is in a group's `bases`, or whose full value is in a group's `exact`; a
 * course on Engineering's approved petitions list (D3), where a row marked
 * "taken Summer 2024 and prior" applies only to a placement in or before that
 * term; and exam or transfer credit (D4), through the catalog tags of the
 * course it grants or the award's own `liberalStudies` bases.
 *
 * The group rules (D6) are one distribution row (six courses, 18 credits, at
 * least three groups, at most two Group 6 courses, Group 7's 3 credits for
 * Fall 2024 entrants, two courses at 2000+), judged by the distribution
 * evaluator after the matcher has run (applyLiberalStudies, D7).
 *
 * The entering class (D8) picks the rules: the entry term, else Fall of the
 * entering year. With neither the cohort is unknown: the Fall 2024 groups are
 * used without Group 7's minimum, so no one is told they're missing it.
 */

export const LIBERAL_STUDIES_GROUP_ID = "liberal-studies";
/** The shared advisor-approved electives group (spec 038), which a liberal
 *  studies course may move out of (D7). */
export const ADVISOR_ELECTIVE_GROUP_ID = "advisor-elective-open";

export type LsCohortId = "fa2024" | "fa2020";

/** The cohort used when the entering class is unknown (D8). */
const DEFAULT_COHORT: LsCohortId = "fa2024";

const COHORTS = new Map<LsCohortId, Cohort>(LIBERAL_STUDIES.cohorts.map((c) => [c.id, c]));

function cohortOf(id: LsCohortId): Cohort {
  const c = COHORTS.get(id);
  if (!c) throw new Error(`liberal studies: no cohort ${id}`);
  return c;
}

/** A rule is Engineering's liberal studies category (D5). Every other
 *  `category` rule stays non-computable. */
export function isLiberalStudiesRule(rule: QualifyingRule): boolean {
  return rule.type === "category" && rule.category === LIBERAL_STUDIES_GROUP_ID;
}

// ─── Entering class ──────────────────────────────────────────────────────────

/**
 * The rules a student follows (D8). The entry term wins; else Fall of the
 * entering year; else unknown (null). An entrant before Fall 2020 gets the
 * Fall 2020 – Spring 2024 rules with `olderPolicy` set (D2).
 */
export function liberalStudiesCohort(
  entryTerm: string | null | undefined,
  enteringYear: number | null | undefined
): { cohort: LsCohortId | null; olderPolicy: boolean } {
  let entry = entryTerm ? termOrdinal(entryTerm) : null;
  if (entry == null && enteringYear != null && Number.isFinite(enteringYear) && enteringYear > 0) {
    // Roster slugs carry a two-digit year; anything before 2000 is older still.
    if (enteringYear < 2000) return { cohort: "fa2020", olderPolicy: true };
    entry = termOrdinal(`FA${String(enteringYear % 100).padStart(2, "0")}`);
  }
  if (entry == null) return { cohort: null, olderPolicy: false };
  const fa2024 = termOrdinal(cohortOf("fa2024").enteredFrom) ?? Infinity;
  const fa2020 = termOrdinal(cohortOf("fa2020").enteredFrom) ?? -Infinity;
  if (entry >= fa2024) return { cohort: "fa2024", olderPolicy: false };
  return { cohort: "fa2020", olderPolicy: entry < fa2020 };
}

/** The roster term of a board column (sem 1 = Fall of the entering year,
 *  sem 2 = the Spring after, as the roadmap labels its columns; a short term
 *  is its real Summer/Winter slug, e.g. "SU24" — spec 042 D11, through
 *  terms.ts termOfColumn), or null when the entering year is unknown. A plain
 *  number is a regular semester. */
export function semesterTerm(
  column: number | ColumnRef,
  enteringYear: number | null | undefined
): string | null {
  const ref = toColumnRef(column);
  if (enteringYear == null || !Number.isFinite(enteringYear) || !Number.isInteger(ref.sem) || ref.sem < 1) return null;
  return termOfColumn(ref, enteringYear).slug;
}

// ─── Which groups a course counts in ─────────────────────────────────────────

type GroupTables = {
  order: string[];
  byBase: Map<string, string[]>;
  byExact: Map<string, string[]>;
};

const TABLES = new Map<LsCohortId, GroupTables>();
function tablesOf(cohort: LsCohortId): GroupTables {
  let t = TABLES.get(cohort);
  if (!t) {
    const byBase = new Map<string, string[]>();
    const byExact = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, k: string, g: string) => {
      const list = m.get(k) ?? [];
      if (!list.includes(g)) list.push(g);
      m.set(k, list);
    };
    const groups = cohortOf(cohort).groups;
    for (const g of groups) {
      for (const b of g.bases) add(byBase, b, g.id);
      for (const e of g.exact) add(byExact, e, g.id);
    }
    t = { order: groups.map((g) => g.id), byBase, byExact };
    TABLES.set(cohort, t);
  }
  return t;
}

/** "SBA-AG" → "SBA"; "SCD-HA" → "SCD"; a value without a hyphen is its own base. */
function tagBase(tag: string): string {
  const i = tag.lastIndexOf("-");
  return i > 0 ? tag.slice(0, i) : tag;
}

const HOTEL_COLLEGE = /hotel|nolan|^sha$/i;

/** Groups of a base code as Engineering prints it (petitions, credit awards:
 *  no college suffix). A bare "SCD" counts in Group 7 for Fall 2024 entrants
 *  (Group 1 when the course is a Hotel school course, whose SCD-HA tag is
 *  Group 1), and in Group 1 for Fall 2020 – Spring 2024 entrants (D3). */
function baseGroups(base: string, cohort: LsCohortId, college: string | null): string[] {
  const t = tablesOf(cohort);
  const direct = t.byBase.get(base);
  if (direct && direct.length > 0) return direct;
  if (base === "SCD" && cohort === "fa2024") return [college && HOTEL_COLLEGE.test(college) ? "g1" : "g7"];
  return [];
}

export type LiberalStudiesCourse = {
  id: string;
  /** Roster tags: a placed course's `{ value }` objects or an index record's strings. */
  attrs?: { value: string }[] | string[] | null;
  /** The placement's roster term ("SP26"); null/absent → not placed in a
   *  known term (a catalog search, a credit course), so a petition row
   *  limited to "Summer 2024 and prior" doesn't apply. */
  term?: string | null;
  /** Exam or transfer credit: the award's liberal studies base codes (C3). */
  liberalStudies?: string[];
  /** Spec 046: a no-equivalent transfer the student placed in these groups
   *  ("g1".."g7"), by group id. */
  liberalStudiesGroups?: string[];
};

/** Group ids ("g1".."g7", in order) this course could count in; [] = it
 *  doesn't count for liberal studies. */
export function liberalStudiesGroupsOf(course: LiberalStudiesCourse, cohort: LsCohortId): string[] {
  const t = tablesOf(cohort);
  const found = new Set<string>();
  for (const a of course.attrs ?? []) {
    const tag = typeof a === "string" ? a : a?.value;
    if (!tag) continue;
    for (const g of t.byExact.get(tag) ?? []) found.add(g);
    for (const g of t.byBase.get(tagBase(tag)) ?? []) found.add(g);
  }
  const rows = Object.prototype.hasOwnProperty.call(LIBERAL_STUDIES.petitions, course.id)
    ? LIBERAL_STUDIES.petitions[course.id]
    : undefined;
  if (rows) {
    const placed = course.term ? termOrdinal(course.term) : null;
    for (const row of rows) {
      if (row.takenThrough) {
        const through = termOrdinal(row.takenThrough);
        if (placed == null || through == null || placed > through) continue;
      }
      for (const base of row.categories) for (const g of baseGroups(base, cohort, row.college)) found.add(g);
    }
  }
  for (const base of course.liberalStudies ?? []) for (const g of baseGroups(base, cohort, null)) found.add(g);
  for (const g of course.liberalStudiesGroups ?? []) found.add(g);
  return t.order.filter((g) => found.has(g));
}

export function countsForLiberalStudies(course: LiberalStudiesCourse, cohort: LsCohortId): boolean {
  return liberalStudiesGroupsOf(course, cohort).length > 0;
}

export function liberalStudiesGroups(cohort: LsCohortId): { id: string; label: string; name: string }[] {
  return cohortOf(cohort).groups.map((g: GroupDef) => ({ id: g.id, label: g.label, name: g.name }));
}

/** The cohort's group rules (six courses, 18 credits, three groups, …). */
export function liberalStudiesRules(cohort: LsCohortId): Cohort["rules"] {
  return cohortOf(cohort).rules;
}

// ─── The group check (D6) ────────────────────────────────────────────────────

/**
 * The liberal studies rules as one distribution row. `membersOf` maps each
 * group id to the canonical ids of the candidate courses that can count in it
 * (the category rules name them, so the evaluator needs no tag data of its
 * own). `omitGroupMinimums` leaves Group 7's credit minimum out (unknown
 * entering class, D8).
 */
export function liberalStudiesRow(
  cohort: LsCohortId,
  membersOf: Record<string, string[]>,
  opts: { omitGroupMinimums?: boolean } = {}
): DistributionRow {
  const c = cohortOf(cohort);
  const perCategory: NonNullable<DistributionRow["perCategory"]> = {};
  for (const [g, max] of Object.entries(c.rules.groupMax)) perCategory[g] = { ...perCategory[g], max };
  if (!opts.omitGroupMinimums) {
    for (const [g, minCredits] of Object.entries(c.rules.groupMinCredits)) {
      perCategory[g] = { ...perCategory[g], minCredits };
    }
  }
  const { number, count } = c.rules.minCoursesAtOrAbove;
  return {
    id: LIBERAL_STUDIES_GROUP_ID,
    kind: "distribution",
    label: "Liberal Studies",
    group: "Liberal studies",
    source: { url: c.source.url, anchor: "" },
    categories: c.groups.map((g) => ({ id: g.id, label: g.label, rule: { course: membersOf[g.id] ?? [] } })),
    requiredCourses: c.rules.requiredCourses,
    minDistinctCategories: c.rules.minGroups,
    requiredCredits: c.rules.requiredCredits,
    perCategory,
    maxCategoriesPerCourse: 1,
    limits: [{ rule: { number: { min: number } }, label: `At least ${count} courses at the ${number} level or higher`, minCourses: count }],
  };
}

/** Recent evaluations, keyed by everything the row reads. Major Match judges
 *  the same candidates for every Engineering major of a board. */
const evalCache = new Map<string, StandaloneRowResult>();
const EVAL_CACHE_MAX = 64;

/** Judge a candidate set (canonical ids, each with its groups). */
function evaluateCandidates(
  candidates: { course: DistCourse; groups: string[] }[],
  cohort: LsCohortId,
  omitGroupMinimums: boolean
): StandaloneRowResult {
  const key = [
    cohort,
    omitGroupMinimums ? 1 : 0,
    ...candidates.map(({ course, groups }) => `${course.id}:${course.credits}:${course.number}:${groups.join(",")}`),
  ].join("|");
  const hit = evalCache.get(key);
  if (hit) return hit;
  const membersOf: Record<string, string[]> = {};
  for (const { course, groups } of candidates) for (const g of groups) (membersOf[g] ??= []).push(course.id);
  const row = liberalStudiesRow(cohort, membersOf, { omitGroupMinimums });
  const result = evaluateStandaloneRow(
    row,
    candidates.map((c) => c.course)
  );
  if (evalCache.size >= EVAL_CACHE_MAX) evalCache.clear();
  evalCache.set(key, result);
  return result;
}

const EPS = 1e-9;

/**
 * The candidates counted plainly, for when the evaluator couldn't prove a
 * result: every course counts, each in one of its groups (one a credit
 * minimum still needs, else one not yet covered, else the first with room).
 * Never "met" (nothing was proved), so `proven` is false and the fraction
 * stays below 1.
 */
function plainCount(
  candidates: { course: DistCourse; groups: string[] }[],
  cohort: LsCohortId,
  omitGroupMinimums: boolean
): StandaloneRowResult {
  const { rules, groups } = cohortOf(cohort);
  const minCredits = omitGroupMinimums ? {} : rules.groupMinCredits;
  const count: Record<string, number> = {};
  const credits: Record<string, number> = {};
  const categoryOf: Record<string, string> = {};
  let creditsHave = 0;
  let atLevel = 0;
  for (const { course, groups: gs } of candidates) {
    const room = gs.filter((g) => (count[g] ?? 0) < (rules.groupMax[g] ?? Infinity));
    const g =
      room.find((x) => (credits[x] ?? 0) < (minCredits[x] ?? 0)) ??
      room.find((x) => !count[x]) ??
      room[0] ??
      gs[0];
    if (!g) continue;
    categoryOf[course.id] = g;
    count[g] = (count[g] ?? 0) + 1;
    credits[g] = (credits[g] ?? 0) + course.credits;
    creditsHave += course.credits;
    const num = parseInt(course.number, 10);
    if (!Number.isNaN(num) && num >= rules.minCoursesAtOrAbove.number) atLevel++;
  }
  const counted = candidates.map((c) => c.course.id).filter((id) => id in categoryOf);
  const categoriesHave = groups.map((g) => g.id).filter((g) => count[g]);
  const missingCategories = groups
    .map((g) => g.id)
    .filter(
      (g) =>
        (credits[g] ?? 0) < (minCredits[g] ?? 0) - EPS ||
        (categoriesHave.length < rules.minGroups && !count[g])
    );
  const parts = [
    Math.min(1, counted.length / rules.requiredCourses),
    Math.min(1, categoriesHave.length / rules.minGroups),
    Math.min(1, creditsHave / rules.requiredCredits),
    ...Object.entries(minCredits).map(([g, min]) => Math.min(1, (credits[g] ?? 0) / min)),
    Math.min(1, atLevel / rules.minCoursesAtOrAbove.count),
  ];
  const fraction = Math.min(parts.reduce((a, b) => a + b, 0) / parts.length, 1 - 1e-6);
  return {
    status: counted.length > 0 ? "partial" : "unmet",
    counted,
    categoryOf,
    categoriesHave,
    missingCategories,
    coursesHave: counted.length,
    coursesNeed: rules.requiredCourses,
    creditsHave,
    creditsNeed: rules.requiredCredits,
    fraction: counted.length > 0 ? fraction : 0,
    proven: false,
  };
}

// ─── After the matcher (D7) ──────────────────────────────────────────────────

export type LiberalStudiesOutcome = {
  /** The matcher's assignment with liberal studies counted by the group
   *  rules: the liberal studies pool holds exactly the counted courses, and
   *  every other requirement keeps at least the coverage it had. */
  assignment: Assignment;
  row: StandaloneRowResult;
  /** The cohort whose groups were used (the default one when unknown). */
  cohort: LsCohortId;
  /** The entering class is unknown: Group 7's minimum was left out. */
  cohortUnknown: boolean;
  olderPolicy: boolean;
  requirementId: string;
};

/** A pool rule that takes courses it doesn't name (`open`, `outside`): the
 *  pools a liberal studies course may move out of (D7). */
function isBroadRule(rule: QualifyingRule): boolean {
  return rule.type === "open" || rule.type === "outside";
}

/** Count and credits each requirement holds in an assignment. */
function coverage(a: Assignment): Map<string, { courses: number; credits: number }> {
  const out = new Map<string, { courses: number; credits: number }>();
  for (const m of a.matched) {
    const c = out.get(m.requirementId) ?? { courses: 0, credits: 0 };
    c.courses += 1;
    c.credits += m.credits;
    out.set(m.requirementId, c);
  }
  return out;
}

/**
 * Judges the liberal studies pool by its group rules (D6) and settles which
 * courses are the liberal studies courses (D7).
 *
 * Candidates: the courses the matcher put in the pool, tagged courses it left
 * uncounted, and (when that does better) tagged courses sitting in a broad
 * pool, one whose rule is `open` or `outside` (the advisor-approved seats, an
 * outside or major-approved elective). The evaluator picks the best set; the
 * rest of the board is then re-matched without the counted courses and
 * without the liberal studies pool, so a displaced course can take the seat a
 * chosen course left (and a third Communications course can fill one). A
 * re-match is used only if no other requirement loses a course or a credit;
 * otherwise the check falls back to the pool's own courses, with the
 * matcher's assignment kept for everything else. It falls back the same way
 * when the evaluator can't prove a result over every candidate (its search
 * budget ran out). Invariant: no course counts twice, and no requirement
 * other than liberal studies loses coverage.
 *
 * Returns null when the program has no active liberal studies pool (none, or
 * waived). `courses` and `requirements` are exactly what `assignment` was
 * computed from.
 */
export function applyLiberalStudies(input: {
  courses: MatchCourse[];
  requirements: RequirementInstance[];
  assignment: Assignment;
  canonical: (id: string) => string;
  cohort: LsCohortId | null;
  olderPolicy?: boolean;
}): LiberalStudiesOutcome | null {
  const { courses, requirements, assignment: orig, canonical } = input;
  const ls = requirements.find(
    (r): r is PoolRequirement => r.kind === "pool" && r.computable && isLiberalStudiesRule(r.rule)
  );
  if (!ls) return null;
  const cohortUnknown = input.cohort == null;
  const cohort = input.cohort ?? DEFAULT_COHORT;
  const others = requirements.filter((r) => r !== ls);
  const opts = { liberalStudiesCohort: cohort };

  // Canonical id → the course as the matcher saw it (first wins, max credits),
  // plus its groups. The evaluator reads credits, number and groups.
  const byId = new Map<string, { course: DistCourse; groups: string[] }>();
  const order: string[] = [];
  for (const c of courses) {
    const id = canonical(c.id);
    const prev = byId.get(id);
    if (prev) {
      if (c.credits > prev.course.credits) prev.course = { ...prev.course, credits: c.credits };
      continue;
    }
    const groups = liberalStudiesGroupsOf(c, cohort);
    byId.set(id, { course: { id, subject: c.subject, number: c.number, credits: c.credits }, groups });
    order.push(id);
  }
  const tagged = (id: string) => (byId.get(id)?.groups.length ?? 0) > 0;
  const inReq = (a: Assignment, reqId: string) =>
    new Set(a.matched.filter((m) => m.requirementId === reqId).map((m) => m.courseId));

  const S = inReq(orig, ls.id);
  const U = new Set(orig.uncounted.map((u) => u.courseId).filter(tagged));
  // Tagged courses the matcher put in a broad pool (an `open` or `outside`
  // rule: the advisor-approved seats, CS's major-approved and external
  // specialization, EAS's outside electives, ...). A list or level pool holds
  // courses it named, so they stay there.
  const broad = new Set(
    others
      .filter((r): r is PoolRequirement => r.kind === "pool" && r.computable && isBroadRule(r.rule))
      .map((r) => r.id)
  );
  const A = new Set(
    orig.matched.filter((m) => broad.has(m.requirementId) && tagged(m.courseId)).map((m) => m.courseId)
  );
  const pick = (ids: Set<string>) =>
    order.filter((id) => ids.has(id)).map((id) => byId.get(id)!);
  const judge = (ids: Set<string>) => evaluateCandidates(pick(ids), cohort, cohortUnknown);

  const before = coverage(orig);
  const keepsCoverage = (next: Assignment) => {
    const after = coverage(next);
    for (const r of others) {
      const b = before.get(r.id);
      if (!b) continue;
      const a = after.get(r.id) ?? { courses: 0, credits: 0 };
      if (a.courses < b.courses || a.credits < b.credits - EPS) return false;
    }
    return true;
  };

  /** The assignment with `row`'s counted courses as liberal studies. With
   *  `rematch`, everything else is matched again without them; null when that
   *  would cost another requirement coverage. */
  const settle = (row: StandaloneRowResult, rematch: boolean): Assignment | null => {
    const counted = new Set(row.counted);
    let rest: Assignment;
    if (rematch) {
      rest = assign(
        courses.filter((c) => !counted.has(canonical(c.id))),
        others,
        canonical,
        opts
      );
      if (!keepsCoverage(rest)) return null;
    } else {
      rest = {
        ...orig,
        matched: orig.matched.filter((m) => m.requirementId !== ls.id),
        missing: orig.missing.filter((m) => m.requirementId !== ls.id),
      };
    }
    return withLiberalStudies(rest, ls, row, order, orig, (id) => byId.get(id)?.course.credits ?? 0);
  };

  const sameAsPool = (row: StandaloneRowResult) =>
    row.counted.length === S.size && row.counted.every((id) => S.has(id));

  const baseIds = new Set([...S, ...U]);
  const base = judge(baseIds);
  let chosen: { row: StandaloneRowResult; assignment: Assignment } | null = null;
  // An unproven result (the search budget ran out over many candidates)
  // counts nothing, so it never drives a re-match.
  if (base.proven) {
    if (A.size > 0 && base.status !== "met") {
      const full = judge(new Set([...baseIds, ...A]));
      if (full.proven && full.fraction > base.fraction + EPS) {
        const a = settle(full, true);
        if (a) chosen = { row: full, assignment: a };
      }
    }
    if (!chosen) {
      const a = settle(base, !sameAsPool(base));
      if (a) chosen = { row: base, assignment: a };
    }
  }
  if (!chosen) {
    // Fallback: only the pool's own courses, the matcher's assignment kept
    // for everything else. Should even those not be provable, the pool keeps
    // all of them, counted plainly.
    let own = judge(S);
    if (!own.proven) own = plainCount(pick(S), cohort, cohortUnknown);
    chosen = { row: own, assignment: settle(own, false)! };
  }
  return {
    assignment: chosen.assignment,
    row: chosen.row,
    cohort,
    cohortUnknown,
    olderPolicy: input.olderPolicy ?? false,
    requirementId: ls.id,
  };
}

/**
 * What an unmet liberal studies row still needs beyond its course count, in
 * a few words for Major Match's "Still needed" line: "needs 1 more group,
 * Race & Equity", "needs 2 more credits", and for a row short only on the
 * level rule "needs 2 courses at the 2000 level or higher". Null when the row
 * is met.
 */
export function liberalStudiesShortfall(outcome: LiberalStudiesOutcome): string | null {
  const { row, cohort, cohortUnknown } = outcome;
  if (row.status === "met") return null;
  const rules = cohortOf(cohort).rules;
  const parts: string[] = [];
  const groupsShort = rules.minGroups - row.categoriesHave.length;
  if (groupsShort > 0) parts.push(`${groupsShort} more ${groupsShort === 1 ? "group" : "groups"}`);
  if (!cohortUnknown) {
    const labelOf = new Map(liberalStudiesGroups(cohort).map((g) => [g.id, g.label]));
    for (const g of Object.keys(rules.groupMinCredits)) {
      if (row.missingCategories.includes(g)) parts.push(labelOf.get(g) ?? g);
    }
  }
  const creditsShort = row.creditsNeed - row.creditsHave;
  if (creditsShort > EPS) {
    const n = Math.round(creditsShort * 10) / 10;
    parts.push(`${n} more ${n === 1 ? "credit" : "credits"}`);
  }
  if (parts.length > 0) return `needs ${parts.join(", ")}`;
  // Courses, groups and credits are there: only the level rule is left.
  const { number, count } = rules.minCoursesAtOrAbove;
  return `needs ${count} courses at the ${number} level or higher`;
}

/** `rest` (an assignment without the liberal studies pool) plus the pool
 *  counted from `row`: each counted course credited richest-first up to the
 *  pool's credits (while the row isn't met, up to the row's fraction of
 *  them, rounded down), a missing entry while the row isn't met, the
 *  uncounted list and totals recomputed. */
function withLiberalStudies(
  rest: Assignment,
  ls: PoolRequirement,
  row: StandaloneRowResult,
  order: string[],
  orig: Assignment,
  creditOf: (id: string) => number
): Assignment {
  const matched = rest.matched.filter((m) => m.requirementId !== ls.id);
  // An unmet row's courses don't fill the pool's credits on their own (six
  // courses and 18 credits from two groups is still short), so it is credited
  // its fraction of them, as Major Match's percent should show.
  const cap = row.status === "met" ? ls.minCredits : Math.floor(row.fraction * ls.minCredits + EPS);
  let counted = 0;
  for (const id of row.counted) {
    const share = Math.max(0, Math.min(creditOf(id), cap - counted));
    counted += share;
    matched.push({ courseId: id, requirementId: ls.id, credits: share });
  }
  const missing = rest.missing.filter((m) => m.requirementId !== ls.id);
  if (row.status !== "met") {
    const coursesShort = Math.max(0, row.coursesNeed - row.coursesHave);
    missing.push({
      requirementId: ls.id,
      label: ls.label,
      credits: Math.max(0, ls.minCredits - counted),
      ...(coursesShort > 0 ? { courses: coursesShort } : {}),
    });
  }
  const used = new Set(matched.map((m) => m.courseId));
  const reasons = new Map<string, Assignment["uncounted"][number]["reason"]>();
  for (const u of orig.uncounted) reasons.set(u.courseId, u.reason);
  for (const u of rest.uncounted) reasons.set(u.courseId, u.reason);
  const uncounted: Assignment["uncounted"] = order
    .filter((id) => !used.has(id))
    .map((id) => ({ courseId: id, reason: reasons.get(id) ?? "requirement-already-filled" }));
  const creditsSatisfied = matched.reduce((s, m) => s + m.credits, 0);
  const creditsRequired = orig.creditsRequired;
  const pct = creditsRequired > 0 ? Math.round((creditsSatisfied / creditsRequired) * 100) : 0;
  return { matched, missing, uncounted, creditsSatisfied, creditsRequired, pct };
}
