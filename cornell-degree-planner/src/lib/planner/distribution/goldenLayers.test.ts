/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { lintLayer } from "./lintLayer";
import { describeGoldenFailure, runGoldenPlan, type GoldenFixture } from "./goldenPlan";
import { appliesToMatches } from "./select";
import type { DistCourse, Layer, Row } from "./types";

/**
 * Golden plans for Distribution layers (spec 019 D4 step 4, Phase 5): every
 * fixture in scripts/seed-data/golden/layers/ names its layers by id, in solve
 * order, and is named for the last one (the layer it proves):
 *   major          layerIds [majorId]
 *   concentration  layerIds [majorId, majorId--c]   (two layers, solved together)
 *   college        layerIds [collegeId]             (ctx selects that version)
 * Its plan must score exactly 100% with every course load-bearing, and no row
 * may count a course the fixture's `mustNotCount` probes rule out. The fixture
 * must also fit its layers: every layer's appliesTo selects the fixture's
 * student, ctx.programId / concentrationId are the layers' own, and a
 * concentration's major comes before it. Layers are read from the seed files at
 * test time (seed-data/layers/** and layers-test/), so a layer edit that
 * loosens or breaks a row fails here. Fixtures are written by
 * scripts/check-golden-layer.ts --write and published by promote-layer.ts.
 */

/** Walk up from this file until we find scripts/seed-data. */
function findSeedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const SEED_DIR = findSeedDir();
const GOLDEN_LAYERS_DIR = join(SEED_DIR, "golden", "layers");

function jsonFilesUnder(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (recursive) out.push(...jsonFilesUnder(p, true));
    } else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

/** Every authored and test layer file, by layer id. */
function loadLayerFiles(): Map<string, { file: string; raw: unknown }> {
  const files = [...jsonFilesUnder(join(SEED_DIR, "layers"), true), ...jsonFilesUnder(join(SEED_DIR, "layers-test"), false)];
  const byId = new Map<string, { file: string; raw: unknown }>();
  for (const file of files) {
    const raw = readJson(file);
    const id = raw && typeof raw === "object" && "id" in raw ? String((raw as { id: unknown }).id) : null;
    if (!id) continue;
    if (byId.has(id)) throw new Error(`layer id ${id} appears in both ${byId.get(id)!.file} and ${file}`);
    byId.set(id, { file, raw });
  }
  return byId;
}

const LAYER_FILES = loadLayerFiles();
const FIXTURE_FILES = jsonFilesUnder(GOLDEN_LAYERS_DIR, false);

function resolveLayer(id: string): Layer {
  const entry = LAYER_FILES.get(id);
  if (!entry) throw new Error(`no layer file with id ${id} under seed-data/layers or seed-data/layers-test`);
  const parsed = LayerSchema.safeParse(entry.raw);
  if (!parsed.success) throw new Error(`${entry.file}: fails LayerSchema: ${parsed.error.message}`);
  const layer = parsed.data as Layer;
  const lint = lintLayer(layer);
  if (lint.length) throw new Error(`${entry.file}: lint errors:\n  ${lint.join("\n  ")}`);
  return layer;
}

const KIND_RANK: Record<Layer["kind"], number> = { college: 0, major: 1, concentration: 2 };

/** Ways the fixture's layers do not fit its student; [] = fits (mirrors
 *  scripts/check-golden-layer.ts fixtureProblems, plus the naming rule that
 *  promote-layer.ts enforces). */
function fitProblems(layers: Layer[], fx: GoldenFixture): string[] {
  const out: string[] = [];
  if (!fx.layerIds.length) out.push("layerIds is empty");
  if (new Set(fx.layerIds).size !== fx.layerIds.length) out.push("layerIds names a layer twice");
  if (fx.layerIds[fx.layerIds.length - 1] !== fx.programId) out.push(`fixture ${fx.programId} must be named for its last layer (${fx.layerIds.at(-1)})`);
  layers.forEach((l, i) => {
    if (i > 0 && KIND_RANK[l.kind] <= KIND_RANK[layers[i - 1].kind]) out.push(`layers out of solve order: ${layers[i - 1].id} before ${l.id}`);
    if (!appliesToMatches(l.appliesTo, fx.ctx)) out.push(`layer ${l.id} does not apply to the fixture's student`);
    if (l.kind === "major" && fx.ctx.programId !== l.programId) out.push(`ctx.programId ${fx.ctx.programId} is not major ${l.id}'s`);
    if (l.kind === "concentration") {
      const majorAt = fx.layerIds.indexOf(l.programId ?? "");
      if (majorAt < 0 || majorAt > i) out.push(`concentration ${l.id} needs its major ${l.programId} before it`);
      if (fx.ctx.programId !== l.programId) out.push(`ctx.programId ${fx.ctx.programId} is not ${l.id}'s major`);
      if ((fx.ctx.concentrationId ?? null) !== (l.concentrationId ?? null)) out.push(`ctx.concentrationId ${fx.ctx.concentrationId} is not ${l.concentrationId}`);
    }
  });
  return out;
}

