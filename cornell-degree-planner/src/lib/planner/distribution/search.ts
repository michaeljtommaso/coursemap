import { hopcroftKarp } from "../bipartite";
import {
  evaluateRow,
  creditShortfall,
  extraCoursesNeeded,
  fractionWithExtra,
  maxUnmetFraction,
  MinCostFlow,
  relevantTo,
  subjectCap,
  type Env,
  type EvalRow,
  type Evaluation,
} from "./evaluateRow";
import { subjectKey, type CourseRule } from "./types";

/**
 * search.ts (spec 019 D8) — the exact assignment search over one group of
 * CONSUMING rows (one layer's, or the cross-layer exclusive pass). A course is
 * offered to at most one row of the group.
 *
 *  1. A course relevant to exactly one row goes there directly.
 *  2. Contested courses are branched on in a fixed order: fewest candidate
 *     rows first, then by kind (interchangeable courses — same subject, credits
 *     and answer to every rule the rows consult — sit together, kinds in board
 *     order of first appearance, board order inside a kind). Each tries its
 *     rows in authored order, and among equally good assignments the first
 *     found is returned. Inside a kind a course never takes a row earlier than
 *     the previous one of its kind took, so permutations of identical courses
 *     are explored once (any distribution of them over the rows is reached in
 *     sorted order, which dominance below never worsens).
 *  3. Dominance: a row already met by what it holds cannot improve, so a
 *     contested course is never offered to it while another relevant row is
 *     still open; with one open row left the course goes there unbranched.
 *  4. Objective, lexicographic: rows met, then the sum of fractions. A branch
 *     that cannot beat the best found is pruned by upperBound() (per-row
 *     optimistic evaluations, then a matching of remaining courses to what the
 *     rows still need — see its comment). Every step is admissible, so the
 *     result is exact whenever the search finishes.
 *
 * Inside the loop rows are evaluated in `quick` mode (met and fraction only);
 * the returned evaluations are full ones over the chosen assignment.
 *
 * Every call of the branching step counts as one node. Past `nodeCap` the
 * search stops and returns the best complete assignment found (or, if none,
 * the direct assignments alone) with `capped: true`; only rows that this
 * assignment meets are proven.
 */

const EPS = 1e-9;
const MEMO_LIMIT = 50_000;
/** The joint (matching/flow) bound runs only while at least this many
 *  contested courses remain: near the leaves a subtree is cheaper to walk than
 *  to bound. A weaker bound there never affects exactness, only speed. Tuned
 *  on seeded boards (6: no extra caps, capped solves stay well under 1 s). */
const JOINT_BOUND_MIN_AHEAD = 6;

export type GroupSearch = {
  /** One evaluation per row, over the returned assignment. */
  evals: Evaluation[];
  nodes: number;
  capped: boolean;
};

type Score = { met: number; frac: number };

const better = (a: Score, b: Score) => a.met > b.met || (a.met === b.met && a.frac > b.frac + EPS);

/** Dinic's maximum flow over real capacities (the search's joint bounds). */
class Dinic {
  private to: number[] = [];
  private cap: number[] = [];
  private next: number[] = [];
  private head: number[];

  constructor(nodes: number) {
    this.head = new Array<number>(nodes).fill(-1);
  }

  node(): number {
    this.head.push(-1);
    return this.head.length - 1;
  }

  add(u: number, v: number, cap: number): void {
    this.to.push(v, u);
    this.cap.push(cap, 0);
    this.next.push(this.head[u], this.head[v]);
    this.head[u] = this.to.length - 2;
    this.head[v] = this.to.length - 1;
  }

  run(s: number, t: number): number {
    const n = this.head.length;
    let flow = 0;
    for (;;) {
      const level = new Array<number>(n).fill(-1);
      level[s] = 0;
      const queue = [s];
      for (let qh = 0; qh < queue.length; qh++) {
        const u = queue[qh];
        for (let e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] > EPS && level[this.to[e]] < 0) {
            level[this.to[e]] = level[u] + 1;
            queue.push(this.to[e]);
          }
        }
      }
      if (level[t] < 0) return flow;
      const it = this.head.slice();
      const push = (u: number, f: number): number => {
        if (u === t) return f;
        for (; it[u] !== -1; it[u] = this.next[it[u]]) {
          const e = it[u];
          const v = this.to[e];
          if (this.cap[e] > EPS && level[v] === level[u] + 1) {
            const got = push(v, Math.min(f, this.cap[e]));
            if (got > EPS) {
              this.cap[e] -= got;
              this.cap[e ^ 1] += got;
              return got;
            }
          }
        }
        return 0;
      };
      for (let f = push(s, Infinity); f > EPS; f = push(s, Infinity)) flow += f;
    }
  }
}

