import type { MatchCourse } from "../majorMatch";

/**
 * distribution/types.ts (spec 019 D8 + D8 amendment) — the CONTRACT for the
 * Distribution engine (CAS and CALS). Three modules build against it and
 * nothing else:
 *
 *   engine.ts   solveLayers()      layers + courses → DistributionResult
 *   verify.ts   verifyAssignment() re-proves every claim in a result
 *   select.ts   selectLayers()     picks the college/major/concentration layers
 *
 * Requirements come from stacked LAYERS: one college layer, one major layer,
 * optionally the concentration layers the student chose. A layer is a list of ROWS; a row tests
 * courses with a composable CourseRule (rules.ts is the one evaluator).
 *
 * Counting semantics (the rules every module must agree on):
 *  - A course counts at most once per LAYER across consuming rows. Layers are
 *    independent: the same course may count once in the college layer and once
 *    in the major layer (spec D8 "layer sharing").
 *  - EXCEPT counting groups: a concentration layer with `courseSharing:
 *    "separate"` is joined to its major layer (and to every other "separate"
 *    concentration of that major) as ONE group, and a course counts at most once
 *    across the consuming rows of a group. Rows keep their own layer in results.
 *  - `overlay: true` rows consume nothing: they see every course (after the
 *    exclusive pass) and never block another row. `credits` rows ALWAYS behave
 *    as overlay (a credit total never uses a course up).
 *  - `exclusive: true` rows are solved first, across all layers in layer order;
 *    a course an exclusive row counts is removed from every other row in every
 *    layer (CAS: an FWS counts for nothing else) — EXCEPT `credits` rows,
 *    which see every course: an FWS's credits still count toward the
 *    120-credit degree total.
 *  - Inside a `distribution` row a course may fill up to
 *    `maxCategoriesPerCourse` categories, and at most `maxDoubleCountCourses`
 *    courses may fill more than one.
 *  - Waived rows are removed before solving (status "waived").
 *  - `confirm` rows are never checkable and stay out of the percentage.
 */

// ─── Courses ────────────────────────────────────────────────────────────────

export type CreditKind = "ap" | "ib" | "alevel" | "intl" | "transfer" | "placement";

/** A student's course as the Distribution engine sees it. Board order matters
 *  (it breaks ties). `isCredit` courses are AP/IB/transfer/placement credit;
 *  `creditKind` says which (absent on a credit course = unknown kind, which a
 *  `creditKind` rule leaf treats as matching every kind — fail closed). */
export type DistCourse = MatchCourse & {
  /** Upper end of a variable-credit course; absent or equal to `credits` → fixed. */
  creditsMax?: number;
  creditKind?: CreditKind;
  /** Spec 028: on an exam credit course, the exam id ("ap-calculus-bc") and
   *  the score as printed ("5"), for the `examScore` rule leaf. */
  creditExam?: string;
  creditScore?: string;
  /** Subjects this course is cross-listed under (CALS: a course cross-listed
   *  with a CALS prefix earns CALS credit). Phase 3 fills it; absent → none. */
  crossListedSubjects?: string[];
};

// ─── Course rules ───────────────────────────────────────────────────────────

/** One test. Each leaf is an object with exactly one key. */
export type RuleLeaf =
  /** The course carries any of these roster attribute values ("ALC-AS"). */
  | { tag: string[] }
  /** The course's subject is in the list; with `crossListed: true` a
   *  cross-listed subject also counts. */
  | { subject: string[]; crossListed?: boolean }
  /** The numeric part of the course number is within [min, max], inclusive. */
  | { number: { min?: number; max?: number } }
  /** The course's canonical id is one of these (dash form, "MATH-1910"). */
  | { course: string[] }
  /** satisfies.ts pattern ("CS 4xxx"). */
  | { pattern: string }
  | { titleStartsWith: string }
  /** course.credits >= n */
  | { minCredits: number }
  /** creditsMax > credits */
  | { variableCredit: true }
  /** An AP/IB/transfer/placement credit course of one of these kinds. */
  | { creditKind: CreditKind[] }
  /** Spec 028: an exam credit course from one of these exams at one of these
   *  scores ("AP Calculus at 5"). A credit course with no exam or score, and
   *  every non-credit course, fails (fail closed). */
  | { examScore: { exam: string[]; scores: string[] } }
  /** The student's program (context, not the course) is one of these ids. */
  | { program: string[] }
  /** The student answered "yes" to a question declared in the same layer
   *  (spec 020 D9). The value is a question REF (questions/keys.ts):
   *  a studentFact ref is true when the fact is "yes"; a usedAs / approvedFor /
   *  courseCondition ref is true for a course whose mark is "yes". Absent
   *  answers read as "no" (the strict reading). */
  | { answered: string };

