// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditEntry } from "@/lib/schemas";
import type { Program } from "@/types/db";

const CALS_LIMIT = "CALS counts at most 15 credits from exams and transfer courses combined.";

// First run's credit step (spec 028 D5): the shared credits editor, with the
// step's own skip and save idiom kept.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = await import("@/components/credits/examTables.fixture");
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
    // The fixture states no college limits; CALS gets one here.
    collegeLimitsFor: (college: string | null) => (college === "cals" ? [CALS_LIMIT] : []),
  };
});
const auth = {
  enteringYear: 2025 as number | null,
  creditProfile: [] as CreditEntry[],
  setCreditProfile: vi.fn(async (_e: CreditEntry[]) => {}),
  setStudentContext: vi.fn(async () => {}),
  oweToursIfNew: vi.fn(async () => {}),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
// What useCreditProfile reports. Before first run commits, a new guest who
// picked a major has no saved college yet (null).
const creditView = { college: "engineering" as string | null };
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({ resolved: [], raw: [], college: creditView.college, major: null }),
}));
const programList = { programs: [] as Program[] };
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: programList.programs, loading: false, error: null, refetch: () => {} }),
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

/** Discovery door → skip the college → the credit step (year already known). */
function toCreditStep() {
  act(() => root.render(<FirstRun />));
  click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Still figuring it out"))!);
  click(buttonByText("I'll pick this later"));
}

beforeEach(() => {
  auth.creditProfile = [];
  auth.enteringYear = 2025;
  creditView.college = "engineering";
  programList.programs = [];
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

describe("FirstRun credit step", () => {
  it("shows the shared editor; one click picks; Save & continue saves the exam entry and lands", async () => {
    toCreditStep();
    expect(document.querySelector("[data-credits-editor]")).not.toBeNull();
    expect(document.body.textContent).toContain("Your AP, IB and transfer credit");
    click(document.querySelector('button[aria-label="AP Calculus BC, score 5"]'));
    await act(async () => buttonByText("Save & continue").click());
    expect(auth.setCreditProfile).toHaveBeenCalledWith([
      expect.objectContaining({ id: "exam:ap-calculus-bc", exam: "ap-calculus-bc", score: "5", tableYear: fixture.FIXTURE_TABLES.year }),
    ]);
    expect(useProgramStore.getState().selectedProgramId).toBe("blank");
  });

  it("uses the dialog's side-list editor in a wide card, with no capped list", () => {
    toCreditStep();
    const editor = document.querySelector("[data-credits-editor]")!;
    const card = editor.closest(".rounded-2xl");
    expect(card).not.toBeNull();
    expect(card!.parentElement!.className).toContain("max-w-[980px]");
    expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      "AP",
      "IB",
      "A-Level",
      "Other exams",
      "Transfer courses",
    ]);
    expect(editor.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(editor.querySelector("[data-credits-total]")!.textContent).toContain("0 cr before Cornell");
    // One scroll area: the right pane, no nested height-capped exam list.
    expect(editor.querySelector('[class*="max-h-["]')).toBeNull();
    click(document.getElementById("credits-tab-transfer"));
    expect(document.body.textContent).toContain("Add a transfer course");
  });

  it("Skip for now saves nothing and still lands", async () => {
    toCreditStep();
    click(document.querySelector('button[aria-label="AP Calculus BC, score 5"]'));
    await act(async () => buttonByText("Skip for now").click());
    expect(auth.setCreditProfile).not.toHaveBeenCalled();
    expect(useProgramStore.getState().selectedProgramId).toBe("blank");
  });

  it("Save & continue with nothing changed writes nothing", async () => {
    toCreditStep();
    await act(async () => buttonByText("Save & continue").click());
    expect(auth.setCreditProfile).not.toHaveBeenCalled();
    expect(useProgramStore.getState().selectedProgramId).toBe("blank");
  });
});

describe("FirstRun credit step — the picked major's college", () => {
  const ANSC: Program = {
    id: "cals-animal-science",
    name: "Animal Science",
    short_name: "ANSC",
    college: "College of Agriculture and Life Sciences",
    catalog_year: 2026,
    total_credits: 120,
    affiliation_text: null,
    created_at: new Date(0).toISOString(),
    family: "cals",
  } as Program;

  it("shows the college's limit line for a major picked in first run, before its college is saved", () => {
    // A new guest: no saved college (it's saved when first run ends), year
    // not known yet, so "I know my major" → the start step → the credit step.
    creditView.college = null;
    auth.enteringYear = null;
    programList.programs = [ANSC];
    act(() => root.render(<FirstRun />));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("I know my major"))!);
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Animal Science"))!);
    click(buttonByText("I'll add this later"));
    const editor = document.querySelector("[data-credits-editor]")!;
    expect(editor).not.toBeNull();
    expect([...editor.querySelectorAll("[data-credits-limit]")].map((l) => l.textContent)).toEqual([CALS_LIMIT]);
    expect(editor.textContent).toContain("what it earns in CALS");
  });

  it("the blank canvas keeps the student's own college (its college step saved it)", () => {
    creditView.college = "cals";
    toCreditStep();
    expect([...document.querySelectorAll("[data-credits-limit]")].map((l) => l.textContent)).toEqual([CALS_LIMIT]);
  });
});

describe("FirstRun owes the tours (spec 039 D5)", () => {
  it("finishing first run asks the provider to owe the tours (it decides once the profile loads)", async () => {
    toCreditStep();
    await act(async () => buttonByText("Skip for now").click());
    expect(auth.oweToursIfNew).toHaveBeenCalledTimes(1);
  });

  it("leaving first run unfinished owes nothing", () => {
    toCreditStep();
    expect(auth.oweToursIfNew).not.toHaveBeenCalled();
  });
});
