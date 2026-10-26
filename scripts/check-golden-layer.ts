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
// Every layer kind (Phase 5). `layerIds` lists the fixture's layers in solve
// order (college, major, concentration) and the fixture is named for the LAST
// one, the layer it proves:
//   major          layerIds [majorId],             ctx.programId = majorId
//   concentration  layerIds [majorId, majorId--c], ctx.programId = majorId,
//                  ctx.concentrationId = c (the major comes from seed-data:
//                  pass only the concentration's merged.json with --layer)
//   college        layerIds [collegeId], ctx.entryTerm/transfer chosen so the
//                  college layer's appliesTo selects this version
// fixtureProblems() refuses (exit 1) a fixture whose layers do not fit its
// student: a layer whose appliesTo excludes ctx (the plan would prove a version
// this student never gets), a ctx.programId / concentrationId that is not the
// layer's, a concentration without its major before it, or layers out of solve
// order. Rows whose own appliesTo excludes the student are dropped by the
// engine and so untested by this plan; they are listed as a note.
//
// Run (from scripts/):
//   npx tsx check-golden-layer.ts <fixture.json> [--layer <layer-or-draft.json>]...
//                                 [--dump <path>] [--write] [--report <out.json>]
//
//   --layer   use this file (bare Layer or Draft envelope) for its layer id;
//             other ids are looked up under seed-data/layers/** and layers-test/
//             (the "index": a concentration's major is resolved there).
//   --write   fill the fixture's `courses` from the catalog dump for every plan
//             and probe id, then rewrite the fixture deterministically. A course
//             the dump lacks but the page lists (a "page-only" course, found in
//             the fixture folder's verified extract.json by pageOnlyCourses) is
//             filled from the page and marked `"pageOnly": true`. Refuses (no
//             write) if an id is in neither the dump nor the page's lists.
//   --dump    catalog dump for --write (default: the authoring backup).
//   --report  write the GoldenReport JSON here, with each layer's layerSha256 so
//             a report from an earlier version of the layer is detectable.
//
// Course data is never trusted from the fixture as written: promote-layer.ts
// re-derives every plan and probe course (fixtureCourseProblems: the dump, plus
// the page-only courses of the provenance folder's verified extract) and refuses
// a fixture whose embedded course differs (subject, number, title, credits,
// attrs, ...), has a missing or extra course, or marks `pageOnly` wrongly.
// fixtureKeyProblems refuses any fixture, probe, ctx or course key outside the
// known sets (free text in an unknown key would be published unchecked).
//
// Exit: 0 plan passes, 1 plan fails (or a plan or probe id is missing from the
//       dump, or fixtureProblems), 2 bad usage or unreadable input (incl. a
//       probe naming no row, or a layer id found nowhere).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { canonicalStringify } from "./canonical-json";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { runGoldenPlan, type GoldenFixture, type GoldenProbe } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import { appliesToMatches } from "../cornell-degree-planner/src/lib/planner/distribution/select";
import { loadVerifiedExtract, pageOnlyCourses } from "./extract-catalog-page";
import {
  DEFAULT_DUMP,
  LAYERS_DIR,
  PROVENANCE_FILES,
  TEST_LAYERS_DIR,
  catalogToDist,
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

/** A course entry in a fixture: the app's course plus `pageOnly` (the course
 *  came from the saved page, not the catalog dump). */
export type FixtureCourse = DistCourse & { pageOnly?: true };

/** Plan ids, then probe ids (first occurrence order): the courses a fixture needs. */
export function fixtureCourseIds(fx: Pick<FixtureInput, "plan" | "mustNotCount">): string[] {
  return [...new Set([...fx.plan, ...(fx.mustNotCount ?? []).map((p) => p.courseId)])];
}

/** Fill `courses` from the catalog for every plan id, then every probe id
 *  (first occurrence order). An id the catalog lacks but `pageOnly` has is filled
 *  from there and marked `pageOnly: true`. `missing` lists ids neither has;
 *  then no fixture. */
export function fillCourses(
  fx: FixtureInput,
  byId: Map<string, DistCourse>,
  pageOnly: Map<string, DistCourse> = new Map(),
): { fixture: GoldenFixture; missing: [] } | { fixture: null; missing: string[] } {
  const ids = fixtureCourseIds(fx);
  const missing = ids.filter((id) => !byId.has(id) && !pageOnly.has(id));
  if (missing.length) return { fixture: null, missing };
  const courses = ids.map((id): DistCourse => (byId.has(id) ? byId.get(id)! : ({ ...pageOnly.get(id)!, pageOnly: true } as FixtureCourse)));
  return { fixture: { ...fx, courses }, missing: [] };
}

/** The page-only courses of the provenance folder `dir` (extract.json,
 *  re-derived from page.html), as dump-shaped courses. No extract.json: none.
 *  An extract that cannot be verified is an `error`, not silently none. */
export function loadPageOnly(dir: string, catalogIds: Set<string>): { byId: Map<string, DistCourse>; error?: string } {
  if (!existsSync(join(dir, PROVENANCE_FILES.extract))) return { byId: new Map() };
  try {
    const ex = loadVerifiedExtract(dir);
    return { byId: new Map(pageOnlyCourses(ex, catalogIds).map((c) => [c.id, catalogToDist(c)])) };
  } catch (e) {
    return { byId: new Map(), error: e instanceof Error ? e.message : String(e) };
  }
}

export const FIXTURE_KEYS = ["programId", "description", "layerIds", "ctx", "plan", "mustNotCount", "courses"];
export const PROBE_KEYS = ["courseId", "rowId", "why"];
export const CTX_KEYS = ["programId", "concentrationId", "concentrationIds", "entryTerm", "transfer", "transferStanding"];
export const COURSE_KEYS = ["id", "subject", "number", "title", "credits", "creditsMax", "isCredit", "creditKind", "crossListedSubjects", "attrs", "pageOnly"];

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
    if (!file) {
      const asMajor = layerIds.find((other) => other !== id && other.startsWith(`${id}--`));
      throw new Error(
        `no layer with id ${id} (pass --layer, or add it under seed-data/layers/)` +
          (asMajor ? `; ${asMajor} is a concentration of ${id}: promote the major first` : ""),
      );
    }
    return readLayerOrDraft(file);
  });
}

