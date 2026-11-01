import type { Question, QuestionType, StudentFactId } from "../distribution/types";

/**
 * questions/keys.ts (spec 020 D5, D7, D9) — how a question is named and where
 * its answer is stored.
 *
 *  - A question REF names the question: `${type}:${layerId}/${row}` for the
 *    row-scoped course marks (usedAs, approvedFor, courseCondition),
 *    `${type}:${course}` for the credit marks (creditsTaken, sequenceDone) and
 *    `studentFact:${fact}:${subject}` for student facts. An `answered` rule
 *    leaf holds a ref.
 *  - An answer KEY is where the answer lives. Row-scoped marks have one key
 *    per matching placed course (`${ref}@${courseId}`); every other question
 *    has one key, the ref itself. studentFact keys live in `answers.facts`
 *    (the profile), all others in `answers.marks` (the plan).
 *
 * Refs carry no program id on purpose: a college layer has the same id under
 * every major of the college, so the same question asked by two programs has
 * the same key. That is how marks carry on a major switch (D5) and how Major
 * Match applies them to other majors (D7).
 */

/** Characters an answer key may use. No "." — keys are Firestore map keys and
 *  a dot would split a field path. */
export const ANSWER_KEY_RE = /^[A-Za-z0-9:_/@-]+$/;
/** Longest key the schemas accept. */
export const ANSWER_KEY_MAX = 120;

/** Course marks answered per placed course, on one row. */
export type RowMarkType = "usedAs" | "approvedFor" | "courseCondition";
/** Course marks that change a course's credits (one key per course). */
export type CreditMarkType = "creditsTaken" | "sequenceDone";

const ROW_MARK_TYPES: ReadonlySet<string> = new Set<RowMarkType>(["usedAs", "approvedFor", "courseCondition"]);
const CREDIT_MARK_TYPES: ReadonlySet<string> = new Set<CreditMarkType>(["creditsTaken", "sequenceDone"]);

export function isRowMarkType(type: string): type is RowMarkType {
  return ROW_MARK_TYPES.has(type);
}

export function isCreditMarkType(type: string): type is CreditMarkType {
  return CREDIT_MARK_TYPES.has(type);
}

/** The question's ref (see the module comment). */
export function questionRef(layerId: string, q: Question): string {
  switch (q.type) {
    case "usedAs":
    case "approvedFor":
    case "courseCondition":
      return `${q.type}:${layerId}/${q.row}`;
    case "creditsTaken":
    case "sequenceDone":
      return `${q.type}:${q.course}`;
    case "studentFact":
      return `studentFact:${q.fact}:${q.subject}`;
  }
}

export type ParsedRef =
  | { type: RowMarkType; layerId: string; row: string }
  | { type: CreditMarkType; course: string }
  | { type: "studentFact"; fact: StudentFactId; subject: string };

const FACTS: ReadonlySet<string> = new Set<StudentFactId>(["acceptedToProgram", "honorsProgram", "departmentExamPassed"]);

/** A ref split into its parts, or null when it is not a well-formed ref.
 *  Answer keys (`ref@course`) are not refs and parse as null. */
export function parseRef(ref: string): ParsedRef | null {
  if (!ANSWER_KEY_RE.test(ref) || ref.includes("@")) return null;
  const colon = ref.indexOf(":");
  if (colon <= 0) return null;
  const type = ref.slice(0, colon);
  const rest = ref.slice(colon + 1);
  if (isRowMarkType(type)) {
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1 || rest.indexOf("/", slash + 1) >= 0 || rest.includes(":")) return null;
    return { type, layerId: rest.slice(0, slash), row: rest.slice(slash + 1) };
  }
  if (isCreditMarkType(type)) {
    if (rest.length === 0 || rest.includes(":") || rest.includes("/")) return null;
    return { type, course: rest };
  }
  if (type === "studentFact") {
    const parts = rest.split(":");
    if (parts.length !== 2 || !FACTS.has(parts[0]) || parts[1].length === 0) return null;
    return { type, fact: parts[0] as StudentFactId, subject: parts[1] };
  }
  return null;
}

/** The question type a ref names, or null. */
export function refType(ref: string): QuestionType | null {
  return parseRef(ref)?.type ?? null;
}

/** True for a studentFact ref: its answer lives in `answers.facts`. */
export function isFactRef(ref: string): boolean {
  return refType(ref) === "studentFact";
}

/**
 * The answer key for a ref and a placed course: `${ref}@${courseId}` for the
 * row-scoped marks (usedAs, approvedFor, courseCondition; `courseId` is the
 * canonical dash-form id), the ref itself for every other question (the
 * course is already part of a credit mark's ref; a fact has no course).
 */
export function markKey(ref: string, courseId: string): string {
  const type = ref.slice(0, ref.indexOf(":"));
  return isRowMarkType(type) ? `${ref}@${courseId}` : ref;
}

/** The answer key for a question in a layer (and the placed course, for a
 *  row-scoped mark). */
export function answerKey(layerId: string, q: Question, courseId?: string): string {
  const ref = questionRef(layerId, q);
  return isRowMarkType(q.type) ? `${ref}@${courseId ?? ""}` : ref;
}

/** A key the schemas accept: allowed characters, at most ANSWER_KEY_MAX long. */
export function isValidAnswerKey(key: string): boolean {
  return key.length > 0 && key.length <= ANSWER_KEY_MAX && ANSWER_KEY_RE.test(key);
}
