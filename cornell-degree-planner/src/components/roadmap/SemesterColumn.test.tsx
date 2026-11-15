// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/planner/board";
import type { Course } from "@/types/db";

// Spec 042 D2/D6/D7 — the short-term column variant and the gap "+", rendered
// for real (cards stubbed: CourseCard has its own concerns).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = {
  completedIds: [] as string[],
  addPlacement: vi.fn(() => "new-id"),
  addShortTerm: vi.fn(() => true),
  removeShortTerm: vi.fn(() => true),
};
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));
vi.mock("@/hooks/useColumnGlide", () => ({ useColumnGlide: () => {} }));
const store = {
  armedCourse: null as Course | null,
  armedHighlightSem: null as number | null,
  disarm: vi.fn(),
  requestCatalogSearch: vi.fn(),
};
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: typeof store) => unknown) => sel(store),
}));
const cardProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/components/roadmap/CourseCard", () => ({
  CourseCard: (props: { card: { placement: { id: string } } }) => {
    cardProps.push(props);
    return <div data-placement={props.card.placement.id} />;
  },
}));

const { SemesterColumn } = await import("./SemesterColumn");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  store.armedCourse = null;
  store.armedHighlightSem = null;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const course = (id: string, credits: number) =>
  ({ id, subject: id.split("-")[0], number: id.split("-")[1], credits_min: credits, credits_max: credits }) as unknown as Course;

function column(sem: number, shortTerm: boolean, ids: string[] = []): BoardColumn {
  return {
    sem,
    shortTerm,
    key: 2 * sem - (shortTerm ? 1 : 0),
    cards: ids.map((id, order) => ({
      placement: { id: `p-${id}`, courseId: id, sem, order, ...(shortTerm ? { shortTerm: true as const } : {}) },
      course: course(id, 3),
    })),
  };
}

function render(
  col: BoardColumn,
  opts: { enteringYear?: number | null; plus?: boolean; beforeMark?: (key: string, value: unknown) => void } = {}
) {
  act(() =>
    root.render(
      <SemesterColumn
        column={col}
        enteringYear={opts.enteringYear === undefined ? 2026 : opts.enteringYear}
        statusMap={{}}
        pendingChoices={{}}
        registerRef={() => {}}
        onChainHover={() => {}}
        onCompleted={() => {}}
        attribution={{}}
        canAddShortTermBefore={opts.plus ?? false}
        beforeMark={opts.beforeMark}
      />
    )
  );
  return container.firstElementChild as HTMLElement;
}

describe("regular column DOM contract", () => {
  it("keeps data-column = its semester, plus its time key", () => {
    const el = render(column(4, false));
    expect(el.getAttribute("data-column")).toBe("4");
    expect(el.getAttribute("data-column-key")).toBe("8");
    expect(el.hasAttribute("data-short-term-before")).toBe(false);
    expect(el.textContent).toContain("Sem");
    expect(el.querySelector('[data-tour="add-class"]')).not.toBeNull();
  });
});

describe("the D10 cap guard (spec 047, audit #8)", () => {
  it("hands the board's beforeMark to every card, for the card's own answer writes", () => {
    cardProps.length = 0;
    const beforeMark = vi.fn();
    render(column(1, false, ["PHYS-4490", "MATH-1920"]), { beforeMark });
    expect(cardProps).toHaveLength(2);
    expect(cardProps.every((p) => p.beforeMark === beforeMark)).toBe(true);
  });
});