export type CourseRule =
  | RuleLeaf
  | { allOf: CourseRule[] }
  | { anyOf: CourseRule[] }
  | { not: CourseRule };

// ─── Student context and applicability ──────────────────────────────────────

export type TransferKind = "none" | "external" | "internal";
export type ClassStanding = "first-year" | "sophomore" | "junior" | "senior";

/** What the engine and selector know about the student. Terms are roster
 *  slugs ("FA25", "SP26"); compare them with termOrdinal() (select.ts). */
export type StudentContext = {
  programId: string;
  /** Legacy single choice; `concentrationIds` wins when present. */
  concentrationId?: string | null;
  /** The concentrations the student chose (ids within the program), in order. */
  concentrationIds?: string[];
  entryTerm?: string | null;
  transfer?: TransferKind | null;
  /** Class standing the student transferred in at (transfers only). */
  transferStanding?: ClassStanding | null;
};

/** The department a subject counts under for `maxPerSubject`: its group's
 *  first subject when listed in `subjectGroups`, else the subject itself. */
export function subjectKey(subject: string, subjectGroups: string[][] | undefined): string {
  const group = subjectGroups?.find((g) => g.includes(subject));
  return group ? group[0] : subject;
}

/** One AND-clause; a list of clauses is an OR. Every present field must hold.
 *  `enteredFrom` is inclusive, `enteredBefore` exclusive. A clause with an
 *  entry-term field never matches a student whose entryTerm is unknown.
 *  Terms parse STRICTLY (/^(FA|SP|SU|WI)\d{2}$/, no trimming or case folding);
 *  a malformed term is unknown. An empty clause list matches no one (the
 *  schema forbids it). */
export type AppliesClause = {
  enteredFrom?: string;
  enteredBefore?: string;
  transfer?: TransferKind[];
  transferStanding?: ClassStanding[];
};

// ─── Rows ───────────────────────────────────────────────────────────────────

export type RowSource = { url: string; anchor: string };

type RowBase = {
  /** Stable within the layer; saved waivers reference `${layerId}:${id}`. */
  id: string;
  label: string;
  /** Panel heading ("Distribution", "Language", "Core"). */
  group: string;
  source: RowSource;
  note?: string;
  overlay?: boolean;
  exclusive?: boolean;
  /** Row applies only to students matching one of these clauses; absent → all. */
  appliesTo?: AppliesClause[];
};

/** A sub-limit inside a pool or credits row, over the courses that row counts
 *  ("at least 6 of the 9 credits WRT-AG", "at most 1 ORL-AG course"). */
export type RowLimit = {
  rule: CourseRule;
  label?: string;
  minCourses?: number;
  maxCourses?: number;
  minCredits?: number;
  maxCredits?: number;
};

/** One course matching `rule`. `credits` is the row's nominal weight (default 3). */
export type SeatRow = RowBase & { kind: "seat"; rule: CourseRule; credits?: number };

/** Courses matching `rule`: met at >= requiredCourses AND >= requiredCredits,
 *  with every limit satisfied by the counted set.
 *
 *  `maxPerSubject` caps courses per DEPARTMENT. A department is one subject,
 *  unless `subjectGroups` lists it with others (Romance Studies = FREN, ITAL,
 *  SPAN, …): subjects in one group share a single cap. See subjectKey(). */
export type PoolRow = RowBase & {
  kind: "pool";
  rule: CourseRule;
  requiredCourses: number;
  requiredCredits: number;
  maxPerSubject?: number;
  subjectGroups?: string[][];
  limits?: RowLimit[];
};

export type DistributionCategory = { id: string; label: string; rule: CourseRule };

/** Courses spread over categories. Met when some assignment of eligible
 *  courses to categories has: >= requiredCourses distinct courses,
 *  >= minDistinctCategories categories with a course, every perCategory
 *  min/max honoured, no course in more than maxCategoriesPerCourse categories,
 *  at most maxDoubleCountCourses courses in more than one, and at most
 *  maxPerSubject courses per subject. A course qualifies for a category when it
 *  matches the row `rule` (eligibility, if present) AND the category rule. */
