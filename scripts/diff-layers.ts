// scripts/diff-layers.ts
// Compares two blind drafts of one requirement layer, row by row, and lists every
// place they mean different things (spec 019 Phase 4). The diff is the chain's
// main error filter: a disagreement it hides becomes a wrong requirement shown
// to students, so it errs toward reporting. False alarms cost a resolver a
// minute; a missed difference costs a student a semester.
//
// Authors pick their own row ids, so rows are paired by CONTENT (what courses
// their rules reach, their numbers), never by id, using an optimal assignment
// with a minimum score. Inside a paired anyOf the children are paired the same
// way; inside a paired distribution the categories are.
//
// Severities (layer-authoring.ts DiffSeverity):
//   real        the drafts mean different things — counted, must be resolved
//   equivalent  written differently, same catalog courses — shown, not counted.
//               Never when the rules differ for AP/IB credit, cross-listings or
//               programs (probed, since the catalog has none), nor when one is
//               a fixed course list and the other an open rule.
//   harmless    ids, labels, headings, notes, order — counted in one line only.
//               A confirm row's label is its requirement: any change to its
//               words, numbers or grades is real.
//
// Questions (spec 020). An `answered` leaf names its question by a ref that
// carries the author's row id ("usedAs:<layer>/<row>"), and lint keeps it in
// that row (or the anyOf parent), so before comparing rules every row-scoped
// ref is rewritten to "<type>:<layer>/_row" or ".../_parent" (normalizeAnswered).
// The catalog cannot show what a "yes" does, so `answered` is a blind leaf: two
// rules that match the same catalog courses are re-tested with every question
// answered yes. The layers' `questions` are compared as a set (target rows
// mapped through the row pairing): a question in one draft only is real, the
// same question with other parameters is real per field, and a question's
// quote and source anchor are harmless.
//
// Run (from scripts/):
//   npx tsx diff-layers.ts <draftA.json> <draftB.json> [--dump <path> | --no-catalog] [--out <dir>]
// Writes diff.json (LayerDiff) and diff.md to --out (default: the program's
// provenance folder). Exit 0 = no real differences, 1 = some, 2 = bad usage.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { canonicalStringify } from "./canonical-json";
import {
  DEFAULT_DUMP,
  PROVENANCE_FILES,
  canonicalRule,
  describeRow,
  loadDistCatalog,
  questionLookup,
  matchingIds,
  normalizeCourseId,
  normalizeQuoteText,
  provenanceDir,
  quotesFor,
  readDraft,
  ruleKey,
  type ChildRow,
  type CourseRule,
  type DiffSeverity,
  type DistCatalog,
  type DistCourse,
  type Draft,
  type FieldDiff,
  type Layer,
  type LayerDiff,
  type Question,
  type Row,
  type RowPair,
  type RowSide,
} from "./layer-authoring";
import { courseMatchesRule } from "../cornell-degree-planner/src/lib/planner/distribution/rules";
import { isRowMarkType, markKey, parseRef } from "../cornell-degree-planner/src/lib/planner/questions/keys";
import type {
  Answers,
  AppliesClause,
  CreditKind,
  DistributionCategory,
  RowLimit,
} from "../cornell-degree-planner/src/lib/planner/distribution/types";

// ─── Output shape ───────────────────────────────────────────────────────────

/** A RowSide plus what a resolver needs to read it without opening the draft:
 *  the row in words, and (unpaired rows) rows on the other side that may be
 *  its counterpart in a different shape. */
export type DiffSide = RowSide & { meaning: string; counterparts?: string[] };

export type DiffAuthor = { author: string; model: string; framing: string };

/** LayerDiff plus context for the markdown. Assignable to LayerDiff. */
export type DiffReport = {
  programId: string;
  layerFields: FieldDiff[];
  pairs: (RowPair & { a: DiffSide; b: DiffSide })[];
  onlyA: DiffSide[];
  onlyB: DiffSide[];
  realCount: number;
  authors: { a: DiffAuthor; b: DiffAuthor };
  catalog: { used: boolean; courses: number };
  counts: { real: number; equivalent: number; harmless: number; rowsA: number; rowsB: number };
};

type AssertAssignable<T extends LayerDiff> = T;
export type _DiffReportIsLayerDiff = AssertAssignable<DiffReport>;

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Two rows of one kind pair only at or above this score (0–1). Below it they
 *  are reported as rows only one author wrote: a false pair would bury a
 *  difference inside a row that looks agreed. */
export const MIN_PAIR_SCORE = 0.4;
/** Categories inside a paired distribution row. */
export const MIN_CATEGORY_SCORE = 0.3;
/** Confirm rows carry no rule; their label words are all there is to match. */
export const MIN_CONFIRM_LABEL_SCORE = 0.5;
/** A row of another kind this similar (by rule) is shown as a possible counterpart. */
export const COUNTERPART_RULE_SCORE = 0.5;
/** A same-kind row below the pairing bar but at least this close is shown too. */
export const WEAK_MATCH_SCORE = 0.2;

const W_RULE = 0.75;
const W_NUM = 0.2;
const W_LABEL = 0.05;

// ─── Environment (catalog + per-side program) ───────────────────────────────

type SideId = "a" | "b";
type AnyRow = Row | ChildRow;

type Env = {
  catalog?: DistCatalog;
  program: Record<SideId, string | null>;
  cache: Map<string, { list: string[]; set: Set<string> }>;
};

function idsFor(env: Env, rule: CourseRule, side: SideId): { list: string[]; set: Set<string> } | null {
  if (!env.catalog) return null;
  const prog = env.program[side];
  const k = `${prog ?? ""}|${ruleKey(rule)}`;
  let hit = env.cache.get(k);
  if (!hit) {
    const list = matchingIds(rule, env.catalog, prog);
    hit = { list, set: new Set(list) };
    env.cache.set(k, hit);
  }
  return hit;
}

// ─── Similarity ─────────────────────────────────────────────────────────────

