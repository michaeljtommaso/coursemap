import { courseMatchesRule, type RuleContext } from "./rules";
import type {
  AnyOfRow,
  CourseRule,
  CreditsRow,
  DistCourse,
  DistributionRow,
  PoolRow,
  RowLimit,
  RowProgress,
  SeatRow,
} from "./types";

/**
 * evaluateRow.ts (spec 019 D8) — exact single-row evaluators for the
 * Distribution engine. Each evaluator receives the courses a row is OFFERED
 * and returns the best subset it can count, so it is monotone: offering more
 * courses never makes a row worse. The layer search (search.ts) decides which
 * row each contested course is offered to; these functions never consume.
 *
 * Fractions (0–1, exactly 1 iff met), each the MEAN of the row's components:
 *   seat          0 or 1.
 *   pool          min(1, courses/need), min(1, credits/need), and one
 *                 min(1, have/min) per limit minimum (minCourses, minCredits).
 *   credits       the pool formula with no course target, so a credits row
 *                 without limit minimums is min(1, credits/need).
 *   distribution  min(1, courses/requiredCourses),
 *                 min(1, categories covered/minDistinctCategories), and
 *                 Σ min(count, min) / Σ min over perCategory minimums.
 *   anyOf         the chosen child's fraction.
 * A component whose target is 0 is left out; a row with no components is met.
 *
 * Exactness: pools and credits rows run a branch-and-bound over their
 * candidates; distribution rows run a min-cost flow (one category per course,
 * or two with a double-count budget and no per-subject cap) or, for the shapes
 * a flow cannot express, a branch-and-bound. Every search has a work budget;
 * past it the result is flagged `exact: false`. A met result is still proven
 * (the subset it reports satisfies the row); an unmet one is not, and the
 * engine shows it as "can't check this automatically".
 */

export type EvalRow = SeatRow | PoolRow | DistributionRow | CreditsRow | AnyOfRow;

const EPS = 1e-9;

/** Work budget for one subset or distribution search. */
export const EVAL_STEP_BUDGET = 200_000;

export type Env = {
  /** Canonical, deduped, board order. Indices into this array identify courses. */
  courses: DistCourse[];
  /** courseMatchesRule, memoized per (rule object, course). */
  matches: (i: number, rule: CourseRule) => boolean;
  /** anyOf options whose own appliesTo excludes the student: they stay in the
   *  parent's children but are never met and count nothing. */
  excluded: WeakSet<object>;
};

export function makeEnv(courses: DistCourse[], ruleCtx: RuleContext, excluded = new WeakSet<object>()): Env {
  const cache = new WeakMap<CourseRule, Int8Array>();
  return {
    courses,
    excluded,
    matches(i, rule) {
      let memo = cache.get(rule);
      if (!memo) {
        memo = new Int8Array(courses.length);
        cache.set(rule, memo);
      }
      if (memo[i] === 0) memo[i] = courseMatchesRule(courses[i], rule, ruleCtx) ? 1 : -1;
      return memo[i] === 1;
    },
  };
}

export type Evaluation = {
  met: boolean;
  fraction: number;
  /** Course indices the row counts, ascending (board order). */
  counted: number[];
  /** Distribution rows: course index → category ids it fills, authored order. */
  categories?: Map<number, string[]>;
  progress: RowProgress;
  /** False when a work budget ran out before the result was proven optimal. */
  exact: boolean;
  /** anyOf rows: one evaluation per child, and which child was chosen. */
  children?: Evaluation[];
  chosen?: number;
};

export type EvalCall = {
  /** Courses this row may count (a consuming row: the courses assigned to it). */
  offered: readonly number[];
  /** What credits rows read (always, whatever they are offered): every course,
   *  including those an exclusive row counted. */
  all: readonly number[];
  /** Preference among equally good courses (lower first); ties → board order. */
  rank?: (i: number) => number;
};

function prefSort(list: readonly number[], rank?: (i: number) => number): number[] {
  return [...list].sort((a, b) => (rank ? rank(a) - rank(b) : 0) || a - b);
}

const ascending = (list: readonly number[]) => [...list].sort((a, b) => a - b);

/** Can offering course `i` to this row change its evaluation? Credits rows
 *  never depend on what they are offered (they read every course). */
