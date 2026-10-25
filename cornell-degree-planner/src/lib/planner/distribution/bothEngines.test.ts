import { describe, it, expect } from "vitest";
import { assign, type MatchCourse, type SeatRequirement } from "../majorMatch";
import { solve } from "./index";
import type { CourseRule, Layer, SeatRow } from "./types";
import type { Requirement } from "../satisfies";

/**
 * Drift guard (spec 019 D3): for plain one-course seats — exact course,
 * pattern, attribute — the Engineering engine and the Distribution engine must
 * fill exactly the same seats from the same board. Each case is solved by both;
 * the sets of satisfied requirement ids must match.
 */

const SRC = { url: "https://catalog.cornell.edu/", anchor: "test" };

function seatToRule(req: Requirement): CourseRule {
  switch (req.kind) {
    case "course":
      return { course: [req.courseId] };
    case "pattern":
      return { pattern: req.pattern };
    case "attribute":
      return {
        anyOf: req.match.anyOf.map((p) =>
          p.field === "title" ? { titleStartsWith: p.value } : { tag: p.value }
        ),
      };
  }
}

const c = (id: string, attrs: string[] = [], title = "Course"): MatchCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, credits: 3, attrs: attrs.map((value) => ({ value })) };
};

type Case = { name: string; courses: MatchCourse[]; seats: [string, Requirement][] };

const CASES: Case[] = [
  {
    name: "exact courses",
    courses: [c("MATH-1910"), c("MATH-1920")],
    seats: [
      ["m1", { kind: "course", courseId: "MATH-1910" }],
      ["m2", { kind: "course", courseId: "MATH-2930" }],
    ],
  },
  {
    name: "pattern vs exact — the only-candidate case",
    courses: [c("CS-2110"), c("CS-3110")],
    seats: [
      ["any-cs", { kind: "pattern", pattern: "CS xxxx" }],
      ["cs2110", { kind: "course", courseId: "CS-2110" }],
    ],
  },
  {
    name: "attribute seats, two FWS",
    courses: [c("ENGL-1170", [], "FWS: Short Stories"), c("HIST-1200", [], "FWS: Empires"), c("ENGL-2800")],
    seats: [
      ["fws1", { kind: "attribute", match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } }],
      ["fws2", { kind: "attribute", match: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] } }],
    ],
  },
  {
    name: "tag seats competing for one multi-tagged course",
    courses: [c("HIST-1530", ["HST-AS", "SCD-AS"]), c("ARTH-1100", ["ALC-AS"])],
    seats: [
      ["hst", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["HST-AS"] }] } }],
      ["scd", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["SCD-AS"] }] } }],
      ["alc", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["ALC-AS"] }] } }],
    ],
  },
  {
    name: "chain of three augmenting choices",
    courses: [c("PHYS-1112", ["PHS-AS"]), c("CHEM-2090", ["PHS-AS", "SMR-AS"]), c("MATH-1110", ["SMR-AS", "SDS-AS"])],
    seats: [
      ["phs", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["PHS-AS"] }] } }],
      ["smr", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["SMR-AS"] }] } }],
      ["sds", { kind: "attribute", match: { anyOf: [{ field: "attrs.value", op: "in", value: ["SDS-AS"] }] } }],
    ],
  },
];

describe("both engines agree on plain seats (spec 019 D3 drift guard)", () => {
  for (const tc of CASES) {
    it(tc.name, () => {
      const reqs: SeatRequirement[] = tc.seats.map(([id, req]) => ({ id, kind: "seat", req, credits: 3, label: id }));
      const eng = assign(tc.courses, reqs);
      const missing = new Set(eng.missing.map((m) => m.requirementId));
      const engMet = reqs.map((r) => r.id).filter((id) => !missing.has(id));

      const rows: SeatRow[] = tc.seats.map(([id, req]) => ({
        id,
        kind: "seat",
        label: id,
        group: "Test",
        source: SRC,
        rule: seatToRule(req),
      }));
      const layer: Layer = { id: "t", kind: "major", family: "cas", name: "T", catalogYear: "2026-27", programId: "p", rows };
      const dist = solve({ layers: [layer], courses: tc.courses, ctx: { programId: "p" } });
      const distMet = dist.layers[0].rows.filter((r) => r.status === "met").map((r) => r.rowId);

      expect(distMet.sort()).toEqual(engMet.sort());
      expect(dist.verifyLog).toEqual([]);
    });
  }
});