function jaccard<T>(a: Set<T>, b: Set<T>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function levels(min: number | undefined, max: number | undefined): number[] {
  const lo = Math.max(0, Math.min(9, Math.floor((min ?? 0) / 1000)));
  const hi = Math.max(0, Math.min(9, Math.floor((max ?? 9999) / 1000)));
  const out: number[] = [];
  for (let l = lo; l <= hi; l++) out.push(l);
  return out;
}

/** Leaf values as comparable tokens, used when there is no catalog (or a rule
 *  matches nothing in it). Patterns, course ids and number ranges all yield
 *  subject + thousand-level tokens so "ECON 3xxx" and "ECON, 3000–3999" meet. */
export function ruleTokens(rule: CourseRule, neg = false, out: Set<string> = new Set()): Set<string> {
  const p = neg ? "!" : "";
  if ("allOf" in rule) for (const r of rule.allOf) ruleTokens(r, neg, out);
  else if ("anyOf" in rule) for (const r of rule.anyOf) ruleTokens(r, neg, out);
  else if ("not" in rule) ruleTokens(rule.not, !neg, out);
  else if ("tag" in rule) for (const t of rule.tag) out.add(`${p}tag:${t.trim().toUpperCase()}`);
  else if ("subject" in rule) {
    for (const s of rule.subject) out.add(`${p}subject:${s.trim().toUpperCase()}`);
    if (rule.crossListed) out.add(`${p}crosslisted`);
  } else if ("number" in rule) for (const l of levels(rule.number.min, rule.number.max)) out.add(`${p}level:${l}`);
  else if ("course" in rule) {
    for (const c of rule.course) {
      const id = normalizeCourseId(c);
      out.add(`${p}course:${id}`);
      const [subj, num] = id.split("-");
      if (subj) out.add(`${p}subject:${subj}`);
      if (num && /^\d/.test(num)) out.add(`${p}level:${num[0]}`);
    }
  } else if ("pattern" in rule) {
    const m = rule.pattern.trim().toUpperCase().replace(/-/g, " ").match(/^([A-Z&]+)\s*(\S*)$/);
    if (m) {
      out.add(`${p}subject:${m[1]}`);
      if (/^\d/.test(m[2])) out.add(`${p}level:${m[2][0]}`);
    } else out.add(`${p}pattern:${rule.pattern.trim().toUpperCase()}`);
  } else if ("titleStartsWith" in rule) out.add(`${p}title:${rule.titleStartsWith.trim().toLowerCase()}`);
  else if ("minCredits" in rule) out.add(`${p}mincredits:${rule.minCredits}`);
  else if ("variableCredit" in rule) out.add(`${p}variablecredit`);
  else if ("creditKind" in rule) for (const k of rule.creditKind) out.add(`${p}creditkind:${k}`);
  else if ("program" in rule) for (const x of rule.program) out.add(`${p}program:${x}`);
  else if ("answered" in rule) out.add(`${p}answered:${rule.answered}`);
  return out;
}

/** 0–1: how much the two rules reach the same courses. */
export function ruleSimilarity(ra: CourseRule | null, rb: CourseRule | null, env: Env): number {
  if (!ra || !rb) return ra === rb ? 1 : 0;
  if (ruleKey(ra) === ruleKey(rb)) return 1;
  const ia = idsFor(env, ra, "a");
  const ib = idsFor(env, rb, "b");
  if (ia && ib) {
    const j = jaccard(ia.set, ib.set);
    if (j != null) return j;
  }
  return jaccard(ruleTokens(ra), ruleTokens(rb)) ?? 0;
}

const STOP = new Set(["the", "and", "for", "from", "with", "one", "two", "three", "four", "any", "all", "course", "courses", "credit", "credits"]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 4)),
  );
}

function wordSimilarity(a: string, b: string): number {
  return jaccard(words(a), words(b)) ?? 1;
}

/** A confirm row's label in comparable form: quote normal form, lower case,
 *  punctuation dropped, but every word, digit and grade token kept ("b-",
 *  "c+", "s-u", "2400-2999"). Pairing may use the fuzzy word score above; a
 *  paired confirm row whose labels differ here differs in its requirement. */
export function confirmLabelText(s: string): string {
  return (normalizeQuoteText(s).toLowerCase().match(/[a-z0-9]+(?:[-+'][a-z0-9]+)*[-+]?/g) ?? []).join(" ");
}

/** The rule a row tests, for pairing: a distribution's categories (each under
 *  the row's eligibility rule), an anyOf's children, else the row rule. */
function rowRule(row: AnyRow): CourseRule | null {
  switch (row.kind) {
    case "seat":
    case "pool":
    case "credits":
      return row.rule;
    case "distribution":
      return { anyOf: row.categories.map((c) => effectiveCategoryRule(row.rule, c)) };
    case "anyOf": {
      const kids = row.rows.map(rowRule).filter((r): r is CourseRule => r != null);
      return kids.length ? { anyOf: kids } : null;
    }
    case "confirm":
      return null;
  }
}

function effectiveCategoryRule(eligibility: CourseRule | undefined, c: DistributionCategory): CourseRule {
  return eligibility ? { allOf: [eligibility, c.rule] } : c.rule;
}

function rowNumbers(row: AnyRow): Record<string, number> {
  switch (row.kind) {
    case "seat":
      return { credits: row.credits ?? 3 };
    case "pool":
      return { requiredCourses: row.requiredCourses, requiredCredits: row.requiredCredits, limits: row.limits?.length ?? 0 };
    case "distribution":
      return {
        requiredCourses: row.requiredCourses,
        minDistinctCategories: row.minDistinctCategories,
        categories: row.categories.length,
        maxCategoriesPerCourse: row.maxCategoriesPerCourse ?? 1,
      };
    case "credits":
      return { requiredCredits: row.requiredCredits };
    case "anyOf":
      return { children: row.rows.length };
    case "confirm":
      return {};
  }
}

function numberSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!keys.length) return 1;
  let sum = 0;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x == null || y == null) continue;
    if (x === y) sum += 1;
    else sum += Math.min(x, y) / Math.max(x, y);
  }
  return sum / keys.length;
}

/** 0 when the rows should not pair; otherwise their score. */
function rowScore(a: AnyRow, b: AnyRow, env: Env): number {
  if (a.kind !== b.kind) return 0;
  if (a.kind === "confirm") {
    const s = wordSimilarity(a.label, b.label);
    return s >= MIN_CONFIRM_LABEL_SCORE ? s : 0;
  }
  const s =
    W_RULE * ruleSimilarity(rowRule(a), rowRule(b), env) +
    W_NUM * numberSimilarity(rowNumbers(a), rowNumbers(b)) +
    W_LABEL * wordSimilarity(a.label, b.label);
  return s >= MIN_PAIR_SCORE ? s : 0;
}

// ─── Optimal assignment ─────────────────────────────────────────────────────

/** Hungarian algorithm (minimum cost), n rows ≤ m columns. Returns the column
 *  for each row. O(n²m); n ≤ 80 here. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0].length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] !== 0) ans[p[j] - 1] = j - 1;
  return ans;
}

export type Pairing = { pairs: [number, number, number][]; onlyA: number[]; onlyB: number[] };

/** Pairs items to maximize the total score; a score of 0 never pairs.
 *  Pairs come back in A order, leftovers in their own side's order. */
export function pairByScore<T>(as: T[], bs: T[], score: (a: T, b: T) => number): Pairing {
  const pairs: [number, number, number][] = [];
  if (as.length && bs.length) {
    const s = as.map((a) => bs.map((b) => score(a, b)));
    if (as.length <= bs.length) {
      const col = hungarian(s.map((r) => r.map((x) => -x)));
      col.forEach((j, i) => {
        if (j >= 0 && s[i][j] > 0) pairs.push([i, j, s[i][j]]);
      });
    } else {
      const t = bs.map((_, j) => as.map((_, i) => -s[i][j]));
      const row = hungarian(t);
      row.forEach((i, j) => {
        if (i >= 0 && s[i][j] > 0) pairs.push([i, j, s[i][j]]);
      });
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const usedA = new Set(pairs.map((p) => p[0]));
  const usedB = new Set(pairs.map((p) => p[1]));
  return {
    pairs,
    onlyA: as.map((_, i) => i).filter((i) => !usedA.has(i)),
    onlyB: bs.map((_, j) => j).filter((j) => !usedB.has(j)),
  };
}

// ─── Normal forms for comparison ────────────────────────────────────────────

const same = (x: unknown, y: unknown) => canonicalStringify(x ?? null) === canonicalStringify(y ?? null);

function sortedUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

function canonicalClause(c: AppliesClause): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.enteredFrom != null) out.enteredFrom = c.enteredFrom;
  if (c.enteredBefore != null) out.enteredBefore = c.enteredBefore;
  if (c.transfer?.length) out.transfer = sortedUnique(c.transfer);
  if (c.transferStanding?.length) out.transferStanding = sortedUnique(c.transferStanding);
  return out;
}

