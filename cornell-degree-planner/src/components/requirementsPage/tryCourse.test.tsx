import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogIndexRecord } from "@/lib/schemas";
import { TryCourseRow, type TryActions, type TryLine } from "./tryCourse";

// One class with Try / Trying ✓ and + <term>: the buttons name their class
// for a screen reader, and the fills and the off-term note wrap on their own
// lines instead of truncating in the narrow panel.

const record = { id: "HIST-1530", subject: "HIST", number: "1530", title: "Intro to American History", roster: "FA26" } as unknown as CatalogIndexRecord;

const LINE: TryLine = {
  id: "HIST-1530",
  code: "HIST 1530",
  title: "Intro to American History",
  fills: ["Historical Analysis", "Breadth: two of three areas"],
  record,
};

const actions: TryActions = {
  triedIds: [],
  atCap: false,
  onTry: vi.fn(() => true),
  onUntry: vi.fn(),
  onAdd: vi.fn(),
  addLabel: "+ Spring 2027",
};

const render = (tried: boolean, termLabel: string | null = "Spring 2027") =>
  renderToStaticMarkup(
    <TryCourseRow line={LINE} tried={tried} actions={actions} onToggle={() => {}} enrollmentTarget="SP27" termLabel={termLabel} />
  );

describe("TryCourseRow", () => {
  it("names the class on each button; the visible text stays short", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Try HIST 1530"');
    expect(html).toContain('aria-label="+ Spring 2027: HIST 1530"');
    expect(html).toMatch(/>Try<\/button>/);
    const tried = render(true);
    expect(tried).toContain('aria-label="Stop trying HIST 1530"');
    expect(tried).toMatch(/>Trying ✓<\/button>/);
  });

  it("the fills wrap, and the off-term note gets its own line", () => {
    const html = render(false);
    expect(html).not.toContain("truncate");
    expect(html).toContain("Fills Historical Analysis, Breadth: two of three areas");
    expect(html).toMatch(/<span data-off-term="true" class="block[^"]*">Not on the Spring 2027 roster<\/span>/);
  });

  it("no off-term note without a term", () => {
    expect(render(false, null)).not.toContain("data-off-term");
  });
});
