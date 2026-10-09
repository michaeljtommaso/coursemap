import { describe, it, expect } from "vitest";
import {
  computeRequirementProgress,
  itemsBySemester,
  type RequirementProgressInput,
} from "./requirementProgress";
import type { Course, ElectiveGroup, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { RequirementItem, RequirementProgress } from "@/hooks/useRequirementProgress";

// ── Builders ──────────────────────────────────────────────────────────────────
function course(id: string, credits = 3, extra: Partial<Course> = {}): Course {
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
    attrs: [],
    sections: [],
    components: [],
    ...extra,
  } as Course;
}

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

function courseSlot(id: string, courseId: string, sem: number, category: SlotCategory | null = "core") {
  return { ...baseSlot(id, sem, category), kind: "course" as const, course_id: courseId, courses: course(courseId) };
}

function patternSlot(id: string, pattern: string, title: string, sem: number, category: SlotCategory | null = "core") {
  return { ...baseSlot(id, sem, category), kind: "pattern" as const, pattern, pattern_title: title };
}

function group(id: string, name: string, minCredits: number, subject = "CS", minNumber = 3000): ElectiveGroup {
  return {
    id,
    program_id: "p",
    name,
    description: null,
    qualifying_rule: { type: "level", subject, min_number: minNumber },
    min_credits: minCredits,
    advisor_approval: false,
    notes: null,
  };
}

function electiveSlot(id: string, g: ElectiveGroup, sem: number, category: SlotCategory | null = "elective") {
  return { ...baseSlot(id, sem, category), kind: "elective" as const, elective_group_id: g.id, elective_groups: g };
}

let seq = 0;
function place(courseId: string, sem: number, order = 0): Placement {
  seq += 1;
  return { id: `pl-${seq}-${courseId}`, courseId, sem, order };
}

function run(over: Partial<RequirementProgressInput>): RequirementProgress {
  return computeRequirementProgress({
    templateSlots: [],
    placements: [],
    placedCourses: {},
    creditProfile: [],
    waivedRequirementIds: [],
    ...over,
  });
}

