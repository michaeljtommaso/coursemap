// scripts/check-golden-layer.ts
// Golden-plan check for an authored Distribution layer (spec 019 D4 step 4).
// A golden fixture (seed-data/golden/layers/<programId>.json) is a known-good
// course list for a fictional student. It must score exactly 100%, and removing
// any one of its courses must drop it below 100% (every course load-bearing).
// Its optional `mustNotCount` probes ({ courseId, rowId, why }) name courses a
// row must not count alongside the plan (a limit, an exclusion, a level floor
// the plan never touches); a probe the row counts anyway fails the plan.
// The app's fixture test (goldenLayers.test.ts) runs the same check on every
// fixture; this CLI is the authoring loop around it.
//
// Run (from scripts/):
//   npx tsx check-golden-layer.ts <fixture.json> [--layer <layer-or-draft.json>]...
//                                 [--dump <path>] [--write] [--report <out.json>]
//
//   --layer   use this file (bare Layer or Draft envelope) for its layer id;
//             other ids are looked up under seed-data/layers/** and layers-test/.
//   --write   fill the fixture's `courses` from the catalog dump for every plan
//             and probe id, then rewrite the fixture deterministically. Refuses
//             (no write) if one of those ids is not in the dump.
//   --dump    catalog dump for --write (default: the authoring backup).
//   --report  write the GoldenReport JSON here, with each layer's layerSha256 so
//             a report from an earlier version of the layer is detectable.
//
// Exit: 0 plan passes, 1 plan fails (or a plan or probe id is missing from the
//       dump), 2 bad usage or unreadable input (incl. a probe naming no row).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { runGoldenPlan, type GoldenFixture, type GoldenProbe } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import {
  DEFAULT_DUMP,
  LAYERS_DIR,
  TEST_LAYERS_DIR,
  layerSha256,
  loadDistCatalog,
  readLayerOrDraft,
  type DistCourse,
  type GoldenReport,
  type Layer,
} from "./layer-authoring";

// ─── Args ───────────────────────────────────────────────────────────────────

export type GoldenArgs = { fixture: string; layers: string[]; dump: string; write: boolean; report: string | null };

export const USAGE =
  "usage: npx tsx check-golden-layer.ts <fixture.json> [--layer <layer-or-draft.json>]... [--dump <path>] [--write] [--report <out.json>]";

/** argv after the script name → args, or an error message. */
export function parseGoldenArgs(argv: string[]): GoldenArgs | { error: string } {
  const out: GoldenArgs = { fixture: "", layers: [], dump: DEFAULT_DUMP, write: false, report: null };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v == null || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "--layer") out.layers.push(value());
      else if (a === "--dump") out.dump = value();
      else if (a === "--report") out.report = value();
      else if (a === "--write") out.write = true;
      else if (a.startsWith("--")) return { error: `unknown flag ${a}` };
      else positional.push(a);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  if (positional.length !== 1) return { error: positional.length ? "exactly one fixture file" : "missing fixture file" };
  out.fixture = positional[0];
  return out;
}

// ─── Fixture fill + deterministic write ─────────────────────────────────────

/** A fixture as read from disk: `courses` may be absent before --write. */
export type FixtureInput = Omit<GoldenFixture, "courses"> & { courses?: DistCourse[] };

/** Fill `courses` from the catalog for every plan id, then every probe id
 *  (first occurrence order). `missing` lists ids the catalog does not have;
 *  then no fixture. */
export function fillCourses(
  fx: FixtureInput,
  byId: Map<string, DistCourse>,
): { fixture: GoldenFixture; missing: [] } | { fixture: null; missing: string[] } {
  const ids = [...new Set([...fx.plan, ...(fx.mustNotCount ?? []).map((p) => p.courseId)])];
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { fixture: null, missing };
  return { fixture: { ...fx, courses: ids.map((id) => byId.get(id)!) }, missing: [] };
}

