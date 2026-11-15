import { describe, expect, it } from "vitest";
import type { ProgramSection, RequirementGroup } from "@/hooks/useRequirementProgress";
import { buildCardPrograms, cardLabelTooltip } from "./cardPrograms";

// Spec 047 D6/D8: a card's labels by program and its held-back courses.

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
const MATH_GROUP: RequirementGroup = {
  key: "math-ba:Electives",
  label: "Major · Electives",
  sectionId: "mathematics",
  satisfiedCount: 0,
  total: 1,
  items: [
    {
      id: "math-ba:elec",
      label: "Electives",
      category: null,
      suggestedSem: null,
      status: "unmet",
      coveredBy: [],
      checkable: true,
      requirement: null,
      dist: { layerId: "math-ba", rowId: "elec", layerKind: "major", rowKind: "pool", engineStatus: "unmet", countedCodes: [] },
    },
  ],
};

describe("buildCardPrograms", () => {
  it("is empty for a plan with no extra program (cards keep the plain line)", () => {
    expect(buildCardPrograms({ sections: SECTIONS.slice(0, 2), groups: [], attributionDetail: { p1: [{ label: "Core", sectionId: "economics" }] } })).toEqual({});
  });

  it("groups labels primary first (college with it, no dot), then each extra program in plan order", () => {
    const out = buildCardPrograms({
      sections: SECTIONS,
      groups: [MATH_GROUP],
      attributionDetail: {
        p1: [
          { label: "Intro programming", sectionId: "cs-minor" },
          { label: "Electives", sectionId: "mathematics" },
          { label: "Econometrics", sectionId: "economics" },
          { label: "Distribution", sectionId: "cas-college" },
        ],
      },
    });
    expect(out.p1.groups.map((g) => [g.extra, g.color, g.labels])).toEqual([
      [false, null, ["Econometrics", "Distribution"]],
      [true, 1, ["Electives"]],
      [true, 2, ["Intro programming"]],
    ]);
    expect(cardLabelTooltip(out.p1.groups)).toBe(
      "Counts toward Econometrics, Distribution · Mathematics: Electives · CS minor: Intro programming"
    );
    expect(out.p1.heldBack).toEqual([]);
  });

  it("carries a placement's held-back courses, even with no label of the other program", () => {
    const held = { courseId: "ECON-3110", placementId: "p2", countsFor: "economics", heldFrom: "mathematics" };
    const out = buildCardPrograms({
      sections: SECTIONS,
      groups: [MATH_GROUP],
      overlap: [{ a: "economics", b: "mathematics", limit: { maxCourses: 2 }, sharedCourseIds: [], heldBack: [held], estimated: false }],
      attributionDetail: { p2: [{ label: "Econometrics", sectionId: "economics" }] },
      heldBackByPlacement: { p2: [held] },
    });
    expect(out.p2.heldBack).toHaveLength(1);
    expect(out.p2.heldBack[0]).toMatchObject({ heldFromName: "Mathematics", countsForName: "Economics", layerId: "math-ba" });
  });
});
