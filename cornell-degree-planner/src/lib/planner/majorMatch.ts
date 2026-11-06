import {
  courseSatisfiesRequirement,
  type Requirement,
  type AttributeMatch,
} from "./satisfies";
import { hopcroftKarp } from "./bipartite";
import type { QualifyingRule } from "@/types/db";

/**
 * majorMatch.ts (spec 011 §1) — the real major-match engine, rebuilt as a PURE
 * module: bipartite assignment with consumption, credit-weighted, explainable,
 * ZERO bias. Replaces the greedy `.some()`-per-requirement matcher in
 * hooks/useMajorMatch.ts (audit #9 / C6). A later unit rewires the hook + panel
 * over this module's stable public seam: `assign(courses, requirements)`.
 *
 * The two-phase algorithm (one Hopcroft–Karp maximum-cardinality matching over
 * seats and pool course-units together, then a descending-credit credit top-up
 * of pools; spec 019 D7) is a DOCUMENTED approximation.
 * The upgrade path is min-cost max-flow (spec §1b) — needed only when
 * double-counting budgets arrive. Because consumers only ever call `assign`, the
 * internal algorithm can strengthen without breaking them.
 *
 * ZERO BIAS BY CONSTRUCTION: `assign` has no concept of a "current" program.
 * Synthetic credit courses (isCredit) are ordinary courses to it — the flag is
 * carried through untouched and never read by the algorithm. No waived/completed
 * slot special-casing exists in this module at all. That is how C6 dies: the
 * ranked list is the identical pure function applied to every program.
 */

// ─── Public input shapes ─────────────────────────────────────────────────────

/** A student's course, as the matcher sees it. `credits` is the app's
 *  credits_min; `isCredit` marks a synthetic AP/transfer/placement course
 *  (007 §2) — the matcher treats it exactly like any other course. */
export type MatchCourse = {
  id: string;
  subject: string;
  number: string;
  title?: string | null;
  attrs?: { value: string }[] | null;
  credits: number;
  isCredit?: boolean;
  /** Spec 025: a credit course granted as Cornell's "X or Y" (AP Chemistry →
   *  CHEM 2070 or CHEM 2090): the other options' ids at this position. The
   *  course may count AS any one of them (whichever satisfies the
   *  requirement), and still counts at most once. Absent on board courses. */
  altIds?: string[];
};

/** The course itself, then the course re-cast as each alternate id (spec 025
 *  "X or Y" credit) — every way one synthetic credit course can be read.
 *  The alternates carry no `altIds` of their own. */
export function courseVariants<C extends MatchCourse>(course: C): C[] {
  if (!course.altIds || course.altIds.length === 0) return [course];
  const out: C[] = [course];
  for (const alt of course.altIds) {
    const dash = alt.indexOf("-");
    out.push({
      ...course,
      id: alt,
      subject: dash >= 0 ? alt.slice(0, dash) : alt,
      number: dash >= 0 ? alt.slice(dash + 1) : "",
      altIds: undefined,
    });
  }
  return out;
}

/** A program slot, structurally. The module owns its own minimal input shape
 *  (rather than importing ProgramSlotWithData) so it stays a decoupled pure
 *  module; the future hook rewire adapts real slots into this. */
export type MatchSlot = {
  id: string;
  kind: "course" | "pattern" | "elective" | "attribute";
  course_id?: string | null;
  courses?: {
    id: string;
    subject: string;
    number: string;
    title?: string | null;
    credits_min?: number;
  } | null;
  pattern?: string | null;
  pattern_title?: string | null;
  attribute_match?: AttributeMatch | null;
  elective_group_id?: string | null;
  /** Per-seat credit override, when the authored data carries one. */
  creditsMin?: number | null;
};

/** An elective group → one pool requirement. `min_credits` is the pool's CREDIT
 *  target and `required_courses` its COURSE target (default 1); both must be met
 *  (spec 019 D6). The adapter resolves them from the program's slots. */
