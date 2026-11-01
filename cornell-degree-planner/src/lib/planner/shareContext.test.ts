import { describe, it, expect } from "vitest";
import { ShareCreateSchema } from "@/lib/schemas";
import { shareAnswerFields, shareCollegeRuleSet, shareProgressInput } from "./shareContext";
import { selectLayers } from "./distribution/select";
import type { Layer } from "./distribution/types";
import calsCollege2025 from "./distribution/fixtures/cals-college-2025.json";
import calsCollegePre2025 from "./distribution/fixtures/cals-college-pre2025.json";
import casCollege from "./distribution/fixtures/cas-college.json";

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

describe("shareCollegeRuleSet (spec 020 D6 — a rule set never reveals transfer status)", () => {
  const major = (family: "cas" | "cals", programId: string) =>
    ({ id: programId, kind: "major", family, programId, name: "Test major", rows: [] }) as unknown as Layer;
  const calsLayers = [calsCollege2025 as unknown as Layer, calsCollegePre2025 as unknown as Layer, major("cals", "cals-test-bs")];
  const casLayers = [casCollege as unknown as Layer, major("cas", "cas-test-ba")];
  // The layer the app scores with (selectLayers on the full answers) — what
  // useRequirementProgress hands the share button as collegeLayerId.
  const chosen = (layers: Layer[], family: "cas" | "cals", programId: string, ctx: object) =>
    selectLayers(layers, { family, programId, ...ctx }).layers.find((l) => l.kind === "college")?.id;
  const cals = (entryTerm: string, transfer: "none" | "external" | "internal", transferStanding: string | null) => {
    const ctx = { entryTerm, transfer, transferStanding };
    const id = chosen(calsLayers, "cals", "cals-test-bs", ctx);
    return { id, shared: shareCollegeRuleSet(id, { layers: calsLayers, family: "cals", programId: "cals-test-bs", entryTerm }) };
  };

  it("FA25, not a transfer → keeps cals-college-2025 (the entry term alone picks it)", () => {
    expect(cals("FA25", "none", null)).toEqual({ id: "cals-college-2025", shared: "cals-college-2025" });
  });

  it("FA25 external transfer entering as a sophomore → omits cals-college-pre2025", () => {
    expect(cals("FA25", "external", "sophomore")).toEqual({ id: "cals-college-pre2025", shared: undefined });
  });

  it("FA26 external transfer entering as a junior → omits cals-college-pre2025", () => {
    expect(cals("FA26", "external", "junior")).toEqual({ id: "cals-college-pre2025", shared: undefined });
  });

  it("an entry before FA25 keeps cals-college-pre2025 (the entry term alone picks it)", () => {
    expect(cals("FA24", "none", null)).toEqual({ id: "cals-college-pre2025", shared: "cals-college-pre2025" });
    expect(cals("FA24", "external", "junior")).toEqual({ id: "cals-college-pre2025", shared: "cals-college-pre2025" });
  });

  it("CAS keeps its single college layer even for a transfer (it reveals nothing)", () => {
    const ctx = { entryTerm: "FA25", transfer: "external", transferStanding: "junior" };
    const id = chosen(casLayers, "cas", "cas-test-ba", ctx);
    expect(id).toBe("cas-college");
    expect(shareCollegeRuleSet(id, { layers: casLayers, family: "cas", programId: "cas-test-ba", entryTerm: "FA25" })).toBe(
      "cas-college"
    );
  });

  it("omits the rule set when there is none, or the layers haven't loaded", () => {
    expect(shareCollegeRuleSet(undefined, { layers: calsLayers, family: "cals", programId: "cals-test-bs", entryTerm: "FA25" })).toBeUndefined();
    expect(shareCollegeRuleSet("cals-college-2025", { layers: undefined, family: "cals", programId: "cals-test-bs", entryTerm: "FA25" })).toBeUndefined();
  });

  it("an omitted rule set leaves collegeRuleSet off the share entirely (old-share shape)", () => {
    const { shared } = cals("FA26", "external", "junior");
    const fields = shareAnswerFields({ collegeLayerId: shared, courseMarks: {}, concentrationIds: [] });
    expect("collegeRuleSet" in fields).toBe(false);
  });
});
