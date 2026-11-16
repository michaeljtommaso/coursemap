import { describe, it, expect } from "vitest";
import { PROGRAM_COLOR_VAR, programColorFor } from "./programColors";

describe("programColors (spec 047 D5)", () => {
  it("colors programs in the order added", () => {
    expect([0, 1, 2, 3].map(programColorFor)).toEqual([1, 2, 3, 4]);
  });

  it("never throws on an index outside the list", () => {
    expect(programColorFor(4)).toBe(1);
    expect(programColorFor(-1)).toBe(1);
    expect(programColorFor(1.5)).toBe(1);
  });

  it("maps each color to its token", () => {
    expect(PROGRAM_COLOR_VAR[1]).toBe("var(--program-1)");
    expect(PROGRAM_COLOR_VAR[4]).toBe("var(--program-4)");
  });
});
