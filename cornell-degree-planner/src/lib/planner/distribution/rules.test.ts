import { describe, it, expect } from "vitest";
import { courseMatchesRule } from "./rules";
import { LayerSchema, CourseRuleSchema } from "@/lib/schemas";
import type { CourseRule, DistCourse } from "./types";

const course = (over: Partial<DistCourse> = {}): DistCourse => ({
  id: "HIST-1530",
  subject: "HIST",
  number: "1530",
  title: "Introduction to Asian American History",
  credits: 4,
  attrs: [{ value: "HST-AS" }, { value: "SCD-AS" }],
  ...over,
});

describe("courseMatchesRule leaves", () => {
  const cases: [string, CourseRule, Partial<DistCourse>, boolean][] = [
    ["tag hit", { tag: ["SCD-AS"] }, {}, true],
    ["tag miss", { tag: ["ALC-AS"] }, {}, false],
    ["tag on a course with no attrs", { tag: ["HST-AS"] }, { attrs: null }, false],
    ["subject hit", { subject: ["HIST", "ASIAN"] }, {}, true],
    ["subject miss", { subject: ["ENGL"] }, {}, false],
    ["cross-listed subject ignored by default", { subject: ["AAS"] }, { crossListedSubjects: ["AAS"] }, false],
    ["cross-listed subject when asked", { subject: ["AAS"], crossListed: true }, { crossListedSubjects: ["AAS"] }, true],
    ["number in range", { number: { min: 1000, max: 1999 } }, {}, true],
    ["number below min", { number: { min: 2000 } }, {}, false],
    ["number above max (inclusive bound)", { number: { max: 1530 } }, {}, true],
    ["number not numeric", { number: { min: 0 } }, { number: "XXXX" }, false],
    ["course id", { course: ["HIST-1530"] }, {}, true],
    ["pattern", { pattern: "HIST 1xxx" }, {}, true],
    ["title prefix", { titleStartsWith: "FWS:" }, {}, false],
    ["min credits hit", { minCredits: 3 }, {}, true],
    ["min credits miss", { minCredits: 5 }, {}, false],
    ["variable credit", { variableCredit: true }, { creditsMax: 6 }, true],
    ["fixed credit", { variableCredit: true }, { creditsMax: 4 }, false],
    ["credit kind on a real course", { creditKind: ["ap"] }, {}, false],
    ["credit kind match", { creditKind: ["ap"] }, { isCredit: true, creditKind: "ap" }, true],
    ["credit kind other", { creditKind: ["ap"] }, { isCredit: true, creditKind: "transfer" }, false],
    ["credit of unknown kind matches (fail closed)", { creditKind: ["ap"] }, { isCredit: true }, true],
  ];
  for (const [name, rule, over, want] of cases) {
    it(name, () => expect(courseMatchesRule(course(over), rule)).toBe(want));
  }

  it("course ids compare through the canonicalizer", () => {
    const canonical = (id: string) => (id === "ASIAN-1530" ? "HIST-1530" : id);
    expect(courseMatchesRule(course(), { course: ["ASIAN-1530"] }, { canonical })).toBe(true);
  });

  it("program reads the context, not the course", () => {
    expect(courseMatchesRule(course(), { program: ["cornell-aem-bs-2026"] }, { programId: "cornell-aem-bs-2026" })).toBe(true);
    expect(courseMatchesRule(course(), { program: ["cornell-aem-bs-2026"] }, {})).toBe(false);
  });
});

describe("courseMatchesRule combinators", () => {
  const distributionEligible: CourseRule = {
    allOf: [{ minCredits: 3 }, { not: { variableCredit: true } }, { not: { creditKind: ["ap", "ib", "transfer"] } }],
  };
  it("allOf / not: a 4-credit fixed course is eligible", () => {
    expect(courseMatchesRule(course(), distributionEligible)).toBe(true);
  });
  it("allOf / not: AP credit is not", () => {
    expect(courseMatchesRule(course({ isCredit: true, creditKind: "ap" }), distributionEligible)).toBe(false);
  });
  it("anyOf", () => {
    expect(courseMatchesRule(course(), { anyOf: [{ tag: ["ALC-AS"] }, { subject: ["HIST"] }] })).toBe(true);
    expect(courseMatchesRule(course(), { anyOf: [{ tag: ["ALC-AS"] }, { subject: ["ENGL"] }] })).toBe(false);
  });
});

describe("layer schema", () => {
  const src = { url: "https://catalog.cornell.edu/arts-sciences/", anchor: "Distribution Requirements" };
  const layer = {
    id: "cas-college",
    kind: "college",
    family: "cas",
    name: "Arts & Sciences",
    catalogYear: "2026-27",
    rows: [
      { id: "fws", kind: "seat", label: "First-year writing seminar", group: "Writing", source: src, exclusive: true, rule: { titleStartsWith: "FWS:" } },
      { id: "advisor", kind: "confirm", label: "80 letter-graded credits", group: "Credits", source: src },
    ],
  };
  it("accepts a well-formed layer", () => {
    expect(LayerSchema.safeParse(layer).success).toBe(true);
  });
  it("rejects an unknown row key (strict: a typo must not change meaning)", () => {
    const bad = { ...layer, rows: [{ ...layer.rows[1], exclusve: true }] };
    expect(LayerSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an unknown rule leaf", () => {
    expect(CourseRuleSchema.safeParse({ tags: ["ALC-AS"] }).success).toBe(false);
    expect(CourseRuleSchema.safeParse({ tag: ["ALC-AS"], subject: ["HIST"] }).success).toBe(false);
  });
  it("rejects a bad entry term", () => {
    expect(LayerSchema.safeParse({ ...layer, appliesTo: [{ enteredBefore: "Fall 2025" }] }).success).toBe(false);
    expect(LayerSchema.safeParse({ ...layer, appliesTo: [{ enteredBefore: "FA25" }] }).success).toBe(true);
  });
  it("anyOf needs at least two children and no confirm child", () => {
    const anyOf = (rows: unknown[]) => ({ ...layer, rows: [{ id: "lang", kind: "anyOf", label: "Language", group: "Language", source: src, rows }] });
    const seat = { id: "opt1", kind: "seat", label: "Option 1", group: "Language", source: src, rule: { tag: ["FLOPI-AS"] } };
    expect(LayerSchema.safeParse(anyOf([seat])).success).toBe(false);
    expect(LayerSchema.safeParse(anyOf([seat, { ...seat, id: "opt2" }])).success).toBe(true);
    expect(LayerSchema.safeParse(anyOf([seat, { id: "c", kind: "confirm", label: "x", group: "y", source: src }])).success).toBe(false);
  });
});
