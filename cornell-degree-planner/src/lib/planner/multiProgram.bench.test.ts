/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { Layer, LayerSharing } from "./distribution";
import { computeDistributionProgress, type DistributionProgressInput, type OverlapStats } from "./distributionProgress";

/**
 * Spec 047 "Scale": the solve cost of two majors + three minors with binding
 * overlap limits, measured on the real Economics and Mathematics layers (the
 * second major with its Economics concentration) and three fictional minor
 * layers. It logs the timings and asserts only correctness (every limit
 * honoured), so a slow machine never fails it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CAS_DIR = join(here, "..", "..", "..", "..", "scripts", "seed-data", "layers", "cas");
const load = (f: string): Layer => LayerSchema.parse(JSON.parse(readFileSync(join(CAS_DIR, f), "utf8"))) as Layer;

const SRC = { url: "https://example.edu/minor", anchor: "Requirements" };

function minor(id: string, name: string, sharing: LayerSharing, rows: Layer["rows"]): LoadedProgram {
  const layer: Layer = { id, kind: "minor", family: "other", name, catalogYear: "2026-27", programId: id, sharing, rows };
  return { programId: id, kind: "minor", name, shortName: name, layers: [layer], sharing, status: "ok" };
}

const upper = (subjects: string[], min: number) => ({ allOf: [{ subject: subjects }, { number: { min, max: 4999 } }] });

const MINORS: LoadedProgram[] = [
  minor("test-minor-data-science", "Data minor", { otherMajors: { maxCourses: 2 }, minors: "none" }, [
    { id: "programming", kind: "seat", label: "Programming", group: "Core", source: SRC, rule: { course: ["CS-1110", "CS-1112"] } },
    { id: "stats", kind: "seat", label: "Statistics", group: "Core", source: SRC, rule: { course: ["ECON-3110", "ECON-3130", "STAT-2000"] } },
    { id: "metrics", kind: "seat", label: "Econometrics", group: "Core", source: SRC, rule: { course: ["ECON-3120", "ECON-3140"] } },
    { id: "electives", kind: "pool", label: "Two data electives", group: "Electives", source: SRC, rule: upper(["ECON", "CS"], 4000), requiredCourses: 2, requiredCredits: 6 },
  ]),
  minor("test-minor-applied-math", "Applied math minor", { otherMajors: { maxCourses: 1 } }, [
    { id: "upper", kind: "pool", label: "Four upper-level math", group: "Core", source: SRC, rule: upper(["MATH"], 3000), requiredCourses: 4, requiredCredits: 12 },
    { id: "credits", kind: "credits", label: "Fifteen credits", group: "Credits", source: SRC, rule: upper(["MATH"], 2000), requiredCredits: 15 },
  ]),
  minor("test-minor-quant-finance", "Quant finance minor", { otherMajors: { maxCredits: 6 }, minors: { maxCourses: 1 } }, [
    { id: "micro", kind: "seat", label: "Intermediate micro", group: "Core", source: SRC, rule: { course: ["ECON-3030"] } },
    { id: "prob", kind: "seat", label: "Probability", group: "Core", source: SRC, rule: { course: ["MATH-4710", "ECON-3130"] } },
    { id: "electives", kind: "pool", label: "Three finance electives", group: "Electives", source: SRC, rule: upper(["ECON", "MATH"], 4000), requiredCourses: 3, requiredCredits: 9 },
  ]),
];

const COLLEGE = load("cas-college.json");
const ECON = load("cornell-economics-ba-2026.json");
const MATH = { ...load("cornell-mathematics-ba-2026.json"), sharing: { otherMajors: { maxCourses: 2 } } } as Layer;
const MATH_ECON = load("cornell-mathematics-ba-2026--economics.json");
const SECOND: LoadedProgram = {
  programId: MATH.programId!,
  kind: "major",
  name: MATH.name,
  shortName: "Math",
  layers: [MATH, MATH_ECON],
  sharing: MATH.sharing!,
  status: "ok",
};

const BOARD = [
  "MATH-1110", "MATH-1920", "MATH-2210", "CS-1110", "ECON-1110",
  "ECON-1120", "ECON-3030", "ECON-3040", "ECON-3130", "ECON-3120",
  "ECON-4010", "ECON-4020", "ECON-4030", "ECON-4110", "ECON-4120",
  "ECON-3810", "MATH-3110", "MATH-3210", "MATH-3320", "MATH-3340",
  "MATH-4130", "MATH-4710", "MATH-4310", "MATH-3610", "CS-2110",
  "HIST-1200", "PHIL-1100", "ENGL-2700", "MUSIC-1100", "ASTRO-1101",
  "BIOEE-1610", "GOVT-1111",
];
function course(id: string): Course {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits_min: 4, credits_max: 4, attrs: [] } as unknown as Course;
}
const placements: Placement[] = BOARD.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 1 + Math.floor(i / 5), order: i % 5 }));
const placedCourses = Object.fromEntries(BOARD.map((id) => [id, course(id)]));

function input(extras: LoadedProgram[], onOverlapStats?: (s: OverlapStats) => void): DistributionProgressInput {
  return {
    layers: [COLLEGE, ECON],
    layerErrors: [],
    programId: ECON.programId!,
    family: "cas",
    programStatus: "visible",
    ctx: { entryTerm: "FA24", transfer: "none", transferStanding: null },
    placements,
    placedCourses,
    creditProfile: [],
    waivedRequirementIds: [],
    extraPrograms: extras,
    ...(onOverlapStats ? { onOverlapStats } : {}),
  };
}

function time(fn: () => void, runs = 5): { first: number; median: number } {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ms.push(performance.now() - t);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  return { first: ms[0], median: sorted[Math.floor(runs / 2)] };
}

describe("spec 047 scale: 2 majors + 3 minors with binding limits", () => {
  it("measures the solve and keeps every limit", () => {
    let stats: OverlapStats | null = null;
    const alone = time(() => computeDistributionProgress(input([])));
    const full = time(() => computeDistributionProgress(input([SECOND, ...MINORS], (s) => (stats = s))));
    const p = computeDistributionProgress(input([SECOND, ...MINORS]));
    console.log(
      `[spec047 bench] primary alone: first ${alone.first.toFixed(1)} ms, median ${alone.median.toFixed(1)} ms | ` +
        `2 majors + 3 minors: first ${full.first.toFixed(1)} ms, median ${full.median.toFixed(1)} ms | ` +
        `pairs with a limit ${stats!.pairs}, re-solves ${stats!.resolves}, estimated ${stats!.estimated}`
    );
    expect(stats!.unresolved).toBe(false);
    expect(p.overlap!.length).toBeGreaterThan(0);
    for (const pair of p.overlap!) {
      if (pair.limit === "forbidden") continue;
      if (pair.limit === "none") expect(pair.sharedCourseIds).toEqual([]);
      else if (pair.limit.maxCourses != null) expect(pair.sharedCourseIds.length).toBeLessThanOrEqual(pair.limit.maxCourses);
    }
    expect(p.overlap!.some((o) => o.heldBack.length > 0)).toBe(true);
    expect(p.sections!.map((s) => s.kind)).toEqual(["college", "primary", "secondMajor", "minor", "minor", "minor"]);
  });
});
