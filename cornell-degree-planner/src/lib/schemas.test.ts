import { describe, it, expect } from "vitest";
import {
  CatalogMetaSchema,
  CourseMarksSchema,
  FactAnswersSchema,
  LayerSchema,
  MAX_ADDITIONAL_PROGRAMS,
  MAX_MINORS,
  MAX_SECOND_MAJORS,
  MinorIndexEntrySchema,
  MinorIndexSchema,
  PlacementSchema,
  PlanSchema,
  QuestionSchema,
  ShareCreateSchema,
  ShareSchema,
  UserProfileSchema,
  strictAdditionalPrograms,
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

describe("short terms (spec 042): PlacementSchema.shortTerm and shortTerms on plans and shares", () => {
  const placement = (extra: Record<string, unknown> = {}) => ({ id: "p1", courseId: "CS-1110", sem: 2, order: 0, ...extra });
  const oneTo = (n: number) => Array.from({ length: n }, (_, i) => (i % 10) + 1);

  it("a placement takes shortTerm: true and nothing else; absent stays absent", () => {
    expect(PlacementSchema.parse(placement({ shortTerm: true })).shortTerm).toBe(true);
    const plain = PlacementSchema.parse(placement());
    expect("shortTerm" in plain).toBe(false);
    expect(PlacementSchema.safeParse(placement({ shortTerm: false })).success).toBe(false);
    expect(PlacementSchema.safeParse(placement({ shortTerm: "true" })).success).toBe(false);
  });

  it("plans and shares without shortTerms parse unchanged (no key added)", () => {
    expect("shortTerms" in PlanSchema.parse(plan())).toBe(false);
    expect("shortTerms" in ShareSchema.parse(share())).toBe(false);
    expect(ShareCreateSchema.safeParse(share()).success).toBe(true);
  });

  it("accept up to 10 entries, each an integer 1..10", () => {
    expect(PlanSchema.parse(plan({ shortTerms: [1, 2, 10] })).shortTerms).toEqual([1, 2, 10]);
    expect(PlanSchema.safeParse(plan({ shortTerms: oneTo(10) })).success).toBe(true);
    expect(ShareSchema.parse(share({ shortTerms: [3] })).shortTerms).toEqual([3]);
    expect(ShareCreateSchema.safeParse(share({ shortTerms: oneTo(10) })).success).toBe(true);
    expect(PlanSchema.partial().parse({ shortTerms: [4] }).shortTerms).toEqual([4]);
  });

  it("a malformed list (11 entries, out-of-range or non-integer entries, a non-list) reads as none, never a parse failure", () => {
    for (const bad of [oneTo(11), [0], [11], [1.5], ["1"], "1", { 1: true }]) {
      const p = PlanSchema.safeParse(plan({ shortTerms: bad }));
      expect(p.success).toBe(true);
      expect(p.success && p.data.shortTerms).toBeUndefined();
      const s = ShareCreateSchema.safeParse(share({ shortTerms: bad }));
      expect(s.success).toBe(true);
      expect(s.success && s.data.shortTerms).toBeUndefined();
    }
  });

  it("plans and shares carry short-term placements", () => {
    const placements = [placement({ shortTerm: true })];
    expect(PlanSchema.parse(plan({ placements })).placements[0].shortTerm).toBe(true);
    expect(ShareSchema.parse(share({ placements })).placements[0].shortTerm).toBe(true);
  });
});

describe("UserProfileSchema prefs.tours (spec 039)", () => {
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

describe("additionalPrograms (spec 047 D2/D13) on plans and shares", () => {
  const major = (programId = "mathematics-ba", extra: Record<string, unknown> = {}) => ({ programId, kind: "major", ...extra });
  const minor = (programId: string, extra: Record<string, unknown> = {}) => ({ programId, kind: "minor", ...extra });
  const full = [major("mathematics-ba", { concentrationIds: ["applied"] }), minor("cs-minor"), minor("econ-minor"), minor("music-minor")];

  it("plans and shares without it parse unchanged (no key added)", () => {
    expect("additionalPrograms" in PlanSchema.parse(plan())).toBe(false);
    expect("additionalPrograms" in ShareSchema.parse(share())).toBe(false);
    expect(ShareCreateSchema.safeParse(share()).success).toBe(true);
    expect("additionalPrograms" in PlanSchema.partial().parse({ name: "x" })).toBe(false);
  });

  it("reads a full list (1 second major + 3 minors) in order", () => {
    expect(PlanSchema.parse(plan({ additionalPrograms: full })).additionalPrograms).toEqual(full);
    expect(ShareSchema.parse(share({ additionalPrograms: full })).additionalPrograms).toEqual(full);
    expect(PlanSchema.partial().parse({ additionalPrograms: [minor("cs-minor")] }).additionalPrograms).toEqual([minor("cs-minor")]);
  });

  it("read drops malformed entries, repeats, over-cap kinds and concentrations on a minor; a non-list reads as absent", () => {
    const messy = [
      minor("cs-minor"),
      { programId: "", kind: "minor" },
      { programId: "x", kind: "certificate" },
      { programId: "y", kind: "minor", extra: 1 },
      "cs-minor",
      minor("cs-minor"),
      major("mathematics-ba"),
      major("physics-ba"),
      minor("econ-minor", { concentrationIds: ["a"] }),
      minor("music-minor"),
      minor("art-minor"),
      minor("dance-minor"),
    ];
    expect(PlanSchema.parse(plan({ additionalPrograms: messy })).additionalPrograms).toEqual([
      minor("cs-minor"),
      major("mathematics-ba"),
      minor("music-minor"),
      minor("art-minor"),
    ]);
    for (const bad of ["cs-minor", { 0: minor("cs-minor") }, 4, null]) {
      const p = PlanSchema.safeParse(plan({ additionalPrograms: bad }));
      expect(p.success).toBe(true);
      expect(p.success && p.data.additionalPrograms).toBeUndefined();
    }
    expect(PlanSchema.parse(plan({ additionalPrograms: [] })).additionalPrograms).toEqual([]);
  });

  it("strictAdditionalPrograms accepts a valid list and throws on every D2 violation", () => {
    expect(strictAdditionalPrograms(full, "economics-ba")).toEqual(full);
    expect(strictAdditionalPrograms([], "economics-ba")).toEqual([]);
    const throwsOn = (list: unknown, msg: RegExp) => expect(() => strictAdditionalPrograms(list, "economics-ba")).toThrow(msg);
    throwsOn("nope", /additionalPrograms|expected/i);
    throwsOn([...full, minor("art-minor")], /additionalPrograms|4|too big/i);
    throwsOn([major("mathematics-ba"), major("physics-ba")], /one second major/);
    throwsOn([minor("a-minor"), minor("b-minor"), minor("c-minor"), minor("d-minor")], /at most 3 minors/);
    throwsOn([minor("cs-minor"), minor("cs-minor")], /twice/);
    throwsOn([minor("cs-minor", { concentrationIds: ["x"] })], /minor has no concentrations/);
    throwsOn([major("economics-ba")], /primary major/);
    throwsOn([{ programId: "x", kind: "minor", extra: true }], /.+/);
    throwsOn([major("m", { concentrationIds: ["a", "b", "c", "d"] })], /.+/);
    expect(MAX_ADDITIONAL_PROGRAMS).toBe(MAX_SECOND_MAJORS + MAX_MINORS);
  });

  it("ShareCreateSchema checks the list strictly, primary included", () => {
    expect(ShareCreateSchema.safeParse(share({ additionalPrograms: full })).success).toBe(true);
    expect(ShareCreateSchema.safeParse(share({ additionalPrograms: [...full, minor("art-minor")] })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ additionalPrograms: [minor("a"), minor("a")] })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ additionalPrograms: [major("p")] })).success).toBe(false);
    expect(ShareCreateSchema.safeParse(share({ additionalPrograms: "x" })).success).toBe(false);
  });
});

