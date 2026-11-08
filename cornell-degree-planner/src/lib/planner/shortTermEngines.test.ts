import { describe, it, expect } from "vitest";
import type { Course, PrereqExpr } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { BoardCard } from "./board";
import {
  computeCardStatusMap,
  isSemesterOverloaded,
  semesterPrereqPools,
} from "./computeCardStatusMap";
import { deriveEdges, type PlacedCourse } from "./deriveEdges";
import { computePendingChoiceMap } from "./pendingChoiceMap";
import type { OpenChoice } from "./pendingChoices";
import { horizonForSemester, semesterTermYear, shortTermIsFuture } from "./horizon";
import { columnLabel, semesterLabel } from "./semesters";
import { semesterTerm } from "./liberalStudies";
import { buildMatchPool } from "./matchAdapters";
import { lastTimeLine, lastTimeSeason, lastSameSeasonEntry } from "./reviews";
import { offeredMessage, resolveCardStatusLine } from "./statusLine";
import { targetHighlightSem } from "./armHighlight";
import { computeTriedProgress } from "./triedProgress";
import { carryShortTerms, coursesLeftBehind, seedPlanFromPrevious } from "./seedPlanFromPrevious";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";

/**
 * Spec 042 phase 1a — the planner ENGINES with winter/summer columns: time
 * order (terms.ts columnKey) for prereq/coreq/pending/matching order, the term
 * of a column through termOfColumn, the future-only short-term offered check,
 * no credit caps on short terms, horizon (never near), tried classes and the
 * plan copy across majors.
 */

function course(id: string, extra: Partial<Course> = {}): Course {
  const [subject, number] = id.split("-");
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
    ...extra,
  };
}

const node = (id: string): PrereqExpr => ({ type: "course", id });

/** A card in semester `sem`, or — `short` — the short term just before it. */
function card(id: string, sem: number, c: Course, short = false, order = 0): BoardCard {
  const placement: Placement = short
    ? { id, courseId: c.id, sem, order, shortTerm: true }
    : { id, courseId: c.id, sem, order };
  return { placement, course: c };
}

// ── Card status: time order ────────────────────────────────────────────────

describe("computeCardStatusMap — short terms in time order", () => {
  const intro = course("CS-1110");
  const next = course("CS-2110", { prereq_expr: node("CS-1110") });

  it("a prereq in the Summer before semester 3 satisfies a course in semester 3", () => {
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, intro, true), card("b", 3, next)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(false);
    expect(statusMap.b.prereq).toBe(true);
  });

  it("a prereq in semester 3 does NOT satisfy a course in the Summer before semester 3", () => {
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, intro), card("b", 3, next, true)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(true);
    expect(statusMap.b.unmetPrereqLeaves).toEqual(["CS 1110"]);
  });

  it("a prereq in semester 2 satisfies a course in the Winter before semester 4… and the Summer before 3", () => {
    const { statusMap } = computeCardStatusMap(
      [card("a", 2, intro), card("b", 4, next, true), card("c", 3, next, true)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(false);
    expect(statusMap.c.blocked).toBe(false);
  });

  it("two classes in the SAME short term: a prereq is not strictly earlier, a coreq is", () => {
    const withCoreq = course("PHYS-1112", { coreq_expr: node("MATH-1910") });
    const calc = course("MATH-1910");
    const { statusMap } = computeCardStatusMap(
      [card("a", 3, intro, true), card("b", 3, next, true, 1), card("m", 3, calc, true, 2), card("p", 3, withCoreq, true, 3)],
      [],
      {}
    );
    expect(statusMap.b.blocked).toBe(true);
    expect(statusMap.p.coreq).toBe(true);
  });

  it("a coreq in the short term before k satisfies a course in semester k; one in semester k does not satisfy the short term", () => {
    const withCoreq = course("PHYS-1112", { coreq_expr: node("MATH-1910") });
    const calc = course("MATH-1910");
    const before = computeCardStatusMap([card("m", 3, calc, true), card("p", 3, withCoreq)], [], {});
    expect(before.statusMap.p.coreq).toBe(true);
    const after = computeCardStatusMap([card("m", 3, calc), card("p", 3, withCoreq, true)], [], {});
    expect(after.statusMap.p.coreq).toBe(false);
  });

  it("semesterPrereqPools takes a ColumnRef (short term) and agrees with the engine", () => {
    const cards = [card("a", 3, intro, true), card("b", 3, next)];
    const atShort = semesterPrereqPools(cards, [], { sem: 3, shortTerm: true });
    expect(atShort.completedIds.has("CS-1110")).toBe(false);
    expect(atShort.concurrentIds.has("CS-1110")).toBe(true);
    const atSem3 = semesterPrereqPools(cards, [], 3);
    expect(atSem3.completedIds.has("CS-1110")).toBe(true);
  });
});

