// scripts/outside-major-holdout.ts
// Major-dependent minor rows (spec 047), derived from the majors themselves.
// Some minors let a row count a course only when it is outside the student's
// major ("electives outside your major"), outside the major's DEPARTMENT ("not
// from the department of your academic major"), or not the intro course the
// major already requires. The Distribution engine has no notion of "my
// major's courses", so the row encodes it with `program` leaves: for every
// major the app offers, the courses of the row that major claims, each paired
// with that major's program-id prefix:
//
//   { "allOf": [ <the row's courses>,
//                { "not": { "anyOf": [
//                    { "allOf": [ { "course": [...] }, { "program": ["cornell-x-bs", ...] } ] },
//                    { "allOf": [ { "subject": ["X"] }, { "program": [...] } ] },
//                    ... ] } } ] }
//
// (`program` matches the primary major or any other program on the plan, so a
// second major's courses are held out too.) When the page's rule is "N of the
// M courses" instead of every course, the same branches become a `limits`
// entry on the row: `maxCourses` over the major's courses ("two of the three
// from outside your department" = at most one inside), or `minCourses` over
// the courses outside it ("at least one elective outside your major").
//
// Which rows are managed, and how, is scripts/seed-data/outside-major-rows.json
// ({ program, row, mode, twins?, output?, requires?, holdOut? }). Modes
// (strict throughout: a false red is acceptable, a false green is not):
//
//   major       "outside your major". A course is the major's when:
//     - Layer majors (seed-data/layers/cas, cals; the major and all its
//       concentration layers, under the major's prefix): a branch of a
//       consuming, credits or overlay row's rule (seat, pool, distribution
//       and its categories, anyOf children; every row but confirm rows)
//       matches it, with every question read as answered yes. Only
//       "anchored" branches count: a branch that names courses or subjects
//       (course, subject, pattern or title leaves). A branch that admits any
//       course by level, attribute or "not these subjects" alone is a free or
//       outside elective, not the major's own courses. A course an anchored
//       branch names by id is the major's even when the branch's other
//       conditions (credits, level) would refuse it, and a variable-credit
//       course is read at its lowest and its highest credits.
//     - Engineering majors (slot templates in seed-data/programs.json and
//       programs-2025/): a seat (course, pattern, attribute) or an elective
//       group the template's matcher builds admits it, except liberal
//       studies, writing seminars and PE (spec 047 D7: they never count toward
//       overlap) and groups of type "open", "outside" or "category".
//     - Home subjects: every row course in a major's home subject, whether or
//       not a rule reaches its number. A home subject is one the major counts
//       as a whole (a `subject` leaf in an anchored rule, a template's `level`
//       group) or one it requires a course in (a seat whose named courses all
//       share that subject; a template's course seat).
//     - twins: true adds every cross-listing of a course held so far (see
//       Twins below).
//
//   department  "not from your major's department". Every row course in one
//     of the major's department subjects, plus its cross-listings (a course
//     offered under a department subject and another code is the
//     department's whichever code the student takes). Department subjects:
//     - Layer majors: the subjects the major counts as a whole (`subject`
//       leaves in anchored branches), plus its main subject: the subject with
//       the most distinct courses its anchored branches and seats name (all
//       subjects tied for most).
//     - Engineering templates: the subject with the most course seats in the
//       template's "core" category (all tied), plus the subjects an "outside
//       the major" group excludes. Common-curriculum seats (math, science,
//       ENGRD/ENGRI patterns) are not the department.
//     - then seed-data/major-departments.json: `majors[prefix].department`
//       adds subjects the requirements cannot show, and `departments` widens a
//       subject to every subject its department teaches under (Psychology:
//       PSYCH and HD).
//     Limits: a department that teaches under a subject the major never names
//     and the table does not list is missed (add it to the table); a major
//     that counts another department's subject as a whole holds that subject
//     out too (a false red, never a false green).
//
//   courses     "if your major requires X, take something else". The spec's
//     `holdOut` courses are held out for every major whose own requirements
//     name any of its `requires` courses: a layer seat that admits one, or an
//     anchored branch that names one by id; a template seat that admits one,
//     or a list group that names one. (Naming in an elective list is read as
//     requiring: strict.)
//
// Twins (cross-listings): two catalog courses with the same roster course id
// (the dump's rosterId, Cornell's crseId) are one course under two codes. A
// page-only course (not in the dump) is paired with a row course of the same
// title under another subject.
//
// Majors the app does not offer yet: seed-data/major-departments.json
// `majors[prefix]` with notInApp holds out its `subjects` (and in department
// mode their departments and twins), so a plan naming that prefix is held to
// the rule once the major exists. The minor's own program never holds out.
//
// Run (from scripts/):
//   npx tsx outside-major-holdout.ts --program <minorId> --row <rowId>
//        [--mode major|department|courses] [--twins] [--dump <path>]
//        [--write] [--check] [--json <out>]
//   npx tsx outside-major-holdout.ts --all [--dump <path>] [--write] [--check]
//   Reads docs/provenance/<minorId>/merged.json (the expanded row) and
//   merged.src.json. The row's spec comes from outside-major-rows.json (a
//   row not listed there defaults to mode major, hold-out output; --mode and
//   --twins override; --dump overrides the spec's `dump`, a file name under
//   scripts/backups/, else the authoring dump). Prints what each major holds out. --write replaces the
//   row's hold-out (or its managed limit: the limit whose rule names a
//   program) in merged.src.json (re-run expand-draft.ts after). --check
//   exits 1 when merged.src.json differs from the derived row. --all runs
//   every row of outside-major-rows.json.
// Exit: 0 ok, 1 --check found a difference, 2 bad usage or unreadable input.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { courseMatchesRule, type RuleContext } from "../cornell-degree-planner/src/lib/planner/distribution/rules";
import { questionScopes } from "../cornell-degree-planner/src/lib/planner/questions/keys";
import type { CourseRule, Layer as AppLayer } from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { courseSatisfiesRequirement } from "../cornell-degree-planner/src/lib/planner/satisfies";
import { poolQualifies, programToRequirements } from "../cornell-degree-planner/src/lib/planner/majorMatch";
import { programSlotsToMatchInput } from "../cornell-degree-planner/src/lib/planner/matchAdapters";
import { canonicalStringify } from "./canonical-json";
import { loadPageOnly } from "./check-golden-layer";
import { loadVerifiedExtract } from "./extract-catalog-page";
import { loadTemplateProgram, templateSlots, type TemplateProgram } from "./check-overlap-fixture";
import { DEFAULT_DUMP, LAYERS_DIR, PROVENANCE_FILES, loadDistCatalog, provenanceDir, readLayerOrDraft, type DistCourse, type Layer } from "./layer-authoring";
import { loadCatalogDump } from "./validate-layers";

