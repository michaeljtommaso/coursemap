import { describe, expect, it } from "vitest";
import { railLineFor } from "@/components/rail/railLines";
import type { RequirementGroup, RequirementItem, TriedProgress } from "@/hooks/useRequirementProgress";
import {
  amountDone,
  buildPageModel,
  countedNames,
  formatAmount,
  groupAmount,
  groupTitle,
  rowDetail,
  triedCategoryIds,
  triedCourseIdsOn,
  triedDelta,
  triedDeltaText,
  triedFillsIn,
} from "./pageModel";
import { pickSuggestions } from "./suggestions";
import {
  ADVISE_COLLEGE,
  ADVISE_MAJOR,
  CORE,
  DIST,
  DIST_TRIED,
  ENG_GROUPS,
  ENG_LS,
  FWS,
  GROUPS,
  TRIED,
  item,
  record,
} from "./fixtures";

describe("buildPageModel — outline and advisor grouping", () => {
  const model = buildPageModel(GROUPS, { college: "Arts & Sciences", program: "Economics (BA)" });

  it("sections groups by layer, college first, named for the student", () => {
    expect(model.sections.map((s) => [s.key, s.label])).toEqual([
      ["college", "Arts & Sciences college"],
      ["major", "Economics (BA)"],
    ]);
    expect(model.sections[0].groups.map((g) => g.title)).toEqual(["Writing seminars", "Distribution"]);
  });

  it("collects every confirm row into the advisor list, and drops a group left empty", () => {
    expect(model.advisor.map((it) => it.id)).toEqual([ADVISE_COLLEGE.id, ADVISE_MAJOR.id]);
    const keys = model.sections.flatMap((s) => s.groups.map((g) => g.key));
    expect(keys).not.toContain("cas-college:Residency");
    const core = model.sections[1].groups[0];
    expect(core.items.map((it) => it.id)).toEqual([CORE.id]);
  });

  it("an Engineering program is one section", () => {
    const eng = buildPageModel(
      [{ key: "core", label: "Core", items: [item("cs-2110", { label: "CS 2110" })], satisfiedCount: 0, total: 1 }],
      { program: "Computer Science" }
    );
    expect(eng.sections).toHaveLength(1);
    expect(eng.sections[0]).toMatchObject({ key: "program", label: "Computer Science" });
    expect(eng.advisor).toEqual([]);
  });

  it("groupTitle strips the layer prefix only", () => {
    expect(groupTitle("Concentration · Electives")).toBe("Electives");
    expect(groupTitle("CS electives")).toBe("CS electives");
  });
});

describe("tried classes (D11): blue, never met", () => {
  it("a distribution row gains a category, in its own unit", () => {
    const d = triedDelta(DIST, DIST_TRIED);
    expect(d).toEqual({ kind: "more", n: 1, unit: "categories" });
    expect(triedDeltaText(d!)).toBe("+1 category if you take what you're trying");
    expect(DIST.status).toBe("partial");
  });

  it("a seat the tried class would fill says so; nothing added → null", () => {
    expect(triedDelta(CORE, { ...CORE, status: "satisfied" })).toEqual({ kind: "fills" });
    expect(triedDelta(FWS, FWS)).toBeNull();
    expect(triedDelta(FWS, undefined)).toBeNull();
  });

  it("the tried course and category are named for the blue chips", () => {
    expect(triedCourseIdsOn(DIST, DIST_TRIED)).toEqual(["HIST-1530"]);
    expect([...triedCategoryIds(DIST, DIST_TRIED)]).toEqual(["HST"]);
  });

  it("a single-row group reads in the row's unit with the blue plus", () => {
    const g = { items: [DIST], satisfiedCount: 0, total: 1 };
    const a = groupAmount(g, TRIED);
    expect(a).toEqual({ have: 1, need: 3, unit: "categories", plus: 1, done: false });
    expect(formatAmount(a)).toBe("1 of 3");
  });

  it("which rows of a group a tried class fills", () => {
    expect(triedFillsIn([DIST], TRIED)).toEqual({ "HIST-1530": [DIST.label] });
    expect(triedFillsIn([FWS], TRIED)).toEqual({});
  });
});

