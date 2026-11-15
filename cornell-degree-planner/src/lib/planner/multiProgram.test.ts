import { describe, it, expect } from "vitest";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import type { DistributionResult, Layer, LayerSharing, Row } from "./distribution";
import {
  countedFromResult,
  countsTowardOverlap,
  earliestNeededFirst,
  extraSections,
  overlapPrograms,
  seatCourse,
} from "./multiProgram";
import { computeRequirementProgress } from "./requirementProgress";
import { computeTriedProgress } from "./triedProgress";
import { courseMatchesRule } from "./distribution/rules";
import { countsForKey } from "./questions/keys";

// Spec 047 — the shared multi-program pieces, the Engineering path with a
// minor, the `program` rule leaf and the tried classes' "only for". Every
// program id here is fictional.

const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };

function minorLayer(sharing?: LayerSharing): Layer {
  return {
    id: "test-minor-robotics",
    kind: "minor",
    family: "other",
    name: "Test robotics minor",
    catalogYear: "2026-27",
    programId: "test-minor-robotics",
    ...(sharing ? { sharing } : {}),
    rows: [
      { id: "controls", kind: "seat", label: "Controls", group: "Core", source: SRC, rule: { course: ["MAE-3260"] } },
      {
        id: "electives",
        kind: "pool",
        label: "Two robotics electives",
        group: "Electives",
        source: SRC,
        rule: { course: ["CS-4750", "ECE-3140", "MAE-4180"] },
        requiredCourses: 2,
        requiredCredits: 6,
      },
    ],
  };
}

const loadedMinor = (sharing?: LayerSharing, over: Partial<LoadedProgram> = {}): LoadedProgram => ({
  programId: "test-minor-robotics",
  kind: "minor",
  name: "Test robotics minor",
  shortName: "Robotics minor",
  layers: [minorLayer(sharing)],
  ...(sharing ? { sharing } : {}),
  status: "ok",
  ...over,
});

describe("D7: what counts toward overlap", () => {
  it("consuming rows and credits rows count; overlay and confirm rows never do", () => {
    const seat: Row = { id: "s", kind: "seat", label: "s", group: "g", source: SRC, rule: { course: ["A-1"] } };
    expect(countsTowardOverlap(seat)).toBe(true);
    expect(countsTowardOverlap({ ...seat, overlay: true })).toBe(false);
    expect(
      countsTowardOverlap({ id: "c", kind: "credits", label: "c", group: "g", source: SRC, rule: { subject: ["A"] }, requiredCredits: 9, overlay: true })
    ).toBe(true);
    expect(countsTowardOverlap({ id: "x", kind: "confirm", label: "x", group: "g", source: SRC })).toBe(false);
    expect(countsTowardOverlap(undefined)).toBe(false);
  });

  it("the college layer never counts (it belongs to no program)", () => {
    const result = {
      layers: [
        { layerId: "college", kind: "college", name: "c", rows: [{ layerId: "college", rowId: "s", kind: "seat", label: "s", group: "g", status: "met", courses: [{ courseId: "A-1", credits: 3 }], progress: {}, fraction: 1 }] },
        { layerId: "maj", kind: "major", name: "m", rows: [{ layerId: "maj", rowId: "s", kind: "seat", label: "s", group: "g", status: "met", courses: [{ courseId: "B-1", credits: 4 }], progress: {}, fraction: 1 }] },
      ],
    } as unknown as DistributionResult;
    const seat: Row = { id: "s", kind: "seat", label: "s", group: "g", source: SRC, rule: { course: ["A-1"] } };
    const defs = new Map([["college:s", seat], ["maj:s", seat]]);
    const counted = countedFromResult(result, defs, new Map([["maj", "p"]]));
    expect([...counted.keys()]).toEqual(["p"]);
    expect([...counted.get("p")!]).toEqual([["B-1", 4]]);
  });

  it("overlapPrograms gathers sharing and every layer's forbiddenWith, concentrations included", () => {
    const major: Layer = { id: "maj", kind: "major", family: "cas", name: "M", catalogYear: "x", programId: "maj", sharing: { minors: "none" }, rows: [] };
    const conc: Layer = { ...major, id: "maj--c", kind: "concentration", concentrationId: "c", sharing: { forbiddenWith: ["test-phys"] } };
    const college: Layer = { ...major, id: "col", kind: "college", programId: undefined, sharing: undefined };
    const [primary, extra] = overlapPrograms({ id: "maj", layers: [college, major, conc], holdable: true }, [loadedMinor()]);
    expect(primary).toEqual({ id: "maj", kind: "major", layerIds: ["maj", "maj--c"], sharing: { minors: "none" }, forbiddenWith: ["test-phys"], holdable: true });
    expect(extra.layerIds).toEqual(["test-minor-robotics"]);
  });
});