const SEED_DIR = join(__dirname, "seed-data");
export const DEPARTMENTS_FILE = join(SEED_DIR, "major-departments.json");
export const ROWS_FILE = join(SEED_DIR, "outside-major-rows.json");
/** Template slot categories that never count toward a major (spec 047 D7). */
const OUTSIDE_MAJOR_CATEGORIES = new Set(["liberal", "fws", "pe"]);
/** Elective-group rule types that admit any course (free / outside electives). */
const OPEN_GROUP_TYPES = new Set(["open", "outside", "category"]);

/** "cornell-x-bs-2026" → "cornell-x-bs". */
export function programPrefix(programId: string): string {
  return programId.replace(/-\d{4}$/, "");
}

// ─── Specs and the department table ─────────────────────────────────────────

export type HoldOutMode = "major" | "department" | "courses";
export type LimitOutput = { maxCourses?: number; minCourses?: number; label?: string };
export type RowSpec = {
  program: string;
  row: string;
  mode: HoldOutMode;
  twins?: boolean;
  output?: { limit?: LimitOutput };
  requires?: string[];
  holdOut?: string[];
  /** Catalog dump (a file name under scripts/backups/) the row was derived
   *  with; a newer dump knows more cross-listings. Default: the authoring dump. */
  dump?: string;
};
export type DepartmentTable = {
  departments: { name: string; subjects: string[] }[];
  majors: Record<string, { department?: string[]; notInApp?: boolean; subjects?: string[] }>;
};

export const EMPTY_TABLE: DepartmentTable = { departments: [], majors: {} };
const PROGRAM_ID_MAX = 40;

export function loadDepartmentTable(path: string = DEPARTMENTS_FILE): DepartmentTable {
  if (!existsSync(path)) return EMPTY_TABLE;
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<DepartmentTable>;
  // A `program` leaf holds ids of at most 40 characters (the layer schema).
  const long = Object.keys(raw.majors ?? {}).filter((p) => p.length > PROGRAM_ID_MAX);
  if (long.length) throw new Error(`${path}: program prefix longer than ${PROGRAM_ID_MAX} characters: ${long.join(", ")}`);
  return { departments: raw.departments ?? [], majors: raw.majors ?? {} };
}

/** Problems with a spec (empty when usable). */
export function specProblems(s: RowSpec): string[] {
  const out: string[] = [];
  if (!s.program || !s.row) out.push("a spec needs program and row");
  if (!["major", "department", "courses"].includes(s.mode)) out.push(`${s.program}/${s.row}: unknown mode ${s.mode}`);
  if (s.mode === "courses" && (!s.requires?.length || !s.holdOut?.length)) out.push(`${s.program}/${s.row}: mode courses needs requires and holdOut`);
  const l = s.output?.limit;
  if (l && (l.maxCourses == null) === (l.minCourses == null)) out.push(`${s.program}/${s.row}: a limit output needs exactly one of maxCourses or minCourses`);
  return out;
}

export function loadRowSpecs(path: string = ROWS_FILE): RowSpec[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { rows?: RowSpec[] };
  const rows = raw.rows ?? [];
  const problems = rows.flatMap(specProblems);
  if (problems.length) throw new Error(problems.join("; "));
  return rows;
}

