import type { PrereqExpr } from "@/types/db";

/**
 * satisfies.ts (spec 007 §4) — the ONE place in the app that answers
 * "is this requirement/prereq satisfied, and by what?". Two entry points share
 * a single tree-walk:
 *
 *   - evaluate(expr, ctx)                 — prereq/coreq expression trees.
 *   - courseSatisfiesRequirement(...)     — slot/requirement matching.
 *
 * evaluatePrereq.ts's old boolean evaluator is now a thin wrapper over
 * evaluate() (see evaluatePrereq.ts) — there is no second tree-walk anywhere.
 */

// Converts a Cornell course pattern to a regex.
// Patterns use dash separators ("CS-111x") while codes use spaces ("CS 1110").
// Both * and x/X are single-character wildcards (Cornell uses x for digit positions).
export function patternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/-/g, " ");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/[*xX]/g, ".");
  return new RegExp(`^${withWildcards}$`, "i");
}

export type EvalContext = {
  /** Courses that count as completed (earlier-semester / completed pool). */
  completedIds: Set<string>;
  /** Codes ("CS 1110") of the completed pool — for pattern leaves. */
  completedCodes: Set<string>;
  /** Courses available for {type:"concurrent"} nodes — completed PLUS anything
   *  planned in the same or an earlier semester (spec 005 §3). When omitted
   *  (e.g. catalog chips, which have no target semester), concurrent
   *  requirements stay satisfiable-by-definition. */
  concurrentIds?: Set<string>;
  /** Synthetic credit-course ids (spec 007 §2 — AP/IB/transfer). Empty by
   *  default; a later unit wires the real credit profile in. Credit counts as
   *  completed from semester 0, so a course leaf is satisfied by completedIds OR
   *  creditIds and concurrent leaves see it too. */
  creditIds?: Set<string>;
  /** Codes of the synthetic credit courses — for pattern leaves. */
  creditCodes?: Set<string>;
};

export type EvalResult = {
  /** "met" = hard-satisfied with every advisory node also satisfied.
   *  "advisory" = hard-satisfied but ≥1 advisory node's inner expr is unmet.
   *  "blocked" = a genuinely hard prereq is unmet. */
  state: "met" | "advisory" | "blocked";
  /** ids of satisfied course/concurrent leaves + matching code(s) of satisfied
   *  pattern leaves. Best-effort, for "satisfied by your AP credit" display. */
  satisfiedBy: string[];
  /** Hard unmet leaves only (advisory contributes nothing). Course/concurrent
   *  leaves as ids; pattern leaves in code form ("CS 3xxx"). */
  missing: string[];
  /** The note of every advisory node whose inner expr is unsatisfied. Reported
   *  for BOTH advisory and blocked states. */
  advisoryNotes: string[];
};

/** Union `extra` into `base` without mutating either. Returns `base` unchanged
 *  when `extra` is empty/absent, so the common (no-credit) path allocates nothing. */
function withPool(base: Set<string>, extra?: Set<string>): Set<string> {
  if (!extra || extra.size === 0) return base;
  const out = new Set(base);
  for (const v of extra) out.add(v);
  return out;
}

const EMPTY_RESULT: EvalResult = {
  state: "met",
  satisfiedBy: [],
  missing: [],
  advisoryNotes: [],
};

/**
 * Evaluate a prereq/coreq expression tree against the plan + credit pools.
 * null/undefined expr → "met" with empty arrays (callers keep their own
 * null-display semantics separately — a null expr means "no requirement").
 */
