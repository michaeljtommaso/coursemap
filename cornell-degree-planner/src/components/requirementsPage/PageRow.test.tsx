import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DIST, ENG_LS } from "./fixtures";

vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
const { PageRow } = await import("./PageRow");

// Spec 037 D9 — on the Requirements page, Engineering liberal studies renders
// exactly like an Arts & Sciences / CALS distribution row: the same detail
// line, the same category grid, the same actions.

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
  it("states categories, courses and credits, and names what counts", () => {
    const html = render(ENG_LS);
    expect(text(html)).toContain("2 of 3 categories · 4 of 6 courses · 13 of 18 credits");
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
});
