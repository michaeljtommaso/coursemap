import { describe, it, expect } from "vitest";
import {
  computeCardStatusMap,
  isSemesterOverloaded,
  MAX_SEMESTER_CREDITS,
} from "./computeCardStatusMap";
import { computePrereqStatusMap } from "./evaluatePrereq";
import { snapshotToCourse } from "@/lib/normalize/courseSnapshot";
import type { BoardCard } from "./board";
import type { Course, PrereqExpr } from "@/types/db";

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

/** A board card: placement `id` in column `sem` (at `order`), holding `course`. */
function card(id: string, sem: number, course: Course, order = 0): BoardCard {
  return { placement: { id, courseId: course.id, sem, order }, course };
}

const courseNode = (id: string): PrereqExpr => ({ type: "course", id });

// ── null / empty cases ────────────────────────────────────────────────────────

describe("null cases", () => {
  it("a bare snapshot course (no catalog data) → the fully neutral status", () => {
    const bare = snapshotToCourse("CS-1110", null);
    const { statusMap } = computeCardStatusMap([card("s1", 1, bare)], [], {});
    expect(statusMap.s1).toEqual({
      prereq: null,
      coreq: null,
      offeredOk: null,
      blocked: false,
      unmetPrereqLeaves: [],
      unmetCoreqLeaves: [],
      prereqState: null,
      advisoryNotes: [],
      advisoryLeaves: [],
      overlaps: [],
      docNotes: [],
      coveredByCredit: null,
    });
  });

  it("placed course with no exprs and no offered → prereq/coreq/offeredOk null", () => {
    const c = makeCourse("c1", "CS", "1110");
    const { statusMap } = computeCardStatusMap([card("s1", 1, c)], [], {});
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
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, intro), card("b", 2, next)],
      [],
      {}
    );
    expect(statusMap.b.prereq).toBe(true);
    expect(statusMap.b.blocked).toBe(false);
  });

  it("unmet (prereq in a LATER sem) → prereq false, blocked, names the course", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeCardStatusMap(
      [card("b", 1, next), card("a", 2, intro)],
      [],
      {}
    );
    expect(statusMap.b.prereq).toBe(false);
    expect(statusMap.b.blocked).toBe(true);
    expect(statusMap.b.unmetPrereqLeaves).toEqual(["CS 1110"]);
  });

  it("same-semester prereq does NOT satisfy a plain prereq", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, intro), card("b", 1, next)],
      [],
      {}
    );
    expect(statusMap.b.prereq).toBe(false);
  });

  it("completed card counts regardless of semester", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    // intro placed in a LATER column but marked completed → still satisfies.
    const { statusMap } = computeCardStatusMap(
      [card("b", 1, next), card("a", 5, intro)],
      ["a"],
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
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, lab), card("b", 3, lec)],
      [],
      {}
    );
    expect(statusMap.b.coreq).toBe(true);
    expect(statusMap.b.blocked).toBe(false);
  });

  it("satisfied by an EARLIER semester too", () => {
    const lab = makeCourse("lab", "PHYS", "1110");
    const lec = makeCourse("lec", "PHYS", "1112", { coreq_expr: courseNode("lab") });
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, lab), card("b", 3, lec)],
      [],
      {}
    );
    expect(statusMap.b.coreq).toBe(true);
  });

  it("unmet coreq → coreq false, blocked, names the course", () => {
    const lab = makeCourse("lab", "PHYS", "1110");
    const lec = makeCourse("lec", "PHYS", "1112", { coreq_expr: courseNode("lab") });
    // lab is in a LATER column → not in the same-or-earlier pool.
    const { statusMap } = computeCardStatusMap(
      [card("b", 1, lec), card("a", 3, lab)],
      [],
      {}
    );
    expect(statusMap.b.coreq).toBe(false);
    expect(statusMap.b.blocked).toBe(true);
    // A corequisite miss is reported on its own list (B4), not as a prereq.
    expect(statusMap.b.unmetCoreqLeaves).toEqual(["PHYS 1110"]);
    expect(statusMap.b.unmetPrereqLeaves).toEqual([]);
  });

  it("no coreqExpr → coreq null", () => {
    const c = makeCourse("c", "CS", "1110");
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.coreq).toBeNull();
  });
});

// ── offeredOk ──────────────────────────────────────────────────────────────────

