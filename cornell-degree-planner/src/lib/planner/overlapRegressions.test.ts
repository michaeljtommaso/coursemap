/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import { solve } from "./distribution";
import type { DistCourse, Layer, Row } from "./distribution/types";
import {
  enforceOverlap,
  heldByLayer,
  holdBackLayers,
  stripHeldPlacements,
  type HeldEntry,
} from "./distribution/overlap";
import { courseMatchesRule } from "./distribution/rules";
import { lintLayer } from "./distribution/lintLayer";
import { namesWholeProgram } from "./distribution/programPrefix";
import {
  countedFromResult,
  fillCandidatesFor,
  holdCost,
  overlapPrograms,
  programOfLayer,
  progressScore,
  seatCourse,
} from "./multiProgram";
import { computeRequirementProgress } from "./requirementProgress";
import { minorStanding, rankMinor } from "./rankMinors";
import type { MatchCourse } from "./majorMatch";

// Spec 047 engine fixes (double majors and minors): each case below read a
// requirement as further along than it is before its fix. Program ids are
// fictional, except the promoted Data Science minor layer read from
// scripts/seed-data/layers/.

const SRC = { url: "https://example.edu/program", anchor: "Requirements" };
const ident = (id: string) => id;

function layer(id: string, kind: "major" | "minor" | "college", rows: Row[], over: Partial<Layer> = {}): Layer {
  return {
    id,
    kind,
    family: kind === "minor" ? "other" : "cas",
    name: id,
    catalogYear: "2026-27",
    ...(kind === "college" ? {} : { programId: id }),
    rows,
    ...over,
  } as Layer;
}

function loaded(l: Layer): LoadedProgram {
  return {
    programId: l.programId!,
    kind: l.kind === "major" ? "major" : "minor",
    name: l.name,
    shortName: l.name,
    layers: [l],
    ...(l.sharing ? { sharing: l.sharing } : {}),
    status: "ok",
  };
}

/** The D7 loop over a primary and extra programs, wired as
 *  computeDistributionProgress wires it. */
function d7(primary: Layer[], extras: Layer[], courses: DistCourse[], primaryId: string) {
  const layers = [...primary, ...extras];
  const programs = overlapPrograms({ id: primaryId, layers: primary, holdable: true }, extras.map(loaded));
  const layerProgram = programOfLayer(programs);
  const defs = new Map<string, Row>();
  for (const l of layers) for (const r of l.rows) defs.set(`${l.id}:${r.id}`, r);
  const input = {
    layers,
    courses,
    ctx: { programId: primaryId, additionalProgramIds: extras.map((l) => l.programId!) },
    canonical: ident,
  };
  return enforceOverlap({
    programs,
    base: solve(input),
    solve: (h: HeldEntry[]) => {
      const by = heldByLayer(h, programs);
      return solve({ ...input, layers: holdBackLayers(layers, by), courses: stripHeldPlacements(courses, by, ident) });
    },
    counted: (r) => countedFromResult(r, defs, layerProgram),
    score: (r) => progressScore(r, programs),
    cost: (r, pid, cid) => holdCost(r, programs, pid, cid),
  });
}

// ── Fix 1: an Engineering major's own science and math courses ──────────────
describe("Engineering primary: a major's science and math courses count toward overlap", () => {
  function course(id: string): Course {
    const [subject, number] = id.split("-");
    return { id, subject, number, title: `${subject} ${number}`, credits_min: 3, credits_max: 3, attrs: [] } as unknown as Course;
  }
  function slot(id: string, courseId: string, category: SlotCategory): ProgramSlotWithData {
    return {
      id,
      program_id: "test-eng-eas",
      kind: "course",
      course_id: courseId,
      pattern: null,
      pattern_title: null,
      elective_group_id: null,
      suggested_semester: 3,
      slot_row: 0,
      category,
      attribute_match: null,
      courses: course(courseId),
      elective_groups: null,
    };
  }
  // The categories a slot gets from its course's subject (slotCategory.ts):
  // EAS and PHYS courses read "science", MATH "math", ENGRD "core".
  const SLOTS = [
    slot("s-calc", "MATH-1910", "math"),
    slot("s-earth", "EAS-2250", "science"),
    slot("s-geo", "EAS-3050", "science"),
    slot("s-stats", "ENGRD-2700", "core"),
  ];
  const BOARD = ["MATH-1910", "EAS-2250", "EAS-3050", "ENGRD-2700"];
  const MINOR = layer(
    "test-minor-earth",
    "minor",
    [
      { id: "a", kind: "seat", label: "EAS 2250", group: "Core", source: SRC, rule: { course: ["EAS-2250"] } },
      { id: "b", kind: "seat", label: "EAS 3050", group: "Core", source: SRC, rule: { course: ["EAS-3050"] } },
      { id: "c", kind: "seat", label: "ENGRD 2700", group: "Core", source: SRC, rule: { course: ["ENGRD-2700"] } },
      { id: "d", kind: "seat", label: "MATH 1910", group: "Core", source: SRC, rule: { course: ["MATH-1910"] } },
    ],
    { sharing: { otherMajors: "none" } }
  );
  const run = () =>
    computeRequirementProgress({
      templateSlots: SLOTS,
      placements: BOARD.map((id, i): Placement => ({ id: `p-${id}`, courseId: id, sem: 1 + i, order: 0 })),
      placedCourses: Object.fromEntries(BOARD.map((id) => [id, course(id)])),
      creditProfile: [],
      waivedRequirementIds: [],
      programId: "test-eng-eas",
      primaryName: { name: "Test EAS", shortName: "EAS" },
      extraPrograms: [loaded(MINOR)],
    });

  it("a 'none' minor can't count EAS 2250 / EAS 3050 / MATH 1910 the major also uses", () => {
    const p = run();
    const minorItems = p.groups.filter((g) => g.sectionId === "test-minor-earth").flatMap((g) => g.items);
    expect(minorItems.filter((it) => it.status === "satisfied").map((it) => it.id)).toEqual([]);
    const pair = p.overlap![0];
    expect(pair.heldBack.map((h) => h.courseId).sort()).toEqual(["EAS-2250", "EAS-3050", "ENGRD-2700", "MATH-1910"]);
    expect(pair.sharedCourseIds).toEqual([]);
    // The Engineering major keeps every course.
    expect([p.satisfiedCount, p.total]).toEqual([4, 4]);
  });
});