export function relevantTo(row: EvalRow, i: number, env: Env): boolean {
  switch (row.kind) {
    case "seat":
    case "pool":
      return env.matches(i, row.rule);
    case "credits":
      return false;
    case "distribution":
      return (row.rule == null || env.matches(i, row.rule)) && row.categories.some((c) => env.matches(i, c.rule));
    case "anyOf":
      return row.rows.some((child) => !env.excluded.has(child) && relevantTo(child, i, env));
  }
}

/** Could this row ever count course `i`? (Used to fence courses off
 *  conservatively when the exclusive pass cannot be trusted.) */
export function touches(row: EvalRow, i: number, env: Env): boolean {
  if (row.kind === "credits") return env.matches(i, row.rule);
  if (row.kind === "anyOf") return row.rows.some((child) => !env.excluded.has(child) && touches(child, i, env));
  return relevantTo(row, i, env);
}

export function evaluateRow(row: EvalRow, call: EvalCall, env: Env): Evaluation {
  switch (row.kind) {
    case "seat":
      return evalSeat(row, call, env);
    case "pool":
      return evalPool(row, call, env);
    case "credits":
      return evalCredits(row, call, env);
    case "distribution":
      return evalDistribution(row, call, env);
    case "anyOf":
      return evalAnyOf(row, call, env);
  }
}

// ─── seat ────────────────────────────────────────────────────────────────────

function evalSeat(row: SeatRow, call: EvalCall, env: Env): Evaluation {
  const cands = prefSort(
    call.offered.filter((i) => env.matches(i, row.rule)),
    call.rank
  );
  if (cands.length === 0) {
    return { met: false, fraction: 0, counted: [], progress: { coursesHave: 0, coursesNeed: 1 }, exact: true };
  }
  return { met: true, fraction: 1, counted: [cands[0]], progress: { coursesHave: 1, coursesNeed: 1 }, exact: true };
}

// ─── pool / credits: exact subset search ─────────────────────────────────────

type SubsetSpec = {
  reqCourses: number;
  reqCredits: number;
  maxPerSubject?: number;
  limits: readonly RowLimit[];
};

type SubsetResult = { chosen: number[]; credits: number; fraction: number; met: boolean; exact: boolean };

/**
 * Pick the best subset of `cands` (already in preference order).
 *   minimal  (pools): maximize the fraction, then use as FEW courses as
 *            possible — a met pool counts only what it needs, leaving the rest
 *            uncounted rather than claimed.
 *   maximal  (credits): maximize the fraction, then the credits counted — a
 *            credit total lists every course it can.
 * Hard constraints (maxPerSubject, limit maximums) are never violated; limit
 * minimums are fraction components. Ties go to the first subset found by an
 * include-first walk in preference order.
 */
