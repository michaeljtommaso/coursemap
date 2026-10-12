// Relative imports only (no "@/"): this module is pure and is imported
// directly by Node scripts as well as the app.
import type { PrereqExpr } from "../../types/db";
import {
  courseSatisfiesRequirement,
  evaluate,
  patternToRegex,
  type EvalContext,
  type Requirement,
} from "./satisfies";

/**
 * pendingChoices.ts — the "pick one" state (spec 014 D2/D6 follow-up).
 *
 * In the placement model a choice requirement (CS 111x, a chemistry pick, an
 * engineering distribution) waits in the "Still needed" checklist until the
 * student picks. A placed course whose prerequisite can only be met by such a
 * pick is not wrong; it is waiting on a choice. This module answers, for one
 * HARD-blocked course: would the open choices (picked in time) unblock it, and
 * which choice should the card point at?
 *
 * The rule: re-evaluate the course's prereq and coreq trees with an extra
 * PENDING pool. A tree leaf is pending when an open requirement admits it and
 * that requirement's suggested semester is in time for the course's column:
 *   - prereq course/pattern leaves: strictly earlier (or no suggested semester);
 *   - coreq leaves and {concurrent} leaves: same-or-earlier (or none).
 * A course leaf is admitted via courseSatisfiesRequirement (subject + number
 * taken from the id). A pattern leaf is admitted by a pattern requirement with
 * the same pattern, or a course requirement whose course matches the pattern.
 *
 * If both trees pass with the pending pool, the course is in the choice state;
 * if any tree still fails, it stays blocked. An AND of two leaves that only
 * the same single pick could each supply counts as pending (a known, accepted
 * imprecision). computeCardStatusMap stays the hard engine; this is layered on
 * top of its `blocked` result.
 */

/** One open (unmet or partial), checkable requirement the student can still
 *  pick for. `suggestedSem` is the template's semester; null = unknown, which
 *  counts as "in time" for any column. */
export type OpenChoice = {
  id: string;
  label: string;
  /** The seat's requirement, or null for a "pick one of these" group, which
   *  names its members in `courseIds` instead. */
  requirement: Requirement | null;
  courseIds?: string[];
  suggestedSem: number | null;
};

/** The choice a blocked course is waiting on. `leaves` are the course's unmet
 *  leaves that choice would supply, in code form ("CS 1110", "CS 111x"). */
export type PendingChoice = {
  requirementId: string;
  label: string;
  leaves: string[];
};

/** The pools a course in `sem` is evaluated against — exactly the shape (and
 *  semantics) of computeCardStatusMap's `semesterPrereqPools` output, credit
 *  already folded in: completed = strictly-earlier (+ completed + credit);
 *  concurrent = same-or-earlier. */
export type ChoicePools = {
  completedIds: Set<string>;
  completedCodes: Set<string>;
  concurrentIds: Set<string>;
  concurrentCodes: Set<string>;
};

export type PendingChoiceInput = {
  prereqExpr: PrereqExpr | null | undefined;
  coreqExpr: PrereqExpr | null | undefined;
  /** The column the course is placed in. */
  sem: number;
  pools: ChoicePools;
  /** Open, checkable requirements, best-first (e.g. suggested-semester order);
   *  ties in the result are broken by this order. */
  choices: OpenChoice[];
  /** Cross-listing canonicalizer (alias map); identity by default. */
  canonical?: (id: string) => string;
};

type Timing = "strict" | "loose";

/** Every course/concurrent/pattern leaf of a tree with the timing its pick
 *  must meet. Advisory subtrees are skipped: they never block. */
function collectLeaves(
  expr: PrereqExpr | null | undefined,
  base: Timing,
  out: { kind: "course" | "pattern"; key: string; timing: Timing }[]
): void {
  if (!expr) return;
  switch (expr.type) {
    case "and":
    case "or":
      for (const c of expr.children) collectLeaves(c, base, out);
      return;
    case "course":
      out.push({ kind: "course", key: expr.id, timing: base });
      return;
    case "concurrent":
      out.push({ kind: "course", key: expr.id, timing: "loose" });
      return;
    case "pattern":
      out.push({ kind: "pattern", key: expr.pattern.replace(/-/g, " "), timing: base });
      return;
    case "advisory":
      return;
  }
}

function splitId(id: string): { subject: string; number: string } {
  const dash = id.indexOf("-");
  return dash >= 0
    ? { subject: id.slice(0, dash), number: id.slice(dash + 1) }
    : { subject: id, number: "" };
}

const normPattern = (p: string) => p.replace(/-/g, " ").trim().toUpperCase();

/** Does `choice` admit this leaf? */
function admits(
  choice: OpenChoice,
  leaf: { kind: "course" | "pattern"; key: string },
  canonical: (id: string) => string
): boolean {
  if (choice.courseIds && choice.courseIds.length > 0) {
    if (leaf.kind === "course") {
      const want = canonical(leaf.key);
      return choice.courseIds.some((id) => canonical(id) === want);
    }
    const re = patternToRegex(leaf.key);
    return choice.courseIds.some((id) => {
      const { subject, number } = splitId(canonical(id));
      return re.test(`${subject} ${number}`);
    });
  }
  const req = choice.requirement;
  if (!req) return false;
  if (leaf.kind === "course") {
    const { subject, number } = splitId(leaf.key);
    return courseSatisfiesRequirement({ id: leaf.key, subject, number }, req, canonical);
  }
  if (req.kind === "pattern") return normPattern(req.pattern) === normPattern(leaf.key);
  if (req.kind === "course") {
    const re = patternToRegex(leaf.key);
    return [req.courseId, canonical(req.courseId)].some((id) => {
      const { subject, number } = splitId(id);
      return re.test(`${subject} ${number}`);
    });
  }
  return false;
}

