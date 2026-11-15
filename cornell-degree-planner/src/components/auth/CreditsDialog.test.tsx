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
// against a fixture exam table (spec 028 D2/D3/D6): one-click score picks,
// the exact saved shapes, legacy and unknown entries, the cap, and the
// tables-missing state. Spec 045 D4: the side list of sections, its counts,
// the running total and the college's own limits.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
  creditProfile: [] as CreditEntry[],
  setCreditProfile: vi.fn(async (_entries: CreditEntry[]) => {}),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => ({ creditFills: {} }) }));
const profileView = { college: "engineering" as CreditCollege };
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({ resolved: [], raw: auth.creditProfile, college: profileView.college }),
}));
vi.mock("@/lib/credit/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credit/resolve")>();
  return {
    ...actual,
    scoresThatEarn: fixtureScoresThatEarn,
    // Like the real resolver, the college's own limits ride on every award.
    examResult: (exam: string, score: string, college: CreditCollege, tables: ExamTables | null) => {
      const award = fixtureExamResult(exam, score, college, tables);
      return award && { ...award, limits: [...award.limits, ...actual.collegeLimitsFor(college, tables)] };
    },
    // The running total resolves the draft for real, over the injected tables.
  };
});
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
const tab = (section: string) => $<HTMLButtonElement>(`#credits-tab-${section}`);
const toTransfer = () => click(tab("transfer"));
const totalText = () => $("[data-credits-total]")!.textContent;

const CALS_LIMIT =
  "At most 15 credits from exams and transfer courses, combined, count toward a CALS degree.";