// ─── Majors ─────────────────────────────────────────────────────────────────

export type MajorSource =
  | { prefix: string; programId: string; kind: "layer"; layers: Layer[] }
  | { prefix: string; programId: string; kind: "template"; template: TemplateProgram }
  | { prefix: string; programId: string; kind: "offline"; subjects: string[] };

type RowLike = { kind: string; rule?: CourseRule; categories?: { rule: CourseRule }[]; rows?: RowLike[] };

/** Every rule of a layer row a course could be counted by (confirm rows have none). */
function rowRules(row: RowLike): CourseRule[] {
  if (row.kind === "confirm") return [];
  if (row.kind === "anyOf") return (row.rows ?? []).flatMap(rowRules);
  const out: CourseRule[] = [];
  if (row.kind === "distribution") {
    for (const c of row.categories ?? []) out.push(row.rule ? { allOf: [row.rule, c.rule] } : c.rule);
    if (!row.categories?.length && row.rule) out.push(row.rule);
  } else if (row.rule) out.push(row.rule);
  return out;
}

/** The rule split at its top-level anyOf (and anyOf directly inside allOf
 *  distributes: allOf[a, anyOf[b, c]] → allOf[a, b], allOf[a, c]). */
export function branches(rule: CourseRule): CourseRule[] {
  if ("anyOf" in rule) return rule.anyOf.flatMap(branches);
  if ("allOf" in rule) {
    let acc: CourseRule[][] = [[]];
    for (const child of rule.allOf) {
      const bs = "anyOf" in child || "allOf" in child ? branches(child) : [child];
      acc = acc.flatMap((prefix) => bs.map((b) => [...prefix, b]));
      if (acc.length > 256) return [rule]; // keep it bounded; the whole rule is one branch
    }
    return acc.map((parts) => (parts.length === 1 ? parts[0] : { allOf: parts }));
  }
  return [rule];
}

const ANCHOR_LEAVES = ["course", "subject", "pattern", "titleStartsWith"] as const;

/** Does the rule name its courses (a course, subject, pattern or title leaf
 *  outside any `not`)? A rule that admits courses only by level, attribute,
 *  credits or exclusion is a free or outside elective. */
export function anchored(rule: CourseRule): boolean {
  if ("allOf" in rule) return rule.allOf.some(anchored);
  if ("anyOf" in rule) return rule.anyOf.length > 0 && rule.anyOf.every(anchored);
  if ("not" in rule) return false;
  return ANCHOR_LEAVES.some((k) => k in rule);
}

/** Subjects a rule names positively (its `subject` leaves outside any `not`). */
export function namedSubjects(rule: CourseRule): string[] {
  if ("allOf" in rule) return rule.allOf.flatMap(namedSubjects);
  if ("anyOf" in rule) return rule.anyOf.flatMap(namedSubjects);
  if ("not" in rule) return [];
  if ("subject" in rule) return [...rule.subject];
  return [];
}

/** Course ids a rule names positively (its `course` leaves outside any `not`). */
export function namedCourses(rule: CourseRule): string[] {
  if ("allOf" in rule) return rule.allOf.flatMap(namedCourses);
  if ("anyOf" in rule) return rule.anyOf.flatMap(namedCourses);
  if ("not" in rule) return [];
  if ("course" in rule) return [...rule.course];
  return [];
}

/** The rules of a row's seats (a seat row, or seat children of an anyOf row). */
function seatRules(row: RowLike): CourseRule[] {
  if (row.kind === "seat" && row.rule) return [row.rule];
  if (row.kind === "anyOf") return (row.rows ?? []).flatMap(seatRules);
  return [];
}

/** Every major the app offers: the layer majors (with their concentrations)
 *  and the Engineering templates; with a department table, also its notInApp
 *  majors the app does not offer. Minors and college layers are not majors. */
export function listMajors(layersDir: string = LAYERS_DIR, seedDir: string = SEED_DIR, table: DepartmentTable = EMPTY_TABLE): MajorSource[] {
  const byProgram = new Map<string, Layer[]>();
  for (const family of ["cas", "cals"]) {
    const dir = join(layersDir, family);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const layer = readLayerOrDraft(join(dir, f));
      if (layer.kind !== "major" && layer.kind !== "concentration") continue;
      const pid = layer.programId ?? layer.id;
      byProgram.set(pid, [...(byProgram.get(pid) ?? []), layer]);
    }
  }
  const out: MajorSource[] = [];
  for (const [programId, layers] of [...byProgram].sort(([a], [b]) => a.localeCompare(b)))
    out.push({ prefix: programPrefix(programId), programId, kind: "layer", layers });
  const templateIds = new Set<string>();
  const all = existsSync(join(seedDir, "programs.json")) ? (JSON.parse(readFileSync(join(seedDir, "programs.json"), "utf-8")) as { id: string }[]) : [];
  for (const p of all) templateIds.add(p.id);
  const own = join(seedDir, "programs-2025");
  if (existsSync(own)) for (const f of readdirSync(own)) if (f.endsWith(".json")) templateIds.add(f.replace(/\.json$/, ""));
  for (const id of [...templateIds].sort()) {
    const template = loadTemplateProgram(id, seedDir);
    if (template) out.push({ prefix: programPrefix(id), programId: id, kind: "template", template });
  }
  const offered = new Set(out.map((m) => m.prefix));
  for (const [prefix, e] of Object.entries(table.majors).sort(([a], [b]) => a.localeCompare(b)))
    if (e.notInApp && e.subjects?.length && !offered.has(prefix)) out.push({ prefix, programId: prefix, kind: "offline", subjects: [...e.subjects] });
  return out;
}

