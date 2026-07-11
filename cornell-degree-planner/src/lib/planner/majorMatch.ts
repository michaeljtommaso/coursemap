import {
  courseSatisfiesRequirement,
  type Requirement,
  type AttributeMatch,
} from "./satisfies";
import type { QualifyingRule } from "@/types/db";

/**
 * majorMatch.ts (spec 011 §1) — the real major-match engine, rebuilt as a PURE
 * module: bipartite assignment with consumption, credit-weighted, explainable,
 * ZERO bias. Replaces the greedy `.some()`-per-requirement matcher in
 * hooks/useMajorMatch.ts (audit #9 / C6). A later unit rewires the hook + panel
 * over this module's stable public seam: `assign(courses, requirements)`.
 *
 * The two-phase algorithm (Hopcroft–Karp maximum-cardinality matching on seats,
 * then greedy descending-credit fill of pools) is a DOCUMENTED approximation.
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
};

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

/** An elective group → one credit-pool requirement. */
export type MatchElectiveGroup = {
  id: string;
  name: string;
  qualifying_rule: QualifyingRule;
  min_credits: number;
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

/** One elective credit-pool. `computable: false` pools (list/category rules)
 *  contribute their minCredits to the denominator but can never be satisfied
 *  client-side yet — explainability says so ("needs data we don't have yet")
 *  rather than silently scoring zero (honest denominator, spec §1b/§1c). */
export type PoolRequirement = {
  id: string;
  kind: "pool";
  rule: QualifyingRule;
  minCredits: number;
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

/** Rules the client can evaluate against a course today. `list`/`category` need
 *  server-side data we don't ship — their pools are kept but marked
 *  non-computable (honest denominator). */
function ruleIsComputable(rule: QualifyingRule): boolean {
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
    out.push({
      id: group.id,
      kind: "pool",
      rule: group.qualifying_rule,
      minCredits: group.min_credits,
      label: group.name,
      computable: ruleIsComputable(group.qualifying_rule),
    });
  }

  return out;
}

// ─── Pool qualification ──────────────────────────────────────────────────────

/** Does `course` qualify for a pool's rule? Mirrors the id-computable rules
 *  from the old hook. list/category always false (non-computable). */
function poolQualifies(rule: QualifyingRule, course: MatchCourse): boolean {
  switch (rule.type) {
    case "open":
      return true;
    case "level": {
      const num = parseInt(course.number, 10);
      return course.subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    }
    case "outside":
      return !rule.exclude_subjects.includes(course.subject);
    case "list":
    case "category":
      return false;
  }
}

// ─── Hopcroft–Karp maximum-cardinality bipartite matching ────────────────────

/**
 * Hopcroft–Karp on a bipartite graph (left = courses, right = seats). Returns
 * `matchLeft` where matchLeft[u] = the seat index matched to course u, or -1.
 *
 * This is the audit's only-candidate case: a course that is the sole candidate
 * for seat B but also matches seat A must NOT be eaten by A when another course
 * can fill A. Greedy first-fit fails this; HK finds the augmenting path.
 */
function hopcroftKarp(adj: number[][], nLeft: number, nRight: number): number[] {
  const matchLeft = new Array<number>(nLeft).fill(-1);
  const matchRight = new Array<number>(nRight).fill(-1);
  const dist = new Array<number>(nLeft).fill(0);
  const INF = Number.MAX_SAFE_INTEGER;

  const bfs = (): boolean => {
    const queue: number[] = [];
    for (let u = 0; u < nLeft; u++) {
      if (matchLeft[u] === -1) {
        dist[u] = 0;
        queue.push(u);
      } else {
        dist[u] = INF;
      }
    }
    let found = false;
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      for (const v of adj[u]) {
        const w = matchRight[v];
        if (w === -1) {
          found = true; // reached a free right node → augmenting path exists
        } else if (dist[w] === INF) {
          dist[w] = dist[u] + 1;
          queue.push(w);
        }
      }
    }
    return found;
  };

  const dfs = (u: number): boolean => {
    for (const v of adj[u]) {
      const w = matchRight[v];
      if (w === -1 || (dist[w] === dist[u] + 1 && dfs(w))) {
        matchLeft[u] = v;
        matchRight[v] = u;
        return true;
      }
    }
    dist[u] = INF;
    return false;
  };

  while (bfs()) {
    for (let u = 0; u < nLeft; u++) {
      if (matchLeft[u] === -1) dfs(u);
    }
  }

  return matchLeft;
}

// ─── assign ──────────────────────────────────────────────────────────────────

/**
 * The stable public seam (spec §1b). Assign each course to AT MOST ONE
 * requirement — maximizing seat coverage first (Hopcroft–Karp), then filling
 * credit pools with the leftovers.
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

  // ── Phase 1: bipartite edges (course ↔ seat), then HK maximum matching. ──
  const adj: number[][] = deduped.map(() => []);
  const courseHasSeatEdge = new Array<boolean>(deduped.length).fill(false);
  for (let u = 0; u < deduped.length; u++) {
    for (let v = 0; v < seats.length; v++) {
      if (courseSatisfiesRequirement(deduped[u], seats[v].req, canonical)) {
        adj[u].push(v);
        courseHasSeatEdge[u] = true;
      }
    }
  }
  const matchLeft = hopcroftKarp(adj, deduped.length, seats.length);

  const matched: Assignment["matched"] = [];
  const missing: Assignment["missing"] = [];
  const assigned = new Array<boolean>(deduped.length).fill(false); // consumption
  const seatFilled = new Array<boolean>(seats.length).fill(false);

  for (let u = 0; u < deduped.length; u++) {
    const v = matchLeft[u];
    if (v !== -1) {
      assigned[u] = true;
      seatFilled[v] = true;
      matched.push({
        courseId: deduped[u].id,
        requirementId: seats[v].id,
        credits: seats[v].credits, // the SEAT's credits, not the course's
      });
    }
  }

  // ── Phase 2: leftovers fill computable pools, descending credit order. ──
  // `courseQualifiesSomePool` tracks whether a course could EVER count toward a
  // computable pool — feeds the uncounted reason below.
  const courseQualifiesSomePool = new Array<boolean>(deduped.length).fill(false);
  for (const pool of pools) {
    if (!pool.computable) continue;
    for (let u = 0; u < deduped.length; u++) {
      if (poolQualifies(pool.rule, deduped[u])) courseQualifiesSomePool[u] = true;
    }
  }

  for (const pool of pools) {
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
    // Candidates: still-unassigned courses that qualify, richest first.
    const candidates: number[] = [];
    for (let u = 0; u < deduped.length; u++) {
      if (!assigned[u] && poolQualifies(pool.rule, deduped[u])) candidates.push(u);
    }
    candidates.sort((a, b) => deduped[b].credits - deduped[a].credits);

    let satisfied = 0;
    for (const u of candidates) {
      if (satisfied >= pool.minCredits) break; // met — overflow stays unassigned
      assigned[u] = true;
      const counted = Math.min(deduped[u].credits, pool.minCredits - satisfied);
      satisfied += counted;
      matched.push({ courseId: deduped[u].id, requirementId: pool.id, credits: counted });
    }
    if (satisfied < pool.minCredits) {
      missing.push({
        requirementId: pool.id,
        label: pool.label,
        credits: pool.minCredits - satisfied, // the shortfall, per spec §1c
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
