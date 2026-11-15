import { heldBackExclusion } from "./rules";
import type { CourseRule, DistCourse, Layer, LayerSharing, Row, SharingLimit } from "./types";

/**
 * overlap.ts (spec 047 D7/D8/D14) — overlap limits between the programs on one
 * plan (the primary major, a second major, minors), enforced by re-solving.
 * Pure: the caller supplies the solver and reads its results through
 * callbacks, so the same loop serves the Distribution engine (one solve over
 * every layer) and an Engineering primary (assign() plus a layer solve for the
 * extra programs, where only the extra programs can give a course up).
 *
 *  - pairLimit(): the limit between two programs. Each side's `sharing` names
 *    a limit toward the other's kind (`otherMajors` toward a major, `minors`
 *    toward a minor); a limit with `with` applies only when the other
 *    program's id matches one of those prefixes; the stricter of the two
 *    sides wins ("none" beats any cap, caps take the smaller bound). A pair
 *    named in either side's `forbiddenWith`, or an `otherMajors: "forbidden"`
 *    toward a major, is "forbidden": reported so the views can warn, never
 *    enforced here (the caller keeps the later program from reading as met).
 *  - holdBackLayers(): a program's layers with some courses removed from every
 *    row — how a re-solve "sees fewer courses" for one program only. The
 *    solver and the checker are unchanged: each row's rule becomes
 *    `allOf: [not those courses, rule]`.
 *  - enforceOverlap(): the bounded search. A pair over its limit is re-solved
 *    with some shared courses held back from one side, trying the smallest
 *    hold-back sets first, and the assignment with the most total progress is
 *    kept. At most `maxResolves` (20) re-solves; past that, a greedy hold-back
 *    (the course whose removal costs least, one at a time) that may understate
 *    progress and never overstates it: every state it returns is a real solve
 *    of a board the limits allow. A student's countsFor choice (D8) narrows
 *    the combinations: a course they chose for program X is never held back
 *    from X. Choices only act on a pair over its limit (inert otherwise).
 */

export type PairLimit = SharingLimit | "forbidden";

/** One program as the overlap check sees it. */
export type OverlapProgram = {
  /** The programId (the section id). */
  id: string;
  /** The primary major and a second major are "major". */
  kind: "major" | "minor";
  /** Its non-college layers: what counts toward overlap, and where a held-back
   *  course is removed. */
  layerIds: string[];
  /** From its major or minor layer. */
  sharing?: LayerSharing;
  /** Every `forbiddenWith` prefix of its layers (concentrations included). */
  forbiddenWith?: string[];
  /** False when the engine can't re-solve this program without a course (an
   *  Engineering primary): only the other side gives a course up. */
  holdable: boolean;
};

/** A course held back from one program, and the pair that made it so. */
export type HeldEntry = { courseId: string; from: string; pair: string };

/** A pair with a limit, measured on one result. */
export type PairState = {
  a: string;
  b: string;
  limit: PairLimit;
  /** The program whose `sharing` (or `forbiddenWith`) set the binding limit. */
  limitFrom: string;
  /** Courses counting toward both, with the larger of the two counted credits. */
  shared: { courseId: string; credits: number }[];
  /** Over its limit ("forbidden" pairs are never "over": they aren't enforced). */
  over: boolean;
};

export type OverlapOutcome<R> = {
  result: R;
  held: HeldEntry[];
  pairs: PairState[];
  /** The bound ran out before every combination was tried, or the greedy
   *  fallback ran: progress may be understated (never overstated). */
  estimated: boolean;
  /** Re-solves used (the search's, then the greedy fallback's). */
  resolves: number;
  /** A pair is still over its limit (no side could give a course up). The
   *  caller fails closed on the later program. */
  unresolved: boolean;
};

/** Counted courses per program: programId → canonical course id → credits. */
export type CountedByProgram = Map<string, Map<string, number>>;

export const MAX_RESOLVES = 20;
/** The greedy fallback holds back one course per re-solve; this is its own
 *  safety bound (every step adds a new hold-back, so it ends long before). */
