import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DIST, ENG_LS } from "./fixtures";

vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({
  StudentContextQuestions: ({ need }: { need?: string }) => <span data-question={need} />,
}));
const { PageRow } = await import("./PageRow");

// Spec 037 D9 — on the Requirements page, Engineering liberal studies renders
// like an Arts & Sciences / CALS distribution row: the same category grid and
// the same actions. Its detail line leads with courses and says "groups".

const CODES: Record<string, string> = { p1: "ECON 1110", p2: "ECON 1120", p3: "GOVT 1111", p4: "PHIL 1100" };

const render = (item: typeof ENG_LS) =>
  renderToStaticMarkup(
    <PageRow
      item={item}
      codeOfPlacement={(id) => CODES[id] ?? id}
      programId="cornell-ore-bs-2026"
      onToggleWaive={() => {}}
      onFindClass={() => {}}
      onShowOnBoard={() => {}}
    />
  );

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const categories = (html: string) => [...html.matchAll(/data-category="([^"]+)"/g)].map((m) => m[1]);

describe("PageRow — Engineering liberal studies", () => {
  it("states courses, credits and groups, and names what counts", () => {
    const html = render(ENG_LS);
    expect(text(html)).toContain("4 of 6 courses · 13 of 18 credits · 2 of 3 groups");
    expect(text(html)).not.toContain("categories");
    expect(text(html)).toContain("Counting ECON 1110 ECON 1120 GOVT 1111 PHIL 1100");
  });

  it("shows the seven groups by their short labels, Race & Equity dashed", () => {
    const html = render(ENG_LS);
    expect(categories(html)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
    for (const label of ["Arts & Culture", "History", "Ethics & Mind", "Social Science", "Language", "Communications", "Race & Equity"]) {
      expect(text(html)).toContain(label);
    }
    expect(html).toMatch(/data-category="g7" data-filled="false"[^>]*class="[^"]*border-dashed/);
    expect(html).toMatch(/data-category="g4" data-filled="true"/);
  });

  it("the same parts as a CAS distribution row", () => {
    const parts = (html: string) => ({
      grid: html.includes('aria-label="Categories"'),
      engineStatus: /data-engine-status="partial"/.test(html),
      uncheckable: html.includes('data-checkable="false"'),
      findClass: text(html).includes("Find a class"),
      waive: text(html).includes("Waive"),
    });
    expect(parts(render(ENG_LS))).toEqual(parts(render(DIST)));
    expect(parts(render(ENG_LS))).toMatchObject({ grid: true, engineStatus: true, uncheckable: false });
  });

  it("asks for the start term on the row when it's unknown (spec 037 D8)", () => {
    const unknown = { ...ENG_LS, dist: { ...ENG_LS.dist!, notice: { kind: "needs-entry-term" as const } } };
    expect(render(unknown)).toContain('data-question="entry-term"');
    expect(render(ENG_LS)).not.toContain("data-question");
    expect(render({ ...unknown, status: "waived" })).not.toContain("data-question");
  });
});
