// scripts/check-overlap-fixture.ts
// The overlap fixture of a minor layer (spec 047 D7/D12; the authoring review's
// "second fixture: the minor with a real major where the overlap limit binds").
// A minor's golden plan proves the minor alone; this fixture proves its
// `sharing` limit is real (required when the minor sets sharing.otherMajors,
// overlapFixtureRequired; a minor with no limit toward majors has nothing to
// hold back): a plan for a fictional student whose major (a
// promoted major layer from seed-data/layers/) and minor count more courses in
// common than the pair's limit allows, and the courses the limit holds back.
//
// The fixture (golden-overlap.json in the minor's provenance folder; promoted
// to seed-data/golden/overlap/<minorId>.json):
//   programId    the minor layer id (the file is named for it)
//   description  one plain sentence in the author's own words (published)
//   layerIds     [<major layer id>, <minor layer id>]
//   ctx          the student: ctx.programId is the major
//   plan         course ids, board order; must complete the minor on its own
//   limit        the pair's limit as the author reads both layers:
//                { maxCourses?, maxCredits? } (the stricter of the major's
//                sharing.minors and the minor's sharing.otherMajors; "none" is
//                { maxCourses: 0 })
//   shared       the courses BOTH programs count before the limit is enforced
//   heldBack     what the limit holds back: [{ courseId, from, why }], `from`
//                the layer id the course stops counting for
//   courses      course data (filled from the catalog dump by --write)
//
// What is checked (runOverlapFixture; pure):
//   - the layers: a major then a minor, the fixture named for the minor, ctx
//     fits them (check-golden-layer's fixtureProblems);
//   - the plan completes the minor on its own (100%);
//   - the limit computed from the two layers' `sharing` (pairLimit: `with`
//     scoping, the stricter bound of each side) equals the fixture's `limit`,
//     and there is one (a pair with no limit has nothing to hold back);
//   - the shared courses, recomputed (a course counted by a consuming row or a
//     credits row of each layer; overlay rows never count, spec 047 D7 / C1),
//     equal the fixture's `shared`, and they are over the limit (it binds);
//   - heldBack is not empty, names only shared courses, once each, from one of
//     the two layers; with each held-back course removed from its `from`
//     layer's courses, the pair is within the limit and no held-back course
//     counts for its `from` layer.
// This is the fixture's own arithmetic, not the engine's D7 re-solve loop (it
// does not choose which course to hold back): the engine lane can run its loop
// over the same fixtures and compare.
//
// Run (from scripts/):
//   npx tsx check-overlap-fixture.ts <golden-overlap.json> [--layer <layer-or-draft.json>]...
//                                    [--dump <path>] [--write] [--report <out.json>]
// Layers not given with --layer come from seed-data/layers/** (the major must
// be promoted). --write fills `courses` from the catalog dump (plus the saved
// page's page-only courses of the fixture's folder) and rewrites the fixture
// deterministically. --report writes the OverlapReport with each layer's
// layerSha256 (overlap-report.json, which the review sheet and promote-layer
// require for a minor).
// Exit: 0 passes, 1 fails, 2 bad usage or unreadable input.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { solve } from "../cornell-degree-planner/src/lib/planner/distribution/index";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import type { DistributionResult, SharingLimit, StudentContext } from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { COURSE_KEYS, CTX_KEYS, fillCourses, fixtureCourseProblems, fixtureProblems, indexLayerFiles, loadPageOnly, resolveLayers, type FixtureInput } from "./check-golden-layer";
import { DEFAULT_DUMP, LAYERS_DIR, TEST_LAYERS_DIR, layerSha256, loadDistCatalog, readLayerOrDraft, type DistCourse, type Layer } from "./layer-authoring";

// ─── Shapes ─────────────────────────────────────────────────────────────────

export type OverlapCap = { maxCourses?: number; maxCredits?: number };
export type OverlapHeld = { courseId: string; from: string; why: string };

export type OverlapFixture = {
  programId: string;
  description: string;
  layerIds: string[];
  ctx: StudentContext;
  plan: string[];
  limit: OverlapCap;
  shared: string[];
  heldBack: OverlapHeld[];
  courses: DistCourse[];
};

