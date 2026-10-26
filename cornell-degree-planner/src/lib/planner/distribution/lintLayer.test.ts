import { describe, it, expect } from "vitest";
import { lintLayer } from "./lintLayer";
import type { DistributionRow, Layer, Row } from "./types";

const SRC = { url: "https://catalog.cornell.edu/arts-sciences/", anchor: "Requirements" };

const layer = (rows: Row[], over: Partial<Layer> = {}): Layer => ({
  id: "test-layer",
  kind: "college",
  family: "cas",
  name: "Test",
  catalogYear: "2026-27",
  rows,
  ...over,
});

const seat = (id: string, over: Partial<Row> = {}): Row =>
  ({ id, kind: "seat", label: id, group: "G", source: SRC, rule: { tag: ["ALC-AS"] }, ...over }) as Row;

const dist = (over: Partial<DistributionRow> = {}): Row => ({
  id: "dist",
  kind: "distribution",
  label: "Distribution",
  group: "G",
  source: SRC,
  categories: [
    { id: "a", label: "A", rule: { tag: ["A"] } },
    { id: "b", label: "B", rule: { tag: ["B"] } },
  ],
  requiredCourses: 2,
  minDistinctCategories: 2,
  ...over,
});

/** Lint must report a line containing `fragment`. */
function expectLint(l: Layer, fragment: string) {
  const errs = lintLayer(l);
  expect(errs.some((e) => e.includes(fragment)), `${fragment} in ${JSON.stringify(errs)}`).toBe(true);
}