function solveSubset(cands: readonly number[], spec: SubsetSpec, mode: "minimal" | "maximal", env: Env): SubsetResult {
  const n = cands.length;
  const limits = spec.limits;
  const L = limits.length;
  const cr = cands.map((i) => env.courses[i].credits);
  const subjectIds = new Map<string, number>();
  const subj = cands.map((i) => {
    const s = env.courses[i].subject;
    let id = subjectIds.get(s);
    if (id === undefined) {
      id = subjectIds.size;
      subjectIds.set(s, id);
    }
    return id;
  });
  const inLim = cands.map((i) => limits.map((l) => env.matches(i, l.rule)));
  const maxSubj = spec.maxPerSubject ?? Infinity;
  const hasHard =
    spec.maxPerSubject != null || limits.some((l) => l.maxCourses != null || l.maxCredits != null);

  let count = 0;
  let credits = 0;
  const subjCount = new Array<number>(subjectIds.size).fill(0);
  const limCount = new Array<number>(L).fill(0);
  const limCred = new Array<number>(L).fill(0);
  const stack: number[] = [];

  const fractionOf = (cnt: number, crd: number, lc: readonly number[], lcr: readonly number[]): number => {
    let sum = 0;
    let parts = 0;
    if (spec.reqCourses > 0) {
      sum += Math.min(1, cnt / spec.reqCourses);
      parts++;
    }
    if (spec.reqCredits > 0) {
      sum += Math.min(1, crd / spec.reqCredits);
      parts++;
    }
    for (let l = 0; l < L; l++) {
      const lim = limits[l];
      if ((lim.minCourses ?? 0) > 0) {
        sum += Math.min(1, lc[l] / (lim.minCourses as number));
        parts++;
      }
      if ((lim.minCredits ?? 0) > 0) {
        sum += Math.min(1, lcr[l] / (lim.minCredits as number));
        parts++;
      }
    }
    return parts === 0 ? 1 : sum / parts;
  };
  const metNow = (): boolean =>
    count >= spec.reqCourses &&
    credits >= spec.reqCredits - EPS &&
    limits.every((lim, l) => limCount[l] >= (lim.minCourses ?? 0) && limCred[l] >= (lim.minCredits ?? 0) - EPS);
  const fits = (j: number): boolean => {
    if (subjCount[subj[j]] + 1 > maxSubj) return false;
    for (let l = 0; l < L; l++) {
      if (!inLim[j][l]) continue;
      const lim = limits[l];
      if (lim.maxCourses != null && limCount[l] + 1 > lim.maxCourses) return false;
      if (lim.maxCredits != null && limCred[l] + cr[j] > lim.maxCredits + EPS) return false;
    }
    return true;
  };
  const apply = (j: number, sign: 1 | -1) => {
    count += sign;
    credits += sign * cr[j];
    subjCount[subj[j]] += sign;
    for (let l = 0; l < L; l++) {
      if (inLim[j][l]) {
        limCount[l] += sign;
        limCred[l] += sign * cr[j];
      }
    }
    if (sign === 1) stack.push(cands[j]);
    else stack.pop();
  };

  // Credits rows without hard caps: every candidate counts.
  if (mode === "maximal" && !hasHard) {
    for (let j = 0; j < n; j++) apply(j, 1);
    return { chosen: stack.slice(), credits, fraction: fractionOf(count, credits, limCount, limCred), met: metNow(), exact: true };
  }

  let best = {
    chosen: [] as number[],
    fraction: fractionOf(0, 0, limCount, limCred),
    met: metNow(),
    credits: 0,
    count: 0,
  };
  let steps = 0;
  let aborted = false;

  const consider = () => {
    const f = fractionOf(count, credits, limCount, limCred);
    const tie = f > best.fraction - EPS;
    const better =
      f > best.fraction + EPS ||
      (tie && (mode === "minimal" ? count < best.count : credits > best.credits + EPS));
    if (better) best = { chosen: stack.slice(), fraction: f, met: metNow(), credits, count };
  };

  const dfs = (p: number): void => {
    if (aborted) return;
    if (++steps > EVAL_STEP_BUDGET) {
      aborted = true;
      return;
    }
    if (mode === "minimal" && metNow()) {
      consider(); // adding more only spends courses
      return;
    }
    if (p === n) {
      consider();
      return;
    }
    // Optimistic bound: every remaining course that fits on its own is added.
    let oc = count;
    let ocr = credits;
    const olc = limCount.slice();
    const olcr = limCred.slice();
    for (let j = p; j < n; j++) {
      if (!fits(j)) continue;
      oc++;
      ocr += cr[j];
      for (let l = 0; l < L; l++) {
        if (inLim[j][l]) {
          olc[l]++;
          olcr[l] += cr[j];
        }
      }
    }
    const ub = fractionOf(oc, ocr, olc, olcr);
    if (ub < best.fraction - EPS) return;
    if (ub < best.fraction + EPS) {
      if (mode === "minimal") {
        // The current set is not met (checked above), so a met completion
        // needs at least one more course and at least reqCourses in total.
        const lb = best.met ? Math.max(count + 1, spec.reqCourses) : count;
        if (lb >= best.count) return;
      } else if (ocr <= best.credits + EPS) {
        return;
      }
    }
    if (fits(p)) {
      apply(p, 1);
      dfs(p + 1);
      apply(p, -1);
    }
    dfs(p + 1);
  };
  dfs(0);

  return { chosen: best.chosen, credits: best.credits, fraction: best.fraction, met: best.met, exact: !aborted };
}

