import { describe, expect, it } from "vitest";
import { buildMatchPool, countsTowardFields } from "./matchAdapters";
import { courseMatchesRuleFavoured } from "./distribution/rules";
import { grantsFor } from "./distribution/engine";
import { solve } from "./distribution";
import { assign, type PoolRequirement, type SeatRequirement } from "./majorMatch";
import { liberalStudiesGroupsOf } from "./liberalStudies";
import { CreditEntrySchema, type CreditEntry } from "@/lib/schemas";
import type { CourseRule, DistCourse, Layer, Row, StudentContext } from "./distribution/types";

/**
 * Spec 046 — a "No Cornell equivalent" transfer the student says counts
 * toward a distribution area or a requirement row.
 */

const transfer = (countsToward?: CreditEntry["countsToward"]): CreditEntry => ({
  id: "transfer:1",
  kind: "transfer",
  label: "Intro to Film, Tompkins Cortland CC",
  satisfiesCourseIds: [],
  credits: 3,
  ...(countsToward ? { countsToward } : {}),
});

const poolOf = (entry: CreditEntry): DistCourse[] =>
  buildMatchPool({ placements: [], placedCourses: {}, creditProfile: [entry] });

const C = (id: string, tags: string[] = []): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits: 3, attrs: tags.map((value) => ({ value })) };
};

const source = { url: "https://example.edu/catalog", anchor: "req" };
const base = (id: string) => ({ id, label: id, group: "Test", source });
const layer = (id: string, rows: Row[]): Layer => ({
  id,
  kind: "major",
  family: "cas",
  name: id,
  catalogYear: "2026-27",
  rows,
});
const ctx: StudentContext = { programId: "test-program", entryTerm: "FA25", transfer: "external" };

const econElectives: Row = {
  ...base("econ-4000"),
  kind: "pool",
  rule: { allOf: [{ subject: ["ECON"] }, { number: { min: 4000 } }] },
  requiredCourses: 2,
  requiredCredits: 6,
};
const outsideMajor: Row = {
  ...base("outside"),
  kind: "seat",
  rule: { allOf: [{ number: { min: 2000 } }, { not: { subject: ["ECON"] } }] },
};
const histPool: Row = {
  ...base("hist"),
  kind: "pool",
  rule: { subject: ["HIST"] },
  requiredCourses: 1,
  requiredCredits: 3,
};
const noTransfer: Row = {
  ...base("no-transfer"),
  kind: "seat",
  rule: { allOf: [{ subject: ["ECON"] }, { not: { creditKind: ["transfer"] } }] },
};
const distRow: Row = {
  ...base("distribution"),
  kind: "distribution",
  categories: [
    { id: "alc", label: "ALC", rule: { tag: ["ALC-AS"] } },
    { id: "hst", label: "HST", rule: { tag: ["HST-AS"] } },
  ],
  requiredCourses: 2,
  minDistinctCategories: 2,
};
const econ = layer("econ", [econElectives, histPool]);
/** Each scenario's rows in a layer of their own, so no other row competes. */
const layers: Record<string, Layer> = {
  "econ-4000": econ,
  hist: econ,
  outside: layer("econ", [outsideMajor]),
  "no-transfer": layer("econ", [noTransfer]),
  distribution: layer("econ", [distRow]),
};

const rowStatus = (courses: DistCourse[], rowId: string) =>
  solve({ layers: [layers[rowId]], courses, ctx }).layers[0].rows.find((r) => r.rowId === rowId)!;

describe("CountsToward schema (D5)", () => {
  it("keeps a valid choice and drops a malformed one without losing the entry", () => {
    const ok = CreditEntrySchema.parse(transfer({ row: "econ:econ-4000" }));
    expect(ok.countsToward).toEqual({ row: "econ:econ-4000" });
    const bad = CreditEntrySchema.parse({ ...transfer(), countsToward: { row: "x", areas: ["ALC-AS"] } });
    expect(bad.countsToward).toBeUndefined();
    expect(bad.label).toBe("Intro to Film, Tompkins Cortland CC");
  });
});

describe("countsTowardFields / buildMatchPool (D6)", () => {
  it("is empty without a choice, so the credit course is unchanged", () => {
    expect(countsTowardFields(undefined)).toEqual({});
    const [c] = poolOf(transfer());
    expect(c).not.toHaveProperty("attrs");
    expect(c).not.toHaveProperty("placedFor");
  });

  it("maps roster tags to attrs and LS groups to liberalStudiesGroups", () => {
    expect(countsTowardFields({ areas: ["ALC-AS", "LS:g2"] })).toEqual({
      attrs: [{ value: "ALC-AS" }],
      liberalStudiesGroups: ["g2"],
    });
  });

  it("maps a row choice to placedFor on the credit-only course", () => {
    const [c] = poolOf(transfer({ row: "econ:distribution", categories: ["alc"] }));
    expect(c.id).toBe("credit:transfer:1");
    expect(c.placedFor).toEqual({ row: "econ:distribution", categories: ["alc"] });
  });

  it("ignores countsToward on exam credit", () => {
    const exam = { ...transfer({ areas: ["ALC-AS"] }), kind: "ap" as const };
    expect(poolOf(exam)[0].attrs).toBeUndefined();
  });
});

