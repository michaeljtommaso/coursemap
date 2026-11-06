// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditEntry } from "@/lib/schemas";
import type { CreditCollege, ExamTables } from "@/lib/credit/types";
import { MAX_CREDIT_ENTRIES } from "@/lib/credit/types";
import {
  FIXTURE_TABLES,
  fixtureExamResult,
  fixtureScoresThatEarn,
} from "@/components/credits/examTables.fixture";

// The "My credits" dialog with the shared CreditsEditor, rendered for real
// against a fixture exam table (spec 025 D2/D3/D6): one-click score picks,
// the exact saved shapes, legacy and unknown entries, the cap, and the
// tables-missing state.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
  creditProfile: [] as CreditEntry[],
  setCreditProfile: vi.fn(async (_entries: CreditEntry[]) => {}),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
const profileView = { college: "engineering" as CreditCollege };
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({ resolved: [], raw: auth.creditProfile, college: profileView.college }),
}));
vi.mock("@/lib/credit/resolve", () => ({
  scoresThatEarn: fixtureScoresThatEarn,
  examResult: fixtureExamResult,
  resolveCreditProfile: () => [],
}));
const COURSES = [
  { id: "MATH-1920", subject: "MATH", number: "1920", title: "Multivariable Calculus for Engineers", credits_min: 4, credits_max: 4 },
  { id: "MATH-2940", subject: "MATH", number: "2940", title: "Linear Algebra for Engineers", credits_min: 4, credits_max: 4 },
];
vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: (q: string) => ({
    results: q.trim() ? COURSES.filter((c) => `${c.subject} ${c.number} ${c.title}`.toLowerCase().includes(q.toLowerCase())) : [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

const { CreditsDialog } = await import("./CreditsDialog");

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();

function render(tables: ExamTables | null = FIXTURE_TABLES) {
  act(() => root.render(<CreditsDialog open onClose={onClose} tables={tables} />));
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const byLabel = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`);
function buttonByText(text: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}
function click(el: Element | null) {
  if (!el) throw new Error("missing element");
  act(() => (el as HTMLElement).click());
}
function type(el: Element | null, value: string) {
  if (!el) throw new Error("missing input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () => buttonByText("Save").click());
}
const saved = () => auth.setCreditProfile.mock.calls.at(-1)?.[0];
const row = (exam: string) => $(`[data-exam="${exam}"]`)!;

beforeEach(() => {
  auth.creditProfile = [];
  auth.setCreditProfile.mockReset().mockResolvedValue(undefined);
  profileView.college = "engineering";
  onClose.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("CreditsDialog + CreditsEditor", () => {
  it("shows only the scores that earn credit somewhere, as toggle buttons", () => {
    render();
    const scores = [...row("ap-calculus-bc").querySelectorAll("button[aria-pressed]")].map((b) => b.textContent);
    expect(scores).toEqual(["4", "5"]);
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("false");
    expect($("#credits-title")!.textContent).toBe("Your AP, IB and transfer credit");
  });

  it("one click picks and shows what it earns for this college", () => {
    render();
    click(byLabel("AP Calculus BC, score 5"));
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("true");
    expect(row("ap-calculus-bc").textContent).toContain("MATH 1910 · 4 cr");
  });

  it("a second click on the same score clears the pick", () => {
    render();
    click(byLabel("AP Calculus BC, score 5"));
    click(byLabel("AP Calculus BC, score 5"));
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("false");
    expect(row("ap-calculus-bc").querySelector("[data-exam-result]")).toBeNull();
  });

  it("clicking another score switches, and a score earning nothing here says so", () => {
    render();
    click(byLabel("AP Calculus BC, score 5"));
    click(byLabel("AP Calculus BC, score 4"));
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("false");
    expect(byLabel("AP Calculus BC, score 4")!.getAttribute("aria-pressed")).toBe("true");
    expect(row("ap-calculus-bc").textContent).toContain("No credit in Engineering");
  });

  it("shows the award's limits for a non-Engineering student", () => {
    profileView.college = "cas";
    render();
    click(byLabel("AP Chemistry, score 5"));
    expect(row("ap-chemistry").textContent).toContain("CHEM 2070 · 4 cr");
    expect(row("ap-chemistry").textContent).toContain("Chemistry majors: elective credit only");
  });

  it("saves an exam pick as an exam entry", async () => {
    render();
    click(byLabel("AP Calculus BC, score 5"));
    await save();
    expect(saved()).toEqual([
      {
        id: "exam:ap-calculus-bc",
        kind: "ap",
        label: "AP Calculus BC",
        satisfiesCourseIds: [],
        exam: "ap-calculus-bc",
        score: "5",
        tableYear: "2026-27",
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("saves a transfer course found in the catalog, credits prefilled and editable", async () => {
    render();
    click(buttonByText("Add a transfer course"));
    type($('input[aria-label="Search Cornell courses"]'), "1920");
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("MATH 1920"))!);
    const credits = $<HTMLInputElement>('input[type="number"]')!;
    expect(credits.value).toBe("4");
    type(credits, "3");
    click(buttonByText("Add course"));
    expect($('[data-transfer]')!.textContent).toContain("Counts as MATH 1920");
    await save();
    const [entry] = saved()!;
    expect(entry).toEqual({
      id: expect.stringMatching(/^transfer:[a-z0-9]{8}$/),
      kind: "transfer",
      label: "MATH 1920 (transfer)",
      satisfiesCourseIds: ["MATH-1920"],
      credits: 3,
    });
  });

  it("saves a transfer course with no Cornell equivalent as label + credits only", async () => {
    render();
    click(buttonByText("Add a transfer course"));
    click(buttonByText("No Cornell equivalent"));
    const [name] = [...document.querySelectorAll<HTMLInputElement>("form input:not([type=number])")];
    type(name, "Intro to Film");
    type($('input[type="number"]'), "3");
    click(buttonByText("Add course"));
    await save();
    expect(saved()).toEqual([
      { id: expect.stringMatching(/^transfer:/), kind: "transfer", label: "Intro to Film", satisfiesCourseIds: [], credits: 3 },
    ]);
  });

  it("removes a saved transfer course", async () => {
    auth.creditProfile = [
      { id: "transfer:abcd1234", kind: "transfer", label: "MATH 1920 (transfer)", satisfiesCourseIds: ["MATH-1920"], credits: 4 },
    ];
    render();
    click(byLabel("Remove MATH 1920 (transfer)"));
    await save();
    expect(saved()).toEqual([]);
  });

  it("shows a legacy entry as its exam picked, and replaces it with an exam entry on save", async () => {
    auth.creditProfile = [
      { id: "ap-calc-bc-5", kind: "ap", label: "AP Calculus BC (score 5)", satisfiesCourseIds: ["MATH-1910"], credits: 4 },
    ];
    render();
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("true");
    await save();
    expect(saved()).toEqual([
      expect.objectContaining({ id: "exam:ap-calculus-bc", exam: "ap-calculus-bc", score: "5", satisfiesCourseIds: [] }),
    ]);
  });

  it("keeps entries it doesn't understand untouched", async () => {
    const placement = { id: "placement-lang", kind: "placement" as const, label: "Language placement", satisfiesCourseIds: [], extra: 1 };
    const unknownExam = { id: "exam:ap-music-theory", kind: "ap" as const, label: "AP Music Theory", satisfiesCourseIds: [], exam: "ap-music-theory", score: "5", tableYear: "2026-27" };
    auth.creditProfile = [placement, unknownExam];
    render();
    expect($("[data-credits-kept]")!.textContent).toContain("Language placement");
    click(byLabel("AP Chemistry, score 5"));
    await save();
    expect(saved()).toEqual([expect.objectContaining({ id: "exam:ap-chemistry" }), placement, unknownExam]);
  });

  it("at the 60-entry cap disables new picks and transfers, with a reason", () => {
    auth.creditProfile = Array.from({ length: MAX_CREDIT_ENTRIES - 1 }, (_, i) => ({
      id: `transfer:t${String(i).padStart(7, "0")}`,
      kind: "transfer" as const,
      label: `Course ${i}`,
      satisfiesCourseIds: [],
      credits: 1,
    }));
    render();
    expect(byLabel("AP Chemistry, score 5")!.disabled).toBe(false);
    click(byLabel("AP Calculus BC, score 5"));
    expect(byLabel("AP Chemistry, score 5")!.disabled).toBe(true);
    expect(buttonByText("Add a transfer course").disabled).toBe(true);
    expect(document.body.textContent).toContain("You've reached 60 credits");
    // Switching a picked exam's score adds nothing, so it stays allowed.
    expect(byLabel("AP Calculus BC, score 4")!.disabled).toBe(false);
  });

  it("tables missing: a calm unavailable state, transfer still works, saved exams kept", async () => {
    const examEntry = { id: "exam:ap-chemistry", kind: "ap" as const, label: "AP Chemistry", satisfiesCourseIds: [], exam: "ap-chemistry", score: "5", tableYear: "2026-27" };
    auth.creditProfile = [examEntry];
    render(null);
    expect(document.body.textContent).toContain("Exam list unavailable");
    expect($('[role="tablist"]')).toBeNull();
    click(buttonByText("Add a transfer course"));
    click(buttonByText("No Cornell equivalent"));
    type(document.querySelector("form input:not([type=number])"), "Statistics");
    type($('input[type="number"]'), "4");
    click(buttonByText("Add course"));
    await save();
    expect(saved()).toEqual([expect.objectContaining({ kind: "transfer", label: "Statistics" }), examEntry]);
  });

  it("search looks across tabs; tabs count their picks", () => {
    render();
    click(byLabel("AP Calculus BC, score 5"));
    expect($('[role="tab"][aria-selected="true"]')!.textContent).toContain("1 picked");
    type($('input[aria-label="Search exams"]'), "biology");
    expect($('[data-exam="ib-biology-hl"]')).not.toBeNull();
    expect($('[data-exam="ap-calculus-bc"]')).toBeNull();
    type($('input[aria-label="Search exams"]'), "");
    click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith("Other"))!);
    expect(document.body.textContent).toContain("French Baccalaureate");
    expect($('[data-exam="intl-fr-mathematics"]')).not.toBeNull();
  });

  it("a failed save keeps the picks and offers Try again; no change closes without a write", async () => {
    auth.setCreditProfile.mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render();
    click(byLabel("AP Calculus BC, score 5"));
    await save();
    expect(document.body.textContent).toContain("Couldn't save your credits");
    expect(buttonByText("Try again")).toBeTruthy();
    expect(byLabel("AP Calculus BC, score 5")!.getAttribute("aria-pressed")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    warn.mockRestore();

    act(() => root.render(<CreditsDialog open={false} onClose={onClose} tables={FIXTURE_TABLES} />));
    auth.setCreditProfile.mockClear();
    render();
    await save();
    expect(auth.setCreditProfile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
