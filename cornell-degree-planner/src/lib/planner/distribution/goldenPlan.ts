import { solve } from "./index";
import type { DistCourse, DistributionResult, Layer, Row, StudentContext } from "./types";

/**
 * goldenPlan.ts (spec 019 D4 step 4) — the golden-plan check for an authored
 * Distribution layer. A golden fixture is a known-good course list for a
 * fictional student (real catalog courses). It must:
 *
 *  1. score exactly 100%: every top-level row "met" (or "confirm", which is
 *     never checkable),
 *  2. be minimal: removing any one plan course must drop the plan below 100%.
 *     A course whose removal changes nothing is "not load-bearing" — either the
 *     plan carries slack or a row is looser than the catalog page says, and
 *  3. pass its negative probes (`mustNotCount`): a course the page says a row
 *     may not count, alongside this plan, is not counted by that row. A
 *     load-bearing plan only proves a layer is not looser than THAT plan; a
 *     probe pins down a limit, an exclusion or a level floor the plan itself
 *     never touches.
 *
 * How a probe is tried. The engine counts the fewest courses that meet a row
 * and prefers earlier courses on ties, so a probe merely added to a plan that
 * already meets its row is never needed and never counted. Each probe is
 * therefore tried twice:
 *
 *  a. every probe course appended after the plan, in fixture order, on the
 *     layers as written; and
 *  b. on a copy of the layers where the probe's row wants exactly one course
 *     more than it counts on the plan alone: a pool or distribution row needs
 *     one course more (a pool or credits row also the probe's credits more);
 *     a seat, which holds one course, gives up the plan course it counted. The
 *     probe is appended after the plan. A row that takes the probe as that
 *     extra course admits it: a lost "at most one 2000-level course" limit
 *     (with one already counted), a dropped exclusion and a missing level
 *     floor all show here.
 *
 * The probe fails when its row counts the course in either solve. Probes never
 * touch checks 1 and 2, which run on the plan alone.
 *
 * Probe rows. `rowId` is a top-level row id, or "<parentId>/<childId>" for one
 * option of an anyOf (the RowUnit key the authoring tools use). The engine's
 * `attribution` lists top-level rows only: an anyOf is attributed under its
 * parent id, with the chosen option's courses. So in (a) an option probe fails
 * when the parent is attributed the course and that option's own result counts
 * it; in (b) the option stands in for its parent (same id, the parent's flags)
 * and the parent id's attribution decides. A probe on the parent id itself is
 * tried against every option.
 *
 * Pure: no IO. The fixture test (goldenLayers.test.ts) and the authoring CLI
 * (scripts/check-golden-layer.ts) both call runGoldenPlan.
 */

/** "This row must not count this course": a negative probe. */
export type GoldenProbe = {
  courseId: string;
  /** A top-level row id, or "<parentId>/<childId>" for an anyOf option. */
  rowId: string;
  /** Why the page rules it out, in the author's own words. */
  why: string;
};

export type GoldenFixture = {
  programId: string;
  description: string;
  /** Layer ids, in solve order (college, major, concentration). */
  layerIds: string[];
  ctx: StudentContext;
  /** Course ids in board order. */
  plan: string[];
  /** Negative probes; their course ids need entries in `courses` too. */
  mustNotCount?: GoldenProbe[];
  /** Course data for every plan and probe id (filled from the catalog by the CLI). */
  courses: DistCourse[];
};

export type GoldenUnmetRow = { layerId: string; rowId: string; status: string };

/** A probe the layer failed; `rowId` exactly as the fixture wrote it. */
export type GoldenForbidden = { courseId: string; layerId: string; rowId: string };

export type GoldenResult = {
  programId: string;
  ok: boolean;
  pct: number;
  /** Checkable rows that the full plan does not meet. */
  unmetRows: GoldenUnmetRow[];
  /** Plan courses whose removal still leaves every row met at 100%. */
  notLoadBearing: string[];
  /** Plan or probe course ids with no entry in the fixture's course data. */
  unknownCourses: string[];
  /** Probes whose row counted the course anyway, in fixture order. */
  forbiddenCounted: GoldenForbidden[];
};

const PASSING = new Set(["met", "confirm"]);

function unmetOf(result: DistributionResult): GoldenUnmetRow[] {
  const out: GoldenUnmetRow[] = [];
  for (const layer of result.layers) {
    for (const row of layer.rows) {
      if (!PASSING.has(row.status)) out.push({ layerId: row.layerId, rowId: row.rowId, status: row.status });
    }
  }
  return out;
}

function solveWith(layers: Layer[], courses: DistCourse[], ctx: StudentContext): DistributionResult {
  return solve({ layers, courses, ctx, waived: [] });
}

