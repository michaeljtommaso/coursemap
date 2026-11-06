// scripts/build-be-electives.ts
// Fill the Biological Engineering major's lists in
// seed-data/programs-2025/cornell-be-bs-2025.json (spec 031).
//
//   be-focus-elective   Focus Area Electives: the five focus-area lists together
//   be-biochem          BIOMG 3300, 3350, or 3310 + 3320 (the 4-credit pool
//                       makes 3310 alone partial and the pair complete)
//   be-upper-bio        Advanced Biological Sciences: BIO-subject courses at
//                       2000+ with 3+ credits and a biology prerequisite (a BIO
//                       course in the parsed prerequisites, or biology named in
//                       the prerequisite text), plus CEE 4510
//   be-2220-2210        Thermodynamics: BEE 2220, ENGRD 2210, CHEME 3130, MSE 3030
//
// Source: seed-data/sources/be-electives-2026-11-06.json. Courses the major
// already requires are left out. The upper-level biology list expands against
// the newest catalog backup; the named lists keep ids that aren't offered now.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-be-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-be-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-be-electives.ts            (write the program file)
//   npx tsx build-be-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, numberOf, prereqIds, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-be-bs-2025";

export type Source = {
  program: string;
  focusAreas: Record<string, string[]>;
  biochem: string[];
  thermodynamics: string[];
  upperBio: {
    subjectPrefix: string;
    from: number;
    minCredits: number;
    prereqTextPattern: string;
    excludeIds: string[];
    excludeTitlePattern: string;
    plus: string[];
  };
};

export type Course = {
  id: string;
  subject: string;
  number: string;
  title?: string | null;
  creditsMax?: number | null;
  prereqExpr?: unknown;
  prereqText?: string | null;
};
type Program = { slots: { kind: string; courseId: string | null }[] };

/** Does this course meet the upper-level biology rule? */
export function upperBioByRule(c: Course, u: Source["upperBio"]): boolean {
  if (!c.subject.startsWith(u.subjectPrefix) || numberOf(c) < u.from) return false;
  if ((c.creditsMax ?? 0) < u.minCredits) return false;
  if (u.excludeIds.includes(c.id) || new RegExp(u.excludeTitlePattern, "i").test(c.title ?? "")) return false;
  const bioPrereq = [...prereqIds(c.prereqExpr)].some((id) => id.startsWith(u.subjectPrefix));
  return bioPrereq || new RegExp(u.prereqTextPattern, "i").test(c.prereqText ?? "");
}

/** group id → list. `program` supplies the required ids; `courses` the catalog. */
export function buildLists(src: Source, program: Program, courses: Iterable<Course>): Record<string, string[]> {
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  const upper = [...src.upperBio.plus];
  for (const c of courses) if (upperBioByRule(c, src.upperBio)) upper.push(c.id);
  return {
    "be-focus-elective": finish(Object.values(src.focusAreas).flat()),
    "be-biochem": finish(src.biochem),
    "be-upper-bio": finish(upper),
    "be-2220-2210": finish(src.thermodynamics),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "be-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, JSON.parse(text), Object.values(catalog));

  console.log(`\n── build-be-electives (${check ? "CHECK" : "WRITE"}) ──`);
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
