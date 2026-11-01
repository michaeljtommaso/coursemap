import { evaluateRow, makeEnv, touches, type Env, type EvalRow, type Evaluation } from "./evaluateRow";
import { searchGroup } from "./search";
import type {
  AppliesClause,
  DistCourse,
  DistributionResult,
  Layer,
  LayerResult,
  Row,
  RowProgress,
  RowResult,
  SolveInput,
  StudentContext,
  VerifyReport,
} from "./types";

/**
 * engine.ts (spec 019 D8 + D8 amendment) — solveLayers(), the Distribution
 * engine for CAS and CALS. Stacked layers + the student's courses →
 * DistributionResult, following the counting semantics in types.ts.
 *
 * Order of work:
 *  1. Canonicalize and dedupe courses (first occurrence wins, credits keep the
 *     max — the same step as majorMatch.assign).
 *  2. Drop rows whose appliesTo excludes the student; waived rows and confirm
 *     rows are reported as such and never solved.
 *  3. Exclusive pass: every `exclusive` row across all layers, solved as one
 *     consuming group (search.ts); every course those rows count is removed
 *     from every other row in every layer — except credits rows (and credits
 *     options of an anyOf), which read ALL courses: an FWS fills nothing else,
 *     but its credits still count toward the degree total.
 *  4. Per counting group (countingGroups()): the consuming rows of the group's
 *     layers are one exact search, so a course counts at most once across
 *     them. A group is one layer, except that a major layer and every
 *     concentration of the same program with `courseSharing: "separate"` form
 *     one group. Rows still report under their own layer. Overlay rows and
 *     every credits row are evaluated alone over all remaining courses
 *     (credits rows: all courses).
 *  5. Attribution, uncounted, pct; then the optional checker (deps.verify),
 *     whose rejections downgrade rows to "unchecked".
 *
 * Fail closed: a node cap, an inexact evaluation or an exception never yields
 * "met" for a row the engine cannot prove — such rows become "unchecked".
 * solveLayers never throws.
 */

export const DEFAULT_NODE_CAP = 200_000;

export type SolveDeps = {
  verify?: (input: SolveInput, result: DistributionResult) => VerifyReport;
};

const identity = (id: string) => id;

// ─── appliesTo ───────────────────────────────────────────────────────────────

const SEASON: Record<string, number> = { WI: 0, SP: 1, SU: 2, FA: 3 };

/** "FA25" → a sortable number ordered by (year, WI < SP < SU < FA). Strict: no
 *  trimming or case folding; anything else is unknown (null). */
export function termKey(term: string | null | undefined): number | null {
  if (!term) return null;
  const m = /^(FA|SP|SU|WI)(\d{2})$/.exec(term);
  if (!m) return null;
  return Number(m[2]) * 4 + SEASON[m[1]];
}

function clauseMatches(clause: AppliesClause, ctx: StudentContext): boolean {
  if (clause.enteredFrom != null || clause.enteredBefore != null) {
    const entry = termKey(ctx.entryTerm);
    if (entry == null) return false;
    if (clause.enteredFrom != null) {
      const from = termKey(clause.enteredFrom);
      if (from == null || entry < from) return false;
    }
    if (clause.enteredBefore != null) {
      const before = termKey(clause.enteredBefore);
      if (before == null || entry >= before) return false;
    }
  }
  if (clause.transfer != null && (ctx.transfer == null || !clause.transfer.includes(ctx.transfer))) return false;
  if (
    clause.transferStanding != null &&
    (ctx.transferStanding == null || !clause.transferStanding.includes(ctx.transferStanding))
  ) {
    return false;
  }
  return true;
}

