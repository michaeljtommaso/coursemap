import { courseMatchesRule, type RuleContext } from "../distribution/rules";
import type {
  DistCourse,
  DistributionResult,
  MarkValue,
  Question,
  RowResult,
  RowStatus,
  SolveInput,
} from "../distribution/types";
import { applyCourseMarks } from "./applyCourseMarks";
import { isRowMarkType, markKey, questionRef } from "./keys";

/**
 * openQuestions (spec 020 D3 "when a question shows") — the unanswered
 * questions whose "yes" would change a row's status.
 *
 * For each question the selected layers ask, in layer order then question
 * order (then board order for course marks):
 *  - row-scoped marks (usedAs, approvedFor, courseCondition) need a placed
 *    course matching `courses`, one candidate per course; credit marks
 *    (creditsTaken, sequenceDone) need `course` on the board; facts need
 *    nothing;
 *  - a candidate whose answer key already has an answer is skipped;
 *  - a candidate with no target row that is partial or unmet is skipped
 *    without solving (targets: the question's row in its layer — plus the
 *    anyOf parent when the row is an option — or, for credit marks and facts
 *    without a row, every top-level row of every layer);
 *  - otherwise the board is solved once more with that ONE answer set to
 *    "yes" and the target rows' statuses compared. creditsTaken tries its
 *    allowed values from largest to smallest (applied with
 *    applyCourseMarks) and stops at the first that improves a row: a row
 *    with a credit cap can be met by a middle value and not the largest.
 *
 * Status order is unmet < partial < met; unchecked, confirm and waived never
 * count as an improvement in either direction. A candidate is returned only
 * when at least one target row improves; `rowIds` lists those rows.
 *
 * `input` is the SolveInput the caller solved (credit marks already applied
 * to its courses) and `current` that solve's result. Pure apart from `solve`.
 */

export type OpenQuestion = {
  /** Where the answer would be stored (answers.facts for studentFact, else answers.marks). */
  key: string;
  ref: string;
  layerId: string;
  question: Question;
  /** The placed course it is about (course marks), canonical id. */
  courseId?: string;
  /** Rows whose status would improve with "yes" (creditsTaken: with the
   *  largest allowed value that improves any row). */
  rowIds: string[];
  /** The same rows with their layer: a row-less question (credit mark, fact
   *  without a row) can improve rows in any layer, and row ids repeat across layers. */
  rows: { layerId: string; rowId: string }[];
};

const identity = (id: string) => id;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const RANK: Partial<Record<RowStatus, number>> = { unmet: 0, partial: 1, met: 2 };

type Target = { layerId: string; rowId: string };

/** Row results by `${layerId}:${rowId}`, options of an anyOf included, with
 *  each option's parent row id. */
function indexRows(result: DistributionResult): { rows: Map<string, RowResult>; parent: Map<string, string> } {
  const rows = new Map<string, RowResult>();
  const parent = new Map<string, string>();
  for (const layer of result.layers) {
    for (const row of layer.rows) {
      rows.set(`${layer.layerId}:${row.rowId}`, row);
      for (const child of row.children ?? []) {
        rows.set(`${layer.layerId}:${child.rowId}`, child);
        parent.set(`${layer.layerId}:${child.rowId}`, row.rowId);
      }
    }
  }
  return { rows, parent };
}

function canImprove(status: RowStatus | undefined): boolean {
  return status === "unmet" || status === "partial";
}