// ── Card status: credits ───────────────────────────────────────────────────

describe("computeCardStatusMap — short-term credits are their own column's", () => {
  it("a short term's credits never add into semester k's total; creditsByColumn has both", () => {
    const big = course("ENGRD-2700", { credits_min: 4, credits_max: 4 });
    const { semesterCredits, creditsByColumn } = computeCardStatusMap(
      [card("a", 3, big), card("s", 3, course("MATH-2930"), true)],
      [],
      {}
    );
    expect(semesterCredits.get(3)).toBe(4);
    expect([...semesterCredits.keys()]).toEqual([3]);
    expect(creditsByColumn.get(6)).toBe(4); // semester 3 → key 6
    expect(creditsByColumn.get(5)).toBe(3); // the summer before 3 → key 5
  });

  it("a regular board's creditsByColumn mirrors semesterCredits under key 2k", () => {
    const { semesterCredits, creditsByColumn } = computeCardStatusMap(
      [card("a", 1, course("CS-1110")), card("b", 2, course("CS-2110"))],
      [],
      {}
    );
    expect(semesterCredits.get(1)).toBe(3);
    expect(creditsByColumn.get(2)).toBe(3);
    expect(creditsByColumn.get(4)).toBe(semesterCredits.get(2));
  });

  it("no overload cap on a short term", () => {
    expect(isSemesterOverloaded(24)).toBe(true);
    expect(isSemesterOverloaded(24, false)).toBe(true);
    expect(isSemesterOverloaded(24, true)).toBe(false);
  });
});

// ── Card status: offered check (D5) ────────────────────────────────────────

describe("computeCardStatusMap — offered check on short terms is future-only", () => {
  // Entering 2025: semester 3 = Fall 2026, the short term before it = Summer
  // 2026; semester 4 = Spring 2027, the short term before it = Winter 2027.
  const fallSpring = course("CS-2110", { offered: ["FA", "SP"] });
  const summerToo = course("CS-2112", { offered: ["FA", "SU"] });

  it("future summer, course not offered in summer → offeredOk false + shortTermSeason SU", () => {
    const { statusMap } = computeCardStatusMap([card("s", 5, fallSpring, true)], [], {}, undefined, undefined, {
      enteringYear: 2025,
      enrollmentTarget: "SP27",
    });
    expect(statusMap.s.offeredOk).toBe(false);
    expect(statusMap.s.shortTermSeason).toBe("SU");
  });

  it("future summer, course offered in summer → offeredOk true", () => {
    const { statusMap } = computeCardStatusMap([card("s", 5, summerToo, true)], [], {}, undefined, undefined, {
      enteringYear: 2025,
      enrollmentTarget: "SP27",
    });
    expect(statusMap.s.offeredOk).toBe(true);
  });

  it("past short term → no offered warning (offeredOk null)", () => {
    // Summer 2026 is past while enrolling for Spring 2027.
    const { statusMap } = computeCardStatusMap([card("s", 3, fallSpring, true)], [], {}, undefined, undefined, {
      enteringYear: 2025,
      enrollmentTarget: "SP27",
    });
    expect(statusMap.s.offeredOk).toBeNull();
    expect(statusMap.s.shortTermSeason).toBe("SU");
  });

  it("the winter between the in-progress fall and the target spring is future", () => {
    // Target SP27 (enrolling during Fall 2026): Winter 2027 is still ahead.
    const { statusMap } = computeCardStatusMap([card("w", 4, fallSpring, true)], [], {}, undefined, undefined, {
      enteringYear: 2025,
      enrollmentTarget: "SP27",
    });
    expect(statusMap.w.offeredOk).toBe(false);
    expect(statusMap.w.shortTermSeason).toBe("WI");
  });

  it("unknown entering year or target → no claim on a short term", () => {
    expect(computeCardStatusMap([card("s", 5, fallSpring, true)], [], {}).statusMap.s.offeredOk).toBeNull();
    expect(
      computeCardStatusMap([card("s", 5, fallSpring, true)], [], {}, undefined, undefined, { enteringYear: 2025 })
        .statusMap.s.offeredOk
    ).toBeNull();
  });

  it("regular columns are unchanged (no shortTermSeason key, parity season)", () => {
    const fallOnly = course("CS-3110", { offered: ["FA"] });
    const { statusMap } = computeCardStatusMap([card("a", 1, fallOnly), card("b", 2, fallOnly)], [], {});
    expect(statusMap.a.offeredOk).toBe(true);
    expect(statusMap.b.offeredOk).toBe(false);
    expect("shortTermSeason" in statusMap.a).toBe(false);
  });
});

