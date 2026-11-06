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