describe("row wording (D7)", () => {
  it("names credit by its source, never 'Your credit'", () => {
    const calc = item("cas-college:math", { status: "satisfied", creditLabels: ["AP Calculus BC (5)"] }, {
      rowKind: "seat",
      engineStatus: "met",
      countedCodes: ["MATH 1910"],
    });
    const names = countedNames(calc, []);
    expect(names).toEqual(["AP Calculus BC (5)"]);
    expect(rowDetail(calc, names)).toBe("AP Calculus BC (5)");
  });

  it("a partly filled pool says how far and what counts", () => {
    expect(rowDetail(FWS, countedNames(FWS, ["HIST 1200"]))).toBe("1 of 2 courses: HIST 1200");
  });

  it("advisor rows and unmet rows", () => {
    expect(rowDetail(ADVISE_COLLEGE, [])).toBe("Confirm with your advisor");
    expect(rowDetail(CORE, [])).toBe("Nothing counted yet");
  });
});

describe("pickSuggestions", () => {
  const hist = (id: string, roster: string | null) => record(id, { attrs: ["HST-AS"], roster });
  const index = [
    hist("HIST-4000", "SP27"),
    hist("HIST-1530", "SP27"),
    hist("HIST-2100", "SP27"),
    hist("HIST-1200", "FA26"),
    record("PHIL-1100", { attrs: ["ETM-AS"], roster: "FA26" }),
  ];
  const targets = [
    { label: "Historical", test: (r: (typeof index)[number]) => r.attrs.includes("HST-AS") },
    { label: "Ethics & Mind", test: (r: (typeof index)[number]) => r.attrs.includes("ETM-AS") },
  ];

  it("prefers the enrollment term, then other terms, sharing slots across targets", () => {
    const out = pickSuggestions(index, targets, { enrollmentTarget: "SP27", exclude: () => false });
    expect(out.map((s) => s.record.id)).toEqual(["HIST-1530", "PHIL-1100", "HIST-2100", "HIST-4000"]);
    expect(out[1].fills).toEqual(["Ethics & Mind"]);
  });

  it("never suggests excluded courses (board, tried, credit)", () => {
    const out = pickSuggestions(index, targets, {
      enrollmentTarget: "SP27",
      exclude: (id) => id === "HIST-1530" || id === "PHIL-1100",
    });
    expect(out.map((s) => s.record.id)).toEqual(["HIST-2100", "HIST-4000"]);
  });
});