describe("LayerSchema — minor layers and sharing (spec 047 D7/D12/D14)", () => {
  const source = { url: "https://catalog.cornell.edu/", anchor: "test" };
  const layer = (extra: Record<string, unknown> = {}) => ({
    id: "cs-minor",
    kind: "minor",
    family: "other",
    name: "Computer Science minor",
    catalogYear: "2026-27",
    programId: "cs-minor",
    rows: [{ id: "intro", kind: "seat", label: "Intro", group: "G", source, rule: { course: ["CS-2110"] } }],
    ...extra,
  });

  it("accepts a minor layer, family other, and sharing limits", () => {
    expect(LayerSchema.safeParse(layer()).success).toBe(true);
    expect(LayerSchema.safeParse(layer({ sharing: { otherMajors: { maxCourses: 2 }, minors: "none" } })).success).toBe(true);
    expect(
      LayerSchema.safeParse(layer({ kind: "major", family: "cas", sharing: { otherMajors: "forbidden", minors: { maxCredits: 8 } } }))
        .success
    ).toBe(true);
    expect(
      LayerSchema.safeParse(
        layer({ sharing: { otherMajors: { maxCredits: 12, with: ["econ-ba", "government-ba"] }, forbiddenWith: ["cs-bs"] } })
      ).success
    ).toBe(true);
  });

  it("rejects malformed sharing", () => {
    for (const sharing of [
      { minors: "forbidden" },
      { otherMajors: "some" },
      { minors: { maxCourses: -1 } },
      { minors: { maxCourses: 1.5 } },
      { minors: { maxCourses: 2, other: 1 } },
      { majors: "none" },
      { minors: { maxCourses: 1, with: [] } },
      { minors: { maxCourses: 1, with: ["Econ-BA"] } },
      { forbiddenWith: [] },
      { forbiddenWith: ["econ-"] },
      { forbiddenWith: "econ-ba" },
    ]) {
      expect(LayerSchema.safeParse(layer({ sharing })).success, JSON.stringify(sharing)).toBe(false);
    }
    expect(LayerSchema.safeParse(layer({ family: "engineering" })).success).toBe(false);
  });
});

