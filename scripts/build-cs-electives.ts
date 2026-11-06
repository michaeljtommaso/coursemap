// scripts/build-cs-electives.ts
// Fill the CS major's list-based elective groups in seed-data/programs.json
// (cornell-cs-bs-2026) from the 2026-27 catalog's rules (spec 024):
//
//   cs-major-elective           CS Elective (4000+)
//   cs-practicum                Practicum or Project Course (closed list of 19)
//   cs-technical-elective       Technical Elective, 3000+
//   cs-technical-elective-2000  Technical Elective, 2000+ (one of the three may be 2000-level)
//   cs-engrd-dist               second ENGRD: any category but Scientific Computing
//
// External Specialization (`outside` CS, 3000+) and the Major-Approved Elective
// (`open`) are rules, not lists, and aren't touched here.
//
// Source: seed-data/sources/cs-electives-2026-27.json. A course is a technical
// elective when it has >= 3 credits and either is a CS course at 3000+, or has a
// qualifying prerequisite or corequisite: a named qualifying course, any ENGRD
// course, prerequisite text naming probability / statistics / college-level
// biology, or (the catalog's "chain") a prerequisite or corequisite that itself
// qualifies, to any depth. Prerequisite and corequisite trees both count,
// including the parser's "advisory" nodes ("or permission of instructor").
// Courses the major already requires are left out of every list.
//
// Rule-based lists are a snapshot of the catalog: re-run after a roster sync,
// then re-seed CS (seed-programs-legacy.ts --only cornell-cs-bs-2026). --check
// verifies programs.json is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-cs-electives.ts                 (write programs.json)
//   npx tsx build-cs-electives.ts --check         (exit 1 if programs.json is stale)
//   npx tsx build-cs-electives.ts --from <backup> (catalog snapshot; default: the
//                                                  newest backups/catalog-backup-*.json)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COURSE_IDS_CAP,
  newestBackup,
  numberOf,
  prereqIds,
  spliceCourseIds,
  subjectOf,
  type CatalogCourse,
} from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-cs-bs-2026";
export const GROUP_CS = "cs-major-elective";
export const GROUP_PRACTICUM = "cs-practicum";
export const GROUP_TECH = "cs-technical-elective";
export const GROUP_TECH_2000 = "cs-technical-elective-2000";
export const GROUP_ENGRD = "cs-engrd-dist";

export type Source = {
  csElectives: { subject: string; min: number; except: number[]; plus: string[] };
  practicum: string[];
  technical: {
    minCredits: number;
    csAlwaysFrom: number;
    csExcept: number[];
    qualifyingCourses: string[];
    qualifyingSubjects: string[];
    textPattern: string;
  };
  engrd: { ids: string[] };
};

export type Lists = Record<
  typeof GROUP_CS | typeof GROUP_PRACTICUM | typeof GROUP_TECH | typeof GROUP_TECH_2000 | typeof GROUP_ENGRD,
  string[]
>;

/** Drop clauses that only recommend, so "statistics recommended" doesn't qualify. */
function requiredText(c: CatalogCourse): string {
  const t = [c.prereqText, c.coreqText].filter(Boolean).join(" ");
  return t.replace(/[^.;]*recommended[^.;]*/gi, "");
}

/** Does `id` carry a qualifying prerequisite or corequisite (directly, by text,
 *  or through a chain)? Memoized; a prerequisite cycle reads as "no" on the
 *  revisit, so a cycle never qualifies itself. */
export function makeQualifies(courses: Map<string, CatalogCourse>, tech: Source["technical"]) {
  const named = new Set(tech.qualifyingCourses);
  const subjects = new Set(tech.qualifyingSubjects);
  const text = new RegExp(tech.textPattern, "i");
  const memo = new Map<string, boolean>();
  const isQualifier = (id: string) => named.has(id) || subjects.has(subjectOf(id));

  const qualifies = (id: string, stack: Set<string>): boolean => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (stack.has(id)) return false;
    const c = courses.get(id);
    if (!c) return false;
    stack.add(id);
    let ok = text.test(requiredText(c));
    if (!ok) {
      const direct = prereqIds(c.coreqExpr, prereqIds(c.prereqExpr));
      for (const p of direct) {
        if (isQualifier(p) || qualifies(p, stack)) {
          ok = true;
          break;
        }
      }
    }
    stack.delete(id);
    memo.set(id, ok);
    return ok;
  };
  return (id: string) => qualifies(id, new Set());
}

export function buildLists(src: Source, courses: Map<string, CatalogCourse>, required: ReadonlySet<string>): Lists {
  const qualifies = makeQualifies(courses, src.technical);
  const t = src.technical;
  const cs = new Set<string>(src.csElectives.plus);
  const tech3 = new Set<string>();
  const tech2 = new Set<string>();

  for (const c of courses.values()) {
    const n = numberOf(c);
    if (Number.isNaN(n)) continue;

    // Every elective but the project course needs >= 3 credits, so the 2-credit
    // practica (CS 4411 etc.) are project courses, not CS electives.
    if (
      c.subject === src.csElectives.subject &&
      n >= src.csElectives.min &&
      !src.csElectives.except.includes(n) &&
      (c.creditsMax ?? 0) >= t.minCredits
    ) {
      cs.add(c.id);
    }

    if (n < 2000 || (c.creditsMax ?? 0) < t.minCredits) continue;
    if (c.subject === "CS" && t.csExcept.includes(n)) continue;
    const isTech = (c.subject === "CS" && n >= t.csAlwaysFrom) || qualifies(c.id);
    if (!isTech) continue;
    tech2.add(c.id);
    if (n >= 3000) tech3.add(c.id);
  }

  const finish = (s: Iterable<string>) =>
    [...new Set(s)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  return {
    [GROUP_CS]: finish(cs),
    [GROUP_PRACTICUM]: finish(src.practicum),
    [GROUP_TECH]: finish(tech3),
    [GROUP_TECH_2000]: finish(tech2),
    [GROUP_ENGRD]: finish(src.engrd.ids),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const programsPath = join(dataDir, "programs.json");

  const src = JSON.parse(readFileSync(join(dataDir, "sources", "cs-electives-2026-27.json"), "utf8")) as Source;
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

  console.log(`\n── build-cs-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup} (${courses.size} courses)`);
  for (const [gid, ids] of Object.entries(lists)) {
    const missing = ids.filter((id) => !courses.has(id)).length;
    console.log(`   ${gid.padEnd(28)} ${String(ids.length).padStart(5)} courses (${missing} not in this catalog snapshot)`);
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