export type MatchElectiveGroup = {
  id: string;
  name: string;
  qualifying_rule: QualifyingRule;
  min_credits: number;
  required_courses?: number;
  /** A list rule's member course ids. */
  course_ids?: string[];
};

// ─── Requirement instances ───────────────────────────────────────────────────

/** One exact/pattern/attribute seat. Duplicate requirements stay DISTINCT —
 *  two FWS slots are two seats (dedup was audit bug #9.2). */
export type SeatRequirement = {
  id: string;
  kind: "seat";
  req: Requirement;
  credits: number;
  label: string;
};

/** One elective pool: met when it holds `requiredCourses` qualifying courses
 *  AND `minCredits` credits (spec 019 D6). `computable: false` pools (category
 *  rules, and list rules with no member courses) contribute their minCredits to
 *  the denominator but can never be satisfied client-side yet — explainability
 *  says so ("needs data we don't have yet") rather than silently scoring zero
 *  (honest denominator, spec §1b/§1c). */
export type PoolRequirement = {
  id: string;
  kind: "pool";
  rule: QualifyingRule;
  minCredits: number;
  requiredCourses: number;
  /** A list rule's member course ids (empty for other rules). */
  courseIds: string[];
  label: string;
  computable: boolean;
};

export type RequirementInstance = SeatRequirement | PoolRequirement;

// ─── Assignment output ───────────────────────────────────────────────────────

export type Assignment = {
  /** Each entry's `credits` is the COUNTED contribution: for a seat, the seat's
   *  credits (a 4-credit course in a 3-credit seat counts 3); for a pool, the
   *  course's capped share so a pool never counts past its minCredits. Summing
   *  `matched[].credits` therefore equals `creditsSatisfied` exactly. */
  matched: { courseId: string; requirementId: string; credits: number }[];
  missing: {
    requirementId: string;
    label: string;
    credits: number;
    /** For a pool: how many more courses it needs (absent when the course
     *  count is met and only credits are short). */
    courses?: number;
    reason?: "no-data";
  }[];
  uncounted: {
    courseId: string;
    reason: "no-requirement-matched" | "requirement-already-filled";
  }[];
  creditsSatisfied: number;
  creditsRequired: number;
  /** 0–100, rounded. */
  pct: number;
};

// ─── programToRequirements ───────────────────────────────────────────────────

/** Default per-seat credits for pattern/attribute slots lacking any credit data
 *  (course slots fall back to their joined course's credits_min first). A
 *  Cornell course is 3 credits far more often than any other value. */
const DEFAULT_SEAT_CREDITS = 3;

/** Rules the client can evaluate against a course today. A `list` rule is
 *  computable once it names its members; `category` needs data we don't ship —
 *  its pools are kept but marked non-computable (honest denominator). */
function ruleIsComputable(rule: QualifyingRule, courseIds: readonly string[]): boolean {
  if (rule.type === "list") return courseIds.length > 0;
  return rule.type === "open" || rule.type === "level" || rule.type === "outside";
}

/**
 * Build requirement instances from a program's existing data model. Seats come
 * from course/pattern/attribute slots (elective-kind slots are represented by
 * their group's pool, not a seat); pools come from the electiveGroups array.
 * Duplicate requirements are NEVER deduplicated.
 */
