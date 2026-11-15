// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditEntry } from "@/lib/schemas";

// First run resumes where the student left off: progress is saved as they go
// and cleared when first run finishes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/data/credit-tables", async () => ({
  EXAM_TABLES: (await import("@/components/credits/examTables.fixture")).FIXTURE_TABLES,
}));
vi.mock("@/lib/credit/resolve", async (importOriginal) => {
  const f = await import("@/components/credits/examTables.fixture");
  return {
    ...(await importOriginal<typeof import("@/lib/credit/resolve")>()),
    scoresThatEarn: f.fixtureScoresThatEarn,
    examResult: f.fixtureExamResult,
    resolveCreditProfile: () => [],
  };
});
const auth = {
  uid: "u1" as string | null,
  enteringYear: 2025 as number | null,
  creditProfile: [] as CreditEntry[],
  setCreditProfile: vi.fn(async (_e: CreditEntry[]) => {}),
  setStudentContext: vi.fn(async () => {}),
  oweToursIfNew: vi.fn(async () => {}),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({ resolved: [], raw: [], college: "engineering" }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: [], loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: () => ({ results: [], loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/components/onboarding/CollegePicker", () => ({ CollegePicker: () => null }));
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({ StudentContextQuestions: () => null }));
vi.mock("@/lib/firebase", () => ({ app: {}, db: {}, auth: {} }));

const { FirstRun } = await import("./FirstRun");
const { useProgramStore } = await import("@/store/useProgramStore");

let root: Root;
const buttonByText = (text: string) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

const DRAFT_KEY = "cornell-first-run:u1";
/** Discovery door → skip the college → the credit step (year already known). */
function toCreditStep() {
  act(() => root.render(<FirstRun />));
  click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Still figuring it out"))!);
  click(buttonByText("I'll pick this later"));
}

beforeEach(() => {
  auth.uid = "u1";
  auth.creditProfile = [];
  auth.setCreditProfile.mockReset().mockResolvedValue(undefined);
  auth.oweToursIfNew.mockReset().mockResolvedValue(undefined);
  useProgramStore.setState({ selectedProgramId: null });
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const savedDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
const remount = () => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root.render(<FirstRun />));
};

describe("FirstRun resume", () => {
  beforeEach(() => localStorage.clear());

  it("a reload on the credit step resumes there with the picks kept", () => {
    toCreditStep();
    click(document.querySelector('button[aria-label="AP Calculus BC, score 5"]'));
    expect(savedDraft()).toMatchObject({ door: "discover", programId: "blank", step: "credits" });
    remount();
    expect(document.body.textContent).toContain("Your AP, IB and transfer credit");
    expect(document.querySelector('button[aria-label="AP Calculus BC, score 5"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(useProgramStore.getState().selectedProgramId).toBeNull();
  });

  it("a reload mid-flow resumes at the step reached", () => {
    act(() => root.render(<FirstRun />));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Still figuring it out"))!);
    remount();
    expect(savedDraft()).toMatchObject({ step: "college", programId: "blank" });
    expect(document.body.textContent).not.toContain("Two ways in.");
    expect(document.body.textContent).toContain("I'll pick this later");
  });

  it("finishing clears the draft and never creates the program twice", async () => {
    toCreditStep();
    await act(async () => buttonByText("Skip for now").click());
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(useProgramStore.getState().selectedProgramId).toBe("blank");
  });

  it("going back to the two doors clears the draft", () => {
    act(() => root.render(<FirstRun />));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Still figuring it out"))!);
    click(buttonByText("Back"));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("ignores another user's draft", () => {
    localStorage.setItem("cornell-first-run:u2", JSON.stringify({ v: 1, door: "discover", programId: "blank", step: "credits" }));
    act(() => root.render(<FirstRun />));
    expect(document.body.textContent).toContain("Two ways in.");
  });

  it("a uid that arrives after the first render still resumes", () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, door: "discover", programId: "blank", step: "college" }));
    auth.uid = null;
    act(() => root.render(<FirstRun />));
    expect(document.body.textContent).toContain("Two ways in.");
    auth.uid = "u1";
    act(() => root.render(<FirstRun />));
    expect(document.body.textContent).not.toContain("Two ways in.");
    expect(savedDraft()).toMatchObject({ step: "college" });
  });
});
