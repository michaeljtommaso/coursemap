import { courseMatchesRule, type RuleContext } from "./rules";
import { questionScopes } from "../questions/keys";
import type {
  AnyOfRow,
  AppliesClause,
  ChildRow,
  CourseRule,
  DistCourse,
  DistributionResult,
  Layer,
  Row,
  RowLimit,
  RowStatus,
  SolveInput,
  StudentContext,
  VerifyRejection,
  VerifyReport,
} from "./types";

/**
 * distribution/verify.ts (spec 019 D8 "Independent checker") — re-proves every
 * claim a Distribution solver result makes, from the input alone.
 *
 * The product rule is "the engine can never show a green it can't prove". The
 * solver searches; this module only checks. It is deliberately written from
 * the contract in types.ts (and the one rule evaluator in rules.ts), never
 * from the solver's code, so a bug in the solver's reading of the contract is
 * not silently shared here. It re-derives on its own:
 *
 *  - canonical ids and the cross-listing dedupe (first wins, max credits);
 *  - which rows apply to the student (appliesTo clauses, entry-term order);
 *  - that every counted course exists, carries its deduped credits and
 *    matches the row (and, on distribution rows, each claimed category);
 *  - every "met" claim, from the listed courses alone (counts, credits,
 *    per-subject caps, sub-limits, category spread, double-count budget,
 *    single-subject totals, anyOf options);
 *  - the counting semantics across rows: one consuming row per course per
 *    layer, exclusive rows owning their courses everywhere, waived/confirm
 *    rows counting nothing;
 *  - that `attribution`, `uncounted` and the progress counts agree with the
 *    rows.
 *
 * It does not judge optimality: a row reported unmet that could have been met
 * is not a rejection. It never trusts `fraction`, `pct` or `progress` as proof.
 * Pure: no logging, no input mutation, and a malformed result is reported as a
 * rejection rather than thrown.
 */

type Obj = Record<string, unknown>;
type Reject = (layerId: string, rowId: string, reason: string) => void;

/** A listed course entry, as read from an untrusted result. */
type Entry = { courseId: string; credits: unknown; categories: unknown };
/** A listed course that passed every per-course check. */
type Counted = { course: DistCourse; categories: string[] };

type Env = {
  ctx: StudentContext;
  canonical: (id: string) => string;
  /** Canonical id → deduped course, in board order. */
  courses: Map<string, DistCourse>;
  ruleCtx: RuleContext;
  waived: Set<string>;
  reject: Reject;
};

/** One row result seen in the result, kept for the cross-row checks. */
type SeenRow = {
  layerId: string;
  rowId: string;
  def: Row | undefined;
  /** Ids the row counts (its own `courses`; for anyOf, the chosen child's). */
  counts: string[];
  /** Ids listed by anyOf children, chosen or not. */
  childLists: string[][];
};

const EPS = 1e-9;
const STATUSES: ReadonlySet<string> = new Set<RowStatus>([
  "met",
  "partial",
  "unmet",
  "unchecked",
  "confirm",
  "waived",
]);
const SEASON: Record<string, number> = { WI: 0, SP: 1, SU: 2, FA: 3 };

const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const near = (a: number, b: number) => Math.abs(a - b) <= EPS;
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const sumCredits = (cs: DistCourse[]) => cs.reduce((s, c) => s + c.credits, 0);
const keyOf = (layerId: string, rowId: string) => `${layerId}\u0000${rowId}`;
const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function verifyAssignment(input: SolveInput, result: DistributionResult): VerifyReport {
  const rejections: VerifyRejection[] = [];
  const said = new Set<string>();
  const reject: Reject = (layerId, rowId, reason) => {
    const k = `${layerId}\u0000${rowId}\u0000${reason}`;
    if (said.has(k)) return;
    said.add(k);
    rejections.push({ layerId, rowId, reason });
  };
  try {
    run(input, result as unknown, reject);
  } catch (err) {
    // Fail closed: anything the checker cannot read is not proven.
    const msg = err instanceof Error ? err.message : String(err);
    reject("*", "*", `checker could not read the input or result: ${msg}`);
  }
  return { ok: rejections.length === 0, rejections };
}

