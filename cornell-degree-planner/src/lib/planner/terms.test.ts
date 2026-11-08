import { describe, it, expect } from "vitest";
import {
  SEASON_ORDER,
  columnKey,
  refOf,
  sameColumn,
  sanitizeShortTerms,
  shortTermSeason,
  termOfColumn,
  toColumnRef,
} from "./terms";
import { semesterLabel } from "./semesters";
import { termOrdinal } from "./distribution/select";
import type { ColumnRef } from "@/types/plan";

describe("columnKey (spec 042 D3 time order)", () => {
  it("short term before k = 2k − 1, semester k = 2k", () => {
    expect(columnKey({ sem: 1, shortTerm: true })).toBe(1);
    expect(columnKey({ sem: 1 })).toBe(2);
    expect(columnKey({ sem: 2, shortTerm: true })).toBe(3);
    expect(columnKey({ sem: 2, shortTerm: false })).toBe(4);
    expect(columnKey({ sem: 10, shortTerm: true })).toBe(19);
    expect(columnKey({ sem: 10 })).toBe(20);
  });

  it("orders summer before sem 1 < sem 1 < winter before sem 2 < sem 2 < … < sem 10", () => {
    const ordered: ColumnRef[] = [];
    for (let k = 1; k <= 10; k++) {
      ordered.push({ sem: k, shortTerm: true });
      ordered.push({ sem: k });
    }
    const keys = ordered.map(columnKey);
    for (let i = 1; i < keys.length; i++) expect(keys[i]).toBeGreaterThan(keys[i - 1]);
  });
});

describe("refOf / sameColumn / toColumnRef", () => {
  it("refOf normalizes shortTerm to a boolean (only an exact true counts)", () => {
    expect(refOf({ sem: 3 })).toEqual({ sem: 3, shortTerm: false });
    expect(refOf({ sem: 3, shortTerm: true })).toEqual({ sem: 3, shortTerm: true });
    expect(refOf({ sem: 3, shortTerm: "yes" as unknown as true })).toEqual({ sem: 3, shortTerm: false });
  });

  it("sameColumn compares sem and the short-term flag (missing = false)", () => {
    expect(sameColumn({ sem: 2 }, { sem: 2, shortTerm: false })).toBe(true);
    expect(sameColumn({ sem: 2, shortTerm: true }, { sem: 2, shortTerm: true })).toBe(true);
    expect(sameColumn({ sem: 2 }, { sem: 2, shortTerm: true })).toBe(false);
    expect(sameColumn({ sem: 2 }, { sem: 3 })).toBe(false);
  });

  it("toColumnRef reads a plain number as a regular semester", () => {
    expect(toColumnRef(4)).toEqual({ sem: 4, shortTerm: false });
    expect(toColumnRef({ sem: 4, shortTerm: true })).toEqual({ sem: 4, shortTerm: true });
    expect(toColumnRef({ sem: 4 })).toEqual({ sem: 4, shortTerm: false });
  });
});

describe("shortTermSeason", () => {
  it("before a Fall (odd) is a Summer; before a Spring (even) is a Winter", () => {
    expect(shortTermSeason(1)).toBe("SU");
    expect(shortTermSeason(2)).toBe("WI");
    expect(shortTermSeason(9)).toBe("SU");
    expect(shortTermSeason(10)).toBe("WI");
  });
});

