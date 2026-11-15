import { describe, it, expect } from "vitest";
import type { Layer } from "@/lib/planner/distribution/types";
import { asksStudentFacts, shareLayerIds, shareMarkLines } from "./shareMarks";

const college = {
  id: "cas-college",
  kind: "college",
  name: "Arts & Sciences",
  rows: [{ id: "fws", label: "First-Year Writing Seminars" }],
} as unknown as Layer;

describe("shareMarkLines", () => {
  it("words each yes on its course, in the third person", () => {
    const lines = shareMarkLines(
      {
        "usedAs:cas-college/fws@ENGL-2880": "yes",
        "approvedFor:cas-college/fws@ENGL-2860": "yes",
        "creditsTaken:BIOMI-4850": 3,
        "sequenceDone:NTRES-4300": "yes",
      },
      [college]
    );
    expect(lines.get("ENGL-2880")).toEqual(["Used as First-Year Writing Seminars · the student's answer"]);
    expect(lines.get("ENGL-2860")).toEqual(["Approved for First-Year Writing Seminars · the student's answer"]);
    expect(lines.get("BIOMI-4850")).toEqual(["Taken for 3 credits · the student's answer"]);
    expect(lines.get("NTRES-4300")).toEqual(["Sequence completed · the student's answer"]);
  });

  it("a no shows nothing; unknown rows fall back; malformed keys are skipped", () => {
    const lines = shareMarkLines(
      { "usedAs:cas-college/fws@ENGL-2880": "no", "usedAs:other/x@HIST-1000": "yes", "nonsense": "yes" },
      [college]
    );
    expect(lines.has("ENGL-2880")).toBe(false);
    expect(lines.get("HIST-1000")).toEqual(["Used as a requirement · the student's answer"]);
    expect(lines.size).toBe(1);
  });

  it("no marks → nothing", () => {
    expect(shareMarkLines(undefined, []).size).toBe(0);
  });
});

describe("asksStudentFacts / shareLayerIds", () => {
  it("true only when a layer asks a student fact", () => {
    const withFact = { ...college, questions: [{ type: "studentFact", fact: "honorsProgram", subject: "LING" }] } as Layer;
    expect(asksStudentFacts([college])).toBe(false);
    expect(asksStudentFacts([college, withFact])).toBe(true);
  });

  it("major, recorded rule set, then concentrations", () => {
    expect(shareLayerIds({ programId: "bio", collegeRuleSet: "cals-college-2025", concentrationIds: ["neuro"] })).toEqual([
      "bio",
      "cals-college-2025",
      "bio--neuro",
    ]);
    expect(shareLayerIds({ programId: "" })).toEqual([]);
  });

  it("a share with extra programs also names their layers: the minor, the second major and its concentrations (audit #9)", () => {
    expect(
      shareLayerIds({
        programId: "econ",
        collegeRuleSet: "cas-college",
        additionalPrograms: [
          { programId: "math", kind: "major", concentrationIds: ["applied"] },
          { programId: "cs-minor", kind: "minor" },
        ],
      })
    ).toEqual(["econ", "cas-college", "math", "math--applied", "cs-minor"]);
  });

  it("an answer on a minor's row reads with its real label once that layer is loaded", () => {
    const minor = { id: "cs-minor", kind: "minor", name: "CS minor", rows: [{ id: "intro", label: "Intro programming" }] } as unknown as Layer;
    const marks = { "usedAs:cs-minor/intro@CS-1112": "yes" as const };
    expect(shareMarkLines(marks, [college]).get("CS-1112")).toEqual(["Used as a requirement · the student's answer"]);
    expect(shareMarkLines(marks, [college, minor]).get("CS-1112")).toEqual([
      "Used as Intro programming · the student's answer",
    ]);
  });
});
