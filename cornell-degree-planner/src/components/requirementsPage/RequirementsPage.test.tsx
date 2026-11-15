// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { TrySearchProps } from "./TrySearch";
import type { CreditTableProps } from "./CreditTable";
import { ADVISE_COLLEGE, ADVISE_MAJOR, CORE, DIST, FWS, GROUPS, TRIED, item, progress, record } from "./fixtures";

// The Requirements page rendered for real against a fictional Arts & Sciences
// plan (spec 045, after spec 028): group tables with the outline, the side
// panel (its actions, its class suggestions, Esc), the advisor group, the
// tried state in blue, the narrow layout (D9), and the wiring of the header
// search and the credit table (stubbed here: they have their own tests).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  progress: null as unknown as RequirementProgress,
  triedCourseIds: [] as string[],
  index: [] as CatalogIndexRecord[],
  /** Calls of the fill targets' predicates: the catalog scan's cost. */
  scanTests: 0,
  /** matchMedia("(min-width: 1280px)"). */
  wide: true,
  trySearch: null as TrySearchProps | null,
  creditTable: null as CreditTableProps | null,
  waived: [] as string[],
  marks: {} as Record<string, "yes" | "no" | number>,
  additionalPrograms: [] as { programId: string; kind: "major" | "minor"; concentrationIds?: string[] }[],
  minors: [] as { id: string; name: string; shortName: string; offeredBy: string; catalogYear: string; notOpenTo?: string[] }[],
}));
const plan = {
  tryCourse: vi.fn((_id: string) => true),
  untryCourse: vi.fn(),
  clearTried: vi.fn(),
  addPlacement: vi.fn((_c: unknown, _sem: number) => "new-id"),
  toggleWaivedRequirement: vi.fn(),
  setCountsFor: vi.fn(),
  pruneOrphans: vi.fn((_ids: string[]) => 0),
  setProgramConcentrations: vi.fn(),
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
// Every mock returns stable values, as the real providers do (the panel's
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
    waivedRequirementIds: state.waived,
    courseMarks: state.marks,
    additionalPrograms: state.additionalPrograms,
    ...plan,
  }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: board.programs, loading: false }),
}));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => board.programData }));
vi.mock("@/hooks/useAdditionalProgramData", () => ({
  useMinorIndex: () => ({ entries: state.minors, status: "ok" }),
}));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => board.credit }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => board.auth }));
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ index: state.index, aliases: board.aliases, enrollmentTarget: "SP27" }),
}));
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ ...store, creditsOpen: false, reqPanelWidth: null, setReqPanelWidth: () => {} }),
  REQ_PANEL_MIN: 320,
  REQ_PANEL_MAX: 720,
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: "economics" }),
}));
vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: () => ({ results: [], loading: false, error: null, refetch: () => {} }),
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
vi.mock("./TrySearch", () => ({
  TrySearch: (p: TrySearchProps) => {
    state.trySearch = p;
    return <div data-try-search data-compact={p.compact ? "true" : "false"} />;
  },
}));
vi.mock("./CreditTable", () => ({
  CreditTable: (p: CreditTableProps) => {
    state.creditTable = p;
    return <section id="rq-card-credit" data-group-card="credit" data-credit-card />;
  },
}));
vi.mock("@/components/auth/CreditsDialog", () => ({ CreditsDialog: () => null }));
vi.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
vi.mock("@/components/tour/TourOverlay", () => ({ TourOverlay: () => null }));
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
const panel = () => $("[data-requirement-panel]");
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
const select = (id: string) => click($("[data-row-select]", rowOf(id)));
const esc = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

