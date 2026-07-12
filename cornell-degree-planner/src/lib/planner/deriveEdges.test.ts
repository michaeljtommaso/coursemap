import { describe, it, expect } from "vitest";
import { deriveEdges, type Placement } from "./deriveEdges";
import type { Course, PrereqExpr } from "@/types/db";

// ── Tree builders (mirrors satisfies.test.ts) ────────────────────────────────
const course = (id: string): PrereqExpr => ({ type: "course", id });
const pattern = (p: string): PrereqExpr => ({ type: "pattern", pattern: p });
const concurrent = (id: string): PrereqExpr => ({ type: "concurrent", id });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });
const advisory = (expr: PrereqExpr, note = "or equivalent AP credit"): PrereqExpr => ({
  type: "advisory",
  expr,
  note,
});

// ── Course/placement fixtures ────────────────────────────────────────────────
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

function place(slotId: string, course: Course, semester: number): Placement {
  return { slotId, course, semester };
}

describe("deriveEdges — course-leaf prereq", () => {
  it("single satisfied edge — feeder strictly earlier", () => {
    const feeder = makeCourse("CS-1110", "CS", "1110");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: course("CS-1110"),
    });
    const edges = deriveEdges([place("s1", feeder, 1), place("s2", dependent, 2)]);
    expect(edges).toEqual([
      {
        fromSlotId: "s1",
        toSlotId: "s2",
        fromCourseId: "CS-1110",
        toCourseId: "CS-2110",
        kind: "prereq",
        state: "satisfied",
      },
    ]);
  });

  it("violated — feeder placed in the SAME semester as a hard prereq", () => {
    const feeder = makeCourse("CS-1110", "CS", "1110");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: course("CS-1110"),
    });
    const edges = deriveEdges([place("s1", feeder, 2), place("s2", dependent, 2)]);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).toBe("violated");
    expect(edges[0].kind).toBe("prereq");
  });

  it("violated — feeder placed in a LATER semester", () => {
    const feeder = makeCourse("CS-1110", "CS", "1110");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: course("CS-1110"),
    });
    const edges = deriveEdges([place("s1", feeder, 3), place("s2", dependent, 2)]);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).toBe("violated");
  });
});

describe("deriveEdges — concurrent leaf", () => {
  it("same semester → satisfied, kind concurrent", () => {
    const feeder = makeCourse("MATH-1920", "MATH", "1920");
    const dependent = makeCourse("PHYS-2213", "PHYS", "2213", {
      prereq_expr: concurrent("MATH-1920"),
    });
    const edges = deriveEdges([place("s1", feeder, 2), place("s2", dependent, 2)]);
    expect(edges).toEqual([
      {
        fromSlotId: "s1",
        toSlotId: "s2",
        fromCourseId: "MATH-1920",
        toCourseId: "PHYS-2213",
        kind: "concurrent",
        state: "satisfied",
      },
    ]);
  });

  it("later semester → violated", () => {
    const feeder = makeCourse("MATH-1920", "MATH", "1920");
    const dependent = makeCourse("PHYS-2213", "PHYS", "2213", {
      prereq_expr: concurrent("MATH-1920"),
    });
    const edges = deriveEdges([place("s1", feeder, 3), place("s2", dependent, 2)]);
    expect(edges[0].state).toBe("violated");
  });
});

describe("deriveEdges — OR resolution against the plan", () => {
  it("one branch placed → one edge", () => {
    const a = makeCourse("CS-1110", "CS", "1110");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: or(course("CS-1110"), course("CS-1112")),
    });
    const edges = deriveEdges([place("s1", a, 1), place("s2", dependent, 2)]);
    expect(edges).toHaveLength(1);
    expect(edges[0].fromCourseId).toBe("CS-1110");
  });

  it("both branches placed → two edges", () => {
    const a = makeCourse("CS-1110", "CS", "1110");
    const b = makeCourse("CS-1112", "CS", "1112");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: or(course("CS-1110"), course("CS-1112")),
    });
    const edges = deriveEdges([
      place("s1", a, 1),
      place("s2", b, 1),
      place("s3", dependent, 2),
    ]);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((e) => e.fromCourseId))).toEqual(
      new Set(["CS-1110", "CS-1112"])
    );
  });

  it("neither branch placed → no edges", () => {
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: or(course("CS-1110"), course("CS-1112")),
    });
    const edges = deriveEdges([place("s1", dependent, 2)]);
    expect(edges).toEqual([]);
  });
});

