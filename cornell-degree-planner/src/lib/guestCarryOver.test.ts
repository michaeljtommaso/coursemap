import { describe, expect, it } from "vitest";
import {
  activePlanAfterCarry,
  carryName,
  planCopies,
  profileGapFill,
  shouldCarry,
  studentPrefsGapFill,
  type CarryPlan,
  type CarryProfile,
} from "./guestCarryOver";

function plan(over: Partial<CarryPlan> & { id: string; name?: string }): CarryPlan {
  const { name = "ORE", ...rest } = over;
  return {
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    legacy: false,
    content: {
      name,
      programId: "ore",
      placements: [{ id: "p1", courseId: "MATH1910", sem: 1, order: 0 }],
      courseSnapshots: {},
      completedIds: [],
      inProgressIds: [],
      waivedRequirementIds: [],
    },
    ...rest,
  };
}

function profile(over: Partial<CarryProfile> = {}): CarryProfile {
  return {
    activePlanId: null,
    favoriteCourseIds: [],
    pinnedCourseIds: [],
    creditProfile: [],
    enteringYear: null,
    ...over,
  };
}

describe("shouldCarry", () => {
  it("carries an edited plan with courses", () => {
    expect(shouldCarry(plan({ id: "a" }))).toBe(true);
  });

  it("skips a starter board that was never saved after being created", () => {
    expect(shouldCarry(plan({ id: "a", createdAtMs: 5, updatedAtMs: 5 }))).toBe(false);
  });

  it("skips a plan with no courses on it", () => {
    const p = plan({ id: "a" });
    p.content.placements = [];
    expect(shouldCarry(p)).toBe(false);
  });

  it("skips a retired slot-shape plan", () => {
    expect(shouldCarry(plan({ id: "a", legacy: true }))).toBe(false);
  });

  it("carries when a timestamp is missing (copy rather than lose)", () => {
    expect(shouldCarry(plan({ id: "a", createdAtMs: null }))).toBe(true);
    expect(shouldCarry(plan({ id: "a", updatedAtMs: null }))).toBe(true);
  });
});

describe("carryName", () => {
  it("keeps a free name", () => {
    expect(carryName("ORE", new Set(["CS"]))).toBe("ORE");
  });

  it("labels a clash, then numbers further clashes", () => {
    expect(carryName("ORE", new Set(["ORE"]))).toBe("ORE (from guest)");
    expect(carryName("ORE", new Set(["ORE", "ORE (from guest)"]))).toBe("ORE (from guest 2)");
    expect(
      carryName("ORE", new Set(["ORE", "ORE (from guest)", "ORE (from guest 2)"]))
    ).toBe("ORE (from guest 3)");
  });

  it("trims the base so a labeled name fits the 80-character limit", () => {
    const long = "x".repeat(80);
    const out = carryName(long, new Set([long]));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith(" (from guest)")).toBe(true);
  });
});

describe("planCopies", () => {
  it("copies only carried plans, with fresh ids and clash labels", () => {
    let n = 0;
    const copies = planCopies(
      [
        plan({ id: "g1", name: "ORE" }),
        plan({ id: "g2", name: "CS", createdAtMs: 7, updatedAtMs: 7 }), // untouched
        plan({ id: "g3", name: "ORE" }), // guest's own duplicate name
      ],
      ["ORE"],
      () => `new${++n}`
    );
    expect(copies.map((c) => [c.fromId, c.newId, c.input.name])).toEqual([
      ["g1", "new1", "ORE (from guest)"],
      ["g3", "new2", "ORE (from guest 2)"],
    ]);
  });

  it("keeps the plan content as-is apart from the name", () => {
    const g = plan({ id: "g1", name: "Mine" });
    const [copy] = planCopies([g], [], () => "n");
    expect(copy.input).toEqual(g.content);
  });
});

describe("activePlanAfterCarry", () => {
  const copies = [{ fromId: "g1", newId: "n1", input: plan({ id: "g1" }).content }];

  it("points at the copy of the plan the guest was editing", () => {
    expect(activePlanAfterCarry("g1", copies)).toBe("n1");
  });

  it("is null when the guest's active plan wasn't copied", () => {
    expect(activePlanAfterCarry("g9", copies)).toBeNull();
    expect(activePlanAfterCarry(null, copies)).toBeNull();
  });
});