export type DistributionRow = RowBase & {
  kind: "distribution";
  rule?: CourseRule;
  categories: DistributionCategory[];
  requiredCourses: number;
  minDistinctCategories: number;
  perCategory?: Record<string, { min?: number; max?: number }>;
  /** Default 1. */
  maxCategoriesPerCourse?: number;
  /** Default: unlimited (only meaningful when maxCategoriesPerCourse > 1). */
  maxDoubleCountCourses?: number;
  maxPerSubject?: number;
  subjectGroups?: string[][];
};

/** A credit total over courses matching `rule` (always overlay). With
 *  `sameSubject: true` the total is the best single subject's credits
 *  ("11 credits in one language"). */
export type CreditsRow = RowBase & {
  kind: "credits";
  rule: CourseRule;
  requiredCredits: number;
  sameSubject?: boolean;
  limits?: RowLimit[];
};

/** Met when any one child row is met. Children are seat/pool/distribution/
 *  credits rows (no nested anyOf, no confirm); they inherit the parent's
 *  overlay/exclusive flags and are not waivable on their own. */
export type AnyOfRow = RowBase & {
  kind: "anyOf";
  rows: (SeatRow | PoolRow | DistributionRow | CreditsRow)[];
};

/** Not checkable from board data (letter-graded credits, residency, PE/swim). */
export type ConfirmRow = RowBase & { kind: "confirm" };

export type Row = SeatRow | PoolRow | DistributionRow | CreditsRow | AnyOfRow | ConfirmRow;
export type ChildRow = AnyOfRow["rows"][number];

// ─── Layers ─────────────────────────────────────────────────────────────────

export type LayerFamily = "cas" | "cals";
export type LayerKind = "college" | "major" | "concentration";

export type Layer = {
  /** "cas-college", "cals-college-2025", "<programId>", "<programId>--<concentration>". */
  id: string;
  kind: LayerKind;
  family: LayerFamily;
  name: string;
  /** "2026-27" — named on the panel (spec D10). */
  catalogYear: string;
  /** Major and concentration layers: the program they belong to. */
  programId?: string;
  /** Concentration layers: their id within the program. */
  concentrationId?: string;
  /** MAJOR layers only: how many of the program's concentrations the student
   *  must choose (integers, 0 <= min <= max, max >= 1). Absent means
   *  { min: 0, max: 1 }: optional, at most one. */
  concentrations?: { min: number; max: number };
  /** CONCENTRATION layers only: may a course count toward both the major and
   *  this concentration? "shared" (the default when absent): layers are
   *  independent, as for college + major. "separate": the major layer and this
   *  concentration form ONE counting group: a course counts in at most one
   *  consuming row across both (the catalog's "no course may satisfy more than
   *  one requirement"). Several "separate" concentrations all join the major's
   *  group. Overlay rows (and credits rows, always overlay) still see every
   *  course; exclusive rows still run first across all layers. */
  courseSharing?: "shared" | "separate";
  /** College layers: which students this version is for (spec D10 amended).
   *  Absent → every student of the college. */
  appliesTo?: AppliesClause[];
  rows: Row[];
  /** Questions this layer asks the student (spec 020 D9), at most 20. */
  questions?: Question[];
};

// ─── Questions (spec 020 D9) ─────────────────────────────────────────────────

/** The closed set of question types. The app owns every question's wording
 *  (questions/registry.ts); a layer only names a type and its parameters. */
export type QuestionType = "usedAs" | "approvedFor" | "creditsTaken" | "sequenceDone" | "courseCondition" | "studentFact";
export type Approver = "advisor" | "dus" | "director";
export type CourseCondition = "taughtByDepartmentFaculty" | "lifeScienceFocus";
export type StudentFactId = "acceptedToProgram" | "honorsProgram" | "departmentExamPassed";

/** Every question cites Cornell: `quote` is the catalog sentence, verbatim. */
type QuestionBase = { source: RowSource; quote: string };

/**
 * A question a layer may ask the student. Kinds (spec 020 D1):
 *  - course MARKS (usedAs, approvedFor, courseCondition, creditsTaken,
 *    sequenceDone) are about one placed course and live on the plan;
 *  - student FACTS (studentFact) are about the student and live on the profile.
 *
 * Engine semantics (D9):
 *  - usedAs: yes lets the course match the target row through an `answered`
 *    leaf; the target row is exclusive (lint), so the course then counts
 *    there and nowhere else.
 *  - approvedFor / courseCondition: yes makes an `answered` leaf true for that
 *    course in the target row.
 *  - creditsTaken: the stated value becomes the course's credits for every row
 *    (questions/applyCourseMarks.ts).
 *  - sequenceDone: yes counts the anchor course at `credits`.
 *  - studentFact: yes makes an `answered` leaf true for every course.
 */
