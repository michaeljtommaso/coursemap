import { describe, expect, it } from "vitest";
import type { OverlapPair, ProgramSection, RequirementGroup, RequirementItem } from "@/hooks/useRequirementProgress";
import {
  countItForLabel,
  countsForChoices,
  forbiddenSectionIds,
  hasExtraPrograms,
  heldBackLine,
  heldBackReason,
  limitText,
  overlapLine,
  programLayerId,
  resolveHeldBack,
  sectionIdOf,
} from "./programSections";

// Spec 047: the views' shared reading of several programs (fictional plan).

const section = (id: string, kind: ProgramSection["kind"], shortName: string, color: ProgramSection["color"] = null): ProgramSection => ({
  id,
  kind,
  name: shortName,
  shortName,
  color,
  pct: 0,
  satisfiedCount: 0,
  total: 0,
  status: "ok",
});
const SECTIONS = [
  section("cas-college", "college", "Arts & Sciences"),
  section("economics", "primary", "Economics"),
  section("mathematics", "secondMajor", "Mathematics", 1),
  section("cs-minor", "minor", "CS minor", 2),
];
const row = (layerId: string, layerKind: "college" | "major" | "concentration" | "minor"): RequirementItem => ({
  id: `${layerId}:r`,
  label: "r",
  category: null,
  suggestedSem: null,
  status: "unmet",
  coveredBy: [],
  checkable: true,
  requirement: null,
  dist: { layerId, rowId: "r", layerKind, rowKind: "seat", engineStatus: "unmet", countedCodes: [] },
});
const group = (key: string, items: RequirementItem[], sectionId?: string): RequirementGroup => ({
  key,
  label: key,
  items,
  satisfiedCount: 0,
  total: items.length,
  ...(sectionId ? { sectionId } : {}),
});
const GROUPS = [
  group("college", [row("cas-college", "college")], "cas-college"),
  group("econ", [row("econ", "major")], "economics"),
  group("math-conc", [row("math-applied", "concentration")], "mathematics"),
  group("math", [row("math-ba", "major")], "mathematics"),
  group("cs", [row("cs-minor-layer", "minor")], "cs-minor"),
];
const code = (id: string) => id.replace(/-/g, " ");
const name = (id: string) => SECTIONS.find((s) => s.id === id)?.shortName ?? id;

