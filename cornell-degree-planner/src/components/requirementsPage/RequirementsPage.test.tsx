// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import type { CatalogIndexRecord } from "@/lib/schemas";
import { ADVISE_COLLEGE, ADVISE_MAJOR, DIST, FWS, TRIED, progress, record } from "./fixtures";

// The Requirements page rendered for real against a fictional Arts & Sciences
// plan (spec 028 D8/D10/D11): outline, advisor grouping, the tried state in
// blue, the Try strip's toggles and cap, Find a class, Show on board.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  progress: null as unknown as RequirementProgress,
  triedCourseIds: [] as string[],
  index: [] as CatalogIndexRecord[],
  search: [] as { id: string; subject: string; number: string; title: string }[],
  /** Calls of the fill targets' predicates: the catalog scan's cost. */
  scanTests: 0,
}));
const plan = {
  tryCourse: vi.fn((_id: string) => true),
  untryCourse: vi.fn(),
  clearTried: vi.fn(),
  addPlacement: vi.fn((_c: unknown, _sem: number) => "new-id"),
  toggleWaivedRequirement: vi.fn(),
};
const store = {
  setHighlightedPlacementIds: vi.fn(),
  setCreditsOpen: vi.fn(),
  armCourse: vi.fn(),
  showToast: vi.fn(),
};
const navigate = vi.fn();

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => state.progress }));
// Every mock returns stable values, as the real providers do (the page's
// deferred suggestion scan keys on their identity).
const board = vi.hoisted(() => ({
  placements: [
    { id: "p1", courseId: "HIST-1200", sem: 1, order: 0 },
    { id: "p2", courseId: "ARTH-1100", sem: 1, order: 1 },
  ],
  placedCourses: {
    "HIST-1200": { id: "HIST-1200", subject: "HIST", number: "1200" },
    "ARTH-1100": { id: "ARTH-1100", subject: "ARTH", number: "1100" },
  },
  programs: [{ id: "economics", name: "Economics (BA)" }],
  programData: { slots: [], layers: [] },
  credit: { resolved: [], raw: [], college: "cas" },
  auth: { enteringYear: 2026 },
  aliases: {},
}));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    placements: board.placements,
    placedCourses: board.placedCourses,
    planProgramId: "economics",
    triedCourseIds: state.triedCourseIds,
    ...plan,
  }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: board.programs, loading: false }),
}));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => board.programData }));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => board.credit }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => board.auth }));
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ index: state.index, aliases: board.aliases, enrollmentTarget: "SP27" }),
}));
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ ...store, creditsOpen: false }),
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: "economics" }),
}));
vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: (q: string) => ({ results: q ? state.search : [], loading: false, error: null, refetch: () => {} }),
}));
const candidates = vi.hoisted(() => ({ builds: 0 }));
vi.mock("./suggestions", async (orig) => {
  const real = await orig<typeof import("./suggestions")>();
  return {
    ...real,
    buildCandidates: (...args: Parameters<typeof real.buildCandidates>) => {
      candidates.builds++;
      return real.buildCandidates(...args);
    },
  };
});
vi.mock("@/components/auth/CreditsDialog", () => ({ CreditsDialog: () => null }));
vi.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({ StudentContextQuestions: () => null }));
vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
vi.mock("@/components/requirements/useAnswerActions", () => ({ useAnswerActions: () => vi.fn(async () => {}) }));
// The fill predicates are the Classes page's (covered there); here a
// distribution category fills by roster tag, anything else by nothing.
const fillTargets = vi.hoisted(
  () => (items: { id: string; dist?: { categories?: { id: string; label: string; missing: boolean }[] } }[]) =>
    items.flatMap((it) =>
      (it.dist?.categories ?? [])
        .filter((c) => c.missing)
        .map((c) => ({
          label: c.label,
          test: (r: { attrs: string[] }) => {
            state.scanTests++;
            return r.attrs.includes(`${c.id}-AS`);
          },
        }))
    )
);
vi.mock("./useFillTargets", () => ({ useFillTargets: () => fillTargets }));

const { RequirementsPage } = await import("./RequirementsPage");

let root: Root;
let container: HTMLDivElement;