/** Clause order, value order inside a clause and duplicate clauses don't matter. */
export function canonicalAppliesTo(clauses: AppliesClause[] | undefined): Record<string, unknown>[] | null {
  if (!clauses) return null;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const c of clauses) {
    const cc = canonicalClause(c);
    byKey.set(canonicalStringify(cc), cc);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
}

/** A set of sets; absent ≡ empty. */
export function canonicalSubjectGroups(groups: string[][] | undefined): string[][] {
  const byKey = new Map<string, string[]>();
  for (const g of groups ?? []) {
    const gg = sortedUnique(g.map((s) => s.trim().toUpperCase()));
    if (gg.length) byKey.set(gg.join(","), gg);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => g);
}

function canonicalBounds(mm: { min?: number; max?: number } | undefined): { min?: number; max?: number } | null {
  if (!mm) return null;
  const out: { min?: number; max?: number } = {};
  if (mm.min != null) out.min = mm.min;
  if (mm.max != null) out.max = mm.max;
  return Object.keys(out).length ? out : null;
}

function limitBounds(l: RowLimit): Record<string, number> {
  const out: Record<string, number> = {};
  if (l.minCourses != null) out.minCourses = l.minCourses;
  if (l.maxCourses != null) out.maxCourses = l.maxCourses;
  if (l.minCredits != null) out.minCredits = l.minCredits;
  if (l.maxCredits != null) out.maxCredits = l.maxCredits;
  return out;
}

function limitKey(l: RowLimit): string {
  return canonicalStringify({ rule: ruleKey(l.rule), ...limitBounds(l) });
}

/** credits rows are always overlay; on other rows absent ≡ false. */
function effectiveOverlay(row: AnyRow): boolean {
  return row.kind === "credits" ? true : row.overlay === true;
}

// ─── Rule comparison ────────────────────────────────────────────────────────

/** Leaves the catalog cannot test: catalog courses are never AP/IB credit and
 *  carry no cross-listings, and a program leaf only answers for the program it
 *  is evaluated in. Two rules that differ in how these leaves act can match the
 *  same catalog courses and still treat a student differently. */
type BlindLeaves = { any: boolean; crossListedSubjects: Set<string>; programs: Set<string>; answered: Set<string> };

function blindLeaves(rule: CourseRule, out: BlindLeaves = { any: false, crossListedSubjects: new Set(), programs: new Set(), answered: new Set() }): BlindLeaves {
  if ("allOf" in rule) for (const r of rule.allOf) blindLeaves(r, out);
  else if ("anyOf" in rule) for (const r of rule.anyOf) blindLeaves(r, out);
  else if ("not" in rule) blindLeaves(rule.not, out);
  else if ("creditKind" in rule) out.any = true;
  else if ("answered" in rule) {
    out.any = true;
    out.answered.add(rule.answered);
  }
  else if ("subject" in rule && rule.crossListed) {
    out.any = true;
    for (const s of rule.subject) out.crossListedSubjects.add(s.trim().toUpperCase());
  } else if ("program" in rule) {
    out.any = true;
    for (const x of rule.program) out.programs.add(x);
  }
  return out;
}

const CREDIT_KINDS: CreditKind[] = ["ap", "ib", "transfer", "placement"];
const KIND_WORDS: Record<CreditKind, string> = { ap: "AP", ib: "IB", transfer: "transfer", placement: "placement" };

/** Do two rules that match the same catalog courses also agree on what the
 *  catalog cannot show? Compares their EFFECT, not their leaves: every catalog
 *  course is re-tested as AP/IB/transfer/placement credit (and credit of an
 *  unknown kind), as a course cross-listed under the subjects the rules name,
 *  and for each program either rule (or either layer) names. Returns up to
 *  three disagreements in words, or null when the rules agree on every probe. */
function blindSpotDifference(ra: CourseRule, rb: CourseRule, env: Env): { examples: string[]; count: number } | null {
  const ba = blindLeaves(ra);
  const bb = blindLeaves(rb);
  if (!ba.any && !bb.any) return null;
  const xl = sortedUnique([...ba.crossListedSubjects, ...bb.crossListedSubjects]);
  const refs = sortedUnique([...ba.answered, ...bb.answered]);
  /** These questions answered yes for this course (every other one no). */
  const yesTo = (yes: string[], courseId: string): Answers => ({
    marks: Object.fromEntries(yes.map((r) => [markKey(r, courseId), "yes" as const])),
    facts: Object.fromEntries(yes.map((r) => [r, "yes" as const])),
  });
  // Every question answered yes, then each one alone (so two rules reading
  // different questions differ).
  const answerSets: [string, string[]][] = refs.length ? [["every question answered yes", refs], ...(refs.length > 1 ? refs.map((r): [string, string[]] => [`only ${r} answered yes`, [r]]) : [])] : [];
  const contexts = [...new Set<string | null>([env.program.a, env.program.b, ...sortedUnique([...ba.programs, ...bb.programs])])];
  const examples: string[] = [];
  let count = 0;
  for (const programId of contexts) {
    const ctx = { programId };
    const where = programId === env.program.a && programId === env.program.b ? "" : ` for a student in ${programId ?? "no program"}`;
    for (const c of env.catalog!.courses) {
      const probes: [string, DistCourse][] = [[c.id, c]];
      for (const k of CREDIT_KINDS) probes.push([`${c.id} as ${KIND_WORDS[k]} credit`, { ...c, isCredit: true, creditKind: k }]);
      probes.push([`${c.id} as credit of unknown kind`, { ...c, isCredit: true }]);
      if (xl.length) probes.push([`${c.id} cross-listed as ${xl.join("/")}`, { ...c, crossListedSubjects: xl }]);
      for (const [what, course] of probes) {
        const ma = courseMatchesRule(course, ra, ctx);
        if (ma === courseMatchesRule(course, rb, ctx)) continue;
        count++;
        if (examples.length < 3) examples.push(`${what}${where}: ${ma ? "A counts it, B does not" : "B counts it, A does not"}`);
      }
      for (const [what, yes] of answerSets) {
        const yesCtx = { programId, answers: yesTo(yes, c.id) };
        const ma = courseMatchesRule(c, ra, yesCtx);
        if (ma === courseMatchesRule(c, rb, yesCtx)) continue;
        count++;
        if (examples.length < 3) examples.push(`${c.id} with ${what}${where}: ${ma ? "A counts it, B does not" : "B counts it, A does not"}`);
      }
    }
  }
  return count ? { examples, count } : null;
}

/** Can the rule only ever match courses from a fixed list (a `course` leaf
 *  bounds it)? An open rule (subject, number, pattern, tag, …) also reaches
 *  courses the catalog does not have yet. */