describe("programSections", () => {
  it("a plan has extra programs only with a second major or minor", () => {
    expect(hasExtraPrograms({ sections: SECTIONS })).toBe(true);
    expect(hasExtraPrograms({ sections: SECTIONS.slice(0, 2) })).toBe(false);
    expect(hasExtraPrograms({})).toBe(false);
  });

  it("a group's section: its sectionId, else college by layer, else the primary", () => {
    expect(sectionIdOf(GROUPS[3], SECTIONS)).toBe("mathematics");
    expect(sectionIdOf(group("x", [row("cas-college", "college")]), SECTIONS)).toBe("cas-college");
    expect(sectionIdOf(group("y", [row("econ", "major")]), SECTIONS)).toBe("economics");
    expect(sectionIdOf(group("z", [row("econ", "major")], "gone"), SECTIONS)).toBe("economics");
  });

  it("a program's countsFor layer is its major or minor layer, not a concentration", () => {
    expect(programLayerId(GROUPS, "mathematics")).toBe("math-ba");
    expect(programLayerId(GROUPS, "cs-minor")).toBe("cs-minor-layer");
    expect(programLayerId(GROUPS, "nowhere")).toBeNull();
  });

  it("states each kind of limit", () => {
    expect(limitText({ maxCourses: 2 }, "Economics", "Mathematics")).toBe(
      "Economics and Mathematics can share at most 2 courses"
    );
    expect(limitText({ maxCredits: 12, with: ["econ"] }, "Economics", "Public Policy")).toBe(
      "Economics and Public Policy can share at most 12 credits"
    );
    expect(limitText({ maxCourses: 1, maxCredits: 4 }, "A", "B")).toBe("A and B can share at most 1 course and 4 credits");
    expect(limitText("none", "A", "B")).toBe("A and B can't share any courses");
    expect(limitText("forbidden", "Biological Sciences", "Biology & Society")).toBe(
      "Biology & Society can't be combined with Biological Sciences"
    );
  });

  it("the overlap line: usage, then the held-back courses grouped by where they still count", () => {
    const pair: OverlapPair = {
      a: "economics",
      b: "mathematics",
      limit: { maxCourses: 2 },
      sharedCourseIds: ["MATH-2210", "ECON-3130"],
      heldBack: [
        { courseId: "ECON-3110", placementId: "p1", countsFor: "economics", heldFrom: "mathematics" },
        { courseId: "ECON-3120", placementId: "p2", countsFor: "economics", heldFrom: "mathematics" },
      ],
      estimated: false,
    };
    expect(overlapLine(pair, name, code)).toBe(
      "2 of 2 shared courses used · ECON 3110 and ECON 3120 count for Economics only, because of the limit."
    );
    expect(overlapLine({ ...pair, limitFrom: "mathematics" }, name, code)).toBe(
      "2 of 2 shared courses used · ECON 3110 and ECON 3120 count for Economics only, because of the Mathematics limit."
    );
    expect(overlapLine({ ...pair, heldBack: [], sharedCourseIds: ["MATH-2210"] }, name, code)).toBe(
      "1 of 2 shared courses used."
    );
    expect(overlapLine({ ...pair, limit: "none", heldBack: [pair.heldBack[0]], estimated: true }, name, code)).toBe(
      "No shared courses allowed · ECON 3110 counts for Economics only, because of the limit. Estimated: your progress may be a little higher."
    );
    expect(overlapLine({ ...pair, limit: "forbidden" }, name, code)).toBe(
      "Mathematics can't be combined with Economics. Check with your advisor."
    );
  });

  it("forbidden pairs flag their later program", () => {
    const pair: OverlapPair = { a: "economics", b: "mathematics", limit: "forbidden", sharedCourseIds: [], heldBack: [], estimated: false };
    expect([...forbiddenSectionIds({ overlap: [pair] })]).toEqual(["mathematics"]);
  });

  it("resolves held-back courses with names, the limit and the layer to count it for", () => {
    const held = { courseId: "ECON-3110", placementId: "p1", countsFor: "economics", heldFrom: "mathematics" };
    const out = resolveHeldBack({
      groups: GROUPS,
      sections: SECTIONS,
      overlap: [{ a: "economics", b: "mathematics", limit: { maxCourses: 2 }, sharedCourseIds: [], heldBack: [held], estimated: false }],
      heldBackByPlacement: { p1: [held], p9: [] },
    });
    expect(Object.keys(out)).toEqual(["p1"]);
    const h = out.p1[0];
    expect(h).toMatchObject({ countsForName: "Economics", heldFromName: "Mathematics", layerId: "math-ba" });
    expect(heldBackLine(h)).toBe("Held back from Mathematics (overlap limit)");
    expect(heldBackReason(h, "ECON 3110")).toBe(
      "Economics and Mathematics can share at most 2 courses, so ECON 3110 counts for Economics only."
    );
    expect(countItForLabel(h)).toBe("Count it for Mathematics instead");
  });

  it("lists countsFor choices, named, and only 'yes' marks", () => {
    const choices = countsForChoices(
      {
        "countsFor:math-ba@ECON-3110": "yes",
        "countsFor:old-minor@HIST-1200": "yes",
        "countsFor:econ@ECON-3120": "no",
        "usedAs:cas-college/fws@ENGL-2880": "yes",
      },
      { groups: GROUPS, sections: SECTIONS },
      code
    );
    expect(choices).toEqual([
      { key: "countsFor:math-ba@ECON-3110", text: "ECON 3110 counts for Mathematics" },
      { key: "countsFor:old-minor@HIST-1200", text: "HIST 1200 counts for a program not on this plan" },
    ]);
  });
});