// ─── Input preparation ──────────────────────────────────────────────────────

function dedupeCourses(courses: DistCourse[], canonical: (id: string) => string): Map<string, DistCourse> {
  const out = new Map<string, DistCourse>();
  for (const c of courses) {
    const id = canonical(c.id);
    const prev = out.get(id);
    if (!prev) out.set(id, { ...c, id });
    else if (c.credits > prev.credits) out.set(id, { ...prev, credits: c.credits });
  }
  return out;
}

function termOrdinal(term: string | null | undefined): number | null {
  if (typeof term !== "string") return null;
  const m = /^(FA|SP|SU|WI)(\d{2})$/.exec(term);
  if (!m) return null;
  return Number(m[2]) * 4 + SEASON[m[1]];
}

function clauseMatches(c: AppliesClause, ctx: StudentContext): boolean {
  if (c.enteredFrom != null || c.enteredBefore != null) {
    const entry = termOrdinal(ctx.entryTerm);
    if (entry == null) return false;
    if (c.enteredFrom != null) {
      const from = termOrdinal(c.enteredFrom);
      if (from == null || entry < from) return false;
    }
    if (c.enteredBefore != null) {
      const before = termOrdinal(c.enteredBefore);
      if (before == null || entry >= before) return false;
    }
  }
  if (c.transfer != null && (ctx.transfer == null || !c.transfer.includes(ctx.transfer))) return false;
  if (c.transferStanding != null && (ctx.transferStanding == null || !c.transferStanding.includes(ctx.transferStanding)))
    return false;
  return true;
}

function applies(appliesTo: AppliesClause[] | undefined, ctx: StudentContext): boolean {
  return appliesTo == null || appliesTo.some((c) => clauseMatches(c, ctx));
}

// ─── Driver ─────────────────────────────────────────────────────────────────

function run(input: SolveInput, result: unknown, reject: Reject): void {
  const canonical = input.canonical ?? ((id: string) => id);
  const env: Env = {
    ctx: input.ctx,
    canonical,
    courses: dedupeCourses(input.courses ?? [], canonical),
    ruleCtx: {
      programId: input.ctx?.programId ?? null,
      canonical,
      answers: input.answers,
      questionScopes: questionScopes(input.layers),
    },
    waived: new Set(input.waived ?? []),
    reject,
  };

  if (!isObj(result) || !Array.isArray(result.layers)) {
    reject("*", "*", "result has no layers list");
    return;
  }

  const seen: SeenRow[] = [];
  for (const { def, res } of matchLayers(input.layers, result.layers, reject)) {
    checkLayer(env, def, res, seen);
  }

  checkConsumption(input.layers, seen, reject);
  checkExclusive(seen, reject);
  checkAttribution(env, result.attribution, seen);
  checkUncounted(env, result.uncounted, seen);
}

/** Layer ids, order and kinds; returns the input/result pairs to check. */
function matchLayers(defs: Layer[], resLayers: unknown[], reject: Reject): { def: Layer; res: Obj }[] {
  const resIds = resLayers.map((l) => (isObj(l) && typeof l.layerId === "string" ? l.layerId : null));
  const inputIds = defs.map((d) => d.id);
  const pairs: { def: Layer; res: Obj }[] = [];

  resIds.forEach((id, i) => {
    if (id == null) reject("*", "*", `result layer ${i + 1} is malformed`);
    else if (!inputIds.includes(id)) reject(id, "*", "layer is not one of the input layers");
  });
  for (const def of defs) {
    const at = resIds.flatMap((id, i) => (id === def.id ? [i] : []));
    if (at.length === 0) {
      reject(def.id, "*", "layer is missing from the result");
      continue;
    }
    if (at.length > 1) reject(def.id, "*", `layer appears ${at.length} times in the result`);
    const res = resLayers[at[0]] as Obj;
    if (res.kind !== def.kind) reject(def.id, "*", `layer kind is ${String(res.kind)}, expected ${def.kind}`);
    pairs.push({ def, res });
  }

  const gotOrder = resIds.filter((id, i): id is string => id != null && inputIds.includes(id) && resIds.indexOf(id) === i);
  const wantOrder = inputIds.filter((id) => gotOrder.includes(id));
  if (gotOrder.join("\u0000") !== wantOrder.join("\u0000")) {
    reject("*", "*", `layer order is ${gotOrder.join(", ")}, expected ${wantOrder.join(", ")}`);
  }
  return pairs;
}

