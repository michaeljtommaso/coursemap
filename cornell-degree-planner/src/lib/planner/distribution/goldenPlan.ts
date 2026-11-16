import { applyCourseMarks } from "../questions/applyCourseMarks";
import { isRowMarkType, isValidAnswerKey, parseRef, questionRef } from "../questions/keys";
import { solve } from "./index";
import { courseMatchesRule } from "./rules";
import type { Answers, DistCourse, DistributionResult, Layer, Question, Row, StudentContext } from "./types";

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
 * Answers (spec 020 questions). A layer can make a row depend on the student's
 * answer (an `answered` leaf: an approval list the page does not print, a fact
 * only the student knows). The fixture's optional `answers` is the app's own
 * `Answers` ({ marks, facts }, keyed exactly as the plan and profile store them,
 * questions/keys.ts): a row-scoped mark "<ref>@<courseId>": "yes" for each plan
 * course answered yes, a credit mark "<ref>": value, a fact "<ref>": "yes" | "no".
 * Every solve here takes the app's path: credit marks applied to the courses
 * (applyCourseMarks), then solve with the answers. Probes carry no answers of
 * their own (an answer may only name a plan course), so a probe still tests
 * the row's structure. Answers are guarded like plan courses:
 *
 *  - goldenAnswerProblems: every key names a question a fixture layer asks, in
 *    the right half (marks vs facts), on a plan course inside the question's
 *    scope, with a value of the right kind;
 *  - every "yes" (or credit value) must be load-bearing: dropping that one
 *    answer must drop a row from met, so an answer can never paper over a row
 *    the plan already meets structurally (and so hide a loose row); and
 *  - `metByAnswer` lists each row met only because of the answers (with the
 *    answers whose removal alone drops it), for the reviewer to check that the
 *    page really leaves that decision to the student or department.
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
  /** The student's answers to the layers' questions, in the app's own shape
   *  (see the header). Only where the page leaves the decision to the student
   *  or department; each must be load-bearing. */
  answers?: Answers;
  /** Course data for every plan and probe id (filled from the catalog by the CLI). */
  courses: DistCourse[];
};

export type GoldenUnmetRow = { layerId: string; rowId: string; status: string };

/** A row met only because of the fixture's answers. `without`: its status with
 *  no answers at all; `answers`: the answer keys whose removal alone drops it
 *  from met (empty when no single answer does). */
export type GoldenAnsweredRow = { layerId: string; rowId: string; without: string; answers: string[] };

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
  /** Present only when the fixture has `answers`: rows met only through them. */
  metByAnswer?: GoldenAnsweredRow[];
  /** Present only with `answers`: "yes" / credit answers whose removal drops no row. */
  answersNotLoadBearing?: string[];
  /** Present only with `answers`: goldenAnswerProblems. */
  answerProblems?: string[];
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

/** Every row asks the student to confirm with an advisor: nothing is scored. */
function nothingScored(result: DistributionResult): boolean {
  return result.layers.every((l) => l.rows.every((r) => r.status === "confirm"));
}

/** The app's path (distributionProgress): credit marks applied to the courses,
 *  then solve with the answers. No answers: a plain solve, exactly as before. */
function solveWith(layers: Layer[], courses: DistCourse[], ctx: StudentContext, answers?: Answers): DistributionResult {
  if (!answers) return solve({ layers, courses, ctx, waived: [] });
  return solve({ layers, courses: applyCourseMarks(courses, layers, answers.marks), ctx, waived: [], answers });
}

