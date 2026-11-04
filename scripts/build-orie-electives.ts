// scripts/build-orie-electives.ts
// Fill the ORIE major's three list-based elective groups in seed-data/programs.json
// (cornell-ore-bs-2026) from ORIE's published approved-electives list:
//
//   ore-major-elective-a  Major Approved Elective (Category A)
//   ore-major-elective    Major Approved Elective (outside ORIE): Category A or B, non-ORIE
//   ore-orie-elective     ORIE Elective
//
// Source: seed-data/sources/orie-approved-electives-2026-10-22.json (the department's
// spreadsheet, structured, with the requirements page's rules quoted). Named courses
// are taken as written. Rule rows ("MATH courses numbered 3000 or above EXCEPT ...",
// "CS courses with CS 2110 as a prerequisite") are expanded against a catalog
// snapshot: a "with X as a prerequisite" rule counts a course whose prerequisite tree
// reaches X directly or through other courses (CS 4820 needs CS 3110, which needs
// CS 2110). Courses the major already requires are left out of every list; they fill
// their own seats.
//
// Because rule rows expand against a catalog snapshot, re-run this after a roster
// sync brings new courses, then re-seed the ORIE program (seed-programs-legacy.ts
// --only cornell-ore-bs-2026). --check verifies programs.json is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-orie-electives.ts                 (write programs.json)
//   npx tsx build-orie-electives.ts --check         (exit 1 if programs.json is stale)
//   npx tsx build-orie-electives.ts --from <backup> (catalog snapshot; default: the
//                                                    newest backups/catalog-backup-*.json)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROGRAM_ID = "cornell-ore-bs-2026";
export const GROUP_A = "ore-major-elective-a";
export const GROUP_OUTSIDE = "ore-major-elective";
export const GROUP_ORIE = "ore-orie-elective";
/** Mirrors ElectiveGroupSchema's courseIds cap in cornell-degree-planner/src/lib/schemas.ts. */
export const COURSE_IDS_CAP = 1000;

type SubjectRule = { kind: "subject"; subject: string; min?: number; except?: number[]; plus?: string[] };
type PrereqRule = { kind: "needsPrereq"; subject: string; prereqs: string[] };
export type Rule = (SubjectRule | PrereqRule) & { category?: string; text?: string };
export type Source = {
  named: { category: string; text: string; ids: string[] }[];
  rules: Rule[];
  orieElectivesRule: SubjectRule;
};
export type CatalogCourse = { id: string; subject: string; number: string; prereqExpr?: unknown };

const subjectOf = (id: string) => id.split("-")[0];
const numberOf = (c: CatalogCourse) => parseInt(c.number, 10);

/** Every course id a prerequisite tree names (course, concurrent, advisory inner). */
export function prereqIds(expr: unknown, out: Set<string> = new Set(), seen: Set<unknown> = new Set()): Set<string> {
  if (!expr || typeof expr !== "object" || seen.has(expr)) return out;
  seen.add(expr);
  const e = expr as Record<string, unknown>;
  if ((e.type === "course" || e.type === "concurrent") && typeof e.id === "string") out.add(e.id);
  if (e.type === "advisory") prereqIds(e.expr, out, seen);
  if (Array.isArray(e.children)) for (const c of e.children) prereqIds(c, out, seen);
  return out;
}

/** Does this course's prerequisite tree reach any target, directly or through
 *  other courses' prerequisites? Memoized; cycles read as "no". */
export function makeReaches(courses: Map<string, CatalogCourse>) {
  const memo = new Map<string, Set<string>>();
  const closure = (id: string, stack: Set<string>): Set<string> => {
    const hit = memo.get(id);
    if (hit) return hit;
    if (stack.has(id)) return new Set();
    stack.add(id);
    const out = new Set<string>();
    for (const p of prereqIds(courses.get(id)?.prereqExpr)) {
      out.add(p);
      for (const q of closure(p, stack)) out.add(q);
    }
    stack.delete(id);
    memo.set(id, out);
    return out;
  };
  return (id: string, targets: readonly string[]) => {
    const all = closure(id, new Set());
    return targets.some((t) => all.has(t));
  };
}

export function expandRule(rule: Rule, courses: Map<string, CatalogCourse>, reaches: ReturnType<typeof makeReaches>): string[] {
  const out: string[] = [];
  for (const c of courses.values()) {
    if (c.subject !== rule.subject) continue;
    if (rule.kind === "subject") {
      const n = numberOf(c);
      if (Number.isNaN(n)) continue;
      if (rule.min != null && n < rule.min) continue;
      if (rule.except?.includes(n)) continue;
      out.push(c.id);
    } else if (reaches(c.id, rule.prereqs)) {
      out.push(c.id);
    }
  }
  if (rule.kind === "subject") out.push(...(rule.plus ?? []));
  return out;
}

