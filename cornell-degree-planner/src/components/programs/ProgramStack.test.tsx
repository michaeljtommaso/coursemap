// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { RequirementGroup, RequirementProgress } from "@/hooks/useRequirementProgress";
import type { MinorMatch } from "@/lib/planner/rankMinors";
import type { Program } from "@/types/db";
import type { Layer } from "@/lib/planner/distribution/types";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useThemeStore } from "@/store/useThemeStore";

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
  setCountsFor: ReturnType<typeof vi.fn>;
  setProgramConcentrations?: ReturnType<typeof vi.fn>;
};
const state: {
  programs: Program[];
  plan: PlanMock;
  progress: RequirementProgress;
  minors: MinorIndexEntry[];
  minorMatch: { matches: MinorMatch[]; ready: boolean; needsMajor: boolean; error: boolean };
  setStudentContext: ReturnType<typeof vi.fn>;
  makeRoom: ReturnType<typeof vi.fn>;
  /** useProgramData(id).layers: the second major's layers (D2 concentrations). */
  programLayers: Record<string, Layer[]>;
} = {} as never;

vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: state.programs, loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => state.plan }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => state.progress }));
vi.mock("@/hooks/useProgramData", () => ({
  useProgramData: (id: string | null) => ({ slots: [], layers: id ? state.programLayers[id] : undefined, loading: false, error: null }),
}));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => ({ getProgramData: () => undefined }) }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ setStudentContext: state.setStudentContext }) }));
vi.mock("@/hooks/useAdditionalProgramData", () => ({
  useMinorIndex: () => ({ entries: state.minors, status: "ok" }),
}));
// "Minors you're close to" (D11): the ranking itself is rankMinors.test.ts;
// here, what the panel does with it.
vi.mock("@/hooks/useBoard", () => ({ useBoard: () => ({ cards: [], columns: [], templateSlots: [] }) }));
vi.mock("@/hooks/useMajorMatch", () => ({ useMinorMatch: () => state.minorMatch }));
// The D10 cap guard (orphanPrune.test.ts covers what it does).
vi.mock("@/components/requirements/orphanPrune", () => ({ useMakeRoom: () => state.makeRoom }));

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
  state.minorMatch = { matches: [], ready: true, needsMajor: false, error: false };
  state.setStudentContext = vi.fn();
  state.makeRoom = vi.fn();
  state.programLayers = {};
  state.plan = {
    planId: "plan-1",
    additionalPrograms: [],
    addProgram: vi.fn(() => "added"),
    removeProgram: vi.fn(),
    addTriedCourses: vi.fn((ids: string[]) => ({ added: ids, skipped: 0 })),
    setCountsFor: vi.fn(),
    setProgramConcentrations: vi.fn(),
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
    expect(major.textContent).toBe("Second major");
    const reason = $('[data-add-reason="major"]')!;
    expect(reason.textContent).toBe("One second major per plan.");
    expect(major.getAttribute("aria-describedby")).toBe(reason.id);
    expect($<HTMLButtonElement>('[data-add="add-minor"]')!.disabled).toBe(false);
    expect($('[data-add-reason="minor"]')).toBeNull();
  });

  describe("an Engineering primary (D15)", () => {
    const eng = (id: string, name: string, short: string) =>
      ({ ...prog(id, name, short), college: "College of Engineering", collegeId: "engineering", family: "engineering" }) as Program;
    const ME = eng("cornell-me-bs", "Mechanical Engineering, B.S.", "ME");
    const CS = eng("cornell-cs-bs", "Computer Science, B.S.", "CS");
    const ECE = eng("cornell-ece-bs", "Electrical and Computer Engineering, B.S.", "ECE");
    const ORE = eng("cornell-ore-bs", "Operations Research and Engineering, B.S.", "ORE");
    const ISST = eng("cornell-isst-bs", "Information Science, Systems, and Technology, B.S.", "ISST");
    const ENVE = eng("cornell-enve-bs", "Environmental Engineering, B.S.", "EnvE");
    const CE = eng("cornell-ce-bs", "Civil Engineering, B.S.", "CE");
    const NOTE =
      "Both majors' undergraduate coordinators must approve this pair, and your plan must show distinct thrusts in the two areas.";
    const ISST_REASON = "ISST can't be paired with Computer Science or Operations Research (curricular overlap).";
    const openPicker = (primary: Program) => {
      state.programs = [ECON, MATH, ME, CS, ECE, ORE, ISST, ENVE, CE];
      useProgramStore.setState({ selectedProgramId: primary.id });
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      const major = $<HTMLButtonElement>('[data-add="add-second-major"]')!;
      expect(major.disabled).toBe(false);
      expect(major.textContent).toBe("Add a second major");
      expect($('[data-add-reason="major"]')).toBeNull();
      act(() => major.click());
      return $('[role="dialog"][aria-label="Add a program"]')!;
    };
    const rowIds = () => [...host.querySelectorAll("[data-picker-row]")].map((r) => r.getAttribute("data-picker-row"));

    it("ME: Second major lists the other Engineering majors, not ME and no A&S major", () => {
      const picker = openPicker(ME);
      expect(buttonByText("Second major")!.getAttribute("aria-pressed")).toBe("true");
      expect(picker.querySelector('[role="group"][aria-label="Engineering"]')).toBeTruthy();
      expect(rowIds()).toEqual([CE.id, CS.id, ECE.id, ENVE.id, ISST.id, ORE.id]);
      expect(rowIds()).not.toContain(ME.id);
      expect(rowIds()).not.toContain(ECON.id);
      expect(picker.textContent).toContain("Second majors list Engineering majors only.");
      expect(picker.textContent).not.toContain("coming soon");
    });

    it("ISST: CS and ORE disabled with the college's reason", () => {
      openPicker(ISST);
      for (const id of [CS.id, ORE.id]) {
        const row = $<HTMLButtonElement>(`[data-picker-row="${id}"]`)!;
        expect(row.disabled).toBe(true);
        expect(row.textContent).toContain(ISST_REASON);
      }
      expect($<HTMLButtonElement>(`[data-picker-row="${ME.id}"]`)!.disabled).toBe(false);
    });

    it("EnvE: CE open, with the note under its row; then on the panel's CE row", () => {
      openPicker(ENVE);
      const ce = $<HTMLButtonElement>(`[data-picker-row="${CE.id}"]`)!;
      expect(ce.disabled).toBe(false);
      const note = $(`[data-picker-note="${CE.id}"]`)!;
      expect(note.textContent).toBe(NOTE);
      expect(ce.getAttribute("aria-describedby")).toBe(note.id);
      expect($(`[data-picker-note="${ME.id}"]`)).toBeNull();

      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      state.plan.additionalPrograms = [{ programId: CE.id, kind: "major" }];
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      expect($(`[data-program-row="${CE.id}"] [data-program-note]`)!.textContent).toBe(NOTE);
      expect($(`[data-program-row="${ENVE.id}"] [data-program-note]`)).toBeNull();
    });

    it("adding CS calls addProgram, then fills Tried once its section solves", () => {
      openPicker(ME);
      act(() => $<HTMLButtonElement>(`[data-picker-row="${CS.id}"]`)!.click());
      expect(state.plan.addProgram).toHaveBeenCalledWith({ programId: CS.id, kind: "major" });
      expect($('[role="dialog"]')).toBeNull();
      expect(state.plan.addTriedCourses).not.toHaveBeenCalled();

      state.plan = { ...state.plan, additionalPrograms: [{ programId: CS.id, kind: "major" }] };
      const cs = { id: CS.id, kind: "secondMajor" as const, name: CS.name, shortName: "CS", color: 1 as const, pct: 0, satisfiedCount: 0, total: 9, status: "loading" as const };
      state.progress = { ...state.progress, sections: [cs] };
      render();
      expect(state.plan.addTriedCourses).not.toHaveBeenCalled();
      state.progress = {
        ...state.progress,
        sections: [{ ...cs, status: "ok" }],
        fillCandidates: { [CS.id]: ["CS-2110", "CS-3110", "CS-3410"] },
      };
      render();
      expect(state.plan.addTriedCourses).toHaveBeenCalledWith(["CS-2110", "CS-3110", "CS-3410"]);
      expect(toast()).toBe("Added 3 required classes for CS to Tried.");
      expect($(`[data-program-segment="${CS.id}"]`)).toBeTruthy();
    });
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

  it("Change major's opened list follows the app theme and tokens, never the face's link blue", () => {
    act(() => useThemeStore.setState({ theme: "dark" }));
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    const select = $<HTMLSelectElement>("#program-select")!;
    // happy-dom doesn't resolve var() in computed styles; the inline style is
    // what the browser draws the opened list from.
    expect(getComputedStyle(select).colorScheme).toBe("dark");
    expect(select.style.backgroundColor).toBe("var(--surface)");
    expect(select.style.color).toBe("var(--text)");
    expect(select.options[0].style.color).toBe("var(--text)");
    act(() => useThemeStore.setState({ theme: "light" }));
    expect(select.style.colorScheme).toBe("light");
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

  describe("held-back courses as either/or toggles (D8)", () => {
    // A program's own layer, as the engine tags its rows.
    const layerGroup = (sectionId: string, layerId: string, layerKind: "major" | "minor"): RequirementGroup => ({
      key: sectionId,
      label: sectionId,
      sectionId,
      satisfiedCount: 0,
      total: 1,
      items: [
        {
          id: `${layerId}:r`,
          label: "r",
          category: null,
          suggestedSem: null,
          status: "unmet",
          coveredBy: [],
          checkable: true,
          requirement: null,
          dist: { layerId, rowId: "r", layerKind, rowKind: "seat", engineStatus: "unmet", countedCodes: [] },
        },
      ],
    });
    const setUp = (groups: RequirementGroup[]) => {
      state.plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
      state.progress.sections = [
        { id: ECON.id, kind: "primary", name: ECON.name, shortName: "Economics", color: null, pct: 62, satisfiedCount: 8, total: 13, status: "ok" },
        { id: "cs-minor", kind: "minor", name: "Computer Science", shortName: "CS minor", color: 1, pct: 50, satisfiedCount: 3, total: 6, status: "ok" },
      ];
      state.progress.groups = groups;
      state.progress.overlap = [
        {
          a: ECON.id,
          b: "cs-minor",
          limit: { maxCourses: 1 },
          limitFrom: "cs-minor",
          sharedCourseIds: ["ECON-3130"],
          heldBack: [{ courseId: "ECON-3120", placementId: "p1", countsFor: "cs-minor", heldFrom: ECON.id }],
          estimated: false,
        },
      ];
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    };
    const side = (id: string) => $<HTMLButtonElement>(`[data-held-back-toggle="ECON-3120"] [data-counts-for-side="${id}"]`);

    it("names both programs, the one it counts for now pressed, under the line, with the hint", () => {
      setUp([layerGroup(ECON.id, "econ-ba-layer", "major"), layerGroup("cs-minor", "cs-minor-layer", "minor")]);
      const row = $('[data-program-row="cs-minor"]')!;
      const toggle = row.querySelector('[data-held-back-toggle="ECON-3120"]')!;
      expect(toggle.textContent).toBe("ECON 3120EconomicsCS minor");
      expect(toggle.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe("Which program ECON 3120 counts for");
      expect(side(ECON.id)!.getAttribute("aria-pressed")).toBe("false");
      expect(side("cs-minor")!.getAttribute("aria-pressed")).toBe("true");
      expect(side(ECON.id)!.getAttribute("aria-label")).toBe("Count ECON 3120 for Economics");
      expect(row.querySelector("[data-held-back-hint]")!.textContent).toBe(
        "Shared courses can count for either program; pick where each one goes."
      );
      // The line itself is unchanged and comes first.
      const pair = row.querySelector("[data-overlap-pair]")!;
      expect(pair.firstElementChild!.hasAttribute("data-overlap-line")).toBe(true);
    });

    it("clicking the other side runs the cap guard, then counts it for that program's layer", () => {
      setUp([layerGroup(ECON.id, "econ-ba-layer", "major"), layerGroup("cs-minor", "cs-minor-layer", "minor")]);
      act(() => side(ECON.id)!.click());
      expect(state.makeRoom).toHaveBeenCalledWith("mark", "countsFor:econ-ba-layer@ECON-3120", "yes");
      expect(state.plan.setCountsFor).toHaveBeenCalledWith("ECON-3120", "econ-ba-layer");
      expect(state.makeRoom.mock.invocationCallOrder[0]).toBeLessThan(
        state.plan.setCountsFor.mock.invocationCallOrder[0]
      );
    });

    it("the side it already counts for does nothing", () => {
      setUp([layerGroup(ECON.id, "econ-ba-layer", "major"), layerGroup("cs-minor", "cs-minor-layer", "minor")]);
      act(() => side("cs-minor")!.click());
      expect(state.makeRoom).not.toHaveBeenCalled();
      expect(state.plan.setCountsFor).not.toHaveBeenCalled();
    });

    it("no toggle when the other program's layer id can't be resolved; the line stays", () => {
      setUp([layerGroup("cs-minor", "cs-minor-layer", "minor")]);
      expect($('[data-program-row="cs-minor"] [data-overlap-line]')!.textContent).toContain(
        "ECON 3120 counts for CS minor only"
      );
      expect($("[data-held-back-toggles]")).toBeNull();
      expect($("[data-held-back-hint]")).toBeNull();
    });
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

  describe("a second major's concentrations (D2, audit #2)", () => {
    const layer = (l: Record<string, unknown>) => ({ rows: [], ...l }) as unknown as Layer;
    beforeEach(() => {
      state.plan.additionalPrograms = [{ programId: MATH.id, kind: "major" }];
      state.programLayers[MATH.id] = [
        layer({ id: MATH.id, kind: "major", name: "Mathematics", concentrations: { min: 1, max: 1 } }),
        layer({ id: `${MATH.id}--applied`, kind: "concentration", programId: MATH.id, concentrationId: "applied", name: "Applied Mathematics" }),
        layer({ id: `${MATH.id}--pure`, kind: "concentration", programId: MATH.id, concentrationId: "pure", name: "Pure Mathematics" }),
      ];
    });
    const chooser = () => $(`[data-program-row="${MATH.id}"] [data-concentration-chooser="${MATH.id}"]`);

    it("the second major's row asks for a concentration and saves the pick to the plan", () => {
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      expect(chooser()!.querySelector("[data-concentration-prompt]")!.textContent).toBe(
        "Choose a concentration to finish Mathematics"
      );
      act(() => chooser()!.querySelector<HTMLButtonElement>('[data-concentration-option="applied"]')!.click());
      expect(state.plan.setProgramConcentrations).toHaveBeenCalledWith(MATH.id, ["applied"]);
    });

    it("once chosen, one line with the pick; Change opens the pills, a swap folds it back", () => {
      state.plan.additionalPrograms = [{ programId: MATH.id, kind: "major", concentrationIds: ["pure"] }];
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      expect(chooser()!.querySelector("[data-concentration-prompt]")).toBeNull();
      expect(chooser()!.querySelector("[data-concentration-option]")).toBeNull();
      expect(chooser()!.querySelector("[data-concentration-summary]")!.textContent).toBe("Concentration: Pure Mathematics");

      act(() => chooser()!.querySelector<HTMLButtonElement>("[data-concentration-change]")!.click());
      const pure = chooser()!.querySelector<HTMLButtonElement>('[data-concentration-option="pure"]')!;
      expect(pure.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(pure);
      act(() => chooser()!.querySelector<HTMLButtonElement>('[data-concentration-option="applied"]')!.click());
      expect(state.plan.setProgramConcentrations).toHaveBeenCalledWith(MATH.id, ["applied"]);
      expect(chooser()!.querySelector("[data-concentration-option]")).toBeNull();
      expect(document.activeElement).toBe(chooser()!.querySelector("[data-concentration-change]"));
    });

    it("Done folds a multi-choice chooser back to its line", () => {
      state.plan.additionalPrograms = [{ programId: MATH.id, kind: "major", concentrationIds: ["pure", "applied"] }];
      state.programLayers[MATH.id][0] = layer({ id: MATH.id, kind: "major", name: "Mathematics", concentrations: { min: 1, max: 2 } });
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      expect(chooser()!.querySelector("[data-concentration-summary]")!.textContent).toBe(
        "Concentrations: Pure Mathematics, Applied Mathematics"
      );
      act(() => chooser()!.querySelector<HTMLButtonElement>("[data-concentration-change]")!.click());
      expect(chooser()!.querySelectorAll("[data-concentration-option]")).toHaveLength(2);
      act(() => chooser()!.querySelector<HTMLButtonElement>("[data-concentration-done]")!.click());
      expect(chooser()!.querySelector("[data-concentration-option]")).toBeNull();
    });

    it("a second major with no concentrations has no chooser", () => {
      state.programLayers[MATH.id] = state.programLayers[MATH.id].slice(0, 1);
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      expect(chooser()).toBeNull();
    });
  });

  describe("a minor not open to a major on the plan (D12, audit #3)", () => {
    it("the second-major picker disables a major a minor on the plan isn't open to", () => {
      state.minors = state.minors.map((m) => (m.id === "cs-minor" ? { ...m, notOpenTo: [MATH.id] } : m));
      state.plan.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
      render();
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      act(() => $<HTMLButtonElement>('[data-add="add-second-major"]')!.click());
      const math = $<HTMLButtonElement>(`[data-picker-row="${MATH.id}"]`)!;
      expect(math.disabled).toBe(true);
      expect(math.textContent).toContain("The CS minor isn't open to Mathematics majors");
      expect($<HTMLButtonElement>(`[data-picker-row="${GOVT.id}"]`)!.disabled).toBe(false);
    });

    it("a plan already holding the pair warns on the minor's row and segment, never a clean 6/6", () => {
      state.plan.additionalPrograms = [{ programId: "econ-minor", kind: "minor" }];
      state.progress.sections = [
        { id: ECON.id, kind: "primary", name: ECON.name, shortName: "Economics", color: null, pct: 62, satisfiedCount: 8, total: 13, status: "ok" },
        { id: "econ-minor", kind: "minor", name: "Economics", shortName: "Econ minor", color: 1, pct: 100, satisfiedCount: 6, total: 6, status: "ok" },
      ];
      render();
      expect($('[data-program-segment="econ-minor"]')!.textContent).not.toContain("6/6");
      act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
      const row = $('[data-program-row="econ-minor"]')!;
      expect(row.querySelector("[data-program-warning]")!.textContent).toBe(
        "The Econ minor isn't open to Economics majors — check with your advisor."
      );
      expect(row.textContent).not.toContain("6 of 6 done");
      expect(row.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("0");
    });
  });

  it("a refused add fills nothing and leaves the refusal toast to addProgram", () => {
    state.plan.addProgram = vi.fn(() => "cap");
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
    act(() => $<HTMLButtonElement>('[data-add="add-second-major"]')!.click());
    expect(buttonByText("Second major")!.getAttribute("aria-pressed")).toBe("true");
    act(() => $<HTMLButtonElement>(`[data-picker-row="${MATH.id}"]`)!.click());
    expect(state.plan.addProgram).toHaveBeenCalledTimes(1);
    // PlanProvider toasts its own refusals; the stack adds none of its own.
    expect(toast()).toBeFalsy();
    expect(state.plan.addTriedCourses).not.toHaveBeenCalled();
  });
});

describe("Minors you're close to (D11)", () => {
  const ranked = (id: string, name: string, classesAway: number | null, pct: number): MinorMatch => ({
    entry: { id, name, shortName: `${name} minor`, offeredBy: "Arts & Sciences", catalogYear: "2026-27" },
    pct,
    classesAway,
    requirementsLeft: classesAway ?? 3,
  });
  const openPanel = () => {
    render();
    act(() => $<HTMLButtonElement>("#program-stack-primary")!.click());
  };
  const closeRows = () =>
    [...host.querySelectorAll("[data-close-minor]")].map((r) => [r.getAttribute("data-close-minor"), r.textContent]);

  it("shows the top two proven counts of at most three, each with Try it", () => {
    state.minorMatch.matches = [
      ranked("test-minor-a", "Statistics", 1, 70),
      ranked("test-minor-b", "Computer Science", 2, 40),
      ranked("test-minor-c", "Linguistics", 3, 30),
      ranked("test-minor-d", "History", null, 90),
    ];
    openPanel();
    expect($("[data-minors-close]")!.textContent).toContain("Minors you're close to");
    expect(closeRows()).toEqual([
      ["test-minor-a", "Statistics1 class awayTry it"],
      ["test-minor-b", "Computer Science2 classes awayTry it"],
    ]);
  });

  it("nothing while the minors are being ranked, and nothing when none is close", () => {
    state.minorMatch = { ...state.minorMatch, ready: false, matches: [ranked("test-minor-a", "Statistics", 1, 70)] };
    openPanel();
    expect($("[data-minors-close]")).toBeNull();

    state.minorMatch = {
      ...state.minorMatch,
      ready: true,
      matches: [ranked("test-minor-a", "Statistics", 4, 70), ranked("test-minor-d", "History", null, 95)],
    };
    render();
    expect($('[role="dialog"][aria-label="Your programs"]')).toBeTruthy();
    expect($("[data-minors-close]")).toBeNull();
  });

  it("Try it adds the minor through the add flow and closes the panel", () => {
    state.minorMatch.matches = [ranked("test-minor-a", "Statistics", 1, 70)];
    openPanel();
    act(() => buttonByLabel("Try the Statistics minor")!.click());
    expect(state.plan.addProgram).toHaveBeenCalledWith({ programId: "test-minor-a", kind: "minor" });
    expect($('[role="dialog"]')).toBeNull();
  });

  it("at three minors Try it is off", () => {
    state.plan.additionalPrograms = [
      { programId: "cs-minor", kind: "minor" },
      { programId: "econ-minor", kind: "minor" },
      { programId: "test-minor-x", kind: "minor" },
    ];
    state.minorMatch.matches = [ranked("test-minor-a", "Statistics", 1, 70)];
    openPanel();
    expect(buttonByLabel("Try the Statistics minor")!.disabled).toBe(true);
  });
});
