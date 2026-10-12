import { describe, it, expect } from "vitest";
import {
  forbiddenOverlapCodes,
  topUnlocks,
  distributionTags,
  scheduleFit,
  professorEmptyState,
  formatCourseCode,
  EM_DASH,
} from "./compare";
import type { ConflictPlacement } from "./conflicts";
import type { CourseSection } from "@/types/db";

function section(pattern: string, timeStart: string, timeEnd: string, component = "LEC"): CourseSection {
  return {
    code: `${component} 001`,
    component,
    openStatus: "O",
    gradingBasis: "GRD",
    components: [component],
    instructors: [],
    meetings: pattern ? [{ pattern, timeStart, timeEnd }] : [],
  };
}

function placement(placementId: string, courseId: string, sections: CourseSection[]): ConflictPlacement {
  return { placementId, courseId, courseCode: formatCourseCode(courseId), sections };
}

describe("forbiddenOverlapCodes — pinned-pair detection (spec 013 §2)", () => {
  it("flags both directions when either course lists the other", () => {
    const map = forbiddenOverlapCodes([
      { id: "CS-2110", forbiddenOverlaps: ["CS-2112"] },
      { id: "CS-2112", forbiddenOverlaps: [] }, // one-directional data
    ]);
    expect(map.get("CS-2110")).toEqual(["CS 2112"]);
    expect(map.get("CS-2112")).toEqual(["CS 2110"]);
  });

  it("ignores a forbidden id that is not itself pinned", () => {
    const map = forbiddenOverlapCodes([{ id: "CS-2110", forbiddenOverlaps: ["MATH-1920"] }]);
    expect(map.size).toBe(0);
  });

  it("no overlaps → empty map", () => {
    const map = forbiddenOverlapCodes([
      { id: "CS-2110", forbiddenOverlaps: [] },
      { id: "PHYS-1112", forbiddenOverlaps: [] },
    ]);
    expect(map.size).toBe(0);
  });

  it("dedupes and covers three-way pins", () => {
    const map = forbiddenOverlapCodes([
      { id: "A-1", forbiddenOverlaps: ["B-2", "C-3"] },
      { id: "B-2", forbiddenOverlaps: ["A-1"] },
      { id: "C-3", forbiddenOverlaps: [] },
    ]);
    expect(map.get("A-1")).toEqual(["B 2", "C 3"]);
    expect(map.get("B-2")).toEqual(["A 1"]);
    expect(map.get("C-3")).toEqual(["A 1"]);
  });
});

describe("topUnlocks", () => {
  it("counts all, formats top 3 to code form", () => {
    const r = topUnlocks(["CS-2110", "CS-2112", "CS-3110", "CS-4410", "CS-4820"]);
    expect(r.count).toBe(5);
    expect(r.top).toEqual(["CS 2110", "CS 2112", "CS 3110"]);
  });
  it("empty → count 0, no top", () => {
    expect(topUnlocks([])).toEqual({ count: 0, top: [] });
  });
});

describe("distributionTags", () => {
  it("dedupes attr values, preserving order", () => {
    expect(distributionTags([{ value: "MQR-AS" }, { value: "PBS-AS" }, { value: "MQR-AS" }])).toEqual([
      "MQR-AS",
      "PBS-AS",
    ]);
  });
  it("null/empty → []", () => {
    expect(distributionTags(null)).toEqual([]);
    expect(distributionTags([])).toEqual([]);
  });
});

describe("scheduleFit — near-horizon collision (spec 013 §2)", () => {
  const target = placement("pin:CS-2110", "CS-2110", [section("MWF", "10:00AM", "10:50AM")]);

  it("no near placements → none (em-dash)", () => {
    expect(scheduleFit(target, [])).toEqual({ kind: "none" });
  });

  it("has a window and no collision → fits", () => {
    const others = [placement("s1", "MATH-1920", [section("TR", "1:00PM", "2:15PM")])];
    expect(scheduleFit(target, others)).toEqual({ kind: "fits" });
  });

  it("overlapping day+time → collides, names the other course", () => {
    const others = [placement("s1", "PHYS-1112", [section("MWF", "10:30AM", "11:20AM")])];
    expect(scheduleFit(target, others)).toEqual({ kind: "collides", withCode: "PHYS 1112" });
  });

  it("target has no usable meeting → none even with near placements", () => {
    const noWindow = placement("pin:CS-2110", "CS-2110", [section("", "", "")]);
    const others = [placement("s1", "MATH-1920", [section("TR", "1:00PM", "2:15PM")])];
    expect(scheduleFit(noWindow, others)).toEqual({ kind: "none" });
  });
});

describe("professorEmptyState (spec 013 §3a/§4)", () => {
  it("far + configured target → announced-closer honesty line", () => {
    expect(professorEmptyState("far", true)).toBe("instructors announced closer to the semester");
  });
  it("near + target → em-dash (near but no data under NullAdapter)", () => {
    expect(professorEmptyState("near", true)).toBe(EM_DASH);
  });
  it("far + no target → em-dash (can't claim distance)", () => {
    expect(professorEmptyState("far", false)).toBe(EM_DASH);
  });
});
