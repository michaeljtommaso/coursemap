import { ANSWER_KEY_MAX, COURSE_ID_ALLOWANCE, isRowMarkType, parseRef, questionRef } from "../questions/keys";
import { termOrdinal } from "./select";
import { isProgramIdPrefix } from "./programPrefix";
import { EXAM_TABLES } from "../../../data/credit-tables";
import type { ExamTables } from "../../credit/types";
import type {
  AnyOfRow,
  AppliesClause,
  Approver,
  ChildRow,
  CourseCondition,
  CourseRule,
  DistributionRow,
  Layer,
  Question,
  QuestionType,
  Row,
  RowLimit,
  StudentFactId,
} from "./types";

const QUESTION_TYPES: ReadonlySet<string> = new Set<QuestionType>([
  "usedAs",
  "approvedFor",
  "creditsTaken",
  "sequenceDone",
  "courseCondition",
  "studentFact",
]);

/**
 * lintLayer.ts (spec 019 D4/D13) — structural checks on an authored layer that
 * the strict LayerSchema cannot express: id uniqueness, internal consistency of
 * distribution and limit numbers, flag conflicts, layer-kind fields and source
 * hosts. Returns one human-readable line per problem; [] means clean. Pure.
 *
 * Catalog satisfiability (does any course match a rule?) is a separate,
 * offline check: scripts/validate-layers.ts.
 */