const FIXTURE_KEYS = ["programId", "description", "layerIds", "ctx", "plan", "mustNotCount", "courses"];
const PROBE_KEYS = ["courseId", "rowId", "why"];
const CTX_KEYS = ["programId", "concentrationId", "entryTerm", "transfer", "transferStanding"];
const COURSE_KEYS = ["id", "subject", "number", "title", "credits", "creditsMax", "isCredit", "creditKind", "crossListedSubjects", "attrs"];

/** Known keys in the given order, then any others sorted; undefined dropped. */
function ordered(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rest = Object.keys(obj).filter((k) => !keys.includes(k)).sort();
  for (const k of [...keys, ...rest]) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** 2-space JSON, LF, trailing newline, stable key order. */
export function serializeFixture(fx: GoldenFixture | FixtureInput): string {
  const o = ordered(fx as unknown as Record<string, unknown>, FIXTURE_KEYS);
  o.ctx = ordered(fx.ctx as unknown as Record<string, unknown>, CTX_KEYS);
  if (fx.mustNotCount) o.mustNotCount = fx.mustNotCount.map((p) => ordered(p as unknown as Record<string, unknown>, PROBE_KEYS));
  if (fx.courses) {
    o.courses = fx.courses.map((c) => {
      const co = ordered(c as unknown as Record<string, unknown>, COURSE_KEYS);
      if (Array.isArray(c.attrs)) co.attrs = c.attrs.map((a) => ordered(a as unknown as Record<string, unknown>, ["value"]));
      return co;
    });
  }
  return JSON.stringify(o, null, 2) + "\n";
}

// ─── Layer lookup ───────────────────────────────────────────────────────────

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

/** Layer id → file, over the authored and test layer folders. */
export function indexLayerFiles(dirs: { dir: string; recursive: boolean }[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const { dir, recursive } of dirs) {
    for (const file of jsonFilesUnder(dir, recursive)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        continue;
      }
      const layer = raw && typeof raw === "object" && "layer" in raw ? (raw as { layer: unknown }).layer : raw;
      const id = layer && typeof layer === "object" && "id" in layer ? (layer as { id: unknown }).id : null;
      if (typeof id === "string" && !byId.has(id)) byId.set(id, file);
    }
  }
  return byId;
}

/** The fixture's layers in its order: explicit --layer files win, else the index. */
export function resolveLayers(layerIds: string[], explicit: Layer[], index: Map<string, string>): Layer[] {
  const given = new Map(explicit.map((l) => [l.id, l]));
  return layerIds.map((id) => {
    const l = given.get(id);
    if (l) return l;
    const file = index.get(id);
    if (!file) throw new Error(`no layer with id ${id} (pass --layer, or add it under seed-data/layers/)`);
    return readLayerOrDraft(file);
  });
}

// ─── Report ─────────────────────────────────────────────────────────────────

/** The app's GoldenResult plus each layer's layerSha256. */
export function buildGoldenReport(layers: Layer[], fx: GoldenFixture): GoldenReport {
  const result = runGoldenPlan(layers, fx);
  return { ...result, layerHashes: Object.fromEntries(layers.map((l) => [l.id, layerSha256(l)])) };
}

/** A row's label; "<parentId>/<childId>" names an anyOf option. */
function rowLabel(layers: Layer[], layerId: string, rowId: string): string {
  const [topId, childId] = rowId.split("/", 2);
  const top = layers.find((l) => l.id === layerId)?.rows.find((row) => row.id === topId);
  if (!top) return "(unknown row)";
  if (childId == null) return top.label;
  return (top.kind === "anyOf" ? top.rows.find((c) => c.id === childId)?.label : undefined) ?? "(unknown row)";
}