function inTime(choice: OpenChoice, sem: number, timing: Timing): boolean {
  if (choice.suggestedSem == null) return true;
  return timing === "strict" ? choice.suggestedSem < sem : choice.suggestedSem <= sem;
}

function union(base: Set<string>, extra: Set<string>): Set<string> {
  if (extra.size === 0) return base;
  const out = new Set(base);
  for (const v of extra) out.add(v);
  return out;
}

/**
 * The choice a HARD-blocked course is waiting on, or null when it isn't
 * blocked or when open choices can't unblock it (it stays blocked).
 *
 * Returns the single best choice: the one supplying the most of the course's
 * unmet leaves, ties broken by `choices` order. When the course needs picks
 * from two different choices, the first is reported; picking it leaves the
 * course in the choice state pointing at the second.
 */
export function findPendingChoice(input: PendingChoiceInput): PendingChoice | null {
  const { prereqExpr, coreqExpr, sem, pools, choices } = input;
  const canonical = input.canonical ?? ((id: string) => id);
  if (choices.length === 0 || (!prereqExpr && !coreqExpr)) return null;

  // Engine contexts, mirroring computeCardStatusMap's evaluate() calls.
  const prereqCtx = (extraStrict: Set<string>, extraStrictCodes: Set<string>, extraLoose: Set<string>): EvalContext => ({
    completedIds: union(pools.completedIds, extraStrict),
    completedCodes: union(pools.completedCodes, extraStrictCodes),
    concurrentIds: union(pools.concurrentIds, extraLoose),
    canonical: input.canonical,
  });
  const coreqCtx = (extraLoose: Set<string>, extraLooseCodes: Set<string>): EvalContext => ({
    completedIds: union(pools.concurrentIds, extraLoose),
    completedCodes: union(pools.concurrentCodes, extraLooseCodes),
    concurrentIds: union(pools.concurrentIds, extraLoose),
    canonical: input.canonical,
  });

  const none = new Set<string>();
  const basePrereq = prereqExpr ? evaluate(prereqExpr, prereqCtx(none, none, none)) : null;
  const baseCoreq = coreqExpr ? evaluate(coreqExpr, coreqCtx(none, none)) : null;
  const prereqBlocked = basePrereq?.state === "blocked";
  const coreqBlocked = baseCoreq?.state === "blocked";
  if (!prereqBlocked && !coreqBlocked) return null;

  // Leaves of both trees, with the timing a pick must meet for each.
  const leaves: { kind: "course" | "pattern"; key: string; timing: Timing }[] = [];
  collectLeaves(prereqExpr, "strict", leaves);
  collectLeaves(coreqExpr, "loose", leaves);

  // Pending pools: a leaf admitted by an in-time choice counts as taken. A
  // strict (earlier) pick is also in time for same-or-earlier leaves.
  const strictIds = new Set<string>();
  const strictCodes = new Set<string>();
  const looseIds = new Set<string>();
  const looseCodes = new Set<string>();
  const sourcesOf = new Map<string, Set<number>>(); // leaf key → choice indexes
  for (const leaf of leaves) {
    choices.forEach((choice, i) => {
      if (!inTime(choice, sem, leaf.timing) || !admits(choice, leaf, canonical)) return;
      const code = leaf.kind === "course" ? leaf.key.replace(/-/g, " ") : leaf.key;
      if (leaf.timing === "strict") {
        if (leaf.kind === "course") strictIds.add(leaf.key);
        strictCodes.add(code);
      }
      if (leaf.kind === "course") looseIds.add(leaf.key);
      looseCodes.add(code);
      const set = sourcesOf.get(leaf.key) ?? new Set<number>();
      set.add(i);
      sourcesOf.set(leaf.key, set);
    });
  }
  if (sourcesOf.size === 0) return null;

  const withPending = [
    prereqExpr ? evaluate(prereqExpr, prereqCtx(strictIds, strictCodes, looseIds)) : null,
    coreqExpr ? evaluate(coreqExpr, coreqCtx(looseIds, looseCodes)) : null,
  ];
  if (withPending.some((r) => r?.state === "blocked")) return null;

  // Rank choices by how many of the course's unmet leaves each supplies.
  const missing = [...new Set([...(basePrereq?.missing ?? []), ...(baseCoreq?.missing ?? [])])];
  const supplied = new Map<number, string[]>();
  for (const leaf of missing) {
    for (const i of sourcesOf.get(leaf) ?? []) {
      const list = supplied.get(i) ?? [];
      list.push(leaf);
      supplied.set(i, list);
    }
  }
  let best: number | null = null;
  for (const [i, list] of supplied) {
    const bestLen = best === null ? -1 : supplied.get(best)!.length;
    if (list.length > bestLen || (list.length === bestLen && i < best!)) best = i;
  }
  if (best === null) return null;

  const choice = choices[best];
  return {
    requirementId: choice.id,
    label: choice.label,
    leaves: supplied.get(best)!.map((l) => l.replace(/-/g, " ")),
  };
}

/**
 * Drop "pick one of these" choices whose pick is already on the board. A list
 * group never reads satisfied on its own (its rule isn't evaluated), so without
 * this a member placed too LATE would leave the group "open" and turn a
 * genuine ordering block amber. Seat choices need no filter: a placed seat
 * reads satisfied and is never open.
 */
export function withoutPlacedPicks(
  choices: OpenChoice[],
  placedIds: Iterable<string>,
  canonical: (id: string) => string = (id) => id
): OpenChoice[] {
  const placed = new Set<string>();
  for (const id of placedIds) placed.add(canonical(id));
  return choices.filter((c) => !c.courseIds || !c.courseIds.some((id) => placed.has(canonical(id))));
}
