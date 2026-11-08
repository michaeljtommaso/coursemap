import { describe, expect, it } from "vitest";
import { majorScope, scopeNamesMajor, visibleCreditText, type MajorRef } from "./limitScope";

// Lines as Cornell's 2026-27 exam tables write them.
const BIO_LIMIT =
  "Biological Sciences majors: elective credit only. It counts toward the 120 credits to graduate but not toward the major.";
const BIO_NOTE = "Other majors: places you out of 8 credits of introductory biology; ask your major how it counts.";
const ENG_UNSET =
  "Engineering hasn't set which requirement this fills: check with Engineering Advising and your major department.";
const BME_LIMIT = "Biomedical Engineering majors need a 5, not a 4, to place out of BIOMG 1350.";
const CHECK_DEPT = "Check with your major department before counting this toward major requirements.";
const NOT_FOR_BE = "Not for Biological Engineering or Environmental Engineering (BE/EnvE) majors.";
const BEE_LIMIT = "CALS Biological and Environmental Engineering (BEE) majors: credit can only be PHYS 1112.";
const PHYSICS = "Physics majors are advised to give up this credit and take PHYS 1116.";

const ANSC: MajorRef = { name: "Animal Science, B.S.", shortName: "ANSC" };
const BIOSCI: MajorRef = { name: "Biological Sciences, B.A.", shortName: "BIO" };
const BME: MajorRef = { name: "Biomedical Engineering, B.S.", shortName: "BME" };
const BE: MajorRef = { name: "Biological Engineering, B.S.", shortName: "BE" };
const ENVE: MajorRef = { name: "Environmental Engineering, B.S.", shortName: "ENVE" };
const EP: MajorRef = { name: "Engineering Physics, B.S.", shortName: "EP" };

describe("majorScope", () => {
  it("reads the majors a line names", () => {
    expect(majorScope(BIO_LIMIT)).toBe("Biological Sciences");
    expect(majorScope(BME_LIMIT)).toBe("Biomedical Engineering");
    expect(majorScope(NOT_FOR_BE)).toBe("Biological Engineering or Environmental Engineering (BE/EnvE)");
    expect(majorScope(PHYSICS)).toBe("Physics");
  });

  it("a line for everyone has no scope", () => {
    expect(majorScope(BIO_NOTE)).toBeNull();
    expect(majorScope(CHECK_DEPT)).toBeNull();
    expect(majorScope(ENG_UNSET)).toBeNull();
    expect(majorScope("Counts as elective credit. Physics majors should ask.")).toBeNull();
  });
});

describe("scopeNamesMajor", () => {
  it("matches by name, ignoring the degree", () => {
    expect(scopeNamesMajor("Biological Sciences", BIOSCI)).toBe(true);
    expect(scopeNamesMajor("Biological Sciences", { name: "Biological Sciences (BA)" })).toBe(true);
    expect(scopeNamesMajor("Biological Sciences", { name: "Animal Science (BS)" })).toBe(false);
    expect(scopeNamesMajor("Biological Sciences", ANSC)).toBe(false);
  });

  it("matches by abbreviation, including the BEE department alias", () => {
    expect(scopeNamesMajor(majorScope(NOT_FOR_BE)!, ENVE)).toBe(true);
    expect(scopeNamesMajor(majorScope(BEE_LIMIT)!, BE)).toBe(true);
    // "Biological and Environmental Engineering" also contains Environmental
    // Engineering's name; harmless, since the line is only in the CALS table.
  });

  it("a longer major name doesn't match a shorter scope", () => {
    expect(scopeNamesMajor("Physics", EP)).toBe(false);
  });
});

describe("visibleCreditText", () => {
  const bio = { limits: [BIO_LIMIT], note: BIO_NOTE };

  it("Animal Science sees the note for other majors, not the Biological Sciences line", () => {
    expect(visibleCreditText(bio, ANSC)).toEqual({
      limits: [],
      note: "Places you out of 8 credits of introductory biology; ask your major how it counts.",
    });
  });

  it("Biological Sciences sees its own line and not the note for other majors", () => {
    expect(visibleCreditText(bio, BIOSCI)).toEqual({ limits: [BIO_LIMIT] });
  });

  it("with no major chosen, everything shows as written", () => {
    expect(visibleCreditText(bio, null)).toEqual({ limits: [BIO_LIMIT], note: BIO_NOTE });
  });

  it("hides 'hasn't set which requirement' once the credit fills one", () => {
    const c = { limits: [ENG_UNSET, BME_LIMIT] };
    expect(visibleCreditText(c, BME, ["Biology elective"])).toEqual({ limits: [BME_LIMIT] });
    expect(visibleCreditText(c, BME, [])).toEqual({ limits: [ENG_UNSET, BME_LIMIT] });
    expect(visibleCreditText(c, BME)).toEqual({ limits: [ENG_UNSET, BME_LIMIT] });
    expect(visibleCreditText(c, EP, ["Biology elective"])).toEqual({ limits: [] });
  });

  it("lines for everyone always show", () => {
    expect(visibleCreditText({ limits: [CHECK_DEPT] }, ANSC)).toEqual({ limits: [CHECK_DEPT] });
  });

  it("a note for named majors shows only to them", () => {
    const c = { limits: [], note: "Biomedical Engineering majors: a 5 also places you out of BIOMG 1350." };
    expect(visibleCreditText(c, BME).note).toBe(c.note);
    expect(visibleCreditText(c, EP).note).toBeUndefined();
  });
});
