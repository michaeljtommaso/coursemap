import { describe, it, expect } from "vitest";
import {
  parseRosterSlug,
  semesterTermYear,
  horizonForSemester,
} from "./horizon";

describe("parseRosterSlug", () => {
  it("parses a valid slug (2-digit year → 2000s)", () => {
    expect(parseRosterSlug("FA26")).toEqual({ term: "FA", year: 2026 });
    expect(parseRosterSlug("SP27")).toEqual({ term: "SP", year: 2027 });
    expect(parseRosterSlug("SU25")).toEqual({ term: "SU", year: 2025 });
    expect(parseRosterSlug("WI26")).toEqual({ term: "WI", year: 2026 });
  });

  it("is case-insensitive and trims", () => {
    expect(parseRosterSlug("fa26")).toEqual({ term: "FA", year: 2026 });
    expect(parseRosterSlug("  FA26 ")).toEqual({ term: "FA", year: 2026 });
  });

  it("returns null for malformed / unknown / empty input (defensive)", () => {
    expect(parseRosterSlug(null)).toBeNull();
    expect(parseRosterSlug(undefined)).toBeNull();
    expect(parseRosterSlug("")).toBeNull();
    expect(parseRosterSlug("FA2026")).toBeNull(); // 4-digit year
    expect(parseRosterSlug("F26")).toBeNull(); // 1-letter term
    expect(parseRosterSlug("XX26")).toBeNull(); // unknown term
    expect(parseRosterSlug("FA2")).toBeNull(); // 1-digit year
    expect(parseRosterSlug("2026")).toBeNull();
  });
});

describe("semesterTermYear", () => {
  it("odd sem = Fall, even = Spring, year from enteringYear", () => {
    expect(semesterTermYear(1, 2026)).toEqual({ term: "FA", year: 2026 });
    expect(semesterTermYear(2, 2026)).toEqual({ term: "SP", year: 2027 });
    expect(semesterTermYear(3, 2026)).toEqual({ term: "FA", year: 2027 });
    expect(semesterTermYear(8, 2026)).toEqual({ term: "SP", year: 2030 });
  });

  it("null enteringYear → null (no calendar placement possible)", () => {
    expect(semesterTermYear(1, null)).toBeNull();
  });
});

describe("horizonForSemester", () => {
  const entering = 2026; // sem1 = FA26, sem2 = SP27, sem3 = FA27 …

  it("near iff exact term+year equality with the target", () => {
    expect(horizonForSemester(1, entering, "FA26")).toBe("near");
    expect(horizonForSemester(2, entering, "SP27")).toBe("near");
  });

  it("past iff strictly before the target", () => {
    // Target SP27 (sem2). Sem1 = FA26 is chronologically before it.
    expect(horizonForSemester(1, entering, "SP27")).toBe("past");
    // Target FA27 (sem3). Sems 1 and 2 are before it.
    expect(horizonForSemester(1, entering, "FA27")).toBe("past");
    expect(horizonForSemester(2, entering, "FA27")).toBe("past");
  });

  it("far for everything beyond the target", () => {
    expect(horizonForSemester(3, entering, "FA26")).toBe("far");
    expect(horizonForSemester(8, entering, "FA26")).toBe("far");
  });

  it("null enteringYear OR null/malformed target → far for everything (honest default)", () => {
    expect(horizonForSemester(1, null, "FA26")).toBe("far");
    expect(horizonForSemester(1, entering, null)).toBe("far");
    expect(horizonForSemester(1, entering, undefined)).toBe("far");
    expect(horizonForSemester(1, entering, "garbage")).toBe("far");
  });
});
