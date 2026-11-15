import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { AdditionalProgram } from "@/lib/schemas";
import type { MarkValue } from "@/lib/planner/distribution/types";

// Spec 047's pure plan-state rules (extra programs, tried fill, countsFor,
// orphan pruning). The provider's Firebase-backed neighbours are stubbed so
// the module imports in node.
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => ({}) }));
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
vi.mock("@/services/plans", () => ({
  subscribePlan: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  listPlans: vi.fn(),
}));

const {
  programsAfterAdding,
  programRemoval,
  restoreRemovedProgram,
  programsWithConcentrations,
  triedAfterAdding,
  marksWithCountsFor,
  withoutOrphans,
  seedStates,
  closedMinorPair,
  withoutClosedMinors,
} = await import("./PlanProvider");
const { MAX_COURSE_MARKS, MAX_TRIED_COURSES } = await import("@/lib/schemas");

// Fictional ids: two CAS majors, one CALS major, minors.
const ECON = "cas-econ-ba";
const MATH = "cas-math-ba";
const AEM = "cals-aem-bs";
const COLLEGES: Record<string, string> = { [ECON]: "cas", [MATH]: "cas", "cas-govt-ba": "cas", [AEM]: "cals" };
const collegeOf = (id: string) => COLLEGES[id] ?? null;
const major = (programId: string, concentrationIds?: string[]): AdditionalProgram => ({
  programId,
  kind: "major",
  ...(concentrationIds ? { concentrationIds } : {}),
});
const minor = (programId: string): AdditionalProgram => ({ programId, kind: "minor" });

const P = (id: string, courseId: string, sem = 1, order = 0): Placement => ({ id, courseId, sem, order });
const state = (over: Partial<Parameters<typeof programRemoval>[0]> = {}) => ({
  placements: [] as Placement[],
  placedCourses: {} as Record<string, Course>,
  completedIds: [] as string[],
  inProgressIds: [] as string[],
  waivedRequirementIds: [] as string[],
  courseMarks: {} as Record<string, MarkValue>,
  triedCourseIds: [] as string[],
  shortTerms: [] as number[],
  additionalPrograms: [] as AdditionalProgram[],
  ...over,
});

describe("programsAfterAdding — addProgram (spec 047 D2, D1)", () => {
  it("appends a same-college second major and minors in the order added", () => {
    const one = programsAfterAdding([], minor("minor-cs"), ECON, collegeOf);
    expect(one).toEqual([minor("minor-cs")]);
    expect(programsAfterAdding(one as AdditionalProgram[], major(MATH), ECON, collegeOf)).toEqual([
      minor("minor-cs"),
      major(MATH),
    ]);
  });

  it("refuses the primary, a repeat and past the per-kind caps", () => {
    expect(programsAfterAdding([], major(ECON), ECON, collegeOf)).toBe("primary");
    expect(programsAfterAdding([minor("m1")], minor("m1"), ECON, collegeOf)).toBe("duplicate");
    expect(programsAfterAdding([major(MATH)], major("cas-govt-ba"), ECON, collegeOf)).toBe("cap");
    expect(programsAfterAdding([minor("m1"), minor("m2"), minor("m3")], minor("m4"), ECON, collegeOf)).toBe("cap");
    // A full list of minors still takes a second major.
    expect(programsAfterAdding([minor("m1"), minor("m2"), minor("m3")], major(MATH), ECON, collegeOf)).toHaveLength(4);
  });

  it("refuses a second major from another college, or one the program list doesn't know", () => {
    expect(programsAfterAdding([], major(AEM), ECON, collegeOf)).toBe("invalid");
    expect(programsAfterAdding([], major("cas-unknown-ba"), ECON, collegeOf)).toBe("invalid");
    // A minor needs no college match.
    expect(programsAfterAdding([], minor("minor-x"), AEM, collegeOf)).toEqual([minor("minor-x")]);
  });

  it("refuses malformed entries and a plan with no program", () => {
    expect(programsAfterAdding([], { programId: "", kind: "minor" }, ECON, collegeOf)).toBe("invalid");
    expect(programsAfterAdding([], { programId: "m", kind: "minor", concentrationIds: [] }, ECON, collegeOf)).toBe(
      "invalid"
    );
    expect(programsAfterAdding([], { programId: "m", kind: "other" } as unknown as AdditionalProgram, ECON, collegeOf)).toBe(
      "invalid"
    );
    expect(programsAfterAdding([], major(MATH, ["a", "b", "c", "d"]), ECON, collegeOf)).toBe("invalid");
    expect(programsAfterAdding([], minor("m"), null, collegeOf)).toBe("invalid");
  });

  it("stores a retired id as its current id, and dedupes concentrations (empty → no field)", () => {
    const OLD = "cornell-infosci-bs-2025";
    const NEW = "cornell-information-science-bs-2026";
    expect(programsAfterAdding([], major(OLD), "cals-x", (id) => (id === NEW || id === "cals-x" ? "cals" : null))).toEqual([
      major(NEW),
    ]);
    expect(programsAfterAdding([major(NEW)], major(OLD), "cals-x", () => "cals")).toBe("duplicate");
    expect(programsAfterAdding([], major(MATH, ["a", "a"]), ECON, collegeOf)).toEqual([major(MATH, ["a"])]);
    expect(programsAfterAdding([], major(MATH, []), ECON, collegeOf)).toEqual([major(MATH)]);
  });
});

