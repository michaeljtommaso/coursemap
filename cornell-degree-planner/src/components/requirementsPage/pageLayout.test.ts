import { describe, expect, it } from "vitest";
import { WIDE_QUERY, outlineMode } from "./pageLayout";

describe("outline mode (spec 045 D9)", () => {
  it("1280px and up: the outline always shows", () => {
    expect(outlineMode(true, false)).toBe("full");
    expect(outlineMode(true, true)).toBe("full");
  });
  it("below 1280px it collapses only while the panel is open", () => {
    expect(outlineMode(false, true)).toBe("collapsed");
    expect(outlineMode(false, false)).toBe("full");
  });
  it("the breakpoint is 1280px", () => {
    expect(WIDE_QUERY).toBe("(min-width: 1280px)");
  });
});
