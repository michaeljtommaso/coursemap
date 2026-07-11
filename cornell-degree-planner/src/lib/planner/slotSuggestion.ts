/**
 * slotSuggestion.ts (spec 009 §1) — "the card becomes the course; the template
 * is a hint." Two pure concerns for a slot that now holds a placed course:
 *
 *   1. `slotSuggestionLabel(slot)` — the quiet, human label of the slot's FORMER
 *      identity ("First-Year Writing Seminar", an elective group's name, a fixed
 *      course code). Null for custom (_plan) slots, which suggest nothing.
 *
 *   2. `placedCourseSatisfiesSlot(slot, course)` — does the placed course
 *      actually satisfy the requirement the slot was suggesting? Answered by the
 *      ONE satisfaction function (spec 007 §4, courseSatisfiesRequirement) for
 *      course/pattern/attribute slots; by the elective qualifying rule for
 *      elective slots; and trivially true when there's nothing to satisfy.
 *
 * The card shows the "suggested: <label>" hint ONLY when there's a label AND the
 * placed course does NOT satisfy it — i.e. a genuine mismatch worth a whisper.
 * When the course satisfies the suggestion (the common case), no hint.
 */

import {
  courseSatisfiesRequirement,
  type Requirement,
} from "./satisfies";
import type { ProgramSlotWithData, Course, QualifyingRule } from "@/types/db";

/** The Requirement a template slot expresses, for the honesty check. Course /
 *  pattern / attribute slots become a Requirement; elective and custom slots
 *  return null (electives are handled by their qualifying rule, custom slots
 *  express nothing). */
export function slotRequirement(
  slot: Pick<
    ProgramSlotWithData,
    "kind" | "course_id" | "courses" | "pattern" | "attribute_match"
  >
): Requirement | null {
  if (slot.kind === "course") {
    const courseId = slot.courses?.id ?? slot.course_id;
    if (courseId) return { kind: "course", courseId };
    return null;
  }
  if (slot.kind === "pattern" && slot.pattern) {
    return { kind: "pattern", pattern: slot.pattern };
  }
  if (slot.kind === "attribute" && slot.attribute_match) {
    return { kind: "attribute", match: slot.attribute_match };
  }
  return null;
}

/** Does an elective qualifying rule ACCEPT this course for the honesty hint?
 *  Deliberately distinct from useMajorMatch's `qualifies` (which is a POSITIVE
 *  match, so it returns false for the non-computable `list`/`category` rules).
 *  Here the answer feeds a NEGATIVE warning ("this doesn't fit"), so a rule we
 *  cannot evaluate client-side must NOT produce a false "doesn't fit" — it
 *  returns true (accept), leaving the hint off. `open` accepts everything;
 *  `level`/`outside` are computed from the id. */
function electiveRuleAccepts(rule: QualifyingRule, courseId: string): boolean {
  const [subject, numberStr] = courseId.split("-");
  const num = parseInt(numberStr ?? "", 10);
  switch (rule.type) {
    case "open":
      return true;
    case "level":
      return subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    case "outside":
      return !rule.exclude_subjects.includes(subject);
    case "list":
    case "category":
      // Not computable client-side — don't nag with a false mismatch.
      return true;
  }
}

/** True when the placed course satisfies the slot's own template suggestion.
 *  Course/pattern/attribute → the shared satisfaction function; elective → its
 *  qualifying rule; custom / no-requirement → true (nothing to warn about). */
export function placedCourseSatisfiesSlot(
  slot: Pick<
    ProgramSlotWithData,
    | "kind"
    | "course_id"
    | "courses"
    | "pattern"
    | "attribute_match"
    | "elective_groups"
    | "program_id"
  >,
  course: Pick<Course, "id" | "subject" | "number" | "title" | "attrs">,
  canonical: (id: string) => string = (id) => id
): boolean {
  const req = slotRequirement(slot);
  if (req) return courseSatisfiesRequirement(course, req, canonical);
  if (slot.kind === "elective" && slot.elective_groups) {
    // A user-added "any course" custom slot (program_id "_plan") accepts anything.
    if (slot.program_id === "_plan") return true;
    return electiveRuleAccepts(slot.elective_groups.qualifying_rule, course.id);
  }
  return true;
}

/** The quiet human label of the slot's former identity, or null when the slot
 *  suggests nothing (custom "_plan" slots). Used for the "suggested: <label>"
 *  hint line the card shows only on a genuine mismatch. */
export function slotSuggestionLabel(
  slot: Pick<
    ProgramSlotWithData,
    | "kind"
    | "pattern"
    | "pattern_title"
    | "courses"
    | "elective_groups"
    | "program_id"
  >
): string | null {
  if (slot.kind === "course" && slot.courses) {
    return `${slot.courses.subject} ${slot.courses.number}`;
  }
  if (slot.kind === "pattern") {
    return slot.pattern_title ?? slot.pattern ?? null;
  }
  if (slot.kind === "attribute") {
    return slot.pattern_title ?? "Requirement";
  }
  if (slot.kind === "elective" && slot.elective_groups) {
    if (slot.program_id === "_plan") return null; // user-added generic slot
    return slot.elective_groups.name;
  }
  return null;
}
