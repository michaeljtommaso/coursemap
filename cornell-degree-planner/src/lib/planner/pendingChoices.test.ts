import { describe, it, expect } from "vitest";
import { findPendingChoice, type ChoicePools, type OpenChoice } from "./pendingChoices";
import type { PrereqExpr } from "@/types/db";

const course = (id: string): PrereqExpr => ({ type: "course", id });
const pattern = (p: string): PrereqExpr => ({ type: "pattern", pattern: p });
const concurrent = (id: string): PrereqExpr => ({ type: "concurrent", id });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });

/** Pools from a list of earlier (strict) ids and same-semester ids. */
function pools(earlier: string[] = [], same: string[] = []): ChoicePools {
  const code = (id: string) => id.replace(/-/g, " ");
  return {
    completedIds: new Set(earlier),
    completedCodes: new Set(earlier.map(code)),
    concurrentIds: new Set([...earlier, ...same]),
    concurrentCodes: new Set([...earlier, ...same].map(code)),
  };
}

const intro: OpenChoice = {
  id: "cs-intro",
  label: "Intro Programming (CS 1110/1112)",
  requirement: { kind: "pattern", pattern: "CS-111x" },
  suggestedSem: 1,
};

describe("findPendingChoice", () => {
  it("a pattern leaf met by an earlier open pattern choice → that choice", () => {
    const r = findPendingChoice({
      prereqExpr: pattern("CS-111x"),
      coreqExpr: null,
      sem: 3,
      pools: pools(),
      choices: [intro],
    });
    expect(r).toEqual({ requirementId: "cs-intro", label: intro.label, leaves: ["CS 111x"] });
  });

  it("course leaves an open pattern choice admits (an OR of alternatives)", () => {
    const r = findPendingChoice({
      prereqExpr: or(course("CS-1110"), course("CS-1112")),
      coreqExpr: null,
      sem: 2,
      pools: pools(),
      choices: [intro],
    });
    expect(r?.requirementId).toBe("cs-intro");
    expect(r?.leaves.sort()).toEqual(["CS 1110", "CS 1112"]);
  });

  it("a pattern leaf admitted by an open COURSE requirement that matches it", () => {
    const r = findPendingChoice({
      prereqExpr: pattern("CS-111x"),
      coreqExpr: null,
      sem: 3,
      pools: pools(),
      choices: [{ id: "s-1110", label: "CS 1110", requirement: { kind: "course", courseId: "CS-1110" }, suggestedSem: 1 }],
    });
    expect(r?.requirementId).toBe("s-1110");
  });

  it("not blocked → null", () => {
    expect(
      findPendingChoice({
        prereqExpr: course("CS-1110"),
        coreqExpr: null,
        sem: 3,
        pools: pools(["CS-1110"]),
        choices: [intro],
      })
    ).toBeNull();
  });

  it("an unmet leaf with no pending source keeps it blocked → null", () => {
    expect(
      findPendingChoice({
        prereqExpr: and(pattern("CS-111x"), course("MATH-1910")),
        coreqExpr: null,
        sem: 3,
        pools: pools(),
        choices: [intro],
      })
    ).toBeNull();
  });

  it("prereq leaves need a STRICTLY earlier choice; same semester stays blocked", () => {
    const same = { ...intro, suggestedSem: 3 };
    expect(
      findPendingChoice({ prereqExpr: pattern("CS-111x"), coreqExpr: null, sem: 3, pools: pools(), choices: [same] })
    ).toBeNull();
    const later = { ...intro, suggestedSem: 5 };
    expect(
      findPendingChoice({ prereqExpr: pattern("CS-111x"), coreqExpr: null, sem: 3, pools: pools(), choices: [later] })
    ).toBeNull();
  });

  it("a null suggested semester counts as earlier", () => {
    const unknown = { ...intro, suggestedSem: null };
    expect(
      findPendingChoice({ prereqExpr: pattern("CS-111x"), coreqExpr: null, sem: 1, pools: pools(), choices: [unknown] })
        ?.requirementId
    ).toBe("cs-intro");
  });

  it("coreq leaves accept a same-semester choice", () => {
    const chemLab: OpenChoice = {
      id: "chem-lab",
      label: "Chemistry Lab",
      requirement: { kind: "pattern", pattern: "CHEM-209x" },
      suggestedSem: 1,
    };
    const r = findPendingChoice({
      prereqExpr: null,
      coreqExpr: course("CHEM-2091"),
      sem: 1,
      pools: pools(),
      choices: [chemLab],
    });
    expect(r?.requirementId).toBe("chem-lab");
    expect(r?.leaves).toEqual(["CHEM 2091"]);
  });

  it("{concurrent} leaves inside a prereq tree accept a same-semester choice", () => {
    const math: OpenChoice = {
      id: "math",
      label: "Linear Algebra",
      requirement: { kind: "pattern", pattern: "MATH-294x" },
      suggestedSem: 3,
    };
    const r = findPendingChoice({
      prereqExpr: concurrent("MATH-2940"),
      coreqExpr: null,
      sem: 3,
      pools: pools(),
      choices: [math],
    });
    expect(r?.requirementId).toBe("math");
  });

  it("both trees must pass with the pending pool", () => {
    // prereq pending, coreq unmet with no source → stays blocked.
    expect(
      findPendingChoice({
        prereqExpr: pattern("CS-111x"),
        coreqExpr: course("PHYS-1110"),
        sem: 3,
        pools: pools(),
        choices: [intro],
      })
    ).toBeNull();
  });

  it("prefers the choice supplying the most unmet leaves, then input order", () => {
    const narrow: OpenChoice = {
      id: "only-1110",
      label: "CS 1110 seat",
      requirement: { kind: "course", courseId: "CS-1110" },
      suggestedSem: 1,
    };
    const r = findPendingChoice({
      prereqExpr: or(course("CS-1110"), course("CS-1112")),
      coreqExpr: null,
      sem: 3,
      pools: pools(),
      choices: [narrow, intro],
    });
    expect(r?.requirementId).toBe("cs-intro");
  });

  it("an AND needing picks from two choices reports the first (accepted imprecision)", () => {
    const phys: OpenChoice = {
      id: "phys",
      label: "Physics sequence",
      requirement: { kind: "pattern", pattern: "PHYS-1112" },
      suggestedSem: 2,
    };
    const r = findPendingChoice({
      prereqExpr: and(pattern("CS-111x"), course("PHYS-1112")),
      coreqExpr: null,
      sem: 4,
      pools: pools(),
      choices: [intro, phys],
    });
    expect(r?.requirementId).toBe("cs-intro");
  });

  it("attribute requirements never admit a leaf (no title/attrs on a leaf)", () => {
    const fws: OpenChoice = {
      id: "fws",
      label: "First-Year Writing Seminar",
      requirement: { kind: "attribute", match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } },
      suggestedSem: 1,
    };
    expect(
      findPendingChoice({ prereqExpr: course("ENGL-1100"), coreqExpr: null, sem: 3, pools: pools(), choices: [fws] })
    ).toBeNull();
  });

  it("canonicalizes cross-listed ids when matching course requirements", () => {
    const seat: OpenChoice = {
      id: "s-2110",
      label: "Data Structures",
      requirement: { kind: "course", courseId: "ENGRD-2110" },
      suggestedSem: 3,
    };
    const aliases: Record<string, string> = { "ENGRD-2110": "CS-2110" };
    const r = findPendingChoice({
      prereqExpr: course("CS-2110"),
      coreqExpr: null,
      sem: 5,
      pools: pools(),
      choices: [seat],
      canonical: (id) => aliases[id] ?? id,
    });
    expect(r?.requirementId).toBe("s-2110");
  });

  it("no choices or no trees → null", () => {
    expect(
      findPendingChoice({ prereqExpr: pattern("CS-111x"), coreqExpr: null, sem: 3, pools: pools(), choices: [] })
    ).toBeNull();
    expect(
      findPendingChoice({ prereqExpr: null, coreqExpr: null, sem: 3, pools: pools(), choices: [intro] })
    ).toBeNull();
  });
});