describe("offeredOk", () => {
  it("Fall course in an odd (Fall) semester → true", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA"] });
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.offeredOk).toBe(true);
  });

  it("Fall-only course in an even (Spring) semester → false", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA"] });
    const { statusMap } = computeCardStatusMap([card("s", 2, c)], [], {});
    expect(statusMap.s.offeredOk).toBe(false);
  });

  it("Spring course in an even (Spring) semester → true", () => {
    const c = makeCourse("c", "CS", "2110", { offered: ["SP"] });
    const { statusMap } = computeCardStatusMap([card("s", 4, c)], [], {});
    expect(statusMap.s.offeredOk).toBe(true);
  });

  it("both-term course → true in any column", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["FA", "SP"] });
    const fall = computeCardStatusMap([card("s", 1, c)], [], {}).statusMap.s;
    const spring = computeCardStatusMap([card("s", 2, c)], [], {}).statusMap.s;
    expect(fall.offeredOk).toBe(true);
    expect(spring.offeredOk).toBe(true);
  });

  it("summer-only course → false in every planned column", () => {
    const c = makeCourse("c", "CS", "1110", { offered: ["SU"] });
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.offeredOk).toBe(false);
  });

  it("empty offered (no data) → null, and never blocks", () => {
    const c = makeCourse("c", "CS", "1110", { offered: [] });
    const { statusMap } = computeCardStatusMap([card("s", 2, c)], [], {});
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
    const { semesterCredits } = computeCardStatusMap(
      [card("s1", 1, a), card("s2", 1, b), card("s3", 2, c)],
      [],
      {}
    );
    expect(semesterCredits.get(1)).toBe(8);
    expect(semesterCredits.get(2)).toBe(3);
  });

  it("variable-credit courses count at their minimum", () => {
    const research = makeCourse("r", "CS", "4999", { credits_min: 1, credits_max: 4 });
    const { semesterCredits } = computeCardStatusMap([card("s", 1, research)], [], {});
    expect(semesterCredits.get(1)).toBe(1);
  });

  it("a semester with no cards → undefined", () => {
    const a = makeCourse("a", "CS", "1110");
    const { semesterCredits } = computeCardStatusMap([card("s", 2, a)], [], {});
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
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s).toMatchObject({ prereq: false, coreq: null, blocked: true });
  });

  it("coreq false only → blocked", () => {
    const c = makeCourse("c", "CS", "2110", { coreq_expr: courseNode("lab") });
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s).toMatchObject({ prereq: null, coreq: false, blocked: true });
  });

  it("both false → blocked, leaves kept per tree", () => {
    const c = makeCourse("c", "CS", "2110", {
      prereq_expr: courseNode("intro"),
      coreq_expr: courseNode("lab"),
    });
    const selected = { intro, lab };
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], selected);
    expect(statusMap.s.blocked).toBe(true);
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["CS 1110"]);
    expect(statusMap.s.unmetCoreqLeaves).toEqual(["PHYS 1110"]);
  });

  it("both satisfied → not blocked, no leaves", () => {
    const c = makeCourse("c", "CS", "2110", {
      prereq_expr: courseNode("intro"),
      coreq_expr: courseNode("lab"),
    });
    const { statusMap } = computeCardStatusMap(
      [card("p", 1, intro), card("q", 2, lab), card("s", 2, c)],
      [],
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
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], { x, y });
    expect(statusMap.s.prereq).toBe(false);
    expect(statusMap.s.unmetPrereqLeaves.sort()).toEqual(["CS 2800", "CS 2802"]);
  });

  it("satisfied OR branch contributes nothing", () => {
    const c = makeCourse("c", "CS", "3110", {
      prereq_expr: { type: "or", children: [courseNode("x"), courseNode("y")] },
    });
    const x = makeCourse("x", "CS", "2800");
    const { statusMap } = computeCardStatusMap(
      [card("p", 1, x), card("s", 2, c)],
      [],
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
    const { statusMap } = computeCardStatusMap(
      [card("p", 1, x), card("s", 2, c)],
      [],
      { x, y }
    );
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["CS 2802"]);
  });

  it("pattern leaf renders in code form and is unmet when nothing matches", () => {
    const c = makeCourse("c", "CS", "4000", {
      prereq_expr: { type: "pattern", pattern: "CS-3xxx" },
    });
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.prereq).toBe(false);
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["CS 3xxx"]);
  });

  it("pattern satisfied by a matching earlier course", () => {
    const three = makeCourse("t", "CS", "3110");
    const c = makeCourse("c", "CS", "4000", {
      prereq_expr: { type: "pattern", pattern: "CS-3xxx" },
    });
    const { statusMap } = computeCardStatusMap(
      [card("p", 1, three), card("s", 2, c)],
      [],
      {}
    );
    expect(statusMap.s.prereq).toBe(true);
  });

  it("unresolvable leaf id falls back to the raw id", () => {
    const c = makeCourse("c", "CS", "2110", { prereq_expr: courseNode("ghost") });
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["ghost"]);
  });
});