/** Every top-level rule an evaluator of this row consults. */
function rulesOf(row: EvalRow): CourseRule[] {
  switch (row.kind) {
    case "seat":
      return [row.rule];
    case "pool":
    case "credits":
      return [row.rule, ...(row.limits ?? []).map((l) => l.rule)];
    case "distribution":
      return [...(row.rule ? [row.rule] : []), ...row.categories.map((c) => c.rule)];
    case "anyOf":
      return row.rows.flatMap(rulesOf);
  }
}

/** `avail`: the courses the group's rows may be offered. `all`: what credits
 *  rows (and credits options of an anyOf) read — every course, including those
 *  an exclusive row counted. `preference`: an outside tie-break inside a row
 *  (lower first) ahead of the group's own (the course useful to the fewest of
 *  the group's rows); it never changes the objective, only which of equally
 *  good courses a row counts. */
export function searchGroup(
  rows: readonly EvalRow[],
  avail: readonly number[],
  nodeCap: number,
  env: Env,
  all: readonly number[] = avail,
  preference?: (i: number) => number,
  /** Tests only: run the joint bound from this many remaining courses (0 = always). */
  jointMinAhead = JOINT_BOUND_MIN_AHEAD
): GroupSearch {
  const nRows = rows.length;
  const fan = new Map<number, number>();
  const assigned: number[][] = rows.map(() => []);

  const rules = rows.flatMap(rulesOf);
  const groupOf = new Map<string, number>();
  const unordered: { c: number; rows: number[]; group: number }[] = [];
  for (const c of avail) {
    const rel: number[] = [];
    for (let r = 0; r < nRows; r++) if (relevantTo(rows[r], c, env)) rel.push(r);
    fan.set(c, rel.length);
    if (rel.length === 1) assigned[rel[0]].push(c);
    else if (rel.length > 1) {
      const course = env.courses[c];
      const sig = `${course.subject}|${course.credits}|${rules.map((rule) => (env.matches(c, rule) ? 1 : 0)).join("")}`;
      let group = groupOf.get(sig);
      if (group === undefined) {
        group = groupOf.size;
        groupOf.set(sig, group);
      }
      unordered.push({ c, rows: rel, group });
    }
  }
  // Interchangeable courses (same subject, credits and answer to every rule
  // of the group) are visited consecutively, each taking a row no earlier
  // than the previous one of its kind took: permutations of identical courses
  // are explored once.
  const contested = [...unordered].sort((a, b) => a.rows.length - b.rows.length || a.group - b.group || a.c - b.c);

  // Inside a row, prefer the course useful to the fewest rows of the group.
  const rank = (i: number) => (preference ? preference(i) * (nRows + 1) : 0) + (fan.get(i) ?? 0);
  const memo = rows.map(() => new Map<string, Evaluation>());
  const evalSet = (r: number, set: readonly number[], key: string): Evaluation => {
    let ev = memo[r].get(key);
    if (!ev) {
      if (memo[r].size >= MEMO_LIMIT) memo[r].clear();
      const sorted = [...set].sort((a, b) => a - b);
      ev = evaluateRow(rows[r], { offered: sorted, all, rank, quick: true }, env);
      memo[r].set(key, ev);
    }
    return ev;
  };

  const unmetCeiling = rows.map((row) => maxUnmetFraction(row, env));
  const caps = rows.map(subjectCap);
  const centsExact = env.courses.every((c) => Math.abs(c.credits * 100 - Math.round(c.credits * 100)) < 1e-9);
  const future: number[][] = rows.map(() => []);
  contested.forEach((x, p) => x.rows.forEach((r) => future[r].push(p)));

  // Per-row caches keyed by what the row holds (kept current on every
  // push/pop) and, for the optimistic view, the first contested position it
  // can still take — together they determine the row's optimistic set.
  const keyOf = (set: readonly number[]) => [...set].sort((a, b) => a - b).join(",");
  const heldKey = assigned.map(keyOf);
  const give = (r: number, c: number) => {
    assigned[r].push(c);
    heldKey[r] = keyOf(assigned[r]);
  };
  const takeBack = (r: number) => {
    assigned[r].pop();
    heldKey[r] = keyOf(assigned[r]);
  };
  const evalHeld = (r: number): Evaluation => evalSet(r, assigned[r], heldKey[r]);
  // nextAt[r][p]: index into future[r] of its first position >= p.
  const nextAt = rows.map((_, r) => {
    const out = new Int32Array(contested.length + 1);
    let j = future[r].length;
    for (let p = contested.length; p >= 0; p--) {
      while (j > 0 && future[r][j - 1] >= p) j--;
      out[p] = j;
    }
    return out;
  });
  const aheadMemo = rows.map(() => new Map<number, number[]>());
  const aheadOf = (r: number, j: number): number[] => {
    let list = aheadMemo[r].get(j);
    if (!list) {
      list = future[r].slice(j).map((q) => contested[q].c);
      aheadMemo[r].set(j, list);
    }
    return list;
  };
  type View = { ev: Evaluation; need?: number; credit?: number };
  const viewMemo = rows.map(() => new Map<string, View>());
  const optimisticView = (r: number, p: number): { view: View; ahead: number[] } => {
    const j = nextAt[r][p];
    const ahead = aheadOf(r, j);
    const key = `${heldKey[r]}|${j}`;
    let view = viewMemo[r].get(key);
    if (!view) {
      if (viewMemo[r].size >= MEMO_LIMIT) viewMemo[r].clear();
      const set = [...assigned[r], ...ahead];
      view = { ev: evalSet(r, set, keyOf(set)) };
      viewMemo[r].set(key, view);
    }
    return { view, ahead };
  };

  let best: { score: Score; assign: number[][] } | null = null;
  let nodes = 0;
  let aborted = false;

  /** The lowest row the course at position p may take (symmetry breaking). */
  const floor = (p: number, choice: number[]): number => {
    for (let q = p - 1; q >= 0 && contested[q].group === contested[p].group; q--) {
      if (choice[q] >= 0) return choice[q];
    }
    return 0;
  };
  const choice = new Array<number>(contested.length).fill(-1);

  /**
   * The best score any completion from position p could reach.
   *  - Each row alone: re-evaluated over what it holds plus every contested
   *    course still to come that it could take (monotone, so admissible).
   *  - Together: the rows that could become met each need some more courses
   *    (extraCoursesNeeded, a lower bound) and each remaining course goes to
   *    one row. A maximum matching of remaining courses to those needs bounds
   *    the total supply F, so at most k more rows can be met, where k is the
   *    largest count whose k smallest needs sum to at most F. The other
   *    candidates then contribute at most their unmet ceiling (maxUnmetFraction).
   *    When exactly one row must give way, each choice is tested with its own
   *    matching, and the row giving way is bounded by the courses it could
   *    still get while the others are satisfied (fractionWithExtra).
   * The joint steps run only when the per-row bound fails to beat `target`.
   * The result is only good for that comparison: once it is known to beat
   * `target` the remaining refinements are skipped, so it may then understate
   * the true bound (never when it says "cannot beat").
   */
  const upperBound = (p: number, target: Score): Score => {
    const ub: Score = { met: 0, frac: 0 };
    const cand: { r: number; need: number; credit: number; ahead: number[] }[] = [];
    const views: View[] = [];
    // Rows no completion can meet, with their per-row fraction bound.
    const short: { r: number; ahead: number[]; frac: number }[] = [];
    for (let r = 0; r < nRows; r++) {
      if (evalHeld(r).met) {
        ub.met++;
        ub.frac += 1;
        continue;
      }
      const { view, ahead } = optimisticView(r, p);
      // An inexact unmet evaluation may underestimate: treat it as met.
      if (view.ev.met || !view.ev.exact) {
        cand.push({ r, need: 0, credit: 0, ahead });
        views.push(view);
      } else {
        ub.frac += view.ev.fraction;
        if (view.ev.fraction > 0) short.push({ r, ahead, frac: view.ev.fraction });
      }
    }
    if (
      cand.length === 0 ||
      contested.length - p < jointMinAhead ||
      !better({ met: ub.met + cand.length, frac: ub.frac + cand.length }, target)
    ) {
      return { met: ub.met + cand.length, frac: ub.frac + cand.length };
    }
    cand.forEach((x, j) => {
      const view = views[j];
      if (view.need === undefined) {
        const need = extraCoursesNeeded(rows[x.r], assigned[x.r], x.ahead, env);
        view.need = need <= x.ahead.length ? need : Infinity;
        const credit = creditShortfall(rows[x.r], assigned[x.r], env);
        view.credit = Number.isFinite(credit) ? credit : 0;
      }
      x.need = view.need;
      x.credit = view.credit ?? 0;
    });

    const finite = cand.filter((x) => Number.isFinite(x.need));
    for (const x of cand) if (!Number.isFinite(x.need)) ub.frac += unmetCeiling[x.r];
    if (finite.length === 0) return ub;

    // How many need units of `set` the remaining courses can fill at once.
    const supplyFor = (set: readonly { r: number; need: number }[]): number => {
      const unitsOf = new Map<number, number[]>();
      let nUnits = 0;
      for (const { r, need } of set) {
        const units: number[] = [];
        for (let u = 0; u < need; u++) units.push(nUnits++);
        unitsOf.set(r, units);
      }
      const adj: number[][] = [];
      for (let q = p; q < contested.length; q++) {
        const edges: number[] = [];
        for (const r of contested[q].rows) {
          const units = unitsOf.get(r);
          if (units) edges.push(...units);
        }
        if (edges.length > 0) adj.push(edges);
      }
      return hopcroftKarp(adj, adj.length, nUnits).filter((v) => v >= 0).length;
    };
    const demand = (set: readonly { need: number }[]) => set.reduce((a, x) => a + x.need, 0);

    // The most credits row `d` can collect from at most `extra` remaining
    // courses while every row of `rest` still gets its need: a max-reward flow
    // where filling a need unit outweighs any credit total.
    const creditsFor = (rest: readonly { r: number; need: number }[], d: number, extra: number): number => {
      const span = contested.length - p;
      const S = 0;
      const T = 1;
      const D = 2;
      const rowNode = new Map<number, number>();
      rest.forEach((x, j) => rowNode.set(x.r, 3 + span + j));
      const g = new MinCostFlow(3 + span + rest.length);
      const heavy = 1_000_000;
      for (let q = p; q < contested.length; q++) {
        const node = 3 + (q - p);
        g.add(S, node, 1, 0);
        for (const r of contested[q].rows) {
          const target = rowNode.get(r);
          if (target !== undefined) g.add(node, target, 1, -heavy);
          if (r === d) g.add(node, D, 1, -Math.round(env.courses[contested[q].c].credits * 100));
        }
      }
      rest.forEach((x) => g.add(rowNode.get(x.r) as number, T, x.need, 0));
      g.add(D, T, Math.max(0, extra), 0);
      g.run(S, T);
      let reward = 0;
      for (let e = 0; e < g.to.length; e += 2) reward -= g.flowOn(e) * g.cost[e];
      // Credits are counted in hundredths; exact unless a value is finer.
      return Math.max(0, reward - heavy * demand(rest)) / 100 + (centsExact ? 0 : Math.max(0, extra) * 0.01);
    };

    // Can every row of `set` get its need at once? Two necessary conditions,
    // each a max-flow: course counts honouring each row's per-department cap,
    // and credits (a course's credits may split across rows — a relaxation).
    const fits = (set: readonly { r: number; need: number; credit: number; ahead: number[] }[]): boolean => {
      const span = contested.length - p;
      const rowNode = new Map<number, number>();
      set.forEach((x, j) => rowNode.set(x.r, 2 + span + j));
      // Count flow, with a (row, department) node where a row caps departments.
      const count = new Dinic(2 + span + set.length);
      const deptNode = new Map<string, number>();
      for (let q = p; q < contested.length; q++) {
        const node = 2 + (q - p);
        count.add(0, node, 1);
        for (const r of contested[q].rows) {
          const target = rowNode.get(r);
          if (target === undefined) continue;
          const cap = caps[r];
          if (!cap) {
            count.add(node, target, 1);
            continue;
          }
          const key = `${r}|${subjectKey(env.courses[contested[q].c].subject, cap.groups)}`;
          let dept = deptNode.get(key);
          if (dept === undefined) {
            dept = count.node();
            deptNode.set(key, dept);
            // What the department can still add once held courses fill it.
            const subject = subjectKey(env.courses[contested[q].c].subject, cap.groups);
            const held = assigned[r].filter(
              (i) => relevantTo(rows[r], i, env) && subjectKey(env.courses[i].subject, cap.groups) === subject
            ).length;
            count.add(dept, target, Math.max(0, cap.max - held));
          }
          count.add(node, dept, 1);
        }
      }
      // Distribution rows: new categories must come from distinct courses. To
      // cover X more categories, at most maxCat each and at most `budget`
      // courses doubling, needs max(⌈X/maxCat⌉, X − budget·(maxCat − 1))
      // courses that each take a different category (a vertex-cover count),
      // routed through one capacity-1 node per (row, category).
      let required = 0;
      for (const x of set) {
        const row = rows[x.r];
        let cover = 0;
        if (row.kind === "distribution") {
          const maxCat = Math.max(1, row.maxCategoriesPerCourse ?? 1);
          const budget = maxCat > 1 ? (row.maxDoubleCountCourses ?? Infinity) : 0;
          const held = assigned[x.r].filter((i) => relevantTo(row, i, env));
          const coverable = Math.min(
            row.categories.filter((c) => held.some((i) => env.matches(i, c.rule))).length,
            held.length * maxCat
          );
          const gap = Math.max(0, row.minDistinctCategories - coverable);
          cover = Math.max(Math.ceil(gap / maxCat), Number.isFinite(budget) ? gap - budget * (maxCat - 1) : 0);
          if (cover > 0) {
            const coverNode = count.node();
            count.add(coverNode, 1, cover);
            const catNodes = row.categories.map(() => {
              const n = count.node();
              count.add(n, coverNode, 1);
              return n;
            });
            for (let q = p; q < contested.length; q++) {
              const c = contested[q].c;
              if (!contested[q].rows.includes(x.r)) continue;
              row.categories.forEach((cat, k) => {
                if (env.matches(c, cat.rule)) count.add(2 + (q - p), catNodes[k], 1);
              });
            }
          }
        }
        const general = Math.max(0, x.need - cover);
        count.add(rowNode.get(x.r) as number, 1, general);
        required += general + cover;
      }
      if (count.run(0, 1) < required - EPS) return false;

      // Credit flow: every course supplies its credits (splittable). A row
      // needs at least its credit shortfall, and at least its course need
      // times the smallest credit value it could take; a capped department
      // supplies a row at most its largest residual credit values.
      const creditOf = (i: number) => env.courses[i].credits;
      const want = set.map((x) => {
        const smallest = x.ahead.length > 0 ? Math.min(...x.ahead.map(creditOf)) : 0;
        return Math.max(x.credit, x.need * smallest);
      });
      const creditNeed = want.reduce((a, b) => a + b, 0);
      if (creditNeed <= EPS) return true;
      const credit = new Dinic(2 + span + set.length);
      const deptCredit = new Map<string, number>();
      for (let q = p; q < contested.length; q++) {
        const node = 2 + (q - p);
        const c = contested[q].c;
        credit.add(0, node, creditOf(c));
        for (const r of contested[q].rows) {
          const target = rowNode.get(r);
          if (target === undefined) continue;
          const j = target - 2 - span;
          if (want[j] <= EPS) continue;
          const cap = caps[r];
          if (!cap) {
            credit.add(node, target, creditOf(c));
            continue;
          }
          const subject = subjectKey(env.courses[c].subject, cap.groups);
          const key = `${r}|${subject}`;
          let dept = deptCredit.get(key);
          if (dept === undefined) {
            dept = credit.node();
            deptCredit.set(key, dept);
            const held = assigned[r].filter(
              (i) => relevantTo(rows[r], i, env) && subjectKey(env.courses[i].subject, cap.groups) === subject
            ).length;
            const room = Math.max(0, cap.max - held);
            const top = set[j].ahead
              .filter((i) => subjectKey(env.courses[i].subject, cap.groups) === subject)
              .map(creditOf)
              .sort((a, b) => b - a)
              .slice(0, room)
              .reduce((a, b) => a + b, 0);
            credit.add(dept, target, top);
          }
          credit.add(node, dept, creditOf(c));
        }
      }
      set.forEach((x, j) => credit.add(rowNode.get(x.r) as number, 1, want[j]));
      return credit.run(0, 1) >= creditNeed - 1e-6;
    };

    const supply = supplyFor(finite);
    const together = supply >= demand(finite) && fits(finite);
    if (together) {
      ub.met += finite.length;
      ub.frac += finite.length;
      if (!better(ub, target) || cand.length > finite.length) return ub;
      // Every candidate can be met together, so a completion that beats
      // `target` meets them all; each row that can never be met then only
      // gets what is left after their needs.
      for (const x of short) {
        const extra = supplyFor([...finite, { r: x.r, need: x.ahead.length }]) - demand(finite);
        const creditCap = rows[x.r].kind === "pool" ? creditsFor(finite, x.r, extra) : Infinity;
        const tighter = Math.min(x.frac, fractionWithExtra(rows[x.r], assigned[x.r], x.ahead, extra, env, creditCap));
        ub.frac -= x.frac - tighter;
        if (!better(ub, target)) return ub;
      }
      return ub;
    }
    const needs = finite.map((x) => x.need).sort((a, b) => a - b);
    let k = 0;
    for (let used = 0; k < needs.length && used + needs[k] <= supply; k++) used += needs[k];
    if (k === finite.length) k--; // the joint flows already ruled out all of them

    if (k === finite.length - 1) {
      // Exactly one row would have to give way: try each. Only drops that
      // leave a feasible matching count, and the best of them bounds the
      // fraction; if none works, at least two rows must give way.
      let bestDrop = -1;
      for (let d = 0; d < finite.length; d++) {
        const rest = finite.filter((_, j) => j !== d);
        const restDemand = demand(rest);
        if (supplyFor(rest) < restDemand || !fits(rest)) continue;
        const x = finite[d];
        // Courses the row giving way can still get with the others satisfied.
        const extra = supplyFor([...rest, { r: x.r, need: x.ahead.length }]) - restDemand;
        let frac = Math.min(unmetCeiling[x.r], fractionWithExtra(rows[x.r], assigned[x.r], x.ahead, extra, env));
        // The credit-weighted cap only matters when it could change the max.
        if (frac > bestDrop && rows[x.r].kind === "pool") {
          const creditCap = creditsFor(rest, x.r, extra);
          frac = Math.min(frac, fractionWithExtra(rows[x.r], assigned[x.r], x.ahead, extra, env, creditCap));
        }
        bestDrop = Math.max(bestDrop, frac);
        // Already enough to beat `target`: the caller only compares, so stop.
        if (better({ met: ub.met + k, frac: ub.frac + k + bestDrop }, target)) break;
      }
      if (bestDrop >= 0) {
        ub.met += k;
        ub.frac += k + bestDrop;
        return ub;
      }
      k--;
    }
    ub.met += k;
    const room = finite.map(({ r }) => 1 - unmetCeiling[r]).sort((a, b) => b - a);
    for (let j = 0; j < finite.length; j++) ub.frac += unmetCeiling[finite[j].r] + (j < k ? room[j] : 0);
    return ub;
  };

  const dfs = (p: number): void => {
    if (aborted) return;
    if (++nodes > nodeCap) {
      aborted = true;
      return;
    }
    if (best && !better(upperBound(p, best.score), best.score)) return;
    if (p === contested.length) {
      const score: Score = { met: 0, frac: 0 };
      for (let r = 0; r < nRows; r++) {
        const ev = evalHeld(r);
        if (ev.met) score.met++;
        score.frac += ev.fraction;
      }
      if (!best || better(score, best.score)) {
        best = { score, assign: assigned.map((a) => a.slice()) };
      }
      return;
    }
    const { c, rows: options } = contested[p];
    const low = floor(p, choice);
    const open = options.filter((r) => r >= low && !evalHeld(r).met);
    if (open.length === 0) {
      dfs(p + 1);
      return;
    }
    // Most urgent row first: the fewest spare candidates beyond what it still
    // needs, then the fewest spare credits, then authored order. Only the
    // order of exploration changes — every option is still tried.
    if (open.length > 1) {
      const urgency = new Map<number, [number, number]>();
      for (const r of open) {
        const ahead = aheadOf(r, nextAt[r][p + 1]);
        const need = extraCoursesNeeded(rows[r], assigned[r], ahead, env);
        const spareCredits = ahead.reduce((a, i) => a + env.courses[i].credits, 0) - creditShortfall(rows[r], assigned[r], env);
        urgency.set(r, [ahead.length - need, spareCredits]);
      }
      open.sort((a, b) => {
        const [ua, ca] = urgency.get(a) as [number, number];
        const [ub, cb] = urgency.get(b) as [number, number];
        return ua - ub || ca - cb || a - b;
      });
    }
    for (const r of open) {
      give(r, c);
      choice[p] = r;
      dfs(p + 1);
      choice[p] = -1;
      takeBack(r);
      if (aborted) return;
    }
  };
  dfs(0);

  const final = (best as { assign: number[][] } | null)?.assign ?? assigned;
  return {
    // The reported evaluations are full ones (a met pool counts the fewest courses).
    evals: rows.map((_, r) => evaluateRow(rows[r], { offered: [...final[r]].sort((a, b) => a - b), all, rank }, env)),
    nodes,
    capped: aborted,
  };
}