describe("findPendingChoice — course-list choices", () => {
  const list: OpenChoice = {
    id: "g-phys3",
    label: "Third physics course",
    requirement: null,
    courseIds: ["PHYS-2214", "PHYS-2218", "PHYS-2210"],
    suggestedSem: 4,
  };

  it("a course leaf in the list is pending", () => {
    const r = findPendingChoice({
      prereqExpr: and(course("PHYS-1110"), or(course("PHYS-2214"), course("PHYS-2218"))),
      coreqExpr: null,
      sem: 7,
      pools: pools(["PHYS-1110"]),
      choices: [list],
    });
    expect(r?.requirementId).toBe("g-phys3");
    expect(r?.leaves.sort()).toEqual(["PHYS 2214", "PHYS 2218"]);
  });

  it("a pattern leaf matched by a listed course is pending", () => {
    const r = findPendingChoice({
      prereqExpr: pattern("PHYS-221x"),
      coreqExpr: null,
      sem: 7,
      pools: pools(),
      choices: [list],
    });
    expect(r?.requirementId).toBe("g-phys3");
  });

  it("a course outside the list is not pending (stays blocked)", () => {
    const r = findPendingChoice({
      prereqExpr: course("PHYS-3316"),
      coreqExpr: null,
      sem: 7,
      pools: pools(),
      choices: [list],
    });
    expect(r).toBeNull();
  });
});
