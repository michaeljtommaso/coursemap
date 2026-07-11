import { describe, it, expect } from "vitest";
import {
  assign,
  programToRequirements,
  type MatchCourse,
  type RequirementInstance,
  type SeatRequirement,
  type PoolRequirement,
  type MatchSlot,
  type MatchElectiveGroup,
} from "./majorMatch";
import type { AttributeMatch } from "./satisfies";

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
  minCredits: number
): PoolRequirement {
  return {
    id,
    kind: "pool",
    rule: { type: "level", subject, min_number: minNumber },
    minCredits,
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
