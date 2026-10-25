import { patternToRegex } from "../satisfies";
import type { CourseRule, DistCourse } from "./types";

/**
 * rules.ts (spec 019 D8 amendment) — THE evaluator for CourseRule. The engine,
 * the checker and the Classes filter all call this; none re-implements a leaf.
 *
 * Every leaf answers about one course. A leaf that needs data the course lacks
 * answers false (a synthetic credit course has no tags), except `creditKind`,
 * where a credit course of unknown kind matches every kind: rules use it to
 * EXCLUDE credit ("not AP"), so unknown must fail closed.
 */

export type RuleContext = {
  programId?: string | null;
  canonical?: (id: string) => string;
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
  if ("program" in rule) return ctx.programId != null && rule.program.includes(ctx.programId);

  // Unreachable for schema-valid rules; an unknown leaf matches nothing.
  return false;
}
