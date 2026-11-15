import { describe, it, expect } from "vitest";
import { lintExamScores, lintLayer, lintLayerWarnings } from "./lintLayer";
import type { ExamTables } from "@/lib/credit/types";
import type { DistributionRow, Layer, Question, Row } from "./types";

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

  it("an anyOf option may apply to some students only (the engine never counts it for others)", () => {
    // Economics: exam credit without the placement exam, only for students who
    // started before May 1, 2026.
    const gated = (appliesTo: object[]): Row =>
      ({
        id: "intro",
        kind: "anyOf",
        label: "Intro",
        group: "G",
        source: SRC,
        rows: [
          { id: "standard", kind: "seat", label: "Standard", group: "G", source: SRC, rule: { tag: ["X"] } },
          { id: "early", kind: "seat", label: "Early", group: "G", source: SRC, rule: { tag: ["Y"] }, appliesTo },
        ],
      }) as Row;
    expect(lintLayer(layer([gated([{ enteredBefore: "SU26" }])]))).toEqual([]);
    expectLint(layer([gated([{ enteredFrom: "FA26", enteredBefore: "FA25" }])]), "intro/early");
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

describe("lintLayer — courseSharing", () => {
  const conc = (over: Partial<Layer> = {}) =>
    layer([seat("one")], { kind: "concentration", programId: "p", concentrationId: "c", ...over });

  it("accepts either value on a concentration, and none at all", () => {
    expect(lintLayer(conc({ courseSharing: "separate" }))).toEqual([]);
    expect(lintLayer(conc({ courseSharing: "shared" }))).toEqual([]);
    expect(lintLayer(conc())).toEqual([]);
  });

  it("rejects it on a major or college layer", () => {
    expectLint(layer([seat("one")], { kind: "major", programId: "p", courseSharing: "separate" }), "only a concentration layer may set courseSharing");
    expectLint(layer([seat("one")], { courseSharing: "shared" }), "only a concentration layer may set courseSharing");
  });
});

describe("lintLayer — minor layers and sharing (spec 047 D7/D12/D14)", () => {
  const minor = (over: Partial<Layer> = {}) => layer([seat("one")], { kind: "minor", programId: "cs-minor", ...over });
  const major = (over: Partial<Layer> = {}) => layer([seat("one")], { kind: "major", programId: "p", ...over });

  it("accepts a clean minor layer, in a college family or in \"other\"", () => {
    expect(lintLayer(minor())).toEqual([]);
    expect(lintLayer(minor({ family: "other" }))).toEqual([]);
    expect(lintLayer(minor({ family: "cals" }))).toEqual([]);
  });

  it("a minor needs a programId and has no concentrations, courseSharing or concentrationId", () => {
    expectLint(layer([seat("one")], { kind: "minor" }), "a minor layer needs a programId");
    expectLint(minor({ concentrations: { min: 0, max: 1 } }), "only a major layer may set concentrations");
    expectLint(minor({ courseSharing: "shared" }), "only a concentration layer may set courseSharing");
    expectLint(minor({ concentrationId: "c" }), "a minor layer must not have a concentrationId");
  });

  it('only a minor may use family "other"', () => {
    expectLint(major({ family: "other" }), 'only a minor layer may use family "other"');
    expectLint(layer([seat("one")], { family: "other" }), 'only a minor layer may use family "other"');
    expectLint(
      layer([seat("one")], { kind: "concentration", programId: "p", concentrationId: "c", family: "other" }),
      'only a minor layer may use family "other"'
    );
  });

  it("accepts sharing on major and minor layers", () => {
    expect(lintLayer(major({ sharing: { otherMajors: "forbidden", minors: { maxCourses: 2 } } }))).toEqual([]);
    expect(lintLayer(major({ sharing: { otherMajors: { maxCourses: 2, maxCredits: 8 }, minors: "none" } }))).toEqual([]);
    expect(lintLayer(major({ sharing: { otherMajors: { maxCourses: 0 } } }))).toEqual([]);
    expect(lintLayer(minor({ sharing: { otherMajors: { maxCourses: 2 }, minors: "none" } }))).toEqual([]);
    expect(lintLayer(major({ sharing: {} }))).toEqual([]);
  });

  it("accepts with-scoped limits and forbiddenWith on majors and minors", () => {
    expect(
      lintLayer(
        major({
          sharing: {
            otherMajors: { maxCredits: 12, with: ["cornell-econ-ba", "government-ba"] },
            minors: { maxCourses: 2 },
            forbiddenWith: ["biology-society-ba"],
          },
        })
      )
    ).toEqual([]);
    expect(lintLayer(minor({ sharing: { minors: { maxCourses: 1, with: ["math-minor"] }, forbiddenWith: ["cs-bs"] } }))).toEqual([]);
  });

  it("concentration layers may set only forbiddenWith; college layers nothing", () => {
    const conc = (sharing: Layer["sharing"]) =>
      layer([seat("one")], { kind: "concentration", programId: "p", concentrationId: "c", sharing });
    expect(lintLayer(conc({ forbiddenWith: ["physics-ba"] }))).toEqual([]);
    expectLint(conc({ minors: "none" }), "a concentration layer may set only sharing.forbiddenWith (has minors)");
    expectLint(conc({ forbiddenWith: ["physics-ba"], otherMajors: { maxCourses: 1 } }), "(has otherMajors)");
    expectLint(layer([seat("one")], { sharing: { minors: "none" } }), "a college layer may not set sharing");
    expectLint(layer([seat("one")], { sharing: { forbiddenWith: ["x"] } }), "a college layer may not set sharing");
  });

  it("with and forbiddenWith are non-empty lists of program id prefixes", () => {
    expectLint(major({ sharing: { forbiddenWith: [] } }), "sharing.forbiddenWith must be a non-empty list");
    expectLint(major({ sharing: { otherMajors: { maxCourses: 1, with: [] } } }), "sharing.otherMajors.with must be a non-empty list");
    for (const bad of ["Econ-BA", "econ ba", "-econ", "econ-", "", "x".repeat(81)]) {
      expectLint(major({ sharing: { forbiddenWith: [bad] } }), "is not a program id prefix");
      expectLint(minor({ sharing: { minors: { maxCourses: 1, with: [bad] } } }), "sharing.minors.with entry");
    }
  });

  it('"forbidden" only in otherMajors, and only on a major', () => {
    const bad = { minors: "forbidden" } as unknown as Layer["sharing"];
    expectLint(major({ sharing: bad }), 'sharing.minors cannot be "forbidden"');
    expectLint(minor({ sharing: { otherMajors: "forbidden" } }), 'only a major layer may set sharing.otherMajors to "forbidden"');
  });

  it("limits are non-negative integers", () => {
    expectLint(major({ sharing: { minors: { maxCourses: -1 } } }), "sharing.minors.maxCourses must be a non-negative integer");
    expectLint(major({ sharing: { otherMajors: { maxCredits: 2.5 } } }), "sharing.otherMajors.maxCredits must be a non-negative integer");
  });
});

describe("lintLayer — questions (spec 020)", () => {
  const Q = { source: SRC, quote: "A sentence from the catalog." };
  const USED = "usedAs:test-layer/fws";
  const APPROVED = "approvedFor:test-layer/elect";
  const FACT = "studentFact:honorsProgram:LING";

  const fws = (over: Partial<Row> = {}): Row =>
    ({
      id: "fws",
      kind: "pool",
      label: "FWS",
      group: "G",
      source: SRC,
      exclusive: true,
      rule: { anyOf: [{ titleStartsWith: "FWS:" }, { allOf: [{ course: ["ENGL-2880"] }, { answered: USED }] }] },
      requiredCourses: 2,
      requiredCredits: 0,
      ...over,
    }) as Row;
  const elect = (rule: object = { allOf: [{ subject: ["BIOMG"] }, { answered: APPROVED }] }): Row =>
    ({ id: "elect", kind: "pool", label: "Electives", group: "G", source: SRC, rule, requiredCourses: 1, requiredCredits: 0 }) as Row;
  const usedAs: Question = { ...Q, type: "usedAs", row: "fws", courses: { course: ["ENGL-2880"] } };
  const approvedFor: Question = { ...Q, type: "approvedFor", row: "elect", courses: { subject: ["BIOMG"] }, approver: "advisor" };
  const fact: Question = { ...Q, type: "studentFact", fact: "honorsProgram", subject: "LING" };

  const clean = () => layer([fws(), elect()], { questions: [usedAs, approvedFor] });

  it("accepts a layer whose questions and answered leaves line up", () => {
    expect(lintLayer(clean())).toEqual([]);
    const withFact = layer([fws(), elect({ anyOf: [{ allOf: [{ subject: ["BIOMG"] }, { answered: APPROVED }] }, { answered: FACT }] })], {
      questions: [usedAs, approvedFor, fact],
    });
    expect(lintLayer(withFact)).toEqual([]);
  });

  it("flags an unknown question type, approver, condition or fact", () => {
    const bad = (q: object) => layer([fws(), elect()], { questions: [usedAs, approvedFor, q as Question] });
    expectLint(bad({ ...Q, type: "freeText" }), "unknown question type freeText");
    expectLint(bad({ ...approvedFor, approver: "dean" }), "unknown approver dean");
    expectLint(bad({ ...Q, type: "courseCondition", row: "elect", courses: { subject: ["X"] }, condition: "online" }), "unknown condition online");
    expectLint(bad({ ...fact, fact: "isSenior" }), "unknown student fact isSenior");
  });

  it("flags a question whose row is not in the layer", () => {
    expectLint(layer([fws(), elect()], { questions: [usedAs, approvedFor, { ...fact, row: "nope" }] }), "question row nope is not a row of this layer");
  });

  it("flags a usedAs target row that is not exclusive", () => {
    expectLint(layer([fws({ exclusive: undefined }), elect()], { questions: [usedAs, approvedFor] }), "must be exclusive");
  });

  it("accepts a usedAs target that is an option of an exclusive anyOf", () => {
    const either = {
      id: "either",
      kind: "anyOf",
      label: "Either",
      group: "G",
      source: SRC,
      exclusive: true,
      rows: [
        { id: "opt-a", kind: "seat", label: "A", group: "G", source: SRC, rule: { tag: ["X"] } },
        { id: "opt-b", kind: "seat", label: "B", group: "G", source: SRC, rule: { allOf: [{ course: ["ENGL-2880"] }, { answered: "usedAs:test-layer/opt-b" }] } },
      ],
    } as Row;
    expect(lintLayer(layer([either], { questions: [{ ...usedAs, row: "opt-b" }] }))).toEqual([]);
  });

  it("flags an answered leaf that names no question in this layer", () => {
    expectLint(layer([fws(), elect()], { questions: [usedAs] }), `answered leaf ${APPROVED} names no question declared in this layer`);
    expectLint(
      layer([fws(), elect({ answered: "studentFact:honorsProgram:OTHER" })], { questions: [usedAs] }),
      "names no question declared in this layer"
    );
  });

  it("flags an answered leaf naming a credit-mark question", () => {
    const credits: Question = { ...Q, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] };
    expectLint(
      layer([fws(), elect({ answered: "creditsTaken:BIOMI-4850" })], { questions: [usedAs, credits] }),
      "names a creditsTaken question"
    );
    const seq: Question = { ...Q, type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4301"], credits: 4 };
    expectLint(layer([fws(), elect({ answered: "sequenceDone:NTRES-4300" })], { questions: [usedAs, seq] }), "names a sequenceDone question");
  });

  it("flags an answered leaf for a row-scoped mark that sits in another row", () => {
    expectLint(
      layer([fws(), elect({ anyOf: [{ allOf: [{ subject: ["BIOMG"] }, { answered: APPROVED }] }, { answered: USED }] })], {
        questions: [usedAs, approvedFor],
      }),
      `answered leaf ${USED} belongs to row fws, not this row`
    );
  });

  it("flags a dead mark question (no answered leaf in its target row reads it)", () => {
    expectLint(layer([fws(), elect({ subject: ["BIOMG"] })], { questions: [usedAs, approvedFor] }), "the question can change nothing");
  });

  it("flags an empty quote", () => {
    expectLint(layer([fws(), elect()], { questions: [{ ...usedAs, quote: "  " }, approvedFor] }), "needs Cornell's sentence");
  });

  it("flags more than 20 questions", () => {
    const facts = Array.from({ length: 21 }, (_, i) => ({ ...fact, subject: `S${i}` }));
    expectLint(layer([fws(), elect()], { questions: [usedAs, approvedFor, ...facts] }), "at most 20 questions");
  });

  it("flags empty creditsTaken values (error) and warns on repeats", () => {
    const credits = (values: number[]): Question => ({ ...Q, type: "creditsTaken", course: "BIOMI-4850", values });
    expectLint(layer([fws(), elect()], { questions: [usedAs, approvedFor, credits([])] }), "lists no credit values");
    const repeated = layer([fws(), elect()], { questions: [usedAs, approvedFor, credits([3, 3])] });
    expect(lintLayer(repeated)).toEqual([]);
    expect(lintLayerWarnings(repeated)).toEqual(["test-layer:questions[2]: creditsTaken values repeat a value"]);
  });

  it("flags duplicate questions and answered leaves inside a question's course rule", () => {
    expectLint(layer([fws(), elect()], { questions: [usedAs, usedAs, approvedFor] }), `duplicate question ${USED}`);
    expectLint(
      layer([fws(), elect()], { questions: [usedAs, { ...approvedFor, courses: { answered: FACT } }] }),
      "course rule cannot use an answered leaf"
    );
  });

  // Audit finding 6: under `not`, unanswered reads as the lenient result and
  // a yes only removes courses, so the question would never be asked.
  it("flags an answered leaf anywhere under not", () => {
    const negated = (rule: object) => layer([fws(), elect(rule)], { questions: [usedAs, approvedFor, fact] });
    const msg = "an answered leaf cannot sit under not";
    expectLint(negated({ allOf: [{ subject: ["BIOMG"] }, { answered: APPROVED }, { not: { answered: FACT } }] }), msg);
    expectLint(negated({ allOf: [{ answered: APPROVED }, { not: { anyOf: [{ tag: ["X"] }, { allOf: [{ answered: FACT }] }] } }] }), msg);
    // A `not` with no answered leaf under it is fine.
    expect(lintLayer(negated({ anyOf: [{ allOf: [{ answered: APPROVED }, { not: { tag: ["X"] } }] }, { answered: FACT }] }))).toEqual([]);
  });

  // Audit finding 7: a row-scoped question whose ref leaves no room for
  // "@" + a course id within the answer-key limit could never save a "Yes".
  it("flags a row-scoped question whose answer keys could exceed the key length limit", () => {
    const longId = `concentration-${"x".repeat(180)}`;
    const ref = `approvedFor:${longId}/elect`;
    const long = layer([elect({ allOf: [{ subject: ["BIOMG"] }, { answered: ref }] })], {
      id: longId,
      kind: "concentration",
      programId: "p",
      concentrationId: "c",
      questions: [approvedFor],
    });
    expectLint(long, "answer keys could exceed the 240-character limit");
    // A ~92-character concentration id (the longest real one) is fine.
    const realId = "cornell-information-science-bs-2026--information-ethics-law-and-policy-and-more-text-padding";
    const ok = layer([elect({ allOf: [{ subject: ["BIOMG"] }, { answered: `approvedFor:${realId}/elect` }] })], {
      id: realId,
      kind: "concentration",
      programId: "p",
      concentrationId: "c",
      questions: [approvedFor],
    });
    expect(lintLayer(ok)).toEqual([]);
  });
});

describe("lintLayer — examScore leaves (spec 028)", () => {
  const SRC_T = { url: "https://courses.cornell.edu/fixture", fetched: "2026-11-06" };
  const empty = { year: "2026-27", source: SRC_T, awards: [] };
  const TABLES: ExamTables = {
    year: "2026-27",
    exams: [
      { id: "ap-calculus-bc", family: "ap", name: "Calculus BC", scale: ["1", "2", "3", "4", "5"] },
      { id: "ib-mathematics-analysis-hl", family: "ib", name: "Mathematics: Analysis HL", scale: ["1", "2", "3", "4", "5", "6", "7"] },
    ],
    university: { college: "university", ...empty },
    overrides: {},
    engineering: { college: "engineering", ...empty },
  };
  const lint = (examScore: { exam: string[]; scores: string[] }, tables: ExamTables | null = TABLES) => {
    const out: string[] = [];
    lintExamScores({ allOf: [{ subject: ["MATH"] }, { not: { examScore } }] }, (m) => out.push(m), tables);
    return out;
  };

  it("a known exam with scores on its scale is clean; mixed families are fine", () => {
    expect(lint({ exam: ["ap-calculus-bc"], scores: ["4", "5"] })).toEqual([]);
    expect(lint({ exam: ["ap-calculus-bc", "ib-mathematics-analysis-hl"], scores: ["5", "7"] })).toEqual([]);
  });
  it("an exam the tables don't list is an error", () => {
    expect(lint({ exam: ["ap-calculus-cb"], scores: ["5"] })).toEqual(["examScore names exam ap-calculus-cb, which the credit tables do not list"]);
  });
  it("a score on no listed exam's scale, or an exam with no listed score on its scale, is an error", () => {
    expect(lint({ exam: ["ap-calculus-bc"], scores: ["5", "7"] })).toEqual(["examScore score 7 is on no listed exam's scale"]);
    expect(lint({ exam: ["ap-calculus-bc", "ib-mathematics-analysis-hl"], scores: ["7"] })[0]).toContain("no score on the ap-calculus-bc scale");
  });
  it("repeats are reported, with or without tables", () => {
    expect(lint({ exam: ["ap-calculus-bc", "ap-calculus-bc"], scores: ["5", "5"] }, null)).toEqual([
      "examScore lists an exam twice",
      "examScore lists a score twice",
    ]);
    expect(lint({ exam: ["anything-at-all"], scores: ["5"] }, null)).toEqual([]);
  });
  it("lintLayer walks row rules, categories and limits", () => {
    const bad = { examScore: { exam: ["x-dup", "x-dup"], scores: ["5"] } };
    expectLint(layer([seat("s", { rule: bad } as Partial<Row>)]), "lists an exam twice");
    expectLint(layer([dist({ categories: [{ id: "a", label: "A", rule: bad }, { id: "b", label: "B", rule: { tag: ["B"] } }] })]), "lists an exam twice");
    expectLint(
      layer([{ id: "p", kind: "pool", label: "P", group: "G", source: SRC, rule: { tag: ["A"] }, requiredCourses: 1, requiredCredits: 0, limits: [{ rule: bad, maxCourses: 1 }] }]),
      "lists an exam twice"
    );
  });
});