export function isClosedRule(rule: CourseRule): boolean {
  if ("allOf" in rule) return rule.allOf.some(isClosedRule);
  if ("anyOf" in rule) return rule.anyOf.every(isClosedRule);
  return "course" in rule;
}

function courseLeaves(rule: CourseRule, out: string[] = []): string[] {
  if ("allOf" in rule) for (const r of rule.allOf) courseLeaves(r, out);
  else if ("anyOf" in rule) for (const r of rule.anyOf) courseLeaves(r, out);
  else if ("not" in rule) courseLeaves(rule.not, out);
  else if ("course" in rule) out.push(...rule.course.map(normalizeCourseId));
  return out;
}

function preview(ids: string[], n = 8): string {
  return ids.length <= n ? ids.join(", ") : `${ids.slice(0, n).join(", ")} … (+${ids.length - n})`;
}

type Verdict = { severity: DiffSeverity; note: string };

/** Two rules with different canonical forms: equivalent on the catalog, or
 *  real. "Equivalent" needs all of: the same catalog courses (at least one),
 *  the same effect on AP/IB credit, cross-listings and programs, and both
 *  rules fixed lists or both open rules. */
function compareOnCatalog(ra: CourseRule, rb: CourseRule, env: Env): Verdict {
  if (!env.catalog) return { severity: "real", note: "different rules (no catalog given to compare them on)" };
  const ia = idsFor(env, ra, "a")!;
  const ib = idsFor(env, rb, "b")!;
  const onlyA = ia.list.filter((x) => !ib.set.has(x));
  const onlyB = ib.list.filter((x) => !ia.set.has(x));
  if (onlyA.length || onlyB.length)
    return {
      severity: "real",
      note: `A matches ${ia.list.length} catalog course(s), B matches ${ib.list.length}; only A: ${preview(onlyA) || "none"}; only B: ${preview(onlyB) || "none"}`,
    };
  if (!ia.list.length) return { severity: "real", note: "neither rule matches any catalog course, so the catalog cannot show they agree" };
  const blind = blindSpotDifference(ra, rb, env);
  if (blind)
    return {
      severity: "real",
      note:
        `both match the same ${ia.list.length} catalog course(s), but they differ in parts the catalog cannot test ` +
        `(AP/IB credit, cross-listing, programs, answers to questions) in ${blind.count} probe(s), e.g. ${blind.examples.join("; ")}`,
    };
  const closedA = isClosedRule(canonicalRule(ra));
  const closedB = isClosedRule(canonicalRule(rb));
  if (closedA !== closedB)
    return {
      severity: "real",
      note:
        `a fixed list vs an open rule: both match the same ${ia.list.length} catalog course(s) today, but ` +
        `${closedA ? "B" : "A"}'s rule also reaches any matching course added to the catalog later and ${closedA ? "A" : "B"}'s course list does not`,
    };
  const missing = sortedUnique([...courseLeaves(ra), ...courseLeaves(rb)]).filter((id) => !env.catalog!.byId.has(id));
  return {
    severity: "equivalent",
    note: `both match the same ${ia.list.length} catalog course(s)${missing.length ? `; listed but not in the catalog: ${preview(missing)}` : ""}`,
  };
}

// ─── Field comparison ───────────────────────────────────────────────────────

class Diffs {
  readonly list: FieldDiff[] = [];
  push(path: string, a: unknown, b: unknown, severity: DiffSeverity, note?: string) {
    const d: FieldDiff = { path, a: a ?? null, b: b ?? null, severity };
    if (note) d.note = note;
    this.list.push(d);
  }
  /** Real when the normal forms differ; harmless when only the raw forms do. */
  value(path: string, a: unknown, b: unknown, rawA?: unknown, rawB?: unknown) {
    if (!same(a, b)) this.push(path, a, b, "real");
    else if (rawA !== undefined || rawB !== undefined) {
      if (!same(rawA, rawB)) this.push(path, rawA, rawB, "harmless", "same meaning (default or order)");
    }
  }
  harmless(path: string, a: unknown, b: unknown, note?: string) {
    if (!same(a, b)) this.push(path, a, b, "harmless", note);
  }
  rule(path: string, ra: CourseRule | undefined, rb: CourseRule | undefined, env: Env) {
    if (!ra && !rb) return;
    if (!ra || !rb) {
      this.push(path, ra, rb, "real", "only one draft has this rule");
      return;
    }
    if (ruleKey(ra) === ruleKey(rb)) {
      this.harmless(path, ra, rb, "same rule, written differently (order, case, duplicates, nesting)");
      return;
    }
    const v = compareOnCatalog(ra, rb, env);
    this.push(path, ra, rb, v.severity, v.note);
  }
}

function compareCommon(d: Diffs, a: AnyRow, b: AnyRow, p: string) {
  d.harmless(`${p}id`, a.id, b.id);
  if (a.kind === "confirm" && b.kind === "confirm" && confirmLabelText(a.label) !== confirmLabelText(b.label))
    d.push(`${p}label`, a.label, b.label, "real", "a confirm row's label is its whole requirement (every word, number and grade counts)");
  else d.harmless(`${p}label`, a.label, b.label);
  d.harmless(`${p}group`, a.group, b.group);
  d.harmless(`${p}note`, a.note, b.note);
  d.harmless(`${p}source.anchor`, a.source.anchor, b.source.anchor);
  d.value(`${p}source.url`, a.source.url.trim(), b.source.url.trim());
  d.value(`${p}overlay`, effectiveOverlay(a), effectiveOverlay(b), a.overlay, b.overlay);
  d.value(`${p}exclusive`, a.exclusive === true, b.exclusive === true, a.exclusive, b.exclusive);
  d.value(`${p}appliesTo`, canonicalAppliesTo(a.appliesTo), canonicalAppliesTo(b.appliesTo), a.appliesTo, b.appliesTo);
}

function compareLimits(d: Diffs, la: RowLimit[] | undefined, lb: RowLimit[] | undefined, p: string, env: Env) {
  const A = la ?? [];
  const B = lb ?? [];
  const leftA: number[] = [];
  const takenB = new Set<number>();
  A.forEach((l, i) => {
    const k = limitKey(l);
    const j = B.findIndex((m, jj) => !takenB.has(jj) && limitKey(m) === k);
    if (j >= 0) takenB.add(j);
    else leftA.push(i);
  });
  const leftB = B.map((_, j) => j).filter((j) => !takenB.has(j));
  if (!leftA.length && !leftB.length) {
    d.harmless(`${p}limits`, A, B, "same limits, in another order or with other labels");
    return;
  }
  // A leftover limit with the same bounds and a rule matching the same catalog
  // courses is equivalent; everything else left over is real.
  const stillB = new Set(leftB);
  const realA: RowLimit[] = [];
  for (const i of leftA) {
    const la1 = A[i];
    let matched = false;
    for (const j of stillB) {
      const lb1 = B[j];
      if (!same(limitBounds(la1), limitBounds(lb1))) continue;
      const v = compareOnCatalog(la1.rule, lb1.rule, env);
      if (v.severity === "equivalent") {
        d.push(`${p}limits[${i}~${j}].rule`, la1.rule, lb1.rule, "equivalent", v.note);
        stillB.delete(j);
        matched = true;
        break;
      }
    }
    if (!matched) realA.push(la1);
  }
  const realB = [...stillB].map((j) => B[j]);
  if (realA.length || realB.length) d.push(`${p}limits`, realA, realB, "real", "limits in only one draft (after matching identical ones)");
}

