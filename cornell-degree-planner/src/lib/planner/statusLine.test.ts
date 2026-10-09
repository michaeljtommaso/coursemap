import { describe, it, expect } from "vitest";
import {
  resolveCardStatusLine,
  blockedMessage,
  offeredMessage,
  overlapMessage,
  conflictMessage,
  advisoryMessage,
  mentionsCredit,
  creditCouldUnblock,
  creditMessage,
  type CardStatusLineInput,
} from "./statusLine";

function input(overrides: Partial<CardStatusLineInput> = {}): CardStatusLineInput {
  return {
    blocked: false,
    unmetPrereqLeaves: [],
    offeredOk: null,
    offered: [],
    overlaps: [],
    conflictWith: null,
    prereqState: null,
    advisoryNotes: [],
    ...overrides,
  };
}

describe("resolveCardStatusLine — precedence (spec 007 §1b)", () => {
  it("nothing when the card has no signal at all", () => {
    expect(resolveCardStatusLine(input())).toBeNull();
  });

  it("covered by credit wins over everything — even blocked (B1)", () => {
    const line = resolveCardStatusLine(
      input({
        coveredByCredit: { kind: "ap", label: "AP Calculus BC (score 5)" },
        blocked: true,
        unmetPrereqLeaves: ["MATH 1110"],
        offeredOk: false,
        overlaps: ["CS 1112"],
        conflictWith: "CS 2110",
      })
    );
    expect(line).toEqual({ kind: "credit", text: "Covered by your AP credit" });
  });

  it("an absent / null coveredByCredit changes nothing (older callers)", () => {
    expect(resolveCardStatusLine(input({ coveredByCredit: null }))).toBeNull();
    expect(
      resolveCardStatusLine(input({ blocked: true, unmetPrereqLeaves: ["CS 2110"] }))
    ).toEqual({ kind: "blocked", text: "Needs CS 2110 first" });
  });

  it("blocked wins over everything else", () => {
    const line = resolveCardStatusLine(
      input({
        blocked: true,
        unmetPrereqLeaves: ["CS 2110"],
        offeredOk: false,
        overlaps: ["CS 1112"],
        prereqState: "advisory",
        advisoryNotes: ["or equivalent AP credit"],
      })
    );
    expect(line).toEqual({ kind: "blocked", text: "Needs CS 2110 first" });
  });

  it("offered warning wins over overlap and advisory", () => {
    const line = resolveCardStatusLine(
      input({
        offeredOk: false,
        offered: ["FA"],
        overlaps: ["CS 1112"],
        prereqState: "advisory",
        advisoryNotes: ["or equivalent AP credit"],
      })
    );
    expect(line).toEqual({ kind: "warning", text: "Usually offered in Fall only" });
  });

  it("overlap wins over conflict and advisory", () => {
    const line = resolveCardStatusLine(
      input({
        overlaps: ["CS 1112"],
        conflictWith: "CS 2110",
        prereqState: "advisory",
        advisoryNotes: ["or equivalent AP credit"],
      })
    );
    expect(line).toEqual({ kind: "overlap", text: "Credit is given for only one of this and CS 1112" });
  });

  it("conflict wins over advisory (spec 012 §4 — after overlap, before advisory)", () => {
    const line = resolveCardStatusLine(
      input({
        conflictWith: "CS 2110",
        prereqState: "advisory",
        advisoryNotes: ["or equivalent AP credit"],
      })
    );
    expect(line).toEqual({ kind: "conflict", text: "Meets at the same time as CS 2110" });
  });

  it("conflict yields nothing when the card carries no collision", () => {
    expect(resolveCardStatusLine(input({ conflictWith: null }))).toBeNull();
  });

  it("advisory shows when nothing else applies", () => {
    const line = resolveCardStatusLine(
      input({ prereqState: "advisory", advisoryNotes: ["or equivalent AP credit"] })
    );
    expect(line).toEqual({
      kind: "advisory",
      text: "Usually also satisfied by: equivalent AP credit",
    });
  });

  it("advisory prereqState with no notes yielded (defensive) → nothing", () => {
    expect(resolveCardStatusLine(input({ prereqState: "advisory", advisoryNotes: [] }))).toBeNull();
  });

  it("met prereqState with no other signal → nothing", () => {
    expect(resolveCardStatusLine(input({ prereqState: "met" }))).toBeNull();
  });
});

