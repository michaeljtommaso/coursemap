import { describe, it, expect } from "vitest";
import {
  enrichCourse,
  enrichCards,
  enrichSelectedCourses,
  collectPlanCourseIds,
} from "./enrichCourses";
import { computeCardStatusMap } from "./computeCardStatusMap";
import type { BoardCard } from "./board";
import type { Course, PrereqExpr } from "@/types/db";

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

/** A board card: placement `id` in column `sem`, holding `course`. */
function card(id: string, sem: number, course: Course): BoardCard {
  return { placement: { id, courseId: course.id, sem, order: 0 }, course };
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

describe("enrichCards / enrichSelectedCourses", () => {
  it("enriches each card's course snapshot", () => {
    const cards = [card("p1", 2, makeCourse("MATH-1920"))];
    const out = enrichCards(cards, {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    });
    expect(out[0].course.prereq_expr).toEqual(needs1910);
  });

  it("returns same array reference when cache is empty", () => {
    const cards = [card("p1", 2, makeCourse("MATH-1920"))];
    expect(enrichCards(cards, {})).toBe(cards);
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
  it("gathers every placed course id, deduped", () => {
    const cards = [
      card("p1", 1, makeCourse("MATH-1910")),
      card("p2", 2, makeCourse("MATH-1920")),
      card("p3", 3, makeCourse("CS-4820")),
      card("p4", 5, makeCourse("MATH-1910")), // the same course placed twice
    ];
    const ids = collectPlanCourseIds(cards);
    expect(ids).toEqual(["MATH-1910", "MATH-1920", "CS-4820"]);
  });
});

describe("end-to-end: enrichment unblocks the engine", () => {
  it("a card goes blocked once its real prereq is overlaid", () => {
    // MATH 1920 in sem 2 needs MATH 1910; MATH 1910 is NOT on the plan.
    const cards = [card("s-1920", 2, makeCourse("MATH-1920"))];

    // Before enrichment (null expr): neutral, never blocked — the bug.
    const before = computeCardStatusMap(cards, [], {});
    expect(before.statusMap["s-1920"].prereq).toBeNull();
    expect(before.statusMap["s-1920"].blocked).toBe(false);

    // After enrichment: real expr present, prereq unmet → blocked with a leaf.
    const details = {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    };
    const enriched = enrichCards(cards, details);
    const after = computeCardStatusMap(enriched, [], {});
    expect(after.statusMap["s-1920"].prereq).toBe(false);
    expect(after.statusMap["s-1920"].blocked).toBe(true);
    // The missing prereq isn't anywhere on the plan, so the engine can't read a
    // placed course's code — resolveLeaf now falls back to converting the raw id
    // to display form ("MATH 1910", never "MATH-1910"). Either way it's reported.
    expect(after.statusMap["s-1920"].unmetPrereqLeaves).toContain("MATH 1910");
  });

  it("stays satisfied when the prereq IS present in an earlier semester", () => {
    const cards = [
      card("s-1910", 1, makeCourse("MATH-1910")),
      card("s-1920", 2, makeCourse("MATH-1920")),
    ];
    const details = {
      "MATH-1920": makeCourse("MATH-1920", { prereq_expr: needs1910 }),
    };
    const after = computeCardStatusMap(enrichCards(cards, details), [], {});
    expect(after.statusMap["s-1920"].prereq).toBe(true);
    expect(after.statusMap["s-1920"].blocked).toBe(false);
  });
});
