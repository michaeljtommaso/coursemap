// scripts/validate-layers.ts
// Offline satisfiability check for Distribution-engine requirement layers
// (spec 019 D4/D13). Every row of every layer file is evaluated against a
// catalog DUMP: a rule no catalog course can satisfy is an encoding bug (a typo'd
// tag, a retired subject, a category nobody can fill) and fails the run.
//
// Offline only, by design: authoring runs against a dump (spec D13), so there is
// no Firestore mode and no credentials are read.
//
//   npx tsx validate-layers.ts --dump <catalog-dump.json> [layer files or dirs...]
//
// Layer paths default to scripts/seed-data/layers (searched recursively for
// *.json). The dump may be either a JSON array of course docs or a backup file
// shaped { courses: { "<id>": doc } } (scripts/backups/catalog-backup-*.json).
//
// What it checks, per layer:
//   ERROR  a seat / pool / credits / anyOf-child rule matches no catalog course
//   ERROR  a distribution category matches no eligible course, or fewer
//          categories are fillable than minDistinctCategories, or fewer eligible
//          courses exist than requiredCourses
//   ERROR  a pool or credits row cannot reach its required credits/courses even
//          with every matching catalog course (credits rows with sameSubject:
//          the best single subject)
//   ERROR  a limit with a minimum matches no course the row counts
//   ERROR  a tag leaf names a roster attribute no catalog course carries
//          (pass --new-tag <TAG> to downgrade one to a warning, only when the tag
//          is shown to be new on a roster newer than the dump)
//   ERROR  a subject leaf names a subject absent from the catalog, or a course
//          leaf names a course id absent from the catalog
//   WARN   a row matches fewer than LOW_COVERAGE catalog courses
// Structure and schema (ids, numbers, flags) are linted app-side by
// cornell-degree-planner/src/lib/planner/distribution/layers.test.ts.
//
// The rule evaluator below MIRRORS the canonical one,
// cornell-degree-planner/src/lib/planner/distribution/rules.ts, because scripts/
// is a standalone package with no import path into cornell-degree-planner/src
// (same convention as scripts/catalog-index.ts). Keep the two in sync; a catalog
// course is never AP/IB credit and carries no cross-listing data, so the
// creditKind leaf is always false here and crossListed adds nothing. A `program`
// leaf depends on the student, so each row is counted under every program id its
// rule names (and under none) and the best count is reported.
//
// Structure (house style, mirrors validate-programs.ts): pure functions that the
// corpus (validate-layers.corpus.ts) exercises with zero IO, plus a thin main().

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { patternToRegex } from "./validate-programs";

// ─── Catalog ──────────────────────────────────────────────────────────────────
export type CatalogCourse = {
  id: string;
  subject: string;
  number: string;
  title?: string | null;
  titleLong?: string | null;
  creditsMin?: number;
  creditsMax?: number;
  attrs?: { value: string; descr?: string; group?: string }[] | null;
};

export type Catalog = {
  courses: CatalogCourse[];
  ids: Set<string>;
  subjects: Set<string>;
  tags: Set<string>;
};

export function buildCatalog(courses: CatalogCourse[]): Catalog {
  const ids = new Set<string>();
  const subjects = new Set<string>();
  const tags = new Set<string>();
  for (const c of courses) {
    ids.add(c.id);
    subjects.add(c.subject);
    for (const a of c.attrs ?? []) tags.add(a.value);
  }
  return { courses, ids, subjects, tags };
}

/** Accepts a plain array of course docs or the backup's { courses: { id: doc } }. */
export function parseCatalogDump(raw: unknown): CatalogCourse[] {
  if (Array.isArray(raw)) return raw as CatalogCourse[];
  if (raw && typeof raw === "object" && "courses" in raw) {
    const courses = (raw as { courses: unknown }).courses;
    if (Array.isArray(courses)) return courses as CatalogCourse[];
    if (courses && typeof courses === "object") {
      return Object.entries(courses as Record<string, CatalogCourse>).map(([id, doc]) => ({ ...doc, id: doc.id ?? id }));
    }
  }
  throw new Error("--dump must be a JSON array of course docs or an object with a `courses` map");
}

export function loadCatalogDump(path: string): CatalogCourse[] {
  return parseCatalogDump(JSON.parse(readFileSync(path, "utf-8")));
}

