// scripts/build-ep-electives.ts
// Fill the Engineering Physics major's lists in
// seed-data/programs-2025/cornell-ep-bs-2025.json (spec 036).
//
//   ep-advanced-core              two of AEP 3560 / 3620 / 4340 (note e)
//   ep-major-approved-elective    five major-approved electives: technical courses
//                                 at 3000+ (note h)
//   ep-major-approved-any         the sixth: a technical course at any level
//
// "Technical" is engineering, math and science subjects with 3+ credits (the
// seat's minimum). The department publishes no list, so these expand against the
// newest catalog backup. Courses the major already requires, their same-number
// cross-listings, and the program's own choice-group options (PHYS 1112/1116 …)
// are left out. The advanced AEP courses stay in the 3000+ list: a third one
// counts as a major-approved elective.
//
// Source: seed-data/sources/ep-electives-2026-11-06.json.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-ep-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-ep-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-ep-electives.ts            (write the program file)
//   npx tsx build-ep-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, numberOf, sameNumberTwins, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-ep-bs-2025";
const OWN_LISTS = new Set(["ep-advanced-core", "ep-major-approved-elective", "ep-major-approved-any"]);

export type Source = {
  program: string;
  advancedCore: string[];
  technical: {
    engineeringSubjects: string[];
    scienceSubjects: string[];
    subjectPrefixes: string[];
    minCredits: number;
    upperFrom: number;
    minNumber: number;
    exceptIds: string[];
    excludeTitlePattern: string;
  };
};

export type Course = { id: string; subject: string; number: string; title?: string | null; creditsMax?: number | null };
type Program = {
  slots: { kind: string; courseId: string | null }[];
  electiveGroups: { id: string; courseIds?: string[] }[];
};

/** group id → list. `program` supplies the required ids; `courses` the catalog. */
export function buildLists(src: Source, program: Program, courses: Iterable<Course>): Record<string, string[]> {
  const catalog = [...courses];
  const twins = sameNumberTwins(catalog);
  const withTwins = (ids: Iterable<string>) => [...ids].flatMap((id) => [id, ...(twins.get(id) ?? [])]);
  const required = new Set(withTwins(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!)));
  // The program's choice groups (intro chemistry, the three physics choices) already seat their options.
  const choiceOptions = new Set(
    withTwins(program.electiveGroups.filter((g) => !OWN_LISTS.has(g.id)).flatMap((g) => g.courseIds ?? []))
  );
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id) && !choiceOptions.has(id)).sort((x, y) => x.localeCompare(y));

  const t = src.technical;
  const subjects = new Set([...t.engineeringSubjects, ...t.scienceSubjects]);
  const excludeTitle = new RegExp(t.excludeTitlePattern, "i");
  const upper: string[] = [];
  const any: string[] = [];
  for (const c of catalog) {
    const inSubject = subjects.has(c.subject) || t.subjectPrefixes.some((p) => c.subject.startsWith(p));
    if (!inSubject || excludeTitle.test(c.title ?? "")) continue;
    // A course that can never reach the seat's credits would only ever show it partly filled.
    if ((c.creditsMax ?? 0) < t.minCredits) continue;
    const n = numberOf(c);
    if (!(n >= t.minNumber) || t.exceptIds.includes(c.id)) continue;
    any.push(c.id);
    if (n >= t.upperFrom) upper.push(c.id);
  }

  return {
    "ep-advanced-core": [...src.advancedCore].sort((x, y) => x.localeCompare(y)),
    // A third advanced AEP course counts as a major-approved elective (note e).
    "ep-major-approved-elective": finish([...upper, ...src.advancedCore]),
    "ep-major-approved-any": finish([...any, ...src.advancedCore]),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "ep-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, JSON.parse(text), Object.values(catalog));

  console.log(`\n── build-ep-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup}`);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
    const missing = ids.filter((id) => !catalog[id]);
    const shown = missing.length > 12 ? `${missing.slice(0, 12).join(", ")}, …` : missing.join(", ");
    console.log(`   ${gid.padEnd(28)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + shown : ""})`);
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