function evalPool(row: PoolRow, call: EvalCall, env: Env): Evaluation {
  const cands = prefSort(
    call.offered.filter((i) => env.matches(i, row.rule)),
    call.rank
  );
  const s = solveSubset(
    cands,
    {
      reqCourses: row.requiredCourses,
      reqCredits: row.requiredCredits,
      maxPerSubject: row.maxPerSubject,
      limits: row.limits ?? [],
    },
    "minimal",
    env
  );
  return {
    met: s.met,
    fraction: s.met ? 1 : s.fraction,
    counted: ascending(s.chosen),
    progress: {
      coursesHave: s.chosen.length,
      coursesNeed: row.requiredCourses,
      creditsHave: s.credits,
      creditsNeed: row.requiredCredits,
    },
    exact: s.exact,
  };
}

function evalCredits(row: CreditsRow, call: EvalCall, env: Env): Evaluation {
  const cands = call.all.filter((i) => env.matches(i, row.rule)); // board order
  const spec: SubsetSpec = { reqCourses: 0, reqCredits: row.requiredCredits, limits: row.limits ?? [] };

  let s: SubsetResult;
  if (row.sameSubject) {
    // The best single subject; subjects are tried in board order of first
    // appearance, and a later subject must be strictly better to win.
    const groups = new Map<string, number[]>();
    for (const i of cands) {
      const subject = env.courses[i].subject;
      const g = groups.get(subject);
      if (g) g.push(i);
      else groups.set(subject, [i]);
    }
    s = { chosen: [], credits: 0, fraction: solveSubset([], spec, "maximal", env).fraction, met: false, exact: true };
    let allExact = true;
    let first = true;
    for (const g of groups.values()) {
      const r = solveSubset(g, spec, "maximal", env);
      allExact &&= r.exact;
      const better =
        first ||
        (r.met && !s.met) ||
        (r.met === s.met &&
          (r.fraction > s.fraction + EPS || (r.fraction > s.fraction - EPS && r.credits > s.credits + EPS)));
      if (better) s = r;
      first = false;
    }
    if (groups.size === 0) s = solveSubset([], spec, "maximal", env);
    s = { ...s, exact: s.met || allExact };
  } else {
    s = solveSubset(cands, spec, "maximal", env);
  }

  return {
    met: s.met,
    fraction: s.met ? 1 : s.fraction,
    counted: ascending(s.chosen),
    progress: { creditsHave: s.credits, creditsNeed: row.requiredCredits },
    exact: s.met || s.exact,
  };
}

// ─── distribution ────────────────────────────────────────────────────────────

type DistSpec = {
  R: number;
  D: number;
  minK: number[];
  maxK: number[];
  maxCat: number;
  budget: number;
  maxPerSubject?: number;
};

function distFraction(spec: DistSpec, courses: number, covered: number, minsHave: number, sumMin: number): number {
  let sum = 0;
  let parts = 0;
  if (spec.R > 0) {
    sum += Math.min(1, courses / spec.R);
    parts++;
  }
  if (spec.D > 0) {
    sum += Math.min(1, covered / spec.D);
    parts++;
  }
  if (sumMin > 0) {
    sum += minsHave / sumMin;
    parts++;
  }
  return parts === 0 ? 1 : sum / parts;
}