// ─── Layer shapes (mirrors distribution/types.ts, trimmed to what is read) ────
export type CourseRule =
  | { tag: string[] }
  | { subject: string[]; crossListed?: boolean }
  | { number: { min?: number; max?: number } }
  | { course: string[] }
  | { pattern: string }
  | { titleStartsWith: string }
  | { minCredits: number }
  | { variableCredit: true }
  | { creditKind: string[] }
  | { program: string[] }
  | { allOf: CourseRule[] }
  | { anyOf: CourseRule[] }
  | { not: CourseRule };

export type RowLimit = {
  rule: CourseRule;
  label?: string;
  minCourses?: number;
  maxCourses?: number;
  minCredits?: number;
  maxCredits?: number;
};

export type LayerRow = {
  id: string;
  kind: "seat" | "pool" | "distribution" | "credits" | "anyOf" | "confirm";
  label?: string;
  rule?: CourseRule;
  requiredCourses?: number;
  requiredCredits?: number;
  sameSubject?: boolean;
  minDistinctCategories?: number;
  categories?: { id: string; label?: string; rule: CourseRule }[];
  limits?: RowLimit[];
  rows?: LayerRow[];
};

export type LayerFile = { id: string; kind: string; family: string; rows: LayerRow[] };

// ─── Rule evaluator (MIRROR of distribution/rules.ts courseMatchesRule) ───────
export function courseMatchesRule(course: CatalogCourse, rule: CourseRule, programId: string | null): boolean {
  if ("allOf" in rule) return rule.allOf.every((r) => courseMatchesRule(course, r, programId));
  if ("anyOf" in rule) return rule.anyOf.some((r) => courseMatchesRule(course, r, programId));
  if ("not" in rule) return !courseMatchesRule(course, rule.not, programId);

  if ("tag" in rule) {
    const have = (course.attrs ?? []).map((a) => a.value);
    return rule.tag.some((t) => have.includes(t));
  }
  if ("subject" in rule) return rule.subject.includes(course.subject); // no cross-listing data in a dump
  if ("number" in rule) {
    const n = parseInt(course.number, 10);
    if (Number.isNaN(n)) return false;
    const { min, max } = rule.number;
    return (min == null || n >= min) && (max == null || n <= max);
  }
  if ("course" in rule) return rule.course.includes(course.id);
  if ("pattern" in rule) return patternToRegex(rule.pattern).test(`${course.subject} ${course.number}`);
  if ("titleStartsWith" in rule) {
    const title = course.title ?? course.titleLong;
    return title != null && title.startsWith(rule.titleStartsWith);
  }
  if ("minCredits" in rule) return credits(course) >= rule.minCredits;
  if ("variableCredit" in rule) return (course.creditsMax ?? credits(course)) > credits(course);
  if ("creditKind" in rule) return false; // catalog courses are never AP/IB/transfer credit
  if ("program" in rule) {
    // rules.ts: a listed id matches itself and every catalog year of it.
    return programId != null && rule.program.some((p) => programId === p || programId.startsWith(`${p}-`));
  }
  return false;
}

/** A catalog course's credit value as the board places it (creditsMin). */
export function credits(c: CatalogCourse): number {
  return c.creditsMin ?? c.creditsMax ?? 0;
}

/** Every value of one leaf kind used anywhere in a rule. */
export function leafValues(rule: CourseRule, key: "tag" | "subject" | "course" | "program"): string[] {
  if ("allOf" in rule) return rule.allOf.flatMap((r) => leafValues(r, key));
  if ("anyOf" in rule) return rule.anyOf.flatMap((r) => leafValues(r, key));
  if ("not" in rule) return leafValues(rule.not, key);
  if (key in rule) return (rule as Record<string, string[]>)[key];
  return [];
}

const and = (...rules: (CourseRule | undefined)[]): CourseRule => {
  const present = rules.filter((r): r is CourseRule => r != null);
  return present.length === 1 ? present[0] : { allOf: present };
};

// ─── Validation ───────────────────────────────────────────────────────────────
export const LOW_COVERAGE = 3;

export type RowCoverage = { where: string; count: number; credits: number };
export type LayerReport = {
  file: string;
  id: string;
  rowsChecked: number;
  confirmRows: number;
  coverage: RowCoverage[];
  errors: string[];
  warnings: string[];
};

export type ValidateOptions = { newTags?: string[] };

function matching(catalog: Catalog, rule: CourseRule, programs: string[]): CatalogCourse[] {
  let best: CatalogCourse[] = [];
  for (const p of [null, ...programs]) {
    const hits = catalog.courses.filter((c) => courseMatchesRule(c, rule, p));
    if (hits.length > best.length) best = hits;
  }
  return best;
}