// ─── Fixture vs layers ──────────────────────────────────────────────────────

const KIND_RANK: Record<Layer["kind"], number> = { college: 0, major: 1, concentration: 2 };

/** Keys outside the known sets, at the top level, on probes, on ctx and on course
 *  entries. Unknown keys would carry unchecked text into a public file. */
export function fixtureKeyProblems(fx: unknown): string[] {
  const out: string[] = [];
  const unknown = (obj: unknown, known: string[]) =>
    obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj).filter((k) => !known.includes(k)) : [];
  const f = fx as Record<string, unknown>;
  for (const k of unknown(f, FIXTURE_KEYS)) out.push(`unknown fixture key "${k}"`);
  for (const k of unknown(f.ctx, CTX_KEYS)) out.push(`unknown ctx key "${k}"`);
  if (Array.isArray(f.mustNotCount))
    f.mustNotCount.forEach((p, i) => {
      for (const k of unknown(p, PROBE_KEYS)) out.push(`unknown key "${k}" on mustNotCount[${i}]`);
    });
  if (Array.isArray(f.courses))
    f.courses.forEach((c, i) => {
      for (const k of unknown(c, COURSE_KEYS)) out.push(`unknown key "${k}" on courses[${i}]`);
    });
  return out;
}

/** A course reduced to what the engine reads, in one comparable form. */
function courseSignature(c: DistCourse): string {
  const o = c as DistCourse & { isCredit?: boolean };
  const attrs = Array.isArray(o.attrs) ? o.attrs.map((a) => a.value).sort() : [];
  return canonicalStringify({
    id: o.id,
    subject: o.subject,
    number: o.number,
    title: o.title ?? null,
    credits: o.credits,
    creditsMax: o.creditsMax != null && o.creditsMax !== o.credits ? o.creditsMax : null,
    isCredit: o.isCredit ? true : null,
    creditKind: o.creditKind ?? null,
    crossListedSubjects: o.crossListedSubjects?.length ? [...o.crossListedSubjects].sort() : null,
    attrs,
  });
}

/** Every plan and probe course re-derived from the catalog dump (else the
 *  page-only courses) and compared with the fixture's embedded data. A course
 *  with no entry, an entry that differs, one marked `pageOnly` wrongly, an id in
 *  neither source, a duplicate and an entry no plan or probe needs are each a
 *  problem. [] = the embedded course data is exactly what the sources say. */
export function fixtureCourseProblems(
  fx: Pick<FixtureInput, "plan" | "mustNotCount" | "courses">,
  catalogById: Map<string, DistCourse>,
  pageOnlyById: Map<string, DistCourse>,
): string[] {
  const out: string[] = [];
  const entries = (fx.courses ?? []) as FixtureCourse[];
  const ids = fixtureCourseIds(fx);
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) out.push(`course ${e.id} appears twice in courses`);
    seen.add(e.id);
    if (!ids.includes(e.id)) out.push(`course ${e.id} is in courses but in no plan or probe`);
  }
  for (const id of ids) {
    const entry = entries.find((e) => e.id === id);
    const fromCatalog = catalogById.get(id);
    const derived = fromCatalog ?? pageOnlyById.get(id);
    if (!derived) {
      out.push(`${id} is in neither the catalog dump nor the saved page's lists`);
      continue;
    }
    if (!entry) {
      out.push(`${id} has no course data in the fixture`);
      continue;
    }
    if ((entry.pageOnly === true) !== !fromCatalog) {
      out.push(fromCatalog ? `${id} is marked pageOnly but the catalog dump has it` : `${id} is a page-only course but is not marked "pageOnly": true`);
    }
    if (courseSignature(entry) !== courseSignature(derived)) out.push(`${id}: the fixture's course data differs from ${fromCatalog ? "the catalog dump" : "the saved page"} (re-run check-golden-layer --write)`);
  }
  return out;
}

