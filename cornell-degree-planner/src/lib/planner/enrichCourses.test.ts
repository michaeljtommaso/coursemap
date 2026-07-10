import { describe, it, expect } from "vitest";
import {
  enrichCourse,
  enrichSlots,
  enrichSelectedCourses,
  collectPlanCourseIds,
} from "./enrichCourses";
import { computeSlotStatusMap } from "./computeSlotStatusMap";
import type { Course, PrereqExpr, ProgramSlotWithData } from "@/types/db";

function makeCourse(id: string, opts: Partial<Course> = {}): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject: subject ?? id,
    number: number ?? "",
    title: id,
    credits_min: 3,
    credits_max: 3,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    roster_id: null,
    updated_at: new Date(0).toISOString(),
    ...opts,
  };
}

function courseSlot(
  id: string,
  sem: number,
  course: Course | null
): ProgramSlotWithData {
  return {
    id,
    program_id: "prog",
    kind: "course",
    course_id: course?.id ?? null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: sem,
    slot_row: 0,
    category: null,
    courses: course,
    elective_groups: null,
  };
}

const needs1910: PrereqExpr = { type: "course", id: "MATH-1910" };

describe("enrichCourse", () => {
  it("overlays prereq/coreq/offered from the cached full doc", () => {
    const snapshot = makeCourse("MATH-1920"); // null exprs, no offered
    const detail = makeCourse("MATH-1920", {
      prereq_expr: needs1910,
      offered: ["FA", "SP"],
    });
    const out = enrichCourse(snapshot, { "MATH-1920": detail });
    expect(out.prereq_expr).toEqual(needs1910);
    expect(out.offered).toEqual(["FA", "SP"]);
    expect(out.title).toBe(snapshot.title); // display fields kept from snapshot
  });

  it("returns the same reference when no detail is cached", () => {
    const snapshot = makeCourse("MATH-1920");
    expect(enrichCourse(snapshot, {})).toBe(snapshot);
  });

  it("returns the same reference when the detail's fields are identical refs", () => {
    const offered: string[] = [];
    const c = makeCourse("CS-1110", { prereq_expr: null, offered });
    // Detail shares the exact same field references → nothing to overlay.
    const detail = makeCourse("CS-1110", { prereq_expr: null, offered });
    expect(enrichCourse(c, { "CS-1110": detail })).toBe(c);
  });
});

describe("enrichSlots / enrichSelectedCourses", () => {
  it("enriches embedded slot course snapshots", () => {
    const slots = [courseSlot("s1", 2, makeCourse("MATH-1920"))];
    const out = enrichSlots(slots, {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    });
    expect(out[0].courses?.prereq_expr).toEqual(needs1910);
  });

  it("returns same array reference when cache is empty", () => {
    const slots = [courseSlot("s1", 2, makeCourse("MATH-1920"))];
    expect(enrichSlots(slots, {})).toBe(slots);
  });

  it("enriches selected (user-placed) courses", () => {
    const selected = { "CS-4820": makeCourse("CS-4820") };
    const out = enrichSelectedCourses(selected, {
      "CS-4820": makeCourse("CS-4820", { prereq_expr: needs1910 }),
    });
    expect(out["CS-4820"].prereq_expr).toEqual(needs1910);
  });
});

describe("collectPlanCourseIds", () => {
  it("gathers template course ids and user selections, deduped", () => {
    const slots = [
      courseSlot("s1", 1, makeCourse("MATH-1910")),
      courseSlot("s2", 2, makeCourse("MATH-1920")),
      { ...courseSlot("s3", 3, null), kind: "elective" as const }, // no course
    ];
    const ids = collectPlanCourseIds(slots, { s3: "CS-4820", sX: "MATH-1910" });
    expect(new Set(ids)).toEqual(new Set(["MATH-1910", "MATH-1920", "CS-4820"]));
  });
});

describe("end-to-end: enrichment unblocks the engine", () => {
  it("template slot goes blocked once real prereq is overlaid", () => {
    // MATH 1920 in sem 2 needs MATH 1910; MATH 1910 is NOT on the plan.
    const slots = [courseSlot("s-1920", 2, makeCourse("MATH-1920"))];

    // Before enrichment (null expr): neutral, never blocked — the bug.
    const before = computeSlotStatusMap(slots, [], {}, {});
    expect(before.statusMap["s-1920"].prereq).toBeNull();
    expect(before.statusMap["s-1920"].blocked).toBe(false);

    // After enrichment: real expr present, prereq unmet → blocked with a leaf.
    const details = {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    };
    const enriched = enrichSlots(slots, details);
    const after = computeSlotStatusMap(enriched, [], {}, {});
    expect(after.statusMap["s-1920"].prereq).toBe(false);
    expect(after.statusMap["s-1920"].blocked).toBe(true);
    // The missing prereq isn't anywhere on the plan, so the engine can only
    // surface it by id (it resolves to a friendly "MATH 1910" code only when that
    // course appears in some slot / selection). Either way it's reported.
    expect(after.statusMap["s-1920"].unmetPrereqLeaves).toContain("MATH-1910");
  });

  it("stays satisfied when the prereq IS present in an earlier semester", () => {
    const slots = [
      courseSlot("s-1910", 1, makeCourse("MATH-1910")),
      courseSlot("s-1920", 2, makeCourse("MATH-1920")),
    ];
    const details = {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    };
    const after = computeSlotStatusMap(enrichSlots(slots, details), [], {}, {});
    expect(after.statusMap["s-1920"].prereq).toBe(true);
    expect(after.statusMap["s-1920"].blocked).toBe(false);
  });
});
