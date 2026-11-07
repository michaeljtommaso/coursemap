import { describe, it, expect } from "vitest";
import {
  CourseMarksSchema,
  FactAnswersSchema,
  LayerSchema,
  PlanSchema,
  QuestionSchema,
  ShareCreateSchema,
  ShareSchema,
  UserProfileSchema,
} from "./schemas";

/** Schema tests for the spec 020 answer fields and the layer `questions` list. */

const plan = (extra: Record<string, unknown> = {}) => ({ name: "Plan", programId: "p", schemaVersion: 3, ...extra });
const share = (extra: Record<string, unknown> = {}) => ({
  createdBy: "uid-1",
  planName: "Plan",
  programId: "p",
  programName: "Program",
  enteringYear: 2025,
  schemaVersion: 3,
  ...extra,
});
const manyMarks = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:BIOMI-${4000 + i}`, 3]));

describe("PlanSchema.courseMarks", () => {
  it("is optional (old plans parse unchanged)", () => {
    expect(PlanSchema.parse(plan()).courseMarks).toBeUndefined();
  });

  it("accepts yes / no / credit values", () => {
    const courseMarks = { "usedAs:cas-college/fws@ENGL-2880": "yes", "approvedFor:p/mcb@BIOMG-6330": "no", "creditsTaken:BIOMI-4850": 3 };
    expect(PlanSchema.parse(plan({ courseMarks })).courseMarks).toEqual(courseMarks);
  });

  it("drops malformed entries without failing the plan", () => {
    const courseMarks = {
      "usedAs:cas-college/fws@ENGL-2880": "yes",
      "bad.key": "yes",
      "approvedFor:p/mcb@BIOMG-6330": "maybe",
      "creditsTaken:BIOMI-4850": 21,
      "creditsTaken:BIOMI-4851": -1,
    };
    const parsed = PlanSchema.parse(plan({ courseMarks }));
    expect(parsed.courseMarks).toEqual({ "usedAs:cas-college/fws@ENGL-2880": "yes" });
    expect(PlanSchema.parse(plan({ courseMarks: "not a map" })).courseMarks).toEqual({});
    expect(PlanSchema.parse(plan({ courseMarks: ["yes"] })).courseMarks).toEqual({});
  });

  it("keeps at most 80 entries on read; the strict write schema rejects 81", () => {
    expect(Object.keys(PlanSchema.parse(plan({ courseMarks: manyMarks(81) })).courseMarks!)).toHaveLength(80);
    expect(CourseMarksSchema.safeParse(manyMarks(80)).success).toBe(true);
    expect(CourseMarksSchema.safeParse(manyMarks(81)).success).toBe(false);
    expect(CourseMarksSchema.safeParse({ "bad.key": "yes" }).success).toBe(false);
  });

  it("works through PlanSchema.partial() (the plan save path)", () => {
    expect(PlanSchema.partial().parse({ courseMarks: { "creditsTaken:BIOMI-4850": 2 } }).courseMarks).toEqual({
      "creditsTaken:BIOMI-4850": 2,
    });
  });
});

describe("ShareSchema / ShareCreateSchema — spec 020 fields", () => {
  it("old shares parse without them", () => {
    const s = ShareSchema.parse(share());
    expect(s.courseMarks).toBeUndefined();
    expect(s.collegeRuleSet).toBeUndefined();
    expect(s.concentrationIds).toBeUndefined();
    expect(ShareCreateSchema.safeParse(share()).success).toBe(true);
  });

  it("accept marks, a rule set and concentrations", () => {
    const extra = { courseMarks: { "creditsTaken:BIOMI-4850": 3 }, collegeRuleSet: "cals-college-2025", concentrationIds: ["a", "b"] };
    const s = ShareSchema.parse(share(extra));
    expect(s).toMatchObject(extra);
    expect(ShareCreateSchema.safeParse(share(extra)).success).toBe(true);
  });

  it("read tolerates malformed values; create rejects them", () => {
    const bad = { courseMarks: { "a.b": "yes", "creditsTaken:X-1": 3 }, collegeRuleSet: "Not An Id!", concentrationIds: ["a", "b", "c", "d"] };
    const s = ShareSchema.parse(share(bad));
    expect(s.courseMarks).toEqual({ "creditsTaken:X-1": 3 });
    expect(s.collegeRuleSet).toBeUndefined();
    expect(s.concentrationIds).toBeUndefined();
    expect(ShareCreateSchema.safeParse(share({ courseMarks: { "a.b": "yes" } })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ collegeRuleSet: "x".repeat(41) })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ concentrationIds: ["a", "b", "c", "d"] })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ concentrationIds: ["x".repeat(65)] })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ courseMarks: manyMarks(81) })).success).toBe(false);
  });
});

describe("UserProfileSchema prefs.tours (spec 033)", () => {
  it("reads the owed / seen marks", () => {
    const tours = UserProfileSchema.parse({ prefs: { tours: { planner: 1, requirements: 0 } } }).prefs?.tours;
    expect(tours).toEqual({ planner: 1, requirements: 0 });
  });

  it("a malformed mark reads as absent, never a parse failure", () => {
    const r = UserProfileSchema.safeParse({ prefs: { tours: { planner: "yes", classes: 0 } } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.prefs?.tours).toEqual({ classes: 0 });
  });

  it("a profile from before the tours has no map at all", () => {
    expect(UserProfileSchema.parse({ prefs: {} }).prefs?.tours).toBeUndefined();
  });
});

describe("UserProfileSchema prefs.answers", () => {
  it("accepts yes / no facts", () => {
    const answers = { "studentFact:honorsProgram:LING": "yes", "studentFact:departmentExamPassed:ECON": "no" };
    expect(UserProfileSchema.parse({ prefs: { answers } }).prefs?.answers).toEqual(answers);
  });

  it("drops malformed entries and never fails the profile", () => {
    const answers = { "studentFact:honorsProgram:LING": "yes", "bad key": "yes", "studentFact:x:y": 3, "studentFact:a:b": "maybe" };
    const parsed = UserProfileSchema.safeParse({ prefs: { answers, entryTerm: "FA25" } });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.prefs?.answers).toEqual({ "studentFact:honorsProgram:LING": "yes" });
    expect(parsed.data?.prefs?.entryTerm).toBe("FA25");
    expect(UserProfileSchema.parse({ prefs: { answers: 7 } }).prefs?.answers).toEqual({});
  });

  it("caps at 30 on read; the strict write schema rejects 31", () => {
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`studentFact:honorsProgram:S${i}`, "yes"]));
    expect(Object.keys(UserProfileSchema.parse({ prefs: { answers: many } }).prefs!.answers!)).toHaveLength(30);
    expect(FactAnswersSchema.safeParse(many).success).toBe(false);
    const thirty = Object.fromEntries(Object.entries(many).slice(0, 30));
    expect(FactAnswersSchema.safeParse(thirty).success).toBe(true);
  });
});

describe("QuestionSchema / LayerSchema.questions", () => {
  const source = { url: "https://catalog.cornell.edu/", anchor: "test" };
  const base = { source, quote: "A sentence from the catalog." };
  const questions = [
    { ...base, type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] } },
    { ...base, type: "approvedFor", row: "fws", courses: { subject: ["BIOMG"] }, approver: "dus" },
    { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] },
    { ...base, type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4301", "NTRES-4302"], credits: 4 },
    { ...base, type: "courseCondition", row: "fws", courses: { subject: ["PMA"] }, condition: "taughtByDepartmentFaculty" },
    { ...base, type: "studentFact", fact: "acceptedToProgram", subject: "cornell-aem-bs" },
    { ...base, type: "studentFact", fact: "honorsProgram", subject: "LING", row: "fws" },
  ];
  const layer = (qs: unknown[]) => ({
    id: "test-layer",
    kind: "college",
    family: "cas",
    name: "Test",
    catalogYear: "2026-27",
    rows: [{ id: "fws", kind: "seat", label: "FWS", group: "G", source, exclusive: true, rule: { titleStartsWith: "FWS:" } }],
    questions: qs,
  });

  it("accepts each question type", () => {
    for (const q of questions) expect(QuestionSchema.safeParse(q).success, q.type).toBe(true);
    expect(LayerSchema.safeParse(layer(questions)).success).toBe(true);
  });

  it("rejects unknown types, approvers, conditions, facts and extra keys", () => {
    expect(QuestionSchema.safeParse({ ...base, type: "freeText", text: "?" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[1], approver: "dean" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[4], condition: "online" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[5], fact: "isSenior" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[0], prompt: "free text" }).success).toBe(false);
  });

  it("rejects an empty quote, empty credit values and non-key-safe ids", () => {
    expect(QuestionSchema.safeParse({ ...questions[0], quote: "" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[2], values: [] }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[2], course: "BIOMI 4850" }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...questions[5], subject: "a.b" }).success).toBe(false);
  });

  it("caps a layer at 20 questions", () => {
    const twenty = Array.from({ length: 20 }, () => questions[5]);
    expect(LayerSchema.safeParse(layer(twenty)).success).toBe(true);
    expect(LayerSchema.safeParse(layer([...twenty, questions[5]])).success).toBe(false);
  });

  it("no new shape nests an array directly inside an array (Firestore)", () => {
    const nested = (x: unknown): boolean =>
      Array.isArray(x) ? x.some((v) => Array.isArray(v) || nested(v)) : typeof x === "object" && x !== null && Object.values(x).some(nested);
    expect(nested(questions)).toBe(false);
    expect(nested(PlanSchema.parse(plan({ courseMarks: { "creditsTaken:BIOMI-4850": 3 } })))).toBe(false);
    expect(nested(ShareSchema.parse(share({ concentrationIds: ["a"], courseMarks: { "creditsTaken:X-1": 3 } })))).toBe(false);
  });
});
