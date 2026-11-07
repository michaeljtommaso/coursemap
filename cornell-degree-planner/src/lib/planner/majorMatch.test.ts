import { describe, it, expect } from "vitest";
import {
  assign,
  poolQualifies,
  programToRequirements,
  type MatchCourse,
  type RequirementInstance,
  type SeatRequirement,
  type PoolRequirement,
  type MatchSlot,
  type MatchElectiveGroup,
} from "./majorMatch";
import type { AttributeMatch } from "./satisfies";
import type { QualifyingRule } from "@/types/db";

// ── Builders ──────────────────────────────────────────────────────────────────
function course(
  id: string,
  credits = 3,
  extra: Partial<MatchCourse> = {}
): MatchCourse {
  const sp = id.replace(/-/g, " ").indexOf(" ");
  const code = id.replace(/-/g, " ");
  return {
    id,
    subject: sp >= 0 ? code.slice(0, sp) : code,
    number: sp >= 0 ? code.slice(sp + 1) : "",
    credits,
    ...extra,
  };
}

function courseSeat(id: string, courseId: string, credits = 3): SeatRequirement {
  return { id, kind: "seat", req: { kind: "course", courseId }, credits, label: courseId };
}
function patternSeat(id: string, pattern: string, credits = 3): SeatRequirement {
  return { id, kind: "seat", req: { kind: "pattern", pattern }, credits, label: pattern };
}
function attrSeat(id: string, match: AttributeMatch, credits = 3): SeatRequirement {
  return { id, kind: "seat", req: { kind: "attribute", match }, credits, label: id };
}
function levelPool(
  id: string,
  subject: string,
  minNumber: number,
  minCredits: number,
  requiredCourses = 1
): PoolRequirement {
  return {
    id,
    kind: "pool",
    rule: { type: "level", subject, min_number: minNumber },
    minCredits,
    requiredCourses,
    courseIds: [],
    label: id,
    computable: true,
  };
}

const FWS: AttributeMatch = { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] };

// ── Consumption invariant helper ──────────────────────────────────────────────
function assertConsumption(courses: MatchCourse[], reqs: RequirementInstance[], canonical?: (id: string) => string) {
  const a = assign(courses, reqs, canonical);
  const seen = new Set<string>();
  for (const m of a.matched) {
    expect(seen.has(m.courseId)).toBe(false); // never assigned twice
    seen.add(m.courseId);
  }
  for (const u of a.uncounted) {
    expect(seen.has(u.courseId)).toBe(false); // matched XOR uncounted
  }
  return a;
}

// ──────────────────────────────────────────────────────────────────────────────
describe("assign — the only-candidate augmenting case (greedy fails, HK passes)", () => {
  it("a course that is the sole candidate for seat B but also matches seat A is not eaten by A", () => {
    // Seat A: pattern CS-xxxx (any CS course). Seat B: exact CS-4820.
    // Courses: CS-2110 (matches only A), CS-4820 (matches BOTH A and B).
    // Greedy first-fit assigns CS-2110→A? no — greedy over courses: CS-4820 comes
    // first and grabs A, leaving B (its only candidate) unfilled. HK must route
    // CS-2110→A and CS-4820→B, filling both.
    const seatA = patternSeat("A", "CS-xxxx", 3);
    const seatB = courseSeat("B", "CS-4820", 3);
    const cs4820 = course("CS-4820", 3);
    const cs2110 = course("CS-2110", 3);
    const a = assign([cs4820, cs2110], [seatA, seatB]);

    expect(a.matched).toHaveLength(2);
    const filled = new Set(a.matched.map((m) => m.requirementId));
    expect(filled).toEqual(new Set(["A", "B"]));
    expect(a.missing).toHaveLength(0);
    // B must be filled specifically by CS-4820 (its only candidate).
    const bMatch = a.matched.find((m) => m.requirementId === "B");
    expect(bMatch?.courseId).toBe("CS-4820");
  });
});

describe("assign — consumption", () => {
  it("one course matching two seats fills exactly one; the other is missing", () => {
    const seatA = patternSeat("A", "CS-xxxx", 3);
    const seatB = patternSeat("B", "CS-4xxx", 3);
    const cs4820 = course("CS-4820", 3); // matches BOTH A and B
    const a = assertConsumption([cs4820], [seatA, seatB]);

    expect(a.matched).toHaveLength(1);
    expect(a.missing).toHaveLength(1);
    expect(a.uncounted).toHaveLength(0); // the course was consumed by one seat
    expect(a.creditsSatisfied).toBe(3);
    expect(a.creditsRequired).toBe(6);
    expect(a.pct).toBe(50);
  });
});

describe("assign — duplicate seats stay distinct", () => {
  it("two FWS attribute seats + two FWS courses → both matched (dedup was bug #9.2)", () => {
    const s1 = attrSeat("fws-1", FWS, 3);
    const s2 = attrSeat("fws-2", FWS, 3);
    const c1 = course("ENGL-1134", 3, { title: "FWS: True Stories" });
    const c2 = course("PHIL-1111", 3, { title: "FWS: Philosophy in Practice" });
    const a = assertConsumption([c1, c2], [s1, s2]);

    expect(a.matched).toHaveLength(2);
    expect(new Set(a.matched.map((m) => m.requirementId))).toEqual(
      new Set(["fws-1", "fws-2"])
    );
    expect(a.missing).toHaveLength(0);
    expect(a.pct).toBe(100);
  });

  it("two FWS seats + one FWS course → one matched, one missing", () => {
    const s1 = attrSeat("fws-1", FWS, 3);
    const s2 = attrSeat("fws-2", FWS, 3);
    const c1 = course("ENGL-1134", 3, { title: "FWS: True Stories" });
    const a = assertConsumption([c1], [s1, s2]);
    expect(a.matched).toHaveLength(1);
    expect(a.missing).toHaveLength(1);
    expect(a.pct).toBe(50);
  });
});

