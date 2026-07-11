import { describe, it, expect } from "vitest";
import { buildCreditCourses } from "./creditPool";
import type { CreditEntry } from "@/lib/schemas";

function entry(overrides: Partial<CreditEntry> = {}): CreditEntry {
  return {
    id: "ap-calc-bc-5",
    kind: "ap",
    label: "AP Calculus BC (5)",
    satisfiesCourseIds: ["MATH-1910"],
    ...overrides,
  };
}

describe("buildCreditCourses", () => {
  it("returns empty sets for empty entries", () => {
    const pool = buildCreditCourses([]);
    expect(pool.ids.size).toBe(0);
    expect(pool.codes.size).toBe(0);
  });

  it("unions and dedupes satisfiesCourseIds across entries", () => {
    const pool = buildCreditCourses([
      entry({ id: "ap-calc-bc-5", satisfiesCourseIds: ["MATH-1910"] }),
      entry({ id: "ap-cs-a-5", kind: "ap", label: "AP CS A (5)", satisfiesCourseIds: ["CS-1110"] }),
      // Duplicate course id via a second (e.g. transfer) entry — must dedupe.
      entry({
        id: "transfer-math-1910",
        kind: "transfer",
        label: "Transfer calc",
        satisfiesCourseIds: ["MATH-1910"],
      }),
    ]);
    expect(pool.ids).toEqual(new Set(["MATH-1910", "CS-1110"]));
    expect(pool.ids.size).toBe(2);
  });

  it("unions multiple satisfiesCourseIds within a single entry", () => {
    const pool = buildCreditCourses([
      entry({ id: "ib-hl-1", kind: "ib", label: "IB HL", satisfiesCourseIds: ["PHYS-1112", "PHYS-2213"] }),
    ]);
    expect(pool.ids).toEqual(new Set(["PHYS-1112", "PHYS-2213"]));
  });

  it("derives dash-separated course codes with dashes turned to spaces", () => {
    const pool = buildCreditCourses([entry({ satisfiesCourseIds: ["MATH-1910", "CS-2110"] })]);
    expect(pool.codes).toEqual(new Set(["MATH 1910", "CS 2110"]));
  });

  it("ignores entries with no satisfiesCourseIds", () => {
    const pool = buildCreditCourses([
      entry({ id: "placeholder", kind: "placement", label: "Placement test", satisfiesCourseIds: [] }),
    ]);
    expect(pool.ids.size).toBe(0);
    expect(pool.codes.size).toBe(0);
  });
});
