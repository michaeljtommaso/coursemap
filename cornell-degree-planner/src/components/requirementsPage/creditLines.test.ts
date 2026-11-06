import { describe, expect, it } from "vitest";
import type { ResolvedCredit } from "@/lib/credit/types";
import { creditEarns } from "./creditLines";

const base: ResolvedCredit = {
  id: "exam:x",
  kind: "ap",
  label: "AP X (5)",
  satisfiesCourseIds: [],
  credits: 4,
  source: { kind: "unresolved" },
  limits: [],
  earnsNothing: false,
};

describe("creditEarns — Cornell's 'X or Y' grants (QA: a 13-course list squeezed the card)", () => {
  it("two options read in full", () => {
    const c = {
      ...base,
      satisfiesCourseIds: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"],
      courseOptions: [
        ["CHEM-2070", "CHEM-2071"],
        ["CHEM-2090", "CHEM-2091"],
      ],
    };
    expect(creditEarns(c, "cas")).toBe("CHEM 2070 + CHEM 2071 or CHEM 2090 + CHEM 2091 · 4 cr");
  });

  it("a long placement list reads as one of N courses", () => {
    const ids = ["STSCI-2100", "AEM-2100", "PAM-2100", "SOC-3010"];
    const c = { ...base, satisfiesCourseIds: ids, courseOptions: ids.map((id) => [id]) };
    expect(creditEarns(c, "cals")).toBe("one of 4 courses (STSCI 2100, AEM 2100, …) · 4 cr");
  });

  it("a plain grant is unchanged", () => {
    expect(creditEarns({ ...base, satisfiesCourseIds: ["MATH-1110", "MATH-1120"], credits: 8 }, "cas")).toBe(
      "MATH 1110 + MATH 1120 · 8 cr"
    );
  });
});
