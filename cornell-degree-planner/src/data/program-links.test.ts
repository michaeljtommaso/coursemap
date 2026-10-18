import { describe, expect, it } from "vitest";
import { programLinks } from "./program-links";

const SHORT_NAMES = [
  "BE", "BME", "CE", "ChemE", "Comm", "CS", "EAS", "ECE",
  "ENVE", "EP", "InfoSci", "ISST", "ME", "MSE", "ORE",
];

describe("programLinks", () => {
  it("has an https Cornell major page for every seeded program", () => {
    for (const s of SHORT_NAMES) {
      const l = programLinks(s);
      expect(l, s).not.toBeNull();
      expect(l!.majorPage, s).toMatch(/^https:\/\/[a-z.]*cornell\.edu\//);
    }
  });

  it("links an official flowchart for the engineering majors only", () => {
    for (const s of SHORT_NAMES) {
      const f = programLinks(s)!.flowchart;
      if (s === "Comm" || s === "InfoSci") expect(f, s).toBeNull();
      else expect(f, s).toMatch(/^https:\/\/www\.duffield\.cornell\.edu\/.*\.jpg$/);
    }
  });

  it("returns null for an unknown or missing program", () => {
    expect(programLinks("XYZ")).toBeNull();
    expect(programLinks(null)).toBeNull();
    expect(programLinks(undefined)).toBeNull();
  });
});