function compareDistribution(
  d: Diffs,
  a: Extract<AnyRow, { kind: "distribution" }>,
  b: Extract<AnyRow, { kind: "distribution" }>,
  p: string,
  env: Env,
) {
  d.value(`${p}requiredCourses`, a.requiredCourses, b.requiredCourses);
  d.value(`${p}minDistinctCategories`, a.minDistinctCategories, b.minDistinctCategories);
  d.value(`${p}maxCategoriesPerCourse`, a.maxCategoriesPerCourse ?? 1, b.maxCategoriesPerCourse ?? 1, a.maxCategoriesPerCourse, b.maxCategoriesPerCourse);
  d.value(`${p}maxDoubleCountCourses`, a.maxDoubleCountCourses ?? null, b.maxDoubleCountCourses ?? null);
  d.value(`${p}maxPerSubject`, a.maxPerSubject ?? null, b.maxPerSubject ?? null);
  d.value(`${p}subjectGroups`, canonicalSubjectGroups(a.subjectGroups), canonicalSubjectGroups(b.subjectGroups), a.subjectGroups, b.subjectGroups);

  const effA = a.categories.map((c) => effectiveCategoryRule(a.rule, c));
  const effB = b.categories.map((c) => effectiveCategoryRule(b.rule, c));
  const pairing = pairByScore(
    a.categories.map((_, i) => i),
    b.categories.map((_, j) => j),
    (i, j) => {
      const s = 0.95 * ruleSimilarity(effA[i], effB[j], env) + 0.05 * wordSimilarity(a.categories[i].label, b.categories[j].label);
      return s >= MIN_CATEGORY_SCORE ? s : 0;
    },
  );
  const before = d.list.length;
  for (const [i, j] of pairing.pairs) {
    const ca = a.categories[i];
    const cb = b.categories[j];
    const cp = `${p}categories[${ca.id}~${cb.id}]`;
    d.harmless(`${cp}.id`, ca.id, cb.id);
    d.harmless(`${cp}.label`, ca.label, cb.label);
    d.rule(`${cp}.rule`, effA[i], effB[j], env);
    d.value(`${p}perCategory[${ca.id}~${cb.id}]`, canonicalBounds(a.perCategory?.[ca.id]), canonicalBounds(b.perCategory?.[cb.id]));
  }
  for (const i of pairing.onlyA) {
    const c = a.categories[i];
    d.push(`${p}categories[${c.id}~]`, { ...c, perCategory: a.perCategory?.[c.id] ?? null }, null, "real", "category only in A");
  }
  for (const j of pairing.onlyB) {
    const c = b.categories[j];
    d.push(`${p}categories[~${c.id}]`, null, { ...c, perCategory: b.perCategory?.[c.id] ?? null }, "real", "category only in B");
  }
  const catsReal = d.list.slice(before).some((x) => x.severity === "real");
  // perCategory entries that name no category: compare by key.
  const idsA = new Set(a.categories.map((c) => c.id));
  const idsB = new Set(b.categories.map((c) => c.id));
  const orphanKeys = sortedUnique([
    ...Object.keys(a.perCategory ?? {}).filter((k) => !idsA.has(k)),
    ...Object.keys(b.perCategory ?? {}).filter((k) => !idsB.has(k)),
  ]);
  for (const k of orphanKeys) {
    const va = idsA.has(k) ? undefined : canonicalBounds(a.perCategory?.[k]);
    const vb = idsB.has(k) ? undefined : canonicalBounds(b.perCategory?.[k]);
    if (!same(va, vb)) d.push(`${p}perCategory[${k}]`, va, vb, "real", "perCategory entry that names no category");
  }
  const orderA = pairing.pairs.map((x) => x[1]);
  if (orderA.some((x, k) => k > 0 && x < orderA[k - 1])) d.push(`${p}categories (order)`, null, null, "harmless", "categories listed in another order");

  // The row rule only filters what the categories see, so it was compared
  // through the categories' effective rules above.
  if (!a.rule && !b.rule) return;
  if (a.rule && b.rule && ruleKey(a.rule) === ruleKey(b.rule)) {
    d.harmless(`${p}rule`, a.rule, b.rule, "same rule, written differently");
    return;
  }
  if (catsReal) d.push(`${p}rule`, a.rule, b.rule, "real", "eligibility rules differ (see the category differences)");
  else d.push(`${p}rule`, a.rule, b.rule, "equivalent", "eligibility is written in different places, but every category ends up with the same courses");
}

function compareBody(d: Diffs, a: AnyRow, b: AnyRow, p: string, env: Env) {
  compareCommon(d, a, b, p);
  if (a.kind !== b.kind) {
    d.push(`${p}kind`, a.kind, b.kind, "real");
    return;
  }
  switch (a.kind) {
    case "seat": {
      const bb = b as typeof a;
      d.rule(`${p}rule`, a.rule, bb.rule, env);
      d.value(`${p}credits`, a.credits ?? 3, bb.credits ?? 3, a.credits, bb.credits);
      return;
    }
    case "pool": {
      const bb = b as typeof a;
      d.rule(`${p}rule`, a.rule, bb.rule, env);
      d.value(`${p}requiredCourses`, a.requiredCourses, bb.requiredCourses);
      d.value(`${p}requiredCredits`, a.requiredCredits, bb.requiredCredits);
      d.value(`${p}maxPerSubject`, a.maxPerSubject ?? null, bb.maxPerSubject ?? null);
      d.value(`${p}subjectGroups`, canonicalSubjectGroups(a.subjectGroups), canonicalSubjectGroups(bb.subjectGroups), a.subjectGroups, bb.subjectGroups);
      compareLimits(d, a.limits, bb.limits, p, env);
      return;
    }
    case "credits": {
      const bb = b as typeof a;
      d.rule(`${p}rule`, a.rule, bb.rule, env);
      d.value(`${p}requiredCredits`, a.requiredCredits, bb.requiredCredits);
      d.value(`${p}sameSubject`, a.sameSubject === true, bb.sameSubject === true, a.sameSubject, bb.sameSubject);
      compareLimits(d, a.limits, bb.limits, p, env);
      return;
    }
    case "distribution":
      compareDistribution(d, a, b as typeof a, p, env);
      return;
    case "anyOf": {
      const bb = b as typeof a;
      const pairing = pairByScore<ChildRow>(a.rows, bb.rows, (x, y) => rowScore(x, y, env));
      for (const [i, j] of pairing.pairs) {
        const ca = a.rows[i];
        const cb = bb.rows[j];
        compareBody(d, ca, cb, `${p}rows[${ca.id}~${cb.id}].`, env);
      }
      for (const i of pairing.onlyA) {
        const c = a.rows[i];
        d.push(`${p}rows[${c.id}~]`, c, null, "real", `option only in A (${a.id}/${c.id}): ${describeRow(c)}`);
      }
      for (const j of pairing.onlyB) {
        const c = bb.rows[j];
        d.push(`${p}rows[~${c.id}]`, null, c, "real", `option only in B (${bb.id}/${c.id}): ${describeRow(c)}`);
      }
      const order = pairing.pairs.map((x) => x[1]);
      if (order.some((x, k) => k > 0 && x < order[k - 1])) d.push(`${p}rows (order)`, null, null, "harmless", "options listed in another order");
      return;
    }
    case "confirm":
      return;
  }
}