describe("profileGapFill", () => {
  it("is empty when the guest adds nothing", () => {
    expect(profileGapFill(profile({ favoriteCourseIds: ["A"] }), profile())).toEqual({});
  });

  it("unions favorites and pins, account first, capped", () => {
    const patch = profileGapFill(
      profile({ favoriteCourseIds: ["A", "B"], pinnedCourseIds: ["P1", "P2", "P3"] }),
      profile({ favoriteCourseIds: ["B", "C"], pinnedCourseIds: ["P3", "P4", "P5"] })
    );
    expect(patch.favoriteCourseIds).toEqual(["A", "B", "C"]);
    expect(patch.pinnedCourseIds).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("leaves favorites alone when the account is already at the cap", () => {
    const full = Array.from({ length: 200 }, (_, i) => `F${i}`);
    expect(
      profileGapFill(profile({ favoriteCourseIds: full }), profile({ favoriteCourseIds: ["NEW"] }))
        .favoriteCourseIds
    ).toBeUndefined();
  });

  it("brings credits and start year only into an account that has none", () => {
    const credit = { id: "ap-calc", kind: "ap" as const, label: "AP Calc BC", satisfiesCourseIds: ["MATH1910"] };
    const other = { id: "ap-bio", kind: "ap" as const, label: "AP Bio", satisfiesCourseIds: [] };
    expect(
      profileGapFill(profile(), profile({ creditProfile: [credit], enteringYear: 2025 }))
    ).toEqual({ creditProfile: [credit], enteringYear: 2025 });
    expect(
      profileGapFill(
        profile({ creditProfile: [other], enteringYear: 2024 }),
        profile({ creditProfile: [credit], enteringYear: 2025 })
      )
    ).toEqual({});
  });
});

describe("studentPrefsGapFill", () => {
  const answered = {
    entryTerm: "FA25",
    transfer: "external" as const,
    transferStanding: "sophomore" as const,
    college: "cas" as const,
  };
  const blank = { entryTerm: null, transfer: null, transferStanding: null, college: null };

  it("brings all of the guest's answers into an account that has none", () => {
    expect(
      studentPrefsGapFill(profile({ studentPrefs: blank }), profile({ studentPrefs: answered }))
    ).toEqual(answered);
  });

  it("carries only the guest's answered fields", () => {
    expect(
      studentPrefsGapFill(
        profile({ studentPrefs: blank }),
        profile({ studentPrefs: { ...blank, entryTerm: "SP26", college: "cals" } })
      )
    ).toEqual({ entryTerm: "SP26", college: "cals" });
  });

  it("start answers travel together; the college carries on its own (review F5)", () => {
    // An account with only a college still gets the guest's start answers.
    const { college: _college, ...start } = answered;
    expect(
      studentPrefsGapFill(
        profile({ studentPrefs: { ...blank, college: "engineering" } }),
        profile({ studentPrefs: answered })
      )
    ).toEqual(start);
    // An account with any start answer keeps all of its own; its missing college is filled.
    expect(
      studentPrefsGapFill(
        profile({ studentPrefs: { ...blank, transfer: "none" } }),
        profile({ studentPrefs: answered })
      )
    ).toEqual({ college: "cas" });
  });

  it("a guest start term that disagrees with the account's start year is not carried (review F5)", () => {
    // Account labels semesters from Fall 2023; the guest said Spring 2026.
    expect(
      studentPrefsGapFill(
        profile({ enteringYear: 2023, studentPrefs: blank }),
        profile({ enteringYear: 2025, studentPrefs: { ...answered, entryTerm: "SP26" } })
      )
    ).toEqual({ college: "cas" });
    // Spring 2026 starts the 2025 academic year: agrees with 2025.
    expect(
      studentPrefsGapFill(
        profile({ enteringYear: 2025, studentPrefs: blank }),
        profile({ studentPrefs: { ...answered, entryTerm: "SP26" } })
      ).entryTerm
    ).toBe("SP26");
  });

  it("is empty when the guest answered nothing", () => {
    expect(studentPrefsGapFill(profile({ studentPrefs: blank }), profile({ studentPrefs: blank }))).toEqual({});
  });

  it("reads a profile with no student prefs (a retry saved before spec 019) as unanswered", () => {
    expect(studentPrefsGapFill(profile(), profile({ studentPrefs: { college: "cas" } }))).toEqual({
      college: "cas",
    });
    expect(studentPrefsGapFill(profile({ studentPrefs: answered }), profile())).toEqual({});
  });
});
