import { describe, it, expect } from "vitest";
import {
  resolveCardStatusLine,
  blockedMessage,
  offeredMessage,
  overlapMessage,
  advisoryMessage,
  mentionsCredit,
  type CardStatusLineInput,
} from "./statusLine";

function input(overrides: Partial<CardStatusLineInput> = {}): CardStatusLineInput {
  return {
    blocked: false,
    unmetPrereqLeaves: [],
    offeredOk: null,
    offered: [],
    overlaps: [],
    prereqState: null,
    advisoryNotes: [],
    ...overrides,
  };
}

describe("resolveCardStatusLine — precedence (spec 007 §1b)", () => {
  it("nothing when the card has no signal at all", () => {
    expect(resolveCardStatusLine(input())).toBeNull();
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

  it("overlap wins over advisory", () => {
    const line = resolveCardStatusLine(
      input({
        overlaps: ["CS 1112"],
        prereqState: "advisory",
        advisoryNotes: ["or equivalent AP credit"],
      })
    );
    expect(line).toEqual({ kind: "overlap", text: "Credit is given for only one of this and CS 1112" });
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
