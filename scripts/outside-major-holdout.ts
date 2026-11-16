// scripts/outside-major-holdout.ts
// "Outside your major" for a minor row (spec 047), derived from the majors
// themselves. Some minors let a row count a course only when it is outside the
// student's major. The Distribution engine has no notion of "the courses my
// major counts", so the row encodes it as a hold-out: for every major the app
// offers, the courses of the row that major's own requirements could count,
// each paired with that major's program-id prefix:
//
//   { "allOf": [ <the row's courses>,
//                { "not": { "anyOf": [
//                    { "allOf": [ { "course": [...] }, { "program": ["cornell-x-bs", ...] } ] },
//                    ... ] } } ] }
//
// (`program` matches the primary major or any other program on the plan, so a
// second major's courses are held out too.) This script writes that `not`
// from the majors as they are, so it can be re-run whenever a major is added
// or re-authored.
//
// What "a major could count" means (strict: a false red is acceptable, a false
// green is not):
//   - Layer majors (seed-data/layers/cas, cals; the major and all its
//     concentration layers, under the major's prefix): a course counts when a
//     branch of a consuming, credits or overlay row's rule (seat, pool,
//     distribution and its categories, anyOf children; every row but confirm
//     rows) matches it, with every question read as answered yes. Only
//     "anchored" branches count: a branch that names courses or subjects
//     (course, subject, pattern or title leaves). A branch that admits any
//     course by level, attribute or "not these subjects" alone is a free or
//     outside-the-department elective, not the major's own courses. A
//     course an anchored branch names by id is the major's even when the
//     branch's other conditions (credits, level) would refuse it, and a
//     variable-credit course is read at its lowest and its highest credits.
//   - Engineering majors (slot templates in seed-data/programs.json and
//     programs-2025/): a course counts when a seat (course, pattern,
//     attribute) or an elective group the template's matcher builds admits it,
//     except liberal studies, writing seminars and PE (spec 047 D7: they never
//     count toward overlap) and groups of type "open" or "outside" (advisor-
//     approved and outside-the-department electives, which admit any course).
//   - Home subjects: every row course in a major's home subject is held out,
//     whether or not a rule reaches that course's number (the major's own
//     department). A home subject is one the major counts as a whole (a
//     `subject` leaf in an anchored rule, a template's `level` group) or one
//     it requires a course in (a seat whose named courses all share that
//     subject; a template's course seat).
// The minor's own program never holds anything out.
//
// Run (from scripts/):
//   npx tsx outside-major-holdout.ts --program <minorId> --row <rowId>
//                                    [--dump <path>] [--write] [--check] [--json <out>]
//   Reads docs/provenance/<minorId>/merged.json (the expanded row) and
//   merged.src.json. Prints the hold-out per major. --write replaces the row's
//   hold-out in merged.src.json (re-run expand-draft.ts after). --check exits 1
//   when merged.src.json's hold-out differs from the derived one.
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
import { loadTemplateProgram, templateSlots, type TemplateProgram } from "./check-overlap-fixture";
import { DEFAULT_DUMP, LAYERS_DIR, PROVENANCE_FILES, loadDistCatalog, provenanceDir, readLayerOrDraft, type DistCourse, type Layer } from "./layer-authoring";

const SEED_DIR = join(__dirname, "seed-data");
/** Template slot categories that never count toward a major (spec 047 D7). */
const OUTSIDE_MAJOR_CATEGORIES = new Set(["liberal", "fws", "pe"]);
/** Elective-group rule types that admit any course (free / outside electives). */
const OPEN_GROUP_TYPES = new Set(["open", "outside", "category"]);

/** "cornell-x-bs-2026" → "cornell-x-bs". */
export function programPrefix(programId: string): string {
  return programId.replace(/-\d{4}$/, "");
}

export type MajorSource =
  | { prefix: string; programId: string; kind: "layer"; layers: Layer[] }
  | { prefix: string; programId: string; kind: "template"; template: TemplateProgram };

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
 *  and the Engineering templates. Minors and college layers are not majors. */
