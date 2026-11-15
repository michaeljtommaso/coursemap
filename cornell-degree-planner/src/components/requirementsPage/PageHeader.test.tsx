import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";

// The popover's editors read the signed-in profile; the header line doesn't.
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({ StudentContextQuestions: () => null }));
vi.mock("@/components/requirements/AnswersEditor", () => ({ AnswersEditor: () => null }));

const { PageHeader } = await import("./PageHeader");

// The Requirements page header line (spec 045 D10), as static markup.

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const progress = (over: Partial<RequirementProgress> = {}) =>
  ({ groups: [], satisfiedCount: 9, total: 31, engine: "distribution", ...over }) as unknown as RequirementProgress;

const render = (p: RequirementProgress, triedCount = 0) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PageHeader
        programName="Animal Science"
        progress={p}
        triedCount={triedCount}
        onOpenFirstQuestion={() => {}}
        onAnswer={async () => {}}
        search={<div data-try-search />}
      />
    </MemoryRouter>
  );

describe("PageHeader (spec 045 D10)", () => {
  it("one line: back · title · search · progress · tour, in that order", () => {
    const html = render(progress());
    const t = text(html);
    expect(t).toContain("Back to planner Requirements · Animal Science");
    expect(t).toContain("9 of 31 done");
    const at = (s: string) => html.indexOf(s);
    expect(at("Requirements · Animal Science")).toBeLessThan(at("data-try-search"));
    expect(at("data-try-search")).toBeLessThan(at('role="progressbar"'));
    expect(at('role="progressbar"')).toBeLessThan(at("Take the tour"));
    expect(html).toContain('aria-valuenow="9"');
    expect(html).toContain('aria-valuemax="31"');
    expect(html).toContain("width:29%");
  });

  it("the done line counts tried classes; the question count is a link", () => {
    const t = text(render(progress({ openQuestionCount: 2 }), 3));
    expect(t).toContain("9 of 31 done · trying 3 classes");
    expect(t).toContain("2 questions");
  });

  it("no progress bar under a notice", () => {
    const html = render(progress({ notice: { kind: "needs-entry-term" } }));
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("data-requirements-done");
  });
});
