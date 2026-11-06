import { describe, it, expect } from "vitest";
import {
  seedPlanFromPrevious,
  defaultCarryMark,
  isCollegeLayerId,
  mergeSeedMarks,
  mergeSeedTried,
  planContentIsEmpty,
  coursesLeftBehind,
  leftBehindMessage,
  type PrevPlanSnapshot,
} from "./seedPlanFromPrevious";
import { columnPlacements } from "./placementOps";
import type { RemapTargetSlot, RemapCourse } from "./remapPlacements";
import type { Placement } from "@/types/plan";
import { CourseMarksSchema, MAX_COURSE_MARKS, MAX_TRIED_COURSES } from "@/lib/schemas";

function course(id: string, title?: string): RemapCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title };
}

const P = (id: string, courseId: string, sem: number, order: number): Placement => ({
  id,
  courseId,
  sem,
  order,
});

function prevPlan(partial: Partial<PrevPlanSnapshot> = {}): PrevPlanSnapshot {
  return {
    placements: [],
    placedCourses: {},
    completedIds: [],
    inProgressIds: [],
    ...partial,
  };
}

const orieTargets: RemapTargetSlot[] = [
  { id: "orie-calc", kind: "course", courseId: "MATH-1910" },
  { id: "orie-tech", kind: "pattern", pattern: "CS-2xxx" },
  {
    id: "orie-fws",
    kind: "attribute",
    attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
  },
];

const fourCourses = (): PrevPlanSnapshot =>
  prevPlan({
    placements: [
      P("p-calc", "MATH-1910", 1, 0),
      P("p-fws", "ENGL-1134", 1, 1),
      P("p-2110", "CS-2110", 3, 0),
      P("p-music", "MUSIC-1201", 5, 0),
    ],
    placedCourses: {
      "MATH-1910": course("MATH-1910"),
      "CS-2110": course("CS-2110"),
      "ENGL-1134": course("ENGL-1134", "FWS: True Stories"),
      "MUSIC-1201": course("MUSIC-1201"),
    },
  });

describe("seedPlanFromPrevious — every placement travels (spec 009 §4 intent, spec 014 model)", () => {
  it("carries every placement at the same column and position, with the same ids", () => {
    const prev = fourCourses();
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed).not.toBeNull();
    expect(seed.placements).toEqual(prev.placements);
    expect(seed.kept).toBe(4);
    expect([...seed.courseIds].sort()).toEqual(["CS-2110", "ENGL-1134", "MATH-1910", "MUSIC-1201"]);
  });

  it("counts matched = carried courses that fill a new-program requirement (exact / pattern / attribute)", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets)!;
    // MATH-1910 exact, CS-2110 pattern, ENGL-1134 attribute; MUSIC-1201 counts toward nothing.
    expect(seed.matched).toBe(3);
  });

  it("completed / in-progress marks travel with their placement", () => {
    const prev = { ...fourCourses(), completedIds: ["p-calc"], inProgressIds: ["p-music"] };
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed.completedIds).toEqual(["p-calc"]);
    expect(seed.inProgressIds).toEqual(["p-music"]);
  });

  it("skips a placement whose course data is gone (never invent a course), and its marks", () => {
    const prev = prevPlan({
      placements: [P("p1", "MATH-1910", 1, 0), P("p2", "GONE-1", 1, 1)],
      placedCourses: { "MATH-1910": course("MATH-1910") },
      completedIds: ["p2"],
    });
    const seed = seedPlanFromPrevious(prev, orieTargets)!;
    expect(seed.placements.map((p) => p.id)).toEqual(["p1"]);
    expect(seed.completedIds).toEqual([]);
    expect(seed.kept).toBe(1);
  });

  it("returns null when the previous plan has nothing to carry", () => {
    expect(seedPlanFromPrevious(prevPlan(), orieTargets)).toBeNull();
    expect(
      seedPlanFromPrevious(prevPlan({ placements: [P("x", "GONE-1", 1, 0)] }), orieTargets)
    ).toBeNull();
  });

  it("is pure — inputs are not mutated", () => {
    const prev = { ...fourCourses(), completedIds: ["p-calc"] };
    const before = JSON.stringify(prev);
    seedPlanFromPrevious(prev, orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    expect(JSON.stringify(prev)).toBe(before);
  });

  it("is deterministic — same inputs, same seed (switch-back safe)", () => {
    const a = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    const b = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s1", "ORIE-3300", 5, 0)]);
    expect(a).toEqual(b);
  });
});

