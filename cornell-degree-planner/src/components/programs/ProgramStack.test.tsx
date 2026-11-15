// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import type { Program } from "@/types/db";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prog = (id: string, name: string, short: string): Program => ({
  id,
  name,
  short_name: short,
  college: "College of Arts and Sciences",
  catalog_year: 2026,
  total_credits: null,
  affiliation_text: null,
  created_at: "",
  collegeId: "cas",
  family: "cas",
});

const ECON = prog("cornell-econ-ba", "Economics, B.A.", "Economics");
const MATH = prog("cornell-math-ba", "Mathematics, B.A.", "Mathematics");
const GOVT = prog("cornell-govt-ba", "Government, B.A.", "Government");

type PlanMock = {
  planId: string;
  additionalPrograms: AdditionalProgram[];
  addProgram: ReturnType<typeof vi.fn>;
  removeProgram: ReturnType<typeof vi.fn>;
  addTriedCourses: ReturnType<typeof vi.fn>;
};
const state: {
  programs: Program[];
  plan: PlanMock;
  progress: RequirementProgress;
  minors: MinorIndexEntry[];
  setStudentContext: ReturnType<typeof vi.fn>;
} = {} as never;

vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: state.programs, loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => state.plan }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => state.progress }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => ({ getProgramData: () => undefined }) }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ setStudentContext: state.setStudentContext }) }));
vi.mock("@/hooks/useAdditionalProgramData", () => ({
  useMinorIndex: () => ({ entries: state.minors, status: "ok" }),
}));

const { ProgramStack } = await import("./ProgramStack");

let root: Root;
let host: HTMLElement;
let folded = false;
const render = () =>
  act(() =>
    root.render(
      <MemoryRouter>
        <ProgramStack folded={folded} />
      </MemoryRouter>
    )
  );
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const buttonByLabel = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label);
const buttonByText = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));
const toast = () => usePlannerStore.getState().toast?.message ?? null;

