import { describe, expect, it } from "vitest";
import type {
  DistributionItemInfo,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import {
  buildRailLines,
  creditLineCredits,
  highlightStillValid,
  railGroupName,
  railLineFor,
} from "./railLines";
import { ENG_GROUPS, ENG_LS } from "@/components/requirementsPage/fixtures";

function dist(over: Partial<DistributionItemInfo> = {}): DistributionItemInfo {
  return {
    layerId: "cas-college",
    rowId: "r",
    layerKind: "college",
    rowKind: "seat",
    engineStatus: "unmet",
    countedCodes: [],
    ...over,
  };
}

function item(id: string, over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    id,
    label: id,
    category: null,
    suggestedSem: null,
    status: "unmet",
    coveredBy: [],
    checkable: true,
    requirement: null,
    ...over,
  };
}

function group(key: string, label: string, items: RequirementItem[]): RequirementGroup {
  return { key, label, items, satisfiedCount: 0, total: items.length };
}

const confirmRow = (id: string) =>
  item(id, { checkable: false, dist: dist({ rowKind: "confirm", engineStatus: "confirm", confirm: true }) });

describe("railLineFor — count rule", () => {
  it("a lone distribution row states its categories", () => {
    const g = group("cas-college:Distribution", "College · Distribution", [
      item("cas-college:dist", {
        status: "partial",
        dist: dist({ rowKind: "distribution", categoriesHave: 4, categoriesNeed: 10 }),
      }),
    ]);
    const line = railLineFor(g)!;
    expect(line.name).toBe("Distribution");
    expect(line.countText).toBe("4 of 10");
    expect(line.fraction).toBeCloseTo(0.4);
    expect(line.done).toBe(false);
  });

  it("a lone credits row states its credits, without a unit", () => {
    const g = group("cas-college:Credits", "College · Credits", [
      item("cas-college:total", {
        status: "partial",
        dist: dist({ rowKind: "credits", creditsHave: 16, creditsNeed: 120 }),
      }),
    ]);
    expect(railLineFor(g)!.countText).toBe("16 of 120");
  });

  it("a lone credit-only pool states credits with cr", () => {
    const g = group("cas-college:Language", "College · Language", [
      item("cas-college:lang", {
        status: "partial",
        dist: dist({ rowKind: "pool", creditsHave: 4, creditsNeed: 11 }),
      }),
    ]);
    expect(railLineFor(g)!.countText).toBe("4 of 11 cr");
  });

  it("a lone pool states courses until they're reached, then the credits still short", () => {
    const row = (coursesHave: number, creditsHave: number) =>
      group("m:Electives", "Major · Electives", [
        item("m:el", {
          status: "partial",
          dist: dist({ layerKind: "major", rowKind: "pool", coursesHave, coursesNeed: 6, creditsHave, creditsNeed: 18 }),
        }),
      ]);
    expect(railLineFor(row(2, 6))!.countText).toBe("2 of 6");
    expect(railLineFor(row(6, 15))!.countText).toBe("15 of 18 cr");
  });

  it("an anyOf row counts its active option; without one it counts as a row", () => {
    const active = group("m:Track", "Major · Track", [
      item("m:any", {
        status: "partial",
        dist: dist({ layerKind: "major", rowKind: "anyOf", activeOption: 1, coursesHave: 1, coursesNeed: 3 }),
      }),
    ]);
    expect(railLineFor(active)!.countText).toBe("1 of 3");
    const idle = group("m:Track", "Major · Track", [
      item("m:any", { dist: dist({ layerKind: "major", rowKind: "anyOf" }) }),
    ]);
    expect(railLineFor(idle)!.countText).toBe("0 of 1");
  });

  it("an Engineering lone pool reads its poolProgress", () => {
    const g = group("elective", "CS electives", [
      item("cs-el", {
        status: "partial",
        poolProgress: { courses: 1, requiredCourses: 3, credits: 4, requiredCredits: 9 },
      }),
    ]);
    const line = railLineFor(g)!;
    expect(line.name).toBe("CS electives");
    expect(line.countText).toBe("1 of 3");
  });

  it("several rows count done (met or waived) of checkable", () => {
    const g = group("m:Core", "Major · Core", [
      item("a", { status: "satisfied", coveredBy: ["p1"] }),
      item("b", { status: "waived" }),
      item("c"),
      item("d", { checkable: false }), // can't be checked: not counted
    ]);
    const line = railLineFor(g)!;
    expect(line.countText).toBe("2 of 3");
    expect(line.done).toBe(false);
  });

  it("caps an overshoot at the need and marks a finished line done", () => {
    const g = group("cas-college:Credits", "College · Credits", [
      item("t", { status: "satisfied", dist: dist({ rowKind: "credits", creditsHave: 130, creditsNeed: 120 }) }),
    ]);
    const line = railLineFor(g)!;
    expect(line.countText).toBe("120 of 120");
    expect(line.fraction).toBe(1);
    expect(line.done).toBe(true);
    expect(line.firstOpen).toBeNull();
  });
});