describe("assign — credit weighting", () => {
  it("a 4-credit course in a 3-credit seat satisfies 3 (seat credits, not course credits)", () => {
    const seat = courseSeat("s", "CS-2110", 3);
    const c = course("CS-2110", 4);
    const a = assign([c], [seat]);
    expect(a.matched[0].credits).toBe(3);
    expect(a.creditsSatisfied).toBe(3);
    expect(a.creditsRequired).toBe(3);
    expect(a.pct).toBe(100);
  });

  it("pct is credit-weighted, not seat-count weighted", () => {
    // 4-credit core filled + 1-credit seminar missing → 4/5 = 80%, not 50%.
    const core = courseSeat("core", "CS-2110", 4);
    const seminar = courseSeat("sem", "CS-1300", 1);
    const a = assign([course("CS-2110", 4)], [core, seminar]);
    expect(a.creditsSatisfied).toBe(4);
    expect(a.creditsRequired).toBe(5);
    expect(a.pct).toBe(80);
  });
});

describe("assign — pool fill", () => {
  it("fills a pool descending credits, caps at minCredits, overflow → uncounted requirement-already-filled", () => {
    // Pool needs 9 credits of CS-3000+. Courses: 4,4,4 credits all qualifying.
    const pool = levelPool("tech", "CS", 3000, 9);
    const c1 = course("CS-4820", 4);
    const c2 = course("CS-4780", 4);
    const c3 = course("CS-3110", 4);
    const a = assertConsumption([c1, c2, c3], [pool]);

    // 4 + 4 = 8 < 9 → assign a third (12 ≥ 9). Third counts only 1 (cap).
    const poolMatches = a.matched.filter((m) => m.requirementId === "tech");
    expect(poolMatches).toHaveLength(3);
    expect(a.creditsSatisfied).toBe(9); // capped at minCredits
    expect(a.creditsRequired).toBe(9);
    expect(a.pct).toBe(100);
    expect(a.missing).toHaveLength(0);
    // The counted credits sum to exactly 9 (4 + 4 + 1 cap).
    expect(poolMatches.reduce((s, m) => s + m.credits, 0)).toBe(9);
  });

  it("richest courses are chosen first (descending credit order)", () => {
    const pool = levelPool("tech", "CS", 3000, 6);
    const small = course("CS-3001", 2);
    const big = course("CS-4820", 4);
    const mid = course("CS-4780", 3);
    const a = assign([small, big, mid], [pool]);
    // Need 6: pick 4 then 3 = 7 (cap 6), small(2) never touched → overflow.
    const poolMatched = a.matched.filter((m) => m.requirementId === "tech").map((m) => m.courseId);
    expect(poolMatched).toEqual(["CS-4820", "CS-4780"]);
    const over = a.uncounted.find((u) => u.courseId === "CS-3001");
    expect(over?.reason).toBe("requirement-already-filled");
    expect(a.creditsSatisfied).toBe(6);
  });

  it("underfilled computable pool reports the shortfall as missing", () => {
    const pool = levelPool("tech", "CS", 3000, 9);
    const a = assign([course("CS-4820", 4)], [pool]);
    expect(a.creditsSatisfied).toBe(4);
    expect(a.missing).toHaveLength(1);
    expect(a.missing[0].credits).toBe(5); // 9 - 4 shortfall
    expect(a.missing[0].reason).toBeUndefined();
  });
});

describe("assign — non-computable pool", () => {
  it("list/category pool sits in the denominator and reports missing with reason no-data", () => {
    const pool: PoolRequirement = {
      id: "distr",
      kind: "pool",
      rule: { type: "list" },
      minCredits: 6,
      requiredCourses: 1,
      courseIds: [],
      label: "Liberal Studies",
      computable: false,
    };
    // Even a course that would "look" qualifying can't be counted.
    const a = assign([course("HIST-1200", 4)], [pool]);
    expect(a.creditsSatisfied).toBe(0);
    expect(a.creditsRequired).toBe(6); // honest denominator
    expect(a.pct).toBe(0);
    const miss = a.missing.find((m) => m.requirementId === "distr");
    expect(miss?.reason).toBe("no-data");
    expect(miss?.credits).toBe(6);
    // The course matched no assignable requirement.
    expect(a.uncounted).toEqual([
      { courseId: "HIST-1200", reason: "no-requirement-matched" },
    ]);
  });
});

describe("assign — seat kinds", () => {
  it("attribute seat matched via title", () => {
    const seat = attrSeat("fws", FWS, 3);
    const c = course("ENGL-1134", 3, { title: "FWS: True Stories" });
    const a = assign([c], [seat]);
    expect(a.matched).toHaveLength(1);
    expect(a.pct).toBe(100);
  });

  it("attribute seat matched via attrs.value", () => {
    const match: AttributeMatch = { anyOf: [{ field: "attrs.value", op: "in", value: ["WRT-AG"] }] };
    const seat = attrSeat("wrt", match, 3);
    const c = course("ENGL-2000", 3, { title: "Plain", attrs: [{ value: "WRT-AG" }] });
    const a = assign([c], [seat]);
    expect(a.matched).toHaveLength(1);
  });

  it("null attribute_match becomes an unmatchable seat (in denominator, always missing)", () => {
    const reqs = programToRequirements({
      slots: [{ id: "a1", kind: "attribute", attribute_match: null, pattern_title: "Some Attr" }],
      electiveGroups: [],
    });
    const a = assign([course("ENGL-1134", 3, { title: "FWS: True Stories" })], reqs);
    expect(a.creditsRequired).toBe(3);
    expect(a.creditsSatisfied).toBe(0);
    expect(a.missing).toHaveLength(1);
    expect(a.uncounted[0].reason).toBe("no-requirement-matched");
  });

  it("pattern seat matched", () => {
    const seat = patternSeat("p", "CS-4xxx", 3);
    const a = assign([course("CS-4820", 3)], [seat]);
    expect(a.matched).toHaveLength(1);
  });

  it("exact-course seat matched via canonical aliasing (ENGRD-2110 fills a CS-2110 seat)", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    const seat = courseSeat("s", "CS-2110", 4);
    const engrd = course("ENGRD-2110", 4);
    const a = assign([engrd], [seat], canonical);
    expect(a.matched).toHaveLength(1);
    expect(a.matched[0].courseId).toBe("CS-2110"); // reported as the canonical id
    expect(a.pct).toBe(100);
  });
});