// ─── Layer diff ─────────────────────────────────────────────────────────────

function sideOf(draft: Draft, row: Row): DiffSide {
  // `row` may be the normalized copy; describe the author's own row.
  const own = draft.layer.rows.find((r) => r.id === row.id) ?? row;
  return {
    key: row.id,
    kind: row.kind,
    label: row.label,
    anchor: row.source.anchor,
    quotes: quotesFor(draft, { key: row.id, row: own }),
    meaning: describeRow(own, questionLookup(draft.layer)),
  };
}

// ─── Questions (spec 020) ───────────────────────────────────────────────────

/** Ids standing in for "the row this leaf sits in" and "its anyOf parent";
 *  row ids are lowercase-kebab, so neither can collide with one. */
export const SELF_ROW = "_row";
export const PARENT_ROW = "_parent";

function rewriteAnswered(rule: CourseRule, rowId: string, parentId: string | undefined): CourseRule {
  if ("allOf" in rule) return { allOf: rule.allOf.map((r) => rewriteAnswered(r, rowId, parentId)) };
  if ("anyOf" in rule) return { anyOf: rule.anyOf.map((r) => rewriteAnswered(r, rowId, parentId)) };
  if ("not" in rule) return { not: rewriteAnswered(rule.not, rowId, parentId) };
  if (!("answered" in rule)) return rule;
  const ref = parseRef(rule.answered);
  if (!ref || !isRowMarkType(ref.type) || !("row" in ref)) return rule;
  const stand = ref.row === rowId ? SELF_ROW : ref.row === parentId ? PARENT_ROW : null;
  return stand ? { answered: `${ref.type}:${ref.layerId}/${stand}` } : rule;
}

function normalizeRow<T extends AnyRow>(row: T, parentId?: string): T {
  const rw = (r: CourseRule) => rewriteAnswered(r, row.id, parentId);
  const out = { ...row } as AnyRow;
  if ("rule" in out && out.rule) (out as { rule: CourseRule }).rule = rw(out.rule);
  if (out.kind === "distribution") out.categories = out.categories.map((c) => ({ ...c, rule: rw(c.rule) }));
  if ((out.kind === "pool" || out.kind === "credits") && out.limits) out.limits = out.limits.map((l) => ({ ...l, rule: rw(l.rule) }));
  if (out.kind === "anyOf") out.rows = out.rows.map((c) => normalizeRow(c, row.id));
  return out as T;
}

/** A copy of the layer whose row-scoped `answered` refs no longer carry the
 *  author's row id, so two drafts that read the same question in the rows
 *  they paired compare equal. */
export function normalizeAnswered(layer: Layer): Layer {
  return { ...layer, rows: layer.rows.map((r) => normalizeRow(r)) };
}

/** A question's parameters (everything but its target row, quote and source),
 *  in normal form. */
function questionParams(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = { type: q.type };
  if ("courses" in q) out.courses = ruleKey(q.courses);
  if (q.type === "approvedFor") out.approver = q.approver;
  if (q.type === "courseCondition") out.condition = q.condition;
  if (q.type === "studentFact") {
    out.fact = q.fact;
    out.subject = q.subject;
  }
  if ("course" in q) out.course = normalizeCourseId(q.course);
  if (q.type === "creditsTaken") out.values = [...new Set(q.values)].sort((x, y) => x - y);
  if (q.type === "sequenceDone") {
    out.sequence = q.sequence.map(normalizeCourseId);
    out.credits = q.credits;
  }
  return out;
}

/** Where a question asks: its type plus its target row (in B's ids) for the
 *  row-scoped types, its course for the credit marks, its fact for a fact. */
function questionSlot(q: Question, row: string | null): string {
  if (q.type === "creditsTaken" || q.type === "sequenceDone") return `${q.type}:${normalizeCourseId(q.course)}`;
  if (q.type === "studentFact") return `studentFact:${q.fact}:${q.subject}`;
  return `${q.type}:${row ?? "?"}`;
}

/** The questions of two drafts, compared as sets. `rowMap` maps A's row ids
 *  (top-level and anyOf options) to B's paired ones. */
function compareQuestions(d: Diffs, qa: Question[], qb: Question[], rowMap: Map<string, string>, env: Env) {
  const rowOf = (q: Question, side: SideId): string | null => {
    const r = "row" in q ? q.row ?? null : null;
    if (r == null || side === "b") return r;
    return rowMap.get(r) ?? `A:${r}`;
  };
  const label = (q: Question) => {
    const r = "row" in q ? q.row : undefined;
    return `${q.type}${r ? `:${r}` : ""}${"course" in q ? `:${normalizeCourseId(q.course)}` : ""}${q.type === "studentFact" ? `:${q.fact}:${q.subject}` : ""}`;
  };
  const fullKey = (q: Question, side: SideId) => canonicalStringify({ ...questionParams(q), row: rowOf(q, side) });
  const takenB = new Set<number>();
  const leftA: number[] = [];
  qa.forEach((q, i) => {
    const j = qb.findIndex((x, jj) => !takenB.has(jj) && fullKey(x, "b") === fullKey(q, "a"));
    if (j < 0) {
      leftA.push(i);
      return;
    }
    takenB.add(j);
    const b = qb[j];
    const path = `questions[${label(q)}~${label(b)}]`;
    d.harmless(`${path}.row`, "row" in q ? q.row ?? null : null, "row" in b ? b.row ?? null : null, "the same row, by the authors' own ids");
    d.harmless(`${path}.quote`, normalizeQuoteText(q.quote), normalizeQuoteText(b.quote));
    d.harmless(`${path}.source.anchor`, q.source.anchor, b.source.anchor);
    d.value(`${path}.source.url`, q.source.url.trim(), b.source.url.trim());
    if ("courses" in q && "courses" in b) d.harmless(`${path}.courses`, q.courses, b.courses, "same rule, written differently");
  });
  // Same slot, other parameters: real, field by field.
  const stillA: number[] = [];
  for (const i of leftA) {
    const q = qa[i];
    const j = qb.findIndex((x, jj) => !takenB.has(jj) && questionSlot(x, rowOf(x, "b")) === questionSlot(q, rowOf(q, "a")));
    if (j < 0) {
      stillA.push(i);
      continue;
    }
    takenB.add(j);
    const b = qb[j];
    const path = `questions[${label(q)}~${label(b)}]`;
    const pa = questionParams(q);
    const pb = questionParams(b);
    for (const k of sortedUnique([...Object.keys(pa), ...Object.keys(pb)])) {
      if (k === "courses") d.rule(`${path}.courses`, (q as { courses?: CourseRule }).courses, (b as { courses?: CourseRule }).courses, env);
      else d.value(`${path}.${k}`, pa[k] ?? null, pb[k] ?? null);
    }
    d.harmless(`${path}.quote`, normalizeQuoteText(q.quote), normalizeQuoteText(b.quote));
  }
  for (const i of stillA) d.push(`questions[${label(qa[i])}~]`, qa[i], null, "real", "a question only draft A asks");
  qb.forEach((q, j) => {
    if (!takenB.has(j)) d.push(`questions[~${label(q)}]`, null, q, "real", "a question only draft B asks");
  });
}