describe("railLineFor — advisor rows", () => {
  it("leaves confirm rows out of the count", () => {
    const g = group("m:Core", "Major · Core", [item("a", { status: "satisfied" }), item("b"), confirmRow("c")]);
    expect(railLineFor(g)!.countText).toBe("1 of 2");
  });

  it("a lone row keeps its own counts when the only other row is a confirm", () => {
    const g = group("cas-college:Distribution", "College · Distribution", [
      item("d", { status: "partial", dist: dist({ rowKind: "distribution", categoriesHave: 2, categoriesNeed: 10 }) }),
      confirmRow("note"),
    ]);
    expect(railLineFor(g)!.countText).toBe("2 of 10");
  });

  it("drops a group of nothing but confirm rows", () => {
    expect(railLineFor(group("m:Approvals", "Major · Approvals", [confirmRow("x"), confirmRow("y")]))).toBeNull();
    const progress: RequirementProgress = {
      groups: [
        group("m:Approvals", "Major · Approvals", [confirmRow("x")]),
        group("m:Core", "Major · Core", [item("a")]),
      ],
      attribution: {},
      satisfiedCount: 0,
      total: 1,
    };
    expect(buildRailLines(progress).map((l) => l.key)).toEqual(["m:Core"]);
  });
});

describe("railLineFor — click targets", () => {
  it("unions the covering cards and picks the first open checkable row", () => {
    const g = group("m:Core", "Major · Core", [
      item("a", { status: "satisfied", coveredBy: ["p1", "p2"] }),
      item("b", { status: "unmet", checkable: false }),
      item("c", { status: "partial", coveredBy: ["p2", "p3"] }),
    ]);
    const line = railLineFor(g)!;
    expect(line.coveredBy).toEqual(["p1", "p2", "p3"]);
    expect(line.firstOpen?.id).toBe("c");
  });
});

describe("railLineFor — tried classes (+N)", () => {
  function tried(items: Record<string, RequirementItem>): TriedProgress {
    return { courseIds: ["PHIL-1100"], notOnBoard: ["PHIL-1100"], items, fills: {}, missing: [] };
  }

  it("adds the tried categories as +N on a distribution line", () => {
    const real = item("d", {
      status: "partial",
      dist: dist({ rowKind: "distribution", categoriesHave: 4, categoriesNeed: 10 }),
    });
    const withTried = { ...real, dist: dist({ rowKind: "distribution", categoriesHave: 6, categoriesNeed: 10 }) };
    const line = railLineFor(group("cas-college:Distribution", "College · Distribution", [real]), tried({ d: withTried }))!;
    expect(line.countText).toBe("4 of 10");
    expect(line.triedPlus).toBe(2);
    expect(line.done).toBe(false);
  });

  it("counts rows the tried classes would finish", () => {
    const rows = [item("a"), item("b"), item("c", { status: "satisfied" })];
    const line = railLineFor(
      group("m:Core", "Major · Core", rows),
      tried({ a: { ...rows[0], status: "satisfied" }, b: { ...rows[1], status: "partial" } })
    )!;
    expect(line.countText).toBe("1 of 3");
    expect(line.triedPlus).toBe(1);
  });

  it("no +N when tried improves nothing, or when there is nothing tried", () => {
    const rows = [item("a")];
    expect(railLineFor(group("m:Core", "Major · Core", rows), tried({ a: rows[0] }))!.triedPlus).toBe(0);
    expect(railLineFor(group("m:Core", "Major · Core", rows))!.triedPlus).toBe(0);
  });
});

