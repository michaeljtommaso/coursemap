// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementItem } from "@/hooks/useRequirementProgress";
import { ADVISE_COLLEGE, CORE, DIST, DIST_TRIED, ENG_LS, FWS, record } from "./fixtures";
import { buildCandidates } from "./suggestions";
import type { TryActions } from "./tryCourse";

// The side panel for the selected requirement (spec 045 D3), per row kind:
// a seat, a pool, a distribution row with categories and a tried class, a
// row with a question, and an advisor row (note and Looks wrong? only).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({
  StudentContextQuestions: ({ need }: { need?: string }) => <span data-question={need} />,
}));
const { RequirementPanel } = await import("./RequirementPanel");

const CODES: Record<string, string> = { p1: "HIST 1200", p2: "ARTH 1100", p5: "ECON 3030" };
const INDEX = [
  record("HIST-1530", { attrs: ["HST-AS"], roster: "SP27", title: "Intro to American History" }),
  record("HIST-2000", { attrs: ["HST-AS"], roster: "SP27", title: "Modern Europe" }),
  record("PHIL-1100", { attrs: ["ETM-AS"], roster: "SP27", title: "Intro to Philosophy" }),
];
const CANDIDATES = buildCandidates(INDEX, "SP27");
const TARGETS = [
  { label: "Historical", test: (r: { attrs: string[] }) => r.attrs.includes("HST-AS") },
  { label: "Ethics & Mind", test: (r: { attrs: string[] }) => r.attrs.includes("ETM-AS") },
];
const exclude = () => false;
const recordById = (id: string) => INDEX.find((r) => r.id === id);

let root: Root;
let container: HTMLDivElement;
const fns = {
  onClose: vi.fn(),
  onFormChange: vi.fn(),
  onAnswer: vi.fn(async () => {}),
  onToggleWaive: vi.fn(),
  onFindClass: vi.fn(),
  onShowOnBoard: vi.fn(),
  onTry: vi.fn((_id: string) => true),
  onUntry: vi.fn(),
};
function actions(triedIds: string[] = []): TryActions {
  return { triedIds, atCap: false, onTry: fns.onTry, onUntry: fns.onUntry, onAdd: vi.fn(), addLabel: "+ Spring 2027" };
}

type Props = ComponentProps<typeof RequirementPanel>;
function render(it: RequirementItem, over: Partial<Props> = {}) {
  act(() =>
    root.render(
      <RequirementPanel
        id="requirement-panel"
        item={it}
        where="Distribution"
        codeOfPlacement={(id) => CODES[id] ?? id}
        programId="economics"
        onFormChange={fns.onFormChange}
        onAnswer={fns.onAnswer}
        onToggleWaive={fns.onToggleWaive}
        onFindClass={fns.onFindClass}
        onShowOnBoard={it.coveredBy.length > 0 ? fns.onShowOnBoard : undefined}
        onClose={fns.onClose}
        {...over}
      />
    )
  );
}
const $ = (sel: string, from: ParentNode = container) => from.querySelector<HTMLElement>(sel);
const $$ = (sel: string, from: ParentNode = container) => [...from.querySelectorAll<HTMLElement>(sel)];
const text = () => $("[data-requirement-panel]")!.textContent ?? "";
const button = (label: string, from: ParentNode = container) => {
  const b = $$("button", from).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}"`);
  return b;
};
const click = (el: HTMLElement | null | undefined) => {
  if (!el) throw new Error("missing element");
  act(() => el.click());
};