function checkLayer(env: Env, layer: Layer, res: Obj, seen: SeenRow[]): void {
  const { reject } = env;
  if (!Array.isArray(res.rows)) {
    reject(layer.id, "*", "layer has no rows list");
    return;
  }
  const byId = new Map<string, Obj>();
  for (const r of res.rows as unknown[]) {
    if (!isObj(r) || typeof r.rowId !== "string") {
      reject(layer.id, "*", "layer has a malformed row result");
      continue;
    }
    if (byId.has(r.rowId)) {
      reject(layer.id, r.rowId, "row appears twice in the layer");
      continue;
    }
    if (r.layerId !== layer.id) reject(layer.id, r.rowId, `row result names layer ${String(r.layerId)}`);
    byId.set(r.rowId, r);
  }

  const defs = new Map(layer.rows.map((d) => [d.id, d]));
  for (const def of layer.rows) {
    const r = byId.get(def.id);
    const applicable = applies(def.appliesTo, env.ctx);
    if (applicable && !r) reject(layer.id, def.id, "row applies to this student but is missing from the result");
    if (!applicable && r) reject(layer.id, def.id, "row is present but its appliesTo excludes this student");
  }

  for (const [rowId, r] of byId) {
    const def = defs.get(rowId);
    if (!def) {
      reject(layer.id, rowId, "row is not in the input layer");
      seen.push({ layerId: layer.id, rowId, def, counts: entryIds(readEntries(r.courses) ?? []), childLists: [] });
      continue;
    }
    seen.push(checkRow(env, layer.id, def, r));
  }
}

// ─── One row ────────────────────────────────────────────────────────────────

function readEntries(x: unknown): Entry[] | null {
  if (!Array.isArray(x)) return null;
  return x.map((e) =>
    isObj(e)
      ? { courseId: e.courseId as string, credits: e.credits, categories: e.categories }
      : { courseId: undefined as unknown as string, credits: undefined, categories: undefined }
  );
}

const entryIds = (entries: Entry[]) => entries.flatMap((e) => (typeof e.courseId === "string" ? [e.courseId] : []));

function checkRow(env: Env, layerId: string, def: Row, r: Obj): SeenRow {
  const { reject } = env;
  const rej = (reason: string) => reject(layerId, def.id, reason);
  const status = r.status;
  if (typeof status !== "string" || !STATUSES.has(status)) rej(`unknown status ${String(status)}`);
  if (r.kind !== def.kind) rej(`result kind ${String(r.kind)} does not match row kind ${def.kind}`);

  let entries = readEntries(r.courses);
  if (entries == null) {
    rej("courses is not a list");
    entries = [];
  }
  const childResults = Array.isArray(r.children) ? (r.children as unknown[]) : null;
  const childLists = (childResults ?? []).map((c) => (isObj(c) ? entryIds(readEntries(c.courses) ?? []) : []));
  const seenRow: SeenRow = { layerId, rowId: def.id, def, counts: entryIds(entries), childLists };

  // Waivers win over every kind, confirm included: the row is removed before solving.
  if (env.waived.has(`${layerId}:${def.id}`)) {
    if (status !== "waived") rej(`row is waived but reports status ${String(status)}`);
    if (entries.length > 0) rej("waived row lists counted courses");
    if (childLists.some((l) => l.length > 0)) rej("waived row's options list counted courses");
    return seenRow;
  }
  if (status === "waived") rej("row is not waived but reports status waived");

  if (def.kind === "confirm") {
    if (status !== "confirm") rej(`confirm row reports status ${String(status)}; only "confirm" is allowed`);
    if (entries.length > 0) rej("confirm row lists counted courses");
    return seenRow;
  }
  if (status === "confirm") rej("checkable row reports status confirm");

  if (def.kind === "anyOf") {
    checkAnyOf(env, layerId, def, r, entries, childResults);
    return seenRow;
  }

  const counted = checkEntries(env, layerId, def.id, "", def, entries);
  checkProgress(env, layerId, def.id, "", def, r.progress, entries);
  if (status === "met") {
    for (const f of proveMet(env, def, counted)) rej(`claims met but ${f}`);
  }
  return seenRow;
}