export function lintLayer(layer: Layer): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${layer.id}${where ? `:${where}` : ""}: ${msg}`);

  // ── Layer-kind fields ──────────────────────────────────────────────────────
  if (layer.kind === "college") {
    if (layer.programId != null) err("", "a college layer must not have a programId");
    if (layer.concentrationId != null) err("", "a college layer must not have a concentrationId");
  } else {
    if (!layer.programId) err("", `a ${layer.kind} layer needs a programId`);
    if (layer.kind === "concentration" && !layer.concentrationId) err("", "a concentration layer needs a concentrationId");
    if (layer.kind === "major" && layer.concentrationId != null) err("", "a major layer must not have a concentrationId");
    if (layer.kind === "minor" && layer.concentrationId != null) err("", "a minor layer must not have a concentrationId");
  }
  // Spec 047: "other" names a minor offered outside A&S/CALS; every other
  // kind belongs to a college family.
  if (layer.family === "other" && layer.kind !== "minor") err("", 'only a minor layer may use family "other"');
  lintSharing(layer, (msg) => err("", msg));
  lintClauses(layer.appliesTo, (msg) => err("", msg));
  if (layer.concentrations != null) {
    const { min, max } = layer.concentrations;
    if (layer.kind !== "major") err("", "only a major layer may set concentrations");
    if (min > max) err("", `concentrations min ${min} exceeds max ${max}`);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1) {
      err("", "concentrations needs integers with 0 <= min and max >= 1");
    }
  }
  if (layer.courseSharing != null && layer.kind !== "concentration") {
    err("", "only a concentration layer may set courseSharing");
  }

  // ── Row ids ────────────────────────────────────────────────────────────────
  const topIds = new Set<string>();
  for (const row of layer.rows) {
    if (topIds.has(row.id)) err(row.id, "duplicate row id");
    topIds.add(row.id);
  }
  const childIds = new Set<string>();
  for (const row of layer.rows) {
    if (row.kind !== "anyOf") continue;
    for (const child of row.rows) {
      if (topIds.has(child.id)) err(`${row.id}/${child.id}`, "child row id repeats a top-level row id");
      if (childIds.has(child.id)) err(`${row.id}/${child.id}`, "duplicate child row id");
      childIds.add(child.id);
    }
  }

  // ── Rows ───────────────────────────────────────────────────────────────────
  for (const row of layer.rows) {
    lintRow(row, row.id, (where, msg) => err(where, msg));
    if (row.kind === "anyOf") {
      for (const child of row.rows) {
        const where = `${row.id}/${child.id}`;
        if (child.overlay != null || child.exclusive != null) {
          err(where, "child rows inherit overlay/exclusive from their anyOf parent; do not set them");
        }
        // A child may carry its own appliesTo (an option open to some students
        // only): the engine keeps it listed but never counts it for the others.
        // lintRow checks its clauses like any row's.
        if (child.kind === "credits" && row.exclusive) err(where, "a credits row cannot be exclusive (parent is exclusive)");
        lintRow(child, where, (w, msg) => err(w, msg));
      }
    }
  }

  lintQuestions(layer, err);
  return errors;
}

/** Problems worth an author's attention that do not make the layer wrong. */
export function lintLayerWarnings(layer: Layer): string[] {
  const warnings: string[] = [];
  for (const [i, q] of (layer.questions ?? []).entries()) {
    if (q.type === "creditsTaken" && new Set(q.values).size !== q.values.length) {
      warnings.push(`${layer.id}:questions[${i}]: creditsTaken values repeat a value`);
    }
  }
  return warnings;
}

// ─── Questions (spec 020 D9) ─────────────────────────────────────────────────

const MAX_QUESTIONS = 20;
const APPROVERS: ReadonlySet<string> = new Set<Approver>(["advisor", "dus", "director"]);
const CONDITIONS: ReadonlySet<string> = new Set<CourseCondition>(["taughtByDepartmentFaculty", "lifeScienceFocus"]);
const FACTS: ReadonlySet<string> = new Set<StudentFactId>(["acceptedToProgram", "honorsProgram", "departmentExamPassed"]);

/** Every `answered` ref in a rule tree. */
function answeredRefs(rule: CourseRule, out: string[] = []): string[] {
  if ("allOf" in rule) rule.allOf.forEach((r) => answeredRefs(r, out));
  else if ("anyOf" in rule) rule.anyOf.forEach((r) => answeredRefs(r, out));
  else if ("not" in rule) answeredRefs(rule.not, out);
  else if ("answered" in rule) out.push(rule.answered);
  return out;
}

/** True when an `answered` leaf sits anywhere under a `not`. Such a rule
 *  reads the unanswered state as the lenient result and a "yes" can only
 *  remove courses, so the "would yes improve a row" probe never asks it. */
function answeredUnderNot(rule: CourseRule, negated = false): boolean {
  if ("allOf" in rule) return rule.allOf.some((r) => answeredUnderNot(r, negated));
  if ("anyOf" in rule) return rule.anyOf.some((r) => answeredUnderNot(r, negated));
  if ("not" in rule) return answeredUnderNot(rule.not, true);
  return negated && "answered" in rule;
}

/** Every rule a row tests courses with (its own rule, categories, limits and,
 *  for anyOf, its options'). */
function rowRules(row: Row | ChildRow): CourseRule[] {
  switch (row.kind) {
    case "seat":
      return [row.rule];
    case "pool":
    case "credits":
      return [row.rule, ...(row.limits ?? []).map((l) => l.rule)];
    case "distribution":
      return [
        ...(row.rule ? [row.rule] : []),
        ...row.categories.map((c) => c.rule),
        ...(row.limits ?? []).map((l) => l.rule),
      ];
    case "anyOf":
      return row.rows.flatMap(rowRules);
    default:
      return [];
  }
}

/**
 * Questions and `answered` leaves. A question's row must exist in the layer
 * (a top-level row or an anyOf option); a usedAs target must be exclusive
 * (itself or through its anyOf parent) so a yes pins the course to it; every
 * row-scoped mark must be read by an `answered` leaf in its own target row
 * (otherwise it can never change anything); every `answered` leaf must name
 * a question this layer declares, must not name a credit mark (those change
 * credits, not rule matches) and, for a row-scoped mark, must sit in that
 * question's target row; no `answered` leaf may sit under a `not`; and a
 * row-scoped question's ref must leave room for `@${courseId}` within the
 * answer-key length limit.
 */
function lintQuestions(layer: Layer, err: (where: string, msg: string) => void) {
  const questions = layer.questions ?? [];
  if (questions.length > MAX_QUESTIONS) err("", `a layer may ask at most ${MAX_QUESTIONS} questions (has ${questions.length})`);

  // Rows by id (top-level and options), with each option's parent.
  const rows = new Map<string, { row: Row | ChildRow; parent?: AnyOfRow }>();
  for (const row of layer.rows) {
    rows.set(row.id, { row });
    if (row.kind === "anyOf") for (const child of row.rows) if (!rows.has(child.id)) rows.set(child.id, { row: child, parent: row });
  }

  const declared = new Map<string, Question>();
  for (const [i, q] of questions.entries()) {
    const where = `questions[${i}]`;
    const report = (msg: string) => err(where, msg);
    const type = (q as { type: unknown }).type;
    if (!QUESTION_TYPES.has(type as string)) {
      report(`unknown question type ${String(type)}`);
      continue;
    }
    if (typeof q.quote !== "string" || q.quote.trim() === "") report("a question needs Cornell's sentence as its quote");
    if (q.source) lintSource(q.source, report);
    if (q.type === "approvedFor" && !APPROVERS.has(q.approver)) report(`unknown approver ${String(q.approver)}`);
    if (q.type === "courseCondition" && !CONDITIONS.has(q.condition)) report(`unknown condition ${String(q.condition)}`);
    if (q.type === "studentFact" && !FACTS.has(q.fact)) report(`unknown student fact ${String(q.fact)}`);
    if (q.type === "creditsTaken" && q.values.length === 0) report("creditsTaken lists no credit values");
    if ("courses" in q && answeredRefs(q.courses).length > 0) report("a question's course rule cannot use an answered leaf");
    if ("courses" in q) lintExamScores(q.courses, report);

    const ref = questionRef(layer.id, q);
    if (declared.has(ref)) report(`duplicate question ${ref}`);
    declared.set(ref, q);
    if (isRowMarkType(q.type) && ref.length + 1 + COURSE_ID_ALLOWANCE > ANSWER_KEY_MAX) {
      report(
        `question ref ${ref} is ${ref.length} characters; with @ and a course id of up to ${COURSE_ID_ALLOWANCE} its answer keys could exceed the ${ANSWER_KEY_MAX}-character limit, so a "Yes" could not be saved`
      );
    }

    const rowId = "row" in q ? q.row : undefined;
    if (rowId == null) continue;
    const target = rows.get(rowId);
    if (!target) {
      report(`question row ${rowId} is not a row of this layer`);
      continue;
    }
    if (q.type === "usedAs" && !target.row.exclusive && !target.parent?.exclusive) {
      report(`usedAs target row ${rowId} must be exclusive (so the course counts there and nowhere else)`);
    }
    if (isRowMarkType(q.type) && !rowRules(target.row).some((rule) => answeredRefs(rule).includes(ref))) {
      report(`no answered leaf in row ${rowId} reads ${ref}, so the question can change nothing`);
    }
  }

  // Every answered leaf in every row.
  const check = (row: Row | ChildRow, where: string, parentId?: string) => {
    for (const rule of rowRules(row)) {
      if (answeredUnderNot(rule)) {
        err(where, "an answered leaf cannot sit under not (unanswered would read as the lenient result, and a yes could only remove courses, so the question would never be asked)");
      }
      for (const ref of answeredRefs(rule)) {
        const parsed = parseRef(ref);
        if (parsed == null) {
          err(where, `answered leaf ${ref} is not a question ref`);
          continue;
        }
        if (parsed.type === "creditsTaken" || parsed.type === "sequenceDone") {
          err(where, `answered leaf ${ref} names a ${parsed.type} question, which changes credits, not rule matches`);
          continue;
        }
        if (!declared.has(ref)) {
          err(where, `answered leaf ${ref} names no question declared in this layer`);
          continue;
        }
        if (isRowMarkType(parsed.type) && "row" in parsed && parsed.row !== row.id && parsed.row !== parentId) {
          err(where, `answered leaf ${ref} belongs to row ${parsed.row}, not this row`);
        }
      }
    }
  };
  for (const row of layer.rows) {
    if (row.kind === "anyOf") for (const child of row.rows) check(child, `${row.id}/${child.id}`, row.id);
    else check(row, row.id);
  }
}

/**
 * Spec 047 D7/D14 `sharing`: major and minor layers may set every field,
 * concentration layers only `forbiddenWith`, college layers none; each bound
 * a non-negative integer; "forbidden" only in otherMajors and only on a major
 * (on a minor, otherMajors means any major on the plan, and a minor always
 * sits beside one); `with` and `forbiddenWith` are non-empty lists of
 * program-id prefixes.
 */
function lintSharing(layer: Layer, err: (msg: string) => void) {
  const sharing = layer.sharing;
  if (sharing == null) return;
  if (layer.kind === "college") {
    err("a college layer may not set sharing");
    return;
  }
  if (layer.kind === "concentration") {
    const extra = Object.keys(sharing).filter((k) => k !== "forbiddenWith");
    if (extra.length > 0) err(`a concentration layer may set only sharing.forbiddenWith (has ${extra.join(", ")})`);
  }
  const checkPrefixes = (name: string, list: unknown) => {
    if (list === undefined) return;
    if (!Array.isArray(list) || list.length === 0) {
      err(`sharing.${name} must be a non-empty list of program ids`);
      return;
    }
    for (const p of list) if (!isProgramIdPrefix(p)) err(`sharing.${name} entry ${JSON.stringify(p)} is not a program id prefix`);
  };
  const checkLimit = (name: string, limit: unknown) => {
    if (limit === undefined || limit === "none") return;
    if (limit === "forbidden") {
      if (name !== "otherMajors") err(`sharing.${name} cannot be "forbidden" (only otherMajors can)`);
      else if (layer.kind !== "major") err('only a major layer may set sharing.otherMajors to "forbidden"');
      return;
    }
    if (typeof limit !== "object" || limit === null) {
      err(`sharing.${name} must be "none" or a limit`);
      return;
    }
    for (const bound of ["maxCourses", "maxCredits"] as const) {
      const v = (limit as Record<string, unknown>)[bound];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        err(`sharing.${name}.${bound} must be a non-negative integer`);
      }
    }
    checkPrefixes(`${name}.with`, (limit as Record<string, unknown>).with);
  };
  checkLimit("otherMajors", sharing.otherMajors);
  checkLimit("minors", sharing.minors);
  checkPrefixes("forbiddenWith", sharing.forbiddenWith);
}

function lintClauses(clauses: AppliesClause[] | undefined, report: (msg: string) => void) {
  for (const [i, c] of (clauses ?? []).entries()) {
    if (c.enteredFrom != null && c.enteredBefore != null) {
      const from = termOrdinal(c.enteredFrom);
      const before = termOrdinal(c.enteredBefore);
      if (from != null && before != null && from >= before) {
        report(`appliesTo[${i}] has an empty entry-term range (${c.enteredFrom} to before ${c.enteredBefore})`);
      }
    }
  }
}

function lintRow(row: Row | ChildRow, where: string, report: (where: string, msg: string) => void) {
  const err = (msg: string) => report(where, msg);

  if (row.overlay && row.exclusive) err("a row cannot be both overlay and exclusive");
  if (row.kind === "credits" && row.exclusive) err("a credits row cannot be exclusive");
  lintClauses(row.appliesTo, err);
  lintSource(row.source, err);
  // anyOf options are linted on their own (lintLayer calls lintRow per child).
  if (row.kind !== "anyOf") for (const rule of rowRules(row)) lintExamScores(rule, err);
  if (row.kind === "pool" || row.kind === "distribution") lintSubjectGroups(row.subjectGroups, row.maxPerSubject, err);

  switch (row.kind) {
    case "pool":
      if (row.requiredCourses === 0 && row.requiredCredits === 0) err("pool requires neither courses nor credits");
      lintLimits(row.limits, err);
      break;
    case "credits":
      if (row.requiredCredits <= 0) err("credits row requires no credits");
      lintLimits(row.limits, err);
      break;
    case "distribution":
      lintDistribution(row, err);
      break;
    default:
      break;
  }
}

/**
 * Spec 028 `examScore` leaves: every exam must be one the credit tables list,
 * have a listed score on its scale, and every score must fit some listed
 * exam, else part of the leaf can never match (a typo would silently refuse
 * the student's credit). Repeats are
 * reported too. Checked against `tables` (the bundled EXAM_TABLES by default);
 * with no tables loaded only the repeats are checked.
 */
export function lintExamScores(rule: CourseRule, err: (msg: string) => void, tables: ExamTables | null = EXAM_TABLES) {
  if ("allOf" in rule) return rule.allOf.forEach((r) => lintExamScores(r, err, tables));
  if ("anyOf" in rule) return rule.anyOf.forEach((r) => lintExamScores(r, err, tables));
  if ("not" in rule) return lintExamScores(rule.not, err, tables);
  if (!("examScore" in rule)) return;
  const { exam, scores } = rule.examScore;
  if (new Set(exam).size !== exam.length) err("examScore lists an exam twice");
  if (new Set(scores).size !== scores.length) err("examScore lists a score twice");
  if (tables == null) return;
  const scales: string[][] = [];
  for (const id of exam) {
    const def = tables.exams.find((e) => e.id === id);
    if (def == null) {
      err(`examScore names exam ${id}, which the credit tables do not list`);
      continue;
    }
    scales.push(def.scale);
    // One leaf may mix families (AP 5 or IB 7): each exam needs at least one
    // listed score on its own scale, and each score must fit some exam.
    if (!scores.some((s) => def.scale.includes(s))) {
      err(`examScore lists no score on the ${id} scale (${def.scale.join(", ")})`);
    }
  }
  if (scales.length > 0) {
    const off = scores.filter((s) => !scales.some((scale) => scale.includes(s)));
    if (off.length > 0) err(`examScore score ${off.join(", ")} is on no listed exam's scale`);
  }
}

