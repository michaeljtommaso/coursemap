import { solve } from "./index";
import type { DistCourse, DistributionResult, Layer, StudentContext } from "./types";

/**
 * goldenPlan.ts (spec 019 D4 step 4) — the golden-plan check for an authored
 * Distribution layer. A golden fixture is a known-good course list for a
 * fictional student (real catalog courses). It must:
 *
 *  1. score exactly 100%: every top-level row "met" (or "confirm", which is
 *     never checkable), and
 *  2. be minimal: removing any one plan course must drop the plan below 100%.
 *     A course whose removal changes nothing is "not load-bearing" — either the
 *     plan carries slack or a row is looser than the catalog page says.
 *
 * Pure: no IO. The fixture test (goldenLayers.test.ts) and the authoring CLI
 * (scripts/check-golden-layer.ts) both call runGoldenPlan.
 */

export type GoldenFixture = {
  programId: string;
  description: string;
  /** Layer ids, in solve order (college, major, concentration). */
  layerIds: string[];
  ctx: StudentContext;
  /** Course ids in board order. */
  plan: string[];
  /** Course data for every plan id (filled from the catalog by the CLI). */
  courses: DistCourse[];
};

export type GoldenUnmetRow = { layerId: string; rowId: string; status: string };

export type GoldenResult = {
  programId: string;
  ok: boolean;
  pct: number;
  /** Checkable rows that the full plan does not meet. */
  unmetRows: GoldenUnmetRow[];
  /** Plan courses whose removal still leaves every row met at 100%. */
  notLoadBearing: string[];
  /** Plan course ids with no entry in the fixture's course data. */
  unknownCourses: string[];
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

  const ok = unmetRows.length === 0 && notLoadBearing.length === 0 && unknownCourses.length === 0 && full.pct === 100;
  return { programId: fx.programId, ok, pct: full.pct, unmetRows, notLoadBearing, unknownCourses };
}

/** One readable line per problem; [] when the plan passes. */
export function describeGoldenFailure(r: GoldenResult): string[] {
  const lines: string[] = [];
  if (r.pct !== 100) lines.push(`${r.programId}: plan scores ${r.pct}%, not 100%`);
  for (const u of r.unmetRows) lines.push(`${r.programId}: row ${u.layerId}:${u.rowId} is ${u.status}`);
  for (const id of r.notLoadBearing) lines.push(`${r.programId}: ${id} is not load-bearing (removing it keeps 100%)`);
  for (const id of r.unknownCourses) lines.push(`${r.programId}: ${id} has no course data`);
  return lines;
}