function checkAnyOf(
  env: Env,
  layerId: string,
  def: AnyOfRow,
  r: Obj,
  entries: Entry[],
  childResults: unknown[] | null
): void {
  const rej = (reason: string) => env.reject(layerId, def.id, reason);
  // The parent's courses are the chosen option's; the option's rule is checked on the child.
  checkEntries(env, layerId, def.id, "", null, entries);

  if (!childResults) rej("anyOf row has no option results");
  else if (childResults.length !== def.rows.length)
    rej(`anyOf row has ${childResults.length} option results, expected ${def.rows.length}`);

  const childSets: (Set<string> | null)[] = [];
  const proven: boolean[] = [];
  def.rows.forEach((childDef, i) => {
    const cr = childResults?.[i];
    const prefix = `option ${childDef.id}: `;
    if (!isObj(cr)) {
      childSets.push(null);
      proven.push(false);
      return;
    }
    if (cr.rowId !== childDef.id) rej(`option result ${i + 1} is ${String(cr.rowId)}, expected ${childDef.id}`);
    if (cr.kind !== childDef.kind) rej(`${prefix}result kind ${String(cr.kind)} does not match ${childDef.kind}`);
    const st = cr.status;
    if (typeof st !== "string" || !STATUSES.has(st) || st === "confirm" || st === "waived")
      rej(`${prefix}invalid option status ${String(st)}`);

    let ce = readEntries(cr.courses);
    if (ce == null) {
      rej(`${prefix}courses is not a list`);
      ce = [];
    }
    const counted = checkEntries(env, layerId, def.id, prefix, childDef, ce);
    checkProgress(env, layerId, def.id, prefix, childDef, cr.progress, ce);

    let ok = false;
    if (st === "met") {
      const fails = proveMet(env, childDef, counted);
      if (!applies(childDef.appliesTo, env.ctx)) fails.push("the option's appliesTo excludes this student");
      for (const f of fails) rej(`${prefix}claims met but ${f}`);
      ok = fails.length === 0 && counted.length === ce.length;
    }
    childSets.push(new Set(entryIds(ce)));
    proven.push(ok);
  });

  const parentSet = new Set(entryIds(entries));
  if (entries.length > 0 && !childSets.some((s) => s != null && setEq(s, parentSet))) {
    rej("its courses match no option's courses");
  }
  if (r.status === "met") {
    if (!proven.some(Boolean)) rej("claims met but no option re-proves as met");
    else if (!proven.some((p, i) => p && childSets[i] != null && setEq(childSets[i] as Set<string>, parentSet)))
      rej("claims met but its courses are not those of a met option");
  }
  checkProgress(env, layerId, def.id, "", def, r.progress, entries);
}

/** Per-course checks shared by every status. `def` null → existence and
 *  credits only (anyOf parents). Returns the entries that passed. */
