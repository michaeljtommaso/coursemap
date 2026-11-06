// scripts/build-me-electives.ts
// Fill the ME major's list-based elective groups in seed-data/programs.json
// (cornell-me-bs-2026) from MAE's B.S. requirements page (spec 025):
//
//   me-major-elective  Major Approved Elective (the seven area lists)
//   me-math-elective   Mathematics Elective (MAE's 8-course list)
//   me-tech-elective   Technical Elective (the page's rule, expanded)
//
// Source: seed-data/sources/me-electives-2026-11-06.json. Named lists are taken
// as written (both ids of each cross-listing; ids not in the catalog are kept so
// they count when offered again). The technical rule expands against a catalog
// snapshot: Engineering-college subjects at 2000+, MATH above 2940, PHYS above
// 2214, CHEM 2080 or above 2090, BIO* subjects at 2000+, plus five named
// 1000-level biology courses; minus MAE 4610 / 4980 and titles that mark
// economics, business, finance, teaching or leadership courses. Courses the
// major already requires are left out of every list.
//
// Re-run after a roster sync, then re-seed ME (seed-programs-legacy.ts --only
// cornell-me-bs-2026). --check verifies programs.json is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-me-electives.ts                 (write programs.json)
//   npx tsx build-me-electives.ts --check         (exit 1 if programs.json is stale)
//   npx tsx build-me-electives.ts --from <backup> (catalog snapshot; default: the
//                                                  newest backups/catalog-backup-*.json)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COURSE_IDS_CAP,
  newestBackup,
  numberOf,
  spliceCourseIds,
  type CatalogCourse,
} from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-me-bs-2026";
export const GROUP_MAJOR = "me-major-elective";
export const GROUP_MATH = "me-math-elective";
export const GROUP_TECH = "me-tech-elective";

export type Source = {
  majorApproved: { areas: Record<string, string[]>; except: string[] };
  math: string[];
  technical: {
    engineeringSubjects: string[];
    engineeringFrom: number;
    mathAbove: number;
    physicsAbove: number;
    chemistry: { exactly: number[]; above: number };
    biologyPrefix: string;
    biologyFrom: number;
    plus: string[];
    except: string[];
    excludeTitlePattern: string;
  };
};

export type Lists = Record<typeof GROUP_MAJOR | typeof GROUP_MATH | typeof GROUP_TECH, string[]>;

/** The page's technical-elective rule for one course (before exclusions). */
export function technicalByRule(c: CatalogCourse, t: Source["technical"]): boolean {
  const n = numberOf(c);
  if (Number.isNaN(n)) return false;
  if (t.engineeringSubjects.includes(c.subject)) return n >= t.engineeringFrom;
  if (c.subject === "MATH") return n > t.mathAbove;
  if (c.subject === "PHYS") return n > t.physicsAbove;
  if (c.subject === "CHEM") return t.chemistry.exactly.includes(n) || n > t.chemistry.above;
  if (c.subject.startsWith(t.biologyPrefix)) return n >= t.biologyFrom;
  return false;
}

export function buildLists(
  src: Source,
  courses: Map<string, CatalogCourse & { title?: string | null }>,
  required: ReadonlySet<string>
): Lists {
  const t = src.technical;
  const excludeTitle = new RegExp(t.excludeTitlePattern, "i");
  const tech = new Set<string>(t.plus);
  for (const c of courses.values()) {
    if (!technicalByRule(c, t)) continue;
    if (t.except.includes(c.id)) continue;
    if (excludeTitle.test(c.title ?? "")) continue;
    tech.add(c.id);
  }
  const major = new Set(Object.values(src.majorApproved.areas).flat());
  for (const id of src.majorApproved.except) major.delete(id);

  const finish = (s: Iterable<string>) =>
    [...new Set(s)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  return { [GROUP_MAJOR]: finish(major), [GROUP_MATH]: finish(src.math), [GROUP_TECH]: finish(tech) };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const programsPath = join(dataDir, "programs.json");

  const src = JSON.parse(readFileSync(join(dataDir, "sources", "me-electives-2026-11-06.json"), "utf8")) as Source;
  const raw = JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, CatalogCourse & { title?: string }> };
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

  console.log(`\n── build-me-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup} (${courses.size} courses)`);
  for (const [gid, ids] of Object.entries(lists)) {
    const missing = ids.filter((id) => !courses.has(id)).length;
    console.log(`   ${gid.padEnd(20)} ${String(ids.length).padStart(5)} courses (${missing} not in this catalog snapshot)`);
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