describe("railGroupName", () => {
  const majorGroup = (label: string) =>
    group("m:x", label, [item("x", { dist: dist({ layerKind: "major" }) })]);
  it("college groups by their own name; major groups led by the major", () => {
    expect(railGroupName(group("c:W", "College · Writing", [item("w", { dist: dist() })]), "Economics")).toBe("Writing");
    expect(railGroupName(majorGroup("Major · Core"), "Economics")).toBe("Economics core");
    expect(railGroupName(majorGroup("Major · CS core"), "Computer Science")).toBe("Computer Science CS core");
    expect(railGroupName(majorGroup("Major · Economics electives"), "Economics")).toBe("Economics electives");
    expect(railGroupName(majorGroup("Major · Core"), null)).toBe("Core");
  });
  it("concentration groups and Engineering categories as labelled", () => {
    const conc = group("k:x", "Concentration · Ocean core", [
      item("x", { dist: dist({ layerKind: "concentration" }) }),
    ]);
    expect(railGroupName(conc, "Earth Sciences")).toBe("Ocean core");
    expect(railGroupName(group("core", "Core courses", [item("x")]), "CS")).toBe("Core courses");
  });
});

describe("creditLineCredits", () => {
  it("sums what the credit earns and hides the line when nothing earns credit", () => {
    expect(creditLineCredits([])).toBeNull();
    expect(
      creditLineCredits([
        { id: "exam:ap-calculus-bc", kind: "ap", label: "AP Calculus BC", satisfiesCourseIds: ["MATH-1110"], credits: 4 },
        { id: "transfer:abcd1234", kind: "transfer", label: "Intro Stats", satisfiesCourseIds: [], credits: 4 },
      ])
    ).toBe(8);
    const nothing = {
      id: "exam:ap-art-history",
      kind: "ap" as const,
      label: "AP Art History",
      satisfiesCourseIds: [],
      credits: 0,
      earnsNothing: true,
    };
    expect(creditLineCredits([nothing])).toBeNull();
  });
});

describe("highlightStillValid", () => {
  const progress: RequirementProgress = {
    groups: [
      group("m:Core", "Major · Core", [
        item("a", { status: "satisfied", coveredBy: ["p1"] }),
        item("b", { status: "satisfied", coveredBy: ["p2"] }),
      ]),
    ],
    attribution: {},
    satisfiedCount: 2,
    total: 2,
  };
  const lines = buildRailLines(progress);
  it("keeps a line's highlight and a single row's (Show on board), drops a stale one", () => {
    expect(highlightStillValid(["p2", "p1"], lines, progress)).toBe(true);
    expect(highlightStillValid(["p1"], lines, progress)).toBe(true);
    expect(highlightStillValid(["p9"], lines, progress)).toBe(false);
    expect(highlightStillValid([], lines, progress)).toBe(true);
  });
});

// Audit F1: a lone row whose first count is reached but whose engine says
// partial — the count moves to what still binds, and the line is not done.
describe("railLineFor — the count still binding (shared with the page)", () => {
  function tried(items: Record<string, RequirementItem>): TriedProgress {
    return { courseIds: ["X-1000"], notOnBoard: ["X-1000"], items, fills: {}, missing: [] };
  }
  const englishDist = (coursesHave: number, status: "partial" | "satisfied") =>
    item("major:distribution", {
      status,
      dist: dist({
        layerKind: "major",
        rowKind: "distribution",
        engineStatus: status === "satisfied" ? "met" : "partial",
        categoriesHave: 4,
        categoriesNeed: 4,
        coursesHave,
        coursesNeed: 5,
      }),
    });
  const amstPool = (courses: number, credits: number, status: "partial" | "satisfied") =>
    item("major:coursework", {
      status,
      poolProgress: { courses, requiredCourses: 12, credits, requiredCredits: 42 },
      dist: dist({
        layerKind: "major",
        rowKind: "pool",
        engineStatus: status === "satisfied" ? "met" : "partial",
        coursesHave: courses,
        coursesNeed: 12,
        creditsHave: credits,
        creditsNeed: 42,
      }),
    });

  it("a distribution row with its categories covered states the course floor still short", () => {
    const real = englishDist(3, "partial");
    const g = group("major:Distribution", "Major · Distribution", [real]);
    const line = railLineFor(g)!;
    expect(line.countText).toBe("3 of 5");
    expect(line.done).toBe(false);
    // A tried class that adds the missing courses shows as +2.
    expect(railLineFor(g, tried({ [real.id]: englishDist(5, "satisfied") }))!.triedPlus).toBe(2);
  });

  it("a pool with its courses reached states the credits still short, +N in credits", () => {
    const real = amstPool(12, 36, "partial");
    const g = group("major:Coursework", "Major · Coursework", [real]);
    const line = railLineFor(g)!;
    expect(line.countText).toBe("36 of 42 cr");
    expect(line.done).toBe(false);
    expect(railLineFor(g, tried({ [real.id]: amstPool(13, 39, "partial") }))!.triedPlus).toBe(3);
  });

  it("numbers reached but the engine says partial: full count, not done", () => {
    const real = amstPool(12, 42, "partial");
    const line = railLineFor(group("major:Coursework", "Major · Coursework", [real]))!;
    expect(line.countText).toBe("12 of 12");
    expect(line.done).toBe(false);
  });

  it("a waived confirm row (rowKind confirm, no confirm flag) is an advisor row, not a done row", () => {
    const waivedConfirm = item("m:advisor", {
      status: "waived",
      checkable: false,
      dist: dist({ layerKind: "major", rowKind: "confirm", engineStatus: "waived" }),
    });
    const g = group("m:Core", "Major · Core", [item("a"), waivedConfirm]);
    expect(railLineFor(g)!.countText).toBe("0 of 1");
  });
});

