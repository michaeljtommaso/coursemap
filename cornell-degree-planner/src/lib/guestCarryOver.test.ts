import { describe, expect, it } from "vitest";
import {
  activePlanAfterCarry,
  answersGapFill,
  carryName,
  currentProgramContent,
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

  it("carries an empty board that holds tried classes or course marks (audit F3)", () => {
    const tried = plan({ id: "a" });
    tried.content.placements = [];
    tried.content.triedCourseIds = ["HIST-1530"];
    expect(shouldCarry(tried)).toBe(true);
    const marked = plan({ id: "b" });
    marked.content.placements = [];
    marked.content.courseMarks = { "creditsTaken:CHEM-2070": 4 };
    expect(shouldCarry(marked)).toBe(true);
    // Still only when it was edited after being created.
    const untouched = plan({ id: "c", createdAtMs: 5, updatedAtMs: 5 });
    untouched.content.placements = [];
    untouched.content.triedCourseIds = ["HIST-1530"];
    expect(shouldCarry(untouched)).toBe(false);
    // Empty lists are not content.
    const empty = plan({ id: "d" });
    empty.content.placements = [];
    empty.content.triedCourseIds = [];
    empty.content.courseMarks = {};
    expect(shouldCarry(empty)).toBe(false);
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

describe("studentPrefsGapFill — concentration", () => {
  const blank = { entryTerm: null, transfer: null, transferStanding: null, college: null, concentration: null };
  const chosen = { programId: "maj", ids: ["a"] };

  it("carries the guest's concentration into an account with none", () => {
    expect(
      studentPrefsGapFill(profile({ studentPrefs: blank }), profile({ studentPrefs: { ...blank, concentration: chosen } }))
    ).toEqual({ concentration: chosen });
  });

  it("never replaces the account's own concentration", () => {
    expect(
      studentPrefsGapFill(
        profile({ studentPrefs: { ...blank, concentration: { programId: "maj", ids: ["b"] } } }),
        profile({ studentPrefs: { ...blank, concentration: chosen } })
      )
    ).toEqual({});
  });
});

describe("spec 020 — answers and course marks carry over (D10)", () => {
  const HONORS = "studentFact:honorsProgram:cas-linguistics";
  const AEM = "studentFact:acceptedToProgram:cals-aem";
  const EXAM = "studentFact:departmentExamPassed:cas-economics";

  it("a plan copy keeps its course marks", () => {
    const g = plan({ id: "g1" });
    g.content.courseMarks = { "usedAs:cas-college/fws@ENGL-2880": "yes", "creditsTaken:BIOMI-4850": 3 };
    const [copy] = planCopies([g], [], () => "n");
    expect(copy.input.courseMarks).toEqual(g.content.courseMarks);
  });

  it("answersGapFill adds only the questions the account hasn't answered; the account's answer wins", () => {
    expect(answersGapFill({ [HONORS]: "no" }, { [HONORS]: "yes", [AEM]: "yes" })).toEqual({
      [HONORS]: "no",
      [AEM]: "yes",
    });
  });

  it("answersGapFill is null when nothing is added", () => {
    expect(answersGapFill({ [HONORS]: "no" }, { [HONORS]: "yes" })).toBeNull();
    expect(answersGapFill({}, {})).toBeNull();
  });

  it("answersGapFill stops at the 30-answer cap", () => {
    const account = Object.fromEntries(
      Array.from({ length: 29 }, (_, i) => [`studentFact:honorsProgram:p${i}`, "yes" as const])
    );
    const out = answersGapFill(account, { [AEM]: "yes", [EXAM]: "yes" })!;
    expect(Object.keys(out)).toHaveLength(30);
    expect(out[AEM]).toBe("yes");
    expect(out).not.toHaveProperty(EXAM);
  });

  it("studentPrefsGapFill carries the merged answers map, and omits it when nothing is added", () => {
    const account = profile({ studentPrefs: { answers: { [HONORS]: "no" } } });
    expect(studentPrefsGapFill(account, profile({ studentPrefs: { answers: { [AEM]: "yes" } } }))).toEqual({
      answers: { [HONORS]: "no", [AEM]: "yes" },
    });
    expect(studentPrefsGapFill(account, profile({ studentPrefs: { answers: { [HONORS]: "yes" } } }))).toEqual({});
    // A retry stashed before spec 020 has no answers on either side.
    expect(studentPrefsGapFill(profile(), profile())).toEqual({});
  });
});

describe("currentProgramContent (spec 019 D12)", () => {
  const NEW = "cornell-information-science-bs-2026";

  it("moves a plan saved under a retired id to the current id, waivers translated", () => {
    const content = {
      ...plan({ id: "g" }).content,
      programId: "cornell-infosci-bs-2025",
      waivedRequirementIds: ["infosci-s1-cs111x", "infosci-concentration", `${NEW}:core-web`],
    };
    expect(currentProgramContent(content)).toEqual({
      ...content,
      programId: NEW,
      waivedRequirementIds: [`${NEW}:programming`, `${NEW}:core-web`],
    });
  });

  it("returns any other plan as is", () => {
    const content = { ...plan({ id: "g" }).content, waivedRequirementIds: ["infosci-s1-cs111x"] };
    expect(currentProgramContent(content)).toBe(content);
  });

  it("tolerates a malformed stash entry", () => {
    const junk = null as unknown as CarryPlan["content"];
    expect(currentProgramContent(junk)).toBeNull();
  });
});

describe("spec 028 — tried classes carry over (D12)", () => {
  it("a plan copy keeps its tried classes", () => {
    const g = plan({ id: "g1" });
    g.content.triedCourseIds = ["CS-2110", "PSYCH-1101"];
    const [copy] = planCopies([g], [], () => "n");
    expect(copy.input.triedCourseIds).toEqual(["CS-2110", "PSYCH-1101"]);
  });

  it("a plan under a retired program id keeps its tried classes unchanged", () => {
    const content = {
      ...plan({ id: "g" }).content,
      programId: "cornell-infosci-bs-2025",
      triedCourseIds: ["INFO-2950"],
    };
    expect(currentProgramContent(content).triedCourseIds).toEqual(["INFO-2950"]);
    expect(currentProgramContent(content).programId).toBe("cornell-information-science-bs-2026");
  });
});