/** A template's requirements with each one's slot category. */
function templateRequirements(t: TemplateProgram, catalogById: Map<string, DistCourse>) {
  const slots = templateSlots(t, catalogById);
  const categoryOf = new Map<string, string | null>();
  for (const s of slots) {
    categoryOf.set(s.id, s.category ?? null);
    if (s.kind === "elective" && s.elective_group_id && !categoryOf.has(s.elective_group_id)) categoryOf.set(s.elective_group_id, s.category ?? null);
  }
  return programToRequirements(programSlotsToMatchInput(slots)).map((req) => ({ req, category: categoryOf.get(req.id) ?? null }));
}

/** The course ids, held set and every home subject (not narrowed to the candidates) of mode major. */
function majorClaims(major: MajorSource, candidates: DistCourse[], catalogById: Map<string, DistCourse>): { held: Set<string>; home: Set<string> } {
  const held = new Set<string>();
  const home = new Set<string>();
  const candidateIds = new Set(candidates.map((c) => c.id));
  if (major.kind === "offline") {
    for (const s of major.subjects) home.add(s);
  } else if (major.kind === "layer") {
    const ctx: RuleContext = { programId: major.programId, assumeYes: true, questionScopes: questionScopes(major.layers as unknown as AppLayer[]) };
    // A variable-credit course is read at both ends of its range.
    const readings = candidates.map((c) => ({ id: c.id, as: c.creditsMax != null && c.creditsMax !== c.credits ? [c, { ...c, credits: c.creditsMax }] : [c] }));
    for (const layer of major.layers)
      for (const row of layer.rows as RowLike[]) {
        for (const seat of seatRules(row)) {
          const subjects = new Set(namedCourses(seat).map((id) => id.split("-")[0]));
          if (subjects.size === 1) home.add([...subjects][0]);
        }
        for (const rule of rowRules(row))
          for (const b of branches(rule)) {
            if (!anchored(b)) continue;
            for (const s of namedSubjects(b)) home.add(s);
            // A course the major names is the major's, whatever else the branch asks.
            for (const id of namedCourses(b)) if (candidateIds.has(id)) held.add(id);
            for (const r of readings) if (r.as.some((c) => courseMatchesRule(c, b, ctx))) held.add(r.id);
          }
      }
  } else {
    for (const { req, category } of templateRequirements(major.template, catalogById)) {
      if (category && OUTSIDE_MAJOR_CATEGORIES.has(category)) continue;
      if (req.kind === "seat") {
        if (req.req.kind === "course") home.add(req.req.courseId.split("-")[0]);
        for (const c of candidates)
          if (courseSatisfiesRequirement({ id: c.id, subject: c.subject, number: c.number, title: c.title, attrs: c.attrs ?? [] }, req.req)) held.add(c.id);
      } else {
        if (OPEN_GROUP_TYPES.has(req.rule.type)) continue;
        if (req.rule.type === "level") home.add(req.rule.subject);
        for (const c of candidates) if (poolQualifies(req.rule, { id: c.id, subject: c.subject, number: c.number, attrs: c.attrs ?? [] }, req.courseIds)) held.add(c.id);
      }
    }
  }
  return { held, home };
}

export type MajorHold = { courses: string[]; subjects: string[] };

/** The candidates' subjects among `subjects`, and the held courses outside them. */
function narrow(candidates: DistCourse[], held: Set<string>, subjects: Set<string>): MajorHold {
  const candidateSubjects = new Set(candidates.map((c) => c.subject));
  const subs = [...subjects].filter((s) => candidateSubjects.has(s)).sort();
  return { courses: [...held].filter((id) => !subs.includes(id.split("-")[0])).sort(), subjects: subs };
}

/** Mode major: what one major holds out of a list of candidate courses: the
 *  courses its requirements could count, and every candidate in one of its
 *  home subjects (with twins, also every cross-listing of those). */
export function majorHoldOut(major: MajorSource, candidates: DistCourse[], catalogById: Map<string, DistCourse>, twins?: Twins): MajorHold {
  const { held, home } = majorClaims(major, candidates, catalogById);
  if (twins)
    for (const c of candidates) {
      if (home.has(c.subject) || held.has(c.id)) continue;
      if (twins.of(c.id).some((t) => held.has(t) || home.has(t.split("-")[0]))) held.add(c.id);
    }
  return narrow(candidates, held, home);
}

