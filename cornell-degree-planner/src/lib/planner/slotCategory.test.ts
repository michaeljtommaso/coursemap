import { describe, it, expect } from "vitest";
import {
  normalizeCategory,
  subjectCategory,
  deriveSlotCategory,
  groupIsLiberal,
  SLOT_CATEGORIES,
  CATEGORY_META,
} from "./slotCategory";

describe("normalizeCategory", () => {
  it("accepts every enum value verbatim", () => {
    for (const c of SLOT_CATEGORIES) expect(normalizeCategory(c)).toBe(c);
  });
  it("is case/whitespace insensitive", () => {
    expect(normalizeCategory("Math")).toBe("math");
    expect(normalizeCategory("  SCIENCE ")).toBe("science");
  });
  it("degrades unknown / non-string to null (renders as pre-D1)", () => {
    expect(normalizeCategory("engineering")).toBeNull();
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(7)).toBeNull();
  });
  it("has display metadata for every enum value", () => {
    for (const c of SLOT_CATEGORIES) expect(CATEGORY_META[c]).toBeTruthy();
  });
});

describe("subjectCategory", () => {
  it("maps MATH → math", () => {
    expect(subjectCategory("MATH")).toBe("math");
    expect(subjectCategory("math")).toBe("math");
  });
  it("maps natural sciences → science", () => {
    for (const s of ["PHYS", "CHEM", "BIO", "BIOMG", "BIOG", "EAS"])
      expect(subjectCategory(s)).toBe("science");
  });
  it("maps writing seminars → fws and phys-ed → pe", () => {
    expect(subjectCategory("FWS")).toBe("fws");
    expect(subjectCategory("WRIT")).toBe("fws");
    expect(subjectCategory("PE")).toBe("pe");
    expect(subjectCategory("PHYED")).toBe("pe");
  });
  it("returns null for subjects without a confident mapping (no 'Eng' mislabel)", () => {
    for (const s of ["ENGRI", "ENGRD", "CS", "ECE", "MAE", "MSE", "CEE", "BME", "AEP", "BEE", "CHEME", "ORIE", "INFO"])
      expect(subjectCategory(s)).toBeNull();
    expect(subjectCategory("HADM")).toBeNull();
    expect(subjectCategory("MUSIC")).toBeNull();
  });
});

describe("groupIsLiberal", () => {
  it("recognizes the liberal-studies category rule", () => {
    expect(groupIsLiberal({ id: "liberal-studies", qualifyingRule: { type: "category", category: "liberal-studies" } })).toBe(true);
  });
  it("recognizes it by group id alone", () => {
    expect(groupIsLiberal({ id: "cs-liberal", qualifyingRule: { type: "list" } })).toBe(true);
  });
  it("is false for a free/technical elective group", () => {
    expect(groupIsLiberal({ id: "advisor-elective-open", qualifyingRule: { type: "open" } })).toBe(false);
    expect(groupIsLiberal(null)).toBe(false);
    expect(groupIsLiberal(undefined)).toBe(false);
  });
});

describe("deriveSlotCategory", () => {
  it("derives course slots from their subject", () => {
    expect(deriveSlotCategory({ kind: "course", courseId: "MATH-1910" })).toBe("math");
    expect(deriveSlotCategory({ kind: "course", courseId: "PHYS-1112" })).toBe("science");
    expect(deriveSlotCategory({ kind: "course", courseId: "CS-2110" })).toBe("core");
  });
  it("derives pattern slots from the pattern subject", () => {
    expect(deriveSlotCategory({ kind: "pattern", pattern: "PE-1xxx" })).toBe("pe");
    expect(deriveSlotCategory({ kind: "pattern", pattern: "CS-111x" })).toBe("core");
    expect(deriveSlotCategory({ kind: "pattern", pattern: "CHEM-2900" })).toBe("science");
  });
  it("derives attribute slots: FWS match → fws, other → core", () => {
    expect(
      deriveSlotCategory({
        kind: "attribute",
        attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
      })
    ).toBe("fws");
    expect(
      deriveSlotCategory({
        kind: "attribute",
        attributeMatch: { anyOf: [{ field: "attrs.value", op: "in", value: ["ALC-AS"] }] },
      })
    ).toBe("core");
  });
  it("splits elective slots into liberal vs elective by their group", () => {
    const liberalGroup = { id: "liberal-studies", qualifyingRule: { type: "category", category: "liberal-studies" } };
    const openGroup = { id: "advisor-elective-open", qualifyingRule: { type: "open" } };
    expect(deriveSlotCategory({ kind: "elective", electiveGroupId: "liberal-studies" }, liberalGroup)).toBe("liberal");
    expect(deriveSlotCategory({ kind: "elective", electiveGroupId: "advisor-elective-open" }, openGroup)).toBe("elective");
    expect(deriveSlotCategory({ kind: "elective", electiveGroupId: "x" }, null)).toBe("elective");
  });
  it("defaults an unknown/blank slot to core", () => {
    expect(deriveSlotCategory({ kind: "course", courseId: null })).toBe("core");
  });
});
