import { describe, it, expect } from "vitest";
import { answersToSave, concentrationAnswered, nextQuestion, type ConcentrationAsk, type QuestionState } from "./studentQuestions";
import type { StudentPrefs } from "@/services/profile";

const EMPTY: StudentPrefs = { entryTerm: null, transfer: null, transferStanding: null, college: null, concentration: null };

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

describe("concentration question", () => {
  const ask = (over: Partial<ConcentrationAsk> = {}): ConcentrationAsk => ({
    programId: "maj",
    min: 1,
    max: 2,
    options: [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ],
    ...over,
  });
  const done = { entryTerm: "FA25", transfer: "none" as const };

  it("asks last, after the start and transfer questions", () => {
    const base = state({ askTransfer: true, enteringYear: 2025, concentrations: ask() });
    expect(nextQuestion({ ...base, known: { ...EMPTY, entryTerm: "FA25" } })).toBe("transfer");
    expect(nextQuestion({ ...base, draft: done })).toBe("concentration");
    expect(nextQuestion({ ...base, draft: { ...done, concentration: ["a"] } })).toBeNull();
  });

  it("is asked even where transfers are not", () => {
    expect(nextQuestion(state({ draft: { entryTerm: "FA25" }, concentrations: ask() }))).toBe("concentration");
  });

  it("is not asked when the major has no options", () => {
    expect(nextQuestion(state({ draft: { entryTerm: "FA25" }, concentrations: ask({ options: [] }) }))).toBeNull();
  });

  it("an answer on file counts only for the same major and within min..max", () => {
    const on = (programId: string, ids: string[]) => ({ ...EMPTY, concentration: { programId, ids } });
    expect(concentrationAnswered(on("maj", ["a"]), ask())).toBe(true);
    expect(concentrationAnswered(on("other", ["a"]), ask())).toBe(false);
    expect(concentrationAnswered(on("maj", []), ask())).toBe(false);
    expect(concentrationAnswered(on("maj", []), ask({ min: 0 }))).toBe(true);
    expect(concentrationAnswered(on("maj", ["a", "b"]), ask({ max: 1 }))).toBe(false);
    // an id the major no longer offers is not a usable answer
    expect(concentrationAnswered(on("maj", ["gone"]), ask({ min: 0 }))).toBe(false);
  });

  it("a valid answer on file is not re-asked; a stale one is", () => {
    const known = { ...EMPTY, entryTerm: "FA25", concentration: { programId: "maj", ids: ["b"] } };
    expect(nextQuestion(state({ known, enteringYear: 2025, concentrations: ask() }))).toBeNull();
    const stale = { ...known, concentration: { programId: "old-major", ids: ["b"] } };
    expect(nextQuestion(state({ known: stale, enteringYear: 2025, concentrations: ask() }))).toBe("concentration");
  });

  it("with need, asks it even when answered; saves it with its major", () => {
    const known = { ...EMPTY, concentration: { programId: "maj", ids: ["a"] } };
    expect(nextQuestion(state({ need: "concentration", known, concentrations: ask() }))).toBe("concentration");
    expect(nextQuestion(state({ need: "concentration", draft: { concentration: ["a"] } }))).toBeNull();
    expect(answersToSave({ concentration: ["a", "b"] }, "maj").prefs).toEqual({
      concentration: { programId: "maj", ids: ["a", "b"] },
    });
    expect(answersToSave({ concentration: [] }, "maj").prefs.concentration).toEqual({ programId: "maj", ids: [] });
    expect(answersToSave({ concentration: ["a"] }).prefs).toEqual({});
  });
});