/** The most frequent keys of a count map (all tied), [] when empty. */
function plurality(counts: Map<string, number>): string[] {
  const max = Math.max(0, ...counts.values());
  return max > 0 ? [...counts].filter(([, n]) => n === max).map(([s]) => s) : [];
}

/** Mode department: a major's department subjects (see the header). */
export function departmentSubjects(major: MajorSource, catalogById: Map<string, DistCourse>, table: DepartmentTable = EMPTY_TABLE): string[] {
  const core = new Set<string>();
  if (major.kind === "offline") for (const s of major.subjects) core.add(s);
  else if (major.kind === "layer") {
    const named = new Map<string, Set<string>>();
    const name = (id: string) => {
      const s = id.split("-")[0];
      named.set(s, (named.get(s) ?? new Set()).add(id));
    };
    for (const layer of major.layers)
      for (const row of layer.rows as RowLike[]) {
        for (const seat of seatRules(row)) namedCourses(seat).forEach(name);
        for (const rule of rowRules(row))
          for (const b of branches(rule)) {
            if (!anchored(b)) continue;
            for (const s of namedSubjects(b)) core.add(s);
            namedCourses(b).forEach(name);
          }
      }
    for (const s of plurality(new Map([...named].map(([s, ids]) => [s, ids.size])))) core.add(s);
  } else {
    const seats = new Map<string, number>();
    for (const { req, category } of templateRequirements(major.template, catalogById)) {
      if (req.kind === "seat") {
        if (category === "core" && req.req.kind === "course") {
          const s = req.req.courseId.split("-")[0];
          seats.set(s, (seats.get(s) ?? 0) + 1);
        }
      } else if (req.rule.type === "outside") for (const s of (req.rule as { exclude_subjects?: string[] }).exclude_subjects ?? []) core.add(s);
    }
    for (const s of plurality(seats)) core.add(s);
  }
  for (const s of table.majors[major.prefix]?.department ?? []) core.add(s);
  for (const d of table.departments) if (d.subjects.some((s) => core.has(s))) for (const s of d.subjects) core.add(s);
  return [...core].sort();
}

/** Mode department: every candidate in a department subject, and every
 *  candidate cross-listed with a course in one. */
export function majorDepartmentHoldOut(major: MajorSource, candidates: DistCourse[], catalogById: Map<string, DistCourse>, twins: Twins, table: DepartmentTable = EMPTY_TABLE): MajorHold {
  const dept = new Set(departmentSubjects(major, catalogById, table));
  const held = new Set<string>();
  for (const c of candidates) if (!dept.has(c.subject) && twins.of(c.id).some((t) => dept.has(t.split("-")[0]))) held.add(c.id);
  return narrow(candidates, held, dept);
}

/** Mode courses: does the major's own requirements name any `requires` course? */
export function majorNamesAny(major: MajorSource, requires: DistCourse[], catalogById: Map<string, DistCourse>): boolean {
  if (major.kind === "offline" || !requires.length) return false;
  const ids = new Set(requires.map((c) => c.id));
  if (major.kind === "layer") {
    const ctx: RuleContext = { programId: major.programId, assumeYes: true, questionScopes: questionScopes(major.layers as unknown as AppLayer[]) };
    for (const layer of major.layers)
      for (const row of layer.rows as RowLike[]) {
        for (const seat of seatRules(row)) if (requires.some((c) => courseMatchesRule(c, seat, ctx))) return true;
        for (const rule of rowRules(row)) for (const b of branches(rule)) if (anchored(b) && namedCourses(b).some((id) => ids.has(id))) return true;
      }
    return false;
  }
  for (const { req, category } of templateRequirements(major.template, catalogById)) {
    if (category && OUTSIDE_MAJOR_CATEGORIES.has(category)) continue;
    if (req.kind === "seat") {
      if (requires.some((c) => courseSatisfiesRequirement({ id: c.id, subject: c.subject, number: c.number, title: c.title, attrs: c.attrs ?? [] }, req.req))) return true;
    } else if (!OPEN_GROUP_TYPES.has(req.rule.type) && (req.courseIds ?? []).some((id) => ids.has(id))) return true;
  }
  return false;
}

// ─── Twins (cross-listings) ─────────────────────────────────────────────────

export type Twins = { of: (id: string) => string[] };

/** Cross-listing families: catalog courses sharing a roster course id
 *  (`rosterId` → ids). Page-only candidates (no id in the families) pair with a
 *  candidate of the same title under another subject. */
