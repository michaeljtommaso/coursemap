// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";

// The rail's Still needed lines (spec 028 D9), rendered for real: one line per
// group, the board link on click, the credit line, notices, tried +N.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  progress: null as unknown as RequirementProgress,
  resolved: [] as unknown[],
  highlighted: [] as string[],
}));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => state.progress }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({ planProgramId: "econ", untryCourse: vi.fn(), clearTried: vi.fn() }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: [{ id: "econ", name: "Economics (BA)", short_name: "Economics" }] }),
}));
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({ resolved: state.resolved, raw: [], college: "cas" }),
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: "econ" }),
}));
const setHighlighted = vi.fn((ids: string[]) => {
  state.highlighted = ids;
});
const requestCatalogSearch = vi.fn();
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      highlightedPlacementIds: state.highlighted,
      setHighlightedPlacementIds: setHighlighted,
      requestCatalogSearch,
      armCourse: vi.fn(),
    }),
}));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ enteringYear: 2026 }) }));
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ index: [], courseDetails: {}, aliases: {}, enrollmentTarget: null }),
}));

const { RailStillNeeded } = await import("./RailStillNeeded");

function item(id: string, over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    id,
    label: id,
    category: null,
    suggestedSem: null,
    status: "unmet",
    coveredBy: [],
    checkable: true,
    requirement: null,
    ...over,
  };
}
const dist = (over: Partial<NonNullable<RequirementItem["dist"]>>) => ({
  layerId: "cas-college",
  rowId: "r",
  layerKind: "college" as const,
  rowKind: "seat" as const,
  engineStatus: "unmet" as const,
  countedCodes: [],
  ...over,
});

const fws = item("cas-college:fws", {
  label: "First-year writing seminars",
  status: "partial",
  coveredBy: ["p-hist"],
  dist: dist({ rowKind: "pool", coursesHave: 1, coursesNeed: 2 }),
});
const intro = item("econ:intro", {
  status: "satisfied",
  coveredBy: ["p-1110", "p-1120"],
  dist: dist({ layerId: "econ", layerKind: "major" }),
});
const distRow = item("cas-college:dist", {
  status: "partial",
  coveredBy: ["p-1110"],
  dist: dist({ rowKind: "distribution", categoriesHave: 4, categoriesNeed: 10 }),
});

function progress(over: Partial<RequirementProgress> = {}): RequirementProgress {
  return {
    engine: "distribution",
    attribution: {},
    satisfiedCount: 1,
    total: 3,
    groups: [
      { key: "cas-college:Writing", label: "College · Writing", items: [fws], satisfiedCount: 0, total: 1 },
      { key: "cas-college:Distribution", label: "College · Distribution", items: [distRow], satisfiedCount: 0, total: 1 },
      { key: "econ:Introductory", label: "Major · Introductory", items: [intro], satisfiedCount: 1, total: 1 },
      {
        key: "econ:Approvals",
        label: "Major · Approvals",
        items: [item("econ:ok", { checkable: false, dist: dist({ rowKind: "confirm", confirm: true }) })],
        satisfiedCount: 0,
        total: 0,
      },
    ],
    ...over,
  };
}

