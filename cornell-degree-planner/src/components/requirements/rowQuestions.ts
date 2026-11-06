import type {
  AnswerListEntry,
  RowAnswerInfo,
  RowQuestionInfo,
} from "@/hooks/useRequirementProgress";
import type { MarkValue } from "@/lib/planner/distribution/types";
import type { QuestionAsked } from "./RowQuestion";

/**
 * rowQuestions (spec 020 D3/D4) — a requirement row's question line and which
 * question its open form asks. Shared by the rail's RequirementRow and the
 * Requirements page's PageRow (spec 028). Pure.
 */

/** "1 question · ENGL 2880 could count here"; a fact question names no course.
 *  Shared with the Requirements page's rows. */
export function questionLine(questions: RowQuestionInfo[]): string {
  const n = questions.length;
  const count = `${n} ${n === 1 ? "question" : "questions"}`;
  const codes = [...new Set(questions.flatMap((q) => (q.courseCode ? [q.courseCode] : [])))];
  if (codes.length === 0) return `${count} · your answer could change this`;
  return `${count} · ${codes.join(", ")} could count here`;
}

/** The question the open form asks: one of the row's open questions, or an
 *  answered one being changed (re-asked with its stored value and "Clear my
 *  answer"). Shared with the Requirements page's rows. */
export function openForm(
  formKey: string | null,
  open: RowQuestionInfo | null,
  canChange: boolean,
  answered: RowAnswerInfo[],
  answerEntry: ((key: string) => AnswerListEntry | undefined) | undefined
): { asked: QuestionAsked; current?: MarkValue } | null {
  if (open) return { asked: open };
  if (!formKey || !canChange) return null;
  const entry = answerEntry?.(formKey);
  if (entry) {
    return {
      asked: { key: entry.key, scope: entry.scope, prompt: entry.prompt, detail: "", input: entry.input },
      current: entry.value,
    };
  }
  // No list entry to re-ask from: offer the answer back as yes / no.
  const line = answered.find((a) => a.key === formKey);
  if (!line) return null;
  return {
    asked: { key: line.key, scope: line.scope, prompt: line.line, detail: "", input: { kind: "yesno" } },
    current: "yes",
  };
}