export function makeTwins(families: Map<string, string[]>, candidates: DistCourse[] = [], pageTitles: Map<string, string> = new Map()): Twins {
  const familyOf = new Map<string, string[]>();
  for (const ids of families.values()) if (ids.length > 1) for (const id of ids) familyOf.set(id, ids);
  const byTitle = new Map<string, DistCourse[]>();
  for (const c of candidates) {
    // A page-only course carries a placeholder title: use the page's own.
    const raw = pageTitles.get(c.id) ?? (PLACEHOLDER_TITLE.test(c.title ?? "") ? "" : c.title ?? "");
    const t = raw.trim().toLowerCase();
    if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), c]);
  }
  const inFamilies = new Set([...families.values()].flat());
  const titleTwins = new Map<string, string[]>();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const c of group) {
      const others = group.filter((o) => o.subject !== c.subject && (!inFamilies.has(c.id) || !inFamilies.has(o.id)));
      if (others.length) titleTwins.set(c.id, others.map((o) => o.id));
    }
  }
  return { of: (id) => [...new Set([...(familyOf.get(id) ?? []).filter((x) => x !== id), ...(titleTwins.get(id) ?? [])])].sort() };
}

const PLACEHOLDER_TITLE = /^\(listed on the catalog page/;

/** Titles the page prints for its list courses ("SUBJ NNNN | Title | credits"). */
export function pageTitles(lists: { rows: { line: string; courseIds: string[] }[] }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of lists)
    for (const r of l.rows) {
      const parts = r.line.split("|").map((p) => p.trim());
      if (r.courseIds.length === 1 && parts.length >= 3 && parts[1]) out.set(r.courseIds[0], parts[1]);
    }
  return out;
}

/** The dump's cross-listing families (`rosterId` → course ids). */
export function loadTwinFamilies(dumpPath: string): Map<string, string[]> {
  const fam = new Map<string, string[]>();
  for (const c of loadCatalogDump(dumpPath) as (ReturnType<typeof loadCatalogDump>[number] & { rosterId?: string | null })[]) {
    if (!c.rosterId) continue;
    fam.set(c.rosterId, [...(fam.get(c.rosterId) ?? []), c.id]);
  }
  return fam;
}

// ─── The rule ───────────────────────────────────────────────────────────────

const ANY_OF_MAX = 40;

/** The branches: one per distinct course set and one per subject, each with
 *  the prefixes of the majors that claim it. */
export function holdOutParts(perMajor: Map<string, MajorHold>): CourseRule[] {
  const byCourses = new Map<string, { courses: string[]; prefixes: string[] }>();
  const bySubjects = new Map<string, { subjects: string[]; prefixes: string[] }>();
  for (const [prefix, h] of [...perMajor].sort(([a], [b]) => a.localeCompare(b))) {
    for (const s of h.subjects) {
      const e = bySubjects.get(s) ?? { subjects: [s], prefixes: [] };
      e.prefixes.push(prefix);
      bySubjects.set(s, e);
    }
    if (h.courses.length) {
      const k = h.courses.join(",");
      const e = byCourses.get(k) ?? { courses: h.courses, prefixes: [] };
      e.prefixes.push(prefix);
      byCourses.set(k, e);
    }
  }
  return [
    ...[...byCourses.values()].map((e) => ({ allOf: [{ course: e.courses }, { program: e.prefixes }] }) as CourseRule),
    ...[...bySubjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, e]) => ({ allOf: [{ subject: e.subjects }, { program: e.prefixes }] }) as CourseRule),
  ];
}

/** "Some major on the plan claims the course": the parts as an anyOf, nested
 *  in chunks beyond the schema's ANY_OF_MAX branches. null when no parts. */
export function claimRule(parts: CourseRule[]): CourseRule | null {
  if (!parts.length) return null;
  if (parts.length <= ANY_OF_MAX) return { anyOf: parts };
  const chunks: CourseRule[] = [];
  for (let i = 0; i < parts.length; i += ANY_OF_MAX) chunks.push({ anyOf: parts.slice(i, i + ANY_OF_MAX) });
  return { anyOf: chunks };
}

/** The hold-out rule (`not` over the claim rule). */
export function holdOutRule(perMajor: Map<string, MajorHold>): CourseRule | null {
  const claim = claimRule(holdOutParts(perMajor));
  return claim && { not: claim };
}

/** The branches of a claim's anyOf, nested chunks flattened. */
function flatParts(inner: CourseRule): CourseRule[] {
  return "anyOf" in inner ? inner.anyOf.flatMap((p) => ("anyOf" in p ? flatParts(p) : [p])) : [inner];
}

/** Is this allOf child a managed hold-out (a `not` over branches that each name a program)? */
export function isHoldOut(rule: CourseRule): boolean {
  if (!("not" in rule)) return false;
  const parts = flatParts(rule.not);
  return parts.length > 0 && parts.every((p) => "allOf" in p && p.allOf.some((x) => "program" in x));
}

/** The row's rule without its hold-out(s). */
export function positivePart(rule: CourseRule): CourseRule {
  if (!("allOf" in rule)) return rule;
  const rest = rule.allOf.filter((r) => !isHoldOut(r));
  return rest.length === 1 ? rest[0] : { allOf: rest };
}

/** The row's rule with `holdOut` as its hold-out (replacing any earlier one). */
export function withHoldOut(rule: CourseRule, holdOut: CourseRule | null): CourseRule {
  const pos = positivePart(rule);
  if (!holdOut) return pos;
  const kids = "allOf" in pos ? pos.allOf : [pos];
  return { allOf: [...kids, holdOut] };
}