let root: Root;
let container: HTMLDivElement;
let path = "/";
function render() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RailStillNeeded columnSems={[1, 2]} />} />
          <Route path="/requirements" element={<p data-at-requirements>requirements page</p>} />
        </Routes>
      </MemoryRouter>
    )
  );
  path = container.querySelector("[data-at-requirements]") ? "/requirements" : "/";
}
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const line = (key: string) => $(`[data-rail-group][data-group-key="${key}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error("missing element");
  act(() => (el as HTMLElement).click());
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.progress = progress();
  state.resolved = [];
  state.highlighted = [];
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RailStillNeeded", () => {
  it("one line per group with its count; advisor-only groups left out", () => {
    render();
    const keys = [...container.querySelectorAll("[data-rail-group]")].map((el) => el.getAttribute("data-group-key"));
    expect(keys).toEqual(["cas-college:Writing", "cas-college:Distribution", "econ:Introductory"]);
    expect(line("cas-college:Writing")!.textContent).toBe("Writing1 of 2");
    expect(line("cas-college:Distribution")!.textContent).toBe("Distribution4 of 10");
    expect(line("econ:Introductory")!.textContent).toBe("Introductory1 of 1");
    expect($("[data-rail-all-requirements]")!.getAttribute("href")).toBe("/requirements");
  });

  it("a line with an open row lights what counts and opens the catalog for that row", () => {
    render();
    click(line("cas-college:Writing"));
    expect(setHighlighted).toHaveBeenLastCalledWith(["p-hist"]);
    expect(requestCatalogSearch).toHaveBeenCalledWith("", {
      requirementId: "cas-college:fws",
      requirementLabel: "First-year writing seminars",
    });
  });

  it("a finished line toggles its cards' highlight; Esc clears it", () => {
    render();
    click(line("econ:Introductory"));
    expect(setHighlighted).toHaveBeenLastCalledWith(["p-1110", "p-1120"]);
    expect(requestCatalogSearch).not.toHaveBeenCalled();
    render(); // re-read the store
    expect(line("econ:Introductory")!.getAttribute("aria-pressed")).toBe("true");
    click(line("econ:Introductory"));
    expect(setHighlighted).toHaveBeenLastCalledWith([]);

    state.highlighted = ["p-1110", "p-1120"];
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(setHighlighted).toHaveBeenLastCalledWith([]);
  });

  it("shows Credit before Cornell when credit earns something, linking to the page", () => {
    render();
    expect(line("credit")).toBeNull();
    state.resolved = [
      { id: "exam:ap-calculus-bc", kind: "ap", label: "AP Calculus BC", satisfiesCourseIds: ["MATH-1110"], credits: 4 },
      { id: "exam:ap-chemistry", kind: "ap", label: "AP Chemistry", satisfiesCourseIds: ["CHEM-2070"], credits: 4 },
    ];
    render();
    expect(line("credit")!.textContent).toBe("Credit before Cornell8 cr");
    click(line("credit"));
    path = container.querySelector("[data-at-requirements]") ? "/requirements" : "/";
    expect(path).toBe("/requirements");
  });

  it("a notice is one line to the Requirements page instead of rows", () => {
    state.progress = progress({ groups: [], notice: { kind: "needs-entry-term" } });
    render();
    const notice = $('[data-rail-notice="needs-entry-term"]')!;
    expect(notice.getAttribute("href")).toBe("/requirements");
    expect(container.querySelectorAll('[data-rail-group]:not([data-group-key="credit"])')).toHaveLength(0);
  });

  it("an unpicked concentration is one line above the group lines", () => {
    state.progress = progress({
      concentrations: { min: 1, max: 1, options: [], chosen: [], needed: true },
    });
    render();
    expect($('[data-rail-notice="needs-concentration"]')!.textContent).toContain("Pick your concentration");
    expect(line("cas-college:Writing")).not.toBeNull();
  });

  it("tried classes add a blue +N and show the reminder under the lines", () => {
    state.progress = progress({
      tried: {
        courseIds: ["PHIL-1100"],
        notOnBoard: ["PHIL-1100"],
        items: { "cas-college:dist": { ...distRow, dist: dist({ rowKind: "distribution", categoriesHave: 5, categoriesNeed: 10 }) } },
        fills: { "PHIL-1100": ["Ethics & Mind"] },
        missing: [],
      },
    });
    render();
    expect(line("cas-college:Distribution")!.querySelector("[data-tried-plus]")!.textContent).toBe(" +1");
    expect(line("cas-college:Writing")!.querySelector("[data-tried-plus]")).toBeNull();
    expect($("[data-tried-reminder] [data-tried-item='PHIL-1100']")).not.toBeNull();
  });
});
