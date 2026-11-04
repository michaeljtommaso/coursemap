import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseFilterBar } from "./CourseFilterBar";

// Static render (no DOM library in this repo): is the well-rated chip offered?
function render(showWellRated: boolean | undefined): string {
  return renderToStaticMarkup(
    <CourseFilterBar
      filters={{}}
      onChange={() => {}}
      subjects={["CS", "MATH"]}
      hasProgram={false}
      showFavorites
      showWellRated={showWellRated}
    />
  );
}

describe("CourseFilterBar — well-rated chip (spec 017 D7)", () => {
  it("hidden when the page says ratings are off or not loaded", () => {
    expect(render(false)).not.toContain("Well-rated professor");
    expect(render(undefined)).not.toContain("Well-rated professor");
  });

  it("offered when ratings are on and loaded", () => {
    expect(render(true)).toContain("Well-rated professor");
  });
});

describe("CourseFilterBar — schedule section (spec 021)", () => {
  const html = (props: { hasMeetings?: boolean; semesterLabel?: string | null; filters?: object }) =>
    renderToStaticMarkup(
      <CourseFilterBar
        filters={props.filters ?? {}}
        onChange={() => {}}
        subjects={["CS"]}
        hasProgram={false}
        hasMeetings={props.hasMeetings}
        semesterLabel={props.semesterLabel}
      />
    );

  it("hidden until the index carries meeting times", () => {
    expect(html({})).not.toContain("Days I&#x27;m free");
    expect(html({ hasMeetings: true })).toContain("Days I&#x27;m free");
  });

  it("offers weekend days, the time window and the three-way check", () => {
    const out = html({ hasMeetings: true });
    for (const s of ["Sa", "Su", "Earliest start", "Latest end", "10:15 AM", "Lecture", "Disc &amp; lab", "All"]) {
      expect(out).toContain(s);
    }
  });

  it("Fits my semester only with a term to fit around", () => {
    expect(html({ hasMeetings: true, semesterLabel: null })).not.toContain("Fits my");
    expect(html({ hasMeetings: true, semesterLabel: "Spring 2027" })).toContain("Fits my Spring 2027 schedule");
  });
});

describe("CourseFilterBar — requirements section (spec 022)", () => {
  const groups = [
    {
      key: "core",
      label: "Core",
      options: [{ id: "s2", label: "CS 3110", disabled: false }],
    },
    {
      key: "liberal",
      label: "Liberal studies",
      options: [{ id: "lib", label: "Liberal Studies (can't check automatically)", disabled: true }],
    },
  ];
  const html = (props: { filters?: object; requirementGroups?: typeof groups; tagCounts?: Record<string, number> }) =>
    renderToStaticMarkup(
      <CourseFilterBar
        filters={props.filters ?? {}}
        onChange={() => {}}
        subjects={["CS"]}
        hasProgram
        requirementGroups={props.requirementGroups}
        tagCounts={props.tagCounts}
      />
    );

  it("hidden with no open requirements and no tagged classes", () => {
    expect(html({})).not.toContain("Counts toward");
    expect(html({})).not.toContain("Distribution tag");
  });

  it("lists open requirements; one the app can't check is disabled", () => {
    const out = html({ requirementGroups: groups });
    expect(out).toContain("Counts toward");
    expect(out).toContain("CS 3110");
    expect(out).toMatch(/<option value="lib" disabled="">Liberal Studies \(can&#x27;t check automatically\)/);
  });

  it("keeps a chosen requirement that has since been met", () => {
    const out = html({ requirementGroups: [], tagCounts: { "LA-AG": 3 }, filters: { requirementId: "old", requirementLabel: "MATH 1920" } });
    expect(out).toContain('value="old"');
    expect(out).toContain("MATH 1920");
  });

  it("offers only tags some class carries, with counts, and notes the roster caveat once chosen", () => {
    const out = html({ tagCounts: { "LA-AG": 791, "ALC-AS": 958 } });
    expect(out).toContain("LA — Literature and the Arts (791)");
    expect(out).toContain("ALC — Arts, Literature, and Culture (958)");
    expect(out).not.toContain("KCM —");
    expect(out).not.toContain("dist-tag-note");
    expect(html({ tagCounts: { "LA-AG": 791 }, filters: { distTag: "LA-AG" } })).toContain("dist-tag-note");
  });
});

describe("CourseFilterBar — level pills are multi-select", () => {
  it("marks every chosen level pressed, and only those", () => {
    const out = renderToStaticMarkup(
      <CourseFilterBar filters={{ levels: [2, 4] }} onChange={() => {}} subjects={["CS"]} hasProgram={false} />
    );
    const pressed = (n: number) => new RegExp(`aria-pressed="true"[^>]*><span class="num">${n}000<`).test(out);
    expect(pressed(2)).toBe(true);
    expect(pressed(4)).toBe(true);
    expect(pressed(3)).toBe(false);
    expect(out).toContain("Clear");
  });
});