/** Does a rule name a program anywhere? (A row limit that does is the managed one.) */
export function mentionsProgram(rule: CourseRule): boolean {
  if ("program" in rule) return true;
  if ("allOf" in rule) return rule.allOf.some(mentionsProgram);
  if ("anyOf" in rule) return rule.anyOf.some(mentionsProgram);
  if ("not" in rule) return mentionsProgram(rule.not);
  return false;
}

type RowLimitLike = { rule: CourseRule; maxCourses?: number; minCourses?: number; label?: string } & Record<string, unknown>;
type SrcRow = { id: string; rule?: CourseRule; limits?: RowLimitLike[] } & Record<string, unknown>;

/** The row as `spec` writes it: a hold-out in its rule, or its managed limit
 *  (earlier program-naming limits and any rule hold-out removed). */
export function applyToRow(row: SrcRow, spec: Pick<RowSpec, "output">, perMajor: Map<string, MajorHold>): SrcRow {
  if (!row.rule) throw new Error(`row ${row.id} has no rule`);
  const limit = spec.output?.limit;
  if (!limit) return { ...row, rule: withHoldOut(row.rule, holdOutRule(perMajor)) };
  const kept = (row.limits ?? []).filter((l) => !mentionsProgram(l.rule));
  const claim = claimRule(holdOutParts(perMajor));
  const added: RowLimitLike[] = !claim
    ? []
    : [
        limit.maxCourses != null
          ? { rule: claim, maxCourses: limit.maxCourses, ...(limit.label ? { label: limit.label } : {}) }
          : { rule: { not: claim }, minCourses: limit.minCourses, ...(limit.label ? { label: limit.label } : {}) },
      ];
  const out: SrcRow = { ...row, rule: positivePart(row.rule) };
  const limits = [...kept, ...added];
  if (limits.length) out.limits = limits;
  else delete out.limits;
  return out;
}

// ─── Deriving a row ─────────────────────────────────────────────────────────

export type HoldOutResult = {
  minorId: string;
  rowId: string;
  mode: HoldOutMode;
  candidates: string[];
  perMajor: Record<string, MajorHold>;
  majorsChecked: number;
};

export type DeriveOptions = { table?: DepartmentTable; families?: Map<string, string[]>; pageTitles?: Map<string, string> };

