// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriedProgress } from "@/hooks/useRequirementProgress";
import type { CatalogIndexRecord } from "@/lib/schemas";

// The rail's tried-classes reminder (spec 028 D13), rendered for real.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = { untryCourse: vi.fn(), clearTried: vi.fn() };
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ enteringYear: 2026 }) }));
const INDEX = [
  { id: "PHIL-1100", subject: "PHIL", number: "1100", title: "Intro to Philosophy", creditsMin: 4, creditsMax: 4, roster: "SP27" },
  { id: "HIST-1530", subject: "HIST", number: "1530", title: "Intro to American History", creditsMin: 4, creditsMax: 4, roster: "FA26" },
] as unknown as CatalogIndexRecord[];
vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({ index: INDEX, courseDetails: {}, aliases: {}, enrollmentTarget: "SP27" }),
}));
const armCourse = vi.fn();
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ armCourse }),
}));
// The suggested column: the stub says "column 2" for the SP27 roster only.
vi.mock("@/lib/planner/armHighlight", () => ({
  targetHighlightSem: (c: { roster?: string | null }, target: string | null) =>
    c.roster && c.roster === target ? 2 : null,
}));

const { TriedReminder } = await import("./TriedReminder");
const { REMINDER_LIST_CAP } = await import("./railLines");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tried(over: Partial<TriedProgress> = {}): TriedProgress {
  return {
    courseIds: ["PHIL-1100", "HIST-1530", "OLD-1000"],
    notOnBoard: ["PHIL-1100", "HIST-1530", "OLD-1000"],
    items: {},
    fills: { "PHIL-1100": ["Ethics & Mind", "Electives"], "HIST-1530": ["Historical"] },
    missing: ["OLD-1000"],
    ...over,
  };
}
function render(t: TriedProgress | undefined) {
  act(() => root.render(<TriedReminder tried={t} columnSems={[1, 2, 3]} />));
}
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const click = (el: Element | null) => {
  if (!el) throw new Error("missing element");
  act(() => (el as HTMLElement).click());
};
const button = (scope: Element, text: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null;

describe("TriedReminder", () => {
  it("is absent when nothing is tried or everything tried is on the board", () => {
    render(undefined);
    expect($("[data-tried-reminder]")).toBeNull();
    render(tried({ notOnBoard: [], missing: [] }));
    expect($("[data-tried-reminder]")).toBeNull();
  });

  it("lists each class with the first thing it would fill, under the count header", () => {
    render(tried());
    const box = $("[data-tried-reminder]")!;
    expect(box.textContent).toContain("Trying · not on your board (3)");
    expect($('[data-tried-item="PHIL-1100"]')!.textContent).toContain("PHIL 1100 · Ethics & Mind");
    expect($('[data-tried-item="PHIL-1100"]')!.textContent).not.toContain("Electives");
    expect($('[data-tried-item="HIST-1530"]')!.textContent).toContain("HIST 1530 · Historical");
  });

  it("caps the list at two lines and scrolls the rest", () => {
    render(tried());
    const list = $("[data-tried-list]")!;
    for (const cls of REMINDER_LIST_CAP.split(" ")) expect(list.className).toContain(cls);
    expect(REMINDER_LIST_CAP).toContain("max-h-[46px]");
    expect(REMINDER_LIST_CAP).toContain("overflow-y-auto");
  });

  it("Place arms the course with the enrollment term's column when it's on that roster", () => {
    render(tried());
    click(button($('[data-tried-item="PHIL-1100"]')!, "Place"));
    expect(armCourse).toHaveBeenCalledTimes(1);
    const [course, source, opts] = armCourse.mock.calls[0];
    expect(course).toMatchObject({ id: "PHIL-1100", subject: "PHIL", number: "1100", credits_min: 4 });
    expect(source).toBeNull();
    expect(opts).toEqual({ highlightSem: 2 });
  });

  it("Place with no suggested column when the course isn't on the enrollment roster", () => {
    render(tried());
    click(button($('[data-tried-item="HIST-1530"]')!, "Place"));
    expect(armCourse.mock.calls[0][2]).toEqual({ highlightSem: null });
  });

  it("Clear stops trying every class", () => {
    render(tried());
    click($("[data-tried-clear]"));
    expect(plan.clearTried).toHaveBeenCalledTimes(1);
  });

  it("a class no longer offered shows Remove, which un-tries it", () => {
    render(tried());
    const row = $('[data-tried-item="OLD-1000"]')!;
    expect(row.hasAttribute("data-tried-missing")).toBe(true);
    expect(row.textContent).toContain("OLD 1000 · no longer offered");
    expect(button(row, "Place")).toBeNull();
    click(button(row, "Remove"));
    expect(plan.untryCourse).toHaveBeenCalledWith("OLD-1000");
    expect(armCourse).not.toHaveBeenCalled();
  });
});
