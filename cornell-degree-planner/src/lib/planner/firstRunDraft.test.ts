// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFirstRunDraft,
  loadFirstRunDraft,
  parseFirstRunDraft,
  saveFirstRunDraft,
  type FirstRunDraft,
} from "./firstRunDraft";
import { EMPTY_DRAFT } from "@/components/credits/creditDraft";

const draft: FirstRunDraft = { door: "known", programId: "cs", step: "questions", creditDraft: null };

beforeEach(() => localStorage.clear());

describe("firstRunDraft", () => {
  it("round-trips a draft per user", () => {
    saveFirstRunDraft("u1", draft);
    expect(loadFirstRunDraft("u1")).toEqual(draft);
    expect(loadFirstRunDraft("u2")).toBeNull();
  });

  it("keeps the credit working copy only on the credit step", () => {
    const credits = { ...EMPTY_DRAFT, picks: { "ap-calculus-bc": "5" } };
    saveFirstRunDraft("u1", { ...draft, step: "credits", creditDraft: credits });
    expect(loadFirstRunDraft("u1")?.creditDraft).toEqual(credits);
    saveFirstRunDraft("u1", { ...draft, step: "questions", creditDraft: credits });
    expect(loadFirstRunDraft("u1")?.creditDraft).toBeNull();
  });

  it("clear removes it", () => {
    saveFirstRunDraft("u1", draft);
    clearFirstRunDraft("u1");
    expect(loadFirstRunDraft("u1")).toBeNull();
  });

  it("does nothing without a user id", () => {
    saveFirstRunDraft(null, draft);
    expect(localStorage.length).toBe(0);
    expect(loadFirstRunDraft(null)).toBeNull();
  });

  it("rejects malformed, foreign-version and empty data", () => {
    expect(parseFirstRunDraft(null)).toBeNull();
    expect(parseFirstRunDraft("{not json")).toBeNull();
    expect(parseFirstRunDraft(JSON.stringify({ v: 99, door: "known" }))).toBeNull();
    expect(parseFirstRunDraft(JSON.stringify({ v: 1, door: "other", programId: 5 }))).toBeNull();
  });

  it("drops a credit draft with the wrong shape but keeps the rest", () => {
    const raw = JSON.stringify({ v: 1, door: "discover", programId: "blank", step: "credits", creditDraft: { picks: 3 } });
    expect(parseFirstRunDraft(raw)).toEqual({ door: "discover", programId: "blank", step: "credits", creditDraft: null });
  });

  it("falls back to the questions step for an unknown step", () => {
    const raw = JSON.stringify({ v: 1, door: "known", programId: "cs", step: "bogus" });
    expect(parseFirstRunDraft(raw)?.step).toBe("questions");
  });
});
