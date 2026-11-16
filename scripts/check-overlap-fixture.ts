// scripts/check-overlap-fixture.ts
// The overlap fixture of a minor layer (spec 047 D7/D12; the authoring review's
// "second fixture: the minor with a real major where the overlap limit binds").
// A minor's golden plan proves the minor alone; this fixture proves its
// `sharing` limit is real (required when the minor sets sharing.otherMajors,
// overlapFixtureRequired; a minor with no limit toward majors has nothing to
// hold back): a plan for a fictional student whose major (a
// promoted major layer from seed-data/layers/, or an Engineering major's slot
// template, see "Engineering majors" below) and minor count more courses in
// common than the pair's limit allows, and the courses the limit holds back.
//
// The fixture (golden-overlap.json in the minor's provenance folder; promoted
// to seed-data/golden/overlap/<minorId>.json):
//   programId    the minor layer id (the file is named for it)
//   description  one plain sentence in the author's own words (published)
//   layerIds     [<major layer id or Engineering program id>, <minor layer id>]
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
// Engineering majors (runTemplateOverlapFixture). The 13 Engineering majors are
// not layers: the app matches their slot template (seed-data/programs.json, or
// seed-data/programs-2025/<id>.json, with each slot's category as
// backfill-slot-categories.ts writes it live) and solves a minor beside it with
// the Distribution engine (requirementProgress.ts withExtraPrograms). A fixture
// whose first layerIds entry is such a program id is checked through that same
// code, computeRequirementProgress, not a re-implementation:
//   - what the major counts toward overlap is the app's (every matched
//     requirement except liberal studies, FWS and PE), and so is the pair's
//     limit (the minor's sharing toward the major; a template sets none);
//   - "shared" is the pair as the app measures it on the board with nothing
//     held back (the minor's toward-majors limit swapped for one no plan can
//     reach, so the app reports the pair without enforcing it);
//   - the Engineering major is never re-solved, so the app only holds courses
//     back from the minor: every heldBack must be from the minor; with them
//     removed from the minor's rows the pair is within the limit;
//   - and the app's own D7 loop on the real layers ends within the limit,
//     holding back as many courses as the fixture names, each from the minor.
// ctx.programId must be the Engineering program id; ctx.entryTerm is passed
// as the app passes the plan's entry term. The report's layerHashes carry the
// program's templateSha256 under its id.
//
// Run (from scripts/):
//   npx tsx check-overlap-fixture.ts <golden-overlap.json> [--layer <layer-or-draft.json>]...
//                                    [--dump <path>] [--write] [--report <out.json>]
// Layers not given with --layer come from seed-data/layers/** (the major must
// be promoted, or be an Engineering program in seed-data). --write fills
// `courses` from the catalog dump (plus the saved page's page-only courses of
// the fixture's folder) and rewrites the fixture deterministically. --report
// writes the OverlapReport with each layer's layerSha256 (overlap-report.json,
// which the review sheet and promote-layer require for a minor).
// Exit: 0 passes, 1 fails, 2 bad usage or unreadable input.

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { solve } from "../cornell-degree-planner/src/lib/planner/distribution/index";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { holdBackLayers } from "../cornell-degree-planner/src/lib/planner/distribution/overlap";
import type { DistributionResult, SharingLimit, StudentContext } from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { computeRequirementProgress } from "../cornell-degree-planner/src/lib/planner/requirementProgress";
import { deriveSlotCategory } from "../cornell-degree-planner/src/lib/planner/slotCategory";
import { normalizeProgramSlots } from "../cornell-degree-planner/src/lib/normalize/normalizeProgram";
import { ProgramSchema } from "../cornell-degree-planner/src/lib/schemas";
import type { Course, ProgramSlotWithData } from "../cornell-degree-planner/src/types/db";
import type { OverlapPair, RequirementProgress } from "../cornell-degree-planner/src/hooks/useRequirementProgress";
import type { LoadedProgram } from "../cornell-degree-planner/src/hooks/useAdditionalProgramData";
import { canonicalStringify } from "./canonical-json";
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
  /** Layer id → layerSha256() of the layer this report was computed on (an
   *  Engineering major: its program id → templateSha256()). */
  layerHashes?: Record<string, string>;
  /** Engineering majors: what the app's own D7 loop held back ("<courseId> from <programId>"). */
  appHeldBack?: string[];
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

// ─── Engineering majors (slot templates) ────────────────────────────────────