export function deriveHoldOut(
  minor: Layer,
  spec: Pick<RowSpec, "row" | "mode" | "twins" | "requires" | "holdOut">,
  catalogById: Map<string, DistCourse>,
  pageOnly: Map<string, DistCourse>,
  majors: MajorSource[],
  opts: DeriveOptions = {},
): HoldOutResult {
  const row = minor.rows.find((r) => r.id === spec.row) as RowLike | undefined;
  if (!row || !row.rule) throw new Error(`${minor.id} has no row ${spec.row} with a rule`);
  const pos = positivePart(row.rule);
  const pool = [...catalogById.values(), ...[...pageOnly.values()].filter((c) => !catalogById.has(c.id))];
  const candidates = pool.filter((c) => courseMatchesRule(c, pos, {})).sort((a, b) => a.id.localeCompare(b.id));
  const table = opts.table ?? EMPTY_TABLE;
  const twins = makeTwins(opts.families ?? new Map(), candidates, opts.pageTitles);
  const minorPrefix = programPrefix(minor.programId ?? minor.id);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const requires = (spec.requires ?? []).map((id) => byId.get(id)).filter((c): c is DistCourse => !!c);
  const holdIds = new Set(spec.holdOut ?? []);
  const perMajor = new Map<string, MajorHold>();
  for (const m of majors) {
    if (m.prefix === minorPrefix) continue;
    let h: MajorHold;
    if (spec.mode === "department") h = majorDepartmentHoldOut(m, candidates, catalogById, twins, table);
    else if (spec.mode === "courses")
      h = majorNamesAny(m, requires, catalogById) ? { courses: candidates.filter((c) => holdIds.has(c.id)).map((c) => c.id), subjects: [] } : { courses: [], subjects: [] };
    else h = majorHoldOut(m, candidates, catalogById, spec.twins ? twins : undefined);
    if (h.courses.length || h.subjects.length) perMajor.set(m.prefix, h);
  }
  return {
    minorId: minor.id,
    rowId: spec.row,
    mode: spec.mode,
    candidates: candidates.map((c) => c.id),
    perMajor: Object.fromEntries(perMajor),
    majorsChecked: majors.length,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

type Context = { catalog: ReturnType<typeof loadDistCatalog>; families: Map<string, string[]>; table: DepartmentTable; majors: MajorSource[] };

/** Derive, print and (--write / --check) apply one row. Exit code. */
function runRow(spec: RowSpec, ctx: Context, argv: string[]): number {
  let dir: string;
  let minor: Layer;
  let src: { layer: Layer } & Record<string, unknown>;
  try {
    dir = provenanceDir(spec.program);
    // Read without the schema: only the row's own courses are used, and a
    // stale hold-out in it may be what this run is here to replace.
    const raw = JSON.parse(readFileSync(join(dir, PROVENANCE_FILES.merged), "utf-8")) as { layer?: Layer } & Layer;
    minor = raw.layer ?? raw;
    src = JSON.parse(readFileSync(join(dir, PROVENANCE_FILES.mergedSrc), "utf-8"));
  } catch (e) {
    console.error(`cannot read ${spec.program}'s merged layer: ${(e as Error).message}`);
    return 2;
  }
  const pageOnly = loadPageOnly(dir, new Set(ctx.catalog.byId.keys()));
  let result: HoldOutResult;
  try {
    const titles = existsSync(join(dir, PROVENANCE_FILES.extract)) ? pageTitles(loadVerifiedExtract(dir).lists) : new Map<string, string>();
    result = deriveHoldOut(minor, spec, ctx.catalog.byId, pageOnly.byId, ctx.majors, { table: ctx.table, families: ctx.families, pageTitles: titles });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const out = spec.output?.limit ? `limit ${spec.output.limit.maxCourses != null ? `maxCourses ${spec.output.limit.maxCourses}` : `minCourses ${spec.output.limit.minCourses}`}` : "hold-out";
  console.log(
    `${result.minorId}/${result.rowId} (${spec.mode}${spec.twins ? ", twins" : ""}, ${out}): ${result.candidates.length} row course(s), ${result.majorsChecked} major(s) checked, ${Object.keys(result.perMajor).length} claim something`,
  );
  for (const [prefix, h] of Object.entries(result.perMajor))
    console.log(`  ${prefix}: ${h.subjects.length ? `subject ${h.subjects.join(", ")}; ` : ""}${h.courses.length ? h.courses.join(", ") : "-"}`);
  const jsonOut = argv[argv.indexOf("--json") + 1];
  if (argv.includes("--json") && jsonOut) writeFileSync(jsonOut, canonicalStringify(result) + "\n");

  const rows = src.layer.rows as unknown as SrcRow[];
  const i = rows.findIndex((r) => r.id === spec.row);
  if (i < 0 || !rows[i].rule) {
    console.error(`merged.src.json has no row ${spec.row} with a rule`);
    return 2;
  }
  const next = applyToRow(rows[i], spec, new Map(Object.entries(result.perMajor)));
  const same = canonicalStringify(next) === canonicalStringify(rows[i]);
  if (argv.includes("--write")) {
    if (same) console.log("  merged.src.json already holds this row");
    else {
      rows[i] = next;
      writeFileSync(join(dir, PROVENANCE_FILES.mergedSrc), JSON.stringify(src, null, 2) + "\n");
      console.log(`  wrote the row to ${PROVENANCE_FILES.mergedSrc} (re-run expand-draft.ts)`);
    }
    return 0;
  }
  if (argv.includes("--check")) {
    console.log(same ? "  merged.src.json's row is current" : "  merged.src.json's row differs from the majors as they are now (run with --write)");
    return same ? 0 : 1;
  }
  return 0;
}

function main(argv: string[]): number {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const usage =
    "usage: npx tsx outside-major-holdout.ts (--program <minorId> --row <rowId> [--mode major|department|courses] [--twins] | --all) [--dump <path>] [--write] [--check] [--json <out>]";
  let specs: RowSpec[];
  try {
    specs = loadRowSpecs();
  } catch (e) {
    console.error(`outside-major-rows.json: ${(e as Error).message}`);
    return 2;
  }
  let todo: RowSpec[];
  if (argv.includes("--all")) todo = specs;
  else {
    const program = arg("--program");
    const row = arg("--row");
    if (!program || !row) {
      console.error(usage);
      return 2;
    }
    const listed = specs.find((s) => s.program === program && s.row === row);
    const spec: RowSpec = { ...(listed ?? { program, row, mode: "major" }) };
    const mode = arg("--mode");
    if (mode) spec.mode = mode as HoldOutMode;
    if (argv.includes("--twins")) spec.twins = true;
    const problems = specProblems(spec);
    if (problems.length) {
      console.error(problems.join("\n"));
      return 2;
    }
    todo = [spec];
  }
  const table = loadDepartmentTable();
  const majors = listMajors(undefined, undefined, table);
  const contexts = new Map<string, Context>();
  let worst = 0;
  for (const s of todo) {
    const dump = arg("--dump") ?? (s.dump ? join(__dirname, "backups", s.dump) : DEFAULT_DUMP);
    if (!existsSync(dump)) {
      console.error(`${s.program}/${s.row}: catalog dump not found: ${dump} (pass --dump)`);
      worst = 2;
      continue;
    }
    if (!contexts.has(dump)) contexts.set(dump, { catalog: loadDistCatalog(dump), families: loadTwinFamilies(dump), table, majors });
    worst = Math.max(worst, runRow(s, contexts.get(dump)!, argv));
  }
  return worst;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