/** The fixture with a CALS override that carries a college-wide limit. */
const CALS_TABLES: ExamTables = {
  ...FIXTURE_TABLES,
  overrides: {
    cals: {
      college: "cals",
      year: "2026-27",
      source: FIXTURE_TABLES.university.source,
      awards: [],
      replaces: [],
      collegeLimits: [CALS_LIMIT],
    },
  },
};

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
    toTransfer();
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
    toTransfer();
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
    toTransfer();
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
    expect(document.body.textContent).toContain("You've reached 60 credits");
    // Switching a picked exam's score adds nothing, so it stays allowed.
    expect(byLabel("AP Calculus BC, score 4")!.disabled).toBe(false);
    toTransfer();
    expect(buttonByText("Add a transfer course").disabled).toBe(true);
  });

  it("tables missing: a calm unavailable state, transfer still works, saved exams kept", async () => {
    const examEntry = { id: "exam:ap-chemistry", kind: "ap" as const, label: "AP Chemistry", satisfiesCourseIds: [], exam: "ap-chemistry", score: "5", tableYear: "2026-27" };
    auth.creditProfile = [examEntry];
    render(null);
    expect(document.body.textContent).toContain("Exam list unavailable");
    // No exam families to list: one "All exams" entry, then Transfer courses.
    expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.id)).toEqual([
      "credits-tab-exams",
      "credits-tab-transfer",
    ]);
    toTransfer();
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

  it("the side list lists the exam families, then Transfer courses; AP is open first", () => {
    render();
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["AP", "IB", "A-Level", "Other exams", "Transfer courses"]);
    expect(tab("ap")!.getAttribute("aria-selected")).toBe("true");
    expect(tab("ap")!.tabIndex).toBe(0);
    expect(tab("ib")!.tabIndex).toBe(-1);
    const panel = $('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe("credits-tab-ap");
    expect(panel.querySelector('[data-exam="ap-calculus-bc"]')).not.toBeNull();
    expect(panel.querySelector('[data-exam="ib-biology-hl"]')).toBeNull();
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      expect(list.getAttribute("aria-orientation")).toBe("vertical");
    }
  });

  it("switching from AP to Transfer courses shows the transfer list and the add form", () => {
    auth.creditProfile = [
      { id: "transfer:abcd1234", kind: "transfer", label: "MATH 1920 (transfer)", satisfiesCourseIds: ["MATH-1920"], credits: 4 },
    ];
    render();
    // Mounted but hidden while AP shows (it keeps a half-filled form).
    expect($('[aria-label="Your transfer courses"]')!.closest("[hidden]")).not.toBeNull();
    toTransfer();
    expect(tab("transfer")!.getAttribute("aria-selected")).toBe("true");
    expect(tab("ap")!.getAttribute("aria-selected")).toBe("false");
    const panel = $('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe("credits-tab-transfer");
    expect(panel.querySelector("[data-exam]")).toBeNull();
    expect(panel.querySelector('input[aria-label="Search exams"]')).toBeNull();
    expect(panel.querySelector('[aria-label="Your transfer courses"]')!.textContent).toContain("MATH 1920");
    expect(panel.querySelector('[aria-label="Your transfer courses"]')!.closest("[hidden]")).toBeNull();
    click(buttonByText("Add a transfer course"));
    expect(panel.querySelector('form[aria-label="Add a transfer course"]')).not.toBeNull();
  });

  it("a half-filled transfer form survives a switch to AP and back", () => {
    render();
    toTransfer();
    click(buttonByText("Add a transfer course"));
    type($('input[aria-label="Search Cornell courses"]'), "1920");
    click(tab("ap"));
    expect($('form[aria-label="Add a transfer course"]')!.closest("[hidden]")).not.toBeNull();
    expect(row("ap-calculus-bc")).not.toBeNull();
    toTransfer();
    const form = $('form[aria-label="Add a transfer course"]')!;
    expect(form.closest("[hidden]")).toBeNull();
    expect($<HTMLInputElement>('input[aria-label="Search Cornell courses"]')!.value).toBe("1920");
  });

  it("traps Tab inside the dialog: from Save to the first control, and Shift+Tab back", () => {
    render();
    const panel = $('[role="dialog"] [tabindex="-1"]')!;
    const tabKey = (shiftKey = false) => {
      const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      act(() => void document.activeElement!.dispatchEvent(e));
      return e;
    };
    const saveButton = buttonByText("Save");
    act(() => saveButton.focus());
    const forward = tabKey();
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byLabel("Close"));
    expect(panel.contains(document.activeElement)).toBe(true);
    const back = tabKey(true);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(saveButton);
    // Inside the dialog, Tab is left to the browser.
    act(() => byLabel("Close")!.focus());
    expect(tabKey().defaultPrevented).toBe(false);
  });

  it("arrow keys move through both groups of the side list", () => {
    render();
    const key = (el: Element, k: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
    key(tab("ap")!, "ArrowUp");
    expect(tab("transfer")!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("transfer"));
    key(tab("transfer")!, "ArrowDown");
    expect(tab("ap")!.getAttribute("aria-selected")).toBe("true");
    key(tab("ap")!, "End");
    expect(tab("transfer")!.getAttribute("aria-selected")).toBe("true");
  });

  it("each section counts its own picks and transfer courses", () => {
    auth.creditProfile = [
      { id: "transfer:abcd1234", kind: "transfer", label: "MATH 1920 (transfer)", satisfiesCourseIds: ["MATH-1920"], credits: 4 },
    ];
    render();
    expect(tab("transfer")!.textContent).toBe("Transfer courses1, 1 added");
    expect(tab("ap")!.textContent).toBe("AP");
    click(byLabel("AP Calculus BC, score 5"));
    click(byLabel("AP Chemistry, score 5"));
    click(tab("ib"));
    click(byLabel("IB Biology HL, score 7"));
    expect(tab("ap")!.textContent).toContain("2, 2 picked");
    expect(tab("ib")!.textContent).toContain("1, 1 picked");
    expect(tab("alevel")!.textContent).toBe("A-Level");
    expect(document.body.textContent).toContain("Added: 3 exams · 1 transfer course");
  });

  it("the running total adds what each pick earns here and each transfer course's credits", () => {
    auth.creditProfile = [
      { id: "transfer:abcd1234", kind: "transfer", label: "Intro to Film", satisfiesCourseIds: [], credits: 3 },
    ];
    render();
    expect(totalText()).toContain("3 cr before Cornell");
    click(byLabel("AP Calculus BC, score 5"));
    expect(totalText()).toContain("7 cr before Cornell");
    // Engineering gives nothing for a 4 on Calculus BC.
    click(byLabel("AP Calculus BC, score 4"));
    expect(totalText()).toContain("3 cr before Cornell");
  });

  it("shows the college's own limit once in the side list (CALS), not on each exam", () => {
    profileView.college = "cals";
    render(CALS_TABLES);
    click(byLabel("AP Calculus BC, score 5"));
    click(byLabel("AP Chemistry, score 5"));
    expect(totalText()).toContain("8 cr before Cornell");
    const limits = [...document.querySelectorAll("[data-credits-limit]")].map((l) => l.textContent);
    expect(limits).toEqual([CALS_LIMIT]);
    expect(row("ap-chemistry").textContent).not.toContain(CALS_LIMIT);
  });

  it("no limit line for a college without one", () => {
    render();
    expect(document.querySelectorAll("[data-credits-limit]")).toHaveLength(0);
    expect(totalText()).toContain("0 cr before Cornell");
  });

  it("a search from any family finds exams in every family; picking a family clears it", () => {
    render();
    click(tab("alevel"));
    type($('input[aria-label="Search exams"]'), "chem");
    expect($('[data-exam="ap-chemistry"]')).not.toBeNull();
    expect(row("ap-chemistry").textContent).toContain("AP");
    type($('input[aria-label="Search exams"]'), "mathematics");
    expect($('[data-exam="alevel-mathematics"]')).not.toBeNull();
    expect($('[data-exam="intl-fr-mathematics"]')).not.toBeNull();
    click(tab("ap"));
    expect($<HTMLInputElement>('input[aria-label="Search exams"]')!.value).toBe("");
    expect($('[data-exam="alevel-mathematics"]')).toBeNull();
  });

  it("is a wide dialog with the roomy type scale", () => {
    render();
    const panel = $("#credits-title")!.closest(".type-roomy")!;
    expect(panel).not.toBeNull();
    expect(panel.className).toContain("max-w-[980px]");
    expect(panel.className).toContain("max-h-[88vh]");
    expect(panel.querySelector("[data-credits-editor]")).not.toBeNull();
  });
});