const MAX_GREEDY_STEPS = 200;
/** Hold-back sets tried per violated pair (the smallest sets first). */
const MAX_HOLD_SETS = 16;
/** Above this many shared courses the subset enumeration is skipped (greedy). */
const MAX_ENUMERATED_SHARED = 12;

export function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}

/** A program-id prefix matches itself and every catalog year of it (the
 *  `program` rule leaf's reading). */
export function matchesProgramPrefix(id: string, prefixes: readonly string[] | undefined): boolean {
  return (prefixes ?? []).some((p) => id === p || id.startsWith(`${p}-`));
}

/** One side's limit toward the other program, after `with` scoping; undefined
 *  when it sets none. */
function sideLimit(self: OverlapProgram, other: OverlapProgram): PairLimit | undefined {
  const raw = other.kind === "major" ? self.sharing?.otherMajors : self.sharing?.minors;
  if (raw == null) return undefined;
  if (raw === "forbidden" || raw === "none") return raw;
  if (raw.with && raw.with.length > 0 && !matchesProgramPrefix(other.id, raw.with)) return undefined;
  const out: { maxCourses?: number; maxCredits?: number } = {};
  if (raw.maxCourses != null) out.maxCourses = raw.maxCourses;
  if (raw.maxCredits != null) out.maxCredits = raw.maxCredits;
  return out.maxCourses == null && out.maxCredits == null ? undefined : out;
}

/** The stricter of two limits. */
function stricter(x: PairLimit | undefined, y: PairLimit | undefined): PairLimit | undefined {
  if (x == null) return y;
  if (y == null) return x;
  if (x === "forbidden" || y === "forbidden") return "forbidden";
  if (x === "none" || y === "none") return "none";
  const min = (p?: number, q?: number) => (p == null ? q : q == null ? p : Math.min(p, q));
  const out: { maxCourses?: number; maxCredits?: number } = {};
  const courses = min(x.maxCourses, y.maxCourses);
  const credits = min(x.maxCredits, y.maxCredits);
  if (courses != null) out.maxCourses = courses;
  if (credits != null) out.maxCredits = credits;
  return out;
}

/** The limit between two programs, or null when neither sets one. */
export function pairLimit(a: OverlapProgram, b: OverlapProgram): PairLimit | null {
  return pairLimitWithSource(a, b)?.limit ?? null;
}

/** Which side binds: "forbidden" or "none" beats a cap; between two caps, the
 *  side with the smaller course cap, else the smaller credit cap; the earlier
 *  program on a tie. */
function bindingSide(x: PairLimit, y: PairLimit): "x" | "y" {
  const rank = (l: PairLimit) => (l === "forbidden" ? 2 : l === "none" ? 1 : 0);
  if (rank(x) !== rank(y)) return rank(x) > rank(y) ? "x" : "y";
  if (typeof x === "string" || typeof y === "string") return "x";
  const inf = Number.POSITIVE_INFINITY;
  const cx = x.maxCourses ?? inf;
  const cy = y.maxCourses ?? inf;
  if (cx !== cy) return cx < cy ? "x" : "y";
  return (y.maxCredits ?? inf) < (x.maxCredits ?? inf) ? "y" : "x";
}

/** The limit between two programs and the program whose rule sets it (the
 *  stricter side), or null when neither sets one. */
export function pairLimitWithSource(
  a: OverlapProgram,
  b: OverlapProgram
): { limit: PairLimit; from: string } | null {
  if (matchesProgramPrefix(b.id, a.forbiddenWith)) return { limit: "forbidden", from: a.id };
  if (matchesProgramPrefix(a.id, b.forbiddenWith)) return { limit: "forbidden", from: b.id };
  const la = sideLimit(a, b);
  const lb = sideLimit(b, a);
  const limit = stricter(la, lb);
  if (limit == null) return null;
  const from = la == null ? b.id : lb == null ? a.id : bindingSide(la, lb) === "x" ? a.id : b.id;
  return { limit, from };
}

