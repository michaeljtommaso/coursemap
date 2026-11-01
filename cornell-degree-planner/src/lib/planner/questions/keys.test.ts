import { describe, it, expect } from "vitest";
import {
  ANSWER_KEY_RE,
  answerKey,
  isFactRef,
  isValidAnswerKey,
  markKey,
  parseRef,
  questionRef,
} from "./keys";
import type { Question } from "../distribution/types";

const SRC = { url: "https://catalog.cornell.edu/arts-sciences/", anchor: "Requirements" };
const base = { source: SRC, quote: "A sentence from the catalog." };

const usedAs: Question = { ...base, type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] } };
const approvedFor: Question = { ...base, type: "approvedFor", row: "mcb", courses: { subject: ["BIOMG"] }, approver: "advisor" };
const courseCondition: Question = {
  ...base,
  type: "courseCondition",
  row: "electives",
  courses: { subject: ["PMA"] },
  condition: "taughtByDepartmentFaculty",
};
const creditsTaken: Question = { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] };
const sequenceDone: Question = { ...base, type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4301", "NTRES-4302"], credits: 4 };
const fact: Question = { ...base, type: "studentFact", fact: "departmentExamPassed", subject: "ECON" };

describe("questionRef", () => {
  it("names row-scoped marks by layer and row", () => {
    expect(questionRef("cas-college", usedAs)).toBe("usedAs:cas-college/fws");
    expect(questionRef("p", approvedFor)).toBe("approvedFor:p/mcb");
    expect(questionRef("p", courseCondition)).toBe("courseCondition:p/electives");
  });

  it("names credit marks by course and facts by fact and subject", () => {
    expect(questionRef("p", creditsTaken)).toBe("creditsTaken:BIOMI-4850");
    expect(questionRef("p", sequenceDone)).toBe("sequenceDone:NTRES-4300");
    expect(questionRef("p", fact)).toBe("studentFact:departmentExamPassed:ECON");
  });

  it("gives a college-layer question the same ref under every program", () => {
    // The CAS college layer is the same layer (same id) for History and for
    // Economics, so its FWS question has one ref and one key for both.
    const underHistory = questionRef("cas-college", usedAs);
    const underEconomics = questionRef("cas-college", { ...usedAs });
    expect(underHistory).toBe(underEconomics);
    expect(markKey(underHistory, "ENGL-2880")).toBe(markKey(underEconomics, "ENGL-2880"));
    expect(underHistory).not.toMatch(/history|economics/);
  });
});

describe("markKey / answerKey", () => {
  it("adds the course for row-scoped marks", () => {
    expect(markKey("usedAs:cas-college/fws", "ENGL-2880")).toBe("usedAs:cas-college/fws@ENGL-2880");
    expect(answerKey("cas-college", usedAs, "ENGL-2880")).toBe("usedAs:cas-college/fws@ENGL-2880");
  });

  it("is the ref itself for credit marks and facts", () => {
    expect(markKey("creditsTaken:BIOMI-4850", "BIOMI-4850")).toBe("creditsTaken:BIOMI-4850");
    expect(markKey("sequenceDone:NTRES-4300", "X")).toBe("sequenceDone:NTRES-4300");
    expect(markKey("studentFact:honorsProgram:LING", "X")).toBe("studentFact:honorsProgram:LING");
    expect(answerKey("p", fact)).toBe("studentFact:departmentExamPassed:ECON");
  });

  it("produces keys the key regex accepts, with no dots", () => {
    for (const q of [usedAs, approvedFor, courseCondition, creditsTaken, sequenceDone, fact]) {
      const key = answerKey("cals-college-2025", q, "BIOMG-6330");
      expect(ANSWER_KEY_RE.test(key), key).toBe(true);
      expect(key).not.toContain(".");
      expect(isValidAnswerKey(key)).toBe(true);
    }
  });
});

describe("ANSWER_KEY_RE / isValidAnswerKey", () => {
  it("rejects dots, spaces and other characters", () => {
    for (const bad of ["a.b", "a b", "a$b", "a#b", "", "a\nb"]) expect(isValidAnswerKey(bad), bad).toBe(false);
  });

  it("caps the length at 120", () => {
    expect(isValidAnswerKey("a".repeat(120))).toBe(true);
    expect(isValidAnswerKey("a".repeat(121))).toBe(false);
  });
});

describe("parseRef / isFactRef", () => {
  it("round-trips every type", () => {
    expect(parseRef("usedAs:cas-college/fws")).toEqual({ type: "usedAs", layerId: "cas-college", row: "fws" });
    expect(parseRef("creditsTaken:BIOMI-4850")).toEqual({ type: "creditsTaken", course: "BIOMI-4850" });
    expect(parseRef("studentFact:honorsProgram:LING")).toEqual({ type: "studentFact", fact: "honorsProgram", subject: "LING" });
  });

  it("rejects malformed refs and answer keys", () => {
    for (const bad of [
      "usedAs:fws",
      "usedAs:/fws",
      "usedAs:a/b/c",
      "studentFact:madeUp:ECON",
      "studentFact:honorsProgram",
      "bogus:x",
      "usedAs:cas-college/fws@ENGL-2880",
      "creditsTaken:",
    ]) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it("tells fact refs from mark refs", () => {
    expect(isFactRef("studentFact:acceptedToProgram:cornell-aem-bs")).toBe(true);
    expect(isFactRef("usedAs:cas-college/fws")).toBe(false);
    expect(isFactRef("creditsTaken:BIOMI-4850")).toBe(false);
  });
});