describe("statusLine — short-term offered wording", () => {
  it("offeredMessage names the short term's season", () => {
    expect(offeredMessage(["FA", "SP"], "SU")).toBe("Usually not offered in summer");
    expect(offeredMessage(["FA", "SP"], "WI")).toBe("Usually not offered in winter");
    expect(offeredMessage(["FA"])).toBe("Usually offered in Fall only");
    expect(offeredMessage(["FA"], null)).toBe("Usually offered in Fall only");
  });

  it("resolveCardStatusLine passes the season through", () => {
    const line = resolveCardStatusLine({
      blocked: false,
      unmetPrereqLeaves: [],
      offeredOk: false,
      offered: ["FA", "SP"],
      shortTermSeason: "SU",
      overlaps: [],
      conflictWith: null,
      prereqState: null,
      advisoryNotes: [],
    });
    expect(line).toEqual({ kind: "warning", text: "Usually not offered in summer" });
  });
});

// ── Derived edges ──────────────────────────────────────────────────────────

describe("deriveEdges — time order with short terms", () => {
  const intro = course("CS-1110");
  const next = course("CS-2110", { prereq_expr: node("CS-1110") });
  const pc = (placementId: string, c: Course, semester: number, shortTerm?: boolean): PlacedCourse =>
    shortTerm ? { placementId, course: c, semester, shortTerm } : { placementId, course: c, semester };

  it("a feeder in the summer before semester 3 satisfies semester 3", () => {
    const [edge] = deriveEdges([pc("a", intro, 3, true), pc("b", next, 3)]);
    expect(edge).toMatchObject({ fromPlacementId: "a", toPlacementId: "b", kind: "prereq", state: "satisfied" });
  });

  it("a feeder in semester 3 violates a course in the summer before 3", () => {
    const [edge] = deriveEdges([pc("a", intro, 3), pc("b", next, 3, true)]);
    expect(edge.state).toBe("violated");
  });

  it("a feeder in semester 2 satisfies the winter before semester 4", () => {
    const [edge] = deriveEdges([pc("a", intro, 2), pc("b", next, 4, true)]);
    expect(edge.state).toBe("satisfied");
  });
});

// ── Pending choices ─────────────────────────────────────────────────────────

describe("computePendingChoiceMap — short-term card timing", () => {
  const withCoreq = course("PHYS-1112", { coreq_expr: node("MATH-1910") });
  const choice = (suggestedSem: number): OpenChoice => ({
    id: "calc",
    label: "Calculus",
    requirement: null,
    courseIds: ["MATH-1910"],
    suggestedSem,
  });
  const run = (cards: BoardCard[], c: OpenChoice) => {
    const { statusMap } = computeCardStatusMap(cards, [], {});
    return computePendingChoiceMap(cards, [], statusMap, [c]);
  };

  it("a regular card waits on a same-semester coreq pick (unchanged)", () => {
    expect(run([card("p", 3, withCoreq)], choice(3)).p?.requirementId).toBe("calc");
  });

  it("a card in the short term before 3 does not wait on a pick suggested for semester 3 (it comes later)", () => {
    expect(run([card("p", 3, withCoreq, true)], choice(3)).p).toBeUndefined();
  });

  it("a card in the short term before 3 waits on a pick suggested for semester 2", () => {
    expect(run([card("p", 3, withCoreq, true)], choice(2)).p?.requirementId).toBe("calc");
  });
});