describe("assign — cross-listing dedup", () => {
  it("ENGRD-2110 + CS-2110 in the plan cannot double-fill (deduped to one course)", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    const seatA = courseSeat("A", "CS-2110", 3);
    const seatB = patternSeat("B", "CS-xxxx", 3);
    // Both codes of the SAME course present; must collapse to one course, filling
    // one seat only (not both).
    const a = assign(
      [course("ENGRD-2110", 4), course("CS-2110", 3)],
      [seatA, seatB],
      canonical
    );
    expect(a.matched).toHaveLength(1); // only one course exists after dedup
    expect(a.missing).toHaveLength(1);
  });

  it("dedup keeps the MAX credits across duplicate listings", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    const seat = courseSeat("s", "CS-2110", 5); // seat wide enough to show course credits
    // Duplicate listings: 4 credits and 3 credits → deduped keeps 4, but the seat
    // caps satisfied at seat.credits anyway; assert via a pool where course credits show.
    const pool = levelPool("p", "CS", 2000, 4);
    const a = assign(
      [course("CS-2110", 3), course("ENGRD-2110", 4)],
      [pool],
      canonical
    );
    void seat;
    // One course after dedup with 4 credits → fills the 4-credit pool exactly.
    expect(a.creditsSatisfied).toBe(4);
    expect(a.matched).toHaveLength(1);
  });
});

describe("assign — synthetic credits are ordinary courses (zero bias)", () => {
  it("isCredit courses are treated identically to regular courses", () => {
    const seat = courseSeat("s", "MATH-1910", 4);
    const regular = assign([course("MATH-1910", 4)], [seat]);
    const synthetic = assign([course("MATH-1910", 4, { isCredit: true })], [seat]);
    // Strip nothing — the two assignments are identical.
    expect(synthetic).toEqual(regular);
  });

  it("same course list + isCredit entries yields identical treatment across two requirement sets", () => {
    const courses = [
      course("MATH-1910", 4, { isCredit: true }),
      course("CS-2110", 4),
    ];
    const reqsX = [courseSeat("x1", "MATH-1910", 4), courseSeat("x2", "CS-2110", 4)];
    const reqsY = [courseSeat("y1", "MATH-1910", 4), courseSeat("y2", "CS-2110", 4)];
    const ax = assign(courses, reqsX);
    const ay = assign(courses, reqsY);
    expect(ax.creditsSatisfied).toBe(ay.creditsSatisfied);
    expect(ax.pct).toBe(ay.pct);
    expect(ax.pct).toBe(100);
  });
});

describe("assign — C6 regression: output depends ONLY on (courses, requirements)", () => {
  it("no parameter can express which program is 'current' — pure function of inputs", () => {
    // Two programs. The student is 'in' program CURRENT in no way expressible to
    // assign(): there is no such parameter. Prove bias is impossible at the API.
    const courses = [course("CS-1110", 4), course("CS-2110", 4)];
    const currentProgram: RequirementInstance[] = [
      courseSeat("c1", "CS-1110", 4),
      courseSeat("c2", "CS-3110", 4), // unmet
    ];
    const otherProgram: RequirementInstance[] = [
      courseSeat("o1", "CS-1110", 4),
      courseSeat("o2", "CS-2110", 4),
    ];
    // Scored by the identical function; "current" gets no credit for unrecorded slots.
    const cur = assign(courses, currentProgram);
    const oth = assign(courses, otherProgram);
    expect(cur.pct).toBe(50); // one of two seats
    expect(oth.pct).toBe(100); // the other program legitimately fits better
    // Re-running is deterministic — no hidden state, no bias toward the "current".
    expect(assign(courses, currentProgram)).toEqual(cur);
    expect(assign(courses, otherProgram)).toEqual(oth);
  });
});

describe("assign — edge cases", () => {
  it("empty inputs → zero everything, pct 0", () => {
    const a = assign([], []);
    expect(a).toEqual({
      matched: [],
      missing: [],
      uncounted: [],
      creditsSatisfied: 0,
      creditsRequired: 0,
      pct: 0,
    });
  });

  it("zero-requirement program → every course uncounted no-requirement-matched, pct 0", () => {
    const a = assign([course("CS-2110", 4), course("CS-1110", 4)], []);
    expect(a.matched).toHaveLength(0);
    expect(a.creditsRequired).toBe(0);
    expect(a.pct).toBe(0);
    expect(a.uncounted).toEqual([
      { courseId: "CS-2110", reason: "no-requirement-matched" },
      { courseId: "CS-1110", reason: "no-requirement-matched" },
    ]);
  });

  it("program with only pools", () => {
    const pool = levelPool("tech", "CS", 3000, 6);
    const a = assign([course("CS-4820", 4), course("CS-3110", 3)], [pool]);
    expect(a.creditsRequired).toBe(6);
    expect(a.creditsSatisfied).toBe(6);
    expect(a.pct).toBe(100);
  });

  it("a course matching no requirement at all is no-requirement-matched", () => {
    const seat = courseSeat("s", "CS-2110", 3);
    const a = assign([course("MATH-1910", 4)], [seat]);
    expect(a.uncounted).toEqual([
      { courseId: "MATH-1910", reason: "no-requirement-matched" },
    ]);
    expect(a.missing).toHaveLength(1);
  });
});

