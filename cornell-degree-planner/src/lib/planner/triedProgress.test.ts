/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema, type CatalogIndexRecord } from "@/lib/schemas";
import type { Course, ElectiveGroup, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";
import type { Layer } from "./distribution";
import { computeRequirementProgress } from "./requirementProgress";
import { computeDistributionProgress, type DistributionProgressInput } from "./distributionProgress";
import {
  catalogTriedLookup,
  computeTriedProgress,
  sameTried,
  triedPlacementId,
  type TriedCourseLookup,
} from "./triedProgress";

// ── Builders ──────────────────────────────────────────────────────────────────
function course(id: string, credits = 3, tags: string[] = []): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number}`,
    credits_min: credits,
    credits_max: credits,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: tags.map((value) => ({ value })),
    sections: [],
    components: [],
  } as unknown as Course;
}

function boardOf(ids: string[]): { placements: Placement[]; placedCourses: Record<string, Course> } {
  const placements = ids.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 1 + Math.floor(i / 4), order: i % 4 }));
  return { placements, placedCourses: Object.fromEntries(ids.map((id) => [id, course(id)])) };
}

/** A catalog that has every id passed (and nothing else). */
function catalog(...ids: string[]): TriedCourseLookup {
  const known = new Set(ids);
  return (id) => (known.has(id) ? course(id) : null);
}

const itemOf = (p: RequirementProgress, id: string): RequirementItem => {
  const found = p.groups.flatMap((g) => g.items).find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

// ── Engineering fixture (the requirementProgress.test.ts shape) ──────────────
function baseSlot(id: string, sem: number, category: SlotCategory | null): ProgramSlotWithData {
  return {
    id,
    program_id: "p",
    kind: "course",
    course_id: null,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: sem,
    slot_row: 0,
    category,
    attribute_match: null,
    courses: null,
    elective_groups: null,
  };
}
const courseSlot = (id: string, courseId: string, sem: number, category: SlotCategory) => ({
  ...baseSlot(id, sem, category),
  kind: "course" as const,
  course_id: courseId,
  courses: course(courseId),
});
const CS_ELECTIVES: ElectiveGroup = {
  id: "g-cs",
  program_id: "p",
  name: "CS electives",
  description: null,
  qualifying_rule: { type: "level", subject: "CS", min_number: 3000 },
  min_credits: 3,
  advisor_approval: false,
  notes: null,
};
const electiveSlot = (id: string, sem: number) => ({
  ...baseSlot(id, sem, "elective"),
  kind: "elective" as const,
  elective_group_id: CS_ELECTIVES.id,
  elective_groups: CS_ELECTIVES,
});
const TEMPLATE: ProgramSlotWithData[] = [
  courseSlot("s-math", "MATH-1910", 1, "math"),
  courseSlot("s-2110", "CS-2110", 2, "core"),
  electiveSlot("s-el1", 5),
];

function engineeringSolve(placements: Placement[], placedCourses: Record<string, Course>, aliases: Record<string, string> = {}) {
  return computeRequirementProgress({
    templateSlots: TEMPLATE,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    canonical: (id) => aliases[id] ?? id,
  });
}

// ── Distribution fixture (the distributionProgress.test.ts shape) ────────────
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "distribution", "fixtures");
const CAS = LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, "cas-college.json"), "utf8"))) as Layer;
const SRC = { url: "https://example.edu/major", anchor: "Requirements" };
const MAJOR: Layer = {
  id: "test-cas-major",
  kind: "major",
  family: "cas",
  name: "Test Major",
  catalogYear: "2025-26",
  programId: "test-cas-major",
  rows: [
    { id: "intro", kind: "seat", label: "Intro programming", group: "Core", source: SRC, rule: { course: ["CS-1110"] } },
    {
      id: "electives",
      kind: "pool",
      label: "Two CS electives",
      group: "Electives",
      source: SRC,
      rule: { allOf: [{ subject: ["CS"] }, { number: { min: 3000 } }] },
      requiredCourses: 2,
      requiredCredits: 6,
    },
  ],
};
function distInput(placements: Placement[], placedCourses: Record<string, Course>): DistributionProgressInput {
  return {
    layers: [CAS, MAJOR],
    layerErrors: [],
    programId: "test-cas-major",
    family: "cas",
    programStatus: "visible",
    ctx: { entryTerm: "FA26", transfer: "none", transferStanding: null },
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
  };
}
const distributionSolve = (placements: Placement[], placedCourses: Record<string, Course>) =>
  computeDistributionProgress(distInput(placements, placedCourses));

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("computeTriedProgress — Engineering engine", () => {
  const board = boardOf(["MATH-1910"]);
  const base = engineeringSolve(board.placements, board.placedCourses);

  it("nothing tried → undefined", () => {
    expect(
      computeTriedProgress({ triedCourseIds: [], ...board, base, lookup: catalog(), solve: engineeringSolve })
    ).toBeUndefined();
  });

  it("solves the board plus the tried classes: items recomputed, fills per tried class", () => {
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-2110", "CS-4410"],
      ...board,
      base,
      lookup: catalog("CS-2110", "CS-4410"),
      solve: engineeringSolve,
    })!;
    expect(tried.courseIds).toEqual(["CS-2110", "CS-4410"]);
    expect(tried.notOnBoard).toEqual(["CS-2110", "CS-4410"]);
    expect(tried.missing).toEqual([]);
    // Every requirement item is present, keyed by its id.
    expect(Object.keys(tried.items).sort()).toEqual(base.groups.flatMap((g) => g.items.map((i) => i.id)).sort());
    expect(tried.items["s-2110"].status).toBe("satisfied");
    expect(tried.items["g-cs"].status).toBe("satisfied");
    expect(tried.items["s-2110"].coveredBy).toEqual([triedPlacementId("CS-2110")]);
    expect(tried.fills["CS-2110"]).toEqual([itemOf(base, "s-2110").label]);
    expect(tried.fills["CS-4410"]).toEqual(["CS electives"]);
  });

  it("never turns a REAL item satisfied: the real result is untouched", () => {
    const before = JSON.stringify(base);
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-2110", "CS-4410"],
      ...board,
      base,
      lookup: catalog("CS-2110", "CS-4410"),
      solve: engineeringSolve,
    })!;
    expect(JSON.stringify(base)).toBe(before);
    expect(itemOf(base, "s-2110").status).toBe("unmet");
    expect(itemOf(base, "g-cs").status).toBe("unmet");
    expect(base.satisfiedCount).toBe(1);
    // The same engine on the board alone still reads exactly the real result.
    expect(engineeringSolve(board.placements, board.placedCourses)).toEqual(base);
    expect(tried.items["s-2110"].status).toBe("satisfied");
  });

  it("puts virtual placements after the board's last semester, one per course", () => {
    const wide = boardOf(["MATH-1910", "PHYS-1112", "CHEM-2090", "ENGRD-2700", "CS-1110"]); // sems 1–2
    const wideBase = engineeringSolve(wide.placements, wide.placedCourses);
    let seen: Placement[] = [];
    computeTriedProgress({
      triedCourseIds: ["CS-2110", "CS-4410", "CS-2110"],
      ...wide,
      base: wideBase,
      lookup: catalog("CS-2110", "CS-4410"),
      solve: (pl, pc) => {
        seen = pl;
        return engineeringSolve(pl, pc);
      },
    });
    const virtual = seen.filter((p) => p.id.startsWith("tried:"));
    expect(virtual).toEqual([
      { id: "tried:CS-2110", courseId: "CS-2110", sem: 3, order: 0 },
      { id: "tried:CS-4410", courseId: "CS-4410", sem: 3, order: 1 },
    ]);
    expect(seen.slice(0, wide.placements.length)).toEqual(wide.placements);
  });

  it("a tried class on the board (also as a cross-listing) is not in notOnBoard and is not added twice", () => {
    const aliases: Record<string, string> = { "ENGRD-2110": "CS-2110" };
    const onBoard = boardOf(["MATH-1910", "ENGRD-2110"]);
    const solve = (pl: Placement[], pc: Record<string, Course>) => engineeringSolve(pl, pc, aliases);
    const onBase = solve(onBoard.placements, onBoard.placedCourses);
    let solves = 0;
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-2110"],
      ...onBoard,
      base: onBase,
      canonical: (id) => aliases[id] ?? id,
      lookup: catalog("CS-2110"),
      solve: (pl, pc) => {
        solves++;
        return solve(pl, pc);
      },
    })!;
    expect(tried.notOnBoard).toEqual([]);
    expect(solves).toBe(0); // nothing virtual → the real result is reused
    expect(tried.items["s-2110"]).toEqual(itemOf(onBase, "s-2110"));
    // Its fills are its board placement's real attribution.
    expect(tried.fills["CS-2110"]).toEqual(onBase.attribution["p-ENGRD-2110"]);
  });

  it("a tried class the catalog no longer has goes to missing and counts toward nothing", () => {
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-2110", "CS-9999"],
      ...board,
      base,
      lookup: catalog("CS-2110"),
      solve: engineeringSolve,
    })!;
    expect(tried.missing).toEqual(["CS-9999"]);
    expect(tried.notOnBoard).toEqual(["CS-2110", "CS-9999"]);
    expect(tried.fills).not.toHaveProperty("CS-9999");
    expect(tried.items["g-cs"].status).toBe("unmet");
  });

  it("while the catalog is still loading an unknown class is neither counted nor missing", () => {
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-4410"],
      ...board,
      base,
      lookup: () => undefined,
      solve: engineeringSolve,
    })!;
    expect(tried.missing).toEqual([]);
    expect(tried.notOnBoard).toEqual(["CS-4410"]);
    expect(tried.items["g-cs"].status).toBe("unmet");
  });
});

describe("computeTriedProgress — Distribution engine", () => {
  const board = boardOf(["CS-4410"]);
  const base = distributionSolve(board.placements, board.placedCourses);

  it("solves the board plus the tried classes on the same layers", () => {
    expect(base.engine).toBe("distribution");
    const tried = computeTriedProgress({
      triedCourseIds: ["CS-1110", "CS-4820"],
      ...board,
      base,
      lookup: catalog("CS-1110", "CS-4820"),
      solve: distributionSolve,
    })!;
    expect(tried.items["test-cas-major:intro"].status).toBe("satisfied");
    expect(tried.items["test-cas-major:electives"].status).toBe("satisfied");
    expect(tried.fills["CS-1110"]).toContain("Intro programming");
    expect(tried.fills["CS-4820"]).toContain("Two CS electives");
    // Every row of the real result is there, recomputed.
    for (const g of base.groups) for (const i of g.items) expect(tried.items[i.id]).toBeDefined();
  });

  it("never turns a REAL item satisfied", () => {
    const before = JSON.stringify(base);
    computeTriedProgress({
      triedCourseIds: ["CS-1110", "CS-4820"],
      ...board,
      base,
      lookup: catalog("CS-1110", "CS-4820"),
      solve: distributionSolve,
    });
    expect(JSON.stringify(base)).toBe(before);
    expect(itemOf(base, "test-cas-major:intro").status).toBe("unmet");
    expect(itemOf(base, "test-cas-major:electives").status).toBe("partial");
  });
});

describe("catalogTriedLookup", () => {
  const record = { id: "CS-4410", subject: "CS", number: "4410", title: "Operating Systems", creditsMin: 4, creditsMax: 4 } as unknown as CatalogIndexRecord;
  const index = new Map([[record.id, record]]);

  it("a full course doc first, else the index record", () => {
    const full = course("CS-2110");
    const lookup = catalogTriedLookup(index, { "CS-2110": full }, true);
    expect(lookup("CS-2110")).toBe(full);
    expect(lookup("CS-4410")).toMatchObject({ id: "CS-4410", credits_min: 4 });
  });

  it("an unknown id is missing (null) only once the index is ready", () => {
    expect(catalogTriedLookup(index, {}, true)("CS-9999")).toBeNull();
    expect(catalogTriedLookup(index, {}, false)("CS-9999")).toBeUndefined();
  });
});

describe("sameTried", () => {
  it("compares structure, not identity", () => {
    const a = { courseIds: ["X-1"], notOnBoard: [], items: {}, fills: {}, missing: [] };
    expect(sameTried(a, { ...a, courseIds: ["X-1"] })).toBe(true);
    expect(sameTried(a, { ...a, courseIds: ["X-2"] })).toBe(false);
    expect(sameTried(undefined, undefined)).toBe(true);
    expect(sameTried(a, undefined)).toBe(false);
  });
});