function evalDistribution(row: DistributionRow, call: EvalCall, env: Env): Evaluation {
  const cats = row.categories;
  const m = cats.length;
  const elig: number[] = [];
  const kOf: number[][] = [];
  for (const i of prefSort(call.offered, call.rank)) {
    if (row.rule && !env.matches(i, row.rule)) continue;
    const ks: number[] = [];
    for (let k = 0; k < m; k++) if (env.matches(i, cats[k].rule)) ks.push(k);
    if (ks.length > 0) {
      elig.push(i);
      kOf.push(ks);
    }
  }
  const spec: DistSpec = {
    R: Math.max(0, row.requiredCourses),
    D: Math.max(0, row.minDistinctCategories),
    minK: cats.map((c) => Math.max(0, row.perCategory?.[c.id]?.min ?? 0)),
    maxK: cats.map((c) => row.perCategory?.[c.id]?.max ?? Infinity),
    maxCat: Math.max(1, row.maxCategoriesPerCourse ?? 1),
    budget: row.maxDoubleCountCourses ?? Infinity,
    maxPerSubject: row.maxPerSubject,
  };

  const doubles = spec.maxCat >= 2 && spec.budget > 0;
  let assignment: number[][];
  let exact = true;
  if (!doubles || (spec.maxCat === 2 && spec.maxPerSubject == null)) {
    assignment = distFlow(elig, kOf, spec, env, doubles);
  } else {
    const r = distSearch(elig, kOf, spec, env);
    assignment = r.assignment;
    exact = r.exact;
  }

  // Summarize the assignment.
  const catCount = new Array<number>(m).fill(0);
  const categories = new Map<number, string[]>();
  const counted: number[] = [];
  elig.forEach((i, j) => {
    const ks = [...assignment[j]].sort((a, b) => a - b);
    if (ks.length === 0) return;
    counted.push(i);
    for (const k of ks) catCount[k]++;
    categories.set(
      i,
      ks.map((k) => cats[k].id)
    );
  });
  counted.sort((a, b) => a - b);
  const sumMin = spec.minK.reduce((a, b) => a + b, 0);
  const minsHave = spec.minK.reduce((acc, mk, k) => acc + Math.min(mk, catCount[k]), 0);
  const coveredIds = cats.filter((_, k) => catCount[k] > 0).map((c) => c.id);
  const met =
    counted.length >= spec.R && coveredIds.length >= spec.D && spec.minK.every((mk, k) => catCount[k] >= mk);
  const missing = cats
    .filter((_, k) => catCount[k] < spec.minK[k] || (coveredIds.length < spec.D && catCount[k] === 0))
    .map((c) => c.id);

  return {
    met,
    fraction: met ? 1 : distFraction(spec, counted.length, coveredIds.length, minsHave, sumMin),
    counted,
    categories,
    progress: {
      coursesHave: counted.length,
      coursesNeed: spec.R,
      categoriesHave: coveredIds,
      categoriesNeed: spec.D,
      missingCategories: missing,
    },
    exact: met || exact,
  };
}

/** A small successive-shortest-path min-cost flow (integer costs, SPFA). */
class MinCostFlow {
  to: number[] = [];
  cap: number[] = [];
  cost: number[] = [];
  next: number[] = [];
  head: number[];

  constructor(nodes: number) {
    this.head = new Array<number>(nodes).fill(-1);
  }

  add(u: number, v: number, cap: number, cost: number): number {
    const e = this.to.length;
    this.to.push(v, u);
    this.cap.push(cap, 0);
    this.cost.push(cost, -cost);
    this.next.push(this.head[u], this.head[v]);
    this.head[u] = e;
    this.head[v] = e + 1;
    return e;
  }

  flowOn(e: number): number {
    return this.cap[e ^ 1];
  }

  /** Augment along cheapest paths while they have negative cost: the result
   *  is a minimum-cost flow over all flow values (the graph starts acyclic). */
  run(s: number, t: number): void {
    const n = this.head.length;
    for (;;) {
      const dist = new Array<number>(n).fill(Infinity);
      const prev = new Array<number>(n).fill(-1);
      const inQueue = new Array<boolean>(n).fill(false);
      dist[s] = 0;
      const queue = [s];
      inQueue[s] = true;
      for (let qh = 0; qh < queue.length; qh++) {
        const u = queue[qh];
        inQueue[u] = false;
        for (let e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] <= 0) continue;
          const v = this.to[e];
          const d = dist[u] + this.cost[e];
          if (d < dist[v]) {
            dist[v] = d;
            prev[v] = e;
            if (!inQueue[v]) {
              inQueue[v] = true;
              queue.push(v);
            }
          }
        }
      }
      if (!(dist[t] < 0)) return;
      let f = Infinity;
      for (let v = t; v !== s; v = this.to[prev[v] ^ 1]) f = Math.min(f, this.cap[prev[v]]);
      for (let v = t; v !== s; v = this.to[prev[v] ^ 1]) {
        this.cap[prev[v]] -= f;
        this.cap[prev[v] ^ 1] += f;
      }
    }
  }
}

/**
 * Exact distribution assignment as a max-reward flow. Each course takes a
 * primary unit (through its subject, when maxPerSubject caps it) and, when a
 * double-count budget exists, one secondary unit drawn from a shared budget
 * node; each unit fills one category, never the same one twice. Rewards are
 * the fraction's components, linearized with parallel arcs of decreasing
 * reward (concave caps): course count up to R, coverage up to D through a
 * shared coverage node, and each category's units up to its minimum.
 * Integer weights keep the arithmetic exact.
 *
 * A course carrying only a secondary unit is read back as a single-category
 * course; that reading is never worse than the flow's own value, and every
 * valid assignment is a flow of equal value, so the reading is optimal. (With a
 * per-subject cap that reading could break the cap — that shape goes to
 * distSearch instead.)
 */