beforeEach(() => {
  folded = false;
  state.programs = [ECON, MATH, GOVT];
  state.minors = [
    { id: "cs-minor", name: "Computer Science", shortName: "CS minor", offeredBy: "Bowers CIS", catalogYear: "2026-27" },
    {
      id: "econ-minor",
      name: "Economics",
      shortName: "Econ minor",
      offeredBy: "Arts & Sciences",
      catalogYear: "2026-27",
      notOpenTo: ["cornell-econ-ba"],
    },
  ];
  state.setStudentContext = vi.fn();
  state.plan = {
    planId: "plan-1",
    additionalPrograms: [],
    addProgram: vi.fn(() => "added"),
    removeProgram: vi.fn(),
    addTriedCourses: vi.fn((ids: string[]) => ({ added: ids, skipped: 0 })),
  };
  state.progress = { groups: [], attribution: {}, satisfiedCount: 8, total: 13, pct: 62 };
  useProgramStore.setState({ selectedProgramId: ECON.id });
  usePlannerStore.getState().dismissToast();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProgramStack", () => {
  it("a plan with no extras: the primary segment (tour anchor, e2e hook) and +", () => {
    render();
    const primary = $("#program-stack-primary")!;
    expect(primary.getAttribute("data-tour")).toBe("major");
    expect(primary.getAttribute("data-program-id")).toBe(ECON.id);
    expect(primary.getAttribute("data-program-name")).toBe("Economics, B.A.");
    expect(primary.textContent).toContain("Economics");
    expect(primary.textContent).toContain("62%");
    expect(buttonByLabel("Add a second major or minor")).toBeTruthy();
    expect($("#program-stack")!.querySelectorAll("button")).toHaveLength(2);
  });

  it("shows a segment per extra program; folded, one segment of rings", () => {
    state.plan.additionalPrograms = [
      { programId: MATH.id, kind: "major" },
      { programId: "cs-minor", kind: "minor" },
    ];
    state.progress.sections = [
      { id: ECON.id, kind: "primary", name: ECON.name, shortName: "Economics", color: null, pct: 62, satisfiedCount: 8, total: 13, status: "ok" },
      { id: MATH.id, kind: "secondMajor", name: MATH.name, shortName: "Mathematics", color: 1, pct: 40, satisfiedCount: 4, total: 10, status: "ok" },
      { id: "cs-minor", kind: "minor", name: "Computer Science", shortName: "CS minor", color: 2, pct: 50, satisfiedCount: 3, total: 6, status: "ok" },
    ];
    render();
    expect($(`[data-program-segment="${MATH.id}"]`)!.textContent).toContain("Mathematics40%");
    expect($('[data-program-segment="cs-minor"]')!.textContent).toContain("CS minor3/6");

    folded = true;
    render();
    expect(host.querySelector("[data-program-segment]")).toBeNull();
    expect(buttonByLabel("Mathematics 40%, CS minor 3 of 6. Your programs")).toBeTruthy();
    expect($("#program-stack-primary")!.textContent).not.toContain("62%");
  });

  it("any segment opens Your programs; Escape closes it and returns focus", () => {
    render();
    const plus = buttonByLabel("Add a second major or minor")!;
    act(() => plus.click());
    const panel = $('[role="dialog"][aria-label="Your programs"]')!;
    expect(panel).toBeTruthy();
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    expect($("#program-stack-primary")!.getAttribute("aria-controls")).toBe(panel.id);
    expect(document.activeElement).toBe(panel);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect($('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });

  it("the panel: rows with N of M, Change major on the primary, add buttons with their limits", () => {
    state.plan.additionalPrograms = [{ programId: MATH.id, kind: "major" }];
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    expect($('[data-program-row="cornell-econ-ba"]')!.textContent).toContain("8 of 13 done");
    expect($('[data-program-row="cornell-econ-ba"] #program-select')).toBeTruthy();
    expect($(`[data-program-row="${MATH.id}"]`)!.textContent).toContain("Loading…");
    const major = $<HTMLButtonElement>('[data-add="add-second-major"]')!;
    expect(major.disabled).toBe(true);
    expect(major.textContent).toBe("Second major (one per plan)");
    expect($<HTMLButtonElement>('[data-add="add-minor"]')!.disabled).toBe(false);
  });

  it("Change major behaves like the old select: switches the major and sets the college", () => {
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    const select = $<HTMLSelectElement>("#program-select")!;
    expect(select.value).toBe(ECON.id);
    act(() => {
      select.value = GOVT.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(useProgramStore.getState().selectedProgramId).toBe(GOVT.id);
    expect(state.setStudentContext).toHaveBeenCalledWith({ college: "cas" });
    expect($('[role="dialog"]')).toBeNull();
  });

  it("× removes a program with the tried classes counting only toward it (D10)", () => {
    state.plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
    state.progress.triedOnlyFor = { "cs-minor": ["CS-2110"] };
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    act(() => buttonByLabel("Remove Computer Science minor")!.click());
    expect(state.plan.removeProgram).toHaveBeenCalledWith("cs-minor", ["CS-2110"]);
  });

  it("the overlap line sits under the later program", () => {
    state.plan.additionalPrograms = [{ programId: MATH.id, kind: "major" }];
    state.progress.overlap = [
      {
        a: ECON.id,
        b: MATH.id,
        limit: { maxCourses: 2 },
        sharedCourseIds: ["ECON-3130", "MATH-2210"],
        heldBack: [{ courseId: "ECON-3110", placementId: "p1", countsFor: ECON.id, heldFrom: MATH.id }],
        estimated: false,
      },
    ];
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    expect($(`[data-program-row="${MATH.id}"] [data-overlap-line]`)!.textContent).toBe(
      "2 of 2 shared courses used · ECON 3110 counts for Economics only, because of the Mathematics limit."
    );
    expect($(`[data-program-row="${ECON.id}"] [data-overlap-line]`)).toBeNull();
  });

  it("add a minor: the picker, a disabled reason, then the fill once its section is solved (D3)", () => {
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    act(() => $<HTMLButtonElement>('[data-add="add-minor"]')!.click());
    const picker = $('[role="dialog"][aria-label="Add a program"]')!;
    expect(picker).toBeTruthy();
    expect(buttonByText("Minor")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement?.tagName).toBe("INPUT");
    const econ = $<HTMLButtonElement>('[data-picker-row="econ-minor"]')!;
    expect(econ.disabled).toBe(true);
    expect(econ.textContent).toContain("Not open to Economics majors");

    act(() => $<HTMLButtonElement>('[data-picker-row="cs-minor"]')!.click());
    expect(state.plan.addProgram).toHaveBeenCalledWith({ programId: "cs-minor", kind: "minor" });
    expect($('[role="dialog"]')).toBeNull();
    expect(state.plan.addTriedCourses).not.toHaveBeenCalled();

    // The plan gains the minor; its section loads, then solves.
    state.plan = { ...state.plan, additionalPrograms: [{ programId: "cs-minor", kind: "minor" }] };
    const cs = { id: "cs-minor", kind: "minor" as const, name: "Computer Science", shortName: "CS minor", color: 1 as const, pct: 0, satisfiedCount: 0, total: 6, status: "loading" as const };
    state.progress = { ...state.progress, sections: [cs] };
    render();
    expect(state.plan.addTriedCourses).not.toHaveBeenCalled();
    state.progress = {
      ...state.progress,
      sections: [{ ...cs, status: "ok" }],
      fillCandidates: { "cs-minor": ["CS-1110", "CS-2110"] },
    };
    render();
    expect(state.plan.addTriedCourses).toHaveBeenCalledWith(["CS-1110", "CS-2110"]);
    expect(toast()).toBe("Added 2 required classes for CS minor to Tried.");
    // Once only.
    render();
    expect(state.plan.addTriedCourses).toHaveBeenCalledTimes(1);
  });

  it("a refused add says why and fills nothing", () => {
    state.plan.addProgram = vi.fn(() => "cap");
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    act(() => $<HTMLButtonElement>('[data-add="add-second-major"]')!.click());
    expect(buttonByText("Second major")!.getAttribute("aria-pressed")).toBe("true");
    act(() => $<HTMLButtonElement>(`[data-picker-row="${MATH.id}"]`)!.click());
    expect(toast()).toBe("A plan holds one second major.");
  });
});