describe("seedPlanFromPrevious — the new program's starting board (spec 014 §D6)", () => {
  it("adds the new program's fixed courses under the carried cards of their column", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets, [
      P("s-3300", "ORIE-3300", 5, 0),
      P("s-1112", "PHYS-1112", 1, 0),
    ])!;
    expect(columnPlacements(seed.placements, 5).map((p) => p.courseId)).toEqual([
      "MUSIC-1201",
      "ORIE-3300",
    ]);
    expect(columnPlacements(seed.placements, 1).map((p) => p.courseId)).toEqual([
      "MATH-1910",
      "ENGL-1134",
      "PHYS-1112",
    ]);
    expect(seed.courseIds).toContain("ORIE-3300");
    // kept counts only what the student carried, not the new defaults
    expect(seed.kept).toBe(4);
  });

  it("does not duplicate a fixed course the student already carries", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets, [P("s-calc", "MATH-1910", 1, 0)])!;
    expect(seed.placements.filter((p) => p.courseId === "MATH-1910")).toHaveLength(1);
    expect(seed.placements.some((p) => p.id === "s-calc")).toBe(false);
  });
});

describe("planContentIsEmpty — the seed-or-load decision", () => {
  const empty = { placements: [], completedIds: [], inProgressIds: [], waivedRequirementIds: [] };

  it("true for a fresh/created (or legacy-normalized) plan doc", () => {
    expect(planContentIsEmpty(empty)).toBe(true);
  });

  it("false when ANY student content exists (load untouched, no seeding)", () => {
    expect(planContentIsEmpty({ ...empty, placements: [P("p", "CS-1110", 1, 0)] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, completedIds: ["p"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, inProgressIds: ["p"] })).toBe(false);
    expect(planContentIsEmpty({ ...empty, waivedRequirementIds: ["r"] })).toBe(false);
  });
});

describe("coursesLeftBehind / leftBehindMessage (U-8)", () => {
  const pl = (id: string, courseId: string, sem: number, order: number) => ({ id, courseId, sem, order });

  it("lists previous-board courses missing from the loaded plan, in board order, once each", () => {
    const prev = {
      placements: [pl("a", "CHEME-3230", 4, 1), pl("b", "CHEME-2200", 4, 0), pl("c", "MATH-1910", 1, 0), pl("d", "CHEME-2200", 5, 0)],
    };
    const loaded = { placements: [{ courseId: "MATH-1910" }] };
    expect(coursesLeftBehind(prev, loaded)).toEqual(["CHEME-2200", "CHEME-3230"]);
  });

  it("nothing left behind → no message", () => {
    expect(coursesLeftBehind({ placements: [pl("a", "MATH-1910", 1, 0)] }, { placements: [{ courseId: "MATH-1910" }] })).toEqual([]);
    expect(leftBehindMessage([], "ChemE")).toBeNull();
  });

  it("one short sentence: names up to two courses, else the first and a count", () => {
    expect(leftBehindMessage(["CHEME 2200"], "ChemE")).toBe("CHEME 2200 stays in your ChemE plan.");
    expect(leftBehindMessage(["CHEME 2200", "CHEM 2091"], "ChemE")).toBe(
      "CHEME 2200 and CHEM 2091 stay in your ChemE plan."
    );
    expect(leftBehindMessage(["A 1", "B 2", "C 3", "D 4"], "ChemE")).toBe(
      "A 1 and 3 more stay in your ChemE plan."
    );
  });
});

describe("seedPlanFromPrevious — course marks on a major switch (spec 020 D5)", () => {
  const CAS_FWS = "usedAs:cas-college/fws@ENGL-2880";
  const CALS_WRITING = "approvedFor:cals-college-2025/written-expression@ENGL-2880";
  const CALS_OLD = "courseCondition:cals-college-pre2025/ql@MATH-1110";
  const MAJOR_ROW = "approvedFor:cas-history/seminar@HIST-4000";
  const CONC_ROW = "approvedFor:cals-biology-mcb/advanced@BIOMG-6330";
  const CREDITS = "creditsTaken:BIOMI-4850";
  const SEQUENCE = "sequenceDone:NTRES-4300";
  const marks = {
    [CAS_FWS]: "yes" as const,
    [CALS_WRITING]: "no" as const,
    [CALS_OLD]: "yes" as const,
    [MAJOR_ROW]: "yes" as const,
    [CONC_ROW]: "yes" as const,
    [CREDITS]: 3,
    [SEQUENCE]: "yes" as const,
  };

  it("carries college-layer and credit marks, leaves major and concentration rows behind", () => {
    const seed = seedPlanFromPrevious({ ...fourCourses(), courseMarks: marks }, orieTargets)!;
    expect(seed.courseMarks).toEqual({
      [CAS_FWS]: "yes",
      [CALS_WRITING]: "no",
      [CALS_OLD]: "yes",
      [CREDITS]: 3,
      [SEQUENCE]: "yes",
    });
  });

  it("an injected carryMark predicate decides instead (a precise caller passes the new program's asked refs)", () => {
    const asked = new Set(["approvedFor:cas-history/seminar"]);
    const seed = seedPlanFromPrevious({ ...fourCourses(), courseMarks: marks }, orieTargets, [], {
      carryMark: (key) => asked.has(key.split("@")[0]),
    })!;
    expect(seed.courseMarks).toEqual({ [MAJOR_ROW]: "yes" });
  });

  it("a plan with no marks seeds none; waivers still never carry", () => {
    const seed = seedPlanFromPrevious(fourCourses(), orieTargets)!;
    expect(seed.courseMarks).toEqual({});
    expect(seed).not.toHaveProperty("waivedRequirementIds");
  });

  it("defaultCarryMark rejects malformed keys, facts, and row marks without a course", () => {
    expect(defaultCarryMark(CAS_FWS)).toBe(true);
    expect(defaultCarryMark(CREDITS)).toBe(true);
    expect(defaultCarryMark(MAJOR_ROW)).toBe(false);
    expect(defaultCarryMark("usedAs:cas-college/fws")).toBe(false); // a ref, not a row-mark key
    expect(defaultCarryMark("creditsTaken:BIOMI-4850@BIOMI-4850")).toBe(false);
    expect(defaultCarryMark("studentFact:honorsProgram:cas-linguistics")).toBe(false);
    expect(defaultCarryMark("not a key")).toBe(false);
    expect(defaultCarryMark("")).toBe(false);
  });
});

describe("isCollegeLayerId — college layers by naming convention (spec 020 D5)", () => {
  it("recognises today's college layers and a future version without a code change", () => {
    for (const id of ["cas-college", "cals-college-2025", "cals-college-pre2025", "cas-college-2027", "cals-college-2026"]) {
      expect(isCollegeLayerId(id)).toBe(true);
    }
  });

  it("never matches a program or concentration layer", () => {
    for (const id of [
      "cornell-college-scholar-ba-2026",
      "cornell-history-ba-2026",
      "cornell-history-ba-2026--europe",
      "cas-colleges",
      "cals-collegeX",
      "xcas-college",
    ]) {
      expect(isCollegeLayerId(id)).toBe(false);
    }
  });

  it("defaultCarryMark carries a row mark asked by a future college version", () => {
    expect(defaultCarryMark("usedAs:cas-college-2027/fws@ENGL-2880")).toBe(true);
    expect(defaultCarryMark("approvedFor:cals-college-2026/ethics@PHIL-1440")).toBe(true);
    expect(defaultCarryMark("usedAs:cornell-history-ba-2026/premodern@HIST-1200")).toBe(false);
  });
});

describe("mergeSeedMarks — a major-switch seed stays under the mark cap (spec 020 D5)", () => {
  const marks = (prefix: string, n: number, value: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:${prefix}-${2000 + i}`, value]));

  it("50 carried + 40 target marks: capped at 80, every target mark kept, carried fill the rest in order", () => {
    const carried = marks("BIOMI", 50, 3);
    const target = marks("CHEM", 40, 4);
    const merged = mergeSeedMarks(target, carried);
    expect(Object.keys(merged)).toHaveLength(MAX_COURSE_MARKS);
    for (const key of Object.keys(target)) expect(merged[key]).toBe(4);
    expect(Object.keys(merged).slice(40)).toEqual(Object.keys(carried).slice(0, 40));
    // The strict schema the plan save runs accepts it (the uncapped merge didn't).
    expect(CourseMarksSchema.safeParse({ ...carried, ...target }).success).toBe(false);
    expect(CourseMarksSchema.safeParse(merged).success).toBe(true);
  });

  it("the target plan's answer wins on a shared key", () => {
    expect(mergeSeedMarks({ "creditsTaken:CHEM-2070": 4 }, { "creditsTaken:CHEM-2070": 3, "creditsTaken:CHEM-2080": 4 })).toEqual({
      "creditsTaken:CHEM-2070": 4,
      "creditsTaken:CHEM-2080": 4,
    });
  });

  it("under the cap it is a plain union", () => {
    expect(mergeSeedMarks(undefined, { "creditsTaken:CHEM-2070": 4 })).toEqual({ "creditsTaken:CHEM-2070": 4 });
    expect(mergeSeedMarks({}, {})).toEqual({});
  });
});

describe("seedPlanFromPrevious — tried classes on a major switch (spec 025 D12)", () => {
  it("carries the old plan's tried classes as they are (they name courses, not requirements)", () => {
    const seed = seedPlanFromPrevious({ ...fourCourses(), triedCourseIds: ["CS-2110", "PSYCH-1101"] }, orieTargets)!;
    expect(seed.triedCourseIds).toEqual(["CS-2110", "PSYCH-1101"]);
  });

  it("a plan with none seeds none", () => {
    expect(seedPlanFromPrevious(fourCourses(), orieTargets)!.triedCourseIds).toEqual([]);
  });

  it("an EMPTY old board with tried classes still seeds them, on the new starting board (audit F3)", () => {
    const start = [P("s-calc", "MATH-1910", 1, 0)];
    const seed = seedPlanFromPrevious(prevPlan({ triedCourseIds: ["HIST-1530", "PHIL-1100"] }), orieTargets, start);
    expect(seed).not.toBeNull();
    expect(seed!.triedCourseIds).toEqual(["HIST-1530", "PHIL-1100"]);
    expect(seed!.placements.map((p) => p.courseId)).toEqual(["MATH-1910"]);
    expect(seed!.kept).toBe(0);
    expect(seed!.matched).toBe(0);
  });

  it("an EMPTY old board carries its carried course marks too; none of either → null", () => {
    const seed = seedPlanFromPrevious(
      prevPlan({ triedCourseIds: ["HIST-1530"], courseMarks: { "creditsTaken:CHEM-2070": 4, "usedAs:ore-major/x@A-1": "yes" } }),
      orieTargets
    );
    expect(seed!.courseMarks).toEqual({ "creditsTaken:CHEM-2070": 4 });
    // A mark the new program wouldn't ask, and no tried classes: nothing to carry.
    expect(seedPlanFromPrevious(prevPlan({ courseMarks: { "usedAs:ore-major/x@A-1": "yes" } }), orieTargets)).toBeNull();
  });

  it("mergeSeedTried: the target plan's own first, then the carried, deduped, never past 20", () => {
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${1000 + i}`);
    expect(mergeSeedTried(["A-1"], ["B-1", "A-1"])).toEqual(["A-1", "B-1"]);
    expect(mergeSeedTried(undefined, ["B-1"])).toEqual(["B-1"]);
    const merged = mergeSeedTried(ids("T", 15), ids("C", 10));
    expect(merged).toHaveLength(MAX_TRIED_COURSES);
    expect(merged.slice(0, 15)).toEqual(ids("T", 15));
  });
});
