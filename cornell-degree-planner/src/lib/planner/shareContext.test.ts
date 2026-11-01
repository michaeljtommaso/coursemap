import { describe, it, expect } from "vitest";
import { ShareCreateSchema } from "@/lib/schemas";
import { shareAnswerFields, shareProgressInput } from "./shareContext";

const BASE = {
  createdBy: "uid-1",
  planName: "Sam's plan",
  programId: "cornell-history-ba",
  programName: "History",
  enteringYear: 2025,
  placements: [{ id: "p1", courseId: "ENGL-2880", sem: 1, order: 0 }],
  courseSnapshots: {},
  completedIds: [],
  inProgressIds: [],
  waivedRequirementIds: [],
  schemaVersion: 3,
  createdAt: new Date(),
};

describe("shareAnswerFields (spec 020 D6)", () => {
  it("copies course marks, the college rule set and the concentrations — and nothing else", () => {
    const fields = shareAnswerFields({
      courseMarks: { "usedAs:cas-college/fws@ENGL-2880": "yes", "creditsTaken:BIOMI-4850": 3 },
      collegeLayerId: "cals-college-pre2025",
      concentrationIds: ["ecology", "ecology", "genetics"],
    });
    expect(fields).toEqual({
      courseMarks: { "usedAs:cas-college/fws@ENGL-2880": "yes", "creditsTaken:BIOMI-4850": 3 },
      collegeRuleSet: "cals-college-pre2025",
      concentrationIds: ["ecology", "genetics"],
    });
    expect(Object.keys(fields).sort()).toEqual(["collegeRuleSet", "concentrationIds", "courseMarks"]);
    expect(ShareCreateSchema.safeParse({ ...BASE, ...fields }).success).toBe(true);
  });

  it("never carries facts or start answers, even when handed a whole profile by mistake", () => {
    const profileLike = {
      courseMarks: {},
      answers: { "studentFact:honorsProgram:cornell-history-ba": "yes" },
      entryTerm: "FA25",
      transfer: "external",
      transferStanding: "sophomore",
    };
    const fields = shareAnswerFields(profileLike as Parameters<typeof shareAnswerFields>[0]);
    expect(fields).toEqual({});
    const json = JSON.stringify(fields);
    for (const banned of ["answers", "entryTerm", "transfer", "studentFact"]) expect(json).not.toContain(banned);
  });

  it("an Engineering plan (nothing to say) writes the pre-spec-020 share shape", () => {
    expect(shareAnswerFields({ courseMarks: {}, collegeLayerId: undefined, concentrationIds: [] })).toEqual({});
    expect(shareAnswerFields({})).toEqual({});
  });

  it("caps concentrations at the share limit (3)", () => {
    expect(shareAnswerFields({ concentrationIds: ["a", "b", "c", "d"] }).concentrationIds).toEqual(["a", "b", "c"]);
  });

  it("a malformed mark key fails the share create schema (validated before writing)", () => {
    const fields = shareAnswerFields({ courseMarks: { "bad.key": "yes" } });
    expect(ShareCreateSchema.safeParse({ ...BASE, ...fields }).success).toBe(false);
  });
});

describe("shareProgressInput (contract C)", () => {
  it("reads the rule set, concentrations and marks back", () => {
    expect(
      shareProgressInput({
        collegeRuleSet: "cas-college",
        concentrationIds: ["x"],
        courseMarks: { "usedAs:cas-college/fws@ENGL-2880": "yes" },
      })
    ).toEqual({
      collegeLayerId: "cas-college",
      concentrationIds: ["x"],
      courseMarks: { "usedAs:cas-college/fws@ENGL-2880": "yes" },
    });
  });

  it("a share written before spec 020 reads as no rule set, no concentrations, no marks", () => {
    expect(shareProgressInput({})).toEqual({ concentrationIds: [], courseMarks: {} });
  });
});