export type OverlapReport = {
  programId: string;
  ok: boolean;
  problems: string[];
  /** The pair's limit computed from the layers; null = no limit. */
  limit: OverlapCap | null;
  sharedBefore: string[];
  sharedAfter: string[];
  /** Layer id → pct with the whole plan, and after the hold-back. */
  pctBefore: Record<string, number>;
  pctAfter: Record<string, number>;
  /** Layer id → layerSha256() of the layer this report was computed on. */
  layerHashes?: Record<string, string>;
};

export const OVERLAP_KEYS = ["programId", "description", "layerIds", "ctx", "plan", "limit", "shared", "heldBack", "courses"];
export const HELD_KEYS = ["courseId", "from", "why"];
export const LIMIT_KEYS = ["maxCourses", "maxCredits"];

/** Does a minor need an overlap fixture? Only when it sets a limit toward
 *  majors (`sharing.otherMajors`): a minor whose page allows sharing freely, or
 *  says nothing, has no limit to bind (a major's own sharing.minors is proved
 *  with that major). A fixture that exists is checked either way. */
export function overlapFixtureRequired(layer: Pick<Layer, "kind" | "sharing">): boolean {
  return layer.kind === "minor" && layer.sharing?.otherMajors !== undefined;
}

// ─── The pair's limit ───────────────────────────────────────────────────────

/** "cornell-aem-bs" matches "cornell-aem-bs" and "cornell-aem-bs-2026" (the
 *  `program` rule leaf's matching). */
export function prefixMatches(prefix: string, programId: string): boolean {
  return programId === prefix || programId.startsWith(`${prefix}-`);
}

/** One side's limit toward a partner program, as a cap; null = no cap. */
export function capOf(limit: SharingLimit | "forbidden" | undefined, partnerId: string): OverlapCap | null {
  if (limit == null) return null;
  if (limit === "none" || limit === "forbidden") return { maxCourses: 0 };
  if (limit.with?.length && !limit.with.some((p) => prefixMatches(p, partnerId))) return null;
  const cap: OverlapCap = {};
  if (limit.maxCourses != null) cap.maxCourses = limit.maxCourses;
  if (limit.maxCredits != null) cap.maxCredits = limit.maxCredits;
  return cap.maxCourses == null && cap.maxCredits == null ? null : cap;
}

/** The stricter of two caps, bound by bound; null = no cap. */
export function stricter(a: OverlapCap | null, b: OverlapCap | null): OverlapCap | null {
  if (!a) return b;
  if (!b) return a;
  const min = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.min(x, y));
  const out: OverlapCap = {};
  const mc = min(a.maxCourses, b.maxCourses);
  const mr = min(a.maxCredits, b.maxCredits);
  if (mc != null) out.maxCourses = mc;
  if (mr != null) out.maxCredits = mr;
  return out;
}

/** A major and a minor: the major's `sharing.minors` toward this minor, and the
 *  minor's `sharing.otherMajors` toward this major; the stricter applies. */
export function pairLimit(major: Layer, minor: Layer): OverlapCap | null {
  return stricter(capOf(major.sharing?.minors, minor.programId ?? minor.id), capOf(minor.sharing?.otherMajors, major.programId ?? major.id));
}

function sameCap(a: OverlapCap | null, b: OverlapCap | null): boolean {
  return (a?.maxCourses ?? null) === (b?.maxCourses ?? null) && (a?.maxCredits ?? null) === (b?.maxCredits ?? null);
}

function describeCap(c: OverlapCap | null): string {
  if (!c) return "no limit";
  const parts: string[] = [];
  if (c.maxCourses != null) parts.push(`at most ${c.maxCourses} course(s)`);
  if (c.maxCredits != null) parts.push(`at most ${c.maxCredits} credit(s)`);
  return parts.join(" and ");
}

// ─── Shared courses ─────────────────────────────────────────────────────────

/** Does this top-level row count toward overlap (spec 047 D7, C1)? Consuming
 *  rows and credits rows do; overlay rows and confirm rows don't. */
export function rowCountsForOverlap(layer: Layer, rowId: string): boolean {
  const row = layer.rows.find((r) => r.id === rowId);
  if (!row || row.kind === "confirm") return false;
  if (row.kind === "credits") return true;
  return !row.overlay;
}

/** Course ids a layer counts toward overlap in a solve of that layer alone. */
export function overlapCounted(layer: Layer, result: DistributionResult): Set<string> {
  const out = new Set<string>();
  for (const [courseId, rows] of Object.entries(result.attribution))
    if (rows.some((r) => r.layerId === layer.id && rowCountsForOverlap(layer, r.rowId))) out.add(courseId);
  return out;
}

