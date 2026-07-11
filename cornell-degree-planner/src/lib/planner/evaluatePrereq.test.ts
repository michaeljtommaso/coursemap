import { describe, it, expect } from "vitest";
import { evaluatePrereq } from "./evaluatePrereq";
import { computeSlotStatusMap } from "./computeSlotStatusMap";
import type { Course, PrereqExpr, ProgramSlotWithData } from "@/types/db";

/**
 * Advisory node coverage (spec 007 §3 decision 1) — "usually requires X; note
 * also satisfies this." Advisory must NEVER block, in isolation, nested inside
 * and/or, or as a leaf collectUnmetLeaves walks. This is asserted directly
 * against evaluatePrereq (the core evaluator) and against computeSlotStatusMap
 * (the unified engine every surface consumes), since collectUnmetLeaves is not
 * exported on its own.
 */

const course = (id: string): PrereqExpr => ({ type: "course", id });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });
const advisory = (expr: PrereqExpr, note = "or equivalent AP credit"): PrereqExpr => ({
  type: "advisory",
  expr,
  note,
});

describe("evaluatePrereq — advisory", () => {
  it("evaluates true with empty pools — advisory never blocks", () => {
    const expr = advisory(course("MATH-1910"));
    expect(evaluatePrereq(expr, new Set(), new Set())).toBe(true);
  });

  it("evaluates true even when the wrapped requirement IS satisfied", () => {
    const expr = advisory(course("MATH-1910"));
    expect(evaluatePrereq(expr, new Set(["MATH-1910"]), new Set(["MATH 1910"]))).toBe(true);
  });

  it("nested inside an AND — an unmet advisory sibling never fails the group", () => {
    const expr = and(course("CS-2110"), advisory(course("MATH-1910")));
    // CS-2110 met, MATH-1910 (advisory) unmet — the AND must still pass because
    // the advisory branch is vacuously true.
    expect(evaluatePrereq(expr, new Set(["CS-2110"]), new Set(["CS 2110"]))).toBe(true);
  });

  it("nested inside an OR — an advisory alternative always satisfies the OR", () => {
    const expr = or(course("CS-9999"), advisory(course("MATH-1910")));
    expect(evaluatePrereq(expr, new Set(), new Set())).toBe(true);
  });
});

describe("computeSlotStatusMap — advisory", () => {
  function makeCourse(id: string, subject: string, number: string, prereq: PrereqExpr | null): Course {
    return {
      id,
      subject,
      number,
      title: `${subject} ${number}`,
      credits_min: 3,
      credits_max: 3,
      description: null,
      offered: [],
      prereq_expr: prereq,
      coreq_expr: null,
      roster_id: null,
      updated_at: new Date(0).toISOString(),
    };
  }

  function courseSlot(id: string, sem: number, course: Course): ProgramSlotWithData {
    return {
      id,
      program_id: "prog",
      kind: "course",
      course_id: course.id,
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

  it("a slot whose prereq is a bare unsatisfied advisory is NOT blocked", () => {
    // Mirrors MATH 1920's real shape: prereqExpr = advisory(course(MATH-1910)).
    const math1920 = makeCourse("MATH-1920", "MATH", "1920", advisory(course("MATH-1910")));
    const slots = [courseSlot("s1", 1, math1920)];
    const { statusMap } = computeSlotStatusMap(slots, [], {}, {});
    expect(statusMap.s1.prereq).toBe(true);
    expect(statusMap.s1.blocked).toBe(false);
    expect(statusMap.s1.unmetPrereqLeaves).toEqual([]);
  });

  it("collectUnmetLeaves ignores advisory even when nested inside a blocked AND", () => {
    const cs2800 = makeCourse("CS-2800", "CS", "2800", null);
    const target = makeCourse(
      "CS-3110",
      "CS",
      "3110",
      and(course("CS-2800"), advisory(course("MATH-1910")))
    );
    // CS-2800 is NOT placed anywhere → the AND is blocked on that leaf (and
    // resolveLeaf can't upgrade it to a code since it's not in the plan), but
    // the advisory sibling must contribute nothing to unmetPrereqLeaves.
    const slots = [courseSlot("s1", 2, target)];
    const { statusMap } = computeSlotStatusMap(slots, [], {}, {});
    expect(statusMap.s1.prereq).toBe(false);
    expect(statusMap.s1.blocked).toBe(true);
    expect(statusMap.s1.unmetPrereqLeaves).toEqual(["CS-2800"]);
    expect(statusMap.s1.unmetPrereqLeaves).not.toContain("MATH-1910");
    expect(statusMap.s1.unmetPrereqLeaves).not.toContain("MATH 1910");
    void cs2800; // referenced for shape only — not placed on the plan
  });
});
