import { describe, it, expect } from "vitest";
import type { MinorIndexEntry } from "@/lib/schemas";
import type { MatchCourse } from "./majorMatch";
import type { OverlapProgram } from "./distribution/overlap";
import type { Layer, LayerSharing, Row } from "./distribution/types";
import {
  closeMinors,
  minorCandidates,
  minorStanding,
  rankMinor,
  rankMinors,
  sortMinorMatches,
  type MinorMatch,
  type MinorRankInput,
} from "./rankMinors";

// Spec 047 D11. Every program id below is fictional.

const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };
const PRIMARY = "test-cas-econ";

function mc(id: string, credits = 3): MatchCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits };
}

function entry(id: string, over: Partial<MinorIndexEntry> = {}): MinorIndexEntry {
  return { id, name: `Minor ${id}`, shortName: id, offeredBy: "Arts & Sciences", catalogYear: "2026-27", ...over };
}

function minor(id: string, rows: Row[], sharing?: LayerSharing): Layer {
  return {
    id,
    kind: "minor",
    family: "other",
    name: `Minor ${id}`,
    catalogYear: "2026-27",
    programId: id,
    ...(sharing ? { sharing } : {}),
    rows,
  };
}

const seat = (id: string, course: string, over: Partial<Row> = {}): Row =>
  ({ id, kind: "seat", label: id, group: "Core", source: SRC, rule: { course: [course] }, ...over }) as Row;

const pool = (id: string, subject: string, requiredCourses: number, requiredCredits: number, over: Partial<Row> = {}): Row =>
  ({
    id,
    kind: "pool",
    label: id,
    group: "Electives",
    source: SRC,
    rule: { subject: [subject] },
    requiredCourses,
    requiredCredits,
    ...over,
  }) as Row;

const primaryProgram = (sharing?: LayerSharing, forbiddenWith?: string[]): OverlapProgram => ({
  id: PRIMARY,
  kind: "major",
  layerIds: [PRIMARY],
  ...(sharing ? { sharing } : {}),
  ...(forbiddenWith ? { forbiddenWith } : {}),
  holdable: true,
});

function input(pool: MatchCourse[], over: Partial<MinorRankInput> = {}): MinorRankInput {
  return {
    pool,
    canonical: (id) => id,
    plan: { primaryId: PRIMARY, additional: [] },
    planPrograms: [primaryProgram()],
    planKnown: true,
    ...over,
  };
}

const rank = (layer: Layer, courses: MatchCourse[], over: Partial<MinorRankInput> = {}) =>
  rankMinor(entry(layer.id), layer, input(courses, over));

describe("rankMinor: classes away (proven counts)", () => {
  it("adds 1 per unmet seat and the courses short on a pool", () => {
    const layer = minor("test-minor-a", [
      seat("intro", "STAT-2000"),
      seat("prog", "CS-1110"),
      pool("electives", "STAT", 3, 9),
    ]);
    // STAT-2000 fills the seat; STAT-3000 one of the three electives.
    const m = rank(layer, [mc("STAT-2000"), mc("STAT-3000")])!;
    expect(m.classesAway).toBe(1 + 2);
    expect(m.inexact).toBeUndefined();
    expect(m.requirementsLeft).toBe(2);
    expect(minorStanding(m)).toBe("3 classes away");
  });

  it("a minor already met is 0 classes away", () => {
    const layer = minor("test-minor-b", [seat("intro", "STAT-2000")]);
    const m = rank(layer, [mc("STAT-2000")])!;
    expect(m.classesAway).toBe(0);
    expect(minorStanding(m)).toBe("Requirements met");
  });

  it("anyOf takes its cheapest option and skips options that don't apply to the student", () => {
    const layer = minor("test-minor-c", [
      {
        id: "path",
        kind: "anyOf",
        label: "One path",
        group: "Core",
        source: SRC,
        rows: [
          // Only for transfers: never this student's path.
          { ...(seat("transfer", "CS-1000") as object), appliesTo: [{ transfer: ["external"] }] },
          pool("three-stat", "STAT", 3, 9),
          pool("four-cs", "CS", 4, 12),
        ],
      } as Row,
    ]);
    const m = rank(layer, [mc("STAT-3000")], { ctx: { transfer: "none" } })!;
    expect(m.classesAway).toBe(2);
  });

  it("a distribution row needs the larger of its courses short and its categories short", () => {
    const layer = minor("test-minor-d", [
      {
        id: "breadth",
        kind: "distribution",
        label: "Breadth",
        group: "Breadth",
        source: SRC,
        categories: [
          { id: "a", label: "A", rule: { subject: ["AAA"] } },
          { id: "b", label: "B", rule: { subject: ["BBB"] } },
          { id: "c", label: "C", rule: { subject: ["CCC"] } },
        ],
        requiredCourses: 3,
        minDistinctCategories: 3,
      } as Row,
    ]);
    const m = rank(layer, [mc("AAA-1000")])!;
    expect(m.classesAway).toBe(2);
  });
});

