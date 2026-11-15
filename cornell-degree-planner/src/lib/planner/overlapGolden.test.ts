/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { solve } from "./distribution";
import type { DistCourse, Layer, Row, StudentContext } from "./distribution/types";
import {
  enforceOverlap,
  heldByLayer,
  holdBackLayers,
  overLimit,
  stripHeldPlacements,
  type HeldEntry,
} from "./distribution/overlap";
import { countedFromResult, holdCost, overlapPrograms, programOfLayer, progressScore } from "./multiProgram";

/**
 * Spec 047 D7: every promoted overlap fixture
 * (scripts/seed-data/golden/overlap/<minorId>.json, checked on its own
 * arithmetic by scripts/check-overlap-fixture.ts) run through the engine's
 * re-solve loop, wired as computeDistributionProgress wires it: the fixture's
 * major (from scripts/seed-data/layers/**) as the primary, its minor as the
 * extra program, its plan as the board. The engine must hold back what the
 * fixture says, or an equally valid alternative: as many courses, each one
 * the fixture lists as shared, held from the minor, and the pair within the
 * fixture's limit afterwards.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scripts", "seed-data"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate the repo root (scripts/seed-data)");
}
const SEED = join(findRepoRoot(), "scripts", "seed-data");

function jsonFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFilesUnder(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

type OverlapFixture = {
  programId: string;
  layerIds: string[];
  ctx: StudentContext;
  plan: string[];
  limit: { maxCourses?: number; maxCredits?: number };
  shared: string[];
  heldBack: { courseId: string; from: string }[];
  courses: DistCourse[];
};

const layersById = new Map<string, Layer>();
for (const file of jsonFilesUnder(join(SEED, "layers"))) {
  const layer = LayerSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as Layer;
  layersById.set(layer.id, layer);
}
const fixtures = jsonFilesUnder(join(SEED, "golden", "overlap")).map(
  (f) => JSON.parse(readFileSync(f, "utf8")) as OverlapFixture
);

describe("overlap fixtures through the D7 loop", () => {
  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((fx) => [fx.programId, fx] as const))("%s", (_id, fx) => {
    const [majorId, minorId] = fx.layerIds;
    const major = layersById.get(majorId);
    const minor = layersById.get(minorId);
    expect(major, `${majorId} is a promoted layer`).toBeDefined();
    expect(minor, `${minorId} is a promoted layer`).toBeDefined();
    const layers = [major!, minor!];
    const byId = new Map(fx.courses.map((c) => [c.id, c]));
    const courses = fx.plan.map((id) => byId.get(id)!).filter(Boolean);
    expect(courses).toHaveLength(fx.plan.length);

    const canonical = (id: string) => id;
    const primaryId = major!.programId!;
    const programs = overlapPrograms({ id: primaryId, layers: [major!], holdable: true }, [
      {
        programId: minor!.programId!,
        kind: "minor",
        name: minor!.name,
        shortName: minor!.name,
        layers: [minor!],
        ...(minor!.sharing ? { sharing: minor!.sharing } : {}),
        status: "ok",
      },
    ]);
    const layerProgram = programOfLayer(programs);
    const defs = new Map<string, Row>();
    for (const l of layers) for (const r of l.rows) defs.set(`${l.id}:${r.id}`, r);
    const input = {
      layers,
      courses,
      ctx: { ...fx.ctx, programId: primaryId, additionalProgramIds: [minor!.programId!] },
      canonical,
    };
    const outcome = enforceOverlap({
      programs,
      base: solve(input),
      solve: (h: HeldEntry[]) => {
        const by = heldByLayer(h, programs);
        return solve({ ...input, layers: holdBackLayers(layers, by), courses: stripHeldPlacements(courses, by, canonical) });
      },
      counted: (r) => countedFromResult(r, defs, layerProgram),
      score: (r) => progressScore(r, programs),
      cost: (r, pid, cid) => holdCost(r, programs, pid, cid),
    });

    expect(outcome.unresolved).toBe(false);
    const pair = outcome.pairs.find((p) => p.a === primaryId && p.b === minor!.programId)!;
    expect(pair.over).toBe(false);
    // Within the fixture's own reading of the limit, too.
    expect(overLimit(fx.limit, pair.shared)).toBe(false);

    // As many hold-backs as the fixture names, each a course the fixture
    // lists as shared, from one of the pair's programs (the fixture's own
    // choice, or an equally valid one: the limit holding is asserted above).
    const held = [...new Set(outcome.held.map((h) => `${h.from}|${h.courseId}`))];
    expect(held).toHaveLength(fx.heldBack.length);
    for (const key of held) {
      const [from, courseId] = key.split("|");
      expect(fx.shared).toContain(courseId);
      expect([primaryId, minor!.programId]).toContain(from);
    }
  });
});
