// Relative (not "@/") so Node scripts can import this module directly.
import type { PrereqExpr } from "../../types/db";

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
  /** Cross-listing canonicalizer (alias id → canonical id, from the catalog's
   *  alias map). Course and concurrent leaves compare canonical ids, so a
   *  cross-listed twin satisfies the leaf (ENGRD-2110 meets a CS-2110 leaf and
   *  vice versa), and a pool course's canonical code also counts toward pattern
   *  leaves. Omitted → identity (exact id matching). */
  canonical?: (id: string) => string;
  /** Every course on the board, in any semester. An advisory ("or
   *  equivalent") node normally never blocks, since the student may hold
   *  credit or an equivalent; but when its unmet requirement names a course
   *  that IS on the board, just too late (not in this context's pools), the
   *  order is simply wrong and the node blocks like a hard requirement.
   *  Omitted (no board context, e.g. catalog chips) → advisory never blocks. */
  boardIds?: Set<string>;
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
  /** The unmet leaves inside those same advisory nodes (same forms as
   *  `missing`), so the UI can name what is "usually" needed ("Usually needs
   *  MATH 1910 first"). Informational only — never part of `missing`. */
  advisoryLeaves: string[];
};

/** Union `extra` into `base` without mutating either. Returns `base` unchanged
 *  when `extra` is empty/absent, so the common (no-credit) path allocates nothing. */
function withPool(base: Set<string>, extra?: Set<string>): Set<string> {
  if (!extra || extra.size === 0) return base;
  const out = new Set(base);
  for (const v of extra) out.add(v);
  return out;
}

/** Map every id in `pool` through `canonical`. Returns `pool` itself when no
 *  canonicalizer is supplied (the common path allocates nothing). */
function canonicalPool(pool: Set<string>, canonical?: (id: string) => string): Set<string> {
  if (!canonical) return pool;
  const out = new Set<string>();
  for (const id of pool) out.add(canonical(id));
  return out;
}

/** Add the code form ("CS 2110") of each pool id's canonical twin, so a
 *  cross-listed course also counts toward its twin's pattern leaves. */
function withCanonicalCodes(
  codes: Set<string>,
  ids: Set<string>,
  canonical?: (id: string) => string
): Set<string> {
  if (!canonical) return codes;
  let out: Set<string> | null = null;
  for (const id of ids) {
    const c = canonical(id);
    if (c === id) continue;
    out ??= new Set(codes);
    out.add(c.replace(/-/g, " "));
  }
  return out ?? codes;
}