function bestSubjectCredits(courses: CatalogCourse[]): number {
  const bySubject = new Map<string, number>();
  for (const c of courses) bySubject.set(c.subject, (bySubject.get(c.subject) ?? 0) + credits(c));
  return Math.max(0, ...bySubject.values());
}

export function validateLayer(file: string, layer: LayerFile, catalog: Catalog, opts: ValidateOptions = {}): LayerReport {
  const report: LayerReport = { file, id: layer.id, rowsChecked: 0, confirmRows: 0, coverage: [], errors: [], warnings: [] };
  const newTags = new Set(opts.newTags ?? []);
  const seenTag = new Set<string>();
  const seenSubject = new Set<string>();
  const seenCourse = new Set<string>();

  const checkLeaves = (where: string, rule: CourseRule) => {
    for (const t of leafValues(rule, "tag")) {
      if (catalog.tags.has(t) || seenTag.has(t)) continue;
      seenTag.add(t);
      if (newTags.has(t)) report.warnings.push(`${where}: tag ${t} is on no catalog course (declared new with --new-tag)`);
      else report.errors.push(`${where}: tag ${t} is on no catalog course`);
    }
    for (const s of leafValues(rule, "subject")) {
      if (catalog.subjects.has(s) || seenSubject.has(s)) continue;
      seenSubject.add(s);
      report.errors.push(`${where}: subject ${s} is not in the catalog`);
    }
    for (const id of leafValues(rule, "course")) {
      if (catalog.ids.has(id) || seenCourse.has(id)) continue;
      seenCourse.add(id);
      report.errors.push(`${where}: course ${id} is not in the catalog`);
    }
  };

  const cover = (where: string, rule: CourseRule): CatalogCourse[] => {
    checkLeaves(where, rule);
    const hits = matching(catalog, rule, leafValues(rule, "program"));
    const total = hits.reduce((n, c) => n + credits(c), 0);
    report.coverage.push({ where, count: hits.length, credits: total });
    if (hits.length === 0) report.errors.push(`${where}: no catalog course matches`);
    else if (hits.length < LOW_COVERAGE) report.warnings.push(`${where}: only ${hits.length} catalog course(s) match`);
    return hits;
  };

  const checkLimits = (where: string, rowRule: CourseRule, limits: RowLimit[] | undefined) => {
    for (const [i, l] of (limits ?? []).entries()) {
      const lw = `${where} limit[${i}]${l.label ? ` "${l.label}"` : ""}`;
      const needsSome = (l.minCourses ?? 0) > 0 || (l.minCredits ?? 0) > 0;
      checkLeaves(lw, l.rule);
      const hits = matching(catalog, and(rowRule, l.rule), [...leafValues(rowRule, "program"), ...leafValues(l.rule, "program")]);
      const total = hits.reduce((n, c) => n + credits(c), 0);
      report.coverage.push({ where: lw, count: hits.length, credits: total });
      if (!needsSome) continue;
      if (hits.length === 0) report.errors.push(`${lw}: no catalog course the row counts matches this limit`);
      else if ((l.minCourses ?? 0) > hits.length) report.errors.push(`${lw}: needs ${l.minCourses} courses, catalog has ${hits.length}`);
      else if ((l.minCredits ?? 0) > total) report.errors.push(`${lw}: needs ${l.minCredits} credits, catalog has ${total}`);
    }
  };

  const checkRow = (row: LayerRow, where: string) => {
    if (row.kind === "confirm") {
      report.confirmRows++;
      return;
    }
    if (row.kind === "anyOf") {
      for (const child of row.rows ?? []) checkRow(child, `${where}/${child.id}`);
      return;
    }
    report.rowsChecked++;
    if (row.kind === "distribution") {
      const eligible = row.rule;
      const union = new Set<string>();
      let fillable = 0;
      for (const cat of row.categories ?? []) {
        const hits = cover(`${where}[${cat.id}]`, and(eligible, cat.rule));
        if (hits.length > 0) fillable++;
        for (const h of hits) union.add(h.id);
      }
      const minCats = row.minDistinctCategories ?? 0;
      if (fillable < minCats) report.errors.push(`${where}: only ${fillable} categories are fillable, needs ${minCats}`);
      if ((row.requiredCourses ?? 0) > union.size) {
        report.errors.push(`${where}: needs ${row.requiredCourses} courses, only ${union.size} catalog courses are eligible`);
      }
      return;
    }
    if (!row.rule) {
      report.errors.push(`${where}: ${row.kind} row has no rule`);
      return;
    }
    const hits = cover(where, row.rule);
    if (hits.length === 0) return;
    if (row.kind === "pool") {
      const total = hits.reduce((n, c) => n + credits(c), 0);
      if ((row.requiredCourses ?? 0) > hits.length) report.errors.push(`${where}: needs ${row.requiredCourses} courses, catalog has ${hits.length}`);
      if ((row.requiredCredits ?? 0) > total) report.errors.push(`${where}: needs ${row.requiredCredits} credits, catalog has ${total}`);
      checkLimits(where, row.rule, row.limits);
    } else if (row.kind === "credits") {
      const reachable = row.sameSubject ? bestSubjectCredits(hits) : hits.reduce((n, c) => n + credits(c), 0);
      if ((row.requiredCredits ?? 0) > reachable) {
        report.errors.push(`${where}: needs ${row.requiredCredits} credits${row.sameSubject ? " in one subject" : ""}, catalog has ${reachable}`);
      }
      checkLimits(where, row.rule, row.limits);
    }
  };

  for (const row of layer.rows) checkRow(row, `${layer.id}:${row.id}`);
  return report;
}