describe("creditMessage", () => {
  it("names the credit kind in plain words", () => {
    expect(creditMessage("ap")).toBe("Covered by your AP credit");
    expect(creditMessage("ib")).toBe("Covered by your IB credit");
    expect(creditMessage("transfer")).toBe("Covered by your transfer credit");
    expect(creditMessage("placement")).toBe("Covered by your placement credit");
  });
  it("an unknown kind reads as plain credit", () => {
    expect(creditMessage("credit")).toBe("Covered by your credit");
  });
});

describe("blockedMessage", () => {
  it("names one, two, or trails off at three+", () => {
    expect(blockedMessage([])).toBe("Prerequisites not met");
    expect(blockedMessage(["CS 2110"])).toBe("Needs CS 2110 first");
    expect(blockedMessage(["CS 2110", "CS 2112"])).toBe("Needs CS 2110 or CS 2112 first");
    expect(blockedMessage(["CS 2110", "CS 2112", "CS 2800"])).toBe("Needs CS 2110, CS 2112 …");
  });
});

describe("offeredMessage", () => {
  it("names the real offered terms", () => {
    expect(offeredMessage([])).toBe("Check when this is offered");
    expect(offeredMessage(["FA"])).toBe("Usually offered in Fall only");
    expect(offeredMessage(["FA", "SP"])).toBe("Usually offered in Fall or Spring");
  });
});

describe("overlapMessage", () => {
  it("single vs multiple overlaps", () => {
    expect(overlapMessage(["CS 1112"])).toBe("Credit is given for only one of this and CS 1112");
    expect(overlapMessage(["CS 1112", "CS 1114"])).toBe(
      "Credit is given for only one of this and CS 1112, CS 1114"
    );
  });
});

describe("conflictMessage", () => {
  it("names the other course", () => {
    expect(conflictMessage("CS 2110")).toBe("Meets at the same time as CS 2110");
  });
});

describe("advisoryMessage", () => {
  it("strips a leading or/and so the prefix reads naturally", () => {
    expect(advisoryMessage("or equivalent AP credit")).toBe(
      "Usually also satisfied by: equivalent AP credit"
    );
    expect(advisoryMessage("and permission of instructor")).toBe(
      "Usually also satisfied by: permission of instructor"
    );
  });
  it("leaves a note with no leading conjunction untouched", () => {
    expect(advisoryMessage("AP credit also counts")).toBe(
      "Usually also satisfied by: AP credit also counts"
    );
  });
});

describe("mentionsCredit", () => {
  it("matches ap/credit/equivalent case-insensitively", () => {
    expect(mentionsCredit("or equivalent AP credit")).toBe(true);
    expect(mentionsCredit("Credit also counts")).toBe(true);
    expect(mentionsCredit("permission of instructor required")).toBe(false);
  });
});

describe("creditCouldUnblock", () => {
  const entries = [
    { satisfiesCourseIds: ["MATH-1910"] },
    { satisfiesCourseIds: ["CHEM-2090", "CHEM-2091"] },
  ];

  it("true when an unmet leaf matches an equivalency's satisfied course (dash→space)", () => {
    expect(creditCouldUnblock(["MATH 1910"], entries)).toBe(true);
    // Multi-course entry — any of its ids counts.
    expect(creditCouldUnblock(["PHYS 1112", "CHEM 2091"], entries)).toBe(true);
  });

  it("false when no leaf corresponds to any equivalency", () => {
    expect(creditCouldUnblock(["CS 4820"], entries)).toBe(false);
    expect(creditCouldUnblock([], entries)).toBe(false);
    expect(creditCouldUnblock(["MATH 1910"], [])).toBe(false);
  });

  it("pattern leaves are ignored — exact code matches only", () => {
    expect(creditCouldUnblock(["MATH 19xx"], entries)).toBe(false);
    expect(creditCouldUnblock(["CS 111x"], entries)).toBe(false);
  });
});
