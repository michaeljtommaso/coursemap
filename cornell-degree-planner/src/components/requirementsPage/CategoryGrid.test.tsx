import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryGrid } from "./CategoryGrid";

// A filled category chip names the course(s) filling it; an open one shows
// only its label.

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("CategoryGrid", () => {
  it("a filled chip reads '<label> · <codes>'", () => {
    const html = renderToStaticMarkup(
      <CategoryGrid
        categories={[
          { id: "hst", label: "Historical Analysis", filled: true, missing: false, codes: ["HIST 1500", "HIST 2000"] },
          { id: "alc", label: "Arts and Literature", filled: false, missing: true },
        ]}
      />
    );
    expect(text(html)).toContain("Historical Analysis · HIST 1500, HIST 2000");
    expect(text(html)).toContain("Arts and Literature");
    expect(text(html)).not.toContain("Arts and Literature ·");
  });

  it("a filled chip without codes (credit only) shows just its label", () => {
    const html = renderToStaticMarkup(
      <CategoryGrid categories={[{ id: "phs", label: "Physical Sciences", filled: true, missing: false }]} />
    );
    expect(text(html)).toContain("Physical Sciences");
    expect(text(html)).not.toContain("Physical Sciences ·");
  });
});
