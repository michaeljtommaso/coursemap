import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedCredit } from "@/lib/credit/types";
import { CreditCard } from "./CreditCard";
import { creditTotal } from "./creditLines";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const CALC: ResolvedCredit = {
  id: "exam:ap-calculus-bc",
  kind: "ap",
  label: "AP Calculus BC (5)",
  satisfiesCourseIds: ["MATH-1910"],
  credits: 4,
  exam: "ap-calculus-bc",
  score: "5",
  source: { kind: "exam", exam: "ap-calculus-bc", family: "ap", score: "5", tableYear: "2026-27", displayName: "AP Calculus BC (5)" },
  limits: ["Not counted toward A&S distribution"],
  earnsNothing: false,
};
const LATIN: ResolvedCredit = {
  id: "exam:ap-latin",
  kind: "ap",
  label: "AP Latin (3)",
  satisfiesCourseIds: [],
  source: { kind: "exam", exam: "ap-latin", family: "ap", score: "3", tableYear: "2026-27", displayName: "AP Latin (3)" },
  limits: [],
  earnsNothing: true,
};
const TRANSFER: ResolvedCredit = {
  id: "transfer:abcd1234",
  kind: "transfer",
  label: "PSYCH 1101 (transfer)",
  satisfiesCourseIds: ["PSYCH-1101"],
  credits: 3,
  source: { kind: "transfer" },
  limits: [],
  earnsNothing: false,
};

describe("CreditCard (spec 028 D7)", () => {
  it("lists every credit with its courses, credits, fills, limits and no-credit lines", () => {
    const html = renderToStaticMarkup(
      <CreditCard
        resolved={[CALC, LATIN, TRANSFER]}
        college="cas"
        fills={{ [CALC.id]: ["Mathematics"], [TRANSFER.id]: [] }}
        onEdit={() => {}}
      />
    );
    const t = text(html);
    expect(html.match(/data-credit-entry=/g)).toHaveLength(3);
    expect(t).toContain("AP Calculus BC (5) MATH 1910 · 4 cr");
    expect(t).toContain("Counts toward Mathematics");
    expect(t).toContain("Not counted toward A&S distribution");
    expect(t).toContain("AP Latin (3) No credit in Arts & Sciences");
    expect(t).toContain("PSYCH 1101 · 3 cr");
    expect(t).toContain("Doesn't fill a requirement here");
    expect(t).toContain("Edit");
    expect(t).toMatch(/Credit before Cornell 7 cr/);
  });

  it("leaves out lines written for other majors (Animal Science with AP Biology)", () => {
    const bio: ResolvedCredit = {
      id: "exam:ap-biology",
      kind: "ap",
      label: "AP Biology (5)",
      satisfiesCourseIds: [],
      credits: 8,
      source: { kind: "exam", exam: "ap-biology", family: "ap", score: "5", tableYear: "2026-27", displayName: "AP Biology (5)" },
      limits: ["Biological Sciences majors: elective credit only."],
      note: "Other majors: places you out of 8 credits of introductory biology.",
      earnsNothing: false,
    };
    const ansc = text(
      renderToStaticMarkup(
        <CreditCard resolved={[bio]} college="cals" major={{ name: "Animal Science, B.S." }} onEdit={() => {}} />
      )
    );
    expect(ansc).not.toContain("Biological Sciences majors");
    expect(ansc).toContain("Places you out of 8 credits of introductory biology.");
    const biosci = text(
      renderToStaticMarkup(
        <CreditCard resolved={[bio]} college="cals" major={{ name: "Biological Sciences, B.S." }} onEdit={() => {}} />
      )
    );
    expect(biosci).toContain("Biological Sciences majors: elective credit only.");
    expect(biosci).not.toContain("introductory biology");
  });

  it("empty: None yet · Add credit", () => {
    const t = text(renderToStaticMarkup(<CreditCard resolved={[]} college="cas" onEdit={() => {}} />));
    expect(t).toContain("None yet · Add credit");
    expect(t).not.toContain("Edit");
  });

  it("without fills from the engine, says nothing about what it filled", () => {
    const t = text(renderToStaticMarkup(<CreditCard resolved={[CALC]} college="cas" onEdit={() => {}} />));
    expect(t).not.toContain("Counts toward");
    expect(t).not.toContain("Doesn't fill");
  });

  it("totals only credits that earn something", () => {
    expect(creditTotal([CALC, LATIN, TRANSFER])).toBe(7);
  });
});