/** Subject groups model departments for maxPerSubject: a subject belongs to
 *  at most one department, and groups mean nothing without the cap. */
function lintSubjectGroups(groups: string[][] | undefined, maxPerSubject: number | undefined, err: (msg: string) => void) {
  if (groups == null) return;
  if (maxPerSubject == null) err("subjectGroups without maxPerSubject has no effect");
  const seen = new Set<string>();
  for (const g of groups) {
    for (const subject of g) {
      if (seen.has(subject)) err(`subject ${subject} is in more than one subject group`);
      seen.add(subject);
    }
  }
}

function lintSource(source: { url: string }, err: (msg: string) => void) {
  let host: string;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") err(`source url must be https: ${source.url}`);
    host = url.hostname;
  } catch {
    err(`source url does not parse: ${source.url}`);
    return;
  }
  if (host !== "cornell.edu" && !host.endsWith(".cornell.edu")) err(`source url is not on a cornell.edu host: ${source.url}`);
}

function lintLimits(limits: RowLimit[] | undefined, err: (msg: string) => void) {
  for (const [i, l] of (limits ?? []).entries()) {
    const name = `limit[${i}]${l.label ? ` (${l.label})` : ""}`;
    if (l.minCourses == null && l.maxCourses == null && l.minCredits == null && l.maxCredits == null) {
      err(`${name} sets no bound`);
    }
    if (l.minCourses != null && l.maxCourses != null && l.minCourses > l.maxCourses) err(`${name}: minCourses > maxCourses`);
    if (l.minCredits != null && l.maxCredits != null && l.minCredits > l.maxCredits) err(`${name}: minCredits > maxCredits`);
    if (l.maxCourses === 0 && ((l.minCredits ?? 0) > 0 || (l.minCourses ?? 0) > 0)) {
      err(`${name}: needs courses or credits but allows no course`);
    }
  }
}

