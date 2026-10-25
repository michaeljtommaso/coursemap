import { describe, it, expect } from "vitest";
import {
  startYearOptions,
  entryTermFrom,
  enteringYearForEntryTerm,
  guessEntryFromEnteringYear,
  parseEntryTerm,
} from "./entryTerm";
import { semesterLabel } from "./semesters";
import { termOrdinal } from "./distribution/select";

describe("entryTermFrom", () => {
  it("builds roster slugs the engine can read", () => {
    expect(entryTermFrom("FA", 2025)).toBe("FA25");
    expect(entryTermFrom("SP", 2026)).toBe("SP26");
    expect(entryTermFrom("FA", 2003)).toBe("FA03");
    expect(termOrdinal(entryTermFrom("SP", 2026))).not.toBeNull();
  });
});

describe("parseEntryTerm", () => {
  it("round-trips fall and spring slugs", () => {
    expect(parseEntryTerm("FA25")).toEqual({ season: "FA", year: 2025 });
    expect(parseEntryTerm("SP26")).toEqual({ season: "SP", year: 2026 });
  });

  it.each([null, undefined, "", "SU25", "WI26", "fa25", "FA2025", "FA25 "])("rejects %j", (t) => {
    expect(parseEntryTerm(t)).toBeNull();
  });
});

describe("enteringYearForEntryTerm", () => {
  it("a fall entrant's semesters start in their start year", () => {
    expect(enteringYearForEntryTerm("FA25")).toBe(2025);
    expect(semesterLabel(1, enteringYearForEntryTerm("FA25")).primary).toBe("Fall 2025");
  });

  it("a spring entrant's academic year began the previous fall", () => {
    expect(enteringYearForEntryTerm("SP26")).toBe(2025);
    // Their first term lands in the second column, labelled correctly.
    expect(semesterLabel(2, enteringYearForEntryTerm("SP26")).primary).toBe("Spring 2026");
  });

  it("unknown or malformed terms give no year", () => {
    expect(enteringYearForEntryTerm(null)).toBeNull();
    expect(enteringYearForEntryTerm("SU25")).toBeNull();
  });
});

describe("guessEntryFromEnteringYear", () => {
  it("pre-selects the fall of a known start year, nothing otherwise", () => {
    expect(guessEntryFromEnteringYear(2024)).toEqual({ season: "FA", year: 2024 });
    expect(guessEntryFromEnteringYear(null)).toBeNull();
  });
});

describe("startYearOptions", () => {
  it("offers the last three years, this year and next, from the date (review F11)", () => {
    expect(startYearOptions(new Date(2026, 9, 25))).toEqual([2023, 2024, 2025, 2026, 2027]);
  });
});