const EMPTY_RESULT: EvalResult = {
  state: "met",
  satisfiedBy: [],
  missing: [],
  advisoryNotes: [],
  advisoryLeaves: [],
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
  const canon = ctx.canonical;
  const rawIds = withPool(ctx.completedIds, ctx.creditIds);
  const ids = canonicalPool(rawIds, canon); // course leaves
  const codes = withCanonicalCodes(withPool(ctx.completedCodes, ctx.creditCodes), rawIds, canon); // pattern leaves
  // Concurrent leaves see concurrent ∪ completed ∪ credit; undefined stays
  // satisfiable-by-definition (no target semester).
  const concurrent = ctx.concurrentIds
    ? canonicalPool(withPool(withPool(ctx.concurrentIds, ctx.completedIds), ctx.creditIds), canon)
    : undefined;
  // A leaf id in the same (canonical) space as the pools.
  const key = canon ? canon : (id: string) => id;
  const board = ctx.boardIds ? canonicalPool(ctx.boardIds, canon) : undefined;

  // Does this subtree name a course that is on the board but not in time (not
  // in the pool its leaf type reads)?
  const placedLate = (e: PrereqExpr): boolean => {
    if (!board) return false;
    switch (e.type) {
      case "and":
      case "or":
        return e.children.some(placedLate);
      case "course":
        return board.has(key(e.id)) && !ids.has(key(e.id));
      case "concurrent":
        return board.has(key(e.id)) && !!concurrent && !concurrent.has(key(e.id));
      case "advisory":
        return placedLate(e.expr);
      default:
        return false;
    }
  };
  // An advisory node blocks only when its inner requirement is unmet AND the
  // board schedules (part of) it too late.
  const lateBlocked = (e: Extract<PrereqExpr, { type: "advisory" }>): boolean =>
    !hard(e.expr) && placedLate(e.expr);

  // Hard evaluation: an advisory node is satisfied unless the board places
  // its requirement too late (lateBlocked).
  const hard = (e: PrereqExpr): boolean => {
    switch (e.type) {
      case "and":
        return e.children.every(hard);
      case "or":
        return e.children.some(hard);
      case "course":
        return ids.has(key(e.id));
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) return true;
        return false;
      }
      case "concurrent":
        return concurrent ? concurrent.has(key(e.id)) : true;
      case "advisory":
        return !lateBlocked(e);
    }
  };

  // Hard unmet leaves (blame set): satisfied branch contributes nothing; a
  // failed OR surfaces every alternative; a failed AND surfaces each failing
  // child; an advisory contributes its inner misses only when late-blocked.
  const unmet = (e: PrereqExpr): string[] => {
    switch (e.type) {
      case "and":
        return e.children.flatMap(unmet);
      case "or":
        if (hard(e)) return [];
        return e.children.flatMap(unmet);
      case "course":
        return ids.has(key(e.id)) ? [] : [e.id];
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) return [];
        // Present the pattern in code form ("CS 3xxx") rather than dash form.
        return [e.pattern.replace(/-/g, " ")];
      }
      case "concurrent": {
        const ok = concurrent ? concurrent.has(key(e.id)) : true;
        return ok ? [] : [e.id];
      }
      case "advisory":
        return lateBlocked(e) ? unmet(e.expr) : [];
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
        if (ids.has(key(e.id))) out.push(e.id);
        return;
      case "pattern": {
        const re = patternToRegex(e.pattern);
        for (const code of codes) if (re.test(code)) out.push(code);
        return;
      }
      case "concurrent":
        // Only real evidence — a satisfiable-by-definition concurrent (no
        // target semester) is not "satisfied by" anything.
        if (concurrent && concurrent.has(key(e.id))) out.push(e.id);
        return;
      case "advisory":
        collectSatisfied(e.expr, out);
        return;
    }
  };

  // Every advisory node whose inner expr is hard-unsatisfied → its note, and
  // the leaves its inner expr is missing.
  const collectAdvisoryNotes = (e: PrereqExpr, out: string[], leaves: string[]): void => {
    switch (e.type) {
      case "and":
      case "or":
        for (const c of e.children) collectAdvisoryNotes(c, out, leaves);
        return;
      case "advisory":
        // A late-blocked node is a hard miss now, not a soft note.
        if (!hard(e.expr) && !lateBlocked(e)) {
          out.push(e.note);
          leaves.push(...unmet(e.expr));
        }
        collectAdvisoryNotes(e.expr, out, leaves); // nested advisories
        return;
      default:
        return;
    }
  };

  const hardSatisfied = hard(expr);

  const advisoryNotesArr: string[] = [];
  const advisoryLeavesArr: string[] = [];
  collectAdvisoryNotes(expr, advisoryNotesArr, advisoryLeavesArr);
  const advisoryNotes = [...new Set(advisoryNotesArr)];
  const advisoryLeaves = [...new Set(advisoryLeavesArr)];

  const satisfiedArr: string[] = [];
  collectSatisfied(expr, satisfiedArr);
  const satisfiedBy = [...new Set(satisfiedArr)];

  const missing = [...new Set(unmet(expr))];

  let state: EvalResult["state"];
  if (!hardSatisfied) state = "blocked";
  else if (advisoryNotes.length > 0) state = "advisory";
  else state = "met";

  return { state, satisfiedBy, missing, advisoryNotes, advisoryLeaves };
}

/**
 * Attribute match (spec 010 §2) — a requirement that matches on course
 * PROPERTIES (title, distribution attrs) rather than a code. DESIGNED TO GROW:
 * new fields/ops (e.g. `title contains`, `attrs.group in`) are added to
 * `AttributePredicate` and to `attributePredicateMatches` below — the ONE place
 * predicate semantics live. Consumers (satisfies, the catalog index filter, the
 * seed validator) normalize their data into `AttributeInput` and call
 * `matchesAttribute`; they NEVER re-implement a predicate.
 *
 * Field names are APP-side (`title`, not the roster's `titleLong`).
 */
export type AttributePredicate =
  | { field: "title"; op: "startsWith"; value: string }
  | { field: "attrs.value"; op: "in"; value: string[] };

export type AttributeMatch = { anyOf: AttributePredicate[] };