export type Question =
  | (QuestionBase & { type: "usedAs"; row: string; courses: CourseRule })
  | (QuestionBase & { type: "approvedFor"; row: string; courses: CourseRule; approver: Approver })
  /** Applies to every row. `course` is a canonical dash-form id. */
  | (QuestionBase & { type: "creditsTaken"; course: string; values: number[] })
  | (QuestionBase & { type: "sequenceDone"; course: string; sequence: string[]; credits: number })
  | (QuestionBase & { type: "courseCondition"; row: string; courses: CourseRule; condition: CourseCondition })
  /** `subject`: a program id or a department ("ECON"). */
  | (QuestionBase & { type: "studentFact"; fact: StudentFactId; subject: string; row?: string });

/** A course mark's value: "yes" / "no", or a credit count (creditsTaken only). */
export type MarkValue = "yes" | "no" | number;
export type FactValue = "yes" | "no";

/** The student's answers, keyed by answer key (questions/keys.ts): course
 *  marks from the plan, student facts from the profile. */
export type Answers = { marks: Record<string, MarkValue>; facts: Record<string, FactValue> };

// ─── Results ────────────────────────────────────────────────────────────────

export type RowStatus =
  | "met"
  | "partial"
  | "unmet"
  /** The engine could not prove a status (node cap, error, checker
   *  rejection it could not repair) — "can't check this automatically". */
  | "unchecked"
  | "confirm"
  | "waived";

/** A course a row counts. `categories` only on distribution rows. */
export type CountedCourse = { courseId: string; credits: number; categories?: string[] };

export type RowProgress = {
  coursesHave?: number;
  coursesNeed?: number;
  creditsHave?: number;
  creditsNeed?: number;
  /** Distribution rows: categories with at least one course. */
  categoriesHave?: string[];
  categoriesNeed?: number;
  /** Distribution rows: category ids still short of their min (or needed
   *  toward minDistinctCategories), in authored order. */
  missingCategories?: string[];
};

export type RowResult = {
  layerId: string;
  rowId: string;
  kind: Row["kind"];
  label: string;
  group: string;
  status: RowStatus;
  /** The courses the row counts, canonical ids. Empty for confirm/waived. */
  courses: CountedCourse[];
  progress: RowProgress;
  /** 0–1 share of the row done (1 when met); 0 for confirm/waived/unchecked. */
  fraction: number;
  /** anyOf rows: one result per child, in authored order. */
  children?: RowResult[];
  reason?: "node-cap" | "engine-error" | "verify-rejected";
};

export type LayerResult = { layerId: string; kind: LayerKind; name: string; rows: RowResult[] };

export type DistributionResult = {
  layers: LayerResult[];
  /** canonical course id → every row that counts it (one per layer at most,
   *  plus overlay rows). */
  attribution: Record<string, { layerId: string; rowId: string }[]>;
  /** Canonical ids of courses no row counts. */
  uncounted: string[];
  /** 0–100, rounded: mean `fraction` over rows that are not confirm/waived. */
  pct: number;
  /** Search nodes used across layers, and whether any layer hit the cap. */
  nodes: number;
  capped: boolean;
  /** One line per checker rejection (also console.error'd by the engine). */
  verifyLog: string[];
};

export type SolveInput = {
  /** Already selected, in order: college, major, concentration (selectLayers). */
  layers: Layer[];
  /** Board order; ids need not be canonical (the engine canonicalizes and
   *  dedupes like majorMatch.assign: first wins, credits keep the max). */
  courses: DistCourse[];
  ctx: StudentContext;
  /** `${layerId}:${rowId}` */
  waived?: string[];
  canonical?: (id: string) => string;
  /** Search budget per layer (per counting group when concentrations are "separate"); default 200,000 (spec D8). */
  nodeCap?: number;
  /** The student's answers (spec 020 D4). Absent → no answers: every
   *  `answered` leaf is false, exactly today's strict result. Credit marks
   *  (creditsTaken / sequenceDone) are not read here: callers apply them to
   *  `courses` first with applyCourseMarks. */
  answers?: Answers;
};

export type VerifyRejection = { layerId: string; rowId: string; reason: string };
export type VerifyReport = { ok: boolean; rejections: VerifyRejection[] };
