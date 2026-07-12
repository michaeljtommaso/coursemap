import { describe, it, expect } from "vitest";
import {
  computeSlotStatusMap,
  isSemesterOverloaded,
  MAX_SEMESTER_CREDITS,
} from "./computeSlotStatusMap";
import { computePrereqStatusMap } from "./evaluatePrereq";
import type { Course, PrereqExpr, ProgramSlotWithData } from "@/types/db";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCourse(
  id: string,
  subject: string,
  number: string,
  opts: Partial<Course> = {}
): Course {
  return {
    id,
    subject,
    number,
    title: `${subject} ${number}`,
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

/** A template "course" slot with the given course fixed in it. */
function courseSlot(
  id: string,
  sem: number,
  course: Course | null,
  slotRow = 0
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
    slot_row: slotRow,
    category: null,
    courses: course,
    elective_groups: null,
  };
}

/** An empty elective slot (no course placed). */
function emptySlot(id: string, sem: number): ProgramSlotWithData {
  return {
    id,
    program_id: "prog",
    kind: "elective",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: "grp",
    suggested_semester: sem,
    slot_row: 0,
    category: null,
    courses: null,
    elective_groups: null,
  };
}

const courseNode = (id: string): PrereqExpr => ({ type: "course", id });

// ── null / empty cases ────────────────────────────────────────────────────────

describe("null cases", () => {
  it("empty slot → all null, not blocked, no leaves", () => {
    const { statusMap } = computeSlotStatusMap([emptySlot("s1", 1)], [], {}, {});
    expect(statusMap.s1).toEqual({
      prereq: null,
      coreq: null,
      offeredOk: null,
      blocked: false,
      unmetPrereqLeaves: [],
      prereqState: null,
      advisoryNotes: [],
      overlaps: [],
      docNotes: [],
    });
  });

  it("placed course with no exprs and no offered → prereq/coreq/offeredOk null", () => {
    const c = makeCourse("c1", "CS", "1110");
    const { statusMap } = computeSlotStatusMap([courseSlot("s1", 1, c)], [], {}, {});
    expect(statusMap.s1).toMatchObject({
      prereq: null,
      coreq: null,
      offeredOk: null,
      blocked: false,
    });
  });
});

// ── prereq ────────────────────────────────────────────────────────────────────

describe("prereq", () => {
  it("met by an earlier semester → prereq true", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, intro), courseSlot("b", 2, next)],
      [],
      {},
      {}
    );
    expect(statusMap.b.prereq).toBe(true);
    expect(statusMap.b.blocked).toBe(false);
  });

  it("unmet (prereq in a LATER sem) → prereq false, blocked, names the course", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("b", 1, next), courseSlot("a", 2, intro)],
      [],
      {},
      {}
    );
    expect(statusMap.b.prereq).toBe(false);
    expect(statusMap.b.blocked).toBe(true);
    expect(statusMap.b.unmetPrereqLeaves).toEqual(["CS 1110"]);
  });

  it("same-semester prereq does NOT satisfy a plain prereq", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, intro), courseSlot("b", 1, next)],
      [],
      {},
      {}
    );
    expect(statusMap.b.prereq).toBe(false);
  });

  it("completed slot counts regardless of semester", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    // intro placed in a LATER column but marked completed → still satisfies.
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("b", 1, next), courseSlot("a", 5, intro)],
      ["a"],
      {},
      {}
    );
    expect(statusMap.b.prereq).toBe(true);
  });
});

// ── coreq ──────────────────────────────────────────────────────────────────────

describe("coreq", () => {
  it("satisfied by a course in the SAME semester (concurrent)", () => {
    const lab = makeCourse("lab", "PHYS", "1110");
    const lec = makeCourse("lec", "PHYS", "1112", { coreq_expr: courseNode("lab") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 3, lab), courseSlot("b", 3, lec)],
      [],
      {},
      {}
    );
    expect(statusMap.b.coreq).toBe(true);
    expect(statusMap.b.blocked).toBe(false);
  });

  it("satisfied by an EARLIER semester too", () => {
    const lab = makeCourse("lab", "PHYS", "1110");
    const lec = makeCourse("lec", "PHYS", "1112", { coreq_expr: courseNode("lab") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, lab), courseSlot("b", 3, lec)],
      [],
      {},
      {}
    );
    expect(statusMap.b.coreq).toBe(true);
  });

  it("unmet coreq → coreq false, blocked, names the course", () => {
    const lab = makeCourse("lab", "PHYS", "1110");
    const lec = makeCourse("lec", "PHYS", "1112", { coreq_expr: courseNode("lab") });
    // lab is in a LATER column → not in the same-or-earlier pool.
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("b", 1, lec), courseSlot("a", 3, lab)],
      [],
      {},
      {}
    );
    expect(statusMap.b.coreq).toBe(false);
    expect(statusMap.b.blocked).toBe(true);
    expect(statusMap.b.unmetPrereqLeaves).toEqual(["PHYS 1110"]);
  });

  it("no coreqExpr → coreq null", () => {
    const c = makeCourse("c", "CS", "1110");
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.coreq).toBeNull();
  });
});

