// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/planner/board";
import type { Course } from "@/types/db";
import type { MarkValue } from "@/lib/planner/distribution/types";
import type { CardStatus } from "@/lib/planner/computeCardStatusMap";

// Spec 047 D10: the card's credits answer (a variable-credit course's "how
// many credits?") is a course-mark write like any other, so it runs the
// board's orphan-prune guard first. Rendered for real with its providers
// stubbed; the credit picker is a stand-in button.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = {
  placements: [] as unknown[],
  placedCourses: {},
  completedIds: [] as string[],
  inProgressIds: [] as string[],
  toggleCompleted: vi.fn(),
  toggleInProgress: vi.fn(),
  addPlacement: vi.fn(),
  movePlacement: vi.fn(),
  removePlacement: vi.fn(),
  shortTerms: [] as number[],
  courseMarks: {},
  setCourseMark: vi.fn(),
  setCountsFor: vi.fn(),
};
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));
vi.mock("@/hooks/usePlanFamily", () => ({ usePlanFamily: () => "cas" }));
const store = {
  armedCourse: null,
  armedSourcePlacementId: null,
  disarm: vi.fn(),
  openCourseDetail: vi.fn(),
  cardDensity: "comfortable",
  highlightedPlacementIds: [] as string[],
  setCreditsOpen: vi.fn(),
  requestCatalogSearch: vi.fn(),
};
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: Object.assign((sel: (s: typeof store) => unknown) => sel(store), { getState: () => store }),
}));
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ courseDetails: {}, aliases: {}, enrollmentTarget: "SP27", index: [] }),
}));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ enteringYear: 2026 }) }));
vi.mock("@/contexts/ReviewsProvider", () => ({ useReviews: () => null }));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => ({ resolved: [], college: "cas" }) }));
vi.mock("@/hooks/useLastTimeLine", () => ({ useLastTimeLine: () => null }));
vi.mock("@/hooks/useLeafDescriber", () => ({ useLeafDescriber: () => () => "" }));
vi.mock("@/hooks/useDragSource", () => ({ useDragSource: () => ({ onPointerDown: () => {} }) }));
vi.mock("animejs", () => ({ animate: vi.fn() }));
vi.mock("./CreditPicker", () => ({
  CreditPicker: ({ onChoose }: { onChoose: (value: number | null) => void }) => (
    <button type="button" data-test-credit-pick onClick={() => onChoose(4)}>
      pick
    </button>
  ),
}));

const { CourseCard } = await import("./CourseCard");

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const course = {
  id: "PHYS-4490",
  subject: "PHYS",
  number: "4490",
  title: "Independent Study",
  credits_min: 1,
  credits_max: 4,
} as unknown as Course;
const card: BoardCard = { placement: { id: "p1", courseId: "PHYS-4490", sem: 1, order: 0 }, course };
const status: CardStatus = {
  prereq: null,
  coreq: null,
  offeredOk: null,
  blocked: false,
  unmetPrereqLeaves: [],
  unmetCoreqLeaves: [],
  prereqState: null,
  advisoryNotes: [],
  overlaps: [],
  docNotes: [],
  coveredByCredit: null,
};

function render(beforeMark?: (key: string, value: MarkValue | null) => void) {
  act(() =>
    root.render(
      <CourseCard
        card={card}
        status={status}
        registerRef={() => {}}
        onChainHover={() => {}}
        onCompleted={() => {}}
        beforeMark={beforeMark}
      />
    )
  );
}

describe("CourseCard credits answer (spec 047 D10, audit #8)", () => {
  it("runs the board's cap guard right before it writes the credits mark", () => {
    const beforeMark = vi.fn();
    render(beforeMark);
    act(() => host.querySelector<HTMLButtonElement>("[data-test-credit-pick]")!.click());
    expect(beforeMark).toHaveBeenCalledWith("creditsTaken:PHYS-4490", 4);
    expect(plan.setCourseMark).toHaveBeenCalledWith("creditsTaken:PHYS-4490", 4);
    expect(beforeMark.mock.invocationCallOrder[0]).toBeLessThan(plan.setCourseMark.mock.invocationCallOrder[0]);
  });

  it("without a guard (no board around it) it still writes", () => {
    render();
    act(() => host.querySelector<HTMLButtonElement>("[data-test-credit-pick]")!.click());
    expect(plan.setCourseMark).toHaveBeenCalledWith("creditsTaken:PHYS-4490", 4);
  });
});