describe("deriveEdges — pattern leaf", () => {
  it("matches two placed courses → two edges", () => {
    const a = makeCourse("CS-4410", "CS", "4410");
    const b = makeCourse("CS-4820", "CS", "4820");
    const dependent = makeCourse("CS-4999", "CS", "4999", {
      prereq_expr: pattern("CS-4xxx"),
    });
    const edges = deriveEdges([
      place("s1", a, 3),
      place("s2", b, 4),
      place("s3", dependent, 6),
    ]);
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.kind).toBe("prereq");
      expect(e.state).toBe("satisfied");
    }
    expect(new Set(edges.map((e) => e.fromCourseId))).toEqual(
      new Set(["CS-4410", "CS-4820"])
    );
  });

  it("pattern leaf never self-matches the dependent's own slot", () => {
    // CS-4410 "requires" CS-4xxx (contrived) — it must not wire to itself.
    const dependent = makeCourse("CS-4410", "CS", "4410", {
      prereq_expr: pattern("CS-4xxx"),
    });
    const edges = deriveEdges([place("s1", dependent, 3)]);
    expect(edges).toEqual([]);
  });
});

describe("deriveEdges — advisory", () => {
  it("advisory-wrapped course placed → advisory edge", () => {
    const feeder = makeCourse("MATH-1910", "MATH", "1910");
    const dependent = makeCourse("MATH-2940", "MATH", "2940", {
      prereq_expr: advisory(course("MATH-1910"), "or equivalent AP credit"),
    });
    const edges = deriveEdges([place("s1", feeder, 1), place("s2", dependent, 2)]);
    expect(edges).toEqual([
      {
        fromSlotId: "s1",
        toSlotId: "s2",
        fromCourseId: "MATH-1910",
        toCourseId: "MATH-2940",
        kind: "advisory",
        state: "satisfied",
      },
    ]);
  });

  it("advisory whose inner course is NOT placed emits nothing", () => {
    const dependent = makeCourse("MATH-2940", "MATH", "2940", {
      prereq_expr: advisory(course("MATH-1910"), "or equivalent AP credit"),
    });
    const edges = deriveEdges([place("s1", dependent, 2)]);
    expect(edges).toEqual([]);
  });

  it("advisory still reports violated when the feeder is placed too late", () => {
    const feeder = makeCourse("MATH-1910", "MATH", "1910");
    const dependent = makeCourse("MATH-2940", "MATH", "2940", {
      prereq_expr: advisory(course("MATH-1910")),
    });
    const edges = deriveEdges([place("s1", feeder, 3), place("s2", dependent, 2)]);
    expect(edges[0].kind).toBe("advisory");
    expect(edges[0].state).toBe("violated");
  });
});

describe("deriveEdges — coreq tree", () => {
  it("a plain course leaf inside coreq_expr becomes a concurrent edge", () => {
    const feeder = makeCourse("CHEM-2080", "CHEM", "2080");
    const dependent = makeCourse("CHEM-2081", "CHEM", "2081", {
      coreq_expr: course("CHEM-2080"),
    });
    const edges = deriveEdges([place("s1", feeder, 2), place("s2", dependent, 2)]);
    expect(edges).toEqual([
      {
        fromSlotId: "s1",
        toSlotId: "s2",
        fromCourseId: "CHEM-2080",
        toCourseId: "CHEM-2081",
        kind: "concurrent",
        state: "satisfied",
      },
    ]);
  });

  it("coreq leaf violated when feeder is placed later", () => {
    const feeder = makeCourse("CHEM-2080", "CHEM", "2080");
    const dependent = makeCourse("CHEM-2081", "CHEM", "2081", {
      coreq_expr: course("CHEM-2080"),
    });
    const edges = deriveEdges([place("s1", feeder, 3), place("s2", dependent, 2)]);
    expect(edges[0].state).toBe("violated");
  });

  it("prereq and coreq trees on the same course both emit edges", () => {
    const prereqFeeder = makeCourse("CS-2110", "CS", "2110");
    const coreqFeeder = makeCourse("CS-2800", "CS", "2800");
    const dependent = makeCourse("CS-3110", "CS", "3110", {
      prereq_expr: course("CS-2110"),
      coreq_expr: course("CS-2800"),
    });
    const edges = deriveEdges([
      place("s1", prereqFeeder, 1),
      place("s2", coreqFeeder, 2),
      place("s3", dependent, 2),
    ]);
    expect(edges).toHaveLength(2);
    const byKind = new Map(edges.map((e) => [e.kind, e]));
    expect(byKind.get("prereq")?.fromCourseId).toBe("CS-2110");
    expect(byKind.get("concurrent")?.fromCourseId).toBe("CS-2800");
  });
});