// ── offeredOk ──────────────────────────────────────────────────────────────────

describe("offeredOk", () => {
  it("Fall course in an odd (Fall) semester → true", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA"] });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.offeredOk).toBe(true);
  });

  it("Fall-only course in an even (Spring) semester → false", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA"] });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 2, c)], [], {}, {});
    expect(statusMap.s.offeredOk).toBe(false);
  });

  it("Spring course in an even (Spring) semester → true", () => {
    const c = makeCourse("c", "CS", "2110", { offered: ["SP"] });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 4, c)], [], {}, {});
    expect(statusMap.s.offeredOk).toBe(true);
  });

  it("both-term course → true in any column", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA", "SP"] });
    const fall = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {}).statusMap.s;
    const spring = computeSlotStatusMap([courseSlot("s", 2, c)], [], {}, {}).statusMap.s;
    expect(fall.offeredOk).toBe(true);
    expect(spring.offeredOk).toBe(true);
  });

  it("summer-only course → false in every planned column", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["SU"] });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.offeredOk).toBe(false);
  });

  it("empty offered (no data) → null, and never blocks", () => {
    const c = makeCourse("c", "CS", "1110", { offered: [] });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 2, c)], [], {}, {});
    expect(statusMap.s.offeredOk).toBeNull();
    expect(statusMap.s.blocked).toBe(false);
  });
});

// ── semester credits ───────────────────────────────────────────────────────────

describe("semesterCredits", () => {
  it("sums placed courses per semester across multiple courses", () => {
    const a = makeCourse("a", "CS", "1110", { credits_min: 4, credits_max: 4 });
    const b = makeCourse("b", "MATH", "1910", { credits_min: 4, credits_max: 4 });
    const c = makeCourse("c", "PHYS", "2213", { credits_min: 3, credits_max: 3 });
    const { semesterCredits } = computeSlotStatusMap(
      [courseSlot("s1", 1, a), courseSlot("s2", 1, b), courseSlot("s3", 2, c)],
      [],
      {},
      {}
    );
    expect(semesterCredits.get(1)).toBe(8);
    expect(semesterCredits.get(2)).toBe(3);
  });

  it("variable-credit courses count at their minimum", () => {
    const research = makeCourse("r", "CS", "4999", { credits_min: 1, credits_max: 4 });
    const { semesterCredits } = computeSlotStatusMap([courseSlot("s", 1, research)], [], {}, {});
    expect(semesterCredits.get(1)).toBe(1);
  });

  it("empty slots contribute no credits; missing sem → undefined", () => {
    const { semesterCredits } = computeSlotStatusMap([emptySlot("s", 1)], [], {}, {});
    expect(semesterCredits.get(1)).toBeUndefined();
  });

  it("overload helper compares against the exported cap", () => {
    expect(MAX_SEMESTER_CREDITS).toBe(20);
    expect(isSemesterOverloaded(20)).toBe(false);
    expect(isSemesterOverloaded(21)).toBe(true);
  });
});

// ── blocked composition ────────────────────────────────────────────────────────

describe("blocked composition", () => {
  const intro = makeCourse("intro", "CS", "1110");
  const lab = makeCourse("lab", "PHYS", "1110");

  it("prereq false only → blocked", () => {
    const c = makeCourse("c", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s).toMatchObject({ prereq: false, coreq: null, blocked: true });
  });

  it("coreq false only → blocked", () => {
    const c = makeCourse("c", "CS", "2110", { coreq_expr: courseNode("lab") });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s).toMatchObject({ prereq: null, coreq: false, blocked: true });
  });

  it("both false → blocked, leaves from both trees", () => {
    const c = makeCourse("c", "CS", "2110", {
      prereq_expr: courseNode("intro"),
      coreq_expr: courseNode("lab"),
    });
    const selected = { intro, lab };
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, selected);
    expect(statusMap.s.blocked).toBe(true);
    expect(statusMap.s.unmetPrereqLeaves.sort()).toEqual(["CS 1110", "PHYS 1110"]);
  });

  it("both satisfied → not blocked, no leaves", () => {
    const c = makeCourse("c", "CS", "2110", {
      prereq_expr: courseNode("intro"),
      coreq_expr: courseNode("lab"),
    });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("p", 1, intro), courseSlot("q", 2, lab), courseSlot("s", 2, c)],
      [],
      {},
      {}
    );
    expect(statusMap.s).toMatchObject({ prereq: true, coreq: true, blocked: false });
    expect(statusMap.s.unmetPrereqLeaves).toEqual([]);
  });
});