export const SEED_DIR = resolve(__dirname, "seed-data");

/** An Engineering major as seeded: its program doc (slots, elective groups). */
export type TemplateProgram = { id: string; name: string; shortName: string; doc: Record<string, unknown> };

/** The Engineering program with this id from seed-data (programs-2025/<id>.json,
 *  else an entry of programs.json), or null when there is none. */
export function loadTemplateProgram(programId: string, seedDir: string = SEED_DIR): TemplateProgram | null {
  if (!/^[a-z0-9-]+$/.test(programId)) return null;
  let doc: Record<string, unknown> | undefined;
  const own = join(seedDir, "programs-2025", `${programId}.json`);
  if (existsSync(own)) doc = JSON.parse(readFileSync(own, "utf-8")) as Record<string, unknown>;
  else if (existsSync(join(seedDir, "programs.json"))) {
    const all = JSON.parse(readFileSync(join(seedDir, "programs.json"), "utf-8")) as Record<string, unknown>[];
    doc = all.find((p) => p.id === programId);
  }
  if (!doc || doc.id !== programId || !Array.isArray(doc.slots)) return null;
  return { id: programId, name: String(doc.name ?? programId), shortName: String(doc.shortName ?? doc.name ?? programId), doc };
}

/** sha256 of the program doc's canonical JSON (the report's hash for a template major). */
export function templateSha256(p: TemplateProgram): string {
  return createHash("sha256").update(canonicalStringify(p.doc)).digest("hex");
}

/** The program's slots as the app reads them: the doc parsed and normalized
 *  (normalizeProgramSlots), each slot without a category given the one
 *  backfill-slot-categories.ts writes live, course slots carrying the fixture's
 *  course data as their snapshot (as the seeders copy it from the catalog). */
export function templateSlots(p: TemplateProgram, coursesById: Map<string, DistCourse>): ProgramSlotWithData[] {
  const groups = new Map(((p.doc.electiveGroups as Record<string, unknown>[] | undefined) ?? []).map((g) => [g.id as string, g]));
  const slots = (p.doc.slots as Record<string, unknown>[]).map((s) => {
    const out: Record<string, unknown> = { ...s };
    if (out.category == null) {
      const group = typeof s.electiveGroupId === "string" ? groups.get(s.electiveGroupId) : undefined;
      out.category = deriveSlotCategory(s as Parameters<typeof deriveSlotCategory>[0], group as Parameters<typeof deriveSlotCategory>[1]);
    }
    const c = s.kind === "course" && typeof s.courseId === "string" ? coursesById.get(s.courseId) : undefined;
    if (c) Object.assign(out, { courseTitle: c.title, creditsMin: c.credits, creditsMax: c.credits, courseSubject: c.subject, courseNumber: c.number });
    return out;
  });
  return normalizeProgramSlots(ProgramSchema.parse({ ...p.doc, slots }));
}