function render() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/requirements"]}>
        <RequirementsPage />
      </MemoryRouter>
    )
  );
}
const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel);
const $$ = (sel: string, from: ParentNode = document) => [...from.querySelectorAll<HTMLElement>(sel)];
const rowOf = (id: string) => $$("[data-requirement]").find((el) => el.dataset.requirement === id)!;
const tryRow = (id: string) => $$("[data-try-course]").find((el) => el.dataset.tryCourse === id)!;
function click(el: Element | null | undefined) {
  if (!el) throw new Error("missing element");
  act(() => (el as HTMLElement).click());
}
function button(from: ParentNode, label: string): HTMLButtonElement {
  const b = $$("button", from).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}"`);
  return b as HTMLButtonElement;
}

beforeEach(() => {
  state.progress = progress({ tried: TRIED });
  state.triedCourseIds = ["HIST-1530"];
  state.search = [];
  state.scanTests = 0;
  candidates.builds = 0;
  board.auth.enteringYear = 2026;
  state.index = [
    record("HIST-1530", { attrs: ["HST-AS"], roster: "SP27", title: "Intro to American History" }),
    record("HIST-2000", { attrs: ["HST-AS"], roster: "SP27", title: "Modern Europe" }),
    record("PHIL-1100", { attrs: ["ETM-AS"], roster: "SP27", title: "Intro to Philosophy" }),
  ];
  for (const f of [...Object.values(plan), ...Object.values(store), navigate]) f.mockClear();
  plan.tryCourse.mockImplementation(() => true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RequirementsPage", () => {
  it("has a one-line header and an outline built from the groups", () => {
    render();
    expect($("[data-requirements-page]")).not.toBeNull();
    expect($("h1")!.textContent).toBe("Requirements · Economics (BA)");
    expect($("[data-requirements-done]")!.textContent).toContain("0 of 4 done");
    const outline = $$("[data-outline-group]").map((el) => el.dataset.outlineGroup);
    expect(outline).toEqual([
      "credit",
      "cas-college:Writing seminars",
      "cas-college:Distribution",
      "econ:Core",
      "advisor",
    ]);
    const dist = $$("[data-outline-group]").find((el) => el.dataset.outlineGroup === "cas-college:Distribution")!;
    expect(dist.textContent).toBe("Distribution1 of 3 +1");
    expect($("[data-credit-card]")!.textContent).toContain("None yet · Add credit");
  });

  it("collects advisor rows in one collapsed card, never in the other groups", () => {
    render();
    const advisor = $("[data-advisor-card]")!;
    expect(advisor.textContent).toContain("Check with your advisor (2)");
    expect(rowOf(ADVISE_COLLEGE.id)).toBeUndefined();
    click(button(advisor, "Check with your advisor (2)"));
    const inAdvisor = $$("[data-requirement]", advisor).map((el) => el.dataset.requirement);
    expect(inAdvisor).toEqual([ADVISE_COLLEGE.id, ADVISE_MAJOR.id]);
    const elsewhere = $$("[data-group-card]:not([data-advisor-card]) [data-requirement]").map((el) => el.dataset.requirement);
    expect(elsewhere).not.toContain(ADVISE_COLLEGE.id);
    expect(elsewhere).not.toContain(ADVISE_MAJOR.id);
  });

  it("shows tried classes in blue without marking the row met", () => {
    render();
    const row = rowOf(DIST.id);
    expect(row.dataset.status).toBe("partial");
    expect($("[data-tried-delta]", row)!.textContent).toBe("+1 category if you take what you're trying");
    const hst = $$("[data-category]", row).find((el) => el.dataset.category === "HST")!;
    expect(hst.dataset.filled).toBe("false");
    expect(hst.dataset.tried).toBe("true");
    expect($("[data-tried-course]", row)!.textContent).toBe("HIST 1530 · trying");
    // No tried line on a row the tried class doesn't touch.
    expect($("[data-tried-delta]", rowOf(FWS.id))).toBeNull();
  });

  it("Try / Trying ✓ toggles call tryCourse / untryCourse", () => {
    render();
    const strip = $$("[data-try-strip]")[0];
    expect(strip).toBeDefined();
    // The class being tried is listed first; a suggestion fills an open category.
    click(button(tryRow("HIST-1530"), "Trying ✓"));
    expect(plan.untryCourse).toHaveBeenCalledWith("HIST-1530");
    const suggestion = tryRow("HIST-2000");
    expect(suggestion.textContent).toContain("Fills Historical");
    click(button(suggestion, "Try"));
    expect(plan.tryCourse).toHaveBeenCalledWith("HIST-2000");
  });

  it("at the cap, Try is disabled and says why", () => {
    state.triedCourseIds = Array.from({ length: 20 }, (_, i) => `TEST-${1000 + i}`);
    state.progress = progress();
    render();
    expect($("[data-try-cap]")!.textContent).toBe("Up to 20 classes at a time");
    expect(button(tryRow("HIST-2000"), "Try").disabled).toBe(true);
  });

  it("+ <enrollment term> places the class in that semester", () => {
    render();
    click(button(tryRow("HIST-2000"), "+ Spring 2027"));
    expect(plan.addPlacement).toHaveBeenCalledWith(expect.objectContaining({ id: "HIST-2000" }), 2);
    expect(store.showToast).toHaveBeenCalledWith("HIST 2000 added to Spring 2027", expect.anything());
  });

  it("Find a class opens Classes with Counts toward set", () => {
    render();
    click($("[data-find-class]", rowOf(FWS.id)));
    expect(navigate).toHaveBeenCalledWith("/classes?countsToward=cas-college%3Afws");
  });

  it("Show on board lights the covering cards and goes to the planner", () => {
    render();
    click($("[data-show-on-board]", rowOf(FWS.id)));
    expect(store.setHighlightedPlacementIds).toHaveBeenCalledWith(["p1"]);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("names the board course on the row", () => {
    render();
    expect(rowOf(FWS.id).textContent).toContain("1 of 2 courses: HIST 1200");
  });

  it("+ <term> with no board column for that term arms the class and goes to the board (audit F4)", () => {
    // Entering 2021: Spring 2027 is semester 12, past the board's columns.
    board.auth.enteringYear = 2021;
    render();
    const add = button(tryRow("HIST-2000"), "Place on board");
    click(add);
    expect(plan.addPlacement).not.toHaveBeenCalled();
    expect(store.armCourse).toHaveBeenCalledWith(expect.objectContaining({ id: "HIST-2000" }), null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("lists the classes being tried near the header, each removable, with Clear (audit F2)", () => {
    state.triedCourseIds = ["HIST-1530", "PHIL-1100"];
    render();
    const line = $("[data-tried-line]")!;
    expect(line.textContent).toContain("Classes you're trying (2)");
    expect($$("[data-tried-chip]", line).map((el) => el.textContent)).toEqual(["HIST 1530", "PHIL 1100"]);
    click($("button[aria-label='Stop trying PHIL 1100']", line));
    expect(plan.untryCourse).toHaveBeenCalledWith("PHIL-1100");
    click($("[data-tried-clear-all]", line));
    expect(plan.clearTried).toHaveBeenCalledTimes(1);
  });

  it("no tried line when nothing is tried", () => {
    state.triedCourseIds = [];
    state.progress = progress();
    render();
    expect($("[data-tried-line]")).toBeNull();
  });

  it("a search result already on the board says so and offers no Try (audit F2)", () => {
    state.search = [{ id: "HIST-1200", subject: "HIST", number: "1200", title: "On the board" }];
    state.index = [...state.index, record("HIST-1200", { attrs: ["HST-AS"], roster: "SP27" })];
    render();
    const strip = $$("[data-try-strip]")[0];
    const input = $<HTMLInputElement>("input[type='search']", strip)!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "HIST 1200");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const row = tryRow("HIST-1200");
    expect($("[data-on-board]", row)!.textContent).toBe("On your board");
    expect($$("button", row).map((b) => b.textContent)).toEqual([]);
  });

  it("toggling Try never rescans the catalog: no new candidate index, no new scan (audit P1)", () => {
    render();
    expect(candidates.builds).toBe(1);
    const scanned = state.scanTests;
    expect(scanned).toBeGreaterThan(0);
    expect(tryRow("HIST-2000")).toBeDefined();
    // The student tries HIST 2000: the plan's list changes, the board doesn't.
    state.triedCourseIds = ["HIST-1530", "HIST-2000"];
    render();
    expect(candidates.builds).toBe(1);
    expect(state.scanTests).toBe(scanned);
    // Picked out after the scan: no longer offered as a suggestion.
    expect(tryRow("HIST-2000")).toBeUndefined();
  });

  it("a notice replaces the groups", () => {
    state.progress = progress({ notice: { kind: "needs-entry-term" }, groups: [] });
    render();
    expect($("[data-requirement-notice='needs-entry-term']")).not.toBeNull();
    expect($$("[data-requirement]")).toHaveLength(0);
  });
});