// Spec 037 D9 — Engineering liberal studies on the rail: one line for its
// group, counted in courses first, then credits, then groups.
describe("buildRailLines — Engineering liberal studies", () => {
  const eng: RequirementProgress = { groups: ENG_GROUPS, attribution: {}, satisfiedCount: 1, total: 2 };

  it("one line per group; the liberal studies line states its courses", () => {
    const lines = buildRailLines(eng, "ORIE");
    expect(lines.map((l) => [l.key, l.name, l.countText, l.done])).toEqual([
      ["core", "Core", "1 of 1", true],
      ["liberal", "Liberal studies", "4 of 6", false],
    ]);
  });

  const lsLine = (over: Partial<RequirementItem>, dist: Partial<DistributionItemInfo>, tried?: RequirementItem) =>
    railLineFor(
      { ...ENG_GROUPS[1], items: [{ ...ENG_LS, ...over, dist: { ...ENG_LS.dist!, ...dist } }] },
      tried ? { courseIds: [], notOnBoard: [], items: { [ENG_LS.id]: tried }, fills: {}, missing: [] } : undefined
    )!;

  it("an empty board: 0 of 6", () => {
    const line = lsLine(
      { status: "unmet", coveredBy: [] },
      { coursesHave: 0, creditsHave: 0, categoriesHave: 0, countedCodes: [] }
    );
    expect([line.countText, line.unit, line.done]).toEqual(["0 of 6", "", false]);
  });

  it("Student B (six courses in two groups): 2 of 3 groups", () => {
    const line = lsLine({}, { coursesHave: 6, creditsHave: 18 });
    expect([line.countText, line.unit, line.done]).toEqual(["2 of 3 groups", "groups", false]);
  });

  it("six courses in three groups without Race & Equity: 2 of 3 groups, not done", () => {
    // The builder's figure: Race & Equity is one of the three while unmet.
    const line = lsLine({}, { coursesHave: 6, creditsHave: 18, categoriesHave: 2 });
    expect([line.countText, line.done]).toEqual(["2 of 3 groups", false]);
  });

  it("a met row: 6 of 6, done", () => {
    const line = lsLine(
      { status: "satisfied" },
      {
        engineStatus: "met",
        coursesHave: 6,
        creditsHave: 18,
        categoriesHave: 3,
        categories: ENG_LS.dist!.categories!.map((c) => ({ ...c, missing: false })),
      }
    );
    expect([line.countText, line.done]).toEqual(["6 of 6", true]);
  });

  it("the tried +N counts in the unit shown", () => {
    const courses = lsLine({}, {}, { ...ENG_LS, dist: { ...ENG_LS.dist!, coursesHave: 6, creditsHave: 19 } });
    expect([courses.countText, courses.triedPlus]).toEqual(["4 of 6", 2]);
    const b = { coursesHave: 6, creditsHave: 18 };
    const groups = lsLine({}, b, { ...ENG_LS, dist: { ...ENG_LS.dist!, ...b, categoriesHave: 3 } });
    expect([groups.countText, groups.triedPlus]).toEqual(["2 of 3 groups", 1]);
  });

  it("clicking it finds a class for liberal studies and lights its courses", () => {
    const line = buildRailLines(eng)[1];
    expect(line.firstOpen?.id).toBe("liberal-studies");
    expect(line.coveredBy).toEqual(ENG_LS.coveredBy);
  });

  it("groups covered, credits short: the line reads in credits", () => {
    const met = { ...ENG_LS, dist: { ...ENG_LS.dist!, categoriesHave: 3, coursesHave: 6 } };
    const line = railLineFor({ ...ENG_GROUPS[1], items: [met] })!;
    expect(line.countText).toBe("13 of 18 cr");
  });
});