// ── Matching order + term slugs ─────────────────────────────────────────────

describe("buildMatchPool — time order and real short-term slugs", () => {
  const placements: Placement[] = [
    { id: "p2", courseId: "MATH-2930", sem: 2, order: 0 },
    { id: "s2", courseId: "ENGL-1100", sem: 2, order: 0, shortTerm: true },
    { id: "p1", courseId: "CS-1110", sem: 1, order: 0 },
    { id: "s3", courseId: "ECON-1110", sem: 3, order: 0, shortTerm: true },
  ];
  const placedCourses = Object.fromEntries(
    ["MATH-2930", "ENGL-1100", "CS-1110", "ECON-1110"].map((id) => [id, course(id)])
  );

  it("orders by time key and gives each short term its real roster slug", () => {
    const pool = buildMatchPool({ placements, placedCourses, creditProfile: [], enteringYear: 2023 });
    expect(pool.map((c) => [c.id, c.term])).toEqual([
      ["CS-1110", "FA23"],
      ["ENGL-1100", "WI24"],
      ["MATH-2930", "SP24"],
      ["ECON-1110", "SU24"],
    ]);
  });

  it("a course on the board twice counts at its EARLIER (short-term) placement", () => {
    const twice: Placement[] = [
      { id: "reg", courseId: "CS-1110", sem: 2, order: 0 },
      { id: "win", courseId: "CS-1110", sem: 2, order: 0, shortTerm: true },
    ];
    const pool = buildMatchPool({ placements: twice, placedCourses, creditProfile: [], enteringYear: 2023 });
    expect(pool).toHaveLength(1);
    expect(pool[0].term).toBe("WI24");
  });
});

describe("semesterTerm — column-aware roster slug", () => {
  it("regular columns unchanged; short terms get their real slug", () => {
    expect(semesterTerm(1, 2023)).toBe("FA23");
    expect(semesterTerm(2, 2023)).toBe("SP24");
    expect(semesterTerm({ sem: 3 }, 2023)).toBe("FA24");
    expect(semesterTerm({ sem: 3, shortTerm: true }, 2023)).toBe("SU24");
    expect(semesterTerm({ sem: 2, shortTerm: true }, 2023)).toBe("WI24");
    expect(semesterTerm({ sem: 1, shortTerm: true }, 2023)).toBe("SU23");
    expect(semesterTerm({ sem: 3, shortTerm: true }, null)).toBeNull();
  });
});

// ── Labels ──────────────────────────────────────────────────────────────────

describe("semesterLabel / columnLabel", () => {
  it("regular semesters read exactly as before (number or ColumnRef)", () => {
    expect(semesterLabel(1, 2025)).toEqual({ primary: "Fall 2025", yearWord: "Freshman", calendarYear: 2025, sem: 1 });
    expect(semesterLabel({ sem: 2 }, 2025)).toEqual(semesterLabel(2, 2025));
    expect(columnLabel({ sem: 2, shortTerm: false }, 2025)).toEqual(semesterLabel(2, 2025));
    expect(semesterLabel(9, null)).toEqual({ primary: "Fall", yearWord: "Year 5", calendarYear: null, sem: 9 });
  });

  it("a short term reads as its season and year, no class-year word", () => {
    expect(columnLabel({ sem: 3, shortTerm: true }, 2025)).toEqual({
      primary: "Summer 2026",
      yearWord: "",
      calendarYear: 2026,
      sem: 3,
      shortTerm: true,
    });
    expect(columnLabel({ sem: 2, shortTerm: true }, 2025).primary).toBe("Winter 2026");
    expect(semesterLabel({ sem: 2, shortTerm: true }, 2025).primary).toBe("Winter 2026");
    expect(columnLabel({ sem: 1, shortTerm: true }, null)).toMatchObject({ primary: "Summer", calendarYear: null });
  });
});

// ── Horizon ─────────────────────────────────────────────────────────────────

