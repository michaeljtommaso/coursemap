import { describe, expect, it } from "vitest";
import { minorClosure, onlyOpenToWho } from "./minorEligibility";

// Fictional program ids and names.
const p = (id: string, short_name: string, collegeId: "cas" | "cals" | "engineering", status?: "hidden") => ({
  id,
  short_name,
  college: "",
  collegeId,
  ...(status ? { status } : {}),
});
const PROGRAMS = [
  p("test-cas-econ-ba", "Economics", "cas"),
  p("test-cas-math-ba", "Mathematics", "cas"),
  p("test-cas-govt-ba", "Government", "cas"),
  p("test-cas-hist-ba", "History", "cas"),
  p("test-cas-phil-ba", "Philosophy", "cas"),
  p("test-cals-nutr-bs", "Nutrition", "cals"),
  p("test-cals-bio-bs", "Biology", "cals"),
  p("test-eng-cs-bs", "CS", "engineering"),
  p("test-eng-me-bs", "ME", "engineering"),
  p("test-eng-old-bs", "Old Eng", "engineering", "hidden"),
];

describe("minorClosure (spec 047 D12)", () => {
  it("notOpenTo: closed when any major on the plan matches, the primary or the second major", () => {
    expect(minorClosure({ notOpenTo: ["test-cas-math-ba"] }, ["test-cas-econ-ba", "test-cas-math-ba"])).toEqual({
      kind: "notOpenTo",
      majorId: "test-cas-math-ba",
    });
    expect(minorClosure({ notOpenTo: ["test-cas-math-ba"] }, ["test-cas-econ-ba"])).toBeNull();
  });

  it("onlyOpenTo: closed unless some major on the plan matches, the primary or the second major alike", () => {
    const only = { onlyOpenTo: ["test-cals-nutr-bs"] };
    expect(minorClosure(only, ["test-cals-bio-bs"])).toEqual({ kind: "onlyOpenTo", onlyOpenTo: ["test-cals-nutr-bs"] });
    expect(minorClosure(only, ["test-cals-nutr-bs-2026"])).toBeNull();
    expect(minorClosure(only, ["test-cals-bio-bs", "test-cals-nutr-bs"])).toBeNull();
    // Nothing to judge without a major; no entry, or an empty list: open.
    expect(minorClosure(only, [])).toBeNull();
    expect(minorClosure(only, ["", null, undefined])).toBeNull();
    expect(minorClosure(undefined, ["test-cals-bio-bs"])).toBeNull();
    expect(minorClosure({ onlyOpenTo: [] }, ["test-cals-bio-bs"])).toBeNull();
  });

  it("notOpenTo is checked first", () => {
    expect(
      minorClosure({ notOpenTo: ["test-eng-cs-bs"], onlyOpenTo: ["test-eng-cs-bs-x", "test-eng-me-bs"] }, ["test-eng-cs-bs"])
    ).toEqual({ kind: "notOpenTo", majorId: "test-eng-cs-bs" });
  });
});

describe("onlyOpenToWho (spec 047 D12)", () => {
  it("names the majors it is open to, in plain words from the program list", () => {
    expect(onlyOpenToWho(["test-cals-nutr-bs"], PROGRAMS)).toBe("Nutrition majors");
    expect(onlyOpenToWho(["test-cas-math-ba", "test-cas-govt-ba"], PROGRAMS)).toBe("Government and Mathematics majors");
    expect(onlyOpenToWho(["test-cas-math-ba", "test-cas-govt-ba", "test-cas-econ-ba"], PROGRAMS)).toBe(
      "Economics, Government, and Mathematics majors"
    );
    expect(
      onlyOpenToWho(["test-cas-math-ba", "test-cas-govt-ba", "test-cas-econ-ba", "test-cas-hist-ba"], PROGRAMS)
    ).toBe("Economics, Government, and 2 other majors");
  });

  it("says the college when the prefixes cover every visible major of one college", () => {
    expect(onlyOpenToWho(["test-eng-cs-bs", "test-eng-me-bs"], PROGRAMS)).toBe("Engineering majors");
    expect(onlyOpenToWho(["test-cals-nutr-bs", "test-cals-bio-bs"], PROGRAMS)).toBe("CALS majors");
  });

  it("falls back to plain words while the program list doesn't name them", () => {
    expect(onlyOpenToWho(["test-cals-nutr-bs"], [])).toBe("certain majors");
    expect(onlyOpenToWho(["test-unknown-bs"], PROGRAMS)).toBe("certain majors");
  });
});
