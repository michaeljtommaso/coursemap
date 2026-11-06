import { describe, expect, it } from "vitest";
import { toggleLevel } from "./levelFilter";

describe("toggleLevel", () => {
  it("adds in order, removes, and clears to undefined", () => {
    expect(toggleLevel(undefined, 3)).toEqual([3]);
    expect(toggleLevel([3], 1)).toEqual([1, 3]);
    expect(toggleLevel([1, 3], 4)).toEqual([1, 3, 4]);
    expect(toggleLevel([1, 3, 4], 3)).toEqual([1, 4]);
    expect(toggleLevel([4], 4)).toBeUndefined();
  });
});
