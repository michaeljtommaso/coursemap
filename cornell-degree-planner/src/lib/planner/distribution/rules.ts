import { patternToRegex } from "../satisfies";
import { markKey, parseRef } from "../questions/keys";
import { courseVariants } from "../majorMatch";
import type { Answers, CourseRule, DistCourse, Layer, Row } from "./types";

/**
 * rules.ts (spec 019 D8 amendment) — THE evaluator for CourseRule. The engine,
 * the checker and the Classes filter all call this; none re-implements a leaf.
 *
 * Every leaf answers about one course. A leaf that needs data the course lacks
 * answers false (a synthetic credit course has no tags), except `creditKind`,
 * where a credit course of unknown kind matches every kind: rules use it to
 * EXCLUDE credit ("not AP"), so unknown must fail closed. `examScore`
 * (spec 028) matches only an exam credit course with a listed exam AND score;
 * a credit course missing either, and every board course, is false.
 *
 * A credit course granted as Cornell's "X or Y" (spec 028, `altIds`) matches
 * when the course OR any one alternate satisfies the WHOLE rule (one reading
 * at a time, so `allOf` never mixes two alternates); the engines still count
 * it once.
 *
 * `answered` (spec 020) is the one leaf that reads the student's answers: a
 * studentFact ref is true when the fact is "yes"; a row-scoped mark ref is
 * true when this course's mark is "yes" AND the course is inside the
 * question's `courses` scope (ctx.questionScopes). Anything else — no
 * answers, "no", no known scope, a credit-mark ref, a malformed ref — is
 * false (the strict reading). `assumeYes` (catalog search only) reads every
 * leaf as a hypothetical yes instead.
 */

export type RuleContext = {
  programId?: string | null;
  canonical?: (id: string) => string;
  /** The student's answers (spec 020); absent → every `answered` leaf is false. */
  answers?: Answers;
  /** Row-mark question ref → that question's `courses` (questionScopes in
   *  questions/keys.ts). A row-mark `answered` leaf is true only for a course
   *  inside its question's scope; a ref with no scope here is false. */
  questionScopes?: Record<string, CourseRule>;
  /** Catalog search ("find a class"): read every `answered` leaf as if the
   *  student said yes wherever the question could apply — a fact ref is
   *  true, a row-mark ref is true for a course in its question's scope —
   *  so the search lists courses that COULD count. Never set when scoring. */
  assumeYes?: boolean;
};

/** Is the course inside the row-mark question's scope? The scope rule is
 *  evaluated without answers (lint forbids `answered` in a question's
 *  `courses`; without answers such a leaf fails closed instead of recursing). */
function inQuestionScope(course: DistCourse, ref: string, ctx: RuleContext): boolean {
  const scopes = ctx.questionScopes;
  if (scopes == null || !Object.prototype.hasOwnProperty.call(scopes, ref)) return false;
  return courseMatchesRule(course, scopes[ref], { programId: ctx.programId, canonical: ctx.canonical });
}

const identity = (id: string) => id;

export function courseMatchesRule(course: DistCourse, rule: CourseRule, ctx: RuleContext = {}): boolean {
  if (course.altIds && course.altIds.length > 0) {
    return courseVariants(course).some((v, i) =>
      matchOne(i === 0 ? { ...course, altIds: undefined } : v, rule, ctx)
    );
  }
  return matchOne(course, rule, ctx);
}

/** The rules a row's own matching reads (not its sub-limits): a seat's or
 *  pool's rule; a distribution row's eligibility rule plus the picked
 *  categories' rules (none picked → nothing); each option of an anyOf.
 *  Credits and confirm rows grant nothing (credit already counts toward
 *  credit totals). */
function grantedRules(row: Row, categories: readonly string[] | undefined, out: Set<CourseRule>): void {
  switch (row.kind) {
    case "seat":
    case "pool":
      out.add(row.rule);
      return;
    case "distribution": {
      const picked = new Set(categories ?? []);
      if (picked.size === 0) return;
      if (row.rule) out.add(row.rule);
      for (const c of row.categories) if (picked.has(c.id)) out.add(c.rule);
      return;
    }
    case "anyOf":
      for (const child of row.rows) grantedRules(child, categories, out);
      return;
    case "credits":
    case "confirm":
      return;
  }
}

/**
 * Spec 046 D6 — the rule objects a student-placed credit is granted:
 * `placedFor.row` is a Requirements item id (`${layerId}:${rowId}`). null when
 * the course carries no choice or the choice names no loaded row (another
 * program, an Engineering id, a row since re-authored): the credit then
 * matches as any credit does. The engine and the checker both read this.
 */