/** The fixture's answers with both halves present (a fixture may omit one). */
function normalizeAnswers(a: Answers): Answers {
  return { marks: { ...(a.marks ?? {}) }, facts: { ...(a.facts ?? {}) } };
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
  const answers = fx.answers ? normalizeAnswers(fx.answers) : undefined;

  const full = solveWith(layers, planCourses, fx.ctx, answers);
  const unmetRows = unmetOf(full);

  const notLoadBearing: string[] = [];
  for (let i = 0; i < planCourses.length; i++) {
    const without = planCourses.filter((_, j) => j !== i);
    const r = solveWith(layers, without, fx.ctx, answers);
    if ((r.pct === 100 || nothingScored(r)) && unmetOf(r).length === 0) notLoadBearing.push(planCourses[i].id);
  }

  const forbiddenCounted = runProbes(layers, fx, planCourses, byId, unknownCourses, answers);

  const answered = answers ? analyzeAnswers(layers, planCourses, fx.ctx, answers, full) : null;
  const answerProblems = answers ? goldenAnswerProblems(layers, fx) : [];

  // A layer whose every row is "confirm with your advisor" (a major whose course
  // rules all live in its concentrations) scores nothing: the only known-good
  // plan is the empty one, and the engine's pct is 0 by convention.
  const ok =
    unmetRows.length === 0 &&
    notLoadBearing.length === 0 &&
    unknownCourses.length === 0 &&
    forbiddenCounted.length === 0 &&
    answerProblems.length === 0 &&
    (answered?.answersNotLoadBearing.length ?? 0) === 0 &&
    (full.pct === 100 || nothingScored(full));
  const result: GoldenResult = { programId: fx.programId, ok, pct: full.pct, unmetRows, notLoadBearing, unknownCourses, forbiddenCounted };
  return answered ? { ...result, ...answered, answerProblems } : result;
}

// ─── answers ─────────────────────────────────────────────────────────────────

const rowKey = (layerId: string, rowId: string) => `${layerId}:${rowId}`;

function passingRows(result: DistributionResult): Set<string> {
  const out = new Set<string>();
  for (const layer of result.layers) for (const row of layer.rows) if (PASSING.has(row.status)) out.add(rowKey(row.layerId, row.rowId));
  return out;
}

/** Which rows rest on the answers, and which answers carry no row. An answer
 *  "unit" is one "yes" (or credit value) key; "no" answers can never help a
 *  row (the strict reading) and are not tried. */
function analyzeAnswers(
  layers: Layer[],
  planCourses: DistCourse[],
  ctx: StudentContext,
  answers: Answers,
  full: DistributionResult,
): { metByAnswer: GoldenAnsweredRow[]; answersNotLoadBearing: string[] } {
  const passing = passingRows(full);
  const none = solveWith(layers, planCourses, ctx);
  const noneStatus = new Map<string, string>();
  for (const layer of none.layers) for (const row of layer.rows) noneStatus.set(rowKey(row.layerId, row.rowId), row.status);

  const units: { half: "marks" | "facts"; key: string }[] = [
    ...Object.entries(answers.marks)
      .filter(([, v]) => v === "yes" || typeof v === "number")
      .map(([key]) => ({ half: "marks" as const, key })),
    ...Object.entries(answers.facts)
      .filter(([, v]) => v === "yes")
      .map(([key]) => ({ half: "facts" as const, key })),
  ];
  const dropsBy = new Map<string, string[]>();
  const answersNotLoadBearing: string[] = [];
  for (const u of units) {
    const half = { ...answers[u.half] };
    delete half[u.key];
    const r = solveWith(layers, planCourses, ctx, { ...answers, [u.half]: half });
    const still = passingRows(r);
    const dropped = [...passing].filter((k) => !still.has(k));
    if (dropped.length === 0) answersNotLoadBearing.push(u.key);
    for (const k of dropped) dropsBy.set(k, [...(dropsBy.get(k) ?? []), u.key]);
  }

  const metByAnswer: GoldenAnsweredRow[] = [];
  for (const layer of full.layers)
    for (const row of layer.rows) {
      const k = rowKey(row.layerId, row.rowId);
      const without = noneStatus.get(k) ?? "absent";
      if (passing.has(k) && !PASSING.has(without)) metByAnswer.push({ layerId: row.layerId, rowId: row.rowId, without, answers: dropsBy.get(k) ?? [] });
    }
  return { metByAnswer, answersNotLoadBearing };
}

/**
 * Ways the fixture's `answers` do not fit its layers or plan; [] = they fit.
 * Every key must name a question one of the fixture's layers asks (keys as
 * questions/keys.ts builds them), facts in `facts` and course marks in
 * `marks`; a row-scoped mark is per plan course ("<ref>@<courseId>") and the
 * course must be inside the question's `courses`; a credit mark's course must
 * be in the plan; values are "yes" / "no", or for creditsTaken one of the
 * question's values.
 */