function lintDistribution(row: DistributionRow, err: (msg: string) => void) {
  const ids = new Set<string>();
  for (const c of row.categories) {
    if (ids.has(c.id)) err(`duplicate category id ${c.id}`);
    ids.add(c.id);
  }
  const per = row.perCategory ?? {};
  for (const [key, bound] of Object.entries(per)) {
    if (!ids.has(key)) err(`perCategory key ${key} is not a category id`);
    if (bound.min != null && bound.max != null && bound.min > bound.max) err(`perCategory ${key}: min > max`);
    if ((bound.minCredits ?? 0) > 0 && bound.max === 0) err(`perCategory ${key}: needs credits but allows no course`);
  }
  lintLimits(row.limits, err);
  if (row.requiredCourses === 0 && row.minDistinctCategories === 0 && !((row.requiredCredits ?? 0) > 0)) {
    err("distribution requires neither courses nor categories");
  }
  if (row.minDistinctCategories > row.categories.length) {
    err(`minDistinctCategories ${row.minDistinctCategories} exceeds the ${row.categories.length} categories`);
  }
  // Categories that can hold at least one course.
  const usable = row.categories.filter((c) => per[c.id]?.max !== 0).length;
  if (row.minDistinctCategories > usable) {
    err(`minDistinctCategories ${row.minDistinctCategories} exceeds the ${usable} categories that allow a course`);
  }
  // Every counted course sits in at least one category, so when every category
  // is capped, the caps bound how many distinct courses can count.
  const allCapped = row.categories.every((c) => per[c.id]?.max != null);
  if (allCapped) {
    const capacity = row.categories.reduce((n, c) => n + (per[c.id]?.max ?? 0), 0);
    if (row.requiredCourses > capacity) {
      err(`requiredCourses ${row.requiredCourses} exceeds the ${capacity} courses the category maxima allow`);
    }
  }
  for (const c of row.categories) {
    const min = per[c.id]?.min ?? 0;
    if (min > 0 && row.maxPerSubject === 0) err(`category ${c.id} needs courses but maxPerSubject is 0`);
  }
  const maxCats = row.maxCategoriesPerCourse ?? 1;
  if (maxCats > row.categories.length) err(`maxCategoriesPerCourse ${maxCats} exceeds the ${row.categories.length} categories`);
  if (row.maxDoubleCountCourses != null && maxCats <= 1) {
    err("maxDoubleCountCourses is set but maxCategoriesPerCourse allows no double counting");
  }
}