describe("rankMinor: fails closed to the percent", () => {
  it("an unmet credit-total row", () => {
    const layer = minor("test-minor-e", [
      seat("intro", "STAT-2000"),
      { id: "total", kind: "credits", label: "15 credits", group: "Total", source: SRC, rule: { subject: ["STAT"] }, requiredCredits: 15 } as Row,
    ]);
    const m = rank(layer, [mc("STAT-2000")])!;
    expect(m.classesAway).toBeNull();
    expect(m.inexact).toContain("credits");
    expect(m.pct).toBeGreaterThan(0);
    expect(minorStanding(m)).toBe(`${m.pct}% done`);
  });

  it("a pool short on credits beyond what its missing courses cover", () => {
    const layer = minor("test-minor-f", [pool("electives", "STAT", 2, 12)]);
    // One 3-credit course: 1 course and 9 credits short.
    const m = rank(layer, [mc("STAT-3000")])!;
    expect(m.classesAway).toBeNull();
    expect(m.inexact).toContain("credits");
  });

  it("a pool with a minimum sub-limit", () => {
    const layer = minor("test-minor-g", [
      pool("electives", "STAT", 3, 9, { limits: [{ rule: { number: { min: 4000 } }, minCourses: 2 }] } as Partial<Row>),
    ]);
    const m = rank(layer, [mc("STAT-3000")])!;
    expect(m.classesAway).toBeNull();
    expect(m.inexact).toContain("limits");
  });

  it("an overlay row", () => {
    const layer = minor("test-minor-h", [seat("intro", "STAT-2000"), seat("writing", "ENGL-2000", { overlay: true })]);
    const m = rank(layer, [mc("STAT-2000")])!;
    expect(m.classesAway).toBeNull();
    expect(m.inexact).toContain("overlay");
  });

  it("an overlap limit the counted courses could break; within it, the count stands", () => {
    const rows = [seat("intro", "STAT-2000"), seat("prog", "CS-1110"), seat("ml", "CS-3780")];
    const capped = minor("test-minor-i", rows, { otherMajors: { maxCourses: 1 } });
    const two = rank(capped, [mc("STAT-2000"), mc("CS-1110")])!;
    expect(two.classesAway).toBeNull();
    expect(two.inexact).toContain("overlap");
    const one = rank(capped, [mc("STAT-2000")])!;
    expect(one.classesAway).toBe(2);

    // The major's own "no sharing with a minor" binds the same way.
    const free = minor("test-minor-j", rows);
    const none = rank(free, [mc("STAT-2000")], { planPrograms: [primaryProgram({ minors: "none" })] })!;
    expect(none.classesAway).toBeNull();
    expect(none.inexact).toContain("overlap");
  });

  it("a counted course the student marked as used for another layer's row", () => {
    const layer = minor("test-minor-k", [seat("intro", "STAT-2000"), seat("prog", "CS-1110")]);
    const answers = { marks: { "usedAs:cas-college/fws@STAT-2000": "yes" as const }, facts: {} };
    const m = rank(layer, [mc("STAT-2000")], { answers })!;
    expect(m.classesAway).toBeNull();
    expect(m.inexact).toContain("used-elsewhere");
  });

  it("a plan program whose sharing isn't known, and a minor with nothing countable", () => {
    const layer = minor("test-minor-l", [seat("intro", "STAT-2000")]);
    expect(rank(layer, [], { planKnown: false })!.classesAway).toBeNull();
    const confirmOnly = minor("test-minor-m", [
      { id: "advisor", kind: "confirm", label: "Advisor sign-off", group: "Core", source: SRC } as Row,
    ]);
    expect(rank(confirmOnly, [])!.inexact).toContain("nothing-countable");
  });
});