/** Ways the fixture's layers do not fit its student (see the header); [] = fits. */
export function fixtureProblems(layers: Layer[], fx: Pick<GoldenFixture, "layerIds" | "ctx">): string[] {
  const out: string[] = [];
  const ids = fx.layerIds;
  if (!ids.length) out.push("layerIds is empty");
  if (new Set(ids).size !== ids.length) out.push("layerIds names a layer twice");
  const ctx = fx.ctx;
  layers.forEach((l, i) => {
    if (i > 0 && KIND_RANK[l.kind] <= KIND_RANK[layers[i - 1].kind])
      out.push(`layerIds must be in solve order, one layer per kind (college, major, concentration): ${layers[i - 1].id} (${layers[i - 1].kind}) comes before ${l.id} (${l.kind})`);
    if (!appliesToMatches(l.appliesTo, ctx))
      out.push(`layer ${l.id} does not apply to the fixture's student (its appliesTo excludes this ctx): the plan would prove a version this student never gets`);
    if (l.kind === "major" && ctx.programId !== l.programId) out.push(`ctx.programId is ${ctx.programId}, but major layer ${l.id} is for ${l.programId}`);
    if (l.kind === "concentration") {
      const majorAt = ids.indexOf(l.programId ?? "");
      if (majorAt < 0 || majorAt > i) out.push(`concentration ${l.id} needs its major ${l.programId} in layerIds before it`);
      if (ctx.programId !== l.programId) out.push(`ctx.programId is ${ctx.programId}, but concentration ${l.id} belongs to ${l.programId}`);
      // The engine reads concentrationIds when present, else the legacy single id.
      const chosen = ctx.concentrationIds ?? (ctx.concentrationId != null ? [ctx.concentrationId] : []);
      if (chosen.length !== 1 || chosen[0] !== l.concentrationId)
        out.push(`ctx.${ctx.concentrationIds ? "concentrationIds" : "concentrationId"} is ${chosen.length ? chosen.join(", ") : "(none)"}, but the concentration layer is ${l.concentrationId} (the plan proves exactly that one)`);
    }
  });
  return out;
}

/** Row units the engine drops for this student (their appliesTo excludes ctx):
 *  the plan cannot test them. "<layerId>:<rowId>" / "<layerId>:<parent>/<child>". */
export function rowsNotApplying(layers: Layer[], ctx: GoldenFixture["ctx"]): string[] {
  const out: string[] = [];
  for (const l of layers)
    for (const row of l.rows) {
      if (!appliesToMatches(row.appliesTo, ctx)) out.push(`${l.id}:${row.id}`);
      else if (row.kind === "anyOf") for (const c of row.rows) if (!appliesToMatches(c.appliesTo, ctx)) out.push(`${l.id}:${row.id}/${c.id}`);
    }
  return out;
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
  const misfit = fixtureProblems(layers, input);
  if (misfit.length) console.error(`The fixture's layers do not fit its student:\n  ${misfit.join("\n  ")}`);
  const untested = rowsNotApplying(layers, input.ctx);
  if (untested.length) console.log(`Note: ${untested.length} row(s) do not apply to this student, so this plan does not test them: ${untested.join(", ")}`);

  let fx: GoldenFixture;
  if (args.write) {
    let byId: Map<string, DistCourse>;
    try {
      byId = loadDistCatalog(resolve(args.dump)).byId;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
    // Courses the page lists but the dump lacks: from the fixture folder's verified extract.
    const page = loadPageOnly(dirname(fixturePath), new Set(byId.keys()));
    const filled = fillCourses(input, byId, page.byId);
    if (!filled.fixture) {
      console.error(
        `Not written: ${filled.missing.length} plan or probe id(s) are in neither the catalog dump nor the saved page's lists: ${filled.missing.join(", ")}` +
          (page.error ? `\n  (the page's ${PROVENANCE_FILES.extract} could not be used: ${page.error})` : ""),
      );
      return 1;
    }
    const fromPage = filled.fixture.courses.filter((c) => (c as FixtureCourse).pageOnly).map((c) => c.id);
    if (fromPage.length) console.log(`Note: ${fromPage.length} course(s) come from the saved page, not the dump (marked pageOnly): ${fromPage.join(", ")}`);
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
  // The written report must not say ok when this run fails for a reason the
  // app's result does not carry (lint, a fixture that does not fit its student).
  if (lintFailed || misfit.length) report = { ...report, ok: false };
  if (args.report) {
    const out = resolve(args.report);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`Report: ${out}`);
  }
  if (lintFailed) console.log("GOLDEN FAILED: a layer fails lint (the app would not use it).");
  if (misfit.length) console.log("GOLDEN FAILED: the fixture's layers do not fit its student (see above).");
  return report.ok && !lintFailed && !misfit.length ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