/** The whole golden check for one fixture on its resolved layers. */
function expectGoldenPasses(fx: GoldenFixture, layers: Layer[], where: string) {
  expect(Array.isArray(fx.courses), `${where}: no courses (run check-golden-layer.ts --write)`).toBe(true);
  for (const p of fx.mustNotCount ?? []) {
    expect(typeof p.courseId === "string" && typeof p.rowId === "string", `${where}: malformed probe`).toBe(true);
    expect(p.why?.trim(), `${where}: probe ${p.courseId} on ${p.rowId} gives no reason`).toBeTruthy();
  }
  expect(fitProblems(layers, fx), `${where}: the fixture does not fit its layers`).toEqual([]);
  const result = runGoldenPlan(layers, fx);
  expect(describeGoldenFailure(result, fx), `${fx.programId} golden plan failed`).toEqual([]);
  expect(result.ok).toBe(true);
}

describe("golden plans for Distribution layers", () => {
  it("has at least one fixture", () => {
    expect(FIXTURE_FILES.length).toBeGreaterThan(0);
  });

  for (const file of FIXTURE_FILES) {
    const fx = readJson(file) as GoldenFixture;
    const kinds = fx.layerIds.map((id) => LAYER_FILES.get(id) ? String((LAYER_FILES.get(id)!.raw as { kind?: unknown }).kind) : "?");
    it(`${fx.programId} [${kinds.join(" + ")}]: plan scores 100%, every course is load-bearing, no probe is counted`, () => {
      expect(basename(file, ".json"), `${file}: the file must be named for the fixture's programId`).toBe(fx.programId);
      expectGoldenPasses(fx, fx.layerIds.map(resolveLayer), file);
    });
  }
});

// The same check on invented concentration and college fixtures, so the
// two-layer and appliesTo paths are exercised before any real one is promoted.
describe("golden check: concentration and college fixtures", () => {
  const SRC = { url: "https://catalog.cornell.edu/invented/", anchor: "Invented" };
  const seat = (id: string, course: string): Row => ({ id, kind: "seat", label: id, group: "G", source: SRC, rule: { course: [course] } });
  const course = (id: string): DistCourse => ({ id, subject: id.split("-")[0], number: id.split("-")[1], title: id, credits: 3, attrs: [] });
  const major: Layer = { id: "invented-bs", kind: "major", family: "cals", name: "Invented", catalogYear: "2026-27", programId: "invented-bs", rows: [seat("m", "FICT-1000")] };
  const conc: Layer = { ...major, id: "invented-bs--dairy", kind: "concentration", concentrationId: "dairy", rows: [seat("k", "FICT-2000")] };
  const college: Layer = { id: "invented-college", kind: "college", family: "cals", name: "Invented College", catalogYear: "2026-27", appliesTo: [{ enteredFrom: "FA25" }], rows: [seat("c", "FICT-3000")] };
  const fx = (programId: string, layerIds: string[], ctx: GoldenFixture["ctx"], plan: string[]): GoldenFixture => ({ programId, description: "invented", layerIds, ctx, plan, courses: plan.map(course) });

  it("a concentration fixture solves the major and the concentration together", () => {
    const f = fx(conc.id, [major.id, conc.id], { programId: major.id, concentrationId: "dairy", entryTerm: "FA26", transfer: "none" }, ["FICT-1000", "FICT-2000"]);
    expectGoldenPasses(f, [major, conc], "invented concentration");
    const thin = runGoldenPlan([major, conc], { ...f, plan: ["FICT-1000"] });
    expect(thin.unmetRows).toEqual([{ layerId: conc.id, rowId: "k", status: "unmet" }]);
    expect(fitProblems([major, conc], { ...f, ctx: { ...f.ctx, concentrationId: "beef" } })).not.toEqual([]);
    expect(fitProblems([conc], { ...f, layerIds: [conc.id] })).not.toEqual([]);
  });

  it("a college fixture passes only for a student its appliesTo selects", () => {
    const f = fx(college.id, [college.id], { programId: "any", entryTerm: "FA26", transfer: "none" }, ["FICT-3000"]);
    expectGoldenPasses(f, [college], "invented college");
    expect(fitProblems([college], { ...f, ctx: { ...f.ctx, entryTerm: "FA24" } })).toEqual(["layer invented-college does not apply to the fixture's student"]);
  });
});