export function goldenAnswerProblems(
  layers: Layer[],
  fx: Pick<GoldenFixture, "plan" | "ctx" | "answers"> & { courses?: DistCourse[] },
): string[] {
  const a = fx.answers as unknown;
  if (a === undefined) return [];
  if (!a || typeof a !== "object" || Array.isArray(a)) return ["answers must be { marks, facts } (the app's Answers)"];
  const out: string[] = [];
  const obj = a as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (k !== "marks" && k !== "facts") out.push(`answers has an unknown key "${k}" (only marks and facts)`);
  const isMap = (v: unknown) => v === undefined || (!!v && typeof v === "object" && !Array.isArray(v));
  if (!isMap(obj.marks)) out.push("answers.marks must be an object of answer key → value");
  if (!isMap(obj.facts)) out.push("answers.facts must be an object of answer key → value");
  if (out.length) return out;

  const asked = new Map<string, Question>();
  for (const layer of layers) for (const q of layer.questions ?? []) {
    const ref = questionRef(layer.id, q);
    if (!asked.has(ref)) asked.set(ref, q);
  }
  const plan = new Set(fx.plan);
  const byId = new Map((fx.courses ?? []).map((c) => [c.id, c]));
  const ruleCtx = {
    programId: fx.ctx.programId,
    ...(fx.ctx.additionalProgramIds ? { additionalProgramIds: fx.ctx.additionalProgramIds } : {}),
  };
  const yesNo = (v: unknown) => v === "yes" || v === "no";
  const layerList = layers.map((l) => l.id).join(", ");

  for (const [key, value] of Object.entries((obj.marks ?? {}) as Record<string, unknown>)) {
    const where = `answers.marks "${key}"`;
    if (!isValidAnswerKey(key)) {
      out.push(`${where} is not a valid answer key`);
      continue;
    }
    const at = key.indexOf("@");
    const ref = at < 0 ? key : key.slice(0, at);
    const course = at < 0 ? null : key.slice(at + 1);
    const parsed = parseRef(ref);
    if (!parsed) {
      out.push(`${where} names no question (not a question ref)`);
      continue;
    }
    if (parsed.type === "studentFact") {
      out.push(`${where} is a student fact: it belongs in answers.facts`);
      continue;
    }
    const q = asked.get(ref);
    if (!q) {
      out.push(`${where}: no layer of this fixture (${layerList}) asks ${ref}`);
      continue;
    }
    if (isRowMarkType(parsed.type)) {
      if (course == null || course === "") {
        out.push(`${where}: a ${parsed.type} answer is per course ("${ref}@<courseId>")`);
        continue;
      }
      if (!plan.has(course)) {
        out.push(`${where} answers for ${course}, which is not in the plan`);
        continue;
      }
      if (!yesNo(value)) {
        out.push(`${where} must be "yes" or "no"`);
        continue;
      }
      const c = byId.get(course);
      if (c && "courses" in q && !courseMatchesRule(c, q.courses, ruleCtx))
        out.push(`${where}: ${course} is outside the courses ${ref} asks about (the answer would do nothing)`);
      continue;
    }
    // Credit marks: the course is part of the ref.
    if (course != null) {
      out.push(`${where}: a ${parsed.type} answer is keyed by the question alone ("${ref}", no "@")`);
      continue;
    }
    if (q.type === "creditsTaken" || q.type === "sequenceDone") {
      if (!plan.has(q.course)) out.push(`${where} is about ${q.course}, which is not in the plan`);
      else if (q.type === "creditsTaken" && !(typeof value === "number" && q.values.includes(value)))
        out.push(`${where} must be one of the question's credit values (${q.values.join(", ")})`);
      else if (q.type === "sequenceDone" && !yesNo(value)) out.push(`${where} must be "yes" or "no"`);
    }
  }

  for (const [key, value] of Object.entries((obj.facts ?? {}) as Record<string, unknown>)) {
    const where = `answers.facts "${key}"`;
    const at = key.indexOf("@");
    const parsed = isValidAnswerKey(key) ? parseRef(at < 0 ? key : key.slice(0, at)) : null;
    if (!parsed) {
      out.push(`${where} names no question (not a question ref)`);
      continue;
    }
    if (parsed.type !== "studentFact") {
      out.push(`${where} is a course mark: it belongs in answers.marks`);
      continue;
    }
    if (at >= 0) {
      out.push(`${where}: a student fact is keyed by the question alone (no "@")`);
      continue;
    }
    if (!asked.has(key)) {
      out.push(`${where}: no layer of this fixture (${layerList}) asks ${key}`);
      continue;
    }
    if (!yesNo(value)) out.push(`${where} must be "yes" or "no"`);
  }
  return out;
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
      return {
        ...row,
        requiredCourses: Math.max(row.requiredCourses, courses) + 1,
        ...(row.requiredCredits != null
          ? { requiredCredits: Math.max(row.requiredCredits, credits) + probe.credits }
          : {}),
      };
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
function countsAsExtra(
  layers: Layer[],
  planCourses: DistCourse[],
  probe: DistCourse,
  t: ProbeTarget,
  ctx: StudentContext,
  answers: Answers | undefined,
): boolean {
  const top = layers[t.layerIndex].rows[t.rowIndex];
  const plan = planCourses.filter((c) => c.id !== probe.id);
  for (const candidate of candidateRows(top, t.childIndex)) {
    if (candidate.kind === "confirm") continue;
    const base = solveWith(withRow(layers, t.layerIndex, t.rowIndex, candidate), plan, ctx, answers);
    const held = base.layers[t.layerIndex]?.rows.find((r) => r.rowId === top.id)?.courses ?? [];
    const wanting = wantingOneMore(candidate, held, probe);
    if (!wanting) continue;
    // A seat holds one course: free it by dropping the plan course it counts.
    const offered = wanting.kind === "seat" ? plan.filter((c) => !held.some((h) => h.courseId === c.id)) : plan;
    const r = solveWith(withRow(layers, t.layerIndex, t.rowIndex, wanting), [...offered, probe], ctx, answers);
    if (attributedTo(r, probe.id, t.layerId, top.id)) return true;
  }
  return false;
}

/** Unknown probe courses are added to `unknownCourses` and not solved on. The
 *  fixture's answers go into every probe solve: they name plan courses only, so
 *  a probe course itself is never answered for. */
function runProbes(
  layers: Layer[],
  fx: GoldenFixture,
  planCourses: DistCourse[],
  byId: Map<string, DistCourse>,
  unknownCourses: string[],
  answers: Answers | undefined,
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
  const all = solveWith(layers, [...planCourses, ...extra], fx.ctx, answers);

  return known
    .filter(
      (t) =>
        countsAsWritten(all, layers, t) ||
        countsAsExtra(layers, planCourses, byId.get(t.probe.courseId)!, t, fx.ctx, answers),
    )
    .map((t) => ({ courseId: t.probe.courseId, layerId: t.layerId, rowId: t.probe.rowId }));
}

/** One readable line per problem; [] when the plan passes. Pass the fixture to
 *  show each failed probe's `why`. */
export function describeGoldenFailure(r: GoldenResult, fx?: Pick<GoldenFixture, "mustNotCount">): string[] {
  const lines: string[] = [];
  if (r.pct !== 100 && !r.ok) lines.push(`${r.programId}: plan scores ${r.pct}%, not 100%`);
  for (const u of r.unmetRows) lines.push(`${r.programId}: row ${u.layerId}:${u.rowId} is ${u.status}`);
  for (const id of r.notLoadBearing) lines.push(`${r.programId}: ${id} is not load-bearing (removing it keeps 100%)`);
  for (const id of r.unknownCourses) lines.push(`${r.programId}: ${id} has no course data`);
  for (const p of r.answerProblems ?? []) lines.push(`${r.programId}: ${p}`);
  for (const k of r.answersNotLoadBearing ?? []) lines.push(`${r.programId}: answer ${k} is not load-bearing (without it every row is still met)`);
  for (const f of r.forbiddenCounted) {
    const why = fx?.mustNotCount?.find((p) => p.courseId === f.courseId && p.rowId === f.rowId)?.why;
    lines.push(`${r.programId}: row ${f.layerId}:${f.rowId} counts ${f.courseId}, which it must not${why ? ` (${why})` : ""}`);
  }
  return lines;
}