describe("horizon — short terms", () => {
  it("semesterTermYear of a short term", () => {
    expect(semesterTermYear({ sem: 3, shortTerm: true }, 2025)).toEqual({ term: "SU", year: 2026 });
    expect(semesterTermYear({ sem: 4, shortTerm: true }, 2025)).toEqual({ term: "WI", year: 2027 });
    expect(semesterTermYear(4, 2025)).toEqual({ term: "SP", year: 2027 });
  });

  it("a short term is never near; past/far by the in-progress semester boundary", () => {
    // Entering 2025, target SP27 (enrolling during Fall 2026 = sem 3).
    expect(horizonForSemester(4, 2025, "SP27")).toBe("near");
    expect(horizonForSemester({ sem: 4, shortTerm: true }, 2025, "SP27")).toBe("far"); // Winter 2027
    expect(horizonForSemester({ sem: 3, shortTerm: true }, 2025, "SP27")).toBe("past"); // Summer 2026
    expect(horizonForSemester({ sem: 5, shortTerm: true }, 2025, "SP27")).toBe("far"); // Summer 2027
    // Target FA27 (enrolling during Spring 2027 = sem 4).
    expect(horizonForSemester({ sem: 4, shortTerm: true }, 2025, "FA27")).toBe("past"); // Winter 2027
    expect(horizonForSemester({ sem: 5, shortTerm: true }, 2025, "FA27")).toBe("far"); // Summer 2027
    // A short-term target slug: the short term itself is still never near.
    expect(horizonForSemester({ sem: 5, shortTerm: true }, 2025, "SU27")).toBe("far");
    // Unknown → far, as for every column.
    expect(horizonForSemester({ sem: 3, shortTerm: true }, null, "SP27")).toBe("far");
    expect(horizonForSemester({ sem: 3, shortTerm: true }, 2025, null)).toBe("far");
  });

  it("shortTermIsFuture: true / false / null when unknown", () => {
    expect(shortTermIsFuture(4, 2025, "SP27")).toBe(true);
    expect(shortTermIsFuture(3, 2025, "SP27")).toBe(false);
    expect(shortTermIsFuture(3, null, "SP27")).toBeNull();
    expect(shortTermIsFuture(3, 2025, undefined)).toBeNull();
    expect(shortTermIsFuture(3, 2025, "garbage")).toBeNull();
  });

  it("a spring entrant needs nothing special: the gap before their first column is a Winter", () => {
    // Entered Spring 2026 → enteringYear 2025, first column sem 2 (Spring 2026).
    expect(columnLabel({ sem: 2, shortTerm: true }, 2025).primary).toBe("Winter 2026");
    expect(semesterTerm({ sem: 2, shortTerm: true }, 2025)).toBe("WI26");
    // Enrolling for SP26 during Fall 2025: Winter 2026 is still ahead.
    expect(horizonForSemester({ sem: 2, shortTerm: true }, 2025, "SP26")).toBe("far");
    expect(horizonForSemester(2, 2025, "SP26")).toBe("near");
  });

  it("targetHighlightSem never picks a short-term column", () => {
    const cols = [{ sem: 4, shortTerm: true }, { sem: 4 }, 5];
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2025, cols)).toBe(4);
    expect(targetHighlightSem({ roster: "SP27" }, "SP27", 2025, [{ sem: 4, shortTerm: true }])).toBeNull();
  });
});

// ── "Last time" line ────────────────────────────────────────────────────────

describe("reviews — last-time season for short terms", () => {
  it("a future short term reads its own season; past / unknown → null", () => {
    expect(lastTimeSeason({ sem: 5, shortTerm: true }, 2025, "SP27")).toBe("SU");
    expect(lastTimeSeason({ sem: 4, shortTerm: true }, 2025, "SP27")).toBe("WI");
    expect(lastTimeSeason({ sem: 3, shortTerm: true }, 2025, "SP27")).toBeNull();
    expect(lastTimeSeason(5, 2025, "SP27")).toBe("FA");
    expect(lastTimeSeason(6, 2025, "SP27")).toBe("SP");
  });

  it("the line says 'Last summer' and finds a summer roster term", () => {
    const history = {
      courseId: "CS-2110",
      terms: [
        { roster: "SU25", instructors: [{ netid: "ab1", name: "Ada Lovelace" }] },
        { roster: "FA25", instructors: [{ netid: "cd2", name: "Charles Babbage" }] },
      ],
    };
    const entry = lastSameSeasonEntry(history as never, "SU");
    expect(entry?.roster).toBe("SU25");
    expect(lastTimeLine("SU", entry!, null, "SP27")).toBe("Last summer (Summer 2025): Ada Lovelace");
  });
});