export function runGoldenPlan(layers: Layer[], fx: GoldenFixture): GoldenResult {
  const byId = new Map(fx.courses.map((c) => [c.id, c]));
  const unknownCourses: string[] = [];
  const planCourses: DistCourse[] = [];
  for (const id of fx.plan) {
    const c = byId.get(id);
    if (c) planCourses.push(c);
    else if (!unknownCourses.includes(id)) unknownCourses.push(id);
  }

  const full = solveWith(layers, planCourses, fx.ctx);
  const unmetRows = unmetOf(full);

  const notLoadBearing: string[] = [];
  for (let i = 0; i < planCourses.length; i++) {
    const without = planCourses.filter((_, j) => j !== i);
    const r = solveWith(layers, without, fx.ctx);
    if (r.pct === 100 && unmetOf(r).length === 0) notLoadBearing.push(planCourses[i].id);
  }

  const forbiddenCounted = runProbes(layers, fx, planCourses, byId, unknownCourses);

  const ok =
    unmetRows.length === 0 &&
    notLoadBearing.length === 0 &&
    unknownCourses.length === 0 &&
    forbiddenCounted.length === 0 &&
    full.pct === 100;
  return { programId: fx.programId, ok, pct: full.pct, unmetRows, notLoadBearing, unknownCourses, forbiddenCounted };
}

// ─── negative probes ─────────────────────────────────────────────────────────

/** Where a probe's row lives. `childIndex`: the anyOf option, when one is named. */
type ProbeTarget = { probe: GoldenProbe; layerIndex: number; layerId: string; rowIndex: number; childIndex: number | null };

/** Throws when the row is in no layer, or in more than one. */
function locateProbe(layers: Layer[], probe: GoldenProbe): ProbeTarget {
  const slash = probe.rowId.indexOf("/");
  const topId = slash < 0 ? probe.rowId : probe.rowId.slice(0, slash);
  const childId = slash < 0 ? null : probe.rowId.slice(slash + 1);
  const found: ProbeTarget[] = [];
  layers.forEach((layer, layerIndex) => {
    const rowIndex = layer.rows.findIndex((r) => r.id === topId);
    if (rowIndex < 0) return;
    const row = layer.rows[rowIndex];
    const base = { probe, layerIndex, layerId: layer.id, rowIndex };
    if (childId == null) found.push({ ...base, childIndex: null });
    else if (row.kind === "anyOf") {
      const k = row.rows.findIndex((c) => c.id === childId);
      if (k >= 0) found.push({ ...base, childIndex: k });
    }
  });
  if (found.length === 0) {
    throw new Error(`mustNotCount: no row "${probe.rowId}" in layers ${layers.map((l) => l.id).join(", ")}`);
  }
  if (found.length > 1) {
    throw new Error(`mustNotCount: row "${probe.rowId}" is in more than one layer (${found.map((f) => f.layerId).join(", ")})`);
  }
  return found[0];
}

function attributedTo(result: DistributionResult, courseId: string, layerId: string, rowId: string): boolean {
  return (result.attribution[courseId] ?? []).some((a) => a.layerId === layerId && a.rowId === rowId);
}

/** Solve (a): does the row, as written, count the probe course? */
function countsAsWritten(result: DistributionResult, layers: Layer[], t: ProbeTarget): boolean {
  const top = layers[t.layerIndex].rows[t.rowIndex];
  if (!attributedTo(result, t.probe.courseId, t.layerId, top.id)) return false;
  if (t.childIndex == null) return true;
  const rowResult = result.layers[t.layerIndex]?.rows.find((r) => r.rowId === top.id);
  return !!rowResult?.children?.[t.childIndex]?.courses.some((c) => c.courseId === t.probe.courseId);
}

/** The rows solve (b) tries: the row itself, or (anyOf) each option in turn —
 *  only the named one when the probe names one — standing in for its parent. */
function candidateRows(top: Row, childIndex: number | null): Row[] {
  if (top.kind !== "anyOf") return [top];
  const options = childIndex == null ? top.rows : [top.rows[childIndex]];
  return options.map((option) => ({
    ...option,
    id: top.id,
    overlay: top.overlay,
    exclusive: top.exclusive,
    appliesTo: option.appliesTo ?? top.appliesTo,
  }));
}

/** The row wanting one course more than the plan gives it (see the header),
 *  given what it counts on the plan alone; null for a row that counts nothing. */