describe("assign — property: matched credits ≤ required, ids unique", () => {
  const pool = levelPool("tech", "CS", 3000, 6);
  const reqs: RequirementInstance[] = [
    courseSeat("core1", "CS-1110", 4),
    courseSeat("core2", "CS-2110", 4),
    patternSeat("pat", "MATH-4xxx", 3),
    attrSeat("fws", FWS, 3),
    pool,
    {
      id: "distr",
      kind: "pool",
      rule: { type: "list" },
      minCredits: 6,
      requiredCourses: 1,
      courseIds: [],
      label: "Distribution",
      computable: false,
    },
  ];

  // A spread of course lists (hand-rolled fuzz).
  const lists: MatchCourse[][] = [
    [],
    [course("CS-1110", 4)],
    [course("CS-1110", 4), course("CS-2110", 4), course("MATH-4310", 3)],
    [
      course("CS-4820", 4),
      course("CS-4780", 4),
      course("CS-3110", 4),
      course("ENGL-1134", 3, { title: "FWS: X" }),
      course("MATH-1910", 4, { isCredit: true }),
    ],
    [
      course("CS-1110", 1),
      course("CS-1110", 4), // dup id (no canonical) — still deduped
      course("HIST-1200", 4),
    ],
  ];

  for (let i = 0; i < lists.length; i++) {
    it(`list #${i}: Σ matched credits ≤ creditsRequired, matched ids unique`, () => {
      const a = assign(lists[i], reqs);
      const sum = a.matched.reduce((s, m) => s + m.credits, 0);
      expect(sum).toBeLessThanOrEqual(a.creditsRequired);
      expect(sum).toBe(a.creditsSatisfied); // per-entry credits are the counted ones
      const ids = a.matched.map((m) => m.courseId);
      expect(new Set(ids).size).toBe(ids.length); // unique
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
describe("programToRequirements", () => {
  it("course/pattern/attribute slots → seats; elective groups → pools", () => {
    const slots: MatchSlot[] = [
      {
        id: "s-course",
        kind: "course",
        course_id: "CS-2110",
        courses: { id: "CS-2110", subject: "CS", number: "2110", credits_min: 4 },
      },
      { id: "s-pat", kind: "pattern", pattern: "CS-4xxx", pattern_title: "4000-level CS elective" },
      { id: "s-attr", kind: "attribute", attribute_match: FWS, pattern_title: "First-Year Writing Seminar" },
      { id: "s-elec", kind: "elective", elective_group_id: "grp-tech" }, // → no seat
    ];
    const electiveGroups: MatchElectiveGroup[] = [
      {
        id: "grp-tech",
        name: "Technical Electives",
        qualifying_rule: { type: "level", subject: "CS", min_number: 3000 },
        min_credits: 9,
      },
    ];
    const reqs = programToRequirements({ slots, electiveGroups });

    const seats = reqs.filter((r): r is SeatRequirement => r.kind === "seat");
    const pools = reqs.filter((r): r is PoolRequirement => r.kind === "pool");
    expect(seats).toHaveLength(3); // course/pattern/attribute — NOT the elective slot
    expect(pools).toHaveLength(1);

    const courseSeatReq = seats.find((s) => s.id === "s-course")!;
    expect(courseSeatReq.credits).toBe(4); // from courses.credits_min
    expect(courseSeatReq.label).toBe("CS 2110");
    expect(courseSeatReq.req).toEqual({ kind: "course", courseId: "CS-2110" });

    const patSeat = seats.find((s) => s.id === "s-pat")!;
    expect(patSeat.credits).toBe(3); // default for pattern with no credit data
    expect(patSeat.label).toBe("4000-level CS elective");

    expect(pools[0]).toEqual({
      id: "grp-tech",
      kind: "pool",
      rule: { type: "level", subject: "CS", min_number: 3000 },
      minCredits: 9,
      requiredCourses: 1,
      courseIds: [],
      label: "Technical Electives",
      computable: true,
    });
  });

  it("creditsMin override on the slot wins over courses.credits_min", () => {
    const reqs = programToRequirements({
      slots: [
        {
          id: "s",
          kind: "course",
          course_id: "CS-2110",
          courses: { id: "CS-2110", subject: "CS", number: "2110", credits_min: 4 },
          creditsMin: 3,
        },
      ],
      electiveGroups: [],
    });
    expect((reqs[0] as SeatRequirement).credits).toBe(3);
  });

  it("list/category elective groups → non-computable pools", () => {
    const reqs = programToRequirements({
      slots: [],
      electiveGroups: [
        { id: "g1", name: "Liberal Studies", qualifying_rule: { type: "list" }, min_credits: 6 },
        { id: "g2", name: "Distribution", qualifying_rule: { type: "category", category: "HA" }, min_credits: 6 },
        { id: "g3", name: "Free", qualifying_rule: { type: "open" }, min_credits: 6 },
      ],
    });
    const pools = reqs.filter((r): r is PoolRequirement => r.kind === "pool");
    expect(pools.find((p) => p.id === "g1")!.computable).toBe(false);
    expect(pools.find((p) => p.id === "g2")!.computable).toBe(false);
    expect(pools.find((p) => p.id === "g3")!.computable).toBe(true);
  });

  it("duplicate slots stay distinct seats (two FWS slots = two seats)", () => {
    const slots: MatchSlot[] = [
      { id: "fws-1", kind: "attribute", attribute_match: FWS, pattern_title: "FWS" },
      { id: "fws-2", kind: "attribute", attribute_match: FWS, pattern_title: "FWS" },
    ];
    const reqs = programToRequirements({ slots, electiveGroups: [] });
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("fws-1");
    expect(reqs[1].id).toBe("fws-2");
  });

  it("end-to-end: a program with two FWS seats scores 50% with one FWS course", () => {
    const reqs = programToRequirements({
      slots: [
        { id: "fws-1", kind: "attribute", attribute_match: FWS, pattern_title: "FWS" },
        { id: "fws-2", kind: "attribute", attribute_match: FWS, pattern_title: "FWS" },
      ],
      electiveGroups: [],
    });
    const a = assign([course("ENGL-1134", 3, { title: "FWS: True Stories" })], reqs);
    expect(a.pct).toBe(50);
  });
});

// ── Spec 019 D6/D7: pools count every slot ───────────────────────────────────
function openPool(id: string, minCredits: number, requiredCourses: number): PoolRequirement {
  return { id, kind: "pool", rule: { type: "open" }, minCredits, requiredCourses, courseIds: [], label: id, computable: true };
}
function listPool(id: string, courseIds: string[], minCredits = 3, requiredCourses = 1): PoolRequirement {
  return { id, kind: "pool", rule: { type: "list" }, minCredits, requiredCourses, courseIds, label: id, computable: true };
}

describe("assign — multi-course pools (P-11)", () => {
  it("a 10-course pool is NOT met by one course", () => {
    const pool = levelPool("cs-major", "CS", 4000, 30, 10);
    const a = assign([course("CS-4820", 4)], [pool]);
    expect(a.missing).toEqual([
      { requirementId: "cs-major", label: "cs-major", credits: 26, courses: 9 },
    ]);
    expect(a.creditsSatisfied).toBe(4);
  });

  it("met only when both the course count and the credit total are reached", () => {
    const pool = levelPool("tech", "CS", 4000, 9, 3);
    const two = assign([course("CS-4820", 5), course("CS-4410", 5)], [pool]);
    expect(two.missing).toEqual([{ requirementId: "tech", label: "tech", credits: 0, courses: 1 }]);
    const three = assign([course("CS-4820", 5), course("CS-4410", 5), course("CS-4780", 3)], [pool]);
    expect(three.missing).toEqual([]);
    expect(three.creditsSatisfied).toBe(9); // capped at the pool's credits
  });

  it("tops up credits from unassigned courses when the counted courses fall short", () => {
    // One-course, 4-credit list whose lecture is 3 credits; its lab is a second member.
    const pool = listPool("chem", ["CHEM-2090", "CHEM-2091"], 4, 1);
    const a = assign([course("CHEM-2090", 3), course("CHEM-2091", 1)], [pool]);
    expect(a.missing).toEqual([]);
    expect(a.matched.map((m) => m.courseId).sort()).toEqual(["CHEM-2090", "CHEM-2091"]);
  });

  it("a broad open pool can't take a course a narrower pool needs (no stealing)", () => {
    // Pool order puts the open pool first; greedy filling would let it take
    // both CS courses and leave the CS pool short.
    const open = openPool("advisor", 6, 2);
    const cs = levelPool("cs-major", "CS", 4000, 6, 2);
    const courses = [course("CS-4820", 3), course("CS-4410", 3), course("HIST-1200", 3), course("ART-1100", 3)];
    const a = assign(courses, [open, cs]);
    expect(a.missing).toEqual([]);
    const csIds = a.matched.filter((m) => m.requirementId === "cs-major").map((m) => m.courseId).sort();
    expect(csIds).toEqual(["CS-4410", "CS-4820"]);
  });

  it("seats and pools share one matching: a seat-only course isn't lost to a pool", () => {
    const seat = courseSeat("algo", "CS-4820", 4);
    const pool = levelPool("cs-major", "CS", 4000, 3, 1);
    const a = assign([course("CS-4820", 4), course("CS-4410", 4)], [seat, pool]);
    expect(a.missing).toEqual([]);
  });
});

describe("assign — list pools are checkable (P-10)", () => {
  it("a placed member satisfies the list; a non-member doesn't", () => {
    const pool = listPool("systems", ["CS-3410", "CS-3420", "ECE-3140"], 4, 1);
    expect(assign([course("CS-3420", 4)], [pool]).missing).toEqual([]);
    expect(assign([course("CS-3110", 4)], [pool]).missing).toHaveLength(1);
  });

  it("matches members through the cross-listing canonicalizer", () => {
    const pool = listPool("systems", ["ECE-3140"], 4, 1);
    const canonical = (id: string) => (id === "CS-3140" ? "ECE-3140" : id);
    expect(assign([course("CS-3140", 4)], [pool], canonical).missing).toEqual([]);
  });

  it("an empty list stays non-computable", () => {
    const [pool] = programToRequirements({
      slots: [],
      electiveGroups: [{ id: "g", name: "g", qualifying_rule: { type: "list" }, min_credits: 3, course_ids: [] }],
    });
    expect(pool).toMatchObject({ kind: "pool", computable: false });
  });
});

describe("poolQualifies — level bounds", () => {
  it("honours max_number", () => {
    const rule = { type: "level" as const, subject: "ENGRD", min_number: 2000, max_number: 2999 };
    expect(poolQualifies(rule, { id: "ENGRD-2700", subject: "ENGRD", number: "2700" })).toBe(true);
    expect(poolQualifies(rule, { id: "ENGRD-3200", subject: "ENGRD", number: "3200" })).toBe(false);
  });
});

describe("poolQualifies — outside with min_number (spec 024 D2)", () => {
  const rule = { type: "outside" as const, exclude_subjects: ["CS"], min_number: 3000 };
  it("takes 3000+ courses outside the excluded subjects", () => {
    expect(poolQualifies(rule, { id: "MATH-4710", subject: "MATH", number: "4710" })).toBe(true);
    expect(poolQualifies(rule, { id: "MATH-3000", subject: "MATH", number: "3000" })).toBe(true);
  });
  it("rejects lower levels, excluded subjects and unparseable numbers", () => {
    expect(poolQualifies(rule, { id: "MATH-2940", subject: "MATH", number: "2940" })).toBe(false);
    expect(poolQualifies(rule, { id: "CS-4820", subject: "CS", number: "4820" })).toBe(false);
    expect(poolQualifies(rule, { id: "MATH-XX", subject: "MATH", number: "XX" })).toBe(false);
  });
  it("without min_number, any level outside counts (unchanged)", () => {
    const any = { type: "outside" as const, exclude_subjects: ["CS"] };
    expect(poolQualifies(any, { id: "HIST-1200", subject: "HIST", number: "1200" })).toBe(true);
  });
  it("an outside pool with min_number is computable and fills in assign", () => {
    const [pool] = programToRequirements({
      slots: [],
      electiveGroups: [{ id: "ext", name: "ext", qualifying_rule: rule, min_credits: 3, course_ids: [] }],
    });
    expect(pool).toMatchObject({ kind: "pool", computable: true });
    const a = assign([course("MATH-2940", 3), course("MATH-4710", 3)], [pool]);
    expect(a.matched.map((m) => m.courseId)).toEqual(["MATH-4710"]);
  });
});

describe("assign — narrow requirements win ties (spec 024 tiers)", () => {
  const listPool = (id: string, ids: string[], requiredCourses = 1): PoolRequirement => ({
    id,
    kind: "pool",
    rule: { type: "list" },
    minCredits: 3,
    requiredCourses,
    courseIds: ids,
    label: id,
    computable: true,
  });

  it("the only practicum course fills the practicum, not an open seat", () => {
    // Same matching size either way; the open pool must be the one left short.
    const open = openPool("major-approved", 3, 1);
    const practicum = listPool("practicum", ["CS-3152", "CS-4121"]);
    for (const reqs of [
      [open, practicum],
      [practicum, open],
    ]) {
      const a = assign([course("CS-3152", 3)], reqs);
      expect(a.matched).toEqual([{ courseId: "CS-3152", requirementId: "practicum", credits: 3 }]);
    }
  });

  it("a course on a short list and a long list goes to the short one", () => {
    const os = listPool("os-choice", ["CS-4410", "CS-4414"]);
    const csElective = listPool("cs-elective", ["CS-4414", "CS-4820", "CS-4780", "CS-4670"], 2);
    const a = assign([course("CS-4414", 4), course("CS-4820", 4)], [csElective, os]);
    const where = Object.fromEntries(a.matched.map((m) => [m.courseId, m.requirementId]));
    expect(where).toEqual({ "CS-4414": "os-choice", "CS-4820": "cs-elective" });
  });

  it("tiers never shrink the matching: a broad pool still gets a course only it can take", () => {
    const open = openPool("open", 3, 1);
    const narrow = listPool("narrow", ["CS-4820"]);
    const a = assign([course("CS-4820", 3), course("HIST-1200", 3)], [open, narrow]);
    expect(a.matched.map((m) => `${m.courseId}->${m.requirementId}`).sort()).toEqual([
      "CS-4820->narrow",
      "HIST-1200->open",
    ]);
  });
});

describe("poolQualifies — list lookup (spec 024 D5)", () => {
  const rule = { type: "list" as const };
  it("matches by canonical id, both on the list side and the course side", () => {
    const ids = ["ENGRD-2110", "CS-4820"];
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    expect(poolQualifies(rule, { id: "CS-2110", subject: "CS", number: "2110" }, ids, canonical)).toBe(true);
    expect(poolQualifies(rule, { id: "ENGRD-2110", subject: "ENGRD", number: "2110" }, ids, canonical)).toBe(true);
    expect(poolQualifies(rule, { id: "CS-3110", subject: "CS", number: "3110" }, ids, canonical)).toBe(false);
  });
  it("a different canonicalizer on the same list gets its own answer (no stale cache)", () => {
    const ids = ["ENGRD-2110"];
    const c = { id: "CS-2110", subject: "CS", number: "2110" };
    expect(poolQualifies(rule, c, ids)).toBe(false);
    expect(poolQualifies(rule, c, ids, (id) => (id === "ENGRD-2110" ? "CS-2110" : id))).toBe(true);
  });
  it("2,000-id lists answer in linear time", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `X-${i}`);
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 9000; i++) if (poolQualifies(rule, { id: `X-${i}`, subject: "X", number: String(i) }, ids)) hits++;
    expect(hits).toBe(2000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("assign — credit top-up (review fixes)", () => {
  it("an open pool doesn't take the spare a narrower pool needs to reach its credits", () => {
    // File order puts the open pool first (as in every program). Both pools are
    // course-complete after the matching but 1 credit short; the 1-credit CS
    // spare must go to the CS pool and the non-CS spare to the open pool.
    const open = openPool("advisor", 4, 1);
    const cs = levelPool("cs-major", "CS", 4000, 4, 1);
    const courses = [course("HIST-1200", 3), course("CS-4820", 3), course("CS-4999", 1), course("PE-1100", 1)];
    const a = assign(courses, [open, cs]);
    expect(a.missing).toEqual([]);
  });

  it("a 0-credit course is never spent on a credit shortfall", () => {
    const pool = openPool("advisor", 4, 1);
    const a = assign([course("HIST-1200", 3), course("PE-1100", 0), course("PE-1101", 0)], [pool]);
    expect(a.matched.map((m) => m.courseId)).toEqual(["HIST-1200"]);
    expect(a.uncounted.map((u) => u.courseId).sort()).toEqual(["PE-1100", "PE-1101"]);
    expect(a.missing).toEqual([{ requirementId: "advisor", label: "advisor", credits: 1 }]);
  });
});

describe("assign — credit take-back from a broader pool (spec 032)", () => {
  const ids = (a: ReturnType<typeof assign>, req: string) =>
    a.matched.filter((m) => m.requirementId === req).map((m) => m.courseId).sort();
  const missingIds = (a: ReturnType<typeof assign>) => a.missing.map((m) => m.requirementId).sort();

  it("a two-course credit requirement completes instead of feeding an empty open seat (BIOMG 3310 + 3320)", () => {
    const biochem = listPool("biochem", ["BIOMG-3300", "BIOMG-3310", "BIOMG-3320", "BIOMG-3350"], 4, 1);
    const advisor = openPool("advisor", 6, 2);
    const a = assertConsumption([course("BIOMG-3310", 3), course("BIOMG-3320", 2)], [advisor, biochem]);
    expect(ids(a, "biochem")).toEqual(["BIOMG-3310", "BIOMG-3320"]);
    expect(missingIds(a)).toEqual(["advisor"]);
  });

  it("works alongside another list pool, in any course order", () => {
    const biochem = listPool("biochem", ["BIOMG-3310", "BIOMG-3320"], 4, 1);
    const upper = listPool("upper-bio", ["BIOMI-2900", "BIONB-2220"], 3, 1);
    const advisor = openPool("advisor", 6, 2);
    const courses = [course("BIOMG-3310", 3), course("BIOMG-3320", 2), course("BIOMI-2900", 3)];
    for (const order of [courses, [...courses].reverse(), [courses[1], courses[2], courses[0]]]) {
      const a = assertConsumption(order, [advisor, upper, biochem]);
      expect(missingIds(a)).toEqual(["advisor"]);
      expect(ids(a, "upper-bio")).toEqual(["BIOMI-2900"]);
    }
  });

  it("a lab + lecture pair completes its pool (CHEM 2090 + 2091)", () => {
    const chem = listPool("intro-chem", ["CHEM-2090", "CHEM-2091", "CHEM-2070", "CHEM-2071"], 4, 1);
    const major = openPool("major-approved", 9, 3);
    const a = assertConsumption([course("CHEM-2090", 3), course("CHEM-2091", 1)], [major, chem]);
    expect(ids(a, "intro-chem")).toEqual(["CHEM-2090", "CHEM-2091"]);
  });

  it("never takes from a broader pool that is already met", () => {
    const narrow = listPool("narrow", ["MAE-3000", "MAE-3100"], 4, 1);
    const open = openPool("open", 3, 1);
    const a = assertConsumption([course("MAE-3000", 3), course("MAE-3100", 3)], [open, narrow]);
    expect(missingIds(a)).toEqual(["narrow"]);
    expect(ids(a, "open")).toHaveLength(1);
  });

  it("moves nothing unless the move completes the short pool", () => {
    const narrow = listPool("narrow", ["BEE-4590", "BEE-4550"], 6, 1);
    const open = openPool("open", 6, 2);
    // 3 + 1 credits can't reach 6, so whichever course phase 1 gave the open
    // pool stays there: each pool keeps one course and the narrow pool stays short.
    const a = assertConsumption([course("BEE-4590", 3), course("BEE-4550", 1)], [open, narrow]);
    expect(ids(a, "narrow")).toHaveLength(1);
    expect(ids(a, "open")).toHaveLength(1);
    expect(missingIds(a)).toEqual(["narrow", "open"]);
  });

  it("never takes from a seat or from a narrower pool", () => {
    const seat = courseSeat("seat", "CHEM-2091", 1);
    const broad = listPool("broad", ["CHEM-2090", "CHEM-2091", "CHEM-3570", "CHEM-3580"], 4, 1);
    const narrower = listPool("narrower", ["CHEM-3570"], 4, 1);
    const a = assertConsumption(
      [course("CHEM-2090", 3), course("CHEM-2091", 1), course("CHEM-3570", 3)],
      [seat, broad, narrower]
    );
    expect(ids(a, "seat")).toEqual(["CHEM-2091"]);
    expect(ids(a, "narrower")).toEqual(["CHEM-3570"]);
    expect(missingIds(a)).toEqual(["broad", "narrower"]);
  });
});

describe("poolQualifies — open with constraints (spec 038)", () => {
  const c = (id: string) => {
    const [subject, number] = id.split("-");
    return { id, subject, number };
  };

  it("a bare open rule accepts any course", () => {
    const rule: QualifyingRule = { type: "open" };
    for (const id of ["MATH-1110", "PE-1100", "ANSC-1000", "ENGRD-2700"]) expect(poolQualifies(rule, c(id))).toBe(true);
  });

  it("min_number: only courses numbered at least this", () => {
    const rule: QualifyingRule = { type: "open", min_number: 1100 };
    expect(poolQualifies(rule, c("ENGRD-2700"))).toBe(true);
    expect(poolQualifies(rule, c("ENGRI-1100"))).toBe(true);
    expect(poolQualifies(rule, c("ANSC-1000"))).toBe(false);
    expect(poolQualifies(rule, { id: "credit:x", subject: "", number: "" })).toBe(false);
  });

  it("exclude_courses: by canonical id", () => {
    const rule: QualifyingRule = { type: "open", exclude_courses: ["MATH-1110"] };
    expect(poolQualifies(rule, c("MATH-1110"))).toBe(false);
    expect(poolQualifies(rule, c("MATH-1910"))).toBe(true);
    expect(poolQualifies(rule, c("MATH-0900"))).toBe(true);
    const canonical = (id: string) => (id === "XMATH-1110" ? "MATH-1110" : id);
    expect(poolQualifies(rule, c("XMATH-1110"), [], canonical)).toBe(false);
  });

  it("both: Engineering's advisor-approved electives", () => {
    const rule: QualifyingRule = { type: "open", min_number: 1100, exclude_courses: ["MATH-1110", "MATH-1900", "CS-1109"] };
    expect(poolQualifies(rule, c("MATH-1110"))).toBe(false);
    expect(poolQualifies(rule, c("MATH-1900"))).toBe(false);
    expect(poolQualifies(rule, c("CS-1109"))).toBe(false);
    expect(poolQualifies(rule, c("CS-1110"))).toBe(true);
    expect(poolQualifies(rule, c("ENGRD-2700"))).toBe(true);
    expect(poolQualifies(rule, c("ANSC-1000"))).toBe(false);
  });

  it("assign: MATH 1110 is left uncounted, ENGRD 2700 fills the seat", () => {
    const adv: PoolRequirement = {
      id: "adv",
      kind: "pool",
      rule: { type: "open", min_number: 1100, exclude_courses: ["MATH-1110"] },
      minCredits: 6,
      requiredCourses: 2,
      courseIds: [],
      label: "Advisor",
      computable: true,
    };
    const a = assign([course("MATH-1110", 4), course("ENGRD-2700"), course("ANSC-1000")], [adv]);
    expect(a.matched.map((m) => m.courseId)).toEqual(["ENGRD-2700"]);
    expect(a.uncounted.map((u) => u.courseId).sort()).toEqual(["ANSC-1000", "MATH-1110"]);
  });
});

describe("liberal studies category (spec 037 D5)", () => {
  const LS: QualifyingRule = { type: "category", category: "liberal-studies" };

  it("programToRequirements: liberal studies is computable, any other category is not", () => {
    const reqs = programToRequirements({
      slots: [],
      electiveGroups: [
        { id: "liberal-studies", name: "Liberal Studies", qualifying_rule: LS, min_credits: 18, required_courses: 6 },
        { id: "g2", name: "Distribution", qualifying_rule: { type: "category", category: "HA" }, min_credits: 6 },
      ],
    });
    const pools = reqs.filter((r): r is PoolRequirement => r.kind === "pool");
    expect(pools.find((p) => p.id === "liberal-studies")!.computable).toBe(true);
    expect(pools.find((p) => p.id === "g2")!.computable).toBe(false);
  });

  it("poolQualifies: a course that counts for liberal studies (tags, petitions, credit)", () => {
    expect(poolQualifies(LS, { id: "ECON-1110", subject: "ECON", number: "1110", attrs: [{ value: "SBA-AG" }] })).toBe(true);
    // An index record's string tags.
    expect(poolQualifies(LS, { id: "ENGL-2800", subject: "ENGL", number: "2800", attrs: ["ALC-AS"] })).toBe(true);
    expect(poolQualifies(LS, { id: "CS-2110", subject: "CS", number: "2110", attrs: [] })).toBe(false);
    expect(poolQualifies(LS, { id: "X-1000", subject: "X", number: "1000", attrs: ["D-HE"] })).toBe(false);
    // Petitioned, untagged.
    expect(poolQualifies(LS, { id: "AEM-2710", subject: "AEM", number: "2710" })).toBe(true);
    // Exam credit with the award's categories.
    expect(poolQualifies(LS, { id: "SPAN-2000A", subject: "SPAN", number: "2000A", liberalStudies: ["FL"] })).toBe(true);
    // Another category never qualifies.
    expect(poolQualifies({ type: "category", category: "HA" }, { id: "H-1", subject: "H", number: "1", attrs: ["HA-AG"] })).toBe(false);
  });

  it("poolQualifies: the entering class decides SCD tags outside SCD-HA / SCD-AS", () => {
    const scd = { id: "X-2000", subject: "X", number: "2000", attrs: ["SCD-HE"] };
    expect(poolQualifies(LS, scd)).toBe(false);
    expect(poolQualifies(LS, scd, [], undefined, { liberalStudiesCohort: "fa2024" })).toBe(false);
    expect(poolQualifies(LS, scd, [], undefined, { liberalStudiesCohort: "fa2020" })).toBe(true);
  });

  it("assign: liberal studies fills before an open pool when both want the same course", () => {
    const ls: PoolRequirement = {
      id: "liberal-studies",
      kind: "pool",
      rule: LS,
      minCredits: 3,
      requiredCourses: 1,
      courseIds: [],
      label: "Liberal Studies",
      computable: true,
    };
    const open: PoolRequirement = { ...ls, id: "open", rule: { type: "open" }, label: "Open" };
    const a = assign([course("HIST-1540", 3, { attrs: [{ value: "HA-AG" }] }), course("ANSC-1000")], [open, ls]);
    expect(a.matched.find((m) => m.requirementId === "liberal-studies")?.courseId).toBe("HIST-1540");
    expect(a.matched.find((m) => m.requirementId === "open")?.courseId).toBe("ANSC-1000");
  });
});