function distFlow(elig: number[], kOf: number[][], spec: DistSpec, env: Env, doubles: boolean): number[][] {
  const n = elig.length;
  const m = spec.minK.length;
  const BIG = n + m + 1;
  const sumMin = spec.minK.reduce((a, b) => a + b, 0);
  const scale = (spec.R || 1) * (spec.D || 1) * (sumMin || 1);
  const wN = spec.R > 0 ? scale / spec.R : 0;
  const wD = spec.D > 0 ? scale / spec.D : 0;
  const wM = sumMin > 0 ? scale / sumMin : 0;

  const S = 0;
  const T = 1;
  const P = 2;
  const BUD = 3;
  const V = 4;
  let next = 5;
  const subjectNode = new Map<string, number>();
  if (spec.maxPerSubject != null) {
    for (const i of elig) {
      const s = env.courses[i].subject;
      if (!subjectNode.has(s)) subjectNode.set(s, next++);
    }
  }
  const courseNode = elig.map(() => next++);
  const catIn = spec.minK.map(() => next++);
  const catOut = spec.minK.map(() => next++);
  const g = new MinCostFlow(next);

  if (spec.R > 0) g.add(S, P, spec.R, -wN);
  g.add(S, P, BIG, 0);
  if (doubles) g.add(S, BUD, Math.min(spec.budget, BIG), 0);
  for (const [, node] of subjectNode) g.add(P, node, Math.max(0, spec.maxPerSubject as number), 0);

  const catEdges: { e: number; k: number }[][] = [];
  elig.forEach((i, j) => {
    const from = spec.maxPerSubject != null ? (subjectNode.get(env.courses[i].subject) as number) : P;
    g.add(from, courseNode[j], 1, 0);
    if (doubles && kOf[j].length >= 2) g.add(BUD, courseNode[j], 1, 0);
    catEdges.push(kOf[j].map((k) => ({ e: g.add(courseNode[j], catIn[k], 1, 0), k })));
  });
  for (let k = 0; k < m; k++) {
    g.add(catIn[k], catOut[k], Number.isFinite(spec.maxK[k]) ? Math.max(0, spec.maxK[k]) : BIG, 0);
    g.add(catOut[k], V, 1, spec.minK[k] >= 1 ? -wM : 0);
    if (spec.minK[k] > 1) g.add(catOut[k], T, spec.minK[k] - 1, -wM);
    g.add(catOut[k], T, BIG, 0);
  }
  if (spec.D > 0) g.add(V, T, spec.D, -wD);
  g.add(V, T, BIG, 0);

  g.run(S, T);
  return catEdges.map((edges) => edges.filter(({ e }) => g.flowOn(e) > 0).map(({ k }) => k));
}

/** Branch-and-bound distribution assignment for shapes the flow cannot
 *  express (three or more categories per course, or double counting under a
 *  per-subject cap). Maximizes the fraction, then uses the fewest courses. */