export function placedRules(course: DistCourse, layers: readonly Layer[]): Set<CourseRule> | null {
  const target = course.placedFor;
  if (!target) return null;
  const at = target.row.indexOf(":");
  if (at < 0) return null;
  const layer = layers.find((l) => l.id === target.row.slice(0, at));
  const row = layer?.rows.find((r) => r.id === target.row.slice(at + 1));
  if (!row) return null;
  const rules = new Set<CourseRule>();
  grantedRules(row, target.categories, rules);
  return rules.size > 0 ? rules : null;
}

/** The leaves that say WHICH course this is (spec 046 D6). Every other leaf
 *  (credit kind, exam score, credits, program, answers) is about the credit
 *  itself or the student, and keeps its normal reading. */
const IDENTITY_LEAVES = ["tag", "subject", "number", "course", "pattern", "titleStartsWith"] as const;

/**
 * Spec 046 D6 — `rule` read for a credit the student placed on this row
 * ("my advisor counts this transfer toward it"): every identity leaf answers
 * in the rule's favour (true outside a `not`, false inside one), every other
 * leaf as usual. So "an ECON course" and "outside ECON" both accept it, while
 * "not transfer credit" still refuses it. Only the engine calls this, and only
 * for the rule objects the student's choice grants.
 */
export function courseMatchesRuleFavoured(course: DistCourse, rule: CourseRule, ctx: RuleContext = {}): boolean {
  return favoured(course, rule, ctx, true);
}

function favoured(course: DistCourse, rule: CourseRule, ctx: RuleContext, positive: boolean): boolean {
  if ("allOf" in rule) return rule.allOf.every((r) => favoured(course, r, ctx, positive));
  if ("anyOf" in rule) return rule.anyOf.some((r) => favoured(course, r, ctx, positive));
  if ("not" in rule) return !favoured(course, rule.not, ctx, !positive);
  if (IDENTITY_LEAVES.some((k) => k in rule)) return positive;
  return matchOne(course, rule, ctx);
}

function matchOne(course: DistCourse, rule: CourseRule, ctx: RuleContext): boolean {
  if ("allOf" in rule) return rule.allOf.every((r) => matchOne(course, r, ctx));
  if ("anyOf" in rule) return rule.anyOf.some((r) => matchOne(course, r, ctx));
  if ("not" in rule) return !matchOne(course, rule.not, ctx);

  if ("tag" in rule) {
    const have = course.attrs?.map((a) => a.value) ?? [];
    return rule.tag.some((t) => have.includes(t));
  }
  if ("subject" in rule) {
    if (rule.subject.includes(course.subject)) return true;
    return rule.crossListed === true && (course.crossListedSubjects ?? []).some((s) => rule.subject.includes(s));
  }
  if ("number" in rule) {
    const n = parseInt(course.number, 10);
    if (Number.isNaN(n)) return false;
    const { min, max } = rule.number;
    return (min == null || n >= min) && (max == null || n <= max);
  }
  if ("course" in rule) {
    const canonical = ctx.canonical ?? identity;
    const id = canonical(course.id);
    return rule.course.some((c) => canonical(c) === id);
  }
  if ("pattern" in rule) return patternToRegex(rule.pattern).test(`${course.subject} ${course.number}`);
  if ("titleStartsWith" in rule) return course.title != null && course.title.startsWith(rule.titleStartsWith);
  if ("minCredits" in rule) return course.credits >= rule.minCredits;
  if ("variableCredit" in rule) return course.variableCredit === true || (course.creditsMax ?? course.credits) > course.credits;
  if ("creditKind" in rule) {
    if (!course.isCredit) return false;
    return course.creditKind == null || rule.creditKind.includes(course.creditKind);
  }
  if ("examScore" in rule) {
    // Spec 028: fail closed — only an exam credit course carrying both its
    // exam id and its score can match ("AP Calculus at 5").
    if (!course.isCredit || course.creditExam == null || course.creditScore == null) return false;
    return rule.examScore.exam.includes(course.creditExam) && rule.examScore.scores.includes(course.creditScore);
  }
  if ("program" in rule) {
    // A listed id matches itself and every catalog year of it:
    // "cornell-aem-bs" matches "cornell-aem-bs-2026" (program ids carry a year).
    const id = ctx.programId;
    return id != null && rule.program.some((p) => id === p || id.startsWith(`${p}-`));
  }
  if ("answered" in rule) {
    const ref = parseRef(rule.answered);
    if (ref == null) return false;
    if (ref.type === "creditsTaken" || ref.type === "sequenceDone") return false;
    if (ctx.assumeYes) return ref.type === "studentFact" || inQuestionScope(course, rule.answered, ctx);
    if (ctx.answers == null) return false;
    if (ref.type === "studentFact") return ctx.answers.facts?.[rule.answered] === "yes";
    const canonical = ctx.canonical ?? identity;
    if (ctx.answers.marks?.[markKey(rule.answered, canonical(course.id))] !== "yes") return false;
    return inQuestionScope(course, rule.answered, ctx);
  }

  // Unreachable for schema-valid rules; an unknown leaf matches nothing.
  return false;
}