// ── one status per placement ─────────────────────────────────────────────────

describe("a course placed twice", () => {
  it("gets a status per card, each evaluated in its own column", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeCardStatusMap(
      [card("early", 1, next), card("i", 2, intro), card("late", 3, next)],
      [],
      {}
    );
    expect(statusMap.early.blocked).toBe(true);
    expect(statusMap.late.blocked).toBe(false);
  });
});

// ── back-compat wrapper ────────────────────────────────────────────────────────

describe("computePrereqStatusMap wrapper", () => {
  it("projects the prereq field only, preserving old semantics", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const noExpr = makeCourse("solo", "MATH", "1110");
    const map = computePrereqStatusMap(
      [
        card("a", 1, intro),
        card("b", 2, next),
        card("c", 1, noExpr),
      ],
      [],
      {}
    );
    expect(map.b).toBe(true); // prereq met
    expect(map.c).toBeNull(); // no expr
  });
});

// ── spec 007: prereqState / advisory / credit / overlaps / docNotes ─────────────

const advisoryNode = (expr: PrereqExpr, note = "or equivalent AP credit"): PrereqExpr => ({
  type: "advisory",
  expr,
  note,
});

describe("prereqState mapping (spec 007 §1b)", () => {
  it("null exactly where prereq is null (no expr)", () => {
    const noExpr = makeCourse("solo", "MATH", "1110");
    const { statusMap } = computeCardStatusMap([card("c", 1, noExpr)], [], {});
    expect(statusMap.c.prereqState).toBeNull();
    expect(statusMap.c.prereq).toBeNull();
  });

  it("met → prereqState met, prereq true", () => {
    const intro = makeCourse("intro", "CS", "1110");
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, intro), card("b", 2, next)],
      [],
      {}
    );
    expect(statusMap.b.prereqState).toBe("met");
    expect(statusMap.b.prereq).toBe(true);
  });

  it("blocked → prereqState blocked, prereq false", () => {
    const next = makeCourse("next", "CS", "2110", { prereq_expr: courseNode("intro") });
    const { statusMap } = computeCardStatusMap([card("b", 1, next)], [], {});
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
    const { statusMap } = computeCardStatusMap([card("s", 1, math1920)], [], {});
    expect(statusMap.s.prereqState).toBe("advisory");
    expect(statusMap.s.prereq).toBe(true);
    expect(statusMap.s.blocked).toBe(false);
    expect(statusMap.s.advisoryNotes).toEqual(["or equivalent AP credit"]);
    expect(statusMap.s.advisoryLeaves).toEqual(["MATH 1910"]); // display form
    expect(statusMap.s.unmetPrereqLeaves).toEqual([]);
  });

  it("MATH 1910 placed AFTER MATH 1920 → blocked, names MATH 1910", () => {
    const math1910 = makeCourse("MATH-1910", "MATH", "1910");
    const { statusMap } = computeCardStatusMap([card("s", 1, math1920), card("m", 2, math1910)], [], {});
    expect(statusMap.s.blocked).toBe(true);
    expect(statusMap.s.prereqState).toBe("blocked");
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["MATH 1910"]);
    expect(statusMap.s.advisoryNotes).toEqual([]);
  });

  it("MATH 1910 in the SAME semester → still blocked (a prereq must come first)", () => {
    const math1910 = makeCourse("MATH-1910", "MATH", "1910");
    const { statusMap } = computeCardStatusMap([card("s", 2, math1920), card("m", 2, math1910, 1)], [], {});
    expect(statusMap.s.blocked).toBe(true);
  });

  it("MATH 1910 placed BEFORE MATH 1920 → met", () => {
    const math1910 = makeCourse("MATH-1910", "MATH", "1910");
    const { statusMap } = computeCardStatusMap([card("m", 1, math1910), card("s", 2, math1920)], [], {});
    expect(statusMap.s.prereqState).toBe("met");
    expect(statusMap.s.blocked).toBe(false);
  });

  it("with creditCourses containing MATH-1910 → met, no note", () => {
    const credit = { ids: new Set(["MATH-1910"]), codes: new Set(["MATH 1910"]) };
    const { statusMap } = computeCardStatusMap(
      [card("s", 1, math1920)],
      [],
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
    const { statusMap } = computeCardStatusMap(
      [card("s", 1, target)],
      [],
      {},
      credit
    );
    // CS-2800 satisfied by credit; advisory MATH-1910 unmet → advisory, not blocked.
    expect(statusMap.s.prereqState).toBe("advisory");
    expect(statusMap.s.blocked).toBe(false);
    expect(statusMap.s.advisoryNotes).toEqual(["or equivalent AP credit"]);
  });
});

