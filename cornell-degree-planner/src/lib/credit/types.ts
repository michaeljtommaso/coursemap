/**
 * lib/credit/types.ts (spec 025) — exam credit tables and resolved credit.
 *
 * A student's saved credit (profile.creditProfile, CreditEntry[]) holds either
 *   - an EXAM entry: { exam, score, tableYear } with an empty
 *     satisfiesCourseIds; what it earns is looked up at load time from the
 *     tables for the student's current college (spec 025 D3), or
 *   - a TRANSFER entry: the Cornell course(s) it was credited as, stored
 *     directly (D2), or
 *   - a LEGACY entry from the first Engineering-only table ("ap-calc-bc-5"),
 *     read as an exam entry through LEGACY_EXAM_IDS.
 *
 * resolveCreditProfile() turns those into ResolvedCredit[]: ordinary
 * CreditEntry objects (so every existing reader of satisfiesCourseIds and
 * credits keeps working) plus where each one came from and what limits apply.
 */
import type { CollegeId } from "@/lib/planner/colleges";
import type { CreditEntry } from "@/lib/schemas";

/** Which published table a row comes from. "alevel" = GCE A-Level;
 *  "intl" = the smaller national tables (each named by `group`). */
export type ExamFamily = "ap" | "ib" | "alevel" | "intl";

/** The academic year a table belongs to. Only "2026-27" exists today; an
 *  entry keeps the year it was saved under (D3) so a later table never
 *  silently changes an older student's credit. */
export type TableYear = string;
export const CURRENT_TABLE_YEAR: TableYear = "2026-27";

/** One exam a student can pick. */
export type ExamDef = {
  /** Stable id, kebab-case with the family prefix: "ap-calculus-bc",
   *  "ib-mathematics-analysis-hl", "alevel-mathematics". */
  id: string;
  family: ExamFamily;
  /** Display name without the family: "Calculus BC". */
  name: string;
  /** National table name for "intl" exams ("French Baccalaureate"). */
  group?: string;
  /** Every possible score, LOWEST first, as printed ("1".."5", "1".."7",
   *  "E".."A*"). The editor shows only the scores that earn something in
   *  some college (scoresThatEarn). */
  scale: string[];
  /** Shown first in the editor (the most-taken exams). */
  common?: boolean;
};

/** What one exam at some scores earns in one table. */
export type ExamAward = {
  exam: string;
  /** The scores this award applies to ("4", "5"). */
  scores: string[];
  /** Cornell course ids granted, dash form ("MATH-1910"). Lecture AND lab
   *  when Cornell grants both. May be empty (credits only, or placement). */
  courses: string[];
  /** Cornell's "X or Y": mutually exclusive course sets, ONE of which the
   *  student gets ("CHEM 2070 & 2071, or CHEM 2090 & 2091"; "placement out of
   *  one of: STSCI 2100, 2150, …" is one set per course). When present,
   *  `courses` is their union (prerequisites and display) and the matchers
   *  count only ONE option: position i of the first set, with the other sets'
   *  position-i ids as alternates (ResolvedCredit.courseOptions). */
  courseOptions?: string[][];
  /** Total credits granted. */
  credits: number;
  /** Per-course credits when Cornell states them; else the total is spread
   *  by the resolver (see ResolvedCredit.courseCredits). */
  courseCredits?: Record<string, number>;
  /** Placement out of the course(s), no credit. */
  placementOnly?: boolean;
  /** Student-facing limits printed in the table ("Biological Sciences majors:
   *  elective credit only"). Shown in the editor and the credit section. */
  limits?: string[];
  /** Free text from the table worth showing (one line). */
  note?: string;
};

/** One college's view of the awards. */
export type CollegeExamTable = {
  /** "university" = Cornell's catalog table that CAS / CALS start from. */
  college: "university" | CollegeId;
  year: TableYear;
  source: { url: string; fetched: string };
  awards: ExamAward[];
  /** Override tables only (cas, cals): exam ids whose university awards this
   *  table REPLACES entirely. An exam not listed here keeps the university
   *  awards. */
  replaces?: string[];
  /** Override tables only: limits added to every award this college grants
   *  ("Not counted toward A&S distribution: …"). */
  collegeLimits?: string[];
};

export type ExamTables = {
  year: TableYear;
  exams: ExamDef[];
  university: CollegeExamTable;
  /** CAS and CALS changes to the university table. */
  overrides: Partial<Record<"cas" | "cals", CollegeExamTable>>;
  /** Engineering's own full table: an exam it doesn't list earns nothing. */
  engineering: CollegeExamTable;
};

/** Where a resolved credit came from. */
export type CreditSource =
  | {
      kind: "exam";
      exam: string;
      family: ExamFamily;
      score: string;
      tableYear: TableYear;
      /** "AP Calculus BC (5)". Also written to ResolvedCredit.label. */
      displayName: string;
    }
  | { kind: "transfer" }
  /** A saved entry the tables can't place (unknown exam id, unknown year):
   *  kept as saved, counted as saved. */
  | { kind: "unresolved" };

/** A credit entry ready for every existing reader. `satisfiesCourseIds`,
 *  `credits`, `kind` and `label` are filled from the table for exam entries. */
export type ResolvedCredit = CreditEntry & {
  source: CreditSource;
  /** Per-course credits (sum = credits; with courseOptions, the sum within
   *  each option). buildMatchPool uses it so an exam
   *  granting a lecture and a lab doesn't count its total twice. */
  courseCredits?: Record<string, number>;
  /** Copied from the award: see ExamAward.courseOptions. */
  courseOptions?: string[][];
  /** The award's note (one line), e.g. "the department decides credit". */
  note?: string;
  /** Why it doesn't count somewhere (award limits + college limits). */
  limits: string[];
  /** The exam earns nothing in this college ("No credit in Engineering"). */
  earnsNothing: boolean;
  placementOnly?: boolean;
};

/** The college whose table applies: the program's family when a program is
 *  chosen, else the student's first-run college, else null (university). */
export type CreditCollege = CollegeId | null;

/** The five ids the first Engineering-only table saved, read as exams. */
export const LEGACY_EXAM_IDS: Record<string, { exam: string; score: string }> = {
  "ap-calc-bc-5": { exam: "ap-calculus-bc", score: "5" },
  "ap-chem-5": { exam: "ap-chemistry", score: "5" },
  "ap-physics-c-mech-5": { exam: "ap-physics-c-mechanics", score: "5" },
  "ap-physics-c-em-5": { exam: "ap-physics-c-electricity-and-magnetism", score: "5" },
  "ap-cs-a-5": { exam: "ap-computer-science-a", score: "5" },
};

/** Id of a saved exam entry: one entry per exam (picking a new score
 *  replaces it). */
export function examEntryId(exam: string): string {
  return `exam:${exam}`;
}

/** Hard caps (spec 025 "Settled"); MAX_TRIED_COURSES lives in schemas.ts. */
export const MAX_CREDIT_ENTRIES = 60;