describe("programRemoval / restoreRemovedProgram — soft remove + Undo (spec 047 D10)", () => {
  const s = state({
    additionalPrograms: [major(MATH, ["stats"]), minor("minor-cs")],
    triedCourseIds: ["CS-1110", "MATH-2210", "CS-2110"],
    waivedRequirementIds: ["minor-cs:core"],
    courseMarks: { "countsFor:minor-cs@CS-2110": "yes" },
  });

  it("drops the program and only the tried classes the caller names; waivers and marks stay", () => {
    const r = programRemoval(s, "minor-cs", ["CS-1110", "CS-2110", "NOT-TRIED"])!;
    expect(r.next.additionalPrograms).toEqual([major(MATH, ["stats"])]);
    expect(r.next.triedCourseIds).toEqual(["MATH-2210"]);
    expect(r.next.waivedRequirementIds).toBe(s.waivedRequirementIds);
    expect(r.next.courseMarks).toBe(s.courseMarks);
    expect(r.removed).toEqual({ program: minor("minor-cs"), index: 1, tried: ["CS-1110", "CS-2110"] });
  });

  it("matches tried classes by course (aliases) and is null for a program not on the plan", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    expect(programRemoval(s, "minor-cs", ["ENGRD-2110"], canonical)!.next.triedCourseIds).toEqual([
      "CS-1110",
      "MATH-2210",
    ]);
    expect(programRemoval(s, "minor-none", [])).toBeNull();
  });

  it("Undo puts the program back at its place with its tried classes", () => {
    const r = programRemoval(s, MATH, ["MATH-2210"])!;
    const back = restoreRemovedProgram(r.next, { planId: "plan-1", ...r.removed }, "plan-1");
    expect(back).not.toBe("cap");
    expect(back).not.toBe("other-plan");
    const { next, triedLeftOut } = back as { next: typeof s; triedLeftOut: number };
    expect(next.additionalPrograms).toEqual(s.additionalPrograms);
    expect(next.triedCourseIds).toEqual(["CS-1110", "CS-2110", "MATH-2210"]);
    expect(triedLeftOut).toBe(0);
  });

  it("Undo is refused after a plan switch, and when the kind's cap filled meanwhile", () => {
    const r = programRemoval(s, MATH, [])!;
    const removed = { planId: "plan-1", ...r.removed };
    expect(restoreRemovedProgram(r.next, removed, "plan-2")).toBe("other-plan");
    const refilled = { ...r.next, additionalPrograms: [...r.next.additionalPrograms, major("cas-govt-ba")] };
    expect(restoreRemovedProgram(refilled, removed, "plan-1")).toBe("cap");
  });

  it("Undo skips tried classes placed meanwhile and counts those past the tried cap", () => {
    const r = programRemoval(s, "minor-cs", ["CS-1110", "CS-2110"])!;
    const removed = { planId: "p", ...r.removed };
    const placed = { ...r.next, placements: [P("x", "CS-1110")] };
    const back = restoreRemovedProgram(placed, removed, "p") as { next: typeof s; triedLeftOut: number };
    expect(back.next.triedCourseIds).toEqual(["MATH-2210", "CS-2110"]);
    const full = { ...r.next, triedCourseIds: Array.from({ length: MAX_TRIED_COURSES }, (_, i) => `X-${i}`) };
    const capped = restoreRemovedProgram(full, removed, "p") as { next: typeof s; triedLeftOut: number };
    expect(capped.next.additionalPrograms).toEqual(s.additionalPrograms);
    expect(capped.triedLeftOut).toBe(2);
  });

  it("Undo of a program already back changes nothing", () => {
    const back = restoreRemovedProgram(s, { planId: "p", program: minor("minor-cs"), index: 1, tried: [] }, "p");
    expect(back).toEqual({ next: s, triedLeftOut: 0 });
  });
});

