/// <reference types="node" />
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { Layer } from "./distribution";
import { computeDistributionProgress } from "./distributionProgress";
import { OVERLAP_UNRESOLVED_NOTE } from "./multiProgram";

// Spec 047 D7: a pair the search can't bring within its limit ("no side could
// give a course up"). The real search always finds a way today, so the loop is
// replaced by one that gives up at once: the base solve, the pair still over.
vi.mock("./distribution/overlap", async (importOriginal) => {
  const real = await importOriginal<typeof import("./distribution/overlap")>();
  return {
    ...real,
    enforceOverlap: <R,>(input: Parameters<typeof real.enforceOverlap<R>>[0]) => {
      const pairs = real.measurePairs(input.programs, input.counted(input.base));
      return { result: input.base, held: [], pairs, estimated: true, resolves: 0, unresolved: pairs.some((p) => p.over) };
    },
  };
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "distribution", "fixtures");
const CAS = LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, "cas-college.json"), "utf8"))) as Layer;
const SRC = { url: "https://example.edu/program", anchor: "Requirements" };

const MAJOR: Layer = {
  id: "test-cas-econ",
  kind: "major",
  family: "cas",
  name: "Test Economics",
  catalogYear: "2026-27",
  programId: "test-cas-econ",
  rows: [{ id: "stats", kind: "seat", label: "Statistics", group: "Core", source: SRC, rule: { course: ["ECON-3130"] } }],
};
const MINOR: Layer = {
  id: "test-minor-data",
  kind: "minor",
  family: "other",
  name: "Test data minor",
  catalogYear: "2026-27",
  programId: "test-minor-data",
  sharing: { otherMajors: "none" },
  rows: [
    { id: "stats", kind: "seat", label: "Statistics", group: "Core", source: SRC, rule: { course: ["ECON-3130"] } },
    { id: "prog", kind: "seat", label: "Programming", group: "Core", source: SRC, rule: { course: ["CS-1110"] } },
  ],
};
const loadedMinor: LoadedProgram = {
  programId: MINOR.programId!,
  kind: "minor",
  name: MINOR.name,
  shortName: "Data minor",
  layers: [MINOR],
  sharing: MINOR.sharing,
  status: "ok",
};

function course(id: string): Course {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits_min: 4, credits_max: 4, attrs: [] } as unknown as Course;
}

describe("an overlap limit the search couldn't resolve", () => {
  it("the later program's rows counting a still-shared course don't read as met", () => {
    const ids = ["ECON-3130", "CS-1110"];
    const p = computeDistributionProgress({
      layers: [CAS, MAJOR],
      layerErrors: [],
      programId: MAJOR.programId!,
      family: "cas",
      programStatus: "visible",
      ctx: { entryTerm: "FA26", transfer: "none", transferStanding: null },
      placements: ids.map((id, i): Placement => ({ id: `p-${id}`, courseId: id, sem: 1, order: i })),
      placedCourses: Object.fromEntries(ids.map((id) => [id, course(id)])),
      creditProfile: [],
      waivedRequirementIds: [],
      primaryName: { name: "Test Economics, B.A.", shortName: "Economics" },
      extraPrograms: [loadedMinor],
    });
    expect(p.overlap?.[0].sharedCourseIds).toEqual(["ECON-3130"]);
    const items = new Map(p.groups.flatMap((g) => g.items).map((it) => [it.id, it]));
    const stats = items.get("test-minor-data:stats")!;
    expect(stats.status).toBe("partial");
    expect(stats.dist?.reason).toBe("overlap-unresolved");
    expect(stats.dist?.note).toContain(OVERLAP_UNRESOLVED_NOTE);
    // A row with no shared course, and the earlier program, keep their status.
    expect(items.get("test-minor-data:prog")!.status).toBe("satisfied");
    expect(items.get("test-cas-econ:stats")!.status).toBe("satisfied");
    const section = p.sections!.find((s) => s.id === MINOR.programId)!;
    expect(section.satisfiedCount).toBe(1);
    expect(section.pct).toBeLessThan(100);
  });
});
