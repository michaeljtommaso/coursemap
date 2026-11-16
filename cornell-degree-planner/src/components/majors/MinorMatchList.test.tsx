// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { Layer, Row } from "@/lib/planner/distribution/types";
import type { Course, Program } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { ProgramData } from "@/contexts/ProgramProvider";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import { useProgramStore } from "@/store/useProgramStore";

// Spec 047 D11: the Minors tab, through the real useMinorMatch and ranking,
// with the loaders (minor index, minor layers, program data) mocked. Every
// program id below is fictional.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };
const PRIMARY = "test-cas-econ";

function course(id: string, credits = 3): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: id,
    credits_min: credits,
    credits_max: credits,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
}

const seat = (id: string, c: string): Row => ({ id, kind: "seat", label: id, group: "Core", source: SRC, rule: { course: [c] } });

function minor(id: string, rows: Row[]): Layer {
  return { id, kind: "minor", family: "other", name: id, catalogYear: "2026-27", programId: id, rows };
}

const ECON_MAJOR: Layer = {
  id: PRIMARY,
  kind: "major",
  family: "cas",
  name: "Test Economics",
  catalogYear: "2026-27",
  programId: PRIMARY,
  rows: [seat("intro", "ECON-1110")],
};

const program: Program = {
  id: PRIMARY,
  name: "Economics, B.A.",
  short_name: "Economics",
  college: "College of Arts and Sciences",
  catalog_year: 2026,
  total_credits: null,
  affiliation_text: null,
  created_at: "",
  collegeId: "cas",
  family: "cas",
};

const entry = (id: string, name: string, over: Partial<MinorIndexEntry> = {}): MinorIndexEntry => ({
  id,
  name,
  shortName: `${name} minor`,
  offeredBy: "Arts & Sciences",
  catalogYear: "2026-27",
  ...over,
});

const state = {} as {
  entries: MinorIndexEntry[];
  layers: Record<string, Layer>;
  placements: Placement[];
  placed: Record<string, Course>;
  additional: AdditionalProgram[];
  addProgram: ReturnType<typeof vi.fn>;
  minorIndexEnabled: boolean[];
  layerLists: string[][];
};