/** Normalized, source-agnostic view of a course for attribute matching. A full
 *  Course supplies title + attr values; the lean catalog index supplies title,
 *  attr values, and the derived `fws` flag. Any field may be absent — a
 *  predicate that needs a missing field returns false (never throws). */
export type AttributeInput = {
  title?: string | null;
  /** crseAttrs values, e.g. ["WRT-AG", "ALC-AS"]. */
  attrValues?: string[];
  /** Derived index flag: the course's title begins with "FWS:". Lets the
   *  catalog index answer the durable FWS predicate without re-testing the
   *  raw title (spec 010 §3 / Unit 10A). */
  fws?: boolean;
};

/** Evaluate ONE predicate against a normalized input. THE place predicate
 *  semantics live — add new fields/ops here, never in a consumer. */
function attributePredicateMatches(
  pred: AttributePredicate,
  input: AttributeInput
): boolean {
  switch (pred.field) {
    case "title":
      // op is always "startsWith" today. Prefer the derived `fws` flag for the
      // durable FWS marker (the index carries it); otherwise test the title.
      if (pred.value === "FWS:" && typeof input.fws === "boolean") return input.fws;
      return input.title != null && input.title.startsWith(pred.value);
    case "attrs.value": {
      // op "in": the course carries any of the listed attr values.
      const have = input.attrValues;
      if (!have || have.length === 0) return false;
      return pred.value.some((v) => have.includes(v));
    }
  }
}

/** OR across predicates (spec 010 §2). An empty `anyOf` matches nothing. */
export function matchesAttribute(input: AttributeInput, match: AttributeMatch): boolean {
  return match.anyOf.some((p) => attributePredicateMatches(p, input));
}

/** Loosely validate an unknown doc-side `attributeMatch` into a typed
 *  AttributeMatch, or null when the shape is unusable. Kept HERE (next to the
 *  predicate definitions) so the read boundary never learns predicate shapes.
 *  Unknown predicate shapes are dropped; if nothing valid survives → null, and
 *  the caller treats the slot as an unmatchable requirement (never crashes). */
export function normalizeAttributeMatch(raw: unknown): AttributeMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const anyOf = (raw as { anyOf?: unknown }).anyOf;
  if (!Array.isArray(anyOf) || anyOf.length === 0) return null;
  const preds: AttributePredicate[] = [];
  for (const p of anyOf) {
    if (!p || typeof p !== "object") continue;
    const { field, op, value } = p as { field?: unknown; op?: unknown; value?: unknown };
    if (field === "title" && op === "startsWith" && typeof value === "string") {
      preds.push({ field, op, value });
    } else if (
      field === "attrs.value" &&
      op === "in" &&
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    ) {
      preds.push({ field, op, value: value as string[] });
    }
    // Unrecognized predicate shape → dropped (forward-compatible; a future op
    // is added to attributePredicateMatches + here together).
  }
  return preds.length > 0 ? { anyOf: preds } : null;
}

/**
 * Requirement match (spec 007 §4) — a discriminated union DESIGNED TO GROW:
 * spec 010/011 add `attribute`, `list`, `nOfM`, and `creditMin` kinds. Add new
 * kinds here (and a matching branch in courseSatisfiesRequirement) — never a
 * second matcher in a consumer.
 */
export type Requirement =
  | { kind: "course"; courseId: string }
  | { kind: "pattern"; pattern: string }
  | { kind: "attribute"; match: AttributeMatch; label?: string };

/**
 * Does `course` satisfy `requirement`? The single course↔requirement test every
 * surface (major match, catalog fit chips, ShareView) shares.
 *  - course-kind: canonical(course.id) === canonical(requirement.courseId).
 *  - pattern-kind: patternToRegex(pattern) tests `${subject} ${number}`.
 *  - attribute-kind: matchesAttribute over the course's title + attr values.
 *
 * The course param is widened with OPTIONAL `title`/`attrs` for attribute
 * matching: callers holding a full Course pass them; callers with only id/
 * subject/number pass neither, and attribute predicates that need the missing
 * field simply return false (never throw).
 */
export function courseSatisfiesRequirement(
  course: {
    id: string;
    subject: string;
    number: string;
    title?: string | null;
    attrs?: { value: string }[] | null;
  },
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
    case "attribute":
      return matchesAttribute(
        {
          title: course.title ?? undefined,
          attrValues: course.attrs?.map((a) => a.value),
        },
        requirement.match
      );
  }
}
