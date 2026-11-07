// scripts/build-isst-electives.ts
// Fill the ISST major's lists in seed-data/programs-2025/cornell-isst-bs-2025.json
// from the 2025-26 Cornell catalog (spec 033).
//
//   isst-ml-data-science            the five core Data Science / ML courses
//   isst-concentration-1            the three primary concentrations together
//   isst-concentration-2            all seven concentrations together
//   isst-major-approved             all seven + INFO 2300 / 2310, without
//                                   INFO 4910 and INFO 4998
//   isst-cs2800-math2930-math3040   PHYS 2214, MATH 2930 or MATH 3040 (CS 2800
//                                   is its own required seat)
//
// The planner has no concentration choice, so the concentration seats check
// the union of the lists; the per-concentration rules are in the notes. Every
// list is named in the catalog, so nothing expands against the catalog; the
// snapshot only reports which ids aren't offered now. Courses the major
// already requires are left out, and CS 4152 (the INFO listing must be used).
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-isst-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-isst-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-isst-electives.ts            (write the program file)
//   npx tsx build-isst-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-isst-bs-2025";

export type Source = {
  program: string;
  mlDataScience: string[];
  concentrations: Record<string, string[]>;
  primary: string[];
  majorApprovedPlus: string[];
  majorApprovedExclude: string[];
  excludeEverywhere: string[];
  fourthMathOrPhys: string[];
};

type Program = { slots: { kind: string; courseId: string | null }[] };

/** group id → list. `program` supplies the required ids. */
export function buildLists(src: Source, program: Program): Record<string, string[]> {
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  const out = new Set(src.excludeEverywhere);
  const finish = (ids: Iterable<string>, drop: readonly string[] = []) =>
    [...new Set(ids)]
      .filter((id) => !required.has(id) && !out.has(id) && !drop.includes(id))
      .sort((x, y) => x.localeCompare(y));
  const all = Object.values(src.concentrations).flat();
  const primary = src.primary.flatMap((name) => {
    const list = src.concentrations[name];
    if (!list) throw new Error(`no concentration named ${name}`);
    return list;
  });
  return {
    "isst-ml-data-science": finish(src.mlDataScience),
    "isst-concentration-1": finish(primary),
    "isst-concentration-2": finish(all),
    "isst-major-approved": finish([...all, ...src.majorApprovedPlus], src.majorApprovedExclude),
    "isst-cs2800-math2930-math3040": finish(src.fourthMathOrPhys),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "isst-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const lists = buildLists(src, JSON.parse(text));

  const backup = newestBackup(resolve(__dirname, "backups"));
  const catalog = new Set(Object.keys((JSON.parse(readFileSync(backup, "utf8")) as { courses: object }).courses));

  console.log(`\n── build-isst-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot (for the "not offered" count): ${backup}`);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
    const missing = ids.filter((id) => !catalog.has(id));
    console.log(`   ${gid.padEnd(30)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + missing.join(", ") : ""})`);
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