// ── unmet-leaf extraction ──────────────────────────────────────────────────────

describe("unmet leaves", () => {
  it("OR of alternatives, all unmet → lists every alternative", () => {
    const c = makeCourse("c", "CS", "3110", {
      prereq_expr: { type: "or", children: [courseNode("x"), courseNode("y")] },
    });
    const x = makeCourse("x", "CS", "2800");
    const y = makeCourse("y", "CS", "2802");
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, { x, y });
    expect(statusMap.s.prereq).toBe(false);
    expect(statusMap.s.unmetPrereqLeaves.sort()).toEqual(["CS 2800", "CS 2802"]);
  });

  it("satisfied OR branch contributes nothing", () => {
    const c = makeCourse("c", "CS", "3110", {
      prereq_expr: { type: "or", children: [courseNode("x"), courseNode("y")] },
    });
    const x = makeCourse("x", "CS", "2800");
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("p", 1, x), courseSlot("s", 2, c)],
      [],
      {},
      {}
    );
    expect(statusMap.s.prereq).toBe(true);
    expect(statusMap.s.unmetPrereqLeaves).toEqual([]);
  });

  it("AND surfaces only the failing child", () => {
    const c = makeCourse("c", "CS", "3110", {
      prereq_expr: { type: "and", children: [courseNode("x"), courseNode("y")] },
    });
    const x = makeCourse("x", "CS", "2800");
    const y = makeCourse("y", "CS", "2802");
    // x satisfied earlier, y missing.
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("p", 1, x), courseSlot("s", 2, c)],
      [],
      {},
      { x, y }
    );
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["CS 2802"]);
  });

  it("pattern leaf renders in code form and is unmet when nothing matches", () => {
    const c = makeCourse("c", "CS", "4000", {
      prereq_expr: { type: "pattern", pattern: "CS-3xxx" },
    });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.prereq).toBe(false);
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["CS 3xxx"]);
  });

  it("pattern satisfied by a matching earlier course", () => {
    const three = makeCourse("t", "CS", "3110");
    const c = makeCourse("c", "CS", "4000", {
      prereq_expr: { type: "pattern", pattern: "CS-3xxx" },
    });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("p", 1, three), courseSlot("s", 2, c)],
      [],
      {},
      {}
    );
    expect(statusMap.s.prereq).toBe(true);
  });

  it("unresolvable leaf id falls back to the raw id", () => {
    const c = makeCourse("c", "CS", "2110", { prereq_expr: courseNode("ghost") });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["ghost"]);
  });
});

// ── user selections drive resolution ───────────────────────────────────────────

describe("user slot selections", () => {
  it("a user-picked course fills an elective slot and is evaluated", () => {
    const picked = makeCourse("picked", "CS", "2110", { offered: ["FA"] });
    const slot = emptySlot("s", 1);
    const { statusMap } = computeSlotStatusMap(
      [slot],
      [],
      { s: "picked" },
      { picked }
    );
    expect(statusMap.s.offeredOk).toBe(true);
  });
});

// ── back-compat wrapper ────────────────────────────────────────────────────────

describe("computePrereqStatusMap wrapper", () => {
  it("projects the prereq field only, preserving old semantics", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const empty = emptySlot("e", 1);
    const noExpr = makeCourse("solo", "MATH", "1110");
    const map = computePrereqStatusMap(
      [
        courseSlot("a", 1, intro),
        courseSlot("b", 2, next),
        courseSlot("c", 1, noExpr),
        empty,
      ],
      [],
      {},
      {}
    );
    expect(map.b).toBe(true); // prereq met
    expect(map.c).toBeNull(); // no expr
    expect(map.e).toBeNull(); // empty slot
  });
});

// ── spec 007: prereqState / advisory / credit / overlaps / docNotes ─────────────

const advisoryNode = (expr: PrereqExpr, note = "or equivalent AP credit"): PrereqExpr => ({
  type: "advisory",
  expr,
  note,
});

describe("prereqState mapping (spec 007 §1b)", () => {
  it("null exactly where prereq is null (no course / no expr)", () => {
    const noExpr = makeCourse("solo", "MATH", "1110");
    const { statusMap } = computeSlotStatusMap(
      [emptySlot("e", 1), courseSlot("c", 1, noExpr)],
      [],
      {},
      {}
    );
    expect(statusMap.e.prereqState).toBeNull();
    expect(statusMap.e.prereq).toBeNull();
    expect(statusMap.c.prereqState).toBeNull();
    expect(statusMap.c.prereq).toBeNull();
  });

  it("met → prereqState met, prereq true", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, intro), courseSlot("b", 2, next)],
      [],
      {},
      {}
    );
    expect(statusMap.b.prereqState).toBe("met");
    expect(statusMap.b.prereq).toBe(true);
  });

  it("blocked → prereqState blocked, prereq false", () => {
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeSlotStatusMap([courseSlot("b", 1, next)], [], {}, {});
    expect(statusMap.b.prereqState).toBe("blocked");
    expect(statusMap.b.prereq).toBe(false);
  });
});