beforeEach(() => {
  state.progress = progress({ tried: TRIED });
  state.triedCourseIds = ["HIST-1530"];
  state.scanTests = 0;
  state.wide = true;
  state.trySearch = null;
  state.creditTable = null;
  state.waived = [];
  state.marks = {};
  state.additionalPrograms = [];
  state.minors = [];
  board.programData = { slots: [], layers: [] };
  candidates.builds = 0;
  board.auth.enteringYear = 2026;
  state.index = [
    record("HIST-1530", { attrs: ["HST-AS"], roster: "SP27", title: "Intro to American History" }),
    record("HIST-2000", { attrs: ["HST-AS"], roster: "SP27", title: "Modern Europe" }),
    record("PHIL-1100", { attrs: ["ETM-AS"], roster: "SP27", title: "Intro to Philosophy" }),
  ];
  for (const f of [...Object.values(plan), ...Object.values(store), navigate]) f.mockClear();
  plan.tryCourse.mockImplementation(() => true);
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 1280px)" ? state.wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RequirementsPage — layout", () => {
  it("the app's type scale, the header search, the outline, then credit and one table per group", () => {
    render();
    const page = $("[data-requirements-page]")!;
    expect(page.className).not.toContain("type-roomy");
    expect($("h1")!.textContent).toBe("Requirements · Economics (BA)");
    expect($("header [data-try-search]")).not.toBeNull();
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
    const cards = $$("main [data-group-card]").map((el) => el.dataset.groupCard);
    expect(cards).toEqual(["credit", "cas-college:Writing seminars", "cas-college:Distribution", "econ:Core", "advisor"]);
    // No newspaper columns.
    expect(document.body.innerHTML).not.toContain("columns-2");
  });

  it("collects advisor rows in one collapsed group, never in the other groups", () => {
    render();
    const advisor = $("[data-advisor-card]")!;
    expect(advisor.textContent).toContain("Check with your advisor (2)");
    expect(rowOf(ADVISE_COLLEGE.id)).toBeUndefined();
    click($$("button", advisor).find((b) => b.textContent?.includes("Check with your advisor (2)")));
    const inAdvisor = $$("[data-requirement]", advisor).map((el) => el.dataset.requirement);
    expect(inAdvisor).toEqual([ADVISE_COLLEGE.id, ADVISE_MAJOR.id]);
    const elsewhere = $$("[data-group-card]:not([data-advisor-card]) [data-requirement]").map((el) => el.dataset.requirement);
    expect(elsewhere).not.toContain(ADVISE_COLLEGE.id);
    // An advisor row opens the panel with its note and Looks wrong? only.
    select(ADVISE_MAJOR.id);
    expect(panel()!.textContent).toContain("Check with your advisor");
    expect($("[data-show-on-board]", panel()!)).toBeNull();
    expect($("[data-waive]", panel()!)).toBeNull();
    expect($("[data-report-row]", panel()!)).not.toBeNull();
  });

  it("shows tried classes as a blue +1 on the row without marking it met", () => {
    render();
    const row = rowOf(DIST.id);
    expect(row.dataset.status).toBe("partial");
    expect($("[data-row-tried]", row)!.textContent).toContain("+1");
    expect($("[data-row-tried]", rowOf(FWS.id))).toBeNull();
    select(DIST.id);
    expect($("[data-tried-delta]", panel()!)!.textContent).toBe("+1 category if you take what you're trying");
    const hst = $$("[data-category]", panel()!).find((el) => el.dataset.category === "HST")!;
    expect(hst.dataset.filled).toBe("false");
    expect(hst.dataset.tried).toBe("true");
  });

  it("names the board course on the row and in the panel", () => {
    render();
    expect(rowOf(FWS.id).textContent).toContain("HIST 1200");
    select(FWS.id);
    expect(panel()!.textContent).toContain("1 of 2 courses: HIST 1200");
  });

  it("a notice replaces the groups", () => {
    state.progress = progress({ notice: { kind: "needs-entry-term" }, groups: [] });
    render();
    expect($("[data-requirement-notice='needs-entry-term']")).not.toBeNull();
    expect($$("[data-requirement]")).toHaveLength(0);
    expect($("[data-credit-card]")).not.toBeNull();
  });
});

