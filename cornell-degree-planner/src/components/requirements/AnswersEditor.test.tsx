import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnswerListEntry } from "@/hooks/useRequirementProgress";
import { AnswersEditor } from "./AnswersEditor";

// Static render (no DOM library in this repo): what each entry shows.

const entry = (over: Partial<AnswerListEntry>): AnswerListEntry => ({
  key: "usedAs:cas-college/fws@ENGL-2880",
  scope: "mark",
  prompt: "Are you using ENGL 2880 as First-Year Writing Seminars?",
  valueLabel: "Yes",
  value: "yes",
  input: { kind: "yesno" },
  state: "active",
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("AnswersEditor", () => {
  it("lists each answer with its question, value, change and clear", () => {
    const html = renderToStaticMarkup(<AnswersEditor answers={[entry({})]} onAnswer={vi.fn()} />);
    expect(html).toContain("data-answers-editor");
    expect(html).toContain('data-answer-entry="usedAs:cas-college/fws@ENGL-2880"');
    expect(html).toContain('data-answer-state="active"');
    expect(text(html)).toContain("Are you using ENGL 2880 as First-Year Writing Seminars? Yes Change Clear");
  });

  it("a hidden mark is badged and still changeable; a no-longer-asked one can only be cleared", () => {
    const html = renderToStaticMarkup(
      <AnswersEditor
        answers={[
          entry({ key: "a", state: "hidden" }),
          entry({ key: "b", state: "notAsked", valueLabel: "No", value: "no" }),
        ]}
        onAnswer={vi.fn()}
      />
    );
    const [hidden, notAsked] = html.split("data-answer-entry=").slice(1);
    expect(text(hidden)).toContain("Yes Course not on your board Change Clear");
    expect(text(notAsked)).toContain("No No longer asked Clear");
    expect(text(notAsked)).not.toContain("Change");
  });

  it("empty: says how questions arise", () => {
    const html = renderToStaticMarkup(<AnswersEditor answers={[]} onAnswer={vi.fn()} />);
    expect(html).toContain("data-answers-editor");
    expect(text(html)).toContain("You haven't answered any.");
  });
});
