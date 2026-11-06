import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// The planner rail's shape (spec 025 D9): nav with Requirements under
// Classes, the journey as one line, Still needed lines (stubbed here; see
// RailStillNeeded.test), Major Match as one link — and no old checklist.

vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    completedIds: ["p1"],
    inProgressIds: ["p2"],
    placements: [
      { id: "p1", courseId: "ECON-1110", sem: 1, order: 0 },
      { id: "p2", courseId: "ECON-1120", sem: 2, order: 0 },
    ],
    placedCourses: { "ECON-1110": { credits_min: 4 }, "ECON-1120": { credits_min: 4 } },
  }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({
    programs: [
      { id: "econ", name: "Economics (BA)", short_name: "Economics", total_credits: 120, college: "Arts & Sciences", catalog_year: "2026-27" },
    ],
  }),
}));
vi.mock("@/hooks/useCreditProfile", () => ({
  useCreditProfile: () => ({
    resolved: [{ id: "exam:ap-calculus-bc", kind: "ap", label: "AP Calculus BC", satisfiesCourseIds: ["MATH-1110"], credits: 4 }],
    raw: [],
    college: "cas",
  }),
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: "econ" }),
}));
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ openPanel: vi.fn(), leftRailWidth: 224 }),
}));
vi.mock("@/hooks/useMajorMatch", () => ({
  useMajorMatch: () => ({
    ready: true,
    matches: [{ program: { name: "Economics (BA)", short_name: "Economics" }, pct: 34, creditsSatisfied: 8 }],
  }),
}));
vi.mock("@/components/layout/RailResizeHandle", () => ({ RailResizeHandle: () => null }));
vi.mock("@/components/rail/RailStillNeeded", () => ({
  RailStillNeeded: () => <section data-rail-still-needed-stub />,
}));

const { LeftSidebar } = await import("@/components/layout/LeftSidebar");

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

function render() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <LeftSidebar cards={[]} />
    </MemoryRouter>
  );
}

describe("LeftSidebar (spec 025 rail)", () => {
  it("nav lists Planner, Classes, then Requirements", () => {
    const html = render();
    const hrefs = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/", "/classes", "/requirements"]);
    expect(text(html)).toMatch(/Planner.*Classes.*Requirements/);
  });

  it("journey is one line from resolved credit, in progress on a short second line", () => {
    const t = text(render());
    // 4 completed on the board + 4 from AP credit.
    expect(t).toContain("8 of 120 credits");
    expect(t).toContain("7%");
    expect(t).toContain("4 more in progress");
  });

  it("Still needed is the rail lines, not the old checklist; Major Match is one link", () => {
    const html = render();
    expect(html).toContain("data-rail-still-needed-stub");
    expect(html).not.toContain("data-still-needed");
    expect(text(html)).toContain("Major Match: Economics 34%");
    expect(text(html)).toContain("Arts & Sciences · 2026-27 catalog");
  });
});