/** Absent → applies to everyone; an empty list (an OR of nothing) to no one. */
export function appliesToStudent(clauses: AppliesClause[] | undefined, ctx: StudentContext): boolean {
  if (!clauses) return true;
  return clauses.some((c) => clauseMatches(c, ctx));
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function dedupe(courses: DistCourse[], canonical: (id: string) => string): DistCourse[] {
  const out: DistCourse[] = [];
  const seen = new Map<string, number>();
  for (const c of courses) {
    const id = canonical(c.id);
    const at = seen.get(id);
    if (at === undefined) {
      seen.set(id, out.length);
      out.push({ ...c, id });
    } else if (c.credits > out[at].credits) {
      out[at] = { ...out[at], credits: c.credits };
    }
  }
  return out;
}

/** The targets a row states, without any "have" figures. */
function needsOf(row: Row): RowProgress {
  switch (row.kind) {
    case "seat":
      return { coursesNeed: 1 };
    case "pool":
      return { coursesNeed: row.requiredCourses, creditsNeed: row.requiredCredits };
    case "credits":
      return { creditsNeed: row.requiredCredits };
    case "distribution":
      return { coursesNeed: row.requiredCourses, categoriesNeed: row.minDistinctCategories };
    default:
      return {};
  }
}

function bareResult(layerId: string, row: Row, status: RowResult["status"]): RowResult {
  const result: RowResult = {
    layerId,
    rowId: row.id,
    kind: row.kind,
    label: row.label,
    group: row.group,
    status,
    courses: [],
    progress: status === "unchecked" ? needsOf(row) : {},
    fraction: 0,
  };
  if (row.kind === "anyOf") {
    const childStatus = status === "unchecked" ? "unchecked" : "unmet";
    result.children = row.rows.map((child) => bareResult(layerId, child, childStatus));
  }
  return result;
}

function uncheckedResult(layerId: string, row: Row, reason: NonNullable<RowResult["reason"]>): RowResult {
  const result = bareResult(layerId, row, "unchecked");
  result.reason = reason;
  result.children?.forEach((c) => (c.reason = reason));
  return result;
}

function toResult(layerId: string, row: EvalRow, ev: Evaluation, courses: DistCourse[]): RowResult {
  const status: RowResult["status"] = ev.met
    ? "met"
    : ev.counted.length > 0 || ev.fraction > 0
      ? "partial"
      : "unmet";
  const result: RowResult = {
    layerId,
    rowId: row.id,
    kind: row.kind,
    label: row.label,
    group: row.group,
    status,
    courses: ev.counted.map((i) => {
      const cats = ev.categories?.get(i);
      return {
        courseId: courses[i].id,
        credits: courses[i].credits,
        ...(cats ? { categories: cats } : {}),
      };
    }),
    progress: ev.progress,
    fraction: ev.met ? 1 : ev.fraction,
  };
  if (row.kind === "anyOf" && ev.children) {
    const kids = ev.children;
    result.children = row.rows.map((child, k) => toResult(layerId, child, kids[k], courses));
  }
  return result;
}

/**
 * Evaluation → result, failing closed. An unmet row is unproven when its
 * search hit the node cap or its own evaluation ran out of budget. It still
 * shows its best-found progress when `bound()` — the row evaluated over every
 * course it could ever be offered — is exact and unmet: evaluators are
 * monotone, so no assignment meets it. Only a row that might be met becomes
 * "unchecked".
 */
function finish(
  layerId: string,
  row: EvalRow,
  ev: Evaluation,
  courses: DistCourse[],
  cappedRun: boolean,
  bound: () => Evaluation
): { result: RowResult; capped: boolean } {
  if (!ev.met && (cappedRun || !ev.exact)) {
    const best = bound();
    if (!best.exact || best.met) return { result: uncheckedResult(layerId, row, "node-cap"), capped: true };
  }
  return { result: toResult(layerId, row, ev, courses), capped: false };
}

// ─── planning ────────────────────────────────────────────────────────────────

type Mode = "waived" | "confirm" | "exclusive" | "consume" | "independent";

type Slot = {
  layerIdx: number;
  layerId: string;
  row: Row;
  mode: Mode;
  result?: RowResult;
};

function isIndependent(row: EvalRow, env: Env): boolean {
  if (row.overlay || row.kind === "credits") return true;
  if (row.kind === "anyOf") return row.rows.every((c) => c.kind === "credits" || env.excluded.has(c));
  return false;
}

function plan(input: SolveInput, env: Env, waived: Set<string>): Slot[][] {
  return input.layers.map((layer, layerIdx) => {
    const slots: Slot[] = [];
    for (const row of layer.rows) {
      if (!appliesToStudent(row.appliesTo, input.ctx)) continue;
      const base = { layerIdx, layerId: layer.id, row };
      if (waived.has(`${layer.id}:${row.id}`)) {
        slots.push({ ...base, mode: "waived", result: bareResult(layer.id, row, "waived") });
      } else if (row.kind === "confirm") {
        slots.push({ ...base, mode: "confirm", result: bareResult(layer.id, row, "confirm") });
      } else {
        if (row.kind === "anyOf") {
          for (const child of row.rows) if (!appliesToStudent(child.appliesTo, input.ctx)) env.excluded.add(child);
        }
        slots.push({ ...base, mode: row.exclusive ? "exclusive" : row.overlay || row.kind === "credits" ? "independent" : "consume" });
      }
    }
    // anyOf rows made only of credits options consume nothing.
    for (const s of slots) {
      if (s.mode === "consume" && isIndependent(s.row as EvalRow, env)) s.mode = "independent";
    }
    return slots;
  });
}

// ─── counting groups ─────────────────────────────────────────────────────────

/**
 * The layers whose consuming rows share one "a course counts once" budget, as
 * lists of layer indices. Every layer is its own group, except: a
 * concentration layer with `courseSharing: "separate"` joins the first major
 * layer of the same (non-empty) programId, so the major and all its separate
 * concentrations are one group. A separate concentration whose major is not
 * in the solve stays on its own; college layers and "shared" concentrations
 * are always alone. Groups come in order of their first layer, members in
 * layer order — deterministic for the search's tie-breaks.
 */
export function countingGroups(layers: readonly Layer[]): number[][] {
  const groups = new Map<number, number[]>();
  layers.forEach((layer, i) => {
    let key = i;
    if (layer.kind === "concentration" && layer.courseSharing === "separate" && layer.programId) {
      const major = layers.findIndex((l) => l.kind === "major" && l.programId === layer.programId);
      if (major >= 0) key = major;
    }
    const members = groups.get(key);
    if (members) members.push(i);
    else groups.set(key, [i]);
  });
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

// ─── solveLayers ─────────────────────────────────────────────────────────────

export function solveLayers(input: SolveInput, deps: SolveDeps = {}): DistributionResult {
  let result: DistributionResult;
  try {
    result = solve(input);
  } catch (err) {
    console.error("[distribution] engine error outside a layer", err);
    result = finalize(
      input.layers.map((layer) => ({
        layerId: layer.id,
        kind: layer.kind,
        name: layer.name,
        rows: layer.rows.map((row) => uncheckedResult(layer.id, row, "engine-error")),
      })),
      [],
      0,
      false
    );
  }
  if (deps.verify) applyVerify(input, result, deps.verify);
  return result;
}

function solve(input: SolveInput): DistributionResult {
  const canonical = input.canonical ?? identity;
  const courses = dedupe(input.courses, canonical);
  const env = makeEnv(courses, { programId: input.ctx.programId, canonical, answers: input.answers });
  const nodeCap = input.nodeCap ?? DEFAULT_NODE_CAP;
  const waived = new Set(input.waived ?? []);
  const allIdx = courses.map((_, i) => i);

  const slots = plan(input, env, waived);
  let nodes = 0;
  let capped = false;

  // ── Exclusive pass, across every layer in layer order. ──
  const exclusive = slots.flat().filter((s) => s.mode === "exclusive");
  const removed = new Set<number>();
  if (exclusive.length > 0) {
    let unsure = false;
    try {
      const consuming = exclusive.filter((s) => !isIndependent(s.row as EvalRow, env));
      const independent = exclusive.filter((s) => isIndependent(s.row as EvalRow, env));
      // Among equally good choices, an exclusive row takes the courses the
      // fewest other rows could use (credits rows lose nothing to it).
      const others = slots
        .flat()
        .filter((s) => (s.mode === "consume" || s.mode === "independent") && s.row.kind !== "credits")
        .map((s) => s.row as EvalRow);
      const wanted = new Map(allIdx.map((i) => [i, others.filter((row) => touches(row, i, env)).length]));
      const run = searchGroup(
        consuming.map((s) => s.row as EvalRow),
        allIdx,
        nodeCap,
        env,
        allIdx,
        (i) => wanted.get(i) ?? 0
      );
      nodes += run.nodes;
      if (run.capped) {
        capped = true;
        unsure = true;
      }
      const evals = new Map<Slot, Evaluation>();
      consuming.forEach((s, k) => evals.set(s, run.evals[k]));
      for (const s of independent) evals.set(s, evaluateRow(s.row as EvalRow, { offered: allIdx, all: allIdx }, env));
      for (const s of exclusive) {
        const ev = evals.get(s) as Evaluation;
        const row = s.row as EvalRow;
        const bound = () => evaluateRow(row, { offered: allIdx, all: allIdx }, env);
        const done = finish(s.layerId, row, ev, courses, run.capped && consuming.includes(s), bound);
        s.result = done.result;
        if (done.capped) unsure = true;
        for (const i of ev.counted) removed.add(i);
      }
    } catch (err) {
      console.error("[distribution] engine error in the exclusive pass", err);
      for (const s of exclusive) s.result = uncheckedResult(s.layerId, s.row, "engine-error");
      unsure = true;
    }
    if (unsure) {
      // The pass is not proven, so fence off every course an exclusive row
      // could have used: other rows only get harder, never falsely met.
      capped = true;
      for (const s of exclusive) for (const i of allIdx) if (touches(s.row as EvalRow, i, env)) removed.add(i);
    }
  }
  const avail = allIdx.filter((i) => !removed.has(i));

  // ── Each counting group on its own (usually one layer). ──
  for (const members of countingGroups(input.layers)) {
    // Layer order, authored order inside a layer: the search's tie-breaks.
    const groupSlots = members.flatMap((li) => slots[li]);
    const consuming = groupSlots.filter((s) => s.mode === "consume");
    const independent = groupSlots.filter((s) => s.mode === "independent");
    try {
      if (consuming.length > 0) {
        const run = searchGroup(
          consuming.map((s) => s.row as EvalRow),
          avail,
          nodeCap,
          env,
          allIdx
        );
        nodes += run.nodes;
        if (run.capped) capped = true;
        consuming.forEach((s, k) => {
          const row = s.row as EvalRow;
          const bound = () => evaluateRow(row, { offered: avail, all: allIdx }, env);
          const done = finish(s.layerId, row, run.evals[k], courses, run.capped, bound);
          s.result = done.result;
          if (done.capped) capped = true;
        });
      }
      for (const s of independent) {
        const ev = evaluateRow(s.row as EvalRow, { offered: avail, all: allIdx }, env);
        // An independent row already saw every course: its bound is itself.
        const done = finish(s.layerId, s.row as EvalRow, ev, courses, false, () => ev);
        s.result = done.result;
        if (done.capped) capped = true;
      }
    } catch (err) {
      const where = members.map((li) => input.layers[li].id).join(" + ");
      console.error(`[distribution] engine error in layer ${where}`, err);
      for (const s of [...consuming, ...independent]) s.result = uncheckedResult(s.layerId, s.row, "engine-error");
    }
  }

  const layers: LayerResult[] = input.layers.map((layer, li) => ({
    layerId: layer.id,
    kind: layer.kind,
    name: layer.name,
    rows: slots[li].map((s) => s.result ?? uncheckedResult(s.layerId, s.row, "engine-error")),
  }));
  return finalize(layers, courses.map((c) => c.id), nodes, capped);
}

/** Attribution, uncounted and pct from the layer results. */
function finalize(layers: LayerResult[], courseIds: string[], nodes: number, capped: boolean): DistributionResult {
  const result: DistributionResult = { layers, attribution: {}, uncounted: [], pct: 0, nodes, capped, verifyLog: [] };
  recompute(result, courseIds);
  return result;
}

function recompute(result: DistributionResult, courseIds: string[]): void {
  const attribution: DistributionResult["attribution"] = {};
  let sum = 0;
  let scored = 0;
  for (const layer of result.layers) {
    for (const row of layer.rows) {
      if (row.status !== "confirm" && row.status !== "waived") {
        sum += row.fraction;
        scored++;
      }
      for (const c of row.courses) {
        const list = (attribution[c.courseId] ??= []);
        if (!list.some((a) => a.layerId === layer.layerId && a.rowId === row.rowId)) {
          list.push({ layerId: layer.layerId, rowId: row.rowId });
        }
      }
    }
  }
  result.attribution = attribution;
  result.uncounted = courseIds.filter((id) => !(id in attribution));
  result.pct = scored > 0 ? Math.round((100 * sum) / scored) : 0;
}

// ─── checker hook ────────────────────────────────────────────────────────────

function downgrade(row: RowResult, needs: RowProgress): void {
  row.status = "unchecked";
  row.reason = "verify-rejected";
  row.fraction = 0;
  row.courses = [];
  row.progress = needs;
  row.children?.forEach((c) => downgrade(c, {}));
}

function applyVerify(input: SolveInput, result: DistributionResult, verify: NonNullable<SolveDeps["verify"]>): void {
  const defs = new Map<string, Row>();
  for (const layer of input.layers) for (const row of layer.rows) defs.set(`${layer.id}:${row.id}`, row);
  const rowsByKey = new Map<string, RowResult>();
  for (const layer of result.layers) for (const row of layer.rows) rowsByKey.set(`${layer.layerId}:${row.rowId}`, row);

  // A rejection that names no row (a wildcard, or a key that resolves to
  // nothing) is a claim against the result as a whole: no claim survives.
  const everything = (reason: string) =>
    [...rowsByKey.values()]
      .filter((r) => r.status === "met" || r.status === "partial")
      .map((r) => ({ layerId: r.layerId, rowId: r.rowId, reason }));

  let rejections: VerifyReport["rejections"];
  try {
    rejections = verify(input, result).rejections;
  } catch (err) {
    console.error("[distribution] checker failed", err);
    rejections = everything("checker failed to run");
  }

  const unresolved = rejections.filter((rej) => !rowsByKey.has(`${rej.layerId}:${rej.rowId}`));
  for (const rej of unresolved) {
    const line = `${rej.layerId}:${rej.rowId} rejected: ${rej.reason} (names no row; every claim withdrawn)`;
    result.verifyLog.push(line);
    console.error(`[distribution] ${line}`);
  }
  if (unresolved.length > 0) {
    const named = new Set(rejections.map((rej) => `${rej.layerId}:${rej.rowId}`));
    const rest = everything(`withdrawn: ${unresolved[0].reason}`).filter((rej) => !named.has(`${rej.layerId}:${rej.rowId}`));
    rejections = [...rejections.filter((rej) => !unresolved.includes(rej)), ...rest];
  }

  for (const rej of rejections) {
    const key = `${rej.layerId}:${rej.rowId}`;
    const line = `${key} rejected: ${rej.reason}`;
    result.verifyLog.push(line);
    console.error(`[distribution] ${line}`);
    const row = rowsByKey.get(key);
    const def = defs.get(key);
    if (row && def) downgrade(row, needsOf(def));
  }
  rejections = [...rejections, ...unresolved];
  if (rejections.length > 0) {
    const canonical = input.canonical ?? identity;
    recompute(
      result,
      dedupe(input.courses, canonical).map((c) => c.id)
    );
  }
}