// ── Fix 2: an "X or Y" credit can't slip past a hold-back ────────────────────
describe("a held-back course with alternates (AP credit granted as X or Y)", () => {
  const calc = (id: string): Row => ({ id, kind: "seat", label: "Calc", group: "Core", source: SRC, rule: { course: ["MATH-1910", "MATH-1110"] } });
  const MAJOR = layer("test-major-ba-2026", "major", [calc("calc")]);
  const MINOR = layer("test-minor-calc", "minor", [calc("calc")], { sharing: { otherMajors: "none" } });
  const AP: DistCourse = { id: "MATH-1910", subject: "MATH", number: "1910", credits: 4, isCredit: true, creditKind: "ap", altIds: ["MATH-1110"] };

  it("the pair ends within its limit with one side not met, each hold-back once", () => {
    const out = d7([MAJOR], [MINOR], [AP], MAJOR.id);
    expect(out.unresolved).toBe(false);
    expect(out.pairs[0].over).toBe(false);
    const statuses = out.result.layers.map((l) => l.rows[0].status).sort();
    expect(statuses).toEqual(["met", "unmet"]);
    const keys = out.held.map((h) => `${h.from}|${h.courseId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the hold-back rule refuses every reading of the course; a plain `not` still reads X or Y", () => {
    const held = holdBackLayers([MINOR], new Map([[MINOR.id, ["MATH-1910"]]]))[0].rows[0];
    expect(held.kind === "seat" && courseMatchesRule(AP, held.rule)).toBe(false);
    // Held by its alternate id: refused too.
    const byAlt = holdBackLayers([MINOR], new Map([[MINOR.id, ["MATH-1110"]]]))[0].rows[0];
    expect(byAlt.kind === "seat" && courseMatchesRule(AP, byAlt.rule)).toBe(false);
    // An authored "not MATH 1910" keeps the credit's MATH 1110 reading (spec 028).
    expect(courseMatchesRule(AP, { allOf: [{ not: { course: ["MATH-1910"] } }, { course: ["MATH-1110"] }] })).toBe(true);
  });
});

// ── Fix 3: an exclusive row elsewhere on the plan ───────────────────────────
describe("Minors you're close to: a course an exclusive row elsewhere could take", () => {
  const COLLEGE = layer("test-college", "college", [
    { id: "fws", kind: "pool", exclusive: true, label: "Two FWS", group: "Writing", source: SRC, rule: { titleStartsWith: "FWS:" }, requiredCourses: 2, requiredCredits: 6 },
  ]);
  const MAJOR = layer("test-major-ba-2026", "major", [
    { id: "x", kind: "seat", label: "X", group: "Core", source: SRC, rule: { course: ["HIST-1000"] } },
  ]);
  const MINOR = layer("test-minor-english", "minor", [
    { id: "five", kind: "pool", label: "Five ENGL courses", group: "Core", source: SRC, rule: { subject: ["ENGL"] }, requiredCourses: 5, requiredCredits: 15 },
  ]);
  const mk = (id: string, title: string): MatchCourse => {
    const [subject, number] = id.split("-");
    return { id, subject, number, title, credits: 3 };
  };
  const POOL = [mk("ENGL-1105", "FWS: Writing and Sexual Politics"), mk("ENGL-1111", "FWS: Writing Across Cultures"), mk("ENGL-2010", "Lit"), mk("ENGL-2020", "Lit 2")];
  const entry = { id: MINOR.id, name: "English minor", shortName: "English minor" } as Parameters<typeof rankMinor>[0];
  const planPrograms = overlapPrograms({ id: MAJOR.id, layers: [COLLEGE, MAJOR], holdable: true }, []);

  it("is not an exact 'N classes away' (the full solve gives the FWS courses to the college)", () => {
    const m = rankMinor(entry, MINOR, {
      pool: POOL,
      canonical: ident,
      plan: { primaryId: MAJOR.id, additional: [] },
      planPrograms,
      planKnown: true,
      markLayers: [COLLEGE, MAJOR],
    });
    expect(m?.classesAway).toBeNull();
    expect(m?.inexact).toContain("exclusive-elsewhere");
    expect(minorStanding(m!)).toMatch(/% done$/);
  });

  it("stays exact when no exclusive row elsewhere matches its courses", () => {
    const m = rankMinor(entry, MINOR, {
      pool: [mk("ENGL-2010", "Lit"), mk("ENGL-2020", "Lit 2")],
      canonical: ident,
      plan: { primaryId: MAJOR.id, additional: [] },
      planPrograms,
      planKnown: true,
      markLayers: [COLLEGE, MAJOR],
    });
    expect(m?.classesAway).toBe(3);
  });
});

// ── Fix 4: D3 fill candidates only for a seat with no choice ─────────────────
describe("D3 fill candidates: a seat with a choice adds nothing", () => {
  const SEED = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/seed-data/layers");
  const DS = JSON.parse(readFileSync(join(SEED, "minors", "cornell-data-science-minor-2026.json"), "utf8")) as Layer;

  it("the Data Science minor's multi-option seats suggest nothing on an empty board", () => {
    const empty = solve({ layers: [DS], courses: [], ctx: { programId: "test-econ-ba-2026", additionalProgramIds: [DS.programId!] } });
    expect(fillCandidatesFor([DS], empty, { canonical: ident, placed: new Set() })).toEqual([]);
  });

  it("seatCourse: one course only (cross-listed twins are one); a choice or an open rule is null", () => {
    expect(seatCourse({ course: ["A-1", "A-2"] })).toBeNull();
    expect(seatCourse({ course: ["A-1", "A-2"] }, (id) => (id === "A-2" ? "A-1" : id))).toBe("A-1");
    expect(seatCourse({ anyOf: [{ subject: ["X"] }, { course: ["B-1"] }] })).toBeNull();
    expect(seatCourse({ allOf: [{ course: ["C-1"] }, { not: { creditKind: ["ap"] } }] })).toBe("C-1");
  });

  it("a held-back credit that meets the seat's original rule is not suggested again", () => {
    const MAJOR = layer("test-major-ba-2026", "major", [{ id: "calc", kind: "seat", label: "Calc", group: "Core", source: SRC, rule: { course: ["MATH-1910"] } }]);
    const MINOR = layer("test-minor-calc", "minor", [{ id: "calc", kind: "seat", label: "Calc", group: "Core", source: SRC, rule: { course: ["MATH-1910"] } }], {
      sharing: { otherMajors: "none" },
    });
    const AP: DistCourse = { id: "MATH-1910", subject: "MATH", number: "1910", credits: 4, isCredit: true, creditKind: "ap" };
    const out = d7([MAJOR], [MINOR], [AP], MAJOR.id);
    expect(out.result.layers[1].rows[0].status).toBe("unmet");
    expect(fillCandidatesFor([MINOR], out.result, { canonical: ident, placed: new Set(), have: [AP] })).toEqual([]);
    // Without the credit, the seat's one course is suggested.
    expect(fillCandidatesFor([MINOR], out.result, { canonical: ident, placed: new Set(), have: [] })).toEqual(["MATH-1910"]);
  });
});

// ── Fix 6: sharing / program prefixes name a whole program ──────────────────
describe("lint: program prefixes name a whole program", () => {
  it("namesWholeProgram needs a degree token (optionally a catalog year)", () => {
    expect(namesWholeProgram("cornell-computer-science")).toBe(false);
    expect(namesWholeProgram("cornell-computer-science-ba")).toBe(true);
    expect(namesWholeProgram("cornell-computer-science-minor-2026")).toBe(true);
    expect(namesWholeProgram("cornell-architecture-barch")).toBe(true);
  });

  it("flags with / forbiddenWith / program entries that stop short of a degree token", () => {
    const l = layer(
      "test-minor-lint-2026",
      "minor",
      [{ id: "s", kind: "seat", label: "s", group: "g", source: { url: "https://www.cornell.edu/x", anchor: "x" }, rule: { allOf: [{ course: ["A-1"] }, { not: { program: ["cornell-computer-science"] } }] } }],
      { sharing: { otherMajors: { maxCourses: 1, with: ["cornell-economics"] }, forbiddenWith: ["cornell-computer-science-ba", "cornell-information-science"] } }
    );
    const errs = lintLayer(l).join("\n");
    expect(errs).toContain('sharing.otherMajors.with entry "cornell-economics" must name a whole program');
    expect(errs).toContain('sharing.forbiddenWith entry "cornell-information-science" must name a whole program');
    expect(errs).toContain('program entry "cornell-computer-science" must name a whole program');
    expect(errs).not.toContain('"cornell-computer-science-ba"');
  });
});
