import { describe, it, expect } from "vitest";
import {
  isPatternLeaf,
  joinAlternatives,
  plainPattern,
  makeLeafDescriber,
  describeLeaf,
} from "./leafWording";

describe("isPatternLeaf", () => {
  it("recognizes wildcard leaves in code or dash form", () => {
    expect(isPatternLeaf("CS 111x")).toBe(true);
    expect(isPatternLeaf("ENGRD-2xxx")).toBe(true);
    expect(isPatternLeaf("BME 3X10")).toBe(true);
    expect(isPatternLeaf("PE 1***")).toBe(true);
  });

  it("rejects plain course codes and ids", () => {
    expect(isPatternLeaf("CS 1110")).toBe(false);
    expect(isPatternLeaf("CS-2110")).toBe(false);
    expect(isPatternLeaf("ghost")).toBe(false);
  });
});

describe("joinAlternatives", () => {
  it("reads as either-or", () => {
    expect(joinAlternatives([])).toBe("");
    expect(joinAlternatives(["A"])).toBe("A");
    expect(joinAlternatives(["A", "B"])).toBe("A or B");
    expect(joinAlternatives(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("plainPattern", () => {
  it("1xxx patterns read as intro courses", () => {
    expect(plainPattern("CS 111x")).toBe("an intro CS course (CS 111x)");
  });

  it("other levels name the level", () => {
    expect(plainPattern("CS 3xxx")).toBe("a 3000-level CS course (CS 3xxx)");
    expect(plainPattern("ECE 8xxx")).toBe("an 8000-level ECE course (ECE 8xxx)");
  });

  it("a leading wildcard names only the subject", () => {
    expect(plainPattern("MATH x9xx")).toBe("a MATH course (MATH x9xx)");
  });
});

describe("makeLeafDescriber", () => {
  const catalog = ["CS 1110", "CS 1112", "CS 2110", "CS 3110", "CS 3410", "CS 3420", "CS 3700"];
  const describeWith = makeLeafDescriber(catalog);

  it("expands a pattern to its catalog alternatives", () => {
    expect(describeWith("CS 111x")).toBe("CS 1110 or CS 1112");
  });

  it("falls back to plain language when too many courses match", () => {
    expect(describeWith("CS 3xxx")).toBe("a 3000-level CS course (CS 3xxx)");
  });

  it("falls back to plain language when nothing matches", () => {
    expect(describeWith("ENGRD 2xxx")).toBe("a 2000-level ENGRD course (ENGRD 2xxx)");
  });

  it("passes course leaves through in code form", () => {
    expect(describeWith("CS 2110")).toBe("CS 2110");
    expect(describeWith("MATH-1910")).toBe("MATH 1910");
  });

  it("never returns a bare pattern (catalog-free default)", () => {
    expect(describeLeaf("CS 111x")).toBe("an intro CS course (CS 111x)");
    expect(describeLeaf("CS 2110")).toBe("CS 2110");
  });
});
