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
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
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

  it("overlays forbidden_overlaps and prereq_notes from the cached full doc", () => {
    // The exact "starved engine" fix (spec 007 §4): snapshots carry [] for both,
    // so without this overlay the engine never sees a snapshot course's overlap /
    // notes data.
    const snapshot = makeCourse("CS-1110"); // [] overlaps, [] notes
    const detail = makeCourse("CS-1110", {
      forbidden_overlaps: ["CS-1112"],
      prereq_notes: ["Students with a 5 on AP CS-A should consider CS 2110."],
    });
    const out = enrichCourse(snapshot, { "CS-1110": detail });
    expect(out.forbidden_overlaps).toEqual(["CS-1112"]);
    expect(out.prereq_notes).toEqual([
      "Students with a 5 on AP CS-A should consider CS 2110.",
    ]);
    expect(out.title).toBe(snapshot.title); // display fields kept from snapshot
  });

  it("returns the same reference when no detail is cached", () => {
    const snapshot = makeCourse("MATH-1920");
    expect(enrichCourse(snapshot, {})).toBe(snapshot);
  });

  it("returns the same reference when the detail's fields are identical refs", () => {
    const offered: string[] = [];
    const forbidden_overlaps: string[] = [];
    const prereq_notes: string[] = [];
    const attrs: Course["attrs"] = [];
    const sections: Course["sections"] = [];
    const components: string[] = [];
    const shared = {
      prereq_expr: null,
      offered,
      forbidden_overlaps,
      prereq_notes,
      attrs,
      sections,
      components,
    };
    const c = makeCourse("CS-1110", shared);
    // Detail shares the exact same field references → nothing to overlay.
    const detail = makeCourse("CS-1110", shared);
    expect(enrichCourse(c, { "CS-1110": detail })).toBe(c);
  });

  it("overlays attrs/sections/components from the cached full doc (spec 010 §5)", () => {
    // Same starved-engine rationale as forbidden_overlaps/prereq_notes above:
    // template/plan snapshots carry [] for these Unit 10A fields, so without
    // this overlay the engine never sees a snapshot course's distribution
    // attrs, section/instructor data, or component workload signal.
    const snapshot = makeCourse("CS-2110"); // [] attrs/sections/components
    const detail = makeCourse("CS-2110", {
      attrs: [{ value: "SMR-AS", descr: "AS-Symbolic & Mathematic Rsng", group: "Distribution Requirements" }],
      sections: [
        {
          code: "LEC 001",
          component: "LEC",
          openStatus: "O",
          gradingBasis: "OPT",
          components: ["LEC", "DIS"],
          instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }],
          meetings: [{ pattern: "TR", timeStart: "10:10AM", timeEnd: "11:25AM" }],
        },
      ],
      components: ["LEC", "DIS"],
    });
    const out = enrichCourse(snapshot, { "CS-2110": detail });
    expect(out.attrs).toEqual(detail.attrs);
    expect(out.sections).toEqual(detail.sections);
    expect(out.components).toEqual(detail.components);
    expect(out.title).toBe(snapshot.title); // display fields kept from snapshot
  });

  it("overlays roster (the sync's SLUG — near-face root-cause fix) from the cached full doc", () => {
    // Snapshots carry roster: null; the horizon gates compare roster to the
    // enrollmentTarget, so without this overlay the near face never activates.
    const snapshot = makeCourse("CS-2110"); // roster: null
    const detail = makeCourse("CS-2110", { roster: "FA26" });
    const out = enrichCourse(snapshot, { "CS-2110": detail });
    expect(out.roster).toBe("FA26");
    expect(out.title).toBe(snapshot.title);
  });

  it("a detail doc with roster null (pre-fix sync) leaves roster null — never invents a slug", () => {
    const snapshot = makeCourse("CS-2110");
    const detail = makeCourse("CS-2110", { offered: ["FA"] }); // roster: null
    const out = enrichCourse(snapshot, { "CS-2110": detail });
    expect(out.roster).toBeNull();
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
    // The missing prereq isn't anywhere on the plan, so the engine can't read a
    // placed course's code — resolveLeaf now falls back to converting the raw id
    // to display form ("MATH 1910", never "MATH-1910"). Either way it's reported.
    expect(after.statusMap["s-1920"].unmetPrereqLeaves).toContain("MATH 1910");
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