/** Is a shared set over the limit? A "forbidden" pair is reported, not enforced. */
export function overLimit(limit: PairLimit, shared: readonly { credits: number }[]): boolean {
  if (limit === "forbidden") return false;
  if (limit === "none") return shared.length > 0;
  if (limit.maxCourses != null && shared.length > limit.maxCourses) return true;
  if (limit.maxCredits != null && shared.reduce((s, c) => s + c.credits, 0) > limit.maxCredits) return true;
  return false;
}

/** Every pair (earlier program first) that has a limit, measured on `counted`. */
export function measurePairs(programs: readonly OverlapProgram[], counted: CountedByProgram): PairState[] {
  const out: PairState[] = [];
  for (let i = 0; i < programs.length; i++) {
    for (let j = i + 1; j < programs.length; j++) {
      const a = programs[i];
      const b = programs[j];
      const found = pairLimitWithSource(a, b);
      if (found == null) continue;
      const { limit } = found;
      const ca = counted.get(a.id) ?? new Map<string, number>();
      const cb = counted.get(b.id) ?? new Map<string, number>();
      const shared: PairState["shared"] = [];
      for (const [courseId, credits] of ca) {
        const other = cb.get(courseId);
        if (other != null) shared.push({ courseId, credits: Math.max(credits, other) });
      }
      out.push({ a: a.id, b: b.id, limit, limitFrom: found.from, shared, over: overLimit(limit, shared) });
    }
  }
  return out;
}

// ─── Holding courses back from one program's layers ─────────────────────────

/** The rule with these courses removed. The exclusion is read by the course's
 *  identity (rules.ts heldBackExclusion), so an "X or Y" credit held back as X
 *  can't still count through its Y reading. */
function withoutCourses(rule: CourseRule | undefined, ids: string[]): CourseRule {
  const exclude = heldBackExclusion(ids);
  return rule ? { allOf: [exclude, rule] } : exclude;
}

function rowWithout(row: Row, ids: string[]): Row {
  switch (row.kind) {
    case "seat":
    case "pool":
    case "credits":
      return { ...row, rule: withoutCourses(row.rule, ids) };
    case "distribution":
      return { ...row, rule: withoutCourses(row.rule, ids) };
    case "anyOf":
      return { ...row, rows: row.rows.map((c) => rowWithout(c, ids) as (typeof row.rows)[number]) };
    case "confirm":
      return row;
  }
}

/** Held course ids per layer id, from held entries and each program's layers. */
export function heldByLayer(
  held: readonly HeldEntry[],
  programs: readonly OverlapProgram[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const h of held) {
    const p = programs.find((x) => x.id === h.from);
    if (!p) continue;
    for (const layerId of p.layerIds) {
      const list = out.get(layerId) ?? [];
      if (!list.includes(h.courseId)) list.push(h.courseId);
      out.set(layerId, list);
    }
  }
  return out;
}

/** The layers with each held course removed from every row of its layer.
 *  Untouched layers keep their identity. */
export function holdBackLayers(layers: readonly Layer[], byLayer: ReadonlyMap<string, string[]>): Layer[] {
  return layers.map((layer) => {
    const ids = byLayer.get(layer.id);
    if (!ids || ids.length === 0) return layer;
    return { ...layer, rows: layer.rows.map((r) => rowWithout(r, ids)) };
  });
}

/** A held course loses a student-placed credit choice (spec 046) that points
 *  into a layer it is held back from: the choice would read the row's rule in
 *  the course's favour and undo the hold-back. */
export function stripHeldPlacements<C extends DistCourse>(
  courses: readonly C[],
  byLayer: ReadonlyMap<string, string[]>,
  canonical: (id: string) => string
): C[] {
  if (byLayer.size === 0) return courses as C[];
  return courses.map((c) => {
    const target = c.placedFor?.row;
    if (!target) return c;
    const layerId = target.slice(0, Math.max(0, target.indexOf(":")));
    const ids = byLayer.get(layerId);
    if (!ids || ![c.id, ...(c.altIds ?? [])].some((id) => ids.includes(canonical(id)))) return c;
    const copy = { ...c };
    delete copy.placedFor;
    return copy;
  });
}