function solveOne(layer: Layer, courses: DistCourse[], ctx: StudentContext): DistributionResult {
  return solve({ layers: [layer], courses, ctx, waived: [] });
}

function within(cap: OverlapCap, ids: string[], creditsOf: (id: string) => number): boolean {
  const credits = ids.reduce((n, id) => n + creditsOf(id), 0);
  return (cap.maxCourses == null || ids.length <= cap.maxCourses) && (cap.maxCredits == null || credits <= cap.maxCredits);
}

// ─── The check ──────────────────────────────────────────────────────────────

/** Keys outside the known sets (free text in an unknown key would be published unchecked). */
export function overlapKeyProblems(fx: unknown): string[] {
  const out: string[] = [];
  const unknown = (obj: unknown, known: string[]) =>
    obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj).filter((k) => !known.includes(k)) : [];
  const f = fx as Record<string, unknown>;
  for (const k of unknown(f, OVERLAP_KEYS)) out.push(`unknown fixture key "${k}"`);
  for (const k of unknown(f.ctx, CTX_KEYS)) out.push(`unknown ctx key "${k}"`);
  for (const k of unknown(f.limit, LIMIT_KEYS)) out.push(`unknown limit key "${k}"`);
  if (Array.isArray(f.heldBack)) f.heldBack.forEach((h, i) => unknown(h, HELD_KEYS).forEach((k) => out.push(`unknown key "${k}" on heldBack[${i}]`)));
  if (Array.isArray(f.courses)) f.courses.forEach((c, i) => unknown(c, COURSE_KEYS).forEach((k) => out.push(`unknown key "${k}" on courses[${i}]`)));
  return out;
}

