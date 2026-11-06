// scripts/build-cheme-electives.ts
// Fill the Chemical Engineering major's lists in
// seed-data/programs-2025/cornell-cheme-bs-2025.json (spec 030).
//
//   cheme-adv-cheme-elect    Advanced ChemE Electives: the Fall 2025 handbook,
//                            Fall 2026 handbook and Courses of Study 2026-27
//                            lists together (several courses were renumbered)
//   cheme-bio-elective       Biology Elective: the single-course options plus the
//                            Engineering exam-credit id (AP 5 / A-Level / IB HL 7)
//   cheme-major-appr-elect   Major-approved Electives: engineering, math, science
//                            and biology at 3000+ with 3+ credits, plus the
//                            2000-level courses the catalog names
//
// Source: seed-data/sources/cheme-electives-2026-11-06.json. Courses the major
// already requires are left out. The Major-approved list expands against the
// newest catalog backup; the named lists keep ids that aren't offered now.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-cheme-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-cheme-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-cheme-electives.ts            (write the program file)
//   npx tsx build-cheme-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, numberOf, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-cheme-bs-2025";

export type Source = {
  program: string;
  advanced: { fall2025: string[]; fall2026: string[]; coursesOfStudy2026: string[] };
  biology: { singleCourse: string[]; examCredit: { ids: string[] } };
  majorApproved: {
    engineeringSubjects: string[];
    scienceSubjects: string[];
    subjectPrefixes: string[];
    from: number;
    minCredits: number;
    plus: string[];
    excludeTitlePattern: string;
  };
};

export type Course = { id: string; subject: string; number: string; title?: string | null; creditsMax?: number | null };
type Program = { slots: { kind: string; courseId: string | null }[] };

/** group id → list. `program` supplies the required ids; `courses` the catalog. */
export function buildLists(src: Source, program: Program, courses: Iterable<Course>): Record<string, string[]> {
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));

  const m = src.majorApproved;
  const subjects = new Set([...m.engineeringSubjects, ...m.scienceSubjects]);
  const excludeTitle = new RegExp(m.excludeTitlePattern, "i");
  const major: string[] = [...m.plus];
  for (const c of courses) {
    const inSubject = subjects.has(c.subject) || m.subjectPrefixes.some((p) => c.subject.startsWith(p));
    if (!inSubject || excludeTitle.test(c.title ?? "")) continue;
    // A course that can never reach the seat's credits would only ever show it partly filled.
    if ((c.creditsMax ?? 0) < m.minCredits) continue;
    if (numberOf(c) >= m.from) major.push(c.id);
  }

  const a = src.advanced;
  return {
    "cheme-adv-cheme-elect": finish([...a.fall2025, ...a.fall2026, ...a.coursesOfStudy2026]),
    "cheme-bio-elective": finish([...src.biology.singleCourse, ...src.biology.examCredit.ids]),
    "cheme-major-appr-elect": finish(major),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "cheme-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, JSON.parse(text), Object.values(catalog));

  console.log(`\n── build-cheme-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup}`);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
    const missing = ids.filter((id) => !catalog[id]);
    const shown = missing.length > 12 ? `${missing.slice(0, 12).join(", ")}, …` : missing.join(", ");
    console.log(`   ${gid.padEnd(26)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + shown : ""})`);
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
