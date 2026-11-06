// scripts/build-mse-electives.ts
// Fill the Materials Science and Engineering major's lists in
// seed-data/programs-2025/cornell-mse-bs-2025.json from the department's
// requirements page (spec 029).
//
//   mse-materials-elective     Materials Electives (the page's 8)
//   mse-engineering-elective   Materials Application Electives: the five category
//                              lists + the Materials Electives (they count without
//                              a petition)
//   mse-outside-tech           Outside Technical Elective: engineering and
//                              physical-science subjects at 2000+, not MSE,
//                              3+ credits (the seat's minimum)
//   mse-engrd-second           second Engineering Distribution: every college
//                              category but Materials Science
//   mse-engr-dist              the Materials Science distribution (ENGRD 2610 or
//                              2620, with their MSE cross-listings)
//   mse-3050-4020              MSE 3050 or MSE 4020
//
// Source: seed-data/sources/mse-electives-2026-11-06.json. Courses the major
// already requires are left out of its lists. The outside list expands against
// the newest catalog backup; the named lists keep ids that aren't offered now.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-mse-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-mse-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-mse-electives.ts            (write the program file)
//   npx tsx build-mse-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, numberOf, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-mse-bs-2025";

export type Source = {
  program: string;
  materials: string[];
  application: Record<string, string[]>;
  outside: { subjects: string[]; from: number; minCredits: number; excludeIds: string[]; excludeTitlePattern: string };
  engrdMaterials: { ids: string[] };
  engrdSecond: { ids: string[] };
  choice3050or4020: string[];
};

export type Course = { id: string; subject: string; number: string; title?: string | null; creditsMax?: number | null };
type Program = { slots: { kind: string; courseId: string | null }[] };

/** group id → list. `program` supplies the required ids; `courses` the catalog. */
export function buildLists(src: Source, program: Program, courses: Iterable<Course>): Record<string, string[]> {
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));

  const o = src.outside;
  const excludeTitle = new RegExp(o.excludeTitlePattern, "i");
  const excludeIds = new Set(o.excludeIds);
  const outside: string[] = [];
  for (const c of courses) {
    if (!o.subjects.includes(c.subject) || excludeIds.has(c.id)) continue;
    if (excludeTitle.test(c.title ?? "")) continue;
    // A course that can never reach the seat's credits would only ever show it partly filled.
    if ((c.creditsMax ?? 0) < o.minCredits) continue;
    if (numberOf(c) >= o.from) outside.push(c.id);
  }

  return {
    "mse-materials-elective": finish(src.materials),
    "mse-engineering-elective": finish([...Object.values(src.application).flat(), ...src.materials]),
    "mse-outside-tech": finish(outside),
    "mse-engrd-second": finish(src.engrdSecond.ids),
    "mse-engr-dist": finish(src.engrdMaterials.ids),
    "mse-3050-4020": finish(src.choice3050or4020),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "mse-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, JSON.parse(text), Object.values(catalog));

  console.log(`\n── build-mse-electives (${check ? "CHECK" : "WRITE"}) ──`);
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