function item(p: RequirementProgress, id: string): RequirementItem {
  const found = p.groups.flatMap((g) => g.items).find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

function coursesFor(placements: Placement[]): Record<string, Course> {
  const out: Record<string, Course> = {};
  for (const p of placements) out[p.courseId] = course(p.courseId);
  return out;
}

const CS_ELECTIVES = group("g-cs", "CS electives", 9);
const TEMPLATE: ProgramSlotWithData[] = [
  courseSlot("s-math", "MATH-1910", 1, "math"),
  courseSlot("s-2110", "CS-2110", 2, "core"),
  patternSlot("s-111x", "CS-111x", "CS 111x", 1, "core"),
  electiveSlot("s-el1", CS_ELECTIVES, 5),
  electiveSlot("s-el2", CS_ELECTIVES, 6),
  electiveSlot("s-el3", CS_ELECTIVES, 7),
];

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("computeRequirementProgress", () => {
  it("returns an empty progress for an empty template", () => {
    expect(run({})).toEqual({ groups: [], attribution: {}, satisfiedCount: 0, total: 0 });
  });

  it("collapses the elective slots of one group into ONE pool requirement", () => {
    const p = run({ templateSlots: TEMPLATE });
    expect(p.total).toBe(4); // MATH 1910, CS 2110, CS 111x, CS electives
    const el = item(p, "g-cs");
    expect(el.label).toBe("CS electives");
    expect(el.category).toBe("elective");
    expect(el.suggestedSem).toBe(5); // earliest elective slot of the group
  });

  it("covered: a placed course satisfies its seat and is attributed to it", () => {
    const placements = [place("CS-2110", 3)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    const it2110 = item(p, "s-2110");
    expect(it2110.status).toBe("satisfied");
    expect(it2110.coveredBy).toEqual([placements[0].id]);
    expect(p.attribution[placements[0].id]).toEqual(["CS 2110"]);
    expect(item(p, "s-math").status).toBe("unmet");
    expect(p.satisfiedCount).toBe(1);
  });

  it("position-independent: a pattern seat is filled from any semester", () => {
    const placements = [place("CS-1110", 8)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    expect(item(p, "s-111x").status).toBe("satisfied");
    expect(p.attribution[placements[0].id]).toEqual(["CS 111x"]);
  });

  it("partial pool: some but not all of the pool's credits", () => {
    const placements = [place("CS-4820", 5)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    const el = item(p, "g-cs");
    expect(el.status).toBe("partial");
    expect(el.coveredBy).toEqual([placements[0].id]);
    const grp = p.groups.find((g) => g.key === "elective")!;
    expect(grp.satisfiedCount).toBe(0);
    expect(grp.total).toBe(1);
  });

  it("a full pool is satisfied and lists every covering placement", () => {
    const placements = [place("CS-4820", 5), place("CS-4410", 6), place("CS-3110", 4)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    const el = item(p, "g-cs");
    expect(el.status).toBe("satisfied");
    expect([...el.coveredBy].sort()).toEqual(placements.map((x) => x.id).sort());
  });

  it("waived wins: status waived, no coverage, and the course stays free for another requirement", () => {
    const placements = [place("CS-1110", 1)];
    // Waive the 111x seat; the CS 1110 course can no longer count toward it.
    const p = run({
      templateSlots: TEMPLATE,
      placements,
      placedCourses: coursesFor(placements),
      waivedRequirementIds: ["s-111x"],
    });
    const w = item(p, "s-111x");
    expect(w.status).toBe("waived");
    expect(w.coveredBy).toEqual([]);
    expect(p.attribution[placements[0].id]).toBeUndefined();
    // Waived counts as done in the totals.
    expect(p.satisfiedCount).toBe(1);
    expect(p.groups.find((g) => g.key === "core")!.satisfiedCount).toBe(1);
  });

  it("credit-satisfied: an AP credit entry fills a seat with no placement", () => {
    const p = run({
      templateSlots: TEMPLATE,
      creditProfile: [
        { id: "ap-calc", kind: "ap", label: "AP Calculus BC", satisfiesCourseIds: ["MATH-1910"], credits: 4 },
      ],
    });
    const m = item(p, "s-math");
    expect(m.status).toBe("satisfied");
    expect(m.coveredBy).toEqual([]);
    expect(p.attribution).toEqual({});
  });

  it("a course counting toward nothing gets no attribution entry", () => {
    const placements = [place("HIST-1500", 2)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    expect(p.attribution[placements[0].id]).toBeUndefined();
    expect(p.satisfiedCount).toBe(0);
  });

  it("same course placed twice is counted once, attributed to the earlier placement", () => {
    const later = place("CS-2110", 4, 0);
    const earlier = place("CS-2110", 2, 1);
    const placements = [later, earlier];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    const it2110 = item(p, "s-2110");
    expect(it2110.status).toBe("satisfied");
    expect(it2110.coveredBy).toEqual([earlier.id]);
    expect(p.attribution[earlier.id]).toEqual(["CS 2110"]);
    expect(p.attribution[later.id]).toBeUndefined();
    // The duplicate did not leak into the elective pool either.
    expect(item(p, "g-cs").status).toBe("unmet");
  });

  it("groups follow the category taxonomy order with plural headings", () => {
    const p = run({ templateSlots: TEMPLATE });
    expect(p.groups.map((g) => g.key)).toEqual(["math", "core", "elective"]);
    expect(p.groups.map((g) => g.label)).toEqual(["Math", "Engineering core", "Electives"]);
    // core group items ordered by suggested semester (111x sem 1 before 2110 sem 2)
    expect(p.groups[1].items.map((i) => i.id)).toEqual(["s-111x", "s-2110"]);
  });

  it("uncategorized slots fall into an 'other' group", () => {
    const p = run({ templateSlots: [courseSlot("s-x", "ENGRD-2700", 3, null)] });
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].key).toBe("other");
  });

  it("canonicalizes cross-listings via the alias map", () => {
    const placements = [place("ENGRD-2110", 2)];
    const aliases: Record<string, string> = { "ENGRD-2110": "CS-2110" };
    const p = run({
      templateSlots: TEMPLATE,
      placements,
      placedCourses: coursesFor(placements),
      canonical: (id) => aliases[id] ?? id,
    });
    expect(item(p, "s-2110").coveredBy).toEqual([placements[0].id]);
  });
});

describe("itemsBySemester", () => {
  it("is a flat list of unmet/partial items in suggested-semester order", () => {
    const placements = [place("CS-1110", 1), place("CS-4820", 5)];
    const p = run({ templateSlots: TEMPLATE, placements, placedCourses: coursesFor(placements) });
    const flat = itemsBySemester(p);
    expect(flat.map((i) => i.id)).toEqual(["s-math", "s-2110", "g-cs"]);
    expect(flat.map((i) => i.status)).toEqual(["unmet", "unmet", "partial"]);
  });
});