describe("courseMatchesRuleFavoured", () => {
  const [credit] = poolOf(transfer({ row: "econ:outside" }));
  it("reads identity leaves in the rule's favour, inside and outside a not", () => {
    const rules: CourseRule[] = [
      { subject: ["ECON"] },
      { not: { subject: ["ECON"] } },
      { allOf: [{ subject: ["ECON"] }, { number: { min: 4000 } }] },
      { anyOf: [{ course: ["ECON-1110"] }, { tag: ["ALC-AS"] }] },
    ];
    for (const r of rules) expect(courseMatchesRuleFavoured(credit, r)).toBe(true);
  });
  it("keeps credit-kind and credit leaves", () => {
    expect(courseMatchesRuleFavoured(credit, { not: { creditKind: ["transfer"] } })).toBe(false);
    expect(courseMatchesRuleFavoured(credit, { minCredits: 4 })).toBe(false);
  });
});

describe("A&S/CALS engine: a placed credit fills its row only", () => {
  const cornell = C("ECON-4110");

  it("fills the chosen pool; without the choice it doesn't", () => {
    expect(rowStatus([cornell, ...poolOf(transfer())], "econ-4000").status).toBe("partial");
    const placed = rowStatus([cornell, ...poolOf(transfer({ row: "econ:econ-4000" }))], "econ-4000");
    expect(placed.status).toBe("met");
    expect(placed.courses.map((c) => c.courseId)).toContain("credit:transfer:1");
  });

  it("an 'outside the major, 2000+' seat accepts it (no number to check)", () => {
    expect(rowStatus(poolOf(transfer()), "outside").status).toBe("unmet");
    expect(rowStatus(poolOf(transfer({ row: "econ:outside" })), "outside").status).toBe("met");
  });

  it("a row that refuses transfer credit still refuses it", () => {
    expect(rowStatus(poolOf(transfer({ row: "econ:no-transfer" })), "no-transfer").status).toBe("unmet");
  });

  it("doesn't leak into other rows", () => {
    const courses = poolOf(transfer({ row: "econ:econ-4000" }));
    expect(rowStatus(courses, "hist").status).toBe("unmet");
  });

  it("a distribution row counts it only in the picked area", () => {
    const courses = [C("HIST-1530", ["HST-AS"]), ...poolOf(transfer({ row: "econ:distribution", categories: ["alc"] }))];
    expect(rowStatus(courses, "distribution").status).toBe("met");
    const none = [C("HIST-1530", ["HST-AS"]), ...poolOf(transfer({ row: "econ:distribution" }))];
    expect(rowStatus(none, "distribution").status).toBe("partial");
  });

  it("an area tag counts through the course's attrs, in any program", () => {
    const courses = [C("HIST-1530", ["HST-AS"]), ...poolOf(transfer({ areas: ["ALC-AS"] }))];
    expect(rowStatus(courses, "distribution").status).toBe("met");
  });

  it("a stale target (no such row or layer) grants nothing", () => {
    expect(grantsFor(poolOf(transfer({ row: "econ:gone" })), [econ]).size).toBe(0);
    expect(grantsFor(poolOf(transfer({ row: "history:econ-4000" })), [econ]).size).toBe(0);
    expect(grantsFor(poolOf(transfer({ row: "cs-s1-math1910" })), [econ]).size).toBe(0);
  });
});

describe("Engineering engine: assign takes the placed edge", () => {
  const seat: SeatRequirement = {
    id: "cs-s4-cs3110",
    kind: "seat",
    req: { kind: "course", courseId: "CS-3110" },
    credits: 3,
    label: "CS 3110",
  };
  const techElective: PoolRequirement = {
    id: "cs-technical-elective",
    kind: "pool",
    rule: { type: "level", subject: "CS", min_number: 3000 },
    minCredits: 3,
    requiredCourses: 1,
    courseIds: [],
    label: "Technical elective",
    computable: true,
  };

  it("fills the chosen pool and nothing else", () => {
    const placed = assign(poolOf(transfer({ row: "cs-technical-elective" })), [seat, techElective]);
    expect(placed.matched).toEqual([
      { courseId: "credit:transfer:1", requirementId: "cs-technical-elective", credits: 3 },
    ]);
    expect(assign(poolOf(transfer()), [seat, techElective]).matched).toEqual([]);
  });

  it("fills a chosen seat", () => {
    const placed = assign(poolOf(transfer({ row: "cs-s4-cs3110" })), [seat, techElective]);
    expect(placed.matched.map((m) => m.requirementId)).toEqual(["cs-s4-cs3110"]);
  });

  it("a liberal studies group pick counts in that group", () => {
    const [c] = poolOf(transfer({ areas: ["LS:g7"] }));
    expect(liberalStudiesGroupsOf(c, "fa2024")).toEqual(["g7"]);
    expect(liberalStudiesGroupsOf(c, "fa2020")).toEqual(["g7"]);
  });
});
