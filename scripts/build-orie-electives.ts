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

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COURSE_IDS_CAP,
  makeReaches,
  newestBackup,
  numberOf,
  spliceCourseIds,
  subjectOf,
  type CatalogCourse,
} from "./lib/elective-lists";

// Re-exported for orie-electives.corpus.ts and older callers; the helpers live
// in lib/elective-lists.ts (shared with build-cs-electives.ts).
export { COURSE_IDS_CAP, makeReaches, prereqIds, spliceCourseIds, type CatalogCourse } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-ore-bs-2026";
export const GROUP_A = "ore-major-elective-a";
export const GROUP_OUTSIDE = "ore-major-elective";
export const GROUP_ORIE = "ore-orie-elective";

type SubjectRule = { kind: "subject"; subject: string; min?: number; except?: number[]; plus?: string[] };
type PrereqRule = { kind: "needsPrereq"; subject: string; prereqs: string[] };
export type Rule = (SubjectRule | PrereqRule) & { category?: string; text?: string };
export type Source = {
  named: { category: string; text: string; ids: string[] }[];
  rules: Rule[];
  orieElectivesRule: SubjectRule;
};

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