// ─── The bounded search ──────────────────────────────────────────────────────

export type EnforceInput<R> = {
  /** Plan order: the primary first. */
  programs: readonly OverlapProgram[];
  /** The solve with nothing held back (not counted as a re-solve). */
  base: R;
  /** A solve with these courses held back. */
  solve: (held: HeldEntry[]) => R;
  /** What each program counts toward overlap (D7's definition). */
  counted: (r: R) => CountedByProgram;
  /** Total progress across every program; higher is better. */
  score: (r: R) => number;
  /** What holding `courseId` back from `programId` would cost (greedy and
   *  candidate order); lower is cheaper. Default: 1. */
  cost?: (r: R, programId: string, courseId: string) => number;
  /** D8: canonical course id → the programId the student chose it counts for. */
  countsFor?: ReadonlyMap<string, string>;
  maxResolves?: number;
};

type Node<R> = { held: HeldEntry[]; r: R; pairs: PairState[]; score: number };

function heldKey(held: readonly HeldEntry[]): string {
  return [...new Set(held.map((h) => `${h.from}|${h.courseId}`))].sort().join(",");
}

/** `base` plus the entries of `extra` it doesn't hold yet (same course, same
 *  side): a course held back twice from one program is one hold-back. */
function mergeHeld(base: readonly HeldEntry[], extra: readonly HeldEntry[]): HeldEntry[] {
  const out = [...base];
  for (const e of extra) {
    if (!out.some((h) => h.courseId === e.courseId && h.from === e.from)) out.push(e);
  }
  return out;
}

/** Smallest subsets (by size, then order) of `shared` whose removal brings the
 *  pair within its limit; no returned set contains another. */
