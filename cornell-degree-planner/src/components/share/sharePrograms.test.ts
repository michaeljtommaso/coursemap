import { describe, expect, it } from "vitest";
import { extraProgramLabel, prettifyProgramId, shareProgramsLine } from "./sharePrograms";

// Spec 047 D13: the share header names every program.

describe("shareProgramsLine", () => {
  it("names the primary, the second major and each minor", () => {
    expect(
      shareProgramsLine(
        "Economics",
        [
          { programId: "mathematics", kind: "major" },
          { programId: "cs-minor", kind: "minor" },
        ],
        { mathematics: "Mathematics", "cs-minor": "CS minor" }
      )
    ).toBe("Economics + Mathematics (second major) + CS minor");
  });

  it("is the primary alone for a share without extra programs", () => {
    expect(shareProgramsLine("Economics (BA)", undefined, {})).toBe("Economics (BA)");
    expect(shareProgramsLine("Economics (BA)", [], {})).toBe("Economics (BA)");
  });

  it("falls back to a prettified id and adds 'minor' where the name lacks it", () => {
    expect(prettifyProgramId("cas-applied_math")).toBe("Cas Applied Math");
    expect(extraProgramLabel({ programId: "music", kind: "minor" }, "Music")).toBe("Music minor");
    expect(extraProgramLabel({ programId: "music-minor", kind: "minor" }, undefined)).toBe("Music Minor");
    expect(extraProgramLabel({ programId: "physics", kind: "major" }, undefined)).toBe("Physics (second major)");
  });
});
