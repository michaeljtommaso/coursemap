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