/** A fixture course as the board's course record. */
function boardCourse(c: DistCourse): Course {
  return {
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    credits_min: c.credits,
    credits_max: c.credits,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: c.attrs ?? [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  } as unknown as Course;
}

/** A toward-majors limit no plan reaches: the app then reports the pair as it
 *  measures it, without holding anything back. */
const MEASURE_ONLY: SharingLimit = { maxCourses: Number.MAX_SAFE_INTEGER };

function capOfPairLimit(l: SharingLimit | "forbidden" | undefined): OverlapCap | null {
  if (l == null || l === "forbidden") return null;
  if (l === "none") return { maxCourses: 0 };
  const cap: OverlapCap = {};
  if (l.maxCourses != null) cap.maxCourses = l.maxCourses;
  if (l.maxCredits != null) cap.maxCredits = l.maxCredits;
  return cap;
}

/** Every check in the header's "Engineering majors", through the app's
 *  computeRequirementProgress. Pure (reads nothing but its arguments). */
export function runTemplateOverlapFixture(program: TemplateProgram, minor: Layer, fx: OverlapFixture): OverlapReport {
  const problems: string[] = [];
  const base: OverlapReport = { programId: fx.programId, ok: false, problems, limit: null, sharedBefore: [], sharedAfter: [], pctBefore: {}, pctAfter: {} };
  if (fx.layerIds.length !== 2 || fx.layerIds[0] !== program.id || fx.layerIds[1] !== minor.id) {
    problems.push(`layerIds must be ["${program.id}", "${minor.id}"] (the Engineering major, then the minor)`);
    return base;
  }
  if (minor.kind !== "minor") problems.push(`${minor.id} is a ${minor.kind} layer; the second layer must be the minor`);
  if (fx.programId !== minor.id) problems.push(`the fixture is for ${fx.programId}, but its minor layer is ${minor.id}`);
  if (fx.ctx?.programId !== program.id) problems.push(`ctx.programId is ${fx.ctx?.programId}, but the fixture's major is ${program.id}`);
  problems.push(...fixtureProblems([minor], { layerIds: [minor.id], ctx: fx.ctx }));
  if (problems.length) return base;

  const byId = new Map(fx.courses.map((c) => [c.id, c]));
  const unknown = fx.plan.filter((id) => !byId.has(id));
  if (unknown.length) {
    problems.push(`no course data for plan id(s) ${unknown.join(", ")} (run with --write)`);
    return base;
  }
  let slots: ProgramSlotWithData[];
  try {
    slots = templateSlots(program, byId);
  } catch (e) {
    problems.push(`${program.id}'s program doc does not parse as the app reads it: ${(e as Error).message}`);
    return base;
  }
  const minorPid = minor.programId ?? minor.id;
  const placedCourses: Record<string, Course> = Object.fromEntries(fx.courses.map((c) => [c.id, boardCourse(c)]));
  const placements = fx.plan.map((courseId, i) => ({ id: `p${i}-${courseId}`, courseId, sem: 1 + Math.floor((i * 8) / Math.max(1, fx.plan.length)), order: i }));
  const run = (layer: Layer): { progress: RequirementProgress; pair: OverlapPair | undefined; pct: Record<string, number> } => {
    const loaded: LoadedProgram = { programId: minorPid, kind: "minor", name: layer.name, shortName: layer.name, layers: [layer], ...(layer.sharing ? { sharing: layer.sharing } : {}), status: "ok" };
    const progress = computeRequirementProgress({
      templateSlots: slots,
      placements,
      placedCourses,
      creditProfile: [],
      waivedRequirementIds: [],
      canonical: (id) => id,
      entryTerm: fx.ctx.entryTerm ?? null,
      programId: program.id,
      primaryName: { name: program.name, shortName: program.shortName },
      extraPrograms: [loaded],
    });
    const pct: Record<string, number> = {};
    for (const s of progress.sections ?? []) if (s.id === program.id || s.id === minorPid) pct[s.id === minorPid ? minor.id : s.id] = s.pct;
    return { progress, pair: progress.overlap?.find((p) => p.a === program.id && p.b === minorPid), pct };
  };
  const measuring = (layer: Layer): Layer => ({ ...layer, sharing: { ...(layer.sharing ?? {}), otherMajors: MEASURE_ONLY } });
  const creditsOf = (id: string) => byId.get(id)?.credits ?? 0;

  // Before: the pair as the app measures it with nothing held back.
  const before = run(measuring(minor));
  const pctBefore = before.pct;
  if (pctBefore[minor.id] !== 100) problems.push(`the plan does not complete the minor on its own (${pctBefore[minor.id] ?? 0}%): add the courses it needs`);
  const sharedBefore = sortedIds(before.pair?.sharedCourseIds ?? []);

  // The app's own run on the real layers: the limit and its D7 loop.
  const actual = run(minor);
  if (actual.pair?.limit === "forbidden") problems.push(`the app reads ${program.id} and ${minor.id} as a forbidden pair: nothing is held back, so an overlap fixture cannot prove a limit`);
  const limit = capOfPairLimit(actual.pair?.limit);
  if (!limit && actual.pair?.limit !== "forbidden")
    problems.push(`the two programs set no limit for this pair (${minor.id}'s sharing toward majors; an Engineering template sets none): an overlap fixture needs a binding limit`);
  if (!sameCap(limit, fx.limit ?? null)) problems.push(`the fixture's limit is ${describeCap(fx.limit ?? null)}, but the app gives ${describeCap(limit)}`);
  const declared = sortedIds(fx.shared ?? []);
  if (JSON.stringify(declared) !== JSON.stringify(sharedBefore))
    problems.push(`the fixture says the shared courses are [${declared.join(", ")}], but both programs count [${sharedBefore.join(", ")}]`);
  if (limit && within(limit, sharedBefore, creditsOf))
    problems.push(`the limit does not bind: ${sharedBefore.length} shared course(s) are within ${describeCap(limit)}; add a course both programs count`);

  // The fixture's hold-back, from the minor only.
  const held = fx.heldBack ?? [];
  if (!held.length) problems.push("heldBack is empty: name the course(s) the limit holds back, and from which program");
  const seen = new Set<string>();
  for (const h of held) {
    if (seen.has(h.courseId)) problems.push(`heldBack names ${h.courseId} twice`);
    seen.add(h.courseId);
    if (!sharedBefore.includes(h.courseId)) problems.push(`heldBack ${h.courseId} is not a shared course`);
    if (h.from === program.id) problems.push(`heldBack ${h.courseId} is held from ${program.id}, but the app never re-solves an Engineering major: hold it back from ${minor.id}`);
    else if (h.from !== minor.id) problems.push(`heldBack ${h.courseId} is held from ${h.from}, which is not the minor ${minor.id}`);
    if (!h.why?.trim()) problems.push(`heldBack ${h.courseId} needs a why`);
  }
  const minorHeld = [...new Set(held.filter((h) => h.from === minor.id).map((h) => h.courseId))];
  const [heldLayer] = holdBackLayers([measuring(minor)], new Map([[minor.id, minorHeld]]));
  const after = run(heldLayer);
  const sharedAfter = sortedIds(after.pair?.sharedCourseIds ?? []);
  if (limit && !within(limit, sharedAfter, creditsOf))
    problems.push(`after the hold-back the pair still shares [${sharedAfter.join(", ")}], over ${describeCap(limit)}: hold back more`);
  for (const id of minorHeld) if (sharedAfter.includes(id)) problems.push(`${id} still counts for both after it is held back`);

  // The app's D7 loop must land within the limit, holding back as many
  // courses as the fixture names, each from the minor.
  const appHeld = actual.pair?.heldBack ?? [];
  const appHeldBack = appHeld.map((h) => `${h.courseId} from ${h.heldFrom}`);
  if (limit && actual.pair && !within(limit, actual.pair.sharedCourseIds, creditsOf))
    problems.push(`the app's own overlap loop leaves the pair sharing [${sortedIds(actual.pair.sharedCourseIds).join(", ")}], over ${describeCap(limit)}`);
  if (limit && appHeld.length !== held.length)
    problems.push(`the app holds back ${appHeld.length} course(s) [${appHeldBack.join(", ")}], but the fixture names ${held.length}`);
  for (const h of appHeld) if (h.heldFrom !== minorPid) problems.push(`the app holds ${h.courseId} back from ${h.heldFrom}, not the minor`);

  return { programId: fx.programId, ok: problems.length === 0, problems, limit, sharedBefore, sharedAfter, pctBefore, pctAfter: after.pct, appHeldBack };
}

export function buildTemplateOverlapReport(program: TemplateProgram, minor: Layer, fx: OverlapFixture): OverlapReport {
  return { ...runTemplateOverlapFixture(program, minor, fx), layerHashes: { [program.id]: templateSha256(program), [minor.id]: layerSha256(minor) } };
}

export function renderOverlapReport(r: OverlapReport): string {
  const lines = [
    `Overlap fixture for ${r.programId}: limit ${describeCap(r.limit)}`,
    `  shared before: [${r.sharedBefore.join(", ")}]  after: [${r.sharedAfter.join(", ")}]`,
    `  pct before: ${Object.entries(r.pctBefore).map(([k, v]) => `${k} ${v}%`).join(", ")}  after: ${Object.entries(r.pctAfter).map(([k, v]) => `${k} ${v}%`).join(", ")}`,
  ];
  if (r.appHeldBack) lines.push(`  the app's own overlap loop holds back: [${r.appHeldBack.join(", ")}]`);
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
  let template: TemplateProgram | null = null;
  try {
    fx = readOverlapFixture(fixturePath);
    const explicit = layersArg.map((p) => readLayerOrDraft(resolve(p)));
    const index = indexLayerFiles([
      { dir: LAYERS_DIR, recursive: true },
      { dir: TEST_LAYERS_DIR, recursive: false },
    ]);
    // A major that is no layer may be an Engineering major's slot template.
    const majorId = fx.layerIds[0];
    if (fx.layerIds.length === 2 && majorId && !explicit.some((l) => l.id === majorId) && !index.has(majorId)) template = loadTemplateProgram(majorId);
    layers = resolveLayers(template ? fx.layerIds.slice(1) : fx.layerIds, explicit, index);
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
    r = template ? buildTemplateOverlapReport(template, layers[0], fx) : buildOverlapReport(layers, fx);
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