function holdSets(limit: PairLimit, shared: PairState["shared"]): number[][] {
  const n = shared.length;
  if (n === 0) return [];
  if (limit === "none") return [shared.map((_, i) => i)];
  if (n > MAX_ENUMERATED_SHARED) return [];
  const found: number[][] = [];
  const fits = (removed: Set<number>) =>
    !overLimit(
      limit,
      shared.filter((_, i) => !removed.has(i))
    );
  for (let k = 1; k <= n && found.length < MAX_HOLD_SETS; k++) {
    const pick: number[] = [];
    const walk = (start: number) => {
      if (found.length >= MAX_HOLD_SETS) return;
      if (pick.length === k) {
        const set = new Set(pick);
        if (found.some((f) => f.every((i) => set.has(i)))) return;
        if (fits(set)) found.push([...pick]);
        return;
      }
      for (let i = start; i < n; i++) {
        pick.push(i);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
  }
  return found;
}

export function enforceOverlap<R>(input: EnforceInput<R>): OverlapOutcome<R> {
  const { programs, counted, score } = input;
  const cost = input.cost ?? (() => 1);
  const maxResolves = input.maxResolves ?? MAX_RESOLVES;
  const byId = new Map(programs.map((p) => [p.id, p]));

  const nodeOf = (r: R, held: HeldEntry[]): Node<R> => ({
    held,
    r,
    pairs: measurePairs(programs, counted(r)),
    score: score(r),
  });
  const feasible = (n: Node<R>) => !n.pairs.some((p) => p.over);
  const outcome = (n: Node<R>, estimated: boolean, resolves: number): OverlapOutcome<R> => ({
    result: n.r,
    held: n.held,
    pairs: n.pairs,
    estimated,
    resolves,
    unresolved: !feasible(n),
  });

  /** The sides `courseId` may be held back from in pair (a, b): the later
   *  program first, never one that can't re-solve, never the one the student
   *  chose it for (unless that leaves no side at all: the choice then can't be
   *  honoured and the limit wins). */
  const sidesFor = (pair: PairState, courseId: string): string[] => {
    const holdable = [pair.b, pair.a].filter((id) => byId.get(id)?.holdable);
    const chosen = input.countsFor?.get(courseId);
    const honoured = holdable.filter((id) => id !== chosen);
    return honoured.length > 0 ? honoured : holdable;
  };

  const root = nodeOf(input.base, []);
  if (feasible(root)) return outcome(root, false, 0);

  /** Hold-back combinations for the node's first pair over its limit, the
   *  smallest and cheapest first. */
  const candidates = (n: Node<R>): HeldEntry[][] => {
    const pair = n.pairs.find((p) => p.over)!;
    const tag = pairKey(pair.a, pair.b);
    const out: { entries: HeldEntry[]; size: number; cost: number }[] = [];
    for (const set of holdSets(pair.limit, pair.shared)) {
      const options = set.map((i) => sidesFor(pair, pair.shared[i].courseId));
      if (options.some((o) => o.length === 0)) continue;
      // Every side assignment (at most 2^|set|, capped by the budget anyway).
      let combos: HeldEntry[][] = [[]];
      set.forEach((i, k) => {
        const courseId = pair.shared[i].courseId;
        const next: HeldEntry[][] = [];
        for (const combo of combos) {
          for (const from of options[k]) next.push([...combo, { courseId, from, pair: tag }]);
        }
        combos = next.slice(0, 64);
      });
      for (const entries of combos) {
        out.push({ entries, size: set.length, cost: entries.reduce((s, e) => s + cost(n.r, e.from, e.courseId), 0) });
      }
    }
    out.sort((x, y) => x.size - y.size || x.cost - y.cost);
    return out.map((o) => o.entries);
  };

  let resolves = 0;
  let best: Node<R> | null = null;
  let exhausted = true;
  const seen = new Set<string>([heldKey(root.held)]);
  const frontier: Node<R>[] = [root];

  search: while (frontier.length > 0) {
    frontier.sort((x, y) => y.score - x.score);
    const node = frontier.shift()!;
    // Holding more back never helps a program, so a node already no better
    // than the best feasible one can't lead to a better one.
    if (best && node.score <= best.score) continue;
    for (const extra of candidates(node)) {
      const held = mergeHeld(node.held, extra);
      const key = heldKey(held);
      if (seen.has(key)) continue;
      if (resolves >= maxResolves) {
        exhausted = false;
        break search;
      }
      seen.add(key);
      const child = nodeOf(input.solve(held), held);
      resolves++;
      if (feasible(child)) {
        if (!best || child.score > best.score) best = child;
      } else {
        frontier.push(child);
      }
    }
  }

  if (best) return outcome(best, !exhausted, resolves);

  // ── Greedy fallback: from the most promising state, every pair over its
  //    limit holds back its cheapest shared courses (one at a time, by cost,
  //    until the pair would fit), then one re-solve; repeated until the solve
  //    honours every limit (a re-solve can pick new shared courses). ──
  frontier.sort((x, y) => y.score - x.score);
  let node = frontier[0] ?? root;
  for (let step = 0; step < MAX_GREEDY_STEPS && !feasible(node); step++) {
    const picks: HeldEntry[] = [];
    const isHeld = (courseId: string, from: string) =>
      [...node.held, ...picks].some((h) => h.courseId === courseId && h.from === from);
    for (const pair of node.pairs) {
      if (!pair.over) continue;
      let remaining = pair.shared.filter((s) => !picks.some((h) => h.courseId === s.courseId && (h.from === pair.a || h.from === pair.b)));
      while (overLimit(pair.limit, remaining)) {
        let pick: HeldEntry | null = null;
        let pickCost = Number.POSITIVE_INFINITY;
        for (const { courseId } of remaining) {
          for (const from of sidesFor(pair, courseId)) {
            if (isHeld(courseId, from)) continue;
            const c = cost(node.r, from, courseId);
            if (c < pickCost) {
              pick = { courseId, from, pair: pairKey(pair.a, pair.b) };
              pickCost = c;
            }
          }
        }
        if (!pick) break;
        picks.push(pick);
        const taken = pick.courseId;
        remaining = remaining.filter((s) => s.courseId !== taken);
      }
    }
    if (picks.length === 0) break;
    const held = mergeHeld(node.held, picks);
    node = nodeOf(input.solve(held), held);
    resolves++;
  }
  return outcome(node, true, resolves);
}