describe("gap + (spec 042 D2/D8/D9)", () => {
  it("renders before the column with the gap's term, and adds that short term", () => {
    const el = render(column(1, false), { plus: true });
    const btn = el.querySelector<HTMLButtonElement>('[data-add-short-term="1"]');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("Add Summer 2026");
    expect(btn!.getAttribute("data-tooltip")).toBe("Add Summer 2026");
    act(() => btn!.click());
    expect(plan.addShortTerm).toHaveBeenCalledWith(1);
    // The click must not fall through to the column's click-to-place.
    expect(plan.addPlacement).not.toHaveBeenCalled();
  });

  it("is a winter before a spring, bare season without a year", () => {
    expect(
      render(column(2, false), { plus: true })
        .querySelector('[data-add-short-term="2"]')!
        .getAttribute("aria-label")
    ).toBe("Add Winter 2027");
    expect(
      render(column(2, false), { plus: true, enteringYear: null })
        .querySelector('[data-add-short-term="2"]')!
        .getAttribute("aria-label")
    ).toBe("Add winter");
  });

  it("is absent when the canvas says the gap is taken or the cap is hit", () => {
    expect(render(column(3, false)).querySelector("[data-add-short-term]")).toBeNull();
  });
});

describe("short-term column (spec 042 D6/D7)", () => {
  it("never matches [data-column=N]; marks the semester it precedes", () => {
    const el = render(column(2, true));
    expect(el.hasAttribute("data-column")).toBe(false);
    expect(el.getAttribute("data-short-term-before")).toBe("2");
    expect(el.getAttribute("data-column-key")).toBe("3");
  });

  it("reads 'Winter 2027 · N cr' with no Sem N and no class-year word", () => {
    const el = render(column(2, true, ["MATH-1920"]));
    const label = el.querySelector("[data-short-term-label]")!;
    expect(label.textContent).toBe("Winter 2027 · 3 cr");
    expect(el.textContent).not.toMatch(/Sem\s*\d/);
    expect(el.textContent).not.toMatch(/Freshman|Sophomore|Junior|Senior/);
    // No load bands: the footer is the plain total.
    expect(el.textContent).toContain("3 credits planned");
  });

  it("an empty short term's × removes it", () => {
    const el = render(column(1, true));
    const x = el.querySelector<HTMLButtonElement>('[data-remove-short-term="1"]')!;
    expect(x.getAttribute("aria-disabled")).toBeNull();
    expect(x.getAttribute("aria-label")).toBe("Remove Summer 2026");
    act(() => x.click());
    expect(plan.removeShortTerm).toHaveBeenCalledWith(1);
  });

  it("with classes, the × is disabled and its tooltip says to move or remove the classes", () => {
    const el = render(column(1, true, ["CS-1110"]));
    const x = el.querySelector<HTMLButtonElement>('[data-remove-short-term="1"]')!;
    expect(x.getAttribute("aria-disabled")).toBe("true");
    expect(x.getAttribute("data-tooltip")).toBe("To remove this column, move its classes to another column or remove them from the board");
    act(() => x.click());
    expect(plan.removeShortTerm).not.toHaveBeenCalled();
  });

  it("an armed course lands in the short term itself (a ColumnRef target)", () => {
    store.armedCourse = course("CS-1110", 4);
    const el = render(column(3, true));
    const add = el.querySelector<HTMLButtonElement>("[data-glide='add']")!;
    expect(add.getAttribute("aria-label")).toBe("Add CS 1110 to Summer 2027");
    act(() => add.click());
    expect(plan.addPlacement).toHaveBeenCalledWith(store.armedCourse, { sem: 3, shortTerm: true }, Number.MAX_SAFE_INTEGER);
  });

  it("a regular column still targets a plain semester number", () => {
    store.armedCourse = course("CS-1110", 4);
    const el = render(column(3, false));
    act(() => el.querySelector<HTMLButtonElement>("[data-glide='add']")!.click());
    expect(plan.addPlacement).toHaveBeenCalledWith(store.armedCourse, 3, Number.MAX_SAFE_INTEGER);
  });

  it("is never the suggested enrollment-term target, nor the tour's add-class button", () => {
    store.armedCourse = course("CS-1110", 4);
    store.armedHighlightSem = 2;
    const el = render(column(2, true));
    expect(el.hasAttribute("data-suggested-target")).toBe(false);
    expect(el.querySelector('[data-tour="add-class"]')).toBeNull();
  });
});
