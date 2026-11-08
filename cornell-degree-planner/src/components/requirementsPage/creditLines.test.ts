import { describe, expect, it } from "vitest";
import { CURRENT_TABLE_YEAR, examEntryId, type ResolvedCredit } from "@/lib/credit/types";
import type { CreditEntry } from "@/lib/schemas";
import { resolveCreditProfile } from "@/lib/credit/resolve";
import { EXAM_TABLES } from "@/data/credit-tables";
import { creditLineCredits } from "@/components/rail/railLines";
import { creditEarns, creditTotal } from "./creditLines";

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

describe("creditTotal — each Cornell course counts once", () => {
  const entry = (examId: string, score: string): CreditEntry => ({
    id: examEntryId(examId),
    kind: "ap",
    label: "saved label",
    satisfiesCourseIds: [],
    exam: examId,
    score,
    tableYear: CURRENT_TABLE_YEAR,
  });

  it("AP Chemistry 5 plus A-Level Chemistry A totals 8, not 12 (same figure as the rail)", () => {
    const resolved = resolveCreditProfile(
      [entry("ap-chemistry", "5"), entry("alevel-chemistry", "A")],
      "cas",
      EXAM_TABLES
    );
    expect(resolved.reduce((s, c) => s + (c.credits ?? 0), 0)).toBe(12);
    expect(creditTotal(resolved)).toBe(8);
    expect(creditTotal(resolved)).toBe(creditLineCredits(resolved));
  });

  it("credit that earns nothing here or only places out adds nothing", () => {
    expect(creditTotal([{ ...base, earnsNothing: true }])).toBe(0);
    expect(creditTotal([{ ...base, placementOnly: true, satisfiesCourseIds: ["MATH-1910"] }])).toBe(0);
    expect(creditTotal([{ ...base, credits: 8 }])).toBe(8);
  });
});
