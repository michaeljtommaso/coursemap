import type { Approver, CourseCondition, MarkValue, Question, StudentFactId } from "../distribution/types";

/**
 * questions/registry.ts (spec 020 D9) — the app's wording for every question
 * type. Layers never carry question text: they name a type and its
 * parameters, and every prompt, detail line and "because you said" line comes
 * from here, so similar questions read the same across every program.
 *
 * `labels` are display strings the caller already has: the course code
 * ("ENGL 2880"), the target row's label and the program's name. Missing labels
 * fall back to plain words built from the question itself.
 */

export type QuestionLabels = { course?: string; row?: string; program?: string };

export const APPROVER_TEXT: Record<Approver, string> = {
  advisor: "your advisor",
  dus: "the Director of Undergraduate Studies",
  director: "the program director",
};

/** "BIOMI-4850" → "BIOMI 4850". */
export function courseCode(id: string): string {
  return id.replace(/-/g, " ");
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function credits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

type Words = { course: string; row: string; program: string };

function words(q: Question, labels: QuestionLabels): Words {
  const fromQuestion = "course" in q ? courseCode(q.course) : undefined;
  return {
    course: labels.course ?? fromQuestion ?? "this course",
    row: labels.row ?? "this requirement",
    program: labels.program ?? ("subject" in q ? q.subject : "the program"),
  };
}

const CONDITION: Record<CourseCondition, { prompt: (w: Words) => string; detail: string; yes: (w: Words) => string }> = {
  taughtByDepartmentFaculty: {
    prompt: (w) => `Was ${w.course} taught by a faculty member of the department?`,
    detail: "A cross-listed course counts here only when the department's own faculty teach it.",
    yes: (w) => `you said ${w.course} was taught by the department's faculty`,
  },
  lifeScienceFocus: {
    prompt: (w) => `Did ${w.course} have a significant life-science focus?`,
    detail: "This course counts here only when its focus is mainly on the life sciences.",
    yes: (w) => `you said ${w.course} had a significant life-science focus`,
  },
};

const FACT: Record<StudentFactId, { prompt: (w: Words) => string; detail: string; yes: (w: Words) => string }> = {
  acceptedToProgram: {
    prompt: (w) => `Have you been officially accepted to ${w.program}?`,
    detail: "Some requirements change once you're accepted.",
    yes: (w) => `you said you've been accepted to ${w.program}`,
  },
  honorsProgram: {
    prompt: (w) => `Are you in the ${w.program} honors program?`,
    detail: "Honors students have some different requirements.",
    yes: (w) => `you said you're in the ${w.program} honors program`,
  },
  departmentExamPassed: {
    prompt: (w) => `Did you pass the ${w.program} department's placement exam?`,
    detail: "Passing the exam can count in place of a course.",
    yes: (w) => `you said you passed the ${w.program} department's placement exam`,
  },
};

/** The question as the student sees it: a one-line prompt and a short plain
 *  explanation of what a "yes" does. */
export function questionText(q: Question, labels: QuestionLabels): { prompt: string; detail: string } {
  const w = words(q, labels);
  switch (q.type) {
    case "usedAs":
      return {
        prompt: `Are you using ${w.course} as ${w.row}?`,
        detail: "If you are, it counts here and not toward anything else.",
      };
    case "approvedFor":
      return {
        prompt: `Did ${APPROVER_TEXT[q.approver]} approve ${w.course} for ${w.row}?`,
        detail: `It counts here only with approval from ${APPROVER_TEXT[q.approver]}.`,
      };
    case "creditsTaken":
      return {
        prompt: `How many credits did you take ${w.course} for?`,
        detail: `It can be taken for ${list(q.values.map(String))} credits, and some requirements depend on which.`,
      };
    case "sequenceDone":
      return {
        prompt: `Did you complete ${list(q.sequence.map(courseCode))}?`,
        detail: `If you did, ${w.course} counts as ${credits(q.credits)}.`,
      };
    case "courseCondition":
      return { prompt: CONDITION[q.condition].prompt(w), detail: CONDITION[q.condition].detail };
    case "studentFact":
      return { prompt: FACT[q.fact].prompt(w), detail: FACT[q.fact].detail };
  }
}

/** The line an answered question shows: "Counted because you said …" for a
 *  yes (or a credit count), "You said no" for a no. */
export function answeredLine(q: Question, value: MarkValue, labels: QuestionLabels): string {
  const w = words(q, labels);
  if (q.type === "creditsTaken") {
    return typeof value === "number"
      ? `Counted at ${credits(value)} because you said you took ${w.course} for ${credits(value)}`
      : "You said no";
  }
  if (value !== "yes") return "You said no";
  switch (q.type) {
    case "usedAs":
      return `Counted because you said you're using ${w.course} as ${w.row}`;
    case "approvedFor":
      return `Counted because you said ${APPROVER_TEXT[q.approver]} approved ${w.course} for ${w.row}`;
    case "sequenceDone":
      return `Counted as ${credits(q.credits)} because you said you completed ${list(q.sequence.map(courseCode))}`;
    case "courseCondition":
      return `Counted because ${CONDITION[q.condition].yes(w)}`;
    case "studentFact":
      return `Counted because ${FACT[q.fact].yes(w)}`;
  }
}