describe("D3 helpers", () => {
  it("seatCourse reads the first named course, or null", () => {
    expect(seatCourse({ course: ["A-1", "A-2"] })).toBe("A-1");
    expect(seatCourse({ anyOf: [{ subject: ["X"] }, { course: ["B-1"] }] })).toBe("B-1");
    expect(seatCourse({ allOf: [{ course: ["C-1"] }, { minCredits: 3 }] })).toBe("C-1");
    expect(seatCourse({ pattern: "CS 4xxx" })).toBeNull();
  });

  it("earliestNeededFirst: prerequisites first, stable otherwise, cycles don't hang", () => {
    const unlocks: Record<string, string[]> = { "A-1": ["C-1"], "B-1": ["C-1"], "C-1": ["D-1"] };
    expect(earliestNeededFirst(["D-1", "C-1", "B-1", "A-1"], (id) => unlocks[id] ?? [])).toEqual(["B-1", "A-1", "C-1", "D-1"]);
    expect(earliestNeededFirst(["X-1", "Y-1"], (id) => (id === "X-1" ? ["Y-1"] : ["X-1"]))).toEqual(["X-1", "Y-1"]);
  });
});

describe("sections for extra programs", () => {
  it("colors follow plan order; loading and unavailable programs keep their place", () => {
    const list: LoadedProgram[] = [
      loadedMinor(),
      { ...loadedMinor(), programId: "test-minor-b", status: "loading", layers: [] },
      { ...loadedMinor(), programId: "test-minor-c", status: "unavailable", layers: [] },
    ];
    const s = extraSections(list, (id) => (id === "test-minor-robotics" ? { pct: 50, satisfiedCount: 1, total: 2 } : null), new Set());
    expect(s.map((x) => [x.id, x.color, x.status, x.pct])).toEqual([
      ["test-minor-robotics", 1, "ok", 50],
      ["test-minor-b", 2, "loading", 0],
      ["test-minor-c", 3, "unavailable", 0],
    ]);
  });
});

describe("the program rule leaf (spec 047 D13)", () => {
  const c = { id: "X-1", subject: "X", number: "1", credits: 3 };
  it("matches the primary or any additional program (prefix, any catalog year)", () => {
    const rule = { program: ["test-minor-robotics"] };
    expect(courseMatchesRule(c, rule, { programId: "test-eng" })).toBe(false);
    expect(courseMatchesRule(c, rule, { programId: "test-eng", additionalProgramIds: ["test-minor-robotics-2026"] })).toBe(true);
    expect(courseMatchesRule(c, rule, { programId: "test-minor-robotics" })).toBe(true);
    expect(courseMatchesRule(c, rule, { programId: "test-eng", additionalProgramIds: ["test-minor-roboticsx"] })).toBe(false);
  });
});

// ── An Engineering primary with a minor (cross-engine) ───────────────────────
function course(id: string, credits = 3): Course {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits_min: credits, credits_max: credits, attrs: [] } as unknown as Course;
}
function slot(id: string, courseId: string, category: SlotCategory): ProgramSlotWithData {
  return {
    id,
    program_id: "test-eng-mae",
    kind: "course",
    course_id: courseId,
    pattern: null,
    pattern_title: null,
    elective_group_id: null,
    suggested_semester: 5,
    slot_row: 0,
    category,
    attribute_match: null,
    courses: course(courseId),
    elective_groups: null,
  };
}
const SLOTS = [slot("s-calc", "MATH-1910", "math"), slot("s-controls", "MAE-3260", "core")];
const BOARD = ["MATH-1910", "MAE-3260", "CS-4750", "ECE-3140"];
const placements: Placement[] = BOARD.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 5, order: i }));
const placedCourses = Object.fromEntries(BOARD.map((id) => [id, course(id)]));
const eng = (extra: LoadedProgram[], marks = {}) =>
  computeRequirementProgress({
    templateSlots: SLOTS,
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    courseMarks: marks,
    programId: "test-eng-mae",
    primaryName: { name: "Test Mechanical Engineering", shortName: "MAE" },
    extraPrograms: extra,
  });