export function evaluate(
  expr: PrereqExpr | null | undefined,
  ctx: EvalContext
): EvalResult {
  if (!expr) return { ...EMPTY_RESULT };

  // ── Effective pools: credit counts as completed from semester 0. ──
  const ids = withPool(ctx.completedIds, ctx.creditIds); // course leaves
  const codes = withPool(ctx.completedCodes, ctx.creditCodes); // pattern leaves
  // Concurrent leaves see concurrent ∪ completed ∪ credit; undefined stays
  // satisfiable-by-definition (no target semester).
  const concurrent = ctx.concurrentIds
    ? withPool(withPool(ctx.concurrentIds, ctx.completedIds), ctx.creditIds)
    : undefined;

  // Hard evaluation: treats every advisory node as satisfied (current
  // evaluatePrereq semantics).
  const hard = (e: PrereqExpr): boolean => {
    switch (e.type) {
      case "and":
        return e.children.every(hard);
      case "or":
        return e.children.some(hard);
      case "course":
        return ids.has(e.id);
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) return true;
        return false;
      }
      case "concurrent":
        return concurrent ? concurrent.has(e.id) : true;
      case "advisory":
        return true;
    }
  };

  // Hard unmet leaves (blame set): satisfied branch contributes nothing; a
  // failed OR surfaces every alternative; a failed AND surfaces each failing
  // child; advisory contributes nothing.
  const unmet = (e: PrereqExpr): string[] => {
    switch (e.type) {
      case "and":
        return e.children.flatMap(unmet);
      case "or":
        if (hard(e)) return [];
        return e.children.flatMap(unmet);
      case "course":
        return ids.has(e.id) ? [] : [e.id];
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) return [];
        // Present the pattern in code form ("CS 3xxx") rather than dash form.
        return [e.pattern.replace(/-/g, " ")];
      }
      case "concurrent": {
        const ok = concurrent ? concurrent.has(e.id) : true;
        return ok ? [] : [e.id];
      }
      case "advisory":
        return [];
    }
  };

  // Best-effort evidence: leaves that individually evaluated true (walks the
  // whole tree, including advisory inner exprs).
  const collectSatisfied = (e: PrereqExpr, out: string[]): void => {
    switch (e.type) {
      case "and":
      case "or":
        for (const c of e.children) collectSatisfied(c, out);
        return;
      case "course":
        if (ids.has(e.id)) out.push(e.id);
        return;
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) out.push(code);
        return;
      }
      case "concurrent":
        // Only real evidence — a satisfiable-by-definition concurrent (no
        // target semester) is not "satisfied by" anything.
        if (concurrent && concurrent.has(e.id)) out.push(e.id);
        return;
      case "advisory":
        collectSatisfied(e.expr, out);
        return;
    }
  };

  // Every advisory node whose inner expr is hard-unsatisfied → its note.
  const collectAdvisoryNotes = (e: PrereqExpr, out: string[]): void => {
    switch (e.type) {
      case "and":
      case "or":
        for (const c of e.children) collectAdvisoryNotes(c, out);
        return;
      case "advisory":
        if (!hard(e.expr)) out.push(e.note);
        collectAdvisoryNotes(e.expr, out); // nested advisories
        return;
      default:
        return;
    }
  };

  const hardSatisfied = hard(expr);

  const advisoryNotesArr: string[] = [];
  collectAdvisoryNotes(expr, advisoryNotesArr);
  const advisoryNotes = [...new Set(advisoryNotesArr)];

  const satisfiedArr: string[] = [];
  collectSatisfied(expr, satisfiedArr);
  const satisfiedBy = [...new Set(satisfiedArr)];

  const missing = [...new Set(unmet(expr))];

  let state: EvalResult["state"];
  if (!hardSatisfied) state = "blocked";
  else if (advisoryNotes.length > 0) state = "advisory";
  else state = "met";

  return { state, satisfiedBy, missing, advisoryNotes };
}

/**
 * Requirement match (spec 007 §4) — a discriminated union DESIGNED TO GROW:
 * spec 010/011 add `attribute`, `list`, `nOfM`, and `creditMin` kinds. Add new
 * kinds here (and a matching branch in courseSatisfiesRequirement) — never a
 * second matcher in a consumer.
 */
export type Requirement =
  | { kind: "course"; courseId: string }
  | { kind: "pattern"; pattern: string };

/**
 * Does `course` satisfy `requirement`? The single course↔requirement test every
 * surface (major match, catalog fit chips, ShareView) shares.
 *  - course-kind: canonical(course.id) === canonical(requirement.courseId).
 *  - pattern-kind: patternToRegex(pattern) tests `${subject} ${number}`.
 */
export function courseSatisfiesRequirement(
  course: { id: string; subject: string; number: string },
  requirement: Requirement,
  canonical: (id: string) => string = (id) => id
): boolean {
  switch (requirement.kind) {
    case "course":
      return canonical(course.id) === canonical(requirement.courseId);
    case "pattern":
      return patternToRegex(requirement.pattern).test(
        `${course.subject} ${course.number}`
      );
  }
}