export function programToRequirements(data: {
  slots: MatchSlot[];
  electiveGroups: MatchElectiveGroup[];
}): RequirementInstance[] {
  const out: RequirementInstance[] = [];

  for (const slot of data.slots) {
    if (slot.kind === "course") {
      const courseId = slot.course_id ?? slot.courses?.id;
      if (!courseId) continue; // malformed course slot — nothing to match on
      const credits = slot.creditsMin ?? slot.courses?.credits_min ?? DEFAULT_SEAT_CREDITS;
      const label = slot.courses
        ? `${slot.courses.subject} ${slot.courses.number}`
        : courseId.replace(/-/g, " ");
      out.push({
        id: slot.id,
        kind: "seat",
        req: { kind: "course", courseId },
        credits,
        label,
      });
    } else if (slot.kind === "pattern") {
      if (!slot.pattern) continue;
      const credits = slot.creditsMin ?? DEFAULT_SEAT_CREDITS;
      out.push({
        id: slot.id,
        kind: "seat",
        req: { kind: "pattern", pattern: slot.pattern },
        credits,
        label: slot.pattern_title ?? slot.pattern.replace(/-/g, " "),
      });
    } else if (slot.kind === "attribute") {
      const credits = slot.creditsMin ?? DEFAULT_SEAT_CREDITS;
      // A null/absent match is an unmatchable requirement, not a crash: an empty
      // `anyOf` matches nothing (satisfies.ts), so the seat still counts toward
      // the denominator and always ends up `missing` (honest).
      const match: AttributeMatch = slot.attribute_match ?? { anyOf: [] };
      out.push({
        id: slot.id,
        kind: "seat",
        req: { kind: "attribute", match },
        credits,
        label: slot.pattern_title ?? "Requirement",
      });
    }
    // `elective`-kind slots are ignored here — the group's pool below carries
    // the requirement (spec §1a: one POOL requirement per elective group).
  }

  for (const group of data.electiveGroups) {
    const courseIds = group.course_ids ?? [];
    out.push({
      id: group.id,
      kind: "pool",
      rule: group.qualifying_rule,
      minCredits: group.min_credits,
      requiredCourses: Math.max(1, group.required_courses ?? 1),
      courseIds,
      label: group.name,
      computable: ruleIsComputable(group.qualifying_rule, courseIds),
    });
  }

  return out;
}

// ─── Pool qualification ──────────────────────────────────────────────────────

/** Does `course` qualify for a pool's rule? The ONE place pool-rule semantics
 *  live — the catalog filter (useCourseFilters) calls this too. `level` honours
 *  its optional upper bound; `list` matches by canonical id; `category` is
 *  never true (non-computable). */
export function poolQualifies(
  rule: QualifyingRule,
  course: { id: string; subject: string; number: string },
  courseIds: readonly string[] = [],
  canonical: (id: string) => string = (id) => id
): boolean {
  switch (rule.type) {
    case "open":
      return true;
    case "level": {
      const num = parseInt(course.number, 10);
      return (
        course.subject === rule.subject &&
        !Number.isNaN(num) &&
        num >= rule.min_number &&
        (rule.max_number == null || num <= rule.max_number)
      );
    }
    case "outside":
      return !rule.exclude_subjects.includes(course.subject);
    case "list": {
      const id = canonical(course.id);
      return courseIds.some((m) => canonical(m) === id);
    }
    case "category":
      return false;
  }
}

// ─── assign ──────────────────────────────────────────────────────────────────

/**
 * The stable public seam (spec §1b). Assign each course to AT MOST ONE
 * requirement — one maximum matching over seats and pool course-units
 * (Hopcroft–Karp), then a credit top-up of pools from the leftovers.
 *
 * Consumption invariant: every course appears in at most one entry of `matched`
 * (or in `uncounted`), never in two. Every matched courseId is unique.
 */