// Audit F1: the page showed a group "Done" (green ✓) while its only row was
// partial — it compared one fixed unit and never read the row's status.
describe("group progress — the rail's count, done only from status (audit F1/P2)", () => {
  const englishDist = (coursesHave: number, status: "partial" | "satisfied") =>
    item("major:distribution", { label: "Distribution", status }, {
      layerKind: "major",
      rowKind: "distribution",
      engineStatus: status === "satisfied" ? "met" : "partial",
      categoriesHave: 4,
      categoriesNeed: 4,
      coursesHave,
      coursesNeed: 5,
    });
  const amstPool = (courses: number, credits: number, status: "partial" | "satisfied") =>
    item(
      "major:coursework",
      { label: "Twelve courses, 42 credits", status, poolProgress: { courses, requiredCourses: 12, credits, requiredCredits: 42 } },
      {
        layerKind: "major",
        rowKind: "pool",
        engineStatus: status === "satisfied" ? "met" : "partial",
        coursesHave: courses,
        coursesNeed: 12,
        creditsHave: credits,
        creditsNeed: 42,
      }
    );
  const triedWith = (row: RequirementItem): TriedProgress => ({
    courseIds: ["X-1000"],
    notOnBoard: ["X-1000"],
    items: { [row.id]: row },
    fills: {},
    missing: [],
  });
  const asGroup = (items: RequirementItem[]): RequirementGroup => ({
    key: "major:G",
    label: "Major · G",
    items,
    satisfiedCount: 0,
    total: items.length,
  });
  /** The page and the rail state the same count. */
  function expectSameAsRail(g: RequirementGroup, tried?: TriedProgress) {
    const a = groupAmount(g, tried);
    const line = railLineFor(g, tried)!;
    expect([a.have, a.need, amountDone(a), a.plus]).toEqual([line.have, line.need, line.done, line.triedPlus]);
  }

  it("a pool with 12 of 12 courses but 36 of 42 credits is not done, and reads in credits", () => {
    const real = amstPool(12, 36, "partial");
    const a = groupAmount({ items: [real] });
    expect(formatAmount(a)).toBe("36 of 42 cr");
    expect(amountDone(a)).toBe(false);
    // A tried class adding 3 credits shows on the row and the group.
    const tried = amstPool(13, 39, "partial");
    expect(triedDelta(real, tried)).toEqual({ kind: "more", n: 3, unit: "credits" });
    expect(groupAmount({ items: [real] }, triedWith(tried)).plus).toBe(3);
    expectSameAsRail(asGroup([real]));
    expectSameAsRail(asGroup([real]), triedWith(tried));
  });

  it("a distribution row covering 4 of 4 categories with 3 of 5 courses is not done, reads in courses", () => {
    const real = englishDist(3, "partial");
    const a = groupAmount({ items: [real] });
    expect(a).toMatchObject({ have: 3, need: 5, unit: "courses", done: false });
    expect(amountDone(a)).toBe(false);
    const tried = englishDist(5, "satisfied");
    expect(triedDelta(real, tried)).toEqual({ kind: "more", n: 2, unit: "courses" });
    expect(groupAmount({ items: [real] }, triedWith(tried)).plus).toBe(2);
    expectSameAsRail(asGroup([real]));
    expectSameAsRail(asGroup([real]), triedWith(tried));
  });

  it("every number reached but the engine says partial: never Done", () => {
    const a = groupAmount({ items: [amstPool(12, 42, "partial")] });
    expect(formatAmount(a)).toBe("12 of 12");
    expect(amountDone(a)).toBe(false);
    expect(amountDone(groupAmount({ items: [amstPool(12, 42, "satisfied")] }))).toBe(true);
  });

  it("a waived confirm row is an advisor row on the page as on the rail", () => {
    const waivedConfirm = item(
      "econ:advisor2",
      { label: "Advisor sign-off", status: "waived", checkable: false },
      { layerKind: "major", rowKind: "confirm", engineStatus: "waived" }
    );
    const g = asGroup([CORE, waivedConfirm]);
    const model = buildPageModel([g]);
    expect(model.advisor.map((it) => it.id)).toEqual([waivedConfirm.id]);
    expect(model.sections[0].groups[0].items.map((it) => it.id)).toEqual([CORE.id]);
    expect(formatAmount(groupAmount(g))).toBe("0 of 1");
    expectSameAsRail(g);
  });
});

