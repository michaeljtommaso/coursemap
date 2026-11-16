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

const render = (p: RequirementProgress, extra: Partial<Parameters<typeof PageHeader>[0]> = {}) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PageHeader
        programName="Animal Science"
        progress={p}
        {...extra}
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

  it("the done line is only what's done (tried classes are counted by the search); the question count is a link", () => {
    const t = text(render(progress({ openQuestionCount: 2 })));
    expect(t).toContain("9 of 31 done");
    expect(t).not.toContain("trying");
    expect(t).toContain("2 questions");
  });

  it("several programs: the title names each by its short name (spec 047)", () => {
    const t = text(render(progress(), { primaryShortName: "ANSC", extraProgramNames: ["Biology", "Business minor"] }));
    expect(t).toContain("Requirements · ANSC + Biology + Business minor");
    // One program: its full name.
    expect(text(render(progress(), { primaryShortName: "ANSC" }))).toContain("Requirements · Animal Science");
  });

  it("no progress bar under a notice", () => {
    const html = render(progress({ notice: { kind: "needs-entry-term" } }));
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("data-requirements-done");
  });
});
