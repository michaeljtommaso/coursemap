// scripts/build-eas-electives.ts
// Fill the Earth and Atmospheric Sciences major's lists in
// seed-data/programs-2025/cornell-eas-bs-2025.json (spec 035).
//
//   eas-core                 the core courses of every concentration: the Fall 2025
//                            handbook (note g) and the 2026 department page
//   eas-concentration        the four concentrations' course lists (2026 page)
//   eas-field-course         EAS 2500, EAS 4370 and independent research EAS 4910/4920
//   eas-biology              the handbook's seven introductory biology courses
//   eas-advisor-course       the advisor-approved course in statistics, computer
//                            science, math or natural science (note f): those
//                            subjects at any level, 3+ credits
//
// The planner has no concentration choice for this major, so the core and
// concentration seats check the union of the lists; the rule (your own
// concentration's) is in the notes. Named lists also take each course's
// same-number cross-listing (an exact catalog title twin, e.g. NTRES 3030 for
// EAS 3030). Courses the major already requires are left out.
//
// Source: seed-data/sources/eas-electives-2026-11-06.json. The named lists keep
// ids that aren't offered now; the advisor-course list expands against the newest
// catalog backup.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-eas-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-eas-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-eas-electives.ts            (write the program file)
//   npx tsx build-eas-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, numberOf, sameNumberTwins, spliceCourseIds } from "./lib/elective-lists";

export { sameNumberTwins };

export const PROGRAM_ID = "cornell-eas-bs-2025";

export type Source = {
  program: string;
  biology: string[];
  biologyAlso: { ids: string[] };
  core2025: Record<string, string[]>;
  core2026: Record<string, string[]>;
  concentrations2026: Record<string, string[]>;
  field: string[];
  advisorCourse: {
    subjects: string[];
    subjectPrefixes: string[];
    minCredits: number;
    minNumber: number;
    exceptIds: string[];
    excludeTitlePattern: string;
  };
};

export type Course = { id: string; subject: string; number: string; title?: string | null; creditsMax?: number | null };
type Program = { slots: { kind: string; courseId: string | null }[] };

/** group id → list. `program` supplies the required ids; `courses` the catalog. */
export function buildLists(src: Source, program: Program, courses: Iterable<Course>): Record<string, string[]> {
  const catalog = [...courses];
  const twins = sameNumberTwins(catalog);
  const withTwins = (ids: Iterable<string>) => [...ids].flatMap((id) => [id, ...(twins.get(id) ?? [])]);
  // A required course's cross-listing is the same course (EAS 2250 = ENGRD 2250).
  const required = new Set(withTwins(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!)));
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));

  const a = src.advisorCourse;
  const subjects = new Set(a.subjects);
  const excludeTitle = new RegExp(a.excludeTitlePattern, "i");
  const advisor: string[] = [];
  for (const c of catalog) {
    const inSubject = subjects.has(c.subject) || a.subjectPrefixes.some((p) => c.subject.startsWith(p));
    if (!inSubject || excludeTitle.test(c.title ?? "")) continue;
    // The college counts nothing below 1100, nor pre-curriculum courses like MATH 1110.
    if (!(numberOf(c) >= a.minNumber) || a.exceptIds.includes(c.id)) continue;
    // A course that can never reach the seat's credits would only ever show it partly filled.
    if ((c.creditsMax ?? 0) < a.minCredits) continue;
    advisor.push(c.id);
  }

  return {
    "eas-core": finish(withTwins([...Object.values(src.core2025).flat(), ...Object.values(src.core2026).flat()])),
    "eas-concentration": finish(withTwins(Object.values(src.concentrations2026).flat())),
    "eas-field-course": finish(src.field),
    "eas-biology": finish([...src.biology, ...src.biologyAlso.ids]),
    "eas-advisor-course": finish(advisor),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "eas-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, JSON.parse(text), Object.values(catalog));

  console.log(`\n── build-eas-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup}`);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
    const missing = ids.filter((id) => !catalog[id]);
    const shown = missing.length > 12 ? `${missing.slice(0, 12).join(", ")}, …` : missing.join(", ");
    console.log(`   ${gid.padEnd(22)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + shown : ""})`);
  }
  const stale = next !== text;
  if (check) {
    if (stale) {
      console.error("\nSTALE: the program file differs from what the source produces. Re-run without --check.");
      process.exit(1);
    }
    console.log("\nProgram file is current.");
  } else {
    if (stale) writeFileSync(path, next);
    console.log(stale ? "\nWrote the program file." : "\nNo change.");
  }
}

if (require.main === module) main();