export function openQuestions(
  input: SolveInput,
  current: DistributionResult,
  solve: (i: SolveInput) => DistributionResult
): OpenQuestion[] {
  const canonical = input.canonical ?? identity;
  const marks = input.answers?.marks ?? {};
  const facts = input.answers?.facts ?? {};
  const ruleCtx: RuleContext = {
    programId: input.ctx.programId,
    ...(input.ctx.additionalProgramIds ? { additionalProgramIds: input.ctx.additionalProgramIds } : {}),
    canonical,
    answers: input.answers,
  };

  // Board order, canonical, first occurrence wins (as the engine dedupes).
  const board: DistCourse[] = [];
  const seen = new Set<string>();
  for (const c of input.courses) {
    const id = canonical(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    board.push({ ...c, id });
  }

  const { rows: before, parent } = indexRows(current);
  const everyRow: Target[] = current.layers.flatMap((l) => l.rows.map((r) => ({ layerId: l.layerId, rowId: r.rowId })));
  const rowTargets = (layerId: string, rowId: string): Target[] => {
    const up = parent.get(`${layerId}:${rowId}`);
    return up ? [{ layerId, rowId }, { layerId, rowId: up }] : [{ layerId, rowId }];
  };

  const out: OpenQuestion[] = [];
  const asked = new Set<string>();

  const probe = (
    layerId: string,
    question: Question,
    key: string,
    ref: string,
    targets: Target[],
    hypotheticals: (() => SolveInput)[],
    courseId?: string
  ) => {
    if (asked.has(key)) return;
    asked.add(key);
    const open = targets.filter((t) => canImprove(before.get(`${t.layerId}:${t.rowId}`)?.status));
    if (open.length === 0) return;
    // The first hypothetical that improves any target row decides the rows.
    let improved: Target[] = [];
    for (const hypothetical of hypotheticals) {
      const after = indexRows(solve(hypothetical())).rows;
      improved = open.filter((t) => {
        const was = RANK[before.get(`${t.layerId}:${t.rowId}`)!.status]!;
        const now = RANK[after.get(`${t.layerId}:${t.rowId}`)?.status as RowStatus];
        return now != null && now > was;
      });
      if (improved.length > 0) break;
    }
    if (improved.length === 0) return;
    out.push({
      key,
      ref,
      layerId,
      question,
      ...(courseId != null ? { courseId } : {}),
      rowIds: [...new Set(improved.map((t) => t.rowId))],
      rows: improved
        .filter((t, i) => improved.findIndex((u) => u.layerId === t.layerId && u.rowId === t.rowId) === i)
        .map((t) => ({ layerId: t.layerId, rowId: t.rowId })),
    });
  };

  const withMark = (key: string, value: MarkValue): SolveInput => ({
    ...input,
    answers: { marks: { ...marks, [key]: value }, facts: { ...facts } },
  });

  for (const layer of input.layers) {
    for (const q of layer.questions ?? []) {
      const ref = questionRef(layer.id, q);
      if (isRowMarkType(q.type)) {
        const rowQ = q as Extract<Question, { row: string; courses: unknown }>;
        for (const course of board) {
          if (!courseMatchesRule(course, rowQ.courses, ruleCtx)) continue;
          const key = markKey(ref, course.id);
          if (has(marks, key)) continue;
          probe(layer.id, q, key, ref, rowTargets(layer.id, rowQ.row), [() => withMark(key, "yes")], course.id);
        }
      } else if (q.type === "creditsTaken" || q.type === "sequenceDone") {
        const course = board.find((c) => c.id === canonical(q.course));
        if (!course || has(marks, ref)) continue;
        // creditsTaken: each distinct allowed value, largest first.
        const values: MarkValue[] =
          q.type === "creditsTaken"
            ? [...new Set(q.values.filter((v) => Number.isFinite(v)))].sort((a, b) => b - a)
            : ["yes"];
        if (values.length === 0) continue;
        const withValue = (value: MarkValue) => (): SolveInput => {
          const next = withMark(ref, value);
          return { ...next, courses: applyCourseMarks(input.courses, [layer], { [ref]: value }, canonical) };
        };
        probe(layer.id, q, ref, ref, everyRow, values.map(withValue), course.id);
      } else if (q.type === "studentFact") {
        if (has(facts, ref)) continue;
        const targets = q.row != null ? rowTargets(layer.id, q.row) : everyRow;
        probe(layer.id, q, ref, ref, targets, [
          () => ({
            ...input,
            answers: { marks: { ...marks }, facts: { ...facts, [ref]: "yes" } },
          }),
        ]);
      }
    }
  }
  return out;
}