export function listMajors(layersDir: string = LAYERS_DIR, seedDir: string = SEED_DIR): MajorSource[] {
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
  return out;
}

/** What one major holds out of a list of candidate courses: the courses its
 *  requirements could count, and every candidate in one of its home subjects. */
export function majorHoldOut(major: MajorSource, candidates: DistCourse[], catalogById: Map<string, DistCourse>): { courses: string[]; subjects: string[] } {
  const held = new Set<string>();
  const home = new Set<string>();
  const candidateIds = new Set(candidates.map((c) => c.id));
  if (major.kind === "layer") {
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
    const slots = templateSlots(major.template, catalogById);
    const categoryOf = new Map<string, string | null>();
    for (const s of slots) {
      categoryOf.set(s.id, s.category ?? null);
      if (s.kind === "elective" && s.elective_group_id && !categoryOf.has(s.elective_group_id)) categoryOf.set(s.elective_group_id, s.category ?? null);
    }
    for (const req of programToRequirements(programSlotsToMatchInput(slots))) {
      const cat = categoryOf.get(req.id) ?? null;
      if (cat && OUTSIDE_MAJOR_CATEGORIES.has(cat)) continue;
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
  const candidateSubjects = new Set(candidates.map((c) => c.subject));
  const subjects = [...home].filter((s) => candidateSubjects.has(s)).sort();
  for (const c of candidates) if (subjects.includes(c.subject)) held.delete(c.id);
  return { courses: [...held].sort(), subjects };
}

/** The hold-out rule: one branch per distinct course set and one per home
 *  subject, each with the prefixes of the majors that hold it out. */
export function holdOutRule(perMajor: Map<string, { courses: string[]; subjects: string[] }>): CourseRule | null {
  const byCourses = new Map<string, { courses: string[]; prefixes: string[] }>();
  const bySubjects = new Map<string, { subjects: string[]; prefixes: string[] }>();
  for (const [prefix, h] of [...perMajor].sort(([a], [b]) => a.localeCompare(b))) {
    // One branch per home subject (majors sharing it share the branch).
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
  const parts: CourseRule[] = [
    ...[...byCourses.values()].map((e) => ({ allOf: [{ course: e.courses }, { program: e.prefixes }] }) as CourseRule),
    ...[...bySubjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, e]) => ({ allOf: [{ subject: e.subjects }, { program: e.prefixes }] }) as CourseRule),
  ];
  if (!parts.length) return null;
  // The schema caps an anyOf at ANY_OF_MAX branches: nest chunks beyond that.
  if (parts.length <= ANY_OF_MAX) return { not: { anyOf: parts } };
  const chunks: CourseRule[] = [];
  for (let i = 0; i < parts.length; i += ANY_OF_MAX) chunks.push({ anyOf: parts.slice(i, i + ANY_OF_MAX) });
  return { not: { anyOf: chunks } };
}

const ANY_OF_MAX = 40;

/** The branches of a hold-out's anyOf, nested chunks flattened. */
function holdOutParts(inner: CourseRule): CourseRule[] {
  return "anyOf" in inner ? inner.anyOf.flatMap((p) => ("anyOf" in p ? holdOutParts(p) : [p])) : [inner];
}

/** Is this allOf child a managed hold-out (a `not` over branches that each name a program)? */
export function isHoldOut(rule: CourseRule): boolean {
  if (!("not" in rule)) return false;
  const parts = holdOutParts(rule.not);
  return parts.length > 0 && parts.every((p) => "allOf" in p && p.allOf.some((x) => "program" in x));
}

/** The row's rule without its hold-out. */
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

export type HoldOutResult = {
  minorId: string;
  rowId: string;
  candidates: string[];
  perMajor: Record<string, { courses: string[]; subjects: string[] }>;
  majorsChecked: number;
  rule: CourseRule | null;
};

export function deriveHoldOut(minor: Layer, rowId: string, catalogById: Map<string, DistCourse>, pageOnly: Map<string, DistCourse>, majors: MajorSource[]): HoldOutResult {
  const row = minor.rows.find((r) => r.id === rowId) as RowLike | undefined;
  if (!row || !row.rule) throw new Error(`${minor.id} has no row ${rowId} with a rule`);
  const pos = positivePart(row.rule);
  const pool = [...catalogById.values(), ...[...pageOnly.values()].filter((c) => !catalogById.has(c.id))];
  const candidates = pool.filter((c) => courseMatchesRule(c, pos, {})).sort((a, b) => a.id.localeCompare(b.id));
  const minorPrefix = programPrefix(minor.programId ?? minor.id);
  const perMajor = new Map<string, { courses: string[]; subjects: string[] }>();
  for (const m of majors) {
    if (m.prefix === minorPrefix) continue;
    const h = majorHoldOut(m, candidates, catalogById);
    if (h.courses.length || h.subjects.length) perMajor.set(m.prefix, h);
  }
  return {
    minorId: minor.id,
    rowId,
    candidates: candidates.map((c) => c.id),
    perMajor: Object.fromEntries(perMajor),
    majorsChecked: majors.length,
    rule: holdOutRule(perMajor),
  };
}

function main(argv: string[]): number {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const programId = arg("--program");
  const rowId = arg("--row");
  if (!programId || !rowId) {
    console.error("usage: npx tsx outside-major-holdout.ts --program <minorId> --row <rowId> [--dump <path>] [--write] [--check] [--json <out>]");
    return 2;
  }
  let dir: string;
  let minor: Layer;
  let src: { layer: Layer } & Record<string, unknown>;
  const srcPath = () => join(dir, PROVENANCE_FILES.mergedSrc);
  try {
    dir = provenanceDir(programId);
    // Read without the schema: only the row's own courses are used, and a
    // stale hold-out in it may be what this run is here to replace.
    const raw = JSON.parse(readFileSync(join(dir, PROVENANCE_FILES.merged), "utf-8")) as { layer?: Layer } & Layer;
    minor = raw.layer ?? raw;
    src = JSON.parse(readFileSync(srcPath(), "utf-8"));
  } catch (e) {
    console.error(`cannot read ${programId}'s merged layer: ${(e as Error).message}`);
    return 2;
  }
  const catalog = loadDistCatalog(arg("--dump") ?? DEFAULT_DUMP);
  const pageOnly = loadPageOnly(dir, new Set(catalog.byId.keys()));
  const majors = listMajors();
  let result: HoldOutResult;
  try {
    result = deriveHoldOut(minor, rowId, catalog.byId, pageOnly.byId, majors);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  console.log(`${result.minorId}/${result.rowId}: ${result.candidates.length} row course(s), ${result.majorsChecked} major(s) checked, ${Object.keys(result.perMajor).length} hold something out`);
  for (const [prefix, h] of Object.entries(result.perMajor))
    console.log(`  ${prefix}: ${h.subjects.length ? `subject ${h.subjects.join(", ")}; ` : ""}${h.courses.length ? h.courses.join(", ") : "-"}`);
  const jsonOut = arg("--json");
  if (jsonOut) writeFileSync(jsonOut, canonicalStringify(result) + "\n");

  const srcRow = src.layer.rows.find((r) => r.id === rowId) as RowLike | undefined;
  if (!srcRow?.rule) {
    console.error(`merged.src.json has no row ${rowId} with a rule`);
    return 2;
  }
  const next = withHoldOut(srcRow.rule, result.rule);
  const same = canonicalStringify(next) === canonicalStringify(srcRow.rule);
  if (argv.includes("--write")) {
    if (same) console.log("merged.src.json already holds this hold-out");
    else {
      srcRow.rule = next;
      writeFileSync(srcPath(), JSON.stringify(src, null, 2) + "\n");
      console.log(`wrote the hold-out to ${PROVENANCE_FILES.mergedSrc} (re-run expand-draft.ts)`);
    }
    return 0;
  }
  if (argv.includes("--check")) {
    console.log(same ? "merged.src.json's hold-out is current" : "merged.src.json's hold-out differs from the majors as they are now (run with --write)");
    return same ? 0 : 1;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