describe("coveredByCredit — a placed course the credit profile already grants (B1)", () => {
  const apCalc = {
    ids: new Set(["MATH-1910"]),
    codes: new Set(["MATH 1910"]),
    sources: new Map([["MATH-1910", { kind: "ap", label: "AP Calculus BC (score 5)" }]]),
  };

  it("names the granting entry and is never blocked, even with an unmet hard prereq", () => {
    // MATH 1910 carrying a (pre-hotfix) hard MATH-1110 prereq and placed in a
    // Spring column it isn't offered in: with AP Calc BC credit, every check
    // on the course itself is moot.
    const math1910 = makeCourse("MATH-1910", "MATH", "1910", {
      prereq_expr: courseNode("MATH-1110"),
      offered: ["FA"],
    });
    const { statusMap } = computeCardStatusMap([card("s", 2, math1910)], [], {}, apCalc);
    expect(statusMap.s.coveredByCredit).toEqual({ kind: "ap", label: "AP Calculus BC (score 5)" });
    expect(statusMap.s.blocked).toBe(false);
    expect(statusMap.s.prereq).toBe(true);
    expect(statusMap.s.prereqState).toBe("met");
    expect(statusMap.s.unmetPrereqLeaves).toEqual([]);
    expect(statusMap.s.offeredOk).toBeNull();
  });

  it("without the credit the same card is blocked and uncovered", () => {
    const math1910 = makeCourse("MATH-1910", "MATH", "1910", { prereq_expr: courseNode("MATH-1110") });
    const { statusMap } = computeCardStatusMap([card("s", 1, math1910)], [], {});
    expect(statusMap.s.coveredByCredit).toBeNull();
    expect(statusMap.s.blocked).toBe(true);
    expect(statusMap.s.unmetPrereqLeaves).toEqual(["MATH 1110"]);
  });

  it("a course that NEEDS the credited course stops needing it (no placement of MATH 1910)", () => {
    const math2930 = makeCourse("MATH-2930", "MATH", "2930", { prereq_expr: courseNode("MATH-1910") });
    const without = computeCardStatusMap([card("s", 1, math2930)], [], {});
    expect(without.statusMap.s.blocked).toBe(true);
    const withCredit = computeCardStatusMap([card("s", 1, math2930)], [], {}, apCalc);
    expect(withCredit.statusMap.s.blocked).toBe(false);
    expect(withCredit.statusMap.s.prereqState).toBe("met");
    expect(withCredit.statusMap.s.coveredByCredit).toBeNull(); // not itself covered
  });

  it("a hand-built pool without sources still covers, as a generic credit", () => {
    const pool = { ids: new Set(["CS-1110"]), codes: new Set(["CS 1110"]) };
    const cs1110 = makeCourse("CS-1110", "CS", "1110");
    const { statusMap } = computeCardStatusMap([card("s", 1, cs1110)], [], {}, pool);
    expect(statusMap.s.coveredByCredit).toEqual({ kind: "credit", label: "Credit" });
    expect(statusMap.s.prereq).toBeNull(); // no expr → stays null
  });

  it("still reports overlaps on a covered course", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const cs1112 = makeCourse("CS-1112", "CS", "1112");
    const pool = { ids: new Set(["CS-1110"]), codes: new Set(["CS 1110"]) };
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, cs1110), card("b", 1, cs1112)],
      [],
      {},
      pool
    );
    expect(statusMap.a.overlaps).toEqual(["CS 1112"]);
    expect(statusMap.a.coveredByCredit).not.toBeNull();
  });
});