describe("advisory + credit pool (the MATH 1920 shape)", () => {
  // MATH 1920's real shape: prereqExpr = advisory(course(MATH-1910)).
  const math1920 = makeCourse("MATH-1920", "MATH", "1920", {
    prereq_expr: advisoryNode(courseNode("MATH-1910")),
  });

  it("without credit → advisory + note, prereq true, NOT blocked", () => {
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, math1920)], [], {}, {});
    expect(statusMap.s.prereqState).toBe("advisory");
    expect(statusMap.s.prereq).toBe(true);
    expect(statusMap.s.blocked).toBe(false);
    expect(statusMap.s.advisoryNotes).toEqual(["or equivalent AP credit"]);
    expect(statusMap.s.unmetPrereqLeaves).toEqual([]);
  });

  it("with creditCourses containing MATH-1910 → met, no note", () => {
    const credit = { ids: new Set(["MATH-1910"]), codes: new Set(["MATH 1910"]) };
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("s", 1, math1920)],
      [],
      {},
      {},
      credit
    );
    expect(statusMap.s.prereqState).toBe("met");
    expect(statusMap.s.advisoryNotes).toEqual([]);
    expect(statusMap.s.blocked).toBe(false);
  });

  it("advisory-only never blocks even with a hard sibling satisfied by credit", () => {
    const target = makeCourse("CS-3110", "CS", "3110", {
      prereq_expr: { type: "and", children: [courseNode("CS-2800"), advisoryNode(courseNode("MATH-1910"))] },
    });
    const credit = { ids: new Set(["CS-2800"]), codes: new Set(["CS 2800"]) };
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("s", 1, target)],
      [],
      {},
      {},
      credit
    );
    // CS-2800 satisfied by credit; advisory MATH-1910 unmet → advisory, not blocked.
    expect(statusMap.s.prereqState).toBe("advisory");
    expect(statusMap.s.blocked).toBe(false);
    expect(statusMap.s.advisoryNotes).toEqual(["or equivalent AP credit"]);
  });
});

describe("forbidden-overlap warnings (spec 007 §1b/§5)", () => {
  it("detects a conflict declared in only ONE direction (asymmetric roster)", () => {
    // Only cs1110 lists cs1112; the reverse edge is missing. Both slots warn.
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const cs1112 = makeCourse("CS-1112", "CS", "1112"); // no overlap list
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, cs1110), courseSlot("b", 1, cs1112)],
      [],
      {},
      {}
    );
    expect(statusMap.a.overlaps).toEqual(["CS 1112"]);
    expect(statusMap.b.overlaps).toEqual(["CS 1110"]);
    // Overlap NEVER blocks.
    expect(statusMap.a.blocked).toBe(false);
    expect(statusMap.b.blocked).toBe(false);
  });

  it("a course is never flagged against itself", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const { statusMap } = computeSlotStatusMap([courseSlot("a", 1, cs1110)], [], {}, {});
    expect(statusMap.a.overlaps).toEqual([]);
  });

  it("unrelated courses are never flagged", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const math1910 = makeCourse("MATH-1910", "MATH", "1910");
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, cs1110), courseSlot("b", 1, math1910)],
      [],
      {},
      {}
    );
    expect(statusMap.a.overlaps).toEqual([]);
    expect(statusMap.b.overlaps).toEqual([]);
  });

  it("blocked stays false for an overlap-only situation", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const cs1112 = makeCourse("CS-1112", "CS", "1112", { forbidden_overlaps: ["CS-1110"] });
    const { statusMap } = computeSlotStatusMap(
      [courseSlot("a", 1, cs1110), courseSlot("b", 1, cs1112)],
      [],
      {},
      {}
    );
    expect(statusMap.a.blocked).toBe(false);
    expect(statusMap.b.blocked).toBe(false);
    expect(statusMap.a.overlaps).toEqual(["CS 1112"]);
    expect(statusMap.b.overlaps).toEqual(["CS 1110"]);
  });
});

describe("docNotes (spec 007 §1b/§4)", () => {
  it("surfaces the course's prereq_notes prose", () => {
    const c = makeCourse("c", "CS", "3110", {
      prereq_notes: ["Permission of instructor required."],
    });
    const { statusMap } = computeSlotStatusMap([courseSlot("s", 1, c)], [], {}, {});
    expect(statusMap.s.docNotes).toEqual(["Permission of instructor required."]);
  });
});
