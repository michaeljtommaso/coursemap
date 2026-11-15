import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardProgramLabels, HeldBackLines } from "./CardProgramLines";

// Spec 047 D6/D8: the card's program lines, rendered statically.

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("CardProgramLabels", () => {
  it("primary labels first, then a colored dot before each extra program's labels", () => {
    const html = renderToStaticMarkup(
      <CardProgramLabels
        groups={[
          { sectionId: "economics", programName: "Economics", extra: false, color: null, labels: ["Econometrics"] },
          { sectionId: "mathematics", programName: "Mathematics", extra: true, color: 1, labels: ["Electives"] },
        ]}
      />
    );
    expect(html).toContain("data-attribution");
    expect(html).toContain('data-attribution-program="mathematics"');
    expect(html).toContain("var(--program-1)");
    expect(text(html)).toContain("Econometrics · Electives");
    // The full text for screen readers names the program.
    expect(text(html)).toContain("Counts toward Econometrics · Mathematics: Electives");
  });

  it("renders nothing when every label was filtered out", () => {
    const html = renderToStaticMarkup(
      <CardProgramLabels groups={[{ sectionId: "e", programName: "E", extra: false, color: null, labels: [] }]} />
    );
    expect(html).toBe("");
  });
});

describe("HeldBackLines", () => {
  it("one line per held-back program, the reason for screen readers", () => {
    const html = renderToStaticMarkup(
      <HeldBackLines
        code="ECON 3110"
        heldBack={[
          {
            courseId: "ECON-3110",
            placementId: "p1",
            countsFor: "economics",
            heldFrom: "mathematics",
            countsForName: "Economics",
            heldFromName: "Mathematics",
            limit: "Economics and Mathematics can share at most 2 courses",
            layerId: "math-ba",
          },
        ]}
      />
    );
    expect(html).toContain('data-held-back-line="mathematics"');
    expect(text(html)).toContain("Held back from Mathematics (overlap limit)");
    expect(text(html)).toContain("Economics and Mathematics can share at most 2 courses, so ECON 3110 counts for Economics only.");
  });
});
