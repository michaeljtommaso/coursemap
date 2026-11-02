import { describe, expect, it } from "vitest";
import { programLinks } from "./program-links";

// Engineering-format programs only: CAS and CALS majors take their link from
// the program index (spec 019 D11).
const SHORT_NAMES = [
  "BE", "BME", "CE", "ChemE", "CS", "EAS", "ECE",
  "ENVE", "EP", "ISST", "ME", "MSE", "ORE",
];

describe("programLinks", () => {
  it("has an https Cornell major page for every seeded program", () => {
    for (const s of SHORT_NAMES) {
      const l = programLinks(s);
      expect(l, s).not.toBeNull();
      expect(l!.majorPage, s).toMatch(/^https:\/\/[a-z.]*cornell\.edu\//);
    }
  });

  it("links an official flowchart for every engineering major", () => {
    for (const s of SHORT_NAMES) {
      expect(programLinks(s)!.flowchart, s).toMatch(/^https:\/\/www\.duffield\.cornell\.edu\/.*\.jpg$/);
    }
  });

  it("returns null for an unknown or missing program", () => {
    expect(programLinks("XYZ")).toBeNull();
    expect(programLinks(null)).toBeNull();
    expect(programLinks(undefined)).toBeNull();
  });
});