function checkEntries(
  env: Env,
  layerId: string,
  rowId: string,
  prefix: string,
  def: ChildRow | null,
  entries: Entry[]
): Counted[] {
  const rej = (reason: string) => env.reject(layerId, rowId, prefix + reason);
  const match = (c: DistCourse, rule: CourseRule) => courseMatchesRule(c, rule, env.ruleCtx);
  const out: Counted[] = [];
  const listed = new Set<string>();

  if (def?.kind === "seat" && entries.length > 1) rej(`a seat counts one course but ${entries.length} are listed`);

  for (const e of entries) {
    const id = e.courseId;
    if (typeof id !== "string") {
      rej("has a malformed course entry");
      continue;
    }
    if (listed.has(id)) {
      rej(`course ${id} is listed twice`);
      continue;
    }
    listed.add(id);

    const course = env.courses.get(id);
    if (!course) {
      const canon = env.canonical(id);
      if (canon !== id && env.courses.has(canon)) rej(`course ${id} is not a canonical id (expected ${canon})`);
      else rej(`course ${id} is not among the student's courses`);
      continue;
    }
    let valid = true;
    if (typeof e.credits !== "number" || !near(e.credits, course.credits)) {
      rej(`course ${id} lists ${String(e.credits)} credits but has ${fmt(course.credits)} after dedupe`);
      valid = false;
    }

    const hasCats = Array.isArray(e.categories) && e.categories.length > 0;
    let cats: string[] = [];
    if (def == null) {
      // anyOf parent: categories, if any, belong to the option result.
    } else if (def.kind === "distribution") {
      if (def.rule && !match(course, def.rule)) {
        rej(`course ${id} is not eligible for this row`);
        valid = false;
      }
      if (!hasCats) {
        rej(`course ${id} counts toward no category`);
        valid = false;
      } else {
        const known = new Map(def.categories.map((c) => [c.id, c]));
        const mine = new Set<string>();
        for (const cat of e.categories as unknown[]) {
          if (typeof cat !== "string" || !known.has(cat)) {
            rej(`course ${id} claims unknown category ${String(cat)}`);
            valid = false;
          } else if (mine.has(cat)) {
            rej(`course ${id} claims category ${cat} twice`);
            valid = false;
          } else if (!match(course, (known.get(cat) as { rule: CourseRule }).rule)) {
            rej(`course ${id} claims category ${cat} but does not match its rule`);
            valid = false;
          }
          if (typeof cat === "string") mine.add(cat);
        }
        cats = [...mine];
      }
    } else {
      if (!match(course, def.rule)) {
        rej(`course ${id} does not match the row rule`);
        valid = false;
      }
      if (hasCats) {
        rej(`course ${id} lists categories on a ${def.kind} row`);
        valid = false;
      }
    }
    if (valid) out.push({ course, categories: cats });
  }
  return out;
}

// ─── "Met" proofs ───────────────────────────────────────────────────────────

/** Why `def` is NOT met by exactly these courses; empty → proven met. */
function proveMet(env: Env, def: ChildRow, counted: Counted[]): string[] {
  const courses = counted.map((c) => c.course);
  const credits = sumCredits(courses);
  switch (def.kind) {
    case "seat":
      return courses.length >= 1 ? [] : ["counts no qualifying course"];

    case "pool": {
      const out: string[] = [];
      if (courses.length < def.requiredCourses)
        out.push(`counts ${courses.length} of ${def.requiredCourses} required courses`);
      if (credits + EPS < def.requiredCredits)
        out.push(`counts ${fmt(credits)} of ${fmt(def.requiredCredits)} required credits`);
      out.push(...subjectCapFailures(def.maxPerSubject, def.subjectGroups, courses));
      out.push(...limitFailures(env, def.limits, courses));
      return out;
    }

    case "credits": {
      const out: string[] = [];
      if (def.sameSubject) {
        const subjects = [...new Set(courses.map((c) => c.subject))];
        if (subjects.length > 1) out.push(`mixes subjects ${subjects.join(", ")} on a single-subject row`);
      }
      if (credits + EPS < def.requiredCredits)
        out.push(`counts ${fmt(credits)} of ${fmt(def.requiredCredits)} required credits`);
      out.push(...limitFailures(env, def.limits, courses));
      return out;
    }

    case "distribution": {
      const out: string[] = [];
      const maxCats = def.maxCategoriesPerCourse ?? 1;
      const perCat = new Map<string, number>(def.categories.map((c) => [c.id, 0]));
      let doubles = 0;
      for (const { course, categories } of counted) {
        if (categories.length > maxCats)
          out.push(`course ${course.id} fills ${categories.length} categories (max ${maxCats} per course)`);
        if (categories.length > 1) doubles++;
        for (const cat of categories) perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
      }
      if (def.maxDoubleCountCourses != null && doubles > def.maxDoubleCountCourses)
        out.push(`${doubles} courses fill more than one category (max ${def.maxDoubleCountCourses})`);
      const distinct = counted.filter((c) => c.categories.length > 0).length;
      if (distinct < def.requiredCourses) out.push(`counts ${distinct} of ${def.requiredCourses} required courses`);
      const filled = [...perCat.values()].filter((n) => n > 0).length;
      if (filled < def.minDistinctCategories)
        out.push(`fills ${filled} of ${def.minDistinctCategories} required categories`);
      for (const [cat, { min, max, minCredits }] of Object.entries(def.perCategory ?? {})) {
        const n = perCat.get(cat) ?? 0;
        if (min != null && n < min) out.push(`category ${cat} has ${n} courses (min ${min})`);
        if (max != null && n > max) out.push(`category ${cat} has ${n} courses (max ${max})`);
        if (minCredits != null) {
          // A course's credits count in every category it claims.
          const catCredits = sumCredits(counted.filter((c) => c.categories.includes(cat)).map((c) => c.course));
          if (catCredits + EPS < minCredits)
            out.push(`category ${cat} has ${fmt(catCredits)} credits (min ${fmt(minCredits)})`);
        }
      }
      if (def.requiredCredits != null && credits + EPS < def.requiredCredits)
        out.push(`counts ${fmt(credits)} of ${fmt(def.requiredCredits)} required credits`);
      out.push(...subjectCapFailures(def.maxPerSubject, def.subjectGroups, courses));
      out.push(...limitFailures(env, def.limits, courses));
      return out;
    }
  }
}