function wantingOneMore(row: Row, held: { courseId: string; credits: number }[], probe: DistCourse): Row | null {
  const courses = held.length;
  const credits = held.reduce((s, c) => s + c.credits, 0);
  switch (row.kind) {
    case "pool":
      return {
        ...row,
        requiredCourses: Math.max(row.requiredCourses, courses) + 1,
        requiredCredits: Math.max(row.requiredCredits, credits) + probe.credits,
      };
    case "distribution":
      return { ...row, requiredCourses: Math.max(row.requiredCourses, courses) + 1 };
    case "credits":
      return { ...row, requiredCredits: Math.max(row.requiredCredits, credits) + probe.credits };
    case "seat":
      return row;
    case "anyOf":
    case "confirm":
      return null;
  }
}

function withRow(layers: Layer[], layerIndex: number, rowIndex: number, row: Row): Layer[] {
  return layers.map((l, i) => (i === layerIndex ? { ...l, rows: l.rows.map((r, j) => (j === rowIndex ? row : r)) } : l));
}

/** Solve (b) for one probe. */
function countsAsExtra(layers: Layer[], planCourses: DistCourse[], probe: DistCourse, t: ProbeTarget, ctx: StudentContext): boolean {
  const top = layers[t.layerIndex].rows[t.rowIndex];
  const plan = planCourses.filter((c) => c.id !== probe.id);
  for (const candidate of candidateRows(top, t.childIndex)) {
    if (candidate.kind === "confirm") continue;
    const base = solveWith(withRow(layers, t.layerIndex, t.rowIndex, candidate), plan, ctx);
    const held = base.layers[t.layerIndex]?.rows.find((r) => r.rowId === top.id)?.courses ?? [];
    const wanting = wantingOneMore(candidate, held, probe);
    if (!wanting) continue;
    // A seat holds one course: free it by dropping the plan course it counts.
    const offered = wanting.kind === "seat" ? plan.filter((c) => !held.some((h) => h.courseId === c.id)) : plan;
    const r = solveWith(withRow(layers, t.layerIndex, t.rowIndex, wanting), [...offered, probe], ctx);
    if (attributedTo(r, probe.id, t.layerId, top.id)) return true;
  }
  return false;
}

/** Unknown probe courses are added to `unknownCourses` and not solved on. */
function runProbes(
  layers: Layer[],
  fx: GoldenFixture,
  planCourses: DistCourse[],
  byId: Map<string, DistCourse>,
  unknownCourses: string[],
): GoldenForbidden[] {
  const probes = fx.mustNotCount ?? [];
  if (probes.length === 0) return [];
  const targets = probes.map((p) => locateProbe(layers, p));

  const known: ProbeTarget[] = [];
  for (const t of targets) {
    if (byId.has(t.probe.courseId)) known.push(t);
    else if (!unknownCourses.includes(t.probe.courseId)) unknownCourses.push(t.probe.courseId);
  }
  if (known.length === 0) return [];

  // (a) Every probe course appended after the plan, in fixture order, once each.
  const planIds = new Set(planCourses.map((c) => c.id));
  const extra: DistCourse[] = [];
  for (const t of known) {
    const c = byId.get(t.probe.courseId)!;
    if (!planIds.has(c.id) && !extra.includes(c)) extra.push(c);
  }
  const all = solveWith(layers, [...planCourses, ...extra], fx.ctx);

  return known
    .filter(
      (t) =>
        countsAsWritten(all, layers, t) ||
        countsAsExtra(layers, planCourses, byId.get(t.probe.courseId)!, t, fx.ctx),
    )
    .map((t) => ({ courseId: t.probe.courseId, layerId: t.layerId, rowId: t.probe.rowId }));
}

/** One readable line per problem; [] when the plan passes. Pass the fixture to
 *  show each failed probe's `why`. */
export function describeGoldenFailure(r: GoldenResult, fx?: Pick<GoldenFixture, "mustNotCount">): string[] {
  const lines: string[] = [];
  if (r.pct !== 100) lines.push(`${r.programId}: plan scores ${r.pct}%, not 100%`);
  for (const u of r.unmetRows) lines.push(`${r.programId}: row ${u.layerId}:${u.rowId} is ${u.status}`);
  for (const id of r.notLoadBearing) lines.push(`${r.programId}: ${id} is not load-bearing (removing it keeps 100%)`);
  for (const id of r.unknownCourses) lines.push(`${r.programId}: ${id} has no course data`);
  for (const f of r.forbiddenCounted) {
    const why = fx?.mustNotCount?.find((p) => p.courseId === f.courseId && p.rowId === f.rowId)?.why;
    lines.push(`${r.programId}: row ${f.layerId}:${f.rowId} counts ${f.courseId}, which it must not${why ? ` (${why})` : ""}`);
  }
  return lines;
}