const sortedIds = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Every check in the header, on these layers (in the fixture's order). Pure. */
export function runOverlapFixture(layers: Layer[], fx: OverlapFixture): OverlapReport {
  const problems: string[] = [];
  const base: OverlapReport = { programId: fx.programId, ok: false, problems, limit: null, sharedBefore: [], sharedAfter: [], pctBefore: {}, pctAfter: {} };
  if (layers.length !== 2 || fx.layerIds.length !== 2) {
    problems.push("layerIds must be exactly [<major layer id>, <minor layer id>]");
    return base;
  }
  const [major, minor] = layers;
  if (major.kind !== "major") problems.push(`${major.id} is a ${major.kind} layer; the first layer must be a major`);
  if (minor.kind !== "minor") problems.push(`${minor.id} is a ${minor.kind} layer; the second layer must be the minor`);
  if (fx.programId !== minor.id) problems.push(`the fixture is for ${fx.programId}, but its minor layer is ${minor.id}`);
  problems.push(...fixtureProblems(layers, fx));
  if (problems.length) return base;

  const byId = new Map(fx.courses.map((c) => [c.id, c]));
  const unknown = fx.plan.filter((id) => !byId.has(id));
  if (unknown.length) problems.push(`no course data for plan id(s) ${unknown.join(", ")} (run with --write)`);
  const planCourses = fx.plan.map((id) => byId.get(id)).filter((c): c is DistCourse => !!c);
  const creditsOf = (id: string) => byId.get(id)?.credits ?? 0;

  // Before: each program alone on the whole plan.
  const majorBefore = solveOne(major, planCourses, fx.ctx);
  const minorBefore = solveOne(minor, planCourses, fx.ctx);
  const pctBefore = { [major.id]: majorBefore.pct, [minor.id]: minorBefore.pct };
  if (minorBefore.pct !== 100) problems.push(`the plan does not complete the minor on its own (${minorBefore.pct}%): add the courses it needs`);
  const majorSet = overlapCounted(major, majorBefore);
  const sharedBefore = sortedIds([...overlapCounted(minor, minorBefore)].filter((id) => majorSet.has(id)));

  const limit = pairLimit(major, minor);
  if (!limit) problems.push(`the two layers set no limit for this pair (sharing on ${major.id} toward minors, on ${minor.id} toward majors): an overlap fixture needs a binding limit`);
  if (!sameCap(limit, fx.limit ?? null)) problems.push(`the fixture's limit is ${describeCap(fx.limit ?? null)}, but the layers give ${describeCap(limit)}`);
  const declared = sortedIds(fx.shared ?? []);
  if (JSON.stringify(declared) !== JSON.stringify(sharedBefore))
    problems.push(`the fixture says the shared courses are [${declared.join(", ")}], but both programs count [${sharedBefore.join(", ")}]`);
  if (limit && within(limit, sharedBefore, creditsOf))
    problems.push(`the limit does not bind: ${sharedBefore.length} shared course(s) are within ${describeCap(limit)}; add a course both programs count`);

  // The hold-back.
  const held = fx.heldBack ?? [];
  if (!held.length) problems.push("heldBack is empty: name the course(s) the limit holds back, and from which program");
  const seen = new Set<string>();
  for (const h of held) {
    if (seen.has(h.courseId)) problems.push(`heldBack names ${h.courseId} twice`);
    seen.add(h.courseId);
    if (!sharedBefore.includes(h.courseId)) problems.push(`heldBack ${h.courseId} is not a shared course`);
    if (h.from !== major.id && h.from !== minor.id) problems.push(`heldBack ${h.courseId} is held from ${h.from}, which is neither ${major.id} nor ${minor.id}`);
    if (!h.why?.trim()) problems.push(`heldBack ${h.courseId} needs a why`);
  }
  const heldFrom = (layerId: string) => new Set(held.filter((h) => h.from === layerId).map((h) => h.courseId));
  const majorHeld = heldFrom(major.id);
  const minorHeld = heldFrom(minor.id);
  const majorAfter = solveOne(major, planCourses.filter((c) => !majorHeld.has(c.id)), fx.ctx);
  const minorAfter = solveOne(minor, planCourses.filter((c) => !minorHeld.has(c.id)), fx.ctx);
  const pctAfter = { [major.id]: majorAfter.pct, [minor.id]: minorAfter.pct };
  const majorAfterSet = overlapCounted(major, majorAfter);
  const minorAfterSet = overlapCounted(minor, minorAfter);
  const sharedAfter = sortedIds([...minorAfterSet].filter((id) => majorAfterSet.has(id)));
  if (limit && !within(limit, sharedAfter, creditsOf))
    problems.push(`after the hold-back the pair still shares [${sharedAfter.join(", ")}], over ${describeCap(limit)}: hold back more`);
  for (const h of held) {
    const after = h.from === major.id ? majorAfterSet : h.from === minor.id ? minorAfterSet : null;
    if (after?.has(h.courseId)) problems.push(`${h.courseId} still counts for ${h.from} after it is held back`);
  }

  return { programId: fx.programId, ok: problems.length === 0, problems, limit, sharedBefore, sharedAfter, pctBefore, pctAfter };
}

export function buildOverlapReport(layers: Layer[], fx: OverlapFixture): OverlapReport {
  return { ...runOverlapFixture(layers, fx), layerHashes: Object.fromEntries(layers.map((l) => [l.id, layerSha256(l)])) };
}

export function renderOverlapReport(r: OverlapReport): string {
  const lines = [
    `Overlap fixture for ${r.programId}: limit ${describeCap(r.limit)}`,
    `  shared before: [${r.sharedBefore.join(", ")}]  after: [${r.sharedAfter.join(", ")}]`,
    `  pct before: ${Object.entries(r.pctBefore).map(([k, v]) => `${k} ${v}%`).join(", ")}  after: ${Object.entries(r.pctAfter).map(([k, v]) => `${k} ${v}%`).join(", ")}`,
  ];
  if (r.problems.length) lines.push(`  ${r.problems.length} problem(s):`, ...r.problems.map((p) => `    - ${p}`));
  lines.push(r.ok ? "OVERLAP PASSED." : "OVERLAP FAILED.");
  return lines.join("\n");
}

// ─── Fixture file ───────────────────────────────────────────────────────────

function ordered(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rest = Object.keys(obj).filter((k) => !keys.includes(k)).sort();
  for (const k of [...keys, ...rest]) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** 2-space JSON, LF, trailing newline, stable key order. */
export function serializeOverlapFixture(fx: OverlapFixture): string {
  const o = ordered(fx as unknown as Record<string, unknown>, OVERLAP_KEYS);
  o.ctx = ordered(fx.ctx as unknown as Record<string, unknown>, CTX_KEYS);
  if (fx.limit) o.limit = ordered(fx.limit as Record<string, unknown>, LIMIT_KEYS);
  if (fx.heldBack) o.heldBack = fx.heldBack.map((h) => ordered(h as unknown as Record<string, unknown>, HELD_KEYS));
  if (fx.courses)
    o.courses = fx.courses.map((c) => {
      const co = ordered(c as unknown as Record<string, unknown>, COURSE_KEYS);
      if (Array.isArray(c.attrs)) co.attrs = c.attrs.map((a) => ordered(a as unknown as Record<string, unknown>, ["value"]));
      return co;
    });
  return JSON.stringify(o, null, 2) + "\n";
}

/** The fixture's embedded course data against the catalog (and page-only courses). */
export function overlapCourseProblems(fx: Pick<OverlapFixture, "plan" | "courses">, catalogById: Map<string, DistCourse>, pageOnlyById: Map<string, DistCourse>): string[] {
  return fixtureCourseProblems({ plan: fx.plan, courses: fx.courses }, catalogById, pageOnlyById);
}

export function readOverlapFixture(path: string): OverlapFixture {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as OverlapFixture;
  if (!raw || typeof raw.programId !== "string" || !Array.isArray(raw.layerIds) || !Array.isArray(raw.plan) || !raw.ctx || !Array.isArray(raw.shared) || !Array.isArray(raw.heldBack) || typeof raw.limit !== "object")
    throw new Error(`${path}: not an overlap fixture (needs programId, layerIds, ctx, plan, limit, shared, heldBack)`);
  return { ...raw, courses: Array.isArray(raw.courses) ? raw.courses : [] };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx check-overlap-fixture.ts <golden-overlap.json> [--layer <layer-or-draft.json>]... [--dump <path>] [--write] [--report <out.json>]";

function main(argv: string[]): number {
  const layersArg: string[] = [];
  let fixture: string | null = null;
  let dump = DEFAULT_DUMP;
  let write = false;
  let report: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v == null || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "--layer") layersArg.push(value());
      else if (a === "--dump") dump = value();
      else if (a === "--report") report = value();
      else if (a === "--write") write = true;
      else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
      else if (fixture == null) fixture = a;
      else throw new Error("exactly one fixture file");
    } catch (e) {
      console.error(`${(e as Error).message}\n${USAGE}`);
      return 2;
    }
  }
  if (!fixture) {
    console.error(USAGE);
    return 2;
  }
  const fixturePath = resolve(fixture);
  let fx: OverlapFixture;
  let layers: Layer[];
  try {
    fx = readOverlapFixture(fixturePath);
    const explicit = layersArg.map((p) => readLayerOrDraft(resolve(p)));
    const index = indexLayerFiles([
      { dir: LAYERS_DIR, recursive: true },
      { dir: TEST_LAYERS_DIR, recursive: false },
    ]);
    layers = resolveLayers(fx.layerIds, explicit, index);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const keyProblems = overlapKeyProblems(fx);
  for (const p of keyProblems) console.error(`fixture: ${p}`);
  let lintFailed = false;
  for (const l of layers) {
    const lint = lintLayer(l);
    if (lint.length) {
      lintFailed = true;
      console.error(`Layer ${l.id} has lint errors (the app would drop it):\n  ${lint.join("\n  ")}`);
    }
  }
  if (write) {
    let byId: Map<string, DistCourse>;
    try {
      byId = loadDistCatalog(resolve(dump)).byId;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
    const page = loadPageOnly(dirname(fixturePath), new Set(byId.keys()));
    const input: FixtureInput = { programId: fx.programId, description: fx.description, layerIds: fx.layerIds, ctx: fx.ctx, plan: fx.plan };
    const filled = fillCourses(input, byId, page.byId);
    if (!filled.fixture) {
      console.error(`Not written: ${filled.missing.length} plan id(s) are in neither the catalog dump nor the saved page's lists: ${filled.missing.join(", ")}`);
      return 1;
    }
    fx = { ...fx, courses: filled.fixture.courses };
    writeFileSync(fixturePath, serializeOverlapFixture(fx));
    console.log(`Wrote ${fixturePath} (${fx.courses.length} course(s) from ${dump})`);
  }
  let r: OverlapReport;
  try {
    r = buildOverlapReport(layers, fx);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  if (lintFailed || keyProblems.length) r = { ...r, ok: false, problems: [...r.problems, ...(lintFailed ? ["a layer fails lint"] : []), ...keyProblems.map((p) => `fixture: ${p}`)] };
  console.log(renderOverlapReport(r));
  if (report) {
    const out = resolve(report);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
    console.log(`Report: ${out}`);
  }
  return r.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
