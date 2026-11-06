/**
 * lib/credit/grantable.ts (spec 025) — the courses some exam can grant in a
 * college, for "could credit unblock this card?" (statusLine.creditCouldUnblock,
 * spec 007 §2b: a card blocked on a course an exam grants offers "Add credit").
 *
 * Read from the exam tables for the college (engineering → its own table;
 * cas / cals → the university awards plus the override's replacements;
 * null → university). Until the tables are bundled it falls back to the first
 * Engineering-only table (data/credit-equivalencies), so the hint never
 * disappears in between.
 */
import { CREDIT_EQUIVALENCIES } from "@/data/credit-equivalencies";
import { EXAM_TABLES } from "@/data/credit-tables";
import type { CreditCollege, ExamAward, ExamTables } from "./types";

export type GrantableEntry = { satisfiesCourseIds: string[] };

/** Pure: every award that grants a course in this college, as entries. */
export function grantableCourseEntries(college: CreditCollege, tables: ExamTables | null): GrantableEntry[] {
  if (tables == null) return CREDIT_EQUIVALENCIES;
  let awards: ExamAward[];
  if (college === "engineering") {
    awards = tables.engineering.awards;
  } else if (college === "cas" || college === "cals") {
    const override = tables.overrides[college];
    const replaced = new Set(override?.replaces ?? []);
    awards = [...tables.university.awards.filter((a) => !replaced.has(a.exam)), ...(override?.awards ?? [])];
  } else {
    awards = tables.university.awards;
  }
  return awards.filter((a) => a.courses.length > 0).map((a) => ({ satisfiesCourseIds: a.courses }));
}

const cache = new Map<CreditCollege, GrantableEntry[]>();

/** The bundled tables' entries for a college, computed once per college. */
export function grantableForCollege(college: CreditCollege): GrantableEntry[] {
  let hit = cache.get(college);
  if (!hit) {
    hit = grantableCourseEntries(college, EXAM_TABLES);
    cache.set(college, hit);
  }
  return hit;
}