/** maxPerSubject caps courses per department: subjects listed together in
 *  `subjectGroups` share one cap (re-derived here, not imported, so the
 *  checker stays independent of the solver's helpers). */
function subjectCapFailures(max: number | undefined, groups: string[][] | undefined, courses: DistCourse[]): string[] {
  if (max == null) return [];
  const dept = (subject: string) => groups?.find((g) => g.includes(subject))?.join("/") ?? subject;
  const byDept = new Map<string, number>();
  for (const c of courses) byDept.set(dept(c.subject), (byDept.get(dept(c.subject)) ?? 0) + 1);
  return [...byDept]
    .filter(([, n]) => n > max)
    .map(([d, n]) => `counts ${n} ${d} courses (max ${max} per department)`);
}

function limitFailures(env: Env, limits: RowLimit[] | undefined, courses: DistCourse[]): string[] {
  const out: string[] = [];
  (limits ?? []).forEach((lim, i) => {
    const name = lim.label ? `limit "${lim.label}"` : `limit ${i + 1}`;
    const hit = courses.filter((c) => courseMatchesRule(c, lim.rule, env.ruleCtx));
    const n = hit.length;
    const cr = sumCredits(hit);
    if (lim.minCourses != null && n < lim.minCourses) out.push(`${name} needs at least ${lim.minCourses} courses, has ${n}`);
    if (lim.maxCourses != null && n > lim.maxCourses) out.push(`${name} allows at most ${lim.maxCourses} courses, has ${n}`);
    if (lim.minCredits != null && cr + EPS < lim.minCredits)
      out.push(`${name} needs at least ${fmt(lim.minCredits)} credits, has ${fmt(cr)}`);
    if (lim.maxCredits != null && cr - EPS > lim.maxCredits)
      out.push(`${name} allows at most ${fmt(lim.maxCredits)} credits, has ${fmt(cr)}`);
  });
  return out;
}

// ─── Progress (cross-checked, never trusted) ────────────────────────────────

function bestSubjectCredits(courses: DistCourse[]): number {
  const by = new Map<string, number>();
  for (const c of courses) by.set(c.subject, (by.get(c.subject) ?? 0) + c.credits);
  return Math.max(0, ...by.values());
}

