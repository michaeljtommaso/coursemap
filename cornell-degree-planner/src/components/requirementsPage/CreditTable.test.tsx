import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedCredit } from "@/lib/credit/types";
import { collegeLimitsFor } from "@/lib/credit/resolve";
import { EXAM_TABLES } from "@/data/credit-tables";
import { CreditTable, type CreditTableProps } from "./CreditTable";
import { CREDIT_CARD_KEY } from "./creditLines";
import { cardDomId } from "./pageModel";

// "Credit before Cornell" as a table group (spec 045 D6), rendered to static
// markup: the header total and cap, one cap line, Credit · Credits · Counts as.

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

const CALS_LIMITS = collegeLimitsFor("cals", EXAM_TABLES);

const exam = (
  id: string,
  displayName: string,
  score: string,
  extra: Partial<ResolvedCredit> = {}
): ResolvedCredit => ({
  id: `exam:${id}`,
  kind: "ap",
  label: `${displayName} (${score})`,
  satisfiesCourseIds: [],
  source: { kind: "exam", exam: id, family: "ap", score, tableYear: "2026-27", displayName: `${displayName} (${score})` },
  limits: [],
  earnsNothing: false,
  ...extra,
});

const BIO = exam("ap-biology", "AP Biology", "5", { credits: 8, limits: [...CALS_LIMITS] });
const CALC = exam("ap-calculus-ab", "AP Calculus AB", "5", {
  credits: 4,
  satisfiesCourseIds: ["MATH-1110"],
  limits: ["Not counted toward the quantitative requirement in some majors", ...CALS_LIMITS],
});
const LATIN = exam("ap-latin", "AP Latin", "3", { earnsNothing: true, limits: ["Some limit"] });
const TRANSFER: ResolvedCredit = {
  id: "transfer:abcd1234",
  kind: "transfer",
  label: "MATH 1920 (transfer)",
  satisfiesCourseIds: ["MATH-1920"],
  credits: 4,
  source: { kind: "transfer" },
  limits: [],
  earnsNothing: false,
};

const render = (props: Partial<CreditTableProps>) =>
  renderToStaticMarkup(<CreditTable resolved={[]} college="cals" onEdit={() => {}} {...props} />);

describe("CreditTable (spec 045 D6)", () => {
  it("keeps the group's DOM hooks for the outline", () => {
    const html = render({ resolved: [CALC] });
    expect(html).toContain(`id="${cardDomId(CREDIT_CARD_KEY)}"`);
    expect(html).toContain(`data-group-card="${CREDIT_CARD_KEY}"`);
    expect(html).toContain("data-credit-card");
  });

  it("over the cap: the header says how much counts, the college's sentence once, then the cap warning", () => {
    const html = render({ resolved: [BIO, CALC, TRANSFER], creditCount: { counted: 15, total: 16 } });
    const t = text(html);
    expect(t).toContain("Credit before Cornell 16 cr · 15 count in CALS Edit");
    expect(html.match(/data-credit-cap/g)).toHaveLength(1);
    expect(html.match(/data-credit-rule/g)).toHaveLength(1);
    expect(CALS_LIMITS.length).toBeGreaterThan(0);
    // The college's own sentence appears once, in the rule line, never per row.
    for (const l of CALS_LIMITS) expect(t.split(l)).toHaveLength(2);
    expect(t).toContain("You have 16, so 1 doesn't count.");
  });

  it("under the cap: the college's sentence stays as a muted line, no cap warning", () => {
    const html = render({ resolved: [CALC, TRANSFER], creditCount: { counted: 8, total: 8 } });
    const t = text(html);
    expect(html).not.toContain("data-credit-cap");
    expect(html.match(/data-credit-rule/g)).toHaveLength(1);
    for (const l of CALS_LIMITS) expect(t.split(l)).toHaveLength(2);
    expect(t).toContain("Credit before Cornell 8 cr Edit");
    expect(t).not.toContain("count in");
  });

  it("no college sentence without credit, or in a college that states none", () => {
    expect(render({ resolved: [] })).not.toContain("data-credit-rule");
    expect(render({ resolved: [CALC], college: "cas" })).not.toContain("data-credit-rule");
  });

  it("columns: Credit · Credits · Counts as, with exam score and transfer names", () => {
    const html = render({ resolved: [BIO, CALC, TRANSFER] });
    const t = text(html);
    expect(html.match(/data-credit-entry=/g)).toHaveLength(3);
    expect(t).toContain("Credit Credits Counts as");
    expect(t).toContain("AP Biology · 5 8 cr Elective credit · ask your major how it counts");
    expect(t).toContain("AP Calculus AB · 5 4 cr MATH 1110");
    expect(t).toContain("Transfer · MATH 1920 4 cr MATH 1920");
  });

  it("a credit that fills requirements here says which", () => {
    const html = render({ resolved: [CALC], fills: { [CALC.id]: ["Quantitative literacy", "Mathematics"] } });
    const t = text(html);
    expect(t).toContain("AP Calculus AB · 5 4 cr Quantitative literacy, Mathematics");
    expect(html).toContain('data-credit-counts-as="fills"');
  });

  it("an engine report of no fills falls back to the courses it earns", () => {
    const t = text(render({ resolved: [CALC], fills: { [CALC.id]: [] } }));
    expect(t).toContain("4 cr MATH 1110");
  });

  it("per-credit limits show in the row, without the college sentence", () => {
    const html = render({ resolved: [CALC] });
    const t = text(html);
    expect(t).toContain("Not counted toward the quantitative requirement in some majors");
    expect(html.match(/data-credit-limit/g)).toHaveLength(1);
    // Said once, on the rule line under the header, not in the row.
    for (const l of CALS_LIMITS) expect(t.split(l)).toHaveLength(2);
  });

  it("a credit that earns nothing here: No credit in <college>, no limit lines", () => {
    const html = render({ resolved: [LATIN], college: "cas" });
    const t = text(html);
    expect(t).toContain("AP Latin · 3 — No credit in Arts & Sciences");
    expect(html).not.toContain("data-credit-limit");
  });

  it("leaves out lines written for other majors", () => {
    const bio: ResolvedCredit = exam("ap-biology", "AP Biology", "5", {
      credits: 8,
      limits: ["Biological Sciences majors: elective credit only."],
      note: "Other majors: places you out of 8 credits of introductory biology.",
    });
    const ansc = text(render({ resolved: [bio], major: { name: "Animal Science, B.S." } }));
    expect(ansc).not.toContain("Biological Sciences majors");
    expect(ansc).toContain("Places you out of 8 credits of introductory biology.");
  });

  it("empty: No credit added yet, with Add (and no Edit)", () => {
    const t = text(render({ resolved: [] }));
    expect(t).toContain("No credit added yet Add");
    expect(t).not.toContain("Edit");
    expect(t).not.toContain("Counts as");
  });
});