describe("programsWithConcentrations — a second major's concentrations (spec 047 D2)", () => {
  const cur = [minor("m1"), major(MATH)];
  it("sets them in order, deduped; [] removes the field", () => {
    const set = programsWithConcentrations(cur, MATH, ["b", "a", "b"]) as AdditionalProgram[];
    expect(set[1]).toEqual(major(MATH, ["b", "a"]));
    expect(set[0]).toBe(cur[0]);
    expect(programsWithConcentrations(set, MATH, [])).toEqual(cur);
    expect(programsWithConcentrations(set, MATH, ["b", "a"])).toBe("same");
  });
  it("refuses a minor, more than three and a program not on the plan", () => {
    expect(programsWithConcentrations(cur, "m1", ["a"])).toBe("minor");
    expect(programsWithConcentrations(cur, MATH, ["a", "b", "c", "d"])).toBe("invalid");
    expect(programsWithConcentrations(cur, MATH, [""])).toBe("invalid");
    expect(programsWithConcentrations(cur, "nope", ["a"])).toBe("absent");
  });
});

describe("triedAfterAdding — D3 fill into tried (spec 047 D3/D9)", () => {
  it("adds in the given order, passing over placed, already-tried and repeated classes", () => {
    const r = triedAfterAdding(["CS-1110"], [P("p", "MATH-1910")], ["MATH-1910", "CS-1110", "CS-2110", "CS-2110", "CS-3110"]);
    expect(r).toEqual({ next: ["CS-1110", "CS-2110", "CS-3110"], added: ["CS-2110", "CS-3110"], skipped: 0 });
  });

  it("matches by course through the alias map", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    expect(triedAfterAdding([], [P("p", "CS-2110")], ["ENGRD-2110"], canonical).added).toEqual([]);
    expect(triedAfterAdding(["ENGRD-2110"], [], ["CS-2110"], canonical).added).toEqual([]);
  });

  it("stops at the tried cap and counts what it left out", () => {
    const tried = Array.from({ length: MAX_TRIED_COURSES - 2 }, (_, i) => `X-${i}`);
    const r = triedAfterAdding(tried, [], ["A-1", "A-2", "A-3", "A-4", "X-0"]);
    expect(r.added).toEqual(["A-1", "A-2"]);
    expect(r.skipped).toBe(2);
    expect(r.next).toHaveLength(MAX_TRIED_COURSES);
  });

  it("drops malformed ids without counting them", () => {
    expect(triedAfterAdding([], [], ["", "A".repeat(41), "OK-1"])).toEqual({ next: ["OK-1"], added: ["OK-1"], skipped: 0 });
  });
});