function checkProgress(
  env: Env,
  layerId: string,
  rowId: string,
  prefix: string,
  def: Row,
  progress: unknown,
  entries: Entry[]
): void {
  if (!isObj(progress)) return;
  const rej = (reason: string) => env.reject(layerId, rowId, prefix + reason);
  const resolved = entryIds(entries).flatMap((id) => {
    const c = env.courses.get(id);
    return c ? [c] : [];
  });
  const total = sumCredits(resolved);
  // A single-subject total may be reported as the best subject's credits.
  const sameSubject =
    (def.kind === "credits" && def.sameSubject === true) ||
    (def.kind === "anyOf" && def.rows.some((c) => c.kind === "credits" && c.sameSubject === true));

  const have = progress.creditsHave;
  if (typeof have === "number" && !near(have, total) && !(sameSubject && near(have, bestSubjectCredits(resolved)))) {
    rej(`progress reports ${fmt(have)} credits but the listed courses total ${fmt(total)}`);
  }
  const n = progress.coursesHave;
  if (typeof n === "number" && n !== entries.length) {
    rej(`progress reports ${n} courses but ${entries.length} are listed`);
  }
  if (def.kind === "distribution" && Array.isArray(progress.categoriesHave)) {
    const claimed = new Set<string>();
    for (const e of entries) {
      if (Array.isArray(e.categories)) for (const c of e.categories) if (typeof c === "string") claimed.add(c);
    }
    const reported = new Set((progress.categoriesHave as unknown[]).map(String));
    if (!setEq(reported, claimed)) {
      rej(`progress reports categories [${[...reported].join(", ")}] but the listed courses claim [${[...claimed].join(", ")}]`);
    }
  }
}

// ─── Cross-row checks ───────────────────────────────────────────────────────

/** Whether a row's counted courses are used up within its layer. */
function consumes(row: SeenRow): boolean {
  const def = row.def;
  if (!def || def.overlay || def.kind === "credits" || def.kind === "confirm") return false;
  if (def.kind !== "anyOf") return true;
  // The chosen option is the one whose courses the parent lists. A credits
  // option behaves as overlay; when the choice is ambiguous, assume consuming.
  const parent = new Set(row.counts);
  const chosen = def.rows.filter((_, i) => row.childLists[i] && setEq(new Set(row.childLists[i]), parent));
  return chosen.length === 0 || chosen.some((c) => c.kind !== "credits");
}

/** The counting group each layer belongs to (types.ts counting semantics): a
 *  "separate" concentration joins its major layer (same programId, when that
 *  major is among the layers) and every other "separate" concentration of that
 *  major; every other layer is a group of its own. */
function countingGroups(layers: Layer[]): Map<string, string> {
  const majors = new Set(layers.filter((l) => l.kind === "major" && l.programId != null).map((l) => l.programId));
  const group = new Map<string, string>();
  for (const l of layers) {
    const joined =
      (l.kind === "major" && l.programId != null && layers.some((c) => c.kind === "concentration" && c.courseSharing === "separate" && c.programId === l.programId)) ||
      (l.kind === "concentration" && l.courseSharing === "separate" && l.programId != null && majors.has(l.programId));
    group.set(l.id, joined ? `group ${l.programId}` : `layer ${l.id}`);
  }
  return group;
}

function checkConsumption(layers: Layer[], seen: SeenRow[], reject: Reject): void {
  const groups = countingGroups(layers);
  const byGroup = new Map<string, Map<string, SeenRow>>();
  for (const row of seen) {
    if (!consumes(row)) continue;
    const g = groups.get(row.layerId) ?? `layer ${row.layerId}`;
    let owners = byGroup.get(g);
    if (!owners) byGroup.set(g, (owners = new Map()));
    for (const id of row.counts) {
      const owner = owners.get(id);
      if (owner != null && owner.rowId === row.rowId && owner.layerId === row.layerId) continue;
      if (owner != null) {
        reject(
          row.layerId,
          row.rowId,
          owner.layerId === row.layerId
            ? `course ${id} is already counted by consuming row ${owner.rowId} in this layer`
            : `course ${id} is already counted by consuming row ${owner.layerId}:${owner.rowId} in the same counting group (separate concentration)`
        );
      } else owners.set(id, row);
    }
  }
}

/** The ids a row lists that an exclusive row's ownership forbids. Credit
 *  totals are exempt: an FWS can't fill another requirement, but its credits
 *  still count toward the degree total (contract: credits rows see every
 *  course). So credits rows, and an anyOf's credits options, are skipped. */
