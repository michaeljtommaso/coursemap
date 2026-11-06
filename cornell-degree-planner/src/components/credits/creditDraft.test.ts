import { describe, expect, it } from "vitest";
import type { CreditEntry } from "@/lib/schemas";
import { MAX_CREDIT_ENTRIES } from "@/lib/credit/types";
import {
  addTransfer,
  draftChanged,
  draftFromProfile,
  draftSize,
  draftToEntries,
  newTransferId,
  toggleScore,
} from "./creditDraft";
import { FIXTURE_TABLES as T } from "./examTables.fixture";

const examEntry = (exam: string, score: string, tableYear = "2026-27"): CreditEntry => ({
  id: `exam:${exam}`,
  kind: "ap",
  label: "x",
  satisfiesCourseIds: [],
  exam,
  score,
  tableYear,
});
const legacyCalc: CreditEntry = {
  id: "ap-calc-bc-5",
  kind: "ap",
  label: "AP Calculus BC (score 5)",
  satisfiesCourseIds: ["MATH-1910"],
  credits: 4,
};
const transfer: CreditEntry = {
  id: "transfer:abcd1234",
  kind: "transfer",
  label: "MATH 1920 (transfer)",
  satisfiesCourseIds: ["MATH-1920"],
  credits: 4,
};
const placement: CreditEntry = { id: "placement-lang", kind: "placement", label: "Language placement", satisfiesCourseIds: [] };

describe("creditDraft", () => {
  it("sorts a saved profile into picks, transfers and untouched entries", () => {
    const unknownExam = examEntry("ap-music-theory", "5");
    const d = draftFromProfile([examEntry("ap-chemistry", "5"), transfer, placement, unknownExam], T);
    expect(d.picks).toEqual({ "ap-chemistry": "5" });
    expect(d.transfers).toEqual([transfer]);
    expect(d.kept).toEqual([placement, unknownExam]);
  });

  it("reads a legacy id as its exam, and a proper entry of the same exam wins", () => {
    expect(draftFromProfile([legacyCalc], T).picks).toEqual({ "ap-calculus-bc": "5" });
    expect(draftFromProfile([legacyCalc, examEntry("ap-calculus-bc", "4")], T).picks).toEqual({
      "ap-calculus-bc": "4",
    });
  });

  it("keeps every exam-shaped entry untouched while the tables are missing", () => {
    const d = draftFromProfile([legacyCalc, examEntry("ap-chemistry", "5"), transfer], null);
    expect(d.picks).toEqual({});
    expect(d.kept).toEqual([legacyCalc, examEntry("ap-chemistry", "5")]);
    expect(draftToEntries(d, null)).toEqual([transfer, legacyCalc, examEntry("ap-chemistry", "5")]);
  });

  it("toggles: pick, switch, clear", () => {
    let d = draftFromProfile([], T);
    d = toggleScore(d, "ap-calculus-bc", "4");
    expect(d.picks).toEqual({ "ap-calculus-bc": "4" });
    d = toggleScore(d, "ap-calculus-bc", "5");
    expect(d.picks).toEqual({ "ap-calculus-bc": "5" });
    d = toggleScore(d, "ap-calculus-bc", "5");
    expect(d.picks).toEqual({});
  });

  it("re-saves an unchanged exam entry verbatim (its table year) and a changed one fresh", () => {
    const old = examEntry("ap-calculus-bc", "5", "2025-26");
    const d = draftFromProfile([old], T);
    expect(draftToEntries(d, T)).toEqual([old]);
    expect(draftChanged(d, [old], T)).toBe(false);
    const switched = toggleScore(d, "ap-calculus-bc", "4");
    expect(draftToEntries(switched, T)).toEqual([
      {
        id: "exam:ap-calculus-bc",
        kind: "ap",
        label: "AP Calculus BC",
        satisfiesCourseIds: [],
        exam: "ap-calculus-bc",
        score: "4",
        tableYear: "2026-27",
      },
    ]);
  });

  it("refuses new picks and transfers at the cap but still switches scores", () => {
    const many = Array.from({ length: MAX_CREDIT_ENTRIES - 1 }, (_, i) => ({ ...placement, id: `p${i}` }));
    let d = draftFromProfile(many, T);
    d = toggleScore(d, "ap-calculus-bc", "5");
    expect(draftSize(d)).toBe(MAX_CREDIT_ENTRIES);
    expect(toggleScore(d, "ap-chemistry", "5")).toBe(d);
    expect(addTransfer(d, transfer)).toBe(d);
    expect(toggleScore(d, "ap-calculus-bc", "4").picks["ap-calculus-bc"]).toBe("4");
  });

  it("makes transfer ids in the saved shape, never reusing one", () => {
    const id = newTransferId(["transfer:aaaaaaaa"]);
    expect(id).toMatch(/^transfer:[a-z0-9]{8}$/);
    expect(id.length).toBeLessThanOrEqual(40);
  });
});