describe("marksWithCountsFor — one countsFor mark per course (spec 047 D8)", () => {
  const other = { "usedAs:cas-college/fws@ENGL-2880": "yes" } as Record<string, MarkValue>;

  it("sets the mark and replaces any other countsFor mark for that course", () => {
    const one = marksWithCountsFor(other, "ECON-3110", MATH) as Record<string, MarkValue>;
    expect(one).toEqual({ ...other, [`countsFor:${MATH}@ECON-3110`]: "yes" });
    const two = marksWithCountsFor(
      { ...one, [`countsFor:${MATH}@ECON-1110`]: "yes" },
      "ECON-3110",
      ECON
    ) as Record<string, MarkValue>;
    expect(two).toEqual({ ...other, [`countsFor:${ECON}@ECON-3110`]: "yes", [`countsFor:${MATH}@ECON-1110`]: "yes" });
  });

  it("null clears every countsFor mark for the course; nothing to change is 'same'", () => {
    const marks = { ...other, [`countsFor:${MATH}@ECON-3110`]: "yes" } as Record<string, MarkValue>;
    expect(marksWithCountsFor(marks, "ECON-3110", null)).toEqual(other);
    expect(marksWithCountsFor(other, "ECON-3110", null)).toBe("same");
    expect(marksWithCountsFor(marks, "ECON-3110", MATH)).toBe("same");
  });

  it("refuses a malformed key and a new mark past the marks cap (a replacement still fits)", () => {
    expect(marksWithCountsFor({}, "ECON 3110", MATH)).toBe("invalid");
    expect(marksWithCountsFor({}, "ECON-3110", "Bad_Layer")).toBe("invalid");
    const full = Object.fromEntries(
      Array.from({ length: MAX_COURSE_MARKS - 1 }, (_, i) => [`creditsTaken:BIO-${1000 + i}`, 3])
    ) as Record<string, MarkValue>;
    const atCap = { ...full, [`countsFor:${MATH}@ECON-3110`]: "yes" } as Record<string, MarkValue>;
    expect(marksWithCountsFor(atCap, "ECON-1110", MATH)).toBe("cap");
    expect(marksWithCountsFor(atCap, "ECON-3110", ECON)).toEqual({ ...full, [`countsFor:${ECON}@ECON-3110`]: "yes" });
  });
});

describe("withoutOrphans — D10 orphan pruning", () => {
  const s = {
    waivedRequirementIds: [
      `${ECON}:core`, // live
      "minor-cs:core", // orphan layer waiver
      "cs-s1-cs1110", // Engineering slot id: never pruned
      "liberal-studies", // Engineering group id: never pruned
    ],
    courseMarks: {
      "usedAs:cas-college/fws@ENGL-2880": "yes", // live
      "approvedFor:minor-cs/electives@CS-4780": "yes", // orphan row-scoped mark
      "countsFor:minor-cs@CS-2110": "yes", // orphan countsFor
      [`countsFor:${ECON}@ECON-3110`]: "yes", // live
      "creditsTaken:BIO-1000": 3, // credit mark: never pruned
    } as Record<string, MarkValue>,
  };

  it("drops only entries naming a layer that isn't live", () => {
    const r = withoutOrphans(s, ["cas-college", ECON]);
    expect(r.removed).toBe(3);
    expect(r.waivedRequirementIds).toEqual([`${ECON}:core`, "cs-s1-cs1110", "liberal-studies"]);
    expect(Object.keys(r.courseMarks).sort()).toEqual(
      ["creditsTaken:BIO-1000", "usedAs:cas-college/fws@ENGL-2880", `countsFor:${ECON}@ECON-3110`].sort()
    );
  });

  it("keeps everything when every named layer is live, or when no live layers are given", () => {
    const all = withoutOrphans(s, ["cas-college", ECON, "minor-cs"]);
    expect(all.removed).toBe(0);
    expect(all.waivedRequirementIds).toBe(s.waivedRequirementIds);
    expect(all.courseMarks).toBe(s.courseMarks);
    expect(withoutOrphans(s, []).removed).toBe(0);
  });
});

describe("seedStates — major switch carries extra programs (spec 047 D13)", () => {
  it("the target's own first, then the carried ones; the rollback keeps only the target's own", () => {
    const board = { placements: [], placedCourses: {}, completedIds: [], inProgressIds: [], waivedRequirementIds: [] };
    const { next, confirmed } = seedStates(board, {}, {}, [], [], [], [], [minor("m1")], [minor("m2"), minor("m1"), major(MATH)], MATH);
    expect(next.additionalPrograms).toEqual([minor("m1"), minor("m2")]);
    expect(confirmed.additionalPrograms).toEqual([minor("m1")]);
  });
});