describe("termOfColumn (spec 042 D11)", () => {
  it("every season for a Fall 2025 entrant", () => {
    expect(termOfColumn({ sem: 1, shortTerm: true }, 2025)).toEqual({
      season: "SU",
      year: 2025,
      slug: "SU25",
      label: "Summer 2025",
    });
    expect(termOfColumn({ sem: 1 }, 2025)).toEqual({ season: "FA", year: 2025, slug: "FA25", label: "Fall 2025" });
    expect(termOfColumn({ sem: 2, shortTerm: true }, 2025)).toEqual({
      season: "WI",
      year: 2026,
      slug: "WI26",
      label: "Winter 2026",
    });
    expect(termOfColumn({ sem: 2 }, 2025)).toEqual({ season: "SP", year: 2026, slug: "SP26", label: "Spring 2026" });
    expect(termOfColumn({ sem: 3, shortTerm: true }, 2025)).toEqual({
      season: "SU",
      year: 2026,
      slug: "SU26",
      label: "Summer 2026",
    });
    expect(termOfColumn({ sem: 3 }, 2025)).toEqual({ season: "FA", year: 2026, slug: "FA26", label: "Fall 2026" });
  });

  it("year boundaries: a Winter takes the January year of the Spring after it", () => {
    // Fall 2026 (sem 3) → Winter 2027 → Spring 2027 (sem 4).
    expect(termOfColumn({ sem: 3 }, 2025).year).toBe(2026);
    expect(termOfColumn({ sem: 4, shortTerm: true }, 2025).slug).toBe("WI27");
    expect(termOfColumn({ sem: 4 }, 2025).slug).toBe("SP27");
    // The last columns: Summer before sem 9, Winter before sem 10.
    expect(termOfColumn({ sem: 9, shortTerm: true }, 2025).slug).toBe("SU29");
    expect(termOfColumn({ sem: 10, shortTerm: true }, 2025).slug).toBe("WI30");
    // Century-safe two-digit slug.
    expect(termOfColumn({ sem: 2, shortTerm: true }, 2099).slug).toBe("WI00");
  });

  it("columns in time order give chronological slugs (termOrdinal agrees)", () => {
    const ordinals: number[] = [];
    for (let k = 1; k <= 10; k++) {
      for (const shortTerm of [true, false]) {
        ordinals.push(termOrdinal(termOfColumn({ sem: k, shortTerm }, 2025).slug!)!);
      }
    }
    for (let i = 1; i < ordinals.length; i++) expect(ordinals[i]).toBeGreaterThan(ordinals[i - 1]);
  });

  it("no entering year: no year, no slug, a bare season label", () => {
    expect(termOfColumn({ sem: 1, shortTerm: true }, null)).toEqual({
      season: "SU",
      year: null,
      slug: null,
      label: "Summer",
    });
    expect(termOfColumn({ sem: 2, shortTerm: true }, undefined)).toEqual({
      season: "WI",
      year: null,
      slug: null,
      label: "Winter",
    });
    expect(termOfColumn({ sem: 1 }, null).label).toBe("Fall");
    expect(termOfColumn({ sem: 2 }, null).label).toBe("Spring");
  });

  it("regular columns 1–10 match semesterLabel exactly", () => {
    for (const enteringYear of [2022, 2025, 2026, null]) {
      for (let k = 1; k <= 10; k++) {
        const t = termOfColumn({ sem: k }, enteringYear);
        const l = semesterLabel(k, enteringYear);
        expect(t.label).toBe(l.primary);
        expect(t.year).toBe(l.calendarYear);
      }
    }
  });

  it("SEASON_ORDER is Cornell's in-year order: WI < SP < SU < FA", () => {
    expect(SEASON_ORDER.WI).toBeLessThan(SEASON_ORDER.SP);
    expect(SEASON_ORDER.SP).toBeLessThan(SEASON_ORDER.SU);
    expect(SEASON_ORDER.SU).toBeLessThan(SEASON_ORDER.FA);
  });
});

describe("sanitizeShortTerms", () => {
  it("keeps integers 1..10, dedupes, sorts", () => {
    expect(sanitizeShortTerms([3, 1, 3, 0, 11, 2.5, "4", null, 10])).toEqual([1, 3, 10]);
  });
  it("a non-array reads as none", () => {
    expect(sanitizeShortTerms(undefined)).toEqual([]);
    expect(sanitizeShortTerms({ 1: true })).toEqual([]);
  });
});