describe("Engineering primary + minor (spec 047 cross-engine)", () => {
  it("no extra programs: nothing new on the result", () => {
    const p = eng([]);
    expect(p.sections).toBeUndefined();
    expect(p.groups.every((g) => g.sectionId === undefined)).toBe(true);
  });

  it("the minor is solved over the same pool; the headline stays the Engineering major", () => {
    const alone = eng([]);
    const p = eng([loadedMinor()]);
    expect([p.satisfiedCount, p.total]).toEqual([alone.satisfiedCount, alone.total]);
    expect(p.sections!.map((s) => [s.id, s.kind, s.status])).toEqual([
      ["test-eng-mae", "primary", "ok"],
      ["test-minor-robotics", "minor", "ok"],
    ]);
    const minor = p.sections![1];
    expect([minor.satisfiedCount, minor.total, minor.pct]).toEqual([2, 2, 100]);
    expect(p.attributionDetail!["p-MAE-3260"].map((d) => d.sectionId)).toEqual(["test-eng-mae", "test-minor-robotics"]);
    expect(p.overlap).toBeUndefined();
  });

  it("a limit holds the course back from the minor, never from the Engineering major", () => {
    const p = eng([loadedMinor({ otherMajors: "none" })]);
    const pair = p.overlap![0];
    expect([pair.a, pair.b, pair.limit]).toEqual(["test-eng-mae", "test-minor-robotics", "none"]);
    expect(pair.heldBack).toEqual([
      { courseId: "MAE-3260", placementId: "p-MAE-3260", countsFor: "test-eng-mae", heldFrom: "test-minor-robotics" },
    ]);
    // The common curriculum (MATH-1910, a math slot) never counts toward overlap.
    expect(pair.sharedCourseIds).toEqual([]);
    expect(p.sections![1].satisfiedCount).toBe(1);
    // A choice for the minor can't move the course off the major: the limit wins.
    const chosen = eng([loadedMinor({ otherMajors: "none" })], { [countsForKey("test-minor-robotics", "MAE-3260")]: "yes" });
    expect(chosen.overlap![0].heldBack[0].heldFrom).toBe("test-minor-robotics");
  });

  it("an unavailable minor leaves the Engineering requirements intact", () => {
    const p = eng([{ ...loadedMinor(), status: "unavailable", layers: [] }]);
    expect(p.sections!.map((s) => s.status)).toEqual(["ok", "unavailable"]);
    expect(p.total).toBe(eng([]).total);
  });
});

describe("D10: tried classes counting only toward an extra program", () => {
  it("a tried class whose virtual placement counts only toward the minor is listed for it", () => {
    const solveWith = (pl: Placement[], pc: Record<string, Course>): RequirementProgress =>
      computeRequirementProgress({
        templateSlots: SLOTS,
        placements: pl,
        placedCourses: pc,
        creditProfile: [],
        waivedRequirementIds: [],
        programId: "test-eng-mae",
        extraPrograms: [loadedMinor()],
      });
    // The board without ECE-3140: the minor's electives still need one.
    const board = placements.filter((p) => p.courseId !== "ECE-3140");
    const base = solveWith(board, placedCourses);
    const tried = computeTriedProgress({
      triedCourseIds: ["MAE-4180", "PHYS-1112", "CS-4750"],
      placements: board,
      placedCourses,
      base,
      lookup: (id) => course(id),
      solve: solveWith,
    });
    // MAE-4180 counts only for the minor; PHYS-1112 counts for nothing; CS-4750 is on the board.
    expect(tried!.onlyFor).toEqual({ "test-minor-robotics": ["MAE-4180"] });
  });
});