export function assign(
  courses: MatchCourse[],
  requirements: RequirementInstance[],
  canonical: (id: string) => string = (id) => id
): Assignment {
  // ── Cross-listing: canonicalize ids and dedupe so ENGRD 2110 + CS 2110 can
  // never double-fill. First occurrence wins for identity/title; credits keep
  // the MAX across duplicates (a richer listing shouldn't lose credits). ──
  const deduped: MatchCourse[] = [];
  const byCanonical = new Map<string, number>(); // canonical id → deduped index
  for (const c of courses) {
    const cid = canonical(c.id);
    const existing = byCanonical.get(cid);
    if (existing === undefined) {
      byCanonical.set(cid, deduped.length);
      deduped.push({ ...c, id: cid });
    } else {
      const prev = deduped[existing];
      if (c.credits > prev.credits) prev.credits = c.credits;
    }
  }

  const seats: SeatRequirement[] = [];
  const pools: PoolRequirement[] = [];
  for (const r of requirements) {
    if (r.kind === "seat") seats.push(r);
    else pools.push(r);
  }

  // ── Phase 1: ONE maximum matching over seats AND pool units (spec 019 D7).
  // A computable pool that needs N courses contributes N "units", each filled
  // by one qualifying course, so seats and pools compete in the same matching
  // and a broad pool (an open advisor elective) can't take a course a narrower
  // pool needed when another assignment fills both. Seats come first in every
  // adjacency list, so ties favour seats. ──
  // A credit course with alternates (spec 025 "X or Y") qualifies when any
  // one reading of it does; it is still one course and fills one unit.
  const qualifiesPool = (pool: PoolRequirement, c: MatchCourse) =>
    courseVariants(c).some((v) => poolQualifies(pool.rule, v, pool.courseIds, canonical));

  // Units are ordered most-specific rule first (a named list, then a level
  // range, then "outside a subject", then "any course"), so when two
  // assignments fill equally many requirements the broad pool is the one left
  // short — "advisor-approved elective" waits, "ECE 3100 or 3250" doesn't.
  const SPECIFICITY: Record<QualifyingRule["type"], number> = {
    list: 0,
    level: 1,
    outside: 2,
    open: 3,
    category: 4,
  };
  const poolOrder = pools
    .map((_, p) => p)
    .filter((p) => pools[p].computable)
    .sort((a, b) => SPECIFICITY[pools[a].rule.type] - SPECIFICITY[pools[b].rule.type] || a - b);
  const unitPool: number[] = []; // right node (after the seats) → pool index
  for (const p of poolOrder) {
    for (let k = 0; k < pools[p].requiredCourses; k++) unitPool.push(p);
  }

  const adj: number[][] = deduped.map(() => []);
  const courseHasSeatEdge = new Array<boolean>(deduped.length).fill(false);
  // `courseQualifiesSomePool` tracks whether a course could EVER count toward a
  // computable pool — feeds the uncounted reason below.
  const courseQualifiesSomePool = new Array<boolean>(deduped.length).fill(false);
  for (let u = 0; u < deduped.length; u++) {
    for (let v = 0; v < seats.length; v++) {
      if (courseVariants(deduped[u]).some((c) => courseSatisfiesRequirement(c, seats[v].req, canonical))) {
        adj[u].push(v);
        courseHasSeatEdge[u] = true;
      }
    }
    for (let p = 0; p < pools.length; p++) {
      if (pools[p].computable && qualifiesPool(pools[p], deduped[u])) courseQualifiesSomePool[u] = true;
    }
    for (let k = 0; k < unitPool.length; k++) {
      if (qualifiesPool(pools[unitPool[k]], deduped[u])) adj[u].push(seats.length + k);
    }
  }
  // Offer courses to the matching richest first (stable), so when several
  // courses could fill a pool unit the bigger one takes it and fewer courses
  // are spent reaching the pool's credits.
  const order = deduped.map((_, u) => u).sort((a, b) => deduped[b].credits - deduped[a].credits);
  const matchOrdered = hopcroftKarp(
    order.map((u) => adj[u]),
    deduped.length,
    seats.length + unitPool.length
  );
  const matchLeft = new Array<number>(deduped.length).fill(-1);
  order.forEach((u, i) => (matchLeft[u] = matchOrdered[i]));

  const matched: Assignment["matched"] = [];
  const missing: Assignment["missing"] = [];
  const assigned = new Array<boolean>(deduped.length).fill(false); // consumption
  const seatFilled = new Array<boolean>(seats.length).fill(false);
  const poolCourses: number[][] = pools.map(() => []);

  for (let u = 0; u < deduped.length; u++) {
    const v = matchLeft[u];
    if (v === -1) continue;
    assigned[u] = true;
    if (v < seats.length) {
      seatFilled[v] = true;
      matched.push({
        courseId: deduped[u].id,
        requirementId: seats[v].id,
        credits: seats[v].credits, // the SEAT's credits, not the course's
      });
    } else {
      poolCourses[unitPool[v - seats.length]].push(u);
    }
  }

  // ── Phase 2: credit the pools. Matched courses count richest first, capped
  // so a pool never counts past its minCredits; a pool whose courses fall short
  // on credits tops up from still-unassigned qualifying courses. Pools top up
  // most-specific first (same order as the units), and a top-up prefers the
  // course that fits the FEWEST pools, so an open pool doesn't take the spare a
  // CS-only pool needed while a non-CS spare sits unused. ──
  const poolFan = deduped.map((c) => pools.filter((pl) => pl.computable && qualifiesPool(pl, c)).length);
  const phase2Order = [...poolOrder, ...pools.map((_, p) => p).filter((p) => !pools[p].computable)];
  for (const p of phase2Order) {
    const pool = pools[p];
    if (!pool.computable) {
      // Never satisfiable client-side yet: whole minCredits is missing, flagged.
      missing.push({
        requirementId: pool.id,
        label: pool.label,
        credits: pool.minCredits,
        reason: "no-data",
      });
      continue;
    }
    const members = [...poolCourses[p]].sort((a, b) => deduped[b].credits - deduped[a].credits);
    let satisfied = members.reduce((sum, u) => sum + deduped[u].credits, 0);
    if (satisfied < pool.minCredits) {
      const extras: number[] = [];
      for (let u = 0; u < deduped.length; u++) {
        // A 0-credit course can't help a credit shortfall; leave it uncounted.
        if (!assigned[u] && deduped[u].credits > 0 && qualifiesPool(pool, deduped[u])) extras.push(u);
      }
      extras.sort((a, b) => poolFan[a] - poolFan[b] || deduped[b].credits - deduped[a].credits);
      for (const u of extras) {
        if (satisfied >= pool.minCredits) break;
        assigned[u] = true;
        members.push(u);
        satisfied += deduped[u].credits;
      }
    }

    let counted = 0;
    for (const u of members) {
      const share = Math.min(deduped[u].credits, pool.minCredits - counted);
      counted += share;
      matched.push({ courseId: deduped[u].id, requirementId: pool.id, credits: share });
    }
    const coursesShort = pool.requiredCourses - members.length;
    if (counted < pool.minCredits || coursesShort > 0) {
      missing.push({
        requirementId: pool.id,
        label: pool.label,
        credits: pool.minCredits - counted, // the shortfall, per spec §1c
        ...(coursesShort > 0 ? { courses: coursesShort } : {}),
      });
    }
  }

  // ── Unfilled seats → missing (full seat credits). ──
  for (let v = 0; v < seats.length; v++) {
    if (!seatFilled[v]) {
      missing.push({
        requirementId: seats[v].id,
        label: seats[v].label,
        credits: seats[v].credits,
      });
    }
  }

  // ── Uncounted: every course that ended up in no assignment. ──
  const uncounted: Assignment["uncounted"] = [];
  for (let u = 0; u < deduped.length; u++) {
    if (assigned[u]) continue;
    const couldMatch = courseHasSeatEdge[u] || courseQualifiesSomePool[u];
    uncounted.push({
      courseId: deduped[u].id,
      reason: couldMatch ? "requirement-already-filled" : "no-requirement-matched",
    });
  }

  const creditsSatisfied = matched.reduce((sum, m) => sum + m.credits, 0);
  const creditsRequired =
    seats.reduce((sum, s) => sum + s.credits, 0) +
    pools.reduce((sum, p) => sum + p.minCredits, 0);
  const pct = creditsRequired > 0 ? Math.round((creditsSatisfied / creditsRequired) * 100) : 0;

  return { matched, missing, uncounted, creditsSatisfied, creditsRequired, pct };
}
