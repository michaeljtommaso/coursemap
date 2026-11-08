import { describe, expect, it } from "vitest";
import {
  chosenCredits,
  creditChoices,
  creditsMarkKey,
  isVariableCredit,
  parseCreditInput,
  withChosenCredits,
} from "./chosenCredits";

describe("chosenCredits", () => {
  const marks = { [creditsMarkKey("CS-4999")]: 3 };

  it("uses the requirement question's key", () => {
    expect(creditsMarkKey("BIOMI-4850")).toBe("creditsTaken:BIOMI-4850");
  });

  it("applies a choice inside the range", () => {
    expect(chosenCredits(marks, "CS-4999", 1, 4)).toBe(3);
  });

  it("ignores a choice outside the range, on a fixed course, or a non-number", () => {
    expect(chosenCredits(marks, "CS-4999", 1, 2)).toBeNull();
    expect(chosenCredits(marks, "CS-4999", 3, 3)).toBeNull();
    expect(chosenCredits({ [creditsMarkKey("CS-4999")]: "yes" }, "CS-4999", 1, 4)).toBeNull();
    expect(chosenCredits(undefined, "CS-4999", 1, 4)).toBeNull();
    expect(chosenCredits(marks, "CS-4998", 1, 4)).toBeNull();
  });

  it("withChosenCredits fixes the course's credits, else returns the same object", () => {
    const c = { id: "CS-4999", credits_min: 1, credits_max: 4 };
    expect(withChosenCredits(c, marks, "CS-4999")).toEqual({ id: "CS-4999", credits_min: 3, credits_max: 3 });
    expect(withChosenCredits(c, {}, "CS-4999")).toBe(c);
  });

  it("isVariableCredit", () => {
    expect(isVariableCredit(1, 4)).toBe(true);
    expect(isVariableCredit(3, 3)).toBe(false);
    expect(isVariableCredit(0, 0)).toBe(false);
  });
});

describe("creditChoices", () => {
  it("whole numbers across a range", () => {
    expect(creditChoices(1, 4)).toEqual([1, 2, 3, 4]);
    expect(creditChoices(3, 4)).toEqual([3, 4]);
  });
  it("halves for a half-credit range", () => {
    expect(creditChoices(0.5, 1.5)).toEqual([0.5, 1, 1.5]);
  });
  it("a number field for a wide range", () => {
    expect(creditChoices(1, 8)).toHaveLength(8);
    expect(creditChoices(1, 15)).toBeNull();
    expect(creditChoices(1, 12)).toBeNull();
  });
  it("nothing for a fixed course", () => {
    expect(creditChoices(3, 3)).toBeNull();
  });
});

describe("parseCreditInput", () => {
  it("accepts numbers in range, in halves", () => {
    expect(parseCreditInput("6", 1, 15)).toBe(6);
    expect(parseCreditInput(" 7.5 ", 1, 15)).toBe(7.5);
  });
  it("refuses out of range, odd fractions, and junk", () => {
    expect(parseCreditInput("16", 1, 15)).toBeNull();
    expect(parseCreditInput("0", 1, 15)).toBeNull();
    expect(parseCreditInput("2.3", 1, 15)).toBeNull();
    expect(parseCreditInput("", 1, 15)).toBeNull();
    expect(parseCreditInput("abc", 1, 15)).toBeNull();
  });
});