// ── Tried classes ───────────────────────────────────────────────────────────

describe("computeTriedProgress — virtual placements after every column", () => {
  it("a short term before the last semester never puts the virtual placement inside the board", () => {
    let solvedWith: Placement[] = [];
    const base: RequirementProgress = { groups: [], attribution: {}, satisfiedCount: 0, total: 0 } as never;
    computeTriedProgress({
      triedCourseIds: ["MATH-1920"],
      placements: [
        { id: "a", courseId: "CS-1110", sem: 2, order: 0 },
        { id: "b", courseId: "CS-2110", sem: 3, order: 0, shortTerm: true },
      ],
      placedCourses: {},
      base,
      lookup: (id) => course(id),
      solve: (placements) => {
        solvedWith = placements;
        return base;
      },
    });
    const virtual = solvedWith.find((p) => p.courseId === "MATH-1920")!;
    expect(virtual.sem).toBe(4);
    expect("shortTerm" in virtual).toBe(false);
  });
});

// ── Plan copy across majors ─────────────────────────────────────────────────

describe("seedPlanFromPrevious — short terms travel", () => {
  const remap = (id: string) => {
    const [subject, number] = id.split("-");
    return { id, subject, number };
  };

  it("placements keep shortTerm and the shortTerms list carries (plus any used column)", () => {
    const seed = seedPlanFromPrevious(
      {
        placements: [
          { id: "a", courseId: "CS-1110", sem: 1, order: 0 },
          { id: "b", courseId: "MATH-1920", sem: 3, order: 0, shortTerm: true },
        ],
        placedCourses: { "CS-1110": remap("CS-1110"), "MATH-1920": remap("MATH-1920") },
        completedIds: [],
        inProgressIds: [],
        shortTerms: [6, 1],
      },
      []
    )!;
    expect(seed.placements.find((p) => p.id === "b")).toEqual({
      id: "b",
      courseId: "MATH-1920",
      sem: 3,
      order: 0,
      shortTerm: true,
    });
    expect("shortTerm" in seed.placements.find((p) => p.id === "a")!).toBe(false);
    expect(seed.shortTerms).toEqual([1, 3, 6]);
  });

  it("a plan without short terms seeds shortTerms []", () => {
    const seed = seedPlanFromPrevious(
      {
        placements: [{ id: "a", courseId: "CS-1110", sem: 1, order: 0 }],
        placedCourses: { "CS-1110": remap("CS-1110") },
        completedIds: [],
        inProgressIds: [],
      },
      []
    )!;
    expect(seed.shortTerms).toEqual([]);
  });

  it("a plan whose only content is added (empty) short terms still carries them", () => {
    const seed = seedPlanFromPrevious(
      { placements: [], placedCourses: {}, completedIds: [], inProgressIds: [], shortTerms: [1, 4] },
      []
    );
    expect(seed?.shortTerms).toEqual([1, 4]);
  });

  it("carryShortTerms sanitizes and merges", () => {
    expect(carryShortTerms(undefined, [])).toEqual([]);
    expect(carryShortTerms([4, 4, 0, 11, 2.5, 2], [{ sem: 7, shortTerm: true }, { sem: 5 }])).toEqual([2, 4, 7]);
  });

  it("coursesLeftBehind lists courses in time order (short term before its semester)", () => {
    const left = coursesLeftBehind(
      {
        placements: [
          { id: "a", courseId: "CS-2110", sem: 3, order: 0 },
          { id: "b", courseId: "MATH-1920", sem: 3, order: 0, shortTerm: true },
        ],
      },
      { placements: [] }
    );
    expect(left).toEqual(["MATH-1920", "CS-2110"]);
  });
});
