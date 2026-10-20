import { describe, expect, it } from "vitest";
import { targetHighlightSem } from "./armHighlight";

/** Spec 017 D6 — which column "Place on board" suggests. enteringYear 2025 →
 *  sem 4 is Spring 2027 (the target SP27). */
const SEMS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("targetHighlightSem (spec 017 D6)", () => {
  it("course on the target roster + the plan has that column → its sem", () => {
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2025, SEMS)).toBe(4);
  });

  it("course not on the target roster → null", () => {
    expect(targetHighlightSem({ roster: "FA26" }, "SP27", 2025, SEMS)).toBeNull();
  });

  it("unknown roster (pre-sync doc / snapshot) → null", () => {
    expect(targetHighlightSem({ roster: null }, "SP27", 2025, SEMS)).toBeNull();
    expect(targetHighlightSem({}, "SP27", 2025, SEMS)).toBeNull();
    expect(targetHighlightSem(null, "SP27", 2025, SEMS)).toBeNull();
  });

  it("no target-term column (graduated before it / starts after it) → null", () => {
    // Entering 2020: sem 8 is Spring 2024, long before SP27.
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2020, SEMS)).toBeNull();
    // Entering 2027: sem 1 is Fall 2027, after SP27.
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2027, SEMS)).toBeNull();
  });

  it("a later-semester column counts only when the board renders it", () => {
    // Entering 2022: Spring 2027 is sem 10, rendered only when it holds a card.
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2022, SEMS)).toBeNull();
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2022, [...SEMS, 10])).toBe(10);
  });

  it("null target or unknown entering year → null", () => {
    expect(targetHighlightSem({ roster: "SP27" }, null, 2025, SEMS)).toBeNull();
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", null, SEMS)).toBeNull();
  });
});