// Spec 037 D9 — Engineering liberal studies is shaped like a CAS / CALS
// distribution row, but it is stated courses first and its categories are
// called "groups" (a leading "0 of 3" read as three classes).
describe("Engineering liberal studies (spec 037 D9)", () => {
  it("the page stays one section; the liberal studies group keeps its place", () => {
    const eng = buildPageModel(ENG_GROUPS, { college: "Engineering", program: "ORIE" }, "engineering");
    expect(eng.sections.map((s) => [s.key, s.label])).toEqual([["program", "ORIE"]]);
    expect(eng.sections[0].groups.map((g) => g.title)).toEqual(["Core", "Liberal studies"]);
    expect(eng.sections[0].groups[1].layerKind).toBeNull();
  });

  it("the detail line states courses, credits, then groups", () => {
    expect(rowDetail(ENG_LS, [])).toBe("4 of 6 courses · 13 of 18 credits · 2 of 3 groups");
    expect(rowDetail(ENG_LS, ["ECON 1110", "PHIL 1100"])).toBe(
      "4 of 6 courses · 13 of 18 credits · 2 of 3 groups: ECON 1110, PHIL 1100"
    );
  });

  it("nothing on the board: zeros, like a CAS row", () => {
    const none = {
      ...ENG_LS,
      status: "unmet" as const,
      coveredBy: [],
      dist: { ...ENG_LS.dist!, categoriesHave: 0, coursesHave: 0, creditsHave: 0, countedCodes: [] },
    };
    expect(rowDetail(none, [])).toBe("0 of 6 courses · 0 of 18 credits · 0 of 3 groups");
    expect(formatAmount(groupAmount({ items: [none] }))).toBe("0 of 6");
  });

  it("the group's count is the row's binding one: courses, then credits, then groups", () => {
    const g = ENG_GROUPS[1];
    expect(formatAmount(groupAmount(g))).toBe("4 of 6");
    const groupsMet = { ...ENG_LS, dist: { ...ENG_LS.dist!, categoriesHave: 3 } };
    expect(formatAmount(groupAmount({ ...g, items: [groupsMet] }))).toBe("4 of 6");
    const coursesMet = { ...ENG_LS, dist: { ...ENG_LS.dist!, categoriesHave: 3, coursesHave: 6 } };
    expect(formatAmount(groupAmount({ ...g, items: [coursesMet] }))).toBe("13 of 18 cr");
  });

  it("Student B (six courses in two groups): the count reads in groups", () => {
    const b = { ...ENG_LS, dist: { ...ENG_LS.dist!, coursesHave: 6, creditsHave: 18 } };
    expect(rowDetail(b, [])).toBe("6 of 6 courses · 18 of 18 credits · 2 of 3 groups");
    const a = groupAmount({ items: [b] });
    expect(a).toMatchObject({ have: 2, need: 3, unit: "groups", done: false });
    expect(formatAmount(a)).toBe("2 of 3 groups");
  });

  it("six courses in three groups without Race & Equity: 2 of 3 groups (the builder's figure), not done", () => {
    // requirementProgress counts Race & Equity as one of the three while it's
    // required and unmet, so three other groups arrive as categoriesHave 2.
    const re = { ...ENG_LS, dist: { ...ENG_LS.dist!, coursesHave: 6, creditsHave: 18, categoriesHave: 2 } };
    expect(rowDetail(re, [])).toBe("6 of 6 courses · 18 of 18 credits · 2 of 3 groups");
    expect(formatAmount(groupAmount({ items: [re] }))).toBe("2 of 3 groups");
    expect(amountDone(groupAmount({ items: [re] }))).toBe(false);
  });

  it("a met row: every figure reached, never past what's needed", () => {
    const met = {
      ...ENG_LS,
      status: "satisfied" as const,
      dist: {
        ...ENG_LS.dist!,
        engineStatus: "met" as const,
        coursesHave: 7,
        creditsHave: 18,
        categoriesHave: 3,
        categories: ENG_LS.dist!.categories!.map((c) => ({ ...c, missing: false })),
      },
    };
    expect(rowDetail(met, [])).toBe("6 of 6 courses · 18 of 18 credits · 3 of 3 groups");
    const a = groupAmount({ items: [met] });
    expect(formatAmount(a)).toBe("6 of 6");
    expect(amountDone(a)).toBe(true);
  });

  it("the tried delta is in the unit shown: courses, then groups", () => {
    const tried = { ...ENG_LS, dist: { ...ENG_LS.dist!, coursesHave: 5, creditsHave: 16 } };
    const d = triedDelta(ENG_LS, tried);
    expect(d).toEqual({ kind: "more", n: 1, unit: "courses" });
    expect(triedDeltaText(d!)).toBe("+1 course if you take what you're trying");
    const b = { ...ENG_LS, dist: { ...ENG_LS.dist!, coursesHave: 6, creditsHave: 18 } };
    const bTried = { ...b, dist: { ...b.dist!, categoriesHave: 3 } };
    const dg = triedDelta(b, bTried);
    expect(dg).toEqual({ kind: "more", n: 1, unit: "groups" });
    expect(triedDeltaText(dg!)).toBe("+1 group if you take what you're trying");
  });

  it("an Arts & Sciences distribution row is unchanged: categories first", () => {
    expect(rowDetail(DIST, [])).toBe("1 of 3 categories");
    const cas = { ...DIST, dist: { ...DIST.dist!, coursesHave: 2, coursesNeed: 4 } };
    expect(rowDetail(cas, [])).toBe("1 of 3 categories · 2 of 4 courses");
    expect(formatAmount(groupAmount({ items: [cas] }))).toBe("1 of 3");
  });
});