describe("lintLayer", () => {
  it("accepts a clean layer", () => {
    expect(lintLayer(layer([seat("one"), dist()]))).toEqual([]);
  });

  it("flags duplicate top-level ids", () => {
    expectLint(layer([seat("one"), seat("one")]), "duplicate row id");
  });

  it("flags anyOf child ids that repeat a top-level id or each other", () => {
    const anyOf = (childIds: string[]): Row =>
      ({
        id: "either",
        kind: "anyOf",
        label: "Either",
        group: "G",
        source: SRC,
        rows: childIds.map((id) => ({ id, kind: "seat", label: id, group: "G", source: SRC, rule: { tag: ["X"] } })),
      }) as Row;
    expectLint(layer([seat("one"), anyOf(["one", "two"])]), "repeats a top-level row id");
    expectLint(layer([anyOf(["two", "two"])]), "duplicate child row id");
  });

  it("flags distribution inconsistencies", () => {
    expectLint(layer([dist({ perCategory: { z: { min: 1 } } })]), "perCategory key z");
    expectLint(layer([dist({ perCategory: { a: { min: 2, max: 1 } } })]), "min > max");
    expectLint(layer([dist({ minDistinctCategories: 3 })]), "exceeds the 2 categories");
    expectLint(
      layer([dist({ perCategory: { a: { max: 1 }, b: { max: 1 } }, requiredCourses: 3 })]),
      "requiredCourses 3 exceeds the 2 courses"
    );
    expectLint(layer([dist({ perCategory: { a: { max: 0 } } })]), "categories that allow a course");
    expectLint(
      layer([dist({ categories: [{ id: "a", label: "A", rule: { tag: ["A"] } }, { id: "a", label: "A2", rule: { tag: ["B"] } }], minDistinctCategories: 1 })]),
      "duplicate category id a"
    );
    expectLint(layer([dist({ maxDoubleCountCourses: 2 })]), "maxDoubleCountCourses is set");
  });

  it("flags subject groups that overlap or have no cap", () => {
    const overlapping = dist({ maxPerSubject: 2, subjectGroups: [["FREN", "SPAN"], ["SPAN", "ITAL"]] });
    expect(lintLayer(layer([overlapping]))).toContain("test-layer:dist: subject SPAN is in more than one subject group");
    const uncapped = dist({ subjectGroups: [["FREN", "SPAN"]] });
    expect(lintLayer(layer([uncapped]))).toContain("test-layer:dist: subjectGroups without maxPerSubject has no effect");
    expect(lintLayer(layer([dist({ maxPerSubject: 2, subjectGroups: [["FREN", "SPAN"]] })]))).toEqual([]);
  });

  it("flags limit bounds that conflict", () => {
    const pool = (limits: object[]): Row =>
      ({ id: "p", kind: "pool", label: "P", group: "G", source: SRC, rule: { tag: ["X"] }, requiredCourses: 0, requiredCredits: 9, limits }) as Row;
    expectLint(layer([pool([{ rule: { tag: ["X"] }, minCourses: 2, maxCourses: 1 }])]), "minCourses > maxCourses");
    expectLint(layer([pool([{ rule: { tag: ["X"] }, minCredits: 6, maxCredits: 3 }])]), "minCredits > maxCredits");
    expectLint(layer([pool([{ rule: { tag: ["X"] } }])]), "sets no bound");
    expectLint(layer([pool([{ rule: { tag: ["X"] }, maxCourses: 0, minCredits: 3 }])]), "allows no course");
  });

  it("flags flag conflicts", () => {
    expectLint(layer([seat("one", { overlay: true, exclusive: true })]), "both overlay and exclusive");
    const credits = { id: "c", kind: "credits", label: "C", group: "G", source: SRC, rule: { tag: ["X"] }, requiredCredits: 10, exclusive: true } as Row;
    expectLint(layer([credits]), "credits row cannot be exclusive");
  });

  it("flags layer-kind fields", () => {
    expectLint(layer([seat("one")], { kind: "major" }), "needs a programId");
    expectLint(layer([seat("one")], { kind: "concentration", programId: "p" }), "needs a concentrationId");
    expectLint(layer([seat("one")], { programId: "p" }), "college layer must not have a programId");
  });

  it("flags non-Cornell source hosts and empty entry-term ranges", () => {
    expectLint(layer([seat("one", { source: { url: "https://example.com/x", anchor: "A" } })]), "not on a cornell.edu host");
    expectLint(layer([seat("one", { source: { url: "https://cornell.edu.example.com/x", anchor: "A" } })]), "not on a cornell.edu host");
    expect(lintLayer(layer([seat("one", { source: { url: "https://as.cornell.edu/x", anchor: "A" } })]))).toEqual([]);
    expectLint(layer([seat("one")], { appliesTo: [{ enteredFrom: "FA26", enteredBefore: "FA25" }] }), "empty entry-term range");
  });
});

describe("lintLayer — concentrations", () => {
  const major = (c: { min: number; max: number } | undefined, over: Partial<Layer> = {}) =>
    layer([seat("one")], { kind: "major", programId: "p", ...(c ? { concentrations: c } : {}), ...over });

  it("accepts a valid range on a major, and none at all", () => {
    expect(lintLayer(major({ min: 1, max: 2 }))).toEqual([]);
    expect(lintLayer(major({ min: 0, max: 1 }))).toEqual([]);
    expect(lintLayer(major(undefined))).toEqual([]);
  });

  it("rejects min > max", () => {
    expectLint(major({ min: 2, max: 1 }), "min 2 exceeds max 1");
  });

  it("rejects the field on a non-major layer", () => {
    expectLint(layer([seat("one")], { concentrations: { min: 0, max: 1 } }), "only a major layer may set concentrations");
    expectLint(
      layer([seat("one")], {
        kind: "concentration",
        programId: "p",
        concentrationId: "c",
        concentrations: { min: 0, max: 1 },
      }),
      "only a major layer may set concentrations"
    );
  });

  it("rejects non-integers, negatives and max 0", () => {
    expectLint(major({ min: 0, max: 0 }), "0 <= min and max >= 1");
    expectLint(major({ min: -1, max: 1 }), "0 <= min and max >= 1");
    expectLint(major({ min: 0.5, max: 1 }), "0 <= min and max >= 1");
  });
});
