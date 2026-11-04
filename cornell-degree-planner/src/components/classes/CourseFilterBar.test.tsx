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