export type Lists = { [GROUP_A]: string[]; [GROUP_OUTSIDE]: string[]; [GROUP_ORIE]: string[] };

/**
 * The three lists. `required` = course ids the major already requires (left out).
 * Outside-ORIE: a named row is out if ANY of its codes is an ORIE course (so the
 * ORIE 4152 / ENGRG 4610 cross-listing can't slip in as "outside ORIE").
 */
export function buildLists(src: Source, courses: Map<string, CatalogCourse>, required: ReadonlySet<string>): Lists {
  const reaches = makeReaches(courses);
  const a = new Set<string>();
  const outside = new Set<string>();
  for (const row of src.named) {
    const isOrie = row.ids.some((id) => subjectOf(id) === "ORIE");
    for (const id of row.ids) {
      if (row.category === "A") a.add(id);
      if (!isOrie) outside.add(id);
    }
  }
  for (const rule of src.rules) {
    for (const id of expandRule(rule, courses, reaches)) {
      if (rule.category === "A") a.add(id);
      if (subjectOf(id) !== "ORIE") outside.add(id);
    }
  }
  const orie = new Set(expandRule(src.orieElectivesRule, courses, reaches));
  const finish = (s: Set<string>) => [...s].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  return { [GROUP_A]: finish(a), [GROUP_OUTSIDE]: finish(outside), [GROUP_ORIE]: finish(orie) };
}

/**
 * Replace one group's "courseIds": [...] array in the programs.json TEXT, leaving
 * every other byte alone (the file mixes inline and expanded formatting, so a
 * parse-and-reprint would rewrite all of it). The group is found by its id line
 * within the given program's block.
 */
export function spliceCourseIds(text: string, programId: string, groupId: string, ids: readonly string[]): string {
  const progAt = text.indexOf(`"id": "${programId}"`);
  if (progAt < 0) throw new Error(`program ${programId} not found`);
  const groupAt = text.indexOf(`"id": "${groupId}"`, progAt);
  if (groupAt < 0) throw new Error(`group ${groupId} not found in ${programId}`);
  const keyAt = text.indexOf(`"courseIds": [`, groupAt);
  const nextObj = text.indexOf(`"id": "`, groupAt + 1);
  if (keyAt < 0 || (nextObj >= 0 && keyAt > nextObj)) throw new Error(`group ${groupId} has no courseIds`);
  const open = keyAt + `"courseIds": `.length;
  const close = text.indexOf("]", open);
  const lineStart = text.lastIndexOf("\n", keyAt) + 1;
  const indent = text.slice(lineStart, keyAt);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const body =
    ids.length === 0 ? "[]" : `[${nl}${ids.map((id) => `${indent}  ${JSON.stringify(id)}`).join(`,${nl}`)}${nl}${indent}]`;
  return text.slice(0, open) + body + text.slice(close + 1);
}

function newestBackup(dir: string): string {
  const f = readdirSync(dir).filter((n) => n.startsWith("catalog-backup-") && n.endsWith(".json")).sort().pop();
  if (!f) throw new Error("no backups/catalog-backup-*.json; pass --from <file>");
  return join(dir, f);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const programsPath = join(dataDir, "programs.json");

  const src = JSON.parse(readFileSync(join(dataDir, "sources", "orie-approved-electives-2026-10-22.json"), "utf8")) as Source;
  const raw = JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, CatalogCourse> };
  const courses = new Map(Object.entries(raw.courses).map(([id, c]) => [id, { ...c, id }]));
  const text = readFileSync(programsPath, "utf8");
  const program = (JSON.parse(text) as { id: string; slots: { kind: string; courseId: string | null }[] }[]).find(
    (p) => p.id === PROGRAM_ID
  );
  if (!program) throw new Error(`${PROGRAM_ID} not in programs.json`);
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));

  const lists = buildLists(src, courses, required);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
  }

  console.log(`\n── build-orie-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup} (${courses.size} courses)`);
  for (const [gid, ids] of Object.entries(lists)) {
    const missing = ids.filter((id) => !courses.has(id)).length;
    console.log(`   ${gid.padEnd(22)} ${String(ids.length).padStart(4)} courses (${missing} not in this catalog snapshot)`);
  }

  if (check) {
    if (next !== text) {
      console.error("\nSTALE: programs.json differs from what this source and catalog produce. Re-run without --check.");
      process.exit(1);
    }
    console.log("\nprograms.json is current.");
    return;
  }
  if (next === text) console.log("\nNo change.");
  else {
    writeFileSync(programsPath, next);
    console.log("\nWrote programs.json.");
  }
}

if (require.main === module) main();