function counterpartHints(row: Row, others: Row[], otherPaired: Set<number>, env: Env, rowIsA: boolean): string[] {
  const out: string[] = [];
  others.forEach((o, k) => {
    const [ra, rb] = rowIsA ? [rowRule(row), rowRule(o)] : [rowRule(o), rowRule(row)];
    const tag = otherPaired.has(k) ? "paired elsewhere" : "also unpaired";
    if (o.kind !== row.kind) {
      if (!ra || !rb) return;
      const s = ruleSimilarity(ra, rb, env);
      if (s >= COUNTERPART_RULE_SCORE)
        out.push(`${o.id} (${o.kind}, ${tag}) — "${o.label}": rules overlap ${Math.round(s * 100)}%; the two drafts may model one requirement in different shapes`);
    } else {
      const x = rowIsA ? row : o;
      const y = rowIsA ? o : row;
      const s =
        x.kind === "confirm"
          ? wordSimilarity(x.label, y.label)
          : W_RULE * ruleSimilarity(rowRule(x), rowRule(y), env) + W_NUM * numberSimilarity(rowNumbers(x), rowNumbers(y)) + W_LABEL * wordSimilarity(x.label, y.label);
      if (s >= WEAK_MATCH_SCORE)
        out.push(`${o.id} (${o.kind}, ${tag}) — "${o.label}": similar row (score ${s.toFixed(2)}${s < MIN_PAIR_SCORE ? ", below the pairing bar" : ""})`);
    }
  });
  return out;
}

/** Row-by-row comparison of two drafts. Pure; `catalog` enables the
 *  "equivalent on the catalog" check and course-set pairing. */
export function diffLayers(a: Draft, b: Draft, catalog?: DistCatalog): DiffReport {
  const env: Env = {
    catalog,
    program: { a: a.layer.programId ?? null, b: b.layer.programId ?? null },
    cache: new Map(),
  };
  const LA = normalizeAnswered(a.layer);
  const LB = normalizeAnswered(b.layer);

  // Layer fields.
  const lf = new Diffs();
  lf.value("programId (draft)", a.programId, b.programId);
  lf.value("snapshot.url", a.snapshot.url, b.snapshot.url);
  lf.value("snapshot.textSha256", a.snapshot.textSha256, b.snapshot.textSha256);
  lf.value("id", LA.id, LB.id);
  lf.value("kind", LA.kind, LB.kind);
  lf.value("family", LA.family, LB.family);
  lf.value("catalogYear", LA.catalogYear, LB.catalogYear);
  lf.value("programId", LA.programId ?? null, LB.programId ?? null);
  lf.value("concentrationId", LA.concentrationId ?? null, LB.concentrationId ?? null);
  lf.value("appliesTo", canonicalAppliesTo(LA.appliesTo), canonicalAppliesTo(LB.appliesTo), LA.appliesTo, LB.appliesTo);
  lf.harmless("name", LA.name, LB.name);

  // Pair top-level rows of each kind.
  const kinds = sortedUnique([...LA.rows, ...LB.rows].map((r) => r.kind));
  const pairIdx: [number, number][] = [];
  const onlyAIdx: number[] = [];
  const onlyBIdx: number[] = [];
  for (const kind of kinds) {
    const ia = LA.rows.map((r, i) => (r.kind === kind ? i : -1)).filter((i) => i >= 0);
    const ib = LB.rows.map((r, j) => (r.kind === kind ? j : -1)).filter((j) => j >= 0);
    const p = pairByScore(ia, ib, (i, j) => rowScore(LA.rows[i], LB.rows[j], env));
    for (const [x, y] of p.pairs) pairIdx.push([ia[x], ib[y]]);
    onlyAIdx.push(...p.onlyA.map((x) => ia[x]));
    onlyBIdx.push(...p.onlyB.map((y) => ib[y]));
  }
  pairIdx.sort((x, y) => x[0] - y[0]);
  onlyAIdx.sort((x, y) => x - y);
  onlyBIdx.sort((x, y) => x - y);

  const order = pairIdx.map((x) => x[1]);
  if (order.some((x, k) => k > 0 && x < order[k - 1])) lf.push("rows (order)", null, null, "harmless", "rows listed in another order");

  const pairs: DiffReport["pairs"] = pairIdx.map(([i, j]) => {
    const d = new Diffs();
    compareBody(d, LA.rows[i], LB.rows[j], "", env);
    return { a: sideOf(a, LA.rows[i]), b: sideOf(b, LB.rows[j]), differences: d.list };
  });

  // Questions, with A's row ids mapped to B's through the pairing (options of a
  // paired anyOf are paired the same way compareBody pairs them).
  const rowMap = new Map<string, string>();
  for (const [i, j] of pairIdx) {
    const ra = LA.rows[i];
    const rb = LB.rows[j];
    rowMap.set(ra.id, rb.id);
    if (ra.kind === "anyOf" && rb.kind === "anyOf") {
      const p = pairByScore<ChildRow>(ra.rows, rb.rows, (x, y) => rowScore(x, y, env));
      for (const [x, y] of p.pairs) rowMap.set(ra.rows[x].id, rb.rows[y].id);
    }
  }
  compareQuestions(lf, LA.questions ?? [], LB.questions ?? [], rowMap, env);

  const pairedA = new Set(pairIdx.map((x) => x[0]));
  const pairedB = new Set(pairIdx.map((x) => x[1]));
  const onlyA = onlyAIdx.map((i) => {
    const s = sideOf(a, LA.rows[i]);
    const hints = counterpartHints(LA.rows[i], LB.rows, pairedB, env, true);
    if (hints.length) s.counterparts = hints;
    return s;
  });
  const onlyB = onlyBIdx.map((j) => {
    const s = sideOf(b, LB.rows[j]);
    const hints = counterpartHints(LB.rows[j], LA.rows, pairedA, env, false);
    if (hints.length) s.counterparts = hints;
    return s;
  });

  const all = [...lf.list, ...pairs.flatMap((p) => p.differences)];
  const count = (s: DiffSeverity) => all.filter((x) => x.severity === s).length;
  const real = count("real") + onlyA.length + onlyB.length;

  return {
    programId: a.programId,
    layerFields: lf.list,
    pairs,
    onlyA,
    onlyB,
    realCount: real,
    authors: {
      a: { author: a.author, model: a.model, framing: a.framing },
      b: { author: b.author, model: b.model, framing: b.framing },
    },
    catalog: { used: !!catalog, courses: catalog?.courses.length ?? 0 },
    counts: { real, equivalent: count("equivalent"), harmless: count("harmless"), rowsA: LA.rows.length, rowsB: LB.rows.length },
  };
}

// ─── Markdown ───────────────────────────────────────────────────────────────