describe("RequirementsPage — the side panel (D3)", () => {
  it("a click selects the row and opens the panel; ✕, Esc and a second click close it", () => {
    render();
    expect(panel()).toBeNull();
    select(FWS.id);
    const sel = $("[data-row-select]", rowOf(FWS.id))!;
    expect(sel.getAttribute("aria-expanded")).toBe("true");
    expect(panel()!.id).toBe(sel.getAttribute("aria-controls"));
    expect(panel()!.dataset.requirementPanel).toBe(FWS.id);
    expect(document.activeElement).toBe(panel());

    esc();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe($("[data-row-select]", rowOf(FWS.id)));

    select(FWS.id);
    click($("button[aria-label='Close details']", panel()!));
    expect(panel()).toBeNull();

    select(FWS.id);
    select(FWS.id);
    expect(panel()).toBeNull();
  });

  it("Search all classes opens Classes with Counts toward set", () => {
    render();
    select(FWS.id);
    click($("[data-find-class]", panel()!));
    expect(navigate).toHaveBeenCalledWith("/classes?countsToward=cas-college%3Afws");
  });

  it("Show on board lights the covering cards and goes to the planner", () => {
    render();
    select(FWS.id);
    click($("[data-show-on-board]", panel()!));
    expect(store.setHighlightedPlacementIds).toHaveBeenCalledWith(["p1"]);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("Waive toggles the waiver", () => {
    render();
    select(CORE.id);
    click($("[data-waive]", panel()!));
    expect(plan.toggleWaivedRequirement).toHaveBeenCalledWith(CORE.id);
  });

  it("classes that would fill this row: Try / Trying ✓ call tryCourse / untryCourse", () => {
    render();
    select(DIST.id);
    const list = $("[data-panel-suggestions]", panel()!)!;
    // The class being tried is listed first; a suggestion fills an open category.
    click(button(tryRow("HIST-1530"), "Trying ✓"));
    expect(plan.untryCourse).toHaveBeenCalledWith("HIST-1530");
    const suggestion = tryRow("HIST-2000");
    expect(list.contains(suggestion)).toBe(true);
    expect(suggestion.textContent).toContain("Fills Historical");
    click(button(suggestion, "Try"));
    expect(plan.tryCourse).toHaveBeenCalledWith("HIST-2000");
  });

  it("at the cap, Try is disabled and says why", () => {
    state.triedCourseIds = Array.from({ length: 20 }, (_, i) => `TEST-${1000 + i}`);
    state.progress = progress();
    render();
    select(DIST.id);
    expect($("[data-try-cap]", panel()!)!.textContent).toBe("Up to 20 classes at a time");
    expect(button(tryRow("HIST-2000"), "Try").disabled).toBe(true);
  });

  it("+ <enrollment term> places the class in that semester", () => {
    render();
    select(DIST.id);
    click(button(tryRow("HIST-2000"), "+ Spring 2027"));
    expect(plan.addPlacement).toHaveBeenCalledWith(expect.objectContaining({ id: "HIST-2000" }), 2);
    expect(store.showToast).toHaveBeenCalledWith("HIST 2000 added to Spring 2027", expect.anything());
  });

  it("+ <term> with no board column for that term arms the class and goes to the board (audit F4)", () => {
    // Entering 2021: Spring 2027 is semester 12, past the board's columns.
    board.auth.enteringYear = 2021;
    render();
    select(DIST.id);
    click(button(tryRow("HIST-2000"), "Place on board"));
    expect(plan.addPlacement).not.toHaveBeenCalled();
    expect(store.armCourse).toHaveBeenCalledWith(expect.objectContaining({ id: "HIST-2000" }), null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("the scan runs only for the open panel, and toggling Try never rescans (audit P1)", () => {
    render();
    expect(candidates.builds).toBe(1);
    expect(state.scanTests).toBe(0);
    select(DIST.id);
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

  it("the header's question count opens the panel on the first row with a question, its form open", () => {
    const asked: RequirementItem = {
      ...CORE,
      dist: {
        ...CORE.dist!,
        questions: [
          {
            key: "mark:ECON-3130:core",
            scope: "mark",
            prompt: "Did your advisor approve ECON 3130 here?",
            detail: "",
            input: { kind: "yesno" },
            courseCode: "ECON 3130",
          },
        ],
      },
    };
    state.progress = progress({
      groups: GROUPS.map((g) => (g.key === "econ:Core" ? { ...g, items: [asked, ADVISE_MAJOR] } : g)),
      openQuestionCount: 1,
    });
    render();
    click($("[data-question-count]"));
    expect(panel()!.dataset.requirementPanel).toBe(CORE.id);
    expect($("[data-question-form='mark:ECON-3130:core']", panel()!)).not.toBeNull();
  });

  it("Esc closes the ⓘ popover only; the next Esc closes the panel", () => {
    render();
    select(FWS.id);
    const info = $<HTMLButtonElement>("button[aria-label='About these requirements']")!;
    click(info);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    const realEsc = () =>
      act(
        () =>
          void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
      );
    realEsc();
    expect(info.getAttribute("aria-expanded")).toBe("false");
    expect(panel()).not.toBeNull();
    realEsc();
    expect(panel()).toBeNull();
  });

  it("closing on a row that folded away returns focus to its group's fold line, not the group's first button", () => {
    const open = item("econ:core1", { label: "ECON 1110" }, { layerKind: "major", engineStatus: "unmet" });
    const nearly = item(
      "econ:core2",
      { label: "ECON 1120", status: "partial" },
      { layerKind: "major", engineStatus: "partial" }
    );
    const withCore = (items: RequirementItem[]) =>
      progress({ groups: GROUPS.map((g) => (g.key === "econ:Core" ? { ...g, items } : g)) });
    state.progress = withCore([open, nearly]);
    render();
    select(nearly.id);
    // Finished while selected: it stays in the table until the panel closes.
    state.progress = withCore([open, { ...nearly, status: "satisfied", dist: { ...nearly.dist!, engineStatus: "met" } }]);
    render();
    expect(rowOf(nearly.id)).toBeDefined();
    esc();
    expect(panel()).toBeNull();
    expect($$("[data-requirement]").some((el) => el.dataset.requirement === nearly.id)).toBe(false);
    expect(document.activeElement?.hasAttribute("data-fold-toggle")).toBe(true);
  });

  it("a selected row that disappears drops the selection: the panel doesn't reopen when the row returns", () => {
    render();
    select(FWS.id);
    expect(panel()).not.toBeNull();
    state.progress = progress({ groups: GROUPS.filter((g) => !g.items.includes(FWS)) });
    render();
    expect(panel()).toBeNull();
    state.progress = progress({ tried: TRIED });
    render();
    expect(panel()).toBeNull();
  });
});

describe("RequirementsPage — narrow window (D9)", () => {
  it("below 1280px the outline collapses while the panel is open, and returns when it closes", () => {
    state.wide = false;
    render();
    expect($$("[data-outline-group]").length).toBeGreaterThan(0);
    expect($("[data-outline-toggle]")).toBeNull();
    select(FWS.id);
    expect($$("[data-outline-group]")).toHaveLength(0);
    const toggle = $("[data-outline-toggle]")!;
    expect(toggle.getAttribute("aria-label")).toBe("Show the outline");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    click(toggle);
    expect($("[data-outline-toggle]")!.getAttribute("aria-expanded")).toBe("true");
    expect($$("[data-outline-overlay] [data-outline-group]").length).toBeGreaterThan(0);
    // Esc closes the overlay first, then the panel.
    esc();
    expect($("[data-outline-overlay]")).toBeNull();
    expect(panel()).not.toBeNull();
    esc();
    expect(panel()).toBeNull();
    expect($("[data-outline-toggle]")).toBeNull();
    expect($$("[data-outline-group]").length).toBeGreaterThan(0);
  });

  it("at 1280px and up the outline stays with the panel open", () => {
    render();
    select(FWS.id);
    expect($("[data-outline-toggle]")).toBeNull();
    expect($$("[data-outline-group]").length).toBeGreaterThan(0);
  });
});

describe("RequirementsPage — wiring the header search and the credit table (D6/D10)", () => {
  it("passes the page's targets, tried actions and the no-longer-offered list to TrySearch", () => {
    state.progress = progress({ tried: { ...TRIED, missing: ["OLD-1000"] } });
    render();
    const p = state.trySearch!;
    expect(p.compact).toBe(false);
    expect(p.groupTargets.map((g) => g.key)).toEqual([
      "cas-college:Writing seminars",
      "cas-college:Distribution",
      "econ:Core",
    ]);
    expect(p.missingTried).toEqual(["OLD-1000"]);
    expect(p.actions.triedIds).toEqual(["HIST-1530"]);
    expect(p.actions.addLabel).toBe("+ Spring 2027");
    expect(p.codeOf("HIST-1530")).toBe("HIST 1530");
    expect(p.isOnBoard("HIST-1200")).toBe(true);
    act(() => p.onClearTried());
    expect(plan.clearTried).toHaveBeenCalledTimes(1);
    // No tried line or no-longer-offered block left in the body.
    expect($("main [data-tried-line]")).toBeNull();
    expect($("main [data-tried-missing]")).toBeNull();
  });

  it("the search is compact below 1280px", () => {
    state.wide = false;
    render();
    expect(state.trySearch!.compact).toBe(true);
  });

  it("passes the credit count and the fills to CreditTable; Edit opens the credit dialog", () => {
    state.progress = progress({ creditCount: { counted: 15, total: 16 }, creditFills: { e1: ["Distribution"] } });
    render();
    const p = state.creditTable!;
    expect(p.creditCount).toEqual({ counted: 15, total: 16 });
    expect(p.fills).toEqual({ e1: ["Distribution"] });
    expect(p.college).toBe("cas");
    act(() => p.onEdit());
    expect(store.setCreditsOpen).toHaveBeenCalledWith(true);
  });
});

// ── Spec 047: several programs on one plan (D6/D8/D10/D14) ──────────────────

describe("RequirementsPage — several programs (spec 047)", () => {
  const pgroup = (key: string, label: string, items: RequirementItem[], sectionId: string) => ({
    key,
    label,
    items,
    satisfiedCount: items.filter((it) => it.status === "satisfied").length,
    total: items.length,
    sectionId,
  });
  const ECON_ELEC = item(
    "econ:elec",
    { label: "Economics electives", status: "partial", coveredBy: ["p2"] },
    { layerKind: "major", rowKind: "pool", engineStatus: "partial", coursesHave: 1, coursesNeed: 3 }
  );
  const MATH_ELEC = item(
    "math-ba:elec",
    { label: "Mathematics electives" },
    { layerKind: "major", rowKind: "pool", engineStatus: "unmet", coursesHave: 0, coursesNeed: 4 }
  );
  const held = { courseId: "ARTH-1100", placementId: "p2", countsFor: "economics", heldFrom: "mathematics" };
  function multi(over: Partial<RequirementProgress> = {}): RequirementProgress {
    return progress({
      groups: [
        pgroup("cas-college:Writing seminars", "College · Writing seminars", [FWS], "cas-college"),
        pgroup("econ:Core", "Major · Core", [CORE, ECON_ELEC], "economics"),
        pgroup("math-ba:Electives", "Major · Electives", [MATH_ELEC], "mathematics"),
      ],
      sections: [
        { id: "cas-college", kind: "college", name: "Arts & Sciences", shortName: "Arts & Sciences", color: null, pct: 0, satisfiedCount: 0, total: 1, status: "ok" },
        { id: "economics", kind: "primary", name: "Economics (BA)", shortName: "Economics", color: null, pct: 0, satisfiedCount: 0, total: 2, status: "ok" },
        { id: "mathematics", kind: "secondMajor", name: "Mathematics, B.A.", shortName: "Mathematics", color: 1, pct: 40, satisfiedCount: 4, total: 10, status: "ok" },
        { id: "cs-minor", kind: "minor", name: "Computer Science", shortName: "CS minor", color: 2, pct: 0, satisfiedCount: 0, total: 6, status: "loading" },
      ],
      overlap: [
        { a: "economics", b: "mathematics", limit: { maxCourses: 1 }, sharedCourseIds: ["HIST-1200"], heldBack: [held], estimated: false },
      ],
      heldBackByPlacement: { p2: [held] },
      liveLayerIds: ["cas-college", "econ", "math-ba"],
      allLayersLoaded: true,
      ...over,
    });
  }
  const section = (id: string) => $$("[data-program-section]").find((el) => el.dataset.programSection === id)!;

  it("stacks one foldable section per program, names them in the title and counts every program", () => {
    state.progress = multi();
    render();
    expect($("h1")!.textContent).toBe("Requirements · Economics (BA) + 2 programs");
    expect($$("[data-program-section]").map((el) => el.dataset.programSection)).toEqual([
      "cas-college",
      "economics",
      "mathematics",
      "cs-minor",
    ]);
    expect($("[data-requirements-done]")!.textContent).toContain("4 of 19 done");
    expect(section("mathematics").textContent).toContain("Second major");
    expect($("[data-program-section-status]", section("mathematics"))!.textContent).toBe("40%");
    expect($("[data-program-section-status]", section("cs-minor"))!.textContent).toBe("Loading…");
    // The outline jumps between programs too.
    expect($$("[data-outline-section]").map((el) => el.dataset.outlineSection)).toEqual([
      "program:cas-college",
      "program:economics",
      "program:mathematics",
      "program:cs-minor",
    ]);
  });

  it("a section header folds its groups (aria-expanded) and unfolds again", () => {
    state.progress = multi();
    render();
    const toggle = () => $("[data-program-section-toggle]", section("mathematics"))!;
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect($("[data-group-card]", section("mathematics"))).not.toBeNull();
    click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect($("[data-group-card]", section("mathematics"))).toBeNull();
    click(toggle());
    expect($("[data-group-card]", section("mathematics"))).not.toBeNull();
  });

  it("shows the overlap line under the later program only", () => {
    state.progress = multi();
    render();
    const lines = $$("[data-overlap-line]");
    expect(lines).toHaveLength(1);
    expect(lines[0].closest("[data-program-section]")!.getAttribute("data-program-section")).toBe("mathematics");
    expect(lines[0].textContent).toBe(
      "1 of 1 shared course used · ARTH 1100 counts for Economics only, because of the limit."
    );
  });

  it("a forbidden pair warns on the later program instead of a percent (D14)", () => {
    state.progress = multi({
      overlap: [{ a: "economics", b: "mathematics", limit: "forbidden", sharedCourseIds: [], heldBack: [], estimated: false }],
    });
    render();
    expect($("[data-program-section-status]", section("mathematics"))!.textContent).toBe("Can't combine");
    expect($("[data-program-warning]", section("mathematics"))!.textContent).toContain(
      "Mathematics can't be combined with Economics"
    );
  });

  it("the panel of the row a held-back course counts for offers 'Count it for X instead' (D8)", () => {
    state.progress = multi();
    render();
    select(ECON_ELEC.id);
    const note = $("[data-held-back]", panel()!)!;
    expect(note.textContent).toContain("ARTH 1100 is held back from Mathematics (overlap limit)");
    expect(note.textContent).toContain(
      "Economics and Mathematics can share at most 1 course, so ARTH 1100 counts for Economics only."
    );
    click($("[data-count-it-for]", note));
    expect(plan.setCountsFor).toHaveBeenCalledWith("ARTH-1100", "math-ba");
  });

  it("an extra program's row names its program in the panel breadcrumb", () => {
    state.progress = multi();
    render();
    select(MATH_ELEC.id);
    expect(panel()!.textContent).toContain("Mathematics · Electives");
  });

  it("a waiver at the cap drops orphans first when every layer loaded (D10)", () => {
    state.waived = Array.from({ length: 80 }, (_, i) => `old-minor:r${i}`);
    state.progress = multi();
    render();
    select(CORE.id);
    click($("[data-waive]", panel()!));
    expect(plan.pruneOrphans).toHaveBeenCalledWith(["cas-college", "econ", "math-ba"]);
    expect(plan.toggleWaivedRequirement).toHaveBeenCalledWith(CORE.id);
    expect(plan.pruneOrphans.mock.invocationCallOrder[0]).toBeLessThan(
      plan.toggleWaivedRequirement.mock.invocationCallOrder[0]
    );
  });

  it("never prunes while a program's layers are still loading (D10)", () => {
    state.waived = Array.from({ length: 80 }, (_, i) => `old-minor:r${i}`);
    state.progress = multi({ allLayersLoaded: false });
    render();
    select(CORE.id);
    click($("[data-waive]", panel()!));
    expect(plan.pruneOrphans).not.toHaveBeenCalled();
    expect(plan.toggleWaivedRequirement).toHaveBeenCalledWith(CORE.id);
  });

  it("a second major that needs a concentration asks for it instead of a silent 99% (D2, audit #2)", () => {
    state.additionalPrograms = [{ programId: "mathematics", kind: "major" }];
    board.programData = {
      slots: [],
      layers: [
        { id: "mathematics", kind: "major", name: "Mathematics", rows: [], concentrations: { min: 1, max: 1 } },
        { id: "mathematics--applied", kind: "concentration", programId: "mathematics", concentrationId: "applied", name: "Applied Mathematics", rows: [] },
        { id: "mathematics--pure", kind: "concentration", programId: "mathematics", concentrationId: "pure", name: "Pure Mathematics", rows: [] },
      ],
    } as never;
    const math = { id: "mathematics", kind: "secondMajor" as const, name: "Mathematics, B.A.", shortName: "Mathematics", color: 1 as const, pct: 99, satisfiedCount: 9, total: 10, status: "ok" as const };
    state.progress = multi({ sections: [...multi().sections!.slice(0, 2), math] });
    const saved = board.programs;
    board.programs = [...saved, { id: "mathematics", name: "Mathematics, B.A.", short_name: "Mathematics" } as never];
    try {
      render();
      const sec = section("mathematics");
      expect($("[data-program-section-status]", sec)!.textContent).toBe("Needs a concentration");
      expect(sec.textContent).not.toContain("99%");
      expect($("[data-concentration-prompt]", sec)!.textContent).toBe("Choose a concentration to finish Mathematics");
      click($('[data-concentration-option="pure"]', sec));
      expect(plan.setProgramConcentrations).toHaveBeenCalledWith("mathematics", ["pure"]);
      // No chooser on the primary's or a minor's section.
      expect($$("[data-concentration-chooser]")).toHaveLength(1);
    } finally {
      board.programs = saved;
    }
  });

  it("a minor a major on the plan isn't open to reads as a warning, not a green 100% (D12, audit #3)", () => {
    state.additionalPrograms = [{ programId: "cs-minor", kind: "minor" }];
    state.minors = [
      { id: "cs-minor", name: "Computer Science", shortName: "CS minor", offeredBy: "Bowers CIS", catalogYear: "2026-27", notOpenTo: ["economics"] },
    ];
    const cs = { id: "cs-minor", kind: "minor" as const, name: "Computer Science", shortName: "CS minor", color: 2 as const, pct: 100, satisfiedCount: 6, total: 6, status: "ok" as const };
    state.progress = multi({ sections: [...multi().sections!.slice(0, 2), cs], overlap: [] });
    render();
    const sec = section("cs-minor");
    expect($("[data-program-section-status]", sec)!.textContent).toBe("Can't combine");
    expect(sec.textContent).not.toContain("100%");
    expect($("[data-program-warning]", sec)!.textContent).toBe(
      "The CS minor isn't open to Economics majors — check with your advisor."
    );
  });

  it("a plan with no extra program has no program sections", () => {
    render();
    expect($("[data-program-section]")).toBeNull();
    expect($("[data-outline-section]")).toBeNull();
  });
});
