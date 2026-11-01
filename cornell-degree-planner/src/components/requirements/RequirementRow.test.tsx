import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnswerListEntry, DistributionItemInfo, RequirementItem, RowQuestionInfo } from "@/hooks/useRequirementProgress";

vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
const { RequirementRow } = await import("./RequirementRow");

// Static render (no DOM library in this repo): which spec 020 lines a row
// shows, and what the open question form holds. Interaction (save, Escape,
// focus) is covered by the browser e2e.

const FWS_Q: RowQuestionInfo = {
  key: "usedAs:cas-college/fws@ENGL-2880",
  scope: "mark",
  prompt: "Are you using ENGL 2880 as First-Year Writing Seminars?",
  detail: "If you are, it counts here and not toward anything else.",
  input: { kind: "yesno" },
  courseCode: "ENGL 2880",
};

function item(dist: Partial<DistributionItemInfo> = {}, over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    id: "cas-college:fws",
    label: "First-Year Writing Seminars",
    category: null,
    suggestedSem: null,
    status: "partial",
    coveredBy: [],
    checkable: true,
    requirement: null,
    dist: {
      layerId: "cas-college",
      rowId: "fws",
      layerKind: "college",
      rowKind: "pool",
      engineStatus: "partial",
      countedCodes: [],
      ...dist,
    },
    ...over,
  };
}

const render = (it: RequirementItem, props: Partial<Parameters<typeof RequirementRow>[0]> = {}) =>
  renderToStaticMarkup(
    <RequirementRow
      item={it}
      detail="1 of 2 courses"
      highlighted={false}
      programId={null}
      onActivate={() => {}}
      onFormChange={vi.fn()}
      onAnswer={vi.fn(async () => {})}
      {...props}
    />
  );

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("RequirementRow — spec 020 questions", () => {
  it("one question: a line naming the course, no form until opened", () => {
    const html = render(item({ questions: [FWS_Q] }));
    expect(html).toContain("data-row-question");
    expect(text(html)).toContain("1 question · ENGL 2880 could count here");
    expect(html).not.toContain("data-question-form");
    expect(html).toMatch(/data-row-question="true"[^>]*aria-expanded="false"/);
  });

  it("several questions read as a count; a fact question names no course", () => {
    const fact: RowQuestionInfo = {
      key: "studentFact:honorsProgram:LING",
      scope: "fact",
      prompt: "Are you in the Linguistics honors program?",
      detail: "Honors students have some different requirements.",
      input: { kind: "yesno" },
    };
    expect(text(render(item({ questions: [FWS_Q, { ...FWS_Q, key: "k2", courseCode: "ENGL 2860" }] })))).toContain(
      "2 questions · ENGL 2880, ENGL 2860 could count here"
    );
    expect(text(render(item({ questions: [fact] })))).toContain("1 question · your answer could change this");
  });

  it("no question line without a save path (read-only callers) or on a waived row", () => {
    expect(render(item({ questions: [FWS_Q] }), { onAnswer: undefined })).not.toContain("data-row-question");
    expect(render(item({ questions: [FWS_Q] }, { status: "waived" }))).not.toContain("data-row-question");
  });

  it("the open form: labelled by the prompt, the detail, Yes / No and Cancel", () => {
    const html = render(item({ questions: [FWS_Q] }), { formKey: FWS_Q.key });
    expect(html).toContain(`data-question-form="${FWS_Q.key}"`);
    const labelledBy = html.match(/<form[^>]*aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(text(html)).toContain(FWS_Q.prompt);
    expect(text(html)).toContain(FWS_Q.detail);
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]));
    expect(buttons).toEqual(expect.arrayContaining(["Yes", "No", "Cancel"]));
    expect(buttons).not.toContain("Clear my answer");
    expect(html).toMatch(/data-row-question="true"[^>]*aria-expanded="true"/);
  });

  it("a credits question offers one button per allowed value", () => {
    const q: RowQuestionInfo = { ...FWS_Q, key: "creditsTaken:BIOMI-4850", input: { kind: "credits", values: [2, 3] } };
    const html = render(item({ questions: [q] }), { formKey: q.key });
    expect(text(html)).toContain("2 credits");
    expect(text(html)).toContain("3 credits");
    expect(text(html)).not.toContain("Yes");
  });

  it("several questions: one at a time, with its position and Next question", () => {
    const html = render(item({ questions: [FWS_Q, { ...FWS_Q, key: "k2" }] }), { formKey: "k2" });
    expect(text(html)).toContain("Question 2 of 2");
    expect(text(html)).toContain("Next question");
    expect(html.match(/data-question-form=/g)).toHaveLength(1);
  });

  it("an answered row: the because-you-said line with change", () => {
    const line = "Counted because you said you're using ENGL 2880 as First-Year Writing Seminars";
    const html = render(item({ answered: [{ key: FWS_Q.key, scope: "mark", line }] }, { status: "satisfied" }));
    expect(html).toContain(`data-answer-line="${FWS_Q.key}"`);
    expect(text(html)).toContain(`${line} · change`);
  });

  it("change re-asks with the stored answer pressed and Clear my answer", () => {
    const entry: AnswerListEntry = {
      key: FWS_Q.key,
      scope: "mark",
      prompt: FWS_Q.prompt,
      valueLabel: "Yes",
      value: "yes",
      input: { kind: "yesno" },
      state: "active",
    };
    const html = render(
      item({ answered: [{ key: FWS_Q.key, scope: "mark", line: "Counted because …" }] }, { status: "satisfied" }),
      { formKey: FWS_Q.key, answerEntry: (k) => (k === entry.key ? entry : undefined) }
    );
    expect(html).toContain(`data-question-form="${FWS_Q.key}"`);
    expect(text(html)).toContain("Clear my answer");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Yes</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>No</);
  });

  it("existing DOM contract unchanged", () => {
    const html = render(item({ questions: [FWS_Q] }));
    expect(html).toContain('data-requirement="cas-college:fws"');
    expect(html).toContain('data-status="partial"');
    expect(html).toContain('data-engine-status="partial"');
  });
});
