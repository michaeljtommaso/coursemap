import { patternToRegex } from "../satisfies";
import { markKey, parseRef } from "../questions/keys";
import type { Answers, CourseRule, DistCourse } from "./types";

/**
 * rules.ts (spec 019 D8 amendment) — THE evaluator for CourseRule. The engine,
 * the checker and the Classes filter all call this; none re-implements a leaf.
 *
 * Every leaf answers about one course. A leaf that needs data the course lacks
 * answers false (a synthetic credit course has no tags), except `creditKind`,
 * where a credit course of unknown kind matches every kind: rules use it to
 * EXCLUDE credit ("not AP"), so unknown must fail closed.
 *
 * `answered` (spec 020) is the one leaf that reads the student's answers: a
 * studentFact ref is true when the fact is "yes"; a row-scoped mark ref is
 * true when this course's mark is "yes". Anything else — no answers, "no", a
 * credit-mark ref, a malformed ref — is false (the strict reading).
 */

export type RuleContext = {
  programId?: string | null;
  canonical?: (id: string) => string;
  /** The student's answers (spec 020); absent → every `answered` leaf is false. */
  answers?: Answers;
};

const identity = (id: string) => id;

export function courseMatchesRule(course: DistCourse, rule: CourseRule, ctx: RuleContext = {}): boolean {
  if ("allOf" in rule) return rule.allOf.every((r) => courseMatchesRule(course, r, ctx));
  if ("anyOf" in rule) return rule.anyOf.some((r) => courseMatchesRule(course, r, ctx));
  if ("not" in rule) return !courseMatchesRule(course, rule.not, ctx);

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
  if ("variableCredit" in rule) return (course.creditsMax ?? course.credits) > course.credits;
  if ("creditKind" in rule) {
    if (!course.isCredit) return false;
    return course.creditKind == null || rule.creditKind.includes(course.creditKind);
  }
  if ("program" in rule) {
    // A listed id matches itself and every catalog year of it:
    // "cornell-aem-bs" matches "cornell-aem-bs-2026" (program ids carry a year).
    const id = ctx.programId;
    return id != null && rule.program.some((p) => id === p || id.startsWith(`${p}-`));
  }
  if ("answered" in rule) {
    const ref = parseRef(rule.answered);
    if (ref == null || ctx.answers == null) return false;
    if (ref.type === "studentFact") return ctx.answers.facts?.[rule.answered] === "yes";
    if (ref.type === "creditsTaken" || ref.type === "sequenceDone") return false;
    const canonical = ctx.canonical ?? identity;
    return ctx.answers.marks?.[markKey(rule.answered, canonical(course.id))] === "yes";
  }

  // Unreachable for schema-valid rules; an unknown leaf matches nothing.
  return false;
}