function compact(v: unknown): string {
  const s = v === undefined || v === null ? "(absent)" : canonicalStringify(v);
  return "`" + s.replace(/`/g, "'") + "`";
}

function quoteBlock(quotes: string[]): string[] {
  if (!quotes.length) return ["_(no quote cited)_"];
  return quotes.flatMap((q) => [`> ${q.replace(/\s+/g, " ").trim()}`, ">"]).slice(0, -1);
}

function sideBlock(label: string, s: RowSide): string[] {
  const x = s as Partial<DiffSide>;
  const out = [`**${label}** \`${s.key}\` (${s.kind}) — ${s.label}`, `- anchor: ${s.anchor}`];
  if (x.meaning) out.push(`- means: ${x.meaning}`);
  out.push("", ...quoteBlock(s.quotes), "");
  return out;
}

/** diff.md: header, every real difference with both sides, the catalog
 *  equivalences, then one line counting the harmless ones. diff.md lives in
 *  the PRIVATE provenance folder, so the authors' quotes are included. */
export function renderDiffMarkdown(d: LayerDiff): string {
  const x = d as Partial<DiffReport>;
  const all = [...d.layerFields, ...d.pairs.flatMap((p) => p.differences)];
  const nEq = all.filter((f) => f.severity === "equivalent").length;
  const nHarm = all.filter((f) => f.severity === "harmless").length;
  const L: string[] = [];
  L.push(`# Diff — ${d.programId}`, "");
  if (x.authors) {
    L.push(`- Author A: ${x.authors.a.model} (${x.authors.a.framing})`);
    L.push(`- Author B: ${x.authors.b.model} (${x.authors.b.framing})`);
  }
  if (x.catalog) L.push(`- Catalog: ${x.catalog.used ? `compared on ${x.catalog.courses} catalog courses` : "not used (rules compared by form only)"}`);
  if (x.counts) L.push(`- Rows: A ${x.counts.rowsA}, B ${x.counts.rowsB}; paired ${d.pairs.length}, only A ${d.onlyA.length}, only B ${d.onlyB.length}`);
  L.push(`- **Real differences: ${d.realCount}** · equivalent on the catalog: ${nEq} · harmless: ${nHarm}`, "");
  L.push(d.realCount === 0 ? "The drafts agree on every requirement." : "Each item below needs a resolver decision. Use the `ref` line as the decision's ref.", "");

  let n = 0;
  const realLayer = d.layerFields.filter((f) => f.severity === "real");
  const realPairs = d.pairs.map((p) => ({ p, ds: p.differences.filter((f) => f.severity === "real") })).filter((x2) => x2.ds.length);
  if (d.realCount > 0) L.push("## Real differences", "");
  for (const f of realLayer) {
    L.push(`### ${++n}. Layer field \`${f.path}\``, "", `ref: \`layer ${f.path}\``, "", `- A: ${compact(f.a)}`, `- B: ${compact(f.b)}`);
    if (f.note) L.push(`- note: ${f.note}`);
    L.push("");
  }
  for (const { p, ds } of realPairs) {
    for (const f of ds) {
      L.push(`### ${++n}. \`${p.a.key}\` ~ \`${p.b.key}\` — \`${f.path}\``, "", `ref: \`pair ${p.a.key}~${p.b.key} ${f.path}\``, "");
      L.push(...sideBlock("A", p.a), ...sideBlock("B", p.b));
      L.push(`- A value: ${compact(f.a)}`, `- B value: ${compact(f.b)}`);
      if (f.note) L.push(`- note: ${f.note}`);
      L.push("");
    }
  }
  const only = (which: "A" | "B", list: RowSide[]) => {
    for (const s of list) {
      L.push(`### ${++n}. Only in ${which}: \`${s.key}\` (${s.kind}) — ${s.label}`, "", `ref: \`only${which} ${s.key}\``, "");
      L.push(...sideBlock(which, s));
      const hints = (s as Partial<DiffSide>).counterparts ?? [];
      if (hints.length) {
        L.push(`Possible counterpart in ${which === "A" ? "B" : "A"} (still a real difference until resolved):`);
        for (const h of hints) L.push(`- ${h}`);
        L.push("");
      } else L.push(`No row in ${which === "A" ? "B" : "A"} looks like its counterpart.`, "");
    }
  };
  only("A", d.onlyA);
  only("B", d.onlyB);

  L.push("## Equivalent on the catalog", "");
  const eqLayer = d.layerFields.filter((f) => f.severity === "equivalent");
  const eqPairs = d.pairs.flatMap((p) => p.differences.filter((f) => f.severity === "equivalent").map((f) => ({ p, f })));
  if (!eqLayer.length && !eqPairs.length) L.push("None.", "");
  for (const f of eqLayer) L.push(`- layer \`${f.path}\`: A ${compact(f.a)} · B ${compact(f.b)}${f.note ? ` — ${f.note}` : ""}`);
  for (const { p, f } of eqPairs) L.push(`- \`${p.a.key}\` ~ \`${p.b.key}\` \`${f.path}\`: A ${compact(f.a)} · B ${compact(f.b)}${f.note ? ` — ${f.note}` : ""}`);
  if (eqLayer.length || eqPairs.length) L.push("");

  L.push("## Harmless", "", `${nHarm} harmless difference(s) (ids, labels, headings, notes, order, defaults written out) — listed in diff.json.`, "");
  return L.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx diff-layers.ts <draftA.json> <draftB.json> [--dump <path> | --no-catalog] [--out <dir>]";

function main(): number {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let dump: string | undefined;
  let noCatalog = false;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === "--dump") dump = args[++i];
    else if (x === "--no-catalog") noCatalog = true;
    else if (x === "--out") out = args[++i];
    else if (x.startsWith("--")) {
      console.error(`unknown flag ${x}\n${USAGE}`);
      return 2;
    } else files.push(x);
  }
  if (files.length !== 2 || (dump !== undefined && noCatalog) || (args.includes("--dump") && !dump) || (args.includes("--out") && !out)) {
    console.error(USAGE);
    return 2;
  }

  let a: Draft;
  let b: Draft;
  try {
    a = readDraft(resolve(files[0]));
    b = readDraft(resolve(files[1]));
  } catch (e) {
    console.error(`cannot read drafts: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  let catalog: DistCatalog | undefined;
  if (!noCatalog) {
    const path = dump ? resolve(dump) : DEFAULT_DUMP;
    if (dump || existsSync(path)) {
      try {
        catalog = loadDistCatalog(path);
      } catch (e) {
        console.error(`cannot load catalog dump: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    } else console.warn(`no catalog dump at ${path}; comparing rules by form only`);
  }

  let outDir: string;
  try {
    outDir = out ? resolve(out) : provenanceDir(a.programId);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }

  const report = diffLayers(a, b, catalog);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, PROVENANCE_FILES.diffJson), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, PROVENANCE_FILES.diffMd), renderDiffMarkdown(report));
  console.log(
    `${report.programId}: ${report.realCount} real, ${report.counts.equivalent} equivalent, ${report.counts.harmless} harmless ` +
      `(paired ${report.pairs.length}, only A ${report.onlyA.length}, only B ${report.onlyB.length}${catalog ? `, catalog ${catalog.courses.length} courses` : ", no catalog"})`,
  );
  console.log(`wrote ${join(outDir, PROVENANCE_FILES.diffJson)} and ${PROVENANCE_FILES.diffMd}`);
  return report.realCount === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main());