function idsBoundByExclusive(row: SeenRow): Set<string> {
  const def = row.def;
  if (def?.kind === "credits") return new Set();
  if (def?.kind !== "anyOf") return new Set([...row.counts, ...row.childLists.flat()]);
  const ids = new Set<string>();
  const creditLists: Set<string>[] = [];
  def.rows.forEach((child, i) => {
    const list = row.childLists[i] ?? [];
    if (child.kind === "credits") creditLists.push(new Set(list));
    else for (const id of list) ids.add(id);
  });
  const parent = new Set(row.counts);
  if (!creditLists.some((s) => setEq(s, parent))) for (const id of parent) ids.add(id);
  return ids;
}

function checkExclusive(seen: SeenRow[], reject: Reject): void {
  const owner = new Map<string, SeenRow>();
  for (const row of seen) {
    if (!row.def?.exclusive) continue;
    for (const id of row.counts) if (!owner.has(id)) owner.set(id, row);
  }
  for (const row of seen) {
    for (const id of idsBoundByExclusive(row)) {
      const o = owner.get(id);
      if (o && o !== row) {
        reject(
          row.layerId,
          row.rowId,
          `course ${id} is counted by exclusive row ${o.layerId}:${o.rowId} and may count nowhere else`
        );
      }
    }
  }
}

function checkAttribution(env: Env, attribution: unknown, seen: SeenRow[]): void {
  const { reject } = env;
  const expected = new Map<string, Map<string, SeenRow>>();
  for (const row of seen) {
    for (const id of row.counts) {
      let m = expected.get(id);
      if (!m) expected.set(id, (m = new Map()));
      m.set(keyOf(row.layerId, row.rowId), row);
    }
  }
  if (!isObj(attribution)) {
    reject("*", "*", "attribution is missing or malformed");
    return;
  }
  const got = new Map<string, Set<string>>();
  for (const [id, list] of Object.entries(attribution)) {
    const keys = new Set<string>();
    got.set(id, keys);
    if (!Array.isArray(list)) {
      reject("*", "*", `attribution for ${id} is not a list`);
      continue;
    }
    for (const e of list as unknown[]) {
      if (!isObj(e) || typeof e.layerId !== "string" || typeof e.rowId !== "string") {
        reject("*", "*", `attribution for ${id} has a malformed entry`);
        continue;
      }
      const k = keyOf(e.layerId, e.rowId);
      if (keys.has(k)) reject(e.layerId, e.rowId, `attribution lists ${id} twice for this row`);
      keys.add(k);
      if (!expected.get(id)?.has(k)) {
        reject(e.layerId, e.rowId, `attribution lists ${id} for this row but the row does not count it`);
      }
    }
  }
  for (const [id, rows] of expected) {
    for (const [k, row] of rows) {
      if (!got.get(id)?.has(k)) reject(row.layerId, row.rowId, `attribution for ${id} does not list this row`);
    }
  }
}

function checkUncounted(env: Env, uncounted: unknown, seen: SeenRow[]): void {
  const { reject } = env;
  const counter = new Map<string, SeenRow>();
  for (const row of seen) for (const id of row.counts) if (!counter.has(id)) counter.set(id, row);
  if (!Array.isArray(uncounted)) {
    reject("*", "*", "uncounted is missing or malformed");
    return;
  }
  const listed = new Set<string>();
  for (const id of uncounted as unknown[]) {
    if (typeof id !== "string") {
      reject("*", "*", "uncounted has a malformed entry");
      continue;
    }
    if (listed.has(id)) reject("*", "*", `uncounted lists ${id} twice`);
    listed.add(id);
    const row = counter.get(id);
    if (row) reject(row.layerId, row.rowId, `course ${id} is counted by this row but also listed as uncounted`);
    else if (!env.courses.has(id)) reject("*", "*", `uncounted lists ${id}, which is not a canonical course of the student`);
  }
  for (const id of env.courses.keys()) {
    if (!counter.has(id) && !listed.has(id)) reject("*", "*", `course ${id} is counted by no row but missing from uncounted`);
  }
}