export function renderGoldenReport(r: GoldenReport, layers: Layer[], fx: Pick<GoldenFixture, "plan" | "mustNotCount">): string {
  const labelOf = (layerId: string, rowId: string) => rowLabel(layers, layerId, rowId);
  const lines = [`Golden plan for ${r.programId}: ${fx.plan.length} course(s), scores ${r.pct}%`];
  if (r.unknownCourses.length) {
    lines.push(`  No course data for ${r.unknownCourses.length} plan id(s) (run with --write to fill from the catalog):`);
    for (const id of r.unknownCourses) lines.push(`    - ${id}`);
  }
  if (r.unmetRows.length) {
    lines.push(`  ${r.unmetRows.length} row(s) not met by the full plan:`);
    for (const u of r.unmetRows) lines.push(`    - ${u.layerId}:${u.rowId} "${labelOf(u.layerId, u.rowId)}" is ${u.status}`);
  }
  if (r.notLoadBearing.length) {
    lines.push(`  ${r.notLoadBearing.length} course(s) not load-bearing (removing one still scores 100%):`);
    for (const id of r.notLoadBearing) lines.push(`    - ${id}`);
    lines.push("    Either drop it from the plan, or a row is looser than the catalog page.");
  }
  const forbidden = r.forbiddenCounted ?? [];
  if (forbidden.length) {
    lines.push(`  ${forbidden.length} probe(s) counted by a row that must not count them (the row is looser than the page):`);
    for (const f of forbidden) {
      const why = fx.mustNotCount?.find((p) => p.courseId === f.courseId && p.rowId === f.rowId)?.why;
      lines.push(`    - ${f.courseId} counted by ${f.layerId}:${f.rowId} "${labelOf(f.layerId, f.rowId)}"${why ? `: ${why}` : ""}`);
    }
  }
  lines.push(r.ok ? "GOLDEN PASSED." : "GOLDEN FAILED.");
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function isProbe(p: unknown): p is GoldenProbe {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (["courseId", "rowId", "why"] as const).every((k) => typeof o[k] === "string" && (o[k] as string).trim() !== "");
}

function readFixture(path: string): FixtureInput {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as FixtureInput;
  if (!raw || typeof raw.programId !== "string" || !Array.isArray(raw.layerIds) || !Array.isArray(raw.plan) || !raw.ctx) {
    throw new Error(`${path}: not a golden fixture (needs programId, layerIds, ctx, plan)`);
  }
  if (raw.mustNotCount !== undefined && !(Array.isArray(raw.mustNotCount) && raw.mustNotCount.every(isProbe))) {
    throw new Error(`${path}: mustNotCount must be a list of { courseId, rowId, why } (all non-empty strings)`);
  }
  return raw;
}

function main(): number {
  const args = parseGoldenArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`${args.error}\n${USAGE}`);
    return 2;
  }
  const fixturePath = resolve(args.fixture);
  let input: FixtureInput;
  let layers: Layer[];
  try {
    input = readFixture(fixturePath);
    const explicit = args.layers.map((p) => readLayerOrDraft(resolve(p)));
    const index = indexLayerFiles([
      { dir: LAYERS_DIR, recursive: true },
      { dir: TEST_LAYERS_DIR, recursive: false },
    ]);
    layers = resolveLayers(input.layerIds, explicit, index);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  let lintFailed = false;
  for (const l of layers) {
    const lint = lintLayer(l);
    if (lint.length) {
      lintFailed = true;
      console.error(`Layer ${l.id} has lint errors (the app would drop it):\n  ${lint.join("\n  ")}`);
    }
  }

  let fx: GoldenFixture;
  if (args.write) {
    let byId: Map<string, DistCourse>;
    try {
      byId = loadDistCatalog(resolve(args.dump)).byId;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
    const filled = fillCourses(input, byId);
    if (!filled.fixture) {
      console.error(`Not written: ${filled.missing.length} plan or probe id(s) are not in the catalog dump: ${filled.missing.join(", ")}`);
      return 1;
    }
    fx = filled.fixture;
    writeFileSync(fixturePath, serializeFixture(fx));
    console.log(`Wrote ${fixturePath} (${fx.courses.length} course(s) from ${args.dump})`);
  } else {
    fx = { ...input, courses: input.courses ?? [] };
  }

  let report: GoldenReport;
  try {
    report = buildGoldenReport(layers, fx);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  console.log(renderGoldenReport(report, layers, fx));
  if (args.report) {
    const out = resolve(args.report);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`Report: ${out}`);
  }
  if (lintFailed) console.log("GOLDEN FAILED: a layer fails lint (the app would not use it).");
  return report.ok && !lintFailed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