describe("deriveEdges — course placed twice / no self-edges", () => {
  it("two feeder instances of the same course both wire in", () => {
    const feederA = makeCourse("CS-1110", "CS", "1110");
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: course("CS-1110"),
    });
    const edges = deriveEdges([
      place("s1", feederA, 1),
      place("s2", { ...feederA }, 1), // same course id, second slot
      place("s3", dependent, 2),
    ]);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((e) => e.fromSlotId))).toEqual(new Set(["s1", "s2"]));
    expect(edges.every((e) => e.toSlotId === "s3")).toBe(true);
  });

  it("a course whose own (malformed) tree references its own id never self-wires, but a SECOND slot of the same course still does", () => {
    const selfReferential = makeCourse("CS-1110", "CS", "1110", {
      prereq_expr: course("CS-1110"),
    });
    const edges = deriveEdges([
      place("s1", selfReferential, 1),
      place("s2", { ...selfReferential }, 2),
    ]);
    // s1 must never edge to itself; s2 (a different slot, same course id) is a
    // legitimate feeder into s1, and vice versa (both are "dependents" here) —
    // the direction that's strictly earlier reads satisfied, the other violated.
    expect(edges.some((e) => e.fromSlotId === e.toSlotId)).toBe(false);
    expect(edges).toEqual([
      {
        fromSlotId: "s2",
        toSlotId: "s1",
        fromCourseId: "CS-1110",
        toCourseId: "CS-1110",
        kind: "prereq",
        state: "violated", // s2 (sem 2) is NOT strictly earlier than s1 (sem 1)
      },
      {
        fromSlotId: "s1",
        toSlotId: "s2",
        fromCourseId: "CS-1110",
        toCourseId: "CS-1110",
        kind: "prereq",
        state: "satisfied", // s1 (sem 1) IS strictly earlier than s2 (sem 2)
      },
    ]);
  });
});

describe("deriveEdges — malformed / cyclic trees never hang", () => {
  it("and/or node with null-ish children is treated as empty, no crash", () => {
    const dependent = makeCourse("CS-2110", "CS", "2110", {
      // @ts-expect-error deliberately malformed fixture
      prereq_expr: { type: "and", children: null },
    });
    expect(() => deriveEdges([place("s1", dependent, 2)])).not.toThrow();
    expect(deriveEdges([place("s1", dependent, 2)])).toEqual([]);
  });

  it("a genuinely cyclic tree (object self-reference) does not hang", () => {
    const cyclic: PrereqExpr & { children: PrereqExpr[] } = {
      type: "and",
      children: [],
    };
    cyclic.children.push(cyclic); // circular reference
    const dependent = makeCourse("CS-2110", "CS", "2110", { prereq_expr: cyclic });
    const start = Date.now();
    expect(() => deriveEdges([place("s1", dependent, 2)])).not.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("deep cycle through or/advisory nesting does not hang", () => {
    const feeder = makeCourse("CS-1110", "CS", "1110");
    const orNode: PrereqExpr & { children: PrereqExpr[] } = { type: "or", children: [] };
    const advisoryNode: PrereqExpr = { type: "advisory", expr: orNode, note: "n" };
    orNode.children.push(course("CS-1110"), advisoryNode); // advisory -> or -> advisory cycle
    const dependent = makeCourse("CS-2110", "CS", "2110", { prereq_expr: orNode });
    expect(() =>
      deriveEdges([place("s1", feeder, 1), place("s2", dependent, 2)])
    ).not.toThrow();
  });
});

describe("deriveEdges — determinism", () => {
  it("sorts by toSlotId, then fromSlotId, then kind", () => {
    const a = makeCourse("CS-1110", "CS", "1110");
    const b = makeCourse("CS-1112", "CS", "1112");
    const dep1 = makeCourse("CS-2110", "CS", "2110", {
      prereq_expr: or(course("CS-1110"), course("CS-1112")),
    });
    const dep2 = makeCourse("CS-2112", "CS", "2112", { prereq_expr: course("CS-1110") });

    const placements = [
      place("zzz-dep1", dep1, 3),
      place("aaa-dep2", dep2, 3),
      place("m-a", a, 1),
      place("m-b", b, 1),
    ];

    const edges1 = deriveEdges(placements);
    const edges2 = deriveEdges([...placements].reverse());
    expect(edges1).toEqual(edges2);

    // toSlotId strictly non-decreasing across the output.
    for (let i = 1; i < edges1.length; i++) {
      expect(edges1[i].toSlotId >= edges1[i - 1].toSlotId).toBe(true);
    }
  });

  it("empty plan → empty edges", () => {
    expect(deriveEdges([])).toEqual([]);
  });
});