describe("withoutOrphans — a live program's concentrations are live (audit #5, #6)", () => {
  it("R2: a second major's unchosen concentration keeps its waivers and marks, like the primary's", () => {
    // Primary: every concentration layer loads. Second major: its own layer
    // and only the chosen concentration.
    const live = ["cas-college-2025", ECON, `${ECON}--a`, `${ECON}--b`, MATH, `${MATH}--x`];
    const s = {
      waivedRequirementIds: [`${ECON}--b:r1`, `${MATH}--y:r1`, `${MATH}:r2`, "gone-minor:r1", "gone-minor--c:r1"],
      courseMarks: {
        [`countsFor:${MATH}--y@MATH-3110`]: "yes",
        "countsFor:gone-minor@CS-2110": "yes",
      } as Record<string, MarkValue>,
    };
    const r = withoutOrphans(s, live);
    expect(r.waivedRequirementIds).toEqual([`${ECON}--b:r1`, `${MATH}--y:r1`, `${MATH}:r2`]);
    expect(r.courseMarks).toEqual({ [`countsFor:${MATH}--y@MATH-3110`]: "yes" });
    expect(r.removed).toBe(3);
  });

  it("a removed program's concentrations stay orphans, and a prefix that isn't a \"--\" split doesn't count", () => {
    const s = { waivedRequirementIds: [`${MATH}--y:r1`, `${MATH}x:r1`], courseMarks: {} };
    expect(withoutOrphans(s, [ECON]).waivedRequirementIds).toEqual([]);
    expect(withoutOrphans(s, [MATH]).waivedRequirementIds).toEqual([`${MATH}--y:r1`]);
  });
});

describe("closedMinorPair / withoutClosedMinors — D12 notOpenTo (audit #3)", () => {
  const CS = "cas-cs-ba";
  const INDEX = [
    { id: "minor-cs", name: "Computer Science", shortName: "CS minor", offeredBy: "A&S", catalogYear: "2026-27", notOpenTo: [CS] },
    { id: "minor-math", name: "Mathematics", shortName: "Math minor", offeredBy: "A&S", catalogYear: "2026-27", notOpenTo: [MATH] },
    { id: "minor-ds", name: "Data Science", shortName: "DS minor", offeredBy: "CIS", catalogYear: "2026-27" },
  ];

  it("finds a minor closed to the primary or the second major (a prefix matches every catalog year)", () => {
    expect(closedMinorPair([minor("minor-cs")], `${CS}-2026`, INDEX)).toEqual({ minor: minor("minor-cs"), majorId: `${CS}-2026` });
    expect(closedMinorPair([major(MATH), minor("minor-math")], ECON, INDEX)).toEqual({ minor: minor("minor-math"), majorId: MATH });
    expect(closedMinorPair([major(MATH), minor("minor-cs"), minor("minor-ds")], ECON, INDEX)).toBeNull();
  });

  it("without the minor index nothing is known closed; `involving` limits it to that program's pairs", () => {
    expect(closedMinorPair([minor("minor-cs")], CS, null)).toBeNull();
    expect(closedMinorPair([minor("minor-cs")], CS, INDEX, "minor-ds")).toBeNull();
    expect(closedMinorPair([minor("minor-cs")], CS, INDEX, CS)).not.toBeNull();
  });

  it("drops only droppable closed minors and names why; the same array when none", () => {
    const list = [major(MATH), minor("minor-math"), minor("minor-cs"), minor("minor-ds")];
    const r = withoutClosedMinors(list, CS, INDEX, (id) => id !== "minor-cs");
    expect(r.programs).toEqual([major(MATH), minor("minor-cs"), minor("minor-ds")]);
    expect(r.dropped).toEqual([{ minor: minor("minor-math"), majorId: MATH }]);
    const clean = [minor("minor-ds")];
    expect(withoutClosedMinors(clean, CS, INDEX).programs).toBe(clean);
    expect(withoutClosedMinors(list, CS, null).programs).toBe(list);
  });

  it("restoreRemovedProgram refuses (\"closed\") to bring back a minor beside a major it's closed to", () => {
    const s = state({ additionalPrograms: [major(MATH)] });
    const removed = { planId: "p", program: minor("minor-math"), index: 1, tried: [] };
    const check = { primaryId: ECON, minorIndex: INDEX };
    expect(restoreRemovedProgram(s, removed, "p", undefined, check)).toBe("closed");
    // Without the check (or the index) it comes back as before.
    expect(typeof restoreRemovedProgram(s, removed, "p")).toBe("object");
    expect(typeof restoreRemovedProgram(s, removed, "p", undefined, { primaryId: ECON, minorIndex: null })).toBe("object");
    // A second major whose minor is on the plan: refused too.
    const back = restoreRemovedProgram(
      state({ additionalPrograms: [minor("minor-math")] }),
      { planId: "p", program: major(MATH), index: 0, tried: [] },
      "p",
      undefined,
      check
    );
    expect(back).toBe("closed");
  });
});
