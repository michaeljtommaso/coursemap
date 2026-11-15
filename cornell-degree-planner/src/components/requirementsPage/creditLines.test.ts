import { describe, expect, it } from "vitest";
import { CURRENT_TABLE_YEAR, examEntryId, type ResolvedCredit } from "@/lib/credit/types";
import type { CreditEntry } from "@/lib/schemas";
import { resolveCreditProfile } from "@/lib/credit/resolve";
import { EXAM_TABLES } from "@/data/credit-tables";
import { creditLineCredits } from "@/components/rail/railLines";
import {
  ELECTIVE_CREDIT_TEXT,
  creditCapText,
  creditCountsAs,
  creditCreditsText,
  creditEarns,
  creditHeaderText,
  creditName,
  creditRowNotes,
  creditRuleText,
  creditTotal,
} from "./creditLines";

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

describe("Credit before Cornell table wording (spec 045 D6)", () => {
  const ap: ResolvedCredit = {
    ...base,
    id: "exam:ap-biology",
    label: "AP Biology (5)",
    credits: 8,
    source: { kind: "exam", exam: "ap-biology", family: "ap", score: "5", tableYear: "2026-27", displayName: "AP Biology (5)" },
  };

  it("creditName: exam and score, transfer course, else the saved label", () => {
    expect(creditName(ap)).toBe("AP Biology · 5");
    expect(
      creditName({ ...base, kind: "transfer", label: "MATH 1920 (transfer)", source: { kind: "transfer" } })
    ).toBe("Transfer · MATH 1920");
    expect(
      creditName({ ...base, kind: "transfer", label: "Intro Psych (as PSYCH 1101)", source: { kind: "transfer" } })
    ).toBe("Transfer · Intro Psych (as PSYCH 1101)");
    expect(creditName({ ...base, label: "Old saved credit" })).toBe("Old saved credit");
  });

  it("creditCreditsText: credits, or a dash when nothing counts here", () => {
    expect(creditCreditsText(ap)).toBe("8 cr");
    expect(creditCreditsText({ ...ap, credits: 3.5 })).toBe("3.5 cr");
    expect(creditCreditsText({ ...ap, earnsNothing: true })).toBe("—");
    expect(creditCreditsText({ ...ap, placementOnly: true })).toBe("—");
  });

  it("creditCountsAs: fills, else courses, else elective credit", () => {
    expect(creditCountsAs(ap, "cals", ["Biological sciences"])).toEqual({ text: "Biological sciences", kind: "fills" });
    expect(creditCountsAs({ ...ap, satisfiesCourseIds: ["BIOG-1440"] }, "cals", [])).toEqual({
      text: "BIOG 1440",
      kind: "courses",
    });
    expect(creditCountsAs(ap, "cals", undefined)).toEqual({ text: ELECTIVE_CREDIT_TEXT, kind: "elective" });
    expect(creditCountsAs({ ...ap, earnsNothing: true }, "cals", ["X"])).toEqual({
      text: "No credit in CALS",
      kind: "none",
    });
    expect(creditCountsAs({ ...ap, placementOnly: true, satisfiesCourseIds: ["MATH-1910"] }, "cas", undefined).text).toBe(
      "Placement out of MATH 1910 · no credit"
    );
  });

  it("creditHeaderText: '16 cr · 15 count in CALS' over the cap, else the total", () => {
    expect(creditHeaderText([ap], "cals", { counted: 15, total: 16 })).toBe("16 cr · 15 count in CALS");
    expect(creditHeaderText([ap], "cals", { counted: 8, total: 8 })).toBe("8 cr");
    expect(creditHeaderText([ap], "engineering", undefined)).toBe("8 cr");
    expect(creditHeaderText([], "cals", undefined)).toBeNull();
    expect(creditHeaderText([ap], null, { counted: 4, total: 8 })).toBe("8 cr · 4 count toward your degree");
  });

  it("creditRuleText: the college's sentence(s) whenever there is credit, over the cap or not", () => {
    const rule = "CALS counts at most 15 credits from exams and transfer courses combined.";
    expect(creditRuleText([rule], true)).toBe(rule);
    expect(creditRuleText([rule, "Another."], true)).toBe(`${rule} Another.`);
    expect(creditRuleText([rule], false)).toBeNull();
    expect(creditRuleText([], true)).toBeNull();
  });

  it("creditCapText: this student's numbers (the college's sentence is the rule line's); null under the cap", () => {
    const rule = "CALS counts at most 15 credits from exams and transfer courses combined.";
    expect(creditCapText([rule], { counted: 15, total: 16 })).toBe("You have 16, so 1 doesn't count.");
    expect(creditCapText([rule], { counted: 15, total: 19 })).toBe("You have 19, so 4 don't count.");
    expect(creditCapText([rule], { counted: 15, total: 15 })).toBeNull();
    expect(creditCapText([rule], undefined)).toBeNull();
    expect(creditCapText([], { counted: 4, total: 8 })).toBe(
      "Your college doesn't count all of this credit toward your degree. You have 8, so 4 don't count."
    );
  });

  it("creditRowNotes: the credit's own lines without the college's", () => {
    const college = ["At most 15 credits count."];
    const c = { ...ap, limits: ["Elective credit only.", ...college], note: "Ask the department." };
    expect(creditRowNotes(c, null, undefined, college)).toEqual({
      limits: ["Elective credit only."],
      note: "Ask the department.",
    });
    expect(creditRowNotes({ ...c, earnsNothing: true }, null, undefined, college)).toEqual({
      limits: [],
      note: "Ask the department.",
    });
  });
});