function distSearch(
  elig: number[],
  kOf: number[][],
  spec: DistSpec,
  env: Env
): { assignment: number[][]; exact: boolean } {
  const n = elig.length;
  const m = spec.minK.length;
  const sumMin = spec.minK.reduce((a, b) => a + b, 0);
  const subjects = elig.map((i) => env.courses[i].subject);
  const maxSubj = spec.maxPerSubject ?? Infinity;

  // Category subsets each course may fill, smallest first.
  const combos: number[][][] = kOf.map((ks) => {
    const out: number[][] = [];
    const limit = Math.min(spec.maxCat, ks.length);
    for (let size = 1; size <= limit; size++) {
      const pick = (start: number, acc: number[]) => {
        if (acc.length === size) {
          out.push(acc.slice());
          return;
        }
        for (let x = start; x < ks.length; x++) {
          acc.push(ks[x]);
          pick(x + 1, acc);
          acc.pop();
        }
      };
      pick(0, []);
    }
    return out;
  });
  // suffix[p][k]: courses at position >= p that qualify for category k.
  const suffix: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m).fill(0));
  for (let p = n - 1; p >= 0; p--) {
    for (let k = 0; k < m; k++) suffix[p][k] = suffix[p + 1][k];
    for (const k of kOf[p]) suffix[p][k]++;
  }

  const catCount = new Array<number>(m).fill(0);
  const subjCount = new Map<string, number>();
  const cur: number[][] = elig.map(() => []);
  let courses = 0;
  let doubled = 0;

  const covered = () => catCount.filter((c) => c > 0).length;
  const minsHave = () => spec.minK.reduce((acc, mk, k) => acc + Math.min(mk, catCount[k]), 0);
  const metNow = () => courses >= spec.R && covered() >= spec.D && spec.minK.every((mk, k) => catCount[k] >= mk);

  let best = {
    assignment: cur.map((x) => x.slice()),
    fraction: distFraction(spec, 0, 0, 0, sumMin),
    met: metNow(),
    courses: 0,
  };
  let steps = 0;
  let aborted = false;

  const consider = () => {
    const f = distFraction(spec, courses, covered(), minsHave(), sumMin);
    if (f > best.fraction + EPS || (f > best.fraction - EPS && courses < best.courses)) {
      best = { assignment: cur.map((x) => x.slice()), fraction: f, met: metNow(), courses };
    }
  };

  const dfs = (p: number): void => {
    if (aborted) return;
    if (++steps > EVAL_STEP_BUDGET) {
      aborted = true;
      return;
    }
    if (metNow()) {
      consider();
      return;
    }
    if (p === n) {
      consider();
      return;
    }
    let ubCovered = 0;
    let ubMins = 0;
    for (let k = 0; k < m; k++) {
      const most = Math.min(catCount[k] + suffix[p][k], spec.maxK[k]);
      if (most > 0) ubCovered++;
      ubMins += Math.min(spec.minK[k], most);
    }
    const ub = distFraction(spec, courses + (n - p), ubCovered, ubMins, sumMin);
    if (ub < best.fraction - EPS) return;
    if (ub < best.fraction + EPS && (best.met ? courses + 1 : courses) >= best.courses) return;

    const s = subjects[p];
    if ((subjCount.get(s) ?? 0) + 1 <= maxSubj) {
      for (const combo of combos[p]) {
        if (combo.length > 1 && doubled + 1 > spec.budget) continue;
        if (combo.some((k) => catCount[k] + 1 > spec.maxK[k])) continue;
        for (const k of combo) catCount[k]++;
        subjCount.set(s, (subjCount.get(s) ?? 0) + 1);
        if (combo.length > 1) doubled++;
        courses++;
        cur[p] = combo;
        dfs(p + 1);
        cur[p] = [];
        courses--;
        if (combo.length > 1) doubled--;
        subjCount.set(s, (subjCount.get(s) ?? 0) - 1);
        for (const k of combo) catCount[k]--;
        if (aborted) return;
      }
    }
    dfs(p + 1);
  };
  dfs(0);
  return { assignment: best.assignment, exact: !aborted };
}

// ─── anyOf ───────────────────────────────────────────────────────────────────

function evalAnyOf(row: AnyOfRow, call: EvalCall, env: Env): Evaluation {
  const children = row.rows.map(
    (child): Evaluation =>
      env.excluded.has(child)
        ? { met: false, fraction: 0, counted: [], progress: {}, exact: true }
        : evaluateRow(child, call, env)
  );
  let chosen = 0;
  for (let k = 1; k < children.length; k++) {
    const a = children[k];
    const b = children[chosen];
    if ((a.met && !b.met) || (a.met === b.met && !b.met && a.fraction > b.fraction + EPS)) chosen = k;
  }
  const pick = children[chosen];
  if (!pick) {
    return { met: false, fraction: 0, counted: [], progress: {}, exact: true, children, chosen: -1 };
  }
  return {
    met: pick.met,
    fraction: pick.fraction,
    counted: pick.counted,
    categories: pick.categories,
    progress: pick.progress,
    // An unmet parent is only proven unmet when every child is.
    exact: pick.met || children.every((c) => c.exact),
    children,
    chosen,
  };
}