// ─── Layer files ──────────────────────────────────────────────────────────────
export function collectLayerFiles(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const name of readdirSync(p).sort()) walk(join(p, name));
    } else if (p.endsWith(".json")) out.push(p);
  };
  for (const p of paths) walk(p);
  return out;
}

export function readLayerFile(path: string): LayerFile {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (!raw || typeof raw.id !== "string" || !Array.isArray(raw.rows)) {
    throw new Error(`${path}: not a layer file (needs an id and a rows array)`);
  }
  return raw as LayerFile;
}

export function renderReport(r: LayerReport): string {
  const lines = [`\n${r.id}  (${r.file})`, `  rows checked ${r.rowsChecked}, confirm rows ${r.confirmRows}`];
  for (const c of r.coverage) lines.push(`    ${String(c.count).padStart(5)} courses ${String(c.credits).padStart(6)} cr  ${c.where}`);
  if (r.errors.length) lines.push(`  ERRORS (${r.errors.length}):`, ...r.errors.map((e) => `    x ${e}`));
  if (r.warnings.length) lines.push(`  WARNINGS (${r.warnings.length}):`, ...r.warnings.map((w) => `    ! ${w}`));
  if (!r.errors.length && !r.warnings.length) lines.push("  OK");
  return lines.join("\n");
}

export const DEFAULT_LAYER_DIR = resolve(__dirname, "seed-data", "layers");

// ─── main() ───────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  let dumpPath: string | null = null;
  const newTags: string[] = [];
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dump") dumpPath = args[++i] ?? null;
    else if (args[i] === "--new-tag") newTags.push(args[++i] ?? "");
    else paths.push(args[i]);
  }
  if (!dumpPath) {
    console.error("ABORTED: --dump <catalog-dump.json> is required (this validator is offline only).");
    process.exit(1);
  }

  let files: string[];
  if (paths.length) {
    files = collectLayerFiles(paths.map((p) => resolve(p)));
    if (!files.length) {
      console.error("ABORTED: no layer *.json files under the given paths.");
      process.exit(1);
    }
  } else if (existsSync(DEFAULT_LAYER_DIR)) {
    files = collectLayerFiles([DEFAULT_LAYER_DIR]);
  } else {
    console.log(`No layer files: ${DEFAULT_LAYER_DIR} does not exist yet. Nothing to validate.`);
    process.exit(0);
  }

  const catalog = buildCatalog(loadCatalogDump(resolve(dumpPath)));
  console.log(`Catalog: ${catalog.courses.length} courses, ${catalog.subjects.size} subjects, ${catalog.tags.size} tags (dump: ${dumpPath})`);

  let errors = 0;
  let warnings = 0;
  for (const f of files) {
    const r = validateLayer(f, readLayerFile(f), catalog, { newTags });
    console.log(renderReport(r));
    errors += r.errors.length;
    warnings += r.warnings.length;
  }
  console.log(`\n${files.length} layer file(s): ${errors} error(s), ${warnings} warning(s).`);
  console.log(errors ? "VALIDATION FAILED — fix ERRORS above." : "VALIDATION PASSED.");
  process.exit(errors ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
