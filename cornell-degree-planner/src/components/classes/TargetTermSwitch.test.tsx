import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TargetTermSwitch } from "./TargetTermSwitch";

// Static render (no DOM library in this repo): read the visible text and the
// one button's label.
function render(on: boolean): string {
  return renderToStaticMarkup(<TargetTermSwitch on={on} termLabel="Spring 2027" onChange={() => {}} />);
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);

describe("TargetTermSwitch (spec 017 D1) — status text + one plain action", () => {
  it("on: says what the list shows, offers Show all", () => {
    const html = render(true);
    expect(text(html)).toBe("Showing Spring 2027 classes · Show all");
    expect(buttons(html)).toEqual(["Show all"]);
  });

  it("off: says it shows everything, offers the term filter", () => {
    const html = render(false);
    expect(text(html)).toBe("Showing all classes · Show only Spring 2027 classes");
    expect(buttons(html)).toEqual(["Show only Spring 2027 classes"]);
  });

  it("is not a toggle: no aria-pressed in either state", () => {
    expect(render(true)).not.toContain("aria-pressed");
    expect(render(false)).not.toContain("aria-pressed");
  });
});