// Stable, as ProgramProvider's are (useCallback + a cache by id).
const PRIMARY_DATA = { slots: [], layers: [ECON_MAJOR] } as ProgramData;
const loadProgramData = (id: string) => Promise.resolve(id === PRIMARY ? PRIMARY_DATA : null);
const PROGRAMS = [program];
vi.mock("@/contexts/ProgramProvider", () => ({
  useProgramContext: () => ({
    programs: PROGRAMS,
    programsLoading: false,
    loadProgramData,
    getProgramData: () => undefined,
  }),
}));
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ aliases: {}, courseDetails: {}, index: [] }),
}));
vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({
    studentContext: { college: "cas", entryTerm: null, transfer: null, transferStanding: null },
    enteringYear: null,
  }),
}));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => ({ resolved: [] }) }));
vi.mock("@/hooks/useEnrichedPlan", () => ({ useEnrichedPlan: () => ({ enrichedCourses: state.placed }) }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    planId: "plan-1",
    placements: state.placements,
    waivedRequirementIds: [],
    additionalPrograms: state.additional,
    addProgram: state.addProgram,
    removeProgram: vi.fn(),
    addTriedCourses: vi.fn(() => ({ added: [] })),
  }),
}));
const NO_PROGRESS: RequirementProgress = { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
vi.mock("@/hooks/useRequirementProgress", () => ({
  useStudentAnswers: () => ({ marks: {}, facts: {} }),
  useRequirementProgress: () => NO_PROGRESS,
}));
// The loaders: the minor index and each minor's layer, by id.
vi.mock("@/hooks/useAdditionalProgramData", () => ({
  useMinorIndex: (enabled = true) => {
    state.minorIndexEnabled.push(enabled);
    return enabled ? { entries: state.entries, status: "ok" } : { entries: [], status: "loading" };
  },
  useAdditionalProgramData: (list: AdditionalProgram[]) => {
    state.layerLists.push(list.map((p) => p.programId));
    const programs = list.map((p) => {
      const layer = state.layers[p.programId];
      return {
        programId: p.programId,
        kind: p.kind,
        name: p.programId,
        shortName: p.programId,
        layers: layer ? [layer] : [],
        status: layer ? "ok" : "unavailable",
      };
    });
    return { programs, allLoaded: true };
  },
}));

const { MinorMatchList } = await import("./MinorMatchList");

let root: Root;
let host: HTMLElement;
const render = async (enabled = true) => {
  await act(async () => {
    root.render(<MinorMatchList cards={[]} enabled={enabled} />);
  });
  // The primary's data resolves in an effect; let it land.
  await act(async () => {
    await Promise.resolve();
  });
};
const rows = () =>
  [...host.querySelectorAll<HTMLElement>("[data-minor-row]")].map((r) => [
    r.getAttribute("data-minor-row"),
    r.querySelector("[data-minor-standing]")?.textContent,
  ]);

beforeEach(() => {
  state.entries = [
    entry("test-minor-stats", "Statistics"),
    entry("test-minor-cs", "Computer Science"),
    entry("test-minor-total", "Writing"),
    entry("test-minor-econ", "Economics", { notOpenTo: [PRIMARY] }),
    entry("test-minor-only", "Only Others", { onlyOpenTo: ["test-other-major-bs"] }),
    entry("test-minor-hidden", "Hidden", { visible: false }),
  ];
  state.layers = {
    "test-minor-stats": minor("test-minor-stats", [seat("a", "STAT-2000"), seat("b", "STAT-3000")]),
    "test-minor-cs": minor("test-minor-cs", [seat("a", "CS-1110"), seat("b", "CS-2110"), seat("c", "CS-3110")]),
    "test-minor-total": minor("test-minor-total", [
      seat("a", "STAT-2000"),
      { id: "total", kind: "credits", label: "12 credits", group: "Total", source: SRC, rule: { subject: ["ENGL"] }, requiredCredits: 12 },
    ]),
    "test-minor-econ": minor("test-minor-econ", [seat("a", "ECON-1110")]),
  };
  state.placements = [{ id: "p1", courseId: "STAT-2000", sem: 1, order: 0 }];
  state.placed = { "STAT-2000": course("STAT-2000") };
  state.additional = [];
  state.addProgram = vi.fn(() => "added");
  state.minorIndexEnabled = [];
  state.layerLists = [];
  useProgramStore.setState({ selectedProgramId: PRIMARY });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MinorMatchList (the Minors tab)", () => {
  it("ranks the minors the student can take: proven counts first, then the percent", async () => {
    await render();
    expect(rows()).toEqual([
      ["test-minor-stats", "1 class away"],
      ["test-minor-cs", "3 classes away"],
      // An unmet credit total can't prove a count: the percent instead.
      ["test-minor-total", "50% done"],
    ]);
    // notOpenTo the primary, onlyOpenTo other majors, and hidden minors are
    // never listed or loaded.
    expect(state.layerLists.flat()).not.toContain("test-minor-econ");
    expect(state.layerLists.flat()).not.toContain("test-minor-only");
    expect(state.layerLists.flat()).not.toContain("test-minor-hidden");
    expect(host.querySelector('[data-minor-row="test-minor-stats"]')!.textContent).toContain("Arts & Sciences");
  });

  it("Try it adds the minor through the add flow", async () => {
    await render();
    act(() => host.querySelector<HTMLButtonElement>('[data-try-minor="test-minor-cs"]')!.click());
    expect(state.addProgram).toHaveBeenCalledWith({ programId: "test-minor-cs", kind: "minor" });
  });

  it("a minor already on the plan isn't listed; at three minors Try it is off", async () => {
    state.additional = [
      { programId: "test-minor-stats", kind: "minor" },
      { programId: "test-minor-a", kind: "minor" },
      { programId: "test-minor-b", kind: "minor" },
    ];
    state.layers["test-minor-a"] = minor("test-minor-a", [seat("a", "MATH-1110")]);
    state.layers["test-minor-b"] = minor("test-minor-b", [seat("a", "MATH-2210")]);
    await render();
    expect(rows().map(([id]) => id)).toEqual(["test-minor-cs", "test-minor-total"]);
    expect(host.querySelector<HTMLButtonElement>('[data-try-minor="test-minor-cs"]')!.disabled).toBe(true);
  });

  it("disabled (drawer collapsed): reads nothing, shows the loading rows", async () => {
    await render(false);
    expect(state.minorIndexEnabled.every((e) => e === false)).toBe(true);
    expect(state.layerLists.every((l) => l.length === 0)).toBe(true);
    expect(host.querySelector("[data-minor-match-loading]")).toBeTruthy();
  });

  it("the blank canvas asks for a major first", async () => {
    useProgramStore.setState({ selectedProgramId: "blank" });
    await render();
    expect(host.textContent).toContain("Choose a major first");
    expect(state.layerLists.every((l) => l.length === 0)).toBe(true);
  });
});
