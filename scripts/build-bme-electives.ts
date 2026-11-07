// scripts/build-bme-electives.ts
// Fill the Biomedical Engineering major's lists in
// seed-data/programs-2025/cornell-bme-bs-2025.json (spec 034).
//
//   bme-concentration-elective   the four concentrations' elective lists together
//                                (Fall 2025 and Fall 2026 handbooks and the
//                                department page)
//   bme-cornerstone              the four concentration cornerstones
//
// The planner has no concentration choice for this major, so the elective seats
// check the union of the lists; the rule (both from your own concentration) is
// in the notes. Every list is named, so nothing expands against the catalog;
// the snapshot only reports which ids aren't offered now. Courses the major
// already requires are left out.
//
// Re-seed after a change: seed-programs-2025.ts --only cornell-bme-bs-2025
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// cornell-bme-bs-2025. --check verifies the file is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-bme-electives.ts            (write the program file)
//   npx tsx build-bme-electives.ts --check    (exit 1 if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, spliceCourseIds } from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-bme-bs-2025";

export type Source = {
  program: string;
  concentrations: Record<string, string[]>;
  cornerstones: string[];
};

type Program = { slots: { kind: string; courseId: string | null }[] };

/** group id → list. `program` supplies the required ids. */
export function buildLists(src: Source, program: Program): Record<string, string[]> {
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  const cornerstones = new Set(src.cornerstones);
  const finish = (ids: Iterable<string>) =>
    [...new Set(ids)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  return {
    // A cornerstone is its own seat; keep it out of the elective pool.
    "bme-concentration-elective": finish(Object.values(src.concentrations).flat().filter((id) => !cornerstones.has(id))),
    "bme-cornerstone": finish(src.cornerstones),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "bme-electives-2026-11-06.json"), "utf8")) as Source;
  if (src.program !== PROGRAM_ID) throw new Error(`source is for ${src.program}, not ${PROGRAM_ID}`);
  const path = join(dataDir, "programs-2025", `${PROGRAM_ID}.json`);
  const text = readFileSync(path, "utf8");
  const lists = buildLists(src, JSON.parse(text));

  const backup = newestBackup(resolve(__dirname, "backups"));
  const catalog = new Set(Object.keys((JSON.parse(readFileSync(backup, "utf8")) as { courses: object }).courses));

  console.log(`\n── build-bme-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot (for the "not offered" count): ${backup}`);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
    const missing = ids.filter((id) => !catalog.has(id));
    console.log(`   ${gid.padEnd(28)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + missing.join(", ") : ""})`);
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
