import { describe, it, expect } from "vitest";
import { answersToSave, nextQuestion, type QuestionState } from "./studentQuestions";
import type { StudentPrefs } from "@/services/profile";

const EMPTY: StudentPrefs = { entryTerm: null, transfer: null, transferStanding: null, college: null };

const state = (over: Partial<QuestionState> = {}): QuestionState => ({
  known: EMPTY,
  enteringYear: null,
  askTransfer: false,
  draft: {},
  ...over,
});

describe("nextQuestion", () => {
  it("Engineering: asks the start term only, never about transfers", () => {
    expect(nextQuestion(state())).toBe("entry-term");
    expect(nextQuestion(state({ draft: { entryTerm: "FA25" } }))).toBeNull();
  });

  it("Arts & Sciences / CALS: start term, then transfer, then standing for a transfer", () => {
    let s = state({ askTransfer: true });
    expect(nextQuestion(s)).toBe("entry-term");
    s = { ...s, draft: { entryTerm: "SP26" } };
    expect(nextQuestion(s)).toBe("transfer");
    s = { ...s, draft: { ...s.draft, transfer: "external" } };
    expect(nextQuestion(s)).toBe("transfer-standing");
    s = { ...s, draft: { ...s.draft, transferStanding: "junior" } };
    expect(nextQuestion(s)).toBeNull();
  });

  it("not a transfer: no standing question", () => {
    expect(nextQuestion(state({ askTransfer: true, draft: { entryTerm: "FA25", transfer: "none" } }))).toBeNull();
  });

  it("skips what the profile already holds", () => {
    const known = { ...EMPTY, entryTerm: "FA24", transfer: "internal" as const };
    expect(nextQuestion(state({ askTransfer: true, known, enteringYear: 2024 }))).toBe("transfer-standing");
    expect(
      nextQuestion(state({ askTransfer: true, known: { ...known, transferStanding: "sophomore" }, enteringYear: 2024 }))
    ).toBeNull();
  });

  it("a returning student with only a start YEAR is still asked the start term (never guessed)", () => {
    expect(nextQuestion(state({ enteringYear: 2025 }))).toBe("entry-term");
  });

  it("a start term without the semester-label year is asked again", () => {
    expect(nextQuestion(state({ known: { ...EMPTY, entryTerm: "FA25" } }))).toBe("entry-term");
  });

  it("with `need`, asks exactly that question, even if the profile has an answer", () => {
    const known = { ...EMPTY, entryTerm: "FA25", transfer: "none" as const };
    expect(nextQuestion(state({ need: "transfer", known, enteringYear: 2025 }))).toBe("transfer");
    expect(nextQuestion(state({ need: "transfer", known, draft: { transfer: "external" } }))).toBeNull();
    expect(nextQuestion(state({ need: "transfer-standing" }))).toBe("transfer-standing");
  });
});

describe("answersToSave", () => {
  it("saves the start term and derives the semester-label year", () => {
    expect(answersToSave({ entryTerm: "SP26" })).toEqual({ prefs: { entryTerm: "SP26" }, enteringYear: 2025 });
    expect(answersToSave({ entryTerm: "FA25" }).enteringYear).toBe(2025);
  });

  it("'not a transfer' clears a stale standing", () => {
    expect(answersToSave({ transfer: "none" }).prefs).toEqual({ transfer: "none", transferStanding: null });
  });

  it("a transfer keeps the standing it arrived with", () => {
    expect(answersToSave({ transfer: "external", transferStanding: "junior" }).prefs).toEqual({
      transfer: "external",
      transferStanding: "junior",
    });
  });

  it("nothing answered → nothing saved", () => {
    expect(answersToSave({})).toEqual({ prefs: {}, enteringYear: null });
  });
});
