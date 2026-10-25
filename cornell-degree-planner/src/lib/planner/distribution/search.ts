import { evaluateRow, relevantTo, type Env, type EvalRow, type Evaluation } from "./evaluateRow";
import type { CourseRule } from "./types";

/**
 * search.ts (spec 019 D8) — the exact assignment search over one group of
 * CONSUMING rows (one layer's, or the cross-layer exclusive pass). A course is
 * offered to at most one row of the group.
 *
 *  1. A course relevant to exactly one row goes there directly.
 *  2. Contested courses are branched on, grouped by kind (interchangeable
 *     courses — same subject, credits and answer to every rule the rows
 *     consult — sit together, groups in board order of first appearance, board
 *     order inside a group); each tries its rows in authored order, so among
 *     equally good assignments the first found — the returned one — gives
 *     earlier courses to earlier rows. Inside a group a course never takes a
 *     row earlier than the previous one of its kind took, so permutations of
 *     identical courses are explored once (any distribution of them over the
 *     rows is reached in sorted order, which dominance below never worsens).
 *  3. Dominance: a row already met by what it holds cannot improve, so a
 *     contested course is never offered to it while another relevant row is
 *     still open; with one open row left the course goes there unbranched.
 *  4. Objective, lexicographic: rows met, then the sum of fractions. The bound
 *     re-evaluates every row over what it holds plus every contested course
 *     still to come that it could take; evaluators are monotone, so this is
 *     admissible, and a branch that cannot beat the best is pruned.
 *
 * Every call of the branching step counts as one node. Past `nodeCap` the
 * search stops and returns the best complete assignment found (or, if none,
 * the direct assignments alone) with `capped: true`; only rows that this
 * assignment meets are proven.
 */

const EPS = 1e-9;
const MEMO_LIMIT = 50_000;

export type GroupSearch = {
  /** One evaluation per row, over the returned assignment. */
  evals: Evaluation[];
  nodes: number;
  capped: boolean;
};

type Score = { met: number; frac: number };

const better = (a: Score, b: Score) => a.met > b.met || (a.met === b.met && a.frac > b.frac + EPS);

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
 *  an exclusive row counted. */
export function searchGroup(
  rows: readonly EvalRow[],
  avail: readonly number[],
  nodeCap: number,
  env: Env,
  all: readonly number[] = avail
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
  const contested = [...unordered].sort((a, b) => a.group - b.group || a.c - b.c);

  // Inside a row, prefer the course useful to the fewest rows of the group.
  const rank = (i: number) => fan.get(i) ?? 0;
  const memo = rows.map(() => new Map<string, Evaluation>());
  const evalSet = (r: number, set: readonly number[]): Evaluation => {
    const sorted = [...set].sort((a, b) => a - b);
    const key = sorted.join(",");
    let ev = memo[r].get(key);
    if (!ev) {
      if (memo[r].size >= MEMO_LIMIT) memo[r].clear();
      ev = evaluateRow(rows[r], { offered: sorted, all, rank }, env);
      memo[r].set(key, ev);
    }
    return ev;
  };

  const future: number[][] = rows.map(() => []);
  contested.forEach((x, p) => x.rows.forEach((r) => future[r].push(p)));

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

  const dfs = (p: number): void => {
    if (aborted) return;
    if (++nodes > nodeCap) {
      aborted = true;
      return;
    }
    if (best) {
      const ub: Score = { met: 0, frac: 0 };
      for (let r = 0; r < nRows; r++) {
        const set = assigned[r].slice();
        for (const q of future[r]) if (q >= p) set.push(contested[q].c);
        const ev = evalSet(r, set);
        // An inexact unmet evaluation may underestimate: count it as met.
        if (ev.met || !ev.exact) {
          ub.met++;
          ub.frac += 1;
        } else {
          ub.frac += ev.fraction;
        }
      }
      if (!better(ub, best.score)) return;
    }
    if (p === contested.length) {
      const score: Score = { met: 0, frac: 0 };
      for (let r = 0; r < nRows; r++) {
        const ev = evalSet(r, assigned[r]);
        if (ev.met) score.met++;
        score.frac += ev.fraction;
      }
      if (!best || better(score, best.score)) best = { score, assign: assigned.map((a) => a.slice()) };
      return;
    }
    const { c, rows: options } = contested[p];
    const low = floor(p, choice);
    const open = options.filter((r) => r >= low && !evalSet(r, assigned[r]).met);
    if (open.length === 0) {
      dfs(p + 1);
      return;
    }
    for (const r of open) {
      assigned[r].push(c);
      choice[p] = r;
      dfs(p + 1);
      choice[p] = -1;
      assigned[r].pop();
      if (aborted) return;
    }
  };
  dfs(0);

  const final = (best as { assign: number[][] } | null)?.assign ?? assigned;
  return {
    evals: rows.map((_, r) => evalSet(r, final[r])),
    nodes,
    capped: aborted,
  };
}