describe("minorCandidates / forbiddenWith", () => {
  const entries = [
    entry("test-minor-ok"),
    entry("test-minor-hidden", { visible: false }),
    entry("test-minor-on-plan"),
    entry("test-minor-not-econ", { notOpenTo: ["test-cas-econ"] }),
    entry("test-minor-not-math", { notOpenTo: ["test-cas-math"] }),
    entry("test-minor-forbidden"),
  ];

  it("leaves out hidden minors, minors on the plan, notOpenTo either major, and forbiddenWith a plan program", () => {
    const plan = {
      primaryId: "test-cas-econ-2026",
      additional: [
        { programId: "test-cas-math", kind: "major" as const },
        { programId: "test-minor-on-plan", kind: "minor" as const },
      ],
    };
    const ids = minorCandidates(entries, plan, [
      { ...primaryProgram(), id: "test-cas-econ-2026", forbiddenWith: ["test-minor-forbidden"] },
    ]).map((e) => e.id);
    expect(ids).toEqual(["test-minor-ok"]);
  });

  it("leaves out an onlyOpenTo minor unless the primary or the second major opens it", () => {
    const only = [
      entry("test-minor-only-math", { onlyOpenTo: ["test-cas-math"] }),
      entry("test-minor-only-govt", { onlyOpenTo: ["test-cas-govt"] }),
    ];
    const ids = (primaryId: string, additional: { programId: string; kind: "major" | "minor" }[] = []) =>
      minorCandidates(only, { primaryId, additional }).map((e) => e.id);
    expect(ids("test-cas-econ-2026")).toEqual([]);
    expect(ids("test-cas-math-2026")).toEqual(["test-minor-only-math"]);
    expect(ids("test-cas-econ-2026", [{ programId: "test-cas-govt", kind: "major" }])).toEqual(["test-minor-only-govt"]);
  });

  it("a minor whose own forbiddenWith names a plan program isn't ranked", () => {
    const layer = minor("test-minor-n", [seat("intro", "STAT-2000")], { forbiddenWith: [PRIMARY] });
    expect(rank(layer, [mc("STAT-2000")])).toBeNull();
  });

  it("rankMinors ranks only loaded candidates, sorted", () => {
    const near = minor("test-minor-near", [seat("a", "STAT-2000"), seat("b", "STAT-2100")]);
    const far = minor("test-minor-far", [seat("a", "CS-1110"), seat("b", "CS-2110"), seat("c", "CS-3110")]);
    const layers = new Map([near, far].map((l) => [l.id, l]));
    const out = rankMinors({
      ...input([mc("STAT-2000")]),
      entries: [entry("test-minor-far"), entry("test-minor-near"), entry("test-minor-unloaded")],
      layerOf: (id) => layers.get(id),
    });
    expect(out.map((m) => [m.entry.id, m.classesAway])).toEqual([
      ["test-minor-near", 1],
      ["test-minor-far", 3],
    ]);
  });
});

describe("ordering and the panel's top two", () => {
  const m = (id: string, classesAway: number | null, pct: number): MinorMatch => ({
    entry: entry(id),
    pct,
    classesAway,
    requirementsLeft: 1,
  });

  it("proven counts first (fewest first), then the rest by percent, ties by name", () => {
    const sorted = sortMinorMatches([m("e", null, 90), m("d", 3, 10), m("c", 1, 20), m("b", null, 40), m("a", 1, 20)]);
    expect(sorted.map((x) => x.entry.id)).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("close = a proven count of at most 3; a percent is never close", () => {
    const sorted = sortMinorMatches([m("a", 2, 50), m("b", 4, 70), m("c", null, 99), m("d", 3, 30), m("e", 0, 100)]);
    expect(closeMinors(sorted).map((x) => x.entry.id)).toEqual(["e", "a"]);
    expect(closeMinors(sortMinorMatches([m("b", 4, 70), m("c", null, 99)]))).toEqual([]);
  });

  it("standing wording", () => {
    expect(minorStanding({ classesAway: 1, pct: 80 })).toBe("1 class away");
    expect(minorStanding({ classesAway: null, pct: 42 })).toBe("42% done");
  });
});
