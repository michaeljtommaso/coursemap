import { describe, it, expect } from "vitest";
import { answeredLine, questionText } from "./registry";
import type { Question } from "../distribution/types";

const base = { source: { url: "https://catalog.cornell.edu/", anchor: "test" }, quote: "Cornell's own sentence, never shown as the prompt." };

describe("questionText", () => {
  it("words a usedAs question from the labels, not the quote", () => {
    const q: Question = { ...base, type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] } };
    const t = questionText(q, { course: "ENGL 2880", row: "a writing seminar" });
    expect(t.prompt).toBe("Are you using ENGL 2880 as a writing seminar?");
    expect(t.detail).not.toContain(base.quote);
    expect(t.detail.length).toBeGreaterThan(0);
  });

  it("names each approver plainly", () => {
    const q = (approver: "advisor" | "dus" | "director"): Question => ({
      ...base,
      type: "approvedFor",
      row: "mcb",
      courses: { subject: ["BIOMG"] },
      approver,
    });
    const labels = { course: "BIOMG 6330", row: "Molecular and Cell Biology" };
    expect(questionText(q("advisor"), labels).prompt).toBe("Did your advisor approve BIOMG 6330 for Molecular and Cell Biology?");
    expect(questionText(q("dus"), labels).prompt).toContain("the Director of Undergraduate Studies");
    expect(questionText(q("director"), labels).prompt).toContain("the program director");
  });

  it("asks credits, sequences, conditions and facts in plain words", () => {
    const credits: Question = { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] };
    expect(questionText(credits, {}).prompt).toBe("How many credits did you take BIOMI 4850 for?");
    const seq: Question = { ...base, type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4300", "NTRES-4301", "NTRES-4302"], credits: 4 };
    expect(questionText(seq, {}).prompt).toBe("Did you complete NTRES 4300, NTRES 4301 and NTRES 4302?");
    const cond: Question = { ...base, type: "courseCondition", row: "r", courses: { subject: ["PMA"] }, condition: "lifeScienceFocus" };
    expect(questionText(cond, { course: "PMA 3680" }).prompt).toBe("Did PMA 3680 have a significant life-science focus?");
    const accepted: Question = { ...base, type: "studentFact", fact: "acceptedToProgram", subject: "cornell-aem-bs" };
    expect(questionText(accepted, { program: "Applied Economics and Management" }).prompt).toBe(
      "Have you been officially accepted to Applied Economics and Management?"
    );
    const honors: Question = { ...base, type: "studentFact", fact: "honorsProgram", subject: "LING" };
    expect(questionText(honors, { program: "Linguistics" }).prompt).toBe("Are you in the Linguistics honors program?");
    const exam: Question = { ...base, type: "studentFact", fact: "departmentExamPassed", subject: "ECON" };
    expect(questionText(exam, {}).prompt).toBe("Did you pass the ECON department's placement exam?");
  });
});

describe("answeredLine", () => {
  const usedAs: Question = { ...base, type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] } };
  const labels = { course: "ENGL 2880", row: "a writing seminar" };

  it("says why a yes counted", () => {
    expect(answeredLine(usedAs, "yes", labels)).toBe("Counted because you said you're using ENGL 2880 as a writing seminar");
  });

  it("says no plainly", () => {
    expect(answeredLine(usedAs, "no", labels)).toBe("You said no");
  });

  it("states the credit count for creditsTaken", () => {
    const q: Question = { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] };
    expect(answeredLine(q, 3, {})).toBe("Counted at 3 credits because you said you took BIOMI 4850 for 3 credits");
  });
});