beforeEach(() => {
  for (const f of Object.values(fns)) f.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RequirementPanel", () => {
  it("a seat: breadcrumb, name, detail, and its actions; focus moves into the panel", () => {
    const seat = { ...CORE, status: "satisfied" as const, coveredBy: ["p5"] };
    render(seat, { where: "Core" });
    const panel = $("[data-requirement-panel]")!;
    expect(panel.id).toBe("requirement-panel");
    expect(panel.dataset.requirementPanel).toBe(CORE.id);
    expect(document.activeElement).toBe(panel);
    expect($("p", panel)!.textContent).toBe("Core · Done");
    expect($("h2", panel)!.textContent).toBe("ECON 3030");
    expect(text()).toContain("ECON 3030");
    click($("[data-show-on-board]"));
    expect(fns.onShowOnBoard).toHaveBeenCalled();
    click(button("Waive"));
    expect(fns.onToggleWaive).toHaveBeenCalled();
    click($("[data-find-class]"));
    expect(fns.onFindClass).toHaveBeenCalled();
    click($("button[aria-label='Close details']"));
    expect(fns.onClose).toHaveBeenCalled();
  });

  it("a pool: how far along with what counts; a waived row offers Remove waiver", () => {
    render(FWS, { where: "Writing seminars" });
    expect($("p")!.textContent).toBe("Writing seminars · 1 of 2");
    expect(text()).toContain("1 of 2 courses: HIST 1200");
    render({ ...FWS, status: "waived" });
    expect(button("Remove waiver")).toBeDefined();
  });

  it("the note on its amber tint; Looks wrong? opens the report form in the panel", () => {
    const noted = { ...FWS, dist: { ...FWS.dist!, note: "A seminar taken in another college counts only with approval." } };
    render(noted);
    const note = $("[data-panel-note]")!;
    expect(note.textContent).toBe("A seminar taken in another college counts only with approval.");
    expect(note.className).toContain("bg-available-tint");
    expect($("textarea")).toBeNull();
    click($("[data-report-row]"));
    expect($("textarea")).not.toBeNull();
  });

  it("a distribution row: categories (tried ones blue), the tried line, and classes that would fill it", () => {
    render(DIST, {
      tried: DIST_TRIED,
      suggest: {
        targets: TARGETS,
        candidates: CANDIDATES,
        exclude,
        recordById,
        enrollmentTarget: "SP27",
        termLabel: "Spring 2027",
        triedFills: { "HIST-1530": ["Historical"] },
        actions: actions(["HIST-1530"]),
      },
    });
    const hst = $$("[data-category]").find((el) => el.dataset.category === "HST")!;
    expect(hst.dataset.filled).toBe("false");
    expect(hst.dataset.tried).toBe("true");
    expect($("[data-tried-delta]")!.textContent).toBe("+1 category if you take what you're trying");
    expect($("[data-tried-course]")!.textContent).toBe("HIST 1530 · trying");
    const list = $("[data-panel-suggestions]")!;
    expect(list.textContent).toContain("Classes that would fill this · Spring 2027 first");
    const courses = $$("[data-try-course]", list).map((el) => el.dataset.tryCourse);
    // The class being tried first, then suggestions for what's still open.
    expect(courses[0]).toBe("HIST-1530");
    expect(courses).toContain("HIST-2000");
    expect(courses).toContain("PHIL-1100");
    click(button("Trying ✓", $$("[data-try-course]", list)[0]));
    expect(fns.onUntry).toHaveBeenCalledWith("HIST-1530");
    const hist = $$("[data-try-course]", list).find((el) => el.dataset.tryCourse === "HIST-2000")!;
    expect(hist.textContent).toContain("Fills Historical");
    click(button("Try", hist));
    expect(fns.onTry).toHaveBeenCalledWith("HIST-2000");
  });

  it("at the tried cap, Try is disabled and says why", () => {
    render(DIST, {
      suggest: {
        targets: TARGETS,
        candidates: CANDIDATES,
        exclude,
        recordById,
        enrollmentTarget: "SP27",
        termLabel: "Spring 2027",
        triedFills: {},
        actions: { ...actions(), atCap: true },
      },
    });
    expect($("[data-try-cap]")!.textContent).toBe("Up to 20 classes at a time");
    const first = $$("[data-try-course]")[0];
    expect((button("Try", first) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a row with a question: the question line, its form, and an answer with change", () => {
    const asked: RequirementItem = {
      ...FWS,
      dist: {
        ...FWS.dist!,
        questions: [
          {
            key: "mark:ENGL-2880:fws",
            scope: "mark",
            prompt: "Did ENGL 2880 count as a writing seminar for you?",
            detail: "Your advisor can tell you.",
            input: { kind: "yesno" },
            courseCode: "ENGL 2880",
          },
        ],
        answered: [{ key: "fact:transfer", scope: "fact", line: "Counted because you said you transferred in." }],
      },
    };
    render(asked);
    const q = $("[data-row-question]")!;
    expect(q.textContent).toBe("1 question · ENGL 2880 could count here");
    click(q);
    expect(fns.onFormChange).toHaveBeenCalledWith("mark:ENGL-2880:fws");
    render(asked, { formKey: "mark:ENGL-2880:fws" });
    expect($("[data-question-form='mark:ENGL-2880:fws']")).not.toBeNull();
    const answer = $("[data-answer-line='fact:transfer']")!;
    expect(answer.textContent).toContain("Counted because you said you transferred in.");
    click(button("change", answer));
    expect(fns.onFormChange).toHaveBeenLastCalledWith("fact:transfer");
  });

  it("asks for the start term in the panel when it's unknown (spec 037 D8)", () => {
    const unknown = { ...ENG_LS, dist: { ...ENG_LS.dist!, notice: { kind: "needs-entry-term" as const } } };
    render(unknown);
    expect($("[data-question='entry-term']")).not.toBeNull();
    render(ENG_LS);
    expect($("[data-question]")).toBeNull();
  });

  it("an advisor row: the note and Looks wrong? only", () => {
    const advisorRow = { ...ADVISE_COLLEGE, dist: { ...ADVISE_COLLEGE.dist!, note: "Ask the registrar about study abroad." } };
    render(advisorRow, {
      advisor: true,
      where: "Check with your advisor",
      onToggleWaive: undefined,
      onFindClass: undefined,
    });
    expect($("p")!.textContent).toBe("Check with your advisor");
    expect($("[data-panel-note]")!.textContent).toBe("Ask the registrar about study abroad.");
    const labels = $$("button").map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(labels).toEqual(["Close details", `This looks wrong: ${ADVISE_COLLEGE.label}`]);
    expect($("[data-panel-suggestions]")).toBeNull();
    expect(text()).not.toContain("Confirm with your advisor");
  });
});
