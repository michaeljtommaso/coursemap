/**
 * Spec 047 D15: Engineering + Engineering double majors — the second major's
 * slot filter on the real program files, the forbidden pairs and notes, and
 * the Engineering engine with a second Engineering major beside the primary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramSchema } from "@/lib/schemas";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import type { Course, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { Layer } from "./distribution/types";
import { computeRequirementProgress } from "./requirementProgress";
import {
  ENGINEERING_FORBIDDEN_PAIRS,
  engineeringForbiddenReason,
  engineeringForbiddenWith,
  engineeringPairNote,
  isEngineeringProgram,
  primaryRowsNotShared,
  secondMajorSlots,
} from "./engineeringDoubleMajor";

function seedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const current = JSON.parse(readFileSync(join(seedDir(), "programs.json"), "utf-8")) as { id: string }[];
function slotsOf(programId: string): ProgramSlotWithData[] {
  const doc =
    current.find((p) => p.id === programId) ??
    JSON.parse(readFileSync(join(seedDir(), "programs-2025", `${programId}.json`), "utf-8"));
  return normalizeProgramSlots(ProgramSchema.parse(doc));
}

const ME = "cornell-me-bs-2026";
const CS = "cornell-cs-bs-2026";
const ISST = "cornell-isst-bs-2025";
const MSE = "cornell-mse-bs-2025";
const CE = "cornell-ce-bs-2025";
const BE = "cornell-be-bs-2025";

const ids = (slots: ProgramSlotWithData[]) => slots.map((s) => s.id);

describe("secondMajorSlots on the real templates", () => {
  it("ME + CS: CS keeps its own courses and electives, drops the common curriculum and ME's rows", () => {
    const kept = ids(secondMajorSlots(slotsOf(ME), slotsOf(CS)));
    for (const id of [
      "cs-s3-cs2110",
      "cs-s3-cs2800",
      "cs-s4-cs3110",
      "cs-s6-cs4820",
      "cs-s4-chem2080",
      "cs-s4-chem2081",
      "cs-s4-netsys",
      "cs-s5-major1",
      "cs-s7-major5",
      "cs-s8-major10",
    ]) {
      expect(kept).toContain(id);
    }
    for (const id of [
      "cs-s1-math1910",
      "cs-s2-math1920",
      "cs-s1-chem2090",
      "cs-s1-chem2091",
      "cs-s2-phys1112",
      "cs-s2-phys1110",
      "cs-s3-phys2213",
      "cs-s1-fwis",
      "cs-s2-fwis",
      "cs-s1-pe",
      "cs-s2-pe",
      "cs-s1-cs111x",
      "cs-s2-engri",
      "cs-s3-libstud",
      "cs-s5-advisor1",
      "cs-s6-advisor2",
      "cs-s4-engrd2xxx", // the generic second ENGRD
      "cs-s3-math2940", // ME requires MATH 2940 too
    ]) {
      expect(kept).not.toContain(id);
    }
  });

  it("keeps the major-specific ENGRD rules: MSE's mse-engr-dist, CE's ce-engrd-second", () => {
    const groupsKept = (primary: string, second: string) =>
      secondMajorSlots(slotsOf(primary), slotsOf(second)).map((s) => s.elective_group_id);
    const mse = groupsKept(ME, MSE);
    expect(mse).toContain("mse-engr-dist");
    expect(mse).not.toContain("mse-engrd-second");
    expect(mse).not.toContain("liberal-studies");
    expect(groupsKept(ME, CE)).toContain("ce-engrd-second");
  });

  it("drops the college core even when the primary meets it through its own group (BE's intro chemistry)", () => {
    expect(slotsOf(BE).some((s) => s.course_id === "CHEM-2090")).toBe(false);
    const kept = secondMajorSlots(slotsOf(BE), slotsOf(CS));
    expect(kept.some((s) => s.course_id === "CHEM-2090" || s.course_id === "PHYS-1112")).toBe(false);
  });

  it("never matches by slot id, and compares courses canonically", () => {
    const slot = (id: string, course_id: string): ProgramSlotWithData =>
      ({ id, kind: "course", course_id, pattern: null, elective_group_id: null, attribute_match: null, courses: null, elective_groups: null }) as unknown as ProgramSlotWithData;
    const primary = [slot("same-id", "TEST-1000"), slot("p-2", "TEST-OLD")];
    const second = [slot("same-id", "TEST-2000"), slot("s-2", "TEST-NEW")];
    const canonical = (id: string) => (id === "TEST-OLD" ? "TEST-NEW" : id);
    expect(ids(secondMajorSlots(primary, second, canonical))).toEqual(["same-id"]);
  });
});

describe("pairs (D15)", () => {
  it("ISST with CS or ORE is forbidden both ways, any catalog year", () => {
    expect(engineeringForbiddenReason(ISST, CS)).toMatch(/curricular overlap/);
    expect(engineeringForbiddenReason(CS, ISST)).toMatch(/curricular overlap/);
    expect(engineeringForbiddenReason("cornell-ore-bs-2026", "cornell-isst-bs-2027")).not.toBeNull();
    expect(engineeringForbiddenReason(ME, CS)).toBeNull();
    expect(engineeringForbiddenReason(CS, "cornell-ore-bs-2026")).toBeNull();
    expect(engineeringForbiddenWith(ISST).sort()).toEqual(["cornell-cs-bs", "cornell-ore-bs"]);
    expect(engineeringForbiddenWith(CS)).toEqual(["cornell-isst-bs"]);
    expect(engineeringForbiddenWith(ME)).toEqual([]);
    expect(ENGINEERING_FORBIDDEN_PAIRS).toHaveLength(2);
  });

  it("EnvE with CE or BE is allowed with a note; other pairs have none", () => {
    expect(engineeringPairNote("cornell-enve-bs-2025", CE)).toMatch(/coordinators must approve/);
    expect(engineeringPairNote(BE, "cornell-enve-bs-2025")).toMatch(/distinct thrusts/);
    expect(engineeringForbiddenReason("cornell-enve-bs-2025", CE)).toBeNull();
    expect(engineeringPairNote(ME, CS)).toBeNull();
  });

  it("isEngineeringProgram: the Engineering family in the College of Engineering", () => {
    expect(isEngineeringProgram({ college: "College of Engineering" })).toBe(true);
    expect(isEngineeringProgram({ college: "x", collegeId: "engineering", family: "engineering" })).toBe(true);
    expect(isEngineeringProgram({ college: "College of Arts and Sciences", collegeId: "cas", family: "cas" })).toBe(false);
    expect(isEngineeringProgram({ college: "Your own plan" })).toBe(false);
    expect(isEngineeringProgram(null)).toBe(false);
  });
});

// ── The engine ────────────────────────────────────────────────────────────────

function course(id: string, credits = 4): Course {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits_min: credits, credits_max: credits, attrs: [] } as unknown as Course;
}

const secondMajor = (programId: string, over: Partial<LoadedProgram> = {}): LoadedProgram => ({
  programId,
  kind: "major",
  name: `${programId} name`,
  shortName: programId,
  layers: [],
  template: slotsOf(programId),
  status: "ok",
  ...over,
});

function run(primaryId: string, board: string[], extras: LoadedProgram[]) {
  const placements: Placement[] = board.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 3 + (i % 4), order: i }));
  return computeRequirementProgress({
    templateSlots: slotsOf(primaryId),
    placements,
    placedCourses: Object.fromEntries(board.map((id) => [id, course(id)])),
    creditProfile: [],
    waivedRequirementIds: [],
    programId: primaryId,
    primaryName: { name: `${primaryId} name`, shortName: primaryId },
    extraPrograms: extras,
  });
}

describe("Engineering primary + Engineering second major (D15)", () => {
  it("a course counts for both majors; the headline stays the primary's", () => {
    const board = ["MATH-1910", "CS-2800", "CS-2110"];
    const alone = run(ME, board, []);
    const p = run(ME, board, [secondMajor(CS)]);
    expect([p.satisfiedCount, p.total]).toEqual([alone.satisfiedCount, alone.total]);
    expect(p.sections!.map((s) => [s.id, s.kind, s.status, s.color])).toEqual([
      [ME, "primary", "ok", null],
      [CS, "secondMajor", "ok", 1],
    ]);
    // CS 2800 fills ME's math elective and CS's own CS 2800 seat: no cap.
    expect(p.attributionDetail!["p-CS-2800"].map((d) => d.sectionId)).toEqual([ME, CS]);
    // CS 2110 is on ME's technical elective list: it counts for both too.
    expect(p.attributionDetail!["p-CS-2110"].map((d) => d.sectionId)).toEqual([ME, CS]);
    // MATH 1910 is the primary's alone (the common curriculum counts once).
    expect(p.attributionDetail!["p-MATH-1910"].map((d) => d.sectionId)).toEqual([ME]);
    const csGroups = p.groups.filter((g) => g.sectionId === CS);
    expect(csGroups.length).toBeGreaterThan(0);
    expect(csGroups.every((g) => g.key.startsWith(`${CS}:`))).toBe(true);
    const csItems = csGroups.flatMap((g) => g.items);
    expect(csItems.find((it) => it.id === "cs-s3-cs2800")?.status).toBe("satisfied");
    expect(csItems.some((it) => it.id === "cs-s1-math1910" || it.id === "cs-s3-libstud")).toBe(false);
    const cs = p.sections![1];
    expect(cs.total).toBe(csItems.length);
    expect(cs.satisfiedCount).toBe(csItems.filter((it) => it.status === "satisfied").length);
    expect(p.overlap).toBeUndefined();
  });

  it("advisor-approved electives never take a course the second major counts", () => {
    // ME's technical elective takes one CS course; alone, its two advisor
    // electives take the other two.
    const board = ["CS-2110", "CS-3110", "CS-4820"];
    const advisor = (p: ReturnType<typeof run>) =>
      p.groups.flatMap((g) => g.items).find((it) => it.id === "advisor-elective-open")!;
    expect(advisor(run(ME, board, [])).coveredBy).toHaveLength(2);
    const p = run(ME, board, [secondMajor(CS)]);
    expect(advisor(p).coveredBy).toEqual([]);
    expect(p.satisfiedCount).toBeLessThanOrEqual(run(ME, board, []).satisfiedCount);
    for (const id of board) expect(p.attributionDetail![`p-${id}`].map((d) => d.sectionId)).toContain(CS);
  });

  it("the common curriculum counts once: the second major's open pools don't take it", () => {
    // MATH 1910, a writing seminar and a liberal studies course: all the
    // primary's; none fills a CS elective pool.
    const p = run(ME, ["MATH-1910", "CS-1110", "ENGRI-1101"], [secondMajor(CS)]);
    const cs = p.groups.filter((g) => g.sectionId === CS).flatMap((g) => g.items);
    expect(cs.every((it) => it.coveredBy.length === 0)).toBe(true);
    expect(p.sections![1].satisfiedCount).toBe(0);
  });

  it("fill candidates fire for a CS second major on an empty ME board (single-course seats only)", () => {
    const p = run(ME, [], [secondMajor(CS)]);
    expect(p.fillCandidates![CS]).toEqual(["CS-2110", "CS-2800", "CHEM-2080", "CHEM-2081", "CS-3110", "CS-4820"]);
    // Placed or credited courses are never suggested.
    const placed = run(ME, ["CS-2110"], [secondMajor(CS)]);
    expect(placed.fillCandidates![CS]).not.toContain("CS-2110");
  });

  it("ISST + CS is reported forbidden and the later program can't read complete", () => {
    const p = run(ISST, ["CS-2110"], [secondMajor(CS)]);
    expect(p.overlap).toHaveLength(1);
    expect(p.overlap![0]).toMatchObject({ a: ISST, b: CS, limit: "forbidden", limitFrom: ISST, heldBack: [] });
    const cs = p.sections!.find((s) => s.id === CS)!;
    expect(cs.pct).toBeLessThanOrEqual(99);
  });

  it("a second major that isn't loaded leaves the primary intact and fails closed", () => {
    for (const status of ["loading", "unavailable"] as const) {
      const p = run(ME, ["MATH-1910"], [secondMajor(CS, { status, template: undefined })]);
      expect(p.sections!.map((s) => s.status)).toEqual(["ok", status]);
      expect(p.groups.every((g) => g.sectionId === ME)).toBe(true);
      expect(p.total).toBe(run(ME, ["MATH-1910"], []).total);
    }
  });

  it("minors still compose beside the second major", () => {
    const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };
    const minorLayer: Layer = {
      id: "test-minor-algorithms",
      kind: "minor",
      family: "other",
      name: "Test algorithms minor",
      catalogYear: "2026-27",
      programId: "test-minor-algorithms",
      rows: [{ id: "theory", kind: "seat", label: "Theory", group: "Core", source: SRC, rule: { course: ["CS-4820"] } }],
    };
    const minor: LoadedProgram = {
      programId: "test-minor-algorithms",
      kind: "minor",
      name: "Test algorithms minor",
      shortName: "Algorithms minor",
      layers: [minorLayer],
      status: "ok",
    };
    const p = run(ME, ["CS-4820", "CS-2800"], [secondMajor(CS), minor]);
    expect(p.sections!.map((s) => [s.id, s.kind])).toEqual([
      [ME, "primary"],
      [CS, "secondMajor"],
      ["test-minor-algorithms", "minor"],
    ]);
    // D6 order: the primary's groups, the second major's, then the minor's.
    const order = [...new Set(p.groups.map((g) => g.sectionId))];
    expect(order).toEqual([ME, CS, "test-minor-algorithms"]);
    expect(p.attributionDetail!["p-CS-4820"].map((d) => d.sectionId)).toEqual(
      expect.arrayContaining([CS, "test-minor-algorithms"])
    );
    expect(p.sections![2].satisfiedCount).toBe(1);
    expect(Object.keys(p.fillCandidates!).sort()).toEqual([CS, "test-minor-algorithms"].sort());
  });
});

// ── Audit fixes (D15) ─────────────────────────────────────────────────────────

const EP = "cornell-ep-bs-2025";
const BME = "cornell-bme-bs-2025";
const ENVE = "cornell-enve-bs-2025";
const EAS = "cornell-eas-bs-2025";

describe("D15 audit: college rows leave the second major only when the primary carries them", () => {
  const groupsKept = (primary: readonly ProgramSlotWithData[], second: string) =>
    secondMajorSlots(primary, slotsOf(second)).map((s) => s.elective_group_id);

  it("a BME primary (no PHYS 2213 row) leaves PHYS 2213 in the second major", () => {
    expect(slotsOf(BME).some((s) => s.course_id === "PHYS-2213")).toBe(false);
    const kept = secondMajorSlots(slotsOf(BME), slotsOf(ME)).map((s) => s.course_id);
    expect(kept).toContain("PHYS-2213");
    // The rest of the core BME does carry still leaves.
    for (const id of ["MATH-1910", "MATH-1920", "PHYS-1112", "PHYS-1110", "CHEM-2090", "CHEM-2091"]) {
      expect(kept).not.toContain(id);
    }
    // An ME primary carries PHYS 2213, so a CS second major drops it.
    expect(secondMajorSlots(slotsOf(ME), slotsOf(CS)).some((s) => s.course_id === "PHYS-2213")).toBe(false);
  });

  it("BME + ME on the engine: ME's PHYS 2213 row stays unmet and is suggested", () => {
    const core = ["MATH-1910", "MATH-1920", "PHYS-1112", "PHYS-1110", "CHEM-2090", "CHEM-2091", "PHYS-2214"];
    const p = run(BME, core, [secondMajor(ME)]);
    const me = p.groups.filter((g) => g.sectionId === ME).flatMap((g) => g.items);
    expect(me.find((it) => it.id === "me-s3-phys2213")?.status).toBe("unmet");
    expect(p.fillCandidates![ME]).toContain("PHYS-2213");
    const placed = run(BME, [...core, "PHYS-2213"], [secondMajor(ME)]);
    const me2 = placed.groups.filter((g) => g.sectionId === ME).flatMap((g) => g.items);
    expect(me2.find((it) => it.id === "me-s3-phys2213")?.status).toBe("satisfied");
  });

  it("EnvE's second ENGRD (major credits) stays; EAS's two college ENGRD seats leave", () => {
    expect(groupsKept(slotsOf(ME), ENVE)).toContain("enve-engrd-second");
    const eas = groupsKept(slotsOf(ME), EAS);
    expect(eas).not.toContain("eas-engrd");
    expect(eas).not.toContain("eas-engrd-second");
  });

  it("EP / BE / EnvE intro groups made of the college core leave when the primary covers them", () => {
    const ep = groupsKept(slotsOf(ME), EP);
    for (const g of ["ep-phys1-choice", "ep-phys2-choice", "ep-intro-chem"]) expect(ep).not.toContain(g);
    expect(ep).toContain("ep-phys3-choice"); // PHYS 2214 / 2218: major-specific
    expect(groupsKept(slotsOf(ME), BE)).not.toContain("be-intro-chem");
    expect(groupsKept(slotsOf(ME), ENVE)).not.toContain("enve-intro-chem");
    // BME doesn't carry PHYS 2213: EP's "PHYS 2213 or 2217" stays.
    const besideBme = groupsKept(slotsOf(BME), EP);
    expect(besideBme).toContain("ep-phys2-choice");
    expect(besideBme).not.toContain("ep-phys1-choice");
  });

  it("ME + EP on the engine: EP shows no intro physics or chemistry it can never complete", () => {
    const board = ["MATH-1910", "MATH-1920", "PHYS-1112", "PHYS-1110", "PHYS-2213", "CHEM-2090", "CHEM-2091", "PHYS-2214"];
    const p = run(ME, board, [secondMajor(EP)]);
    const ep = p.groups.filter((g) => g.sectionId === EP).flatMap((g) => g.items);
    expect(ep.some((it) => /ep-phys[12]-choice|ep-intro-chem/.test(it.id))).toBe(false);
    expect(ep.find((it) => it.id === "ep-phys3-choice")?.status).toBe("satisfied");
  });

  it("an EP primary's core choice groups keep their courses from the second major", () => {
    const notShared = primaryRowsNotShared(slotsOf(EP), slotsOf(ME));
    for (const g of ["ep-phys1-choice", "ep-phys2-choice", "ep-intro-chem", "liberal-studies"]) {
      expect(notShared.has(g)).toBe(true);
    }
    expect(notShared.has("ep-phys3-choice")).toBe(false);
  });

  it("CE's Engineering Communications row leaves only beside a primary with one", () => {
    expect(groupsKept(slotsOf(ME), CE)).toContain("ce-eng-comm");
    const ecr = slotsOf(CE).find((s) => s.elective_group_id === "ce-eng-comm")!;
    const withEcr: ProgramSlotWithData[] = [
      ...slotsOf(ME),
      {
        ...ecr,
        id: "test-ecr",
        elective_group_id: "test-eng-comm",
        elective_groups: { ...ecr.elective_groups!, id: "test-eng-comm", course_ids: ["ENGRC-3500", "COMM-3020"] },
      },
    ];
    expect(groupsKept(withEcr, CE)).not.toContain("ce-eng-comm");
  });
});

describe("D15 audit: liberal studies and advisor electives never take a course the second major counts", () => {
  const TAGS = ["CA-AG", "HST-AS", "ETM-AS", "SSC-AS", "FL-AG"];
  const LIB = ["ECON-3030", "ECON-3040", "ECON-1110", "HIST-2100", "PHIL-3400", "GOVT-3100", "SOC-1101", "ENGL-2700"];
  function tagged(id: string): Course {
    const value = TAGS[LIB.indexOf(id) % TAGS.length];
    return { ...course(id), attrs: [{ value, descr: value, group: "Distribution Requirements" }] } as unknown as Course;
  }
  function runTagged(primaryId: string, extras: LoadedProgram[]) {
    const placements: Placement[] = LIB.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 1 + (i % 8), order: i }));
    return computeRequirementProgress({
      templateSlots: slotsOf(primaryId),
      placements,
      placedCourses: Object.fromEntries(LIB.map((id) => [id, tagged(id)])),
      creditProfile: [],
      waivedRequirementIds: [],
      programId: primaryId,
      primaryName: { name: primaryId, shortName: primaryId },
      extraPrograms: extras,
      entryTerm: "FA24",
    });
  }

  it("ME + CS: ECON 3030 / 3040 count for CS's external specialization, not ME's liberal studies", () => {
    const p = runTagged(ME, [secondMajor(CS)]);
    const items = (sid: string) => p.groups.filter((g) => g.sectionId === sid).flatMap((g) => g.items);
    const me = items(ME);
    const cs = items(CS);
    const csCounts = new Set(cs.flatMap((it) => it.coveredBy));
    expect(csCounts).toContain("p-ECON-3030");
    expect(csCounts).toContain("p-ECON-3040");
    for (const id of ["liberal-studies", "advisor-elective-open"]) {
      const college = me.find((it) => it.id === id)!.coveredBy;
      expect(college.filter((pid) => csCounts.has(pid))).toEqual([]);
    }
  });

  it("no pair double counts a course in the primary's college pools and the second major", () => {
    for (const [a, b] of [
      [ME, CS],
      ["cornell-ece-bs-2026", CS],
      ["cornell-ore-bs-2026", EAS],
      [ME, EAS],
    ]) {
      const p = runTagged(a, [secondMajor(b)]);
      const second = new Set(p.groups.filter((g) => g.sectionId === b).flatMap((g) => g.items.flatMap((it) => it.coveredBy)));
      const college = p.groups
        .filter((g) => g.sectionId === a)
        .flatMap((g) => g.items)
        .filter((it) => it.id === "liberal-studies" || it.id === "advisor-elective-open")
        .flatMap((it) => it.coveredBy);
      expect(college.filter((pid) => second.has(pid)), `${a} + ${b}`).toEqual([]);
    }
  });
});