describe("forbidden-overlap warnings (spec 007 §1b/§5)", () => {
  it("detects a conflict declared in only ONE direction (asymmetric roster)", () => {
    // Only cs1110 lists cs1112; the reverse edge is missing. Both cards warn.
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const cs1112 = makeCourse("CS-1112", "CS", "1112"); // no overlap list
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, cs1110), card("b", 1, cs1112)],
      [],
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
    const { statusMap } = computeCardStatusMap([card("a", 1, cs1110)], [], {});
    expect(statusMap.a.overlaps).toEqual([]);
  });

  it("unrelated courses are never flagged", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const math1910 = makeCourse("MATH-1910", "MATH", "1910");
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, cs1110), card("b", 1, math1910)],
      [],
      {}
    );
    expect(statusMap.a.overlaps).toEqual([]);
    expect(statusMap.b.overlaps).toEqual([]);
  });

  it("blocked stays false for an overlap-only situation", () => {
    const cs1110 = makeCourse("CS-1110", "CS", "1110", { forbidden_overlaps: ["CS-1112"] });
    const cs1112 = makeCourse("CS-1112", "CS", "1112", { forbidden_overlaps: ["CS-1110"] });
    const { statusMap } = computeCardStatusMap(
      [card("a", 1, cs1110), card("b", 1, cs1112)],
      [],
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
    const { statusMap } = computeCardStatusMap([card("s", 1, c)], [], {});
    expect(statusMap.s.docNotes).toEqual(["Permission of instructor required."]);
  });
});

describe("missing course docs (a completed card whose course has no catalog doc)", () => {
  /** A card whose course doc never resolved: the board derives its course
   *  from the placement's id (board.courseForPlacement). Placed in a LATER
   *  column than the course that needs it, so only completion can satisfy. */
  function docless(id: string, sem: number, courseId: string): BoardCard {
    return card(id, sem, snapshotToCourse(courseId, null));
  }

  it("still contributes its id, so the downstream card isn't permanently blocked", () => {
    const next = makeCourse("CHEME-3130", "CHEME", "3130", { prereq_expr: courseNode("CHEME-3230") });
    const { statusMap } = computeCardStatusMap(
      [docless("a", 6, "CHEME-3230"), card("b", 5, next)],
      ["a"],
      {}
    );
    expect(statusMap.b.blocked).toBe(false);
  });

  it("also contributes its code to pattern leaves", () => {
    const next = makeCourse("n", "CHEME", "4320", {
      prereq_expr: { type: "pattern", pattern: "CHEME-32xx" },
    });
    const { statusMap } = computeCardStatusMap(
      [docless("a", 6, "CHEME-3230"), card("b", 5, next)],
      ["a"],
      {}
    );
    expect(statusMap.b.blocked).toBe(false);
  });

  it("the same card uncompleted, in a later column, does not satisfy", () => {
    const next = makeCourse("CHEME-3130", "CHEME", "3130", { prereq_expr: courseNode("CHEME-3230") });
    const { statusMap } = computeCardStatusMap(
      [docless("a", 6, "CHEME-3230"), card("b", 5, next)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(true);
  });
});

describe("cross-listed aliases (canonical)", () => {
  const engrd = makeCourse("ENGRD-2110", "ENGRD", "2110");
  const next = makeCourse("CS-3110", "CS", "3110", { prereq_expr: courseNode("CS-2110") });
  const aliases: Record<string, string> = { "ENGRD-2110": "CS-2110" };
  const canonical = (id: string) => aliases[id] ?? id;

  it("without a canonicalizer the twin doesn't count (identity default)", () => {
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, engrd), card("b", 5, next)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(true);
  });

  it("with the alias map, ENGRD 2110 satisfies a CS 2110 leaf", () => {
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, engrd), card("b", 5, next)],
      [],
      {},
      undefined,
      canonical
    );
    expect(statusMap.b.blocked).toBe(false);
  });
});