describe("MinorIndexSchema (spec 047 D12)", () => {
  const entry = (extra: Record<string, unknown> = {}) => ({
    id: "cs-minor",
    name: "Computer Science",
    shortName: "CS minor",
    offeredBy: "Bowers CIS",
    catalogYear: "2026-27",
    ...extra,
  });

  it("accepts entries with and without the optional fields", () => {
    expect(MinorIndexSchema.safeParse({ entries: [entry(), entry({ notOpenTo: ["cs-bs"], visible: false })] }).success).toBe(true);
    expect(MinorIndexEntrySchema.parse(entry({ futureField: 1 }))).toMatchObject({ futureField: 1, offeredBy: "Bowers CIS" });
  });

  it("onlyOpenTo is bounded like notOpenTo (spec 047 D12)", () => {
    expect(MinorIndexEntrySchema.parse(entry({ onlyOpenTo: ["cornell-nutr-bs"] })).onlyOpenTo).toEqual(["cornell-nutr-bs"]);
    expect(MinorIndexEntrySchema.safeParse(entry({ onlyOpenTo: [""] })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ onlyOpenTo: ["x".repeat(81)] })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ onlyOpenTo: Array.from({ length: 41 }, (_, i) => `p${i}`) })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ onlyOpenTo: "cornell-nutr-bs" })).success).toBe(false);
  });

  it("rejects malformed entries and more than 300", () => {
    expect(MinorIndexEntrySchema.safeParse(entry({ offeredBy: undefined })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ offeredBy: "" })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ offeredBy: "x".repeat(81) })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ catalogYear: 2026 })).success).toBe(false);
    expect(MinorIndexEntrySchema.safeParse(entry({ name: "" })).success).toBe(false);
    expect(MinorIndexSchema.safeParse({ entries: Array.from({ length: 301 }, () => entry()) }).success).toBe(false);
  });
});

describe("CatalogMetaSchema crossListings (roster cross-listings)", () => {
  const meta = (extra: Record<string, unknown> = {}) => ({ aliases: { "ENGRD-2110": "CS-2110" }, ...extra });

  it("is optional and keeps a well-formed map", () => {
    expect(CatalogMetaSchema.parse(meta()).crossListings).toBeUndefined();
    expect(CatalogMetaSchema.parse(meta({ crossListings: { "HIST-3770": "AMST-3775" } })).crossListings).toEqual({ "HIST-3770": "AMST-3775" });
  });

  it("drops a malformed map without failing the doc (aliases still load)", () => {
    const parsed = CatalogMetaSchema.parse(meta({ crossListings: { "HIST-3770": 42 }, enrollmentTarget: "SP27" }));
    expect(parsed.crossListings).toBeUndefined();
    expect(parsed.aliases).toEqual({ "ENGRD-2110": "CS-2110" });
    expect(parsed.enrollmentTarget).toBe("SP27");
  });
});
