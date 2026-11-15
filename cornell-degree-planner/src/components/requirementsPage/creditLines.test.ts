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

  it("creditHeaderText: the full total always, '· N count in CALS' when some doesn't count", () => {
    expect(creditHeaderText([ap], "cals", { counted: 7, total: 8 })).toBe("8 cr · 7 count in CALS");
    expect(creditHeaderText([ap], "cals", { counted: 8, total: 8 })).toBe("8 cr");
    expect(creditHeaderText([ap], "engineering", undefined)).toBe("8 cr");
    expect(creditHeaderText([], "cals", undefined)).toBeNull();
    expect(creditHeaderText([ap], null, { counted: 4, total: 8 })).toBe("8 cr · 4 count toward your degree");
  });

  // QA (spec 045): 27 cr of credit, 8 of it for MATH 1110 and CHEM 2070, which
  // are also on the board; the engine's creditCount leaves those out (total 19)
  // and CALS's cap takes 1 more (counted 18). The header said "19 cr" while the
  // outline and the credit dialog said 27.
  const qa = [
    { ...base, id: "exam:a", credits: 8 },
    { ...base, id: "exam:b", credits: 4, satisfiesCourseIds: ["MATH-1110"] },
    { ...base, id: "exam:c", credits: 4, satisfiesCourseIds: ["CHEM-2070"] },
    { ...base, id: "exam:d", credits: 4, satisfiesCourseIds: ["MATH-1120"] },
    { ...base, id: "exam:e", credits: 4, satisfiesCourseIds: ["STSCI-2100"] },
    { ...base, id: "transfer:f", kind: "transfer" as const, credits: 3, satisfiesCourseIds: ["PSYCH-1101"] },
  ];
  const qaCount = { counted: 18, total: 19 };

  it("the header keeps the outline's total when board courses and the cap both take some", () => {
    expect(creditTotal(qa)).toBe(27);
    expect(creditHeaderText(qa, "cals", qaCount)).toBe("27 cr · 18 count in CALS");
    // Only board courses take some: still "· N count".
    expect(creditHeaderText(qa, "cals", { counted: 19, total: 19 })).toBe("27 cr · 19 count in CALS");
  });

  it("creditCapText: why, in parts, only the parts that aren't zero", () => {
    expect(creditCapText(qa, "cals", qaCount)).toBe(
      "8 cr are for courses already on your board, so they aren't counted twice. 1 cr is over CALS's limit."
    );
    expect(creditCapText(qa, "cals", { counted: 19, total: 19 })).toBe(
      "8 cr are for courses already on your board, so they aren't counted twice."
    );
    expect(creditCapText(qa, "cals", { counted: 15, total: 27 })).toBe("12 cr are over CALS's limit.");
    expect(creditCapText(qa, "cals", { counted: 22, total: 23 })).toBe(
      "4 cr are for courses already on your board, so they aren't counted twice. 1 cr is over CALS's limit."
    );
    expect(creditCapText(qa, null, { counted: 26, total: 26 })).toBe(
      "1 cr is for a course already on your board, so it isn't counted twice."
    );
    expect(creditCapText(qa, null, { counted: 25, total: 27 })).toBe("2 cr are over your college's limit.");
  });

  it("creditCapText: null when everything counts, or with no creditCount (Engineering)", () => {
    expect(creditCapText(qa, "cals", { counted: 27, total: 27 })).toBeNull();
    expect(creditCapText(qa, "engineering", undefined)).toBeNull();
    expect(creditCapText([], "cals", { counted: 0, total: 0 })).toBeNull();
  });

  it("creditRuleText: the college's sentence(s) whenever there is credit, over the cap or not", () => {
    const rule = "CALS counts at most 15 credits from exams and transfer courses combined.";
    expect(creditRuleText([rule], true)).toBe(rule);
    expect(creditRuleText([rule, "Another."], true)).toBe(`${rule} Another.`);
    expect(creditRuleText([rule], false)).toBeNull();
    expect(creditRuleText([], true)).toBeNull();
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
