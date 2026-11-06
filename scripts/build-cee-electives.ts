// scripts/build-cee-electives.ts
// Fill the CE and EnvE majors' elective lists in seed-data/programs-2025/
// (cornell-ce-bs-2025, cornell-enve-bs-2025) from the departments' published
// lists (spec 027). Every list is named on a page, so nothing expands against
// the catalog; the catalog snapshot only reports which ids aren't offered now.
//
//   CE:   ce-capstone-design, ce-design-elective (design + capstone),
//         ce-major-elective (major-approved + design + capstone),
//         ce-additional-science, ce-eng-comm (the college ECR list)
//   EnvE: enve-capstone, enve-design-elective (capstone + design),
//         enve-major-appr-elective (all four focus areas), enve-earth-science,
//         enve-lab-course, enve-intro-bio (+ BIOSM 1610/1780)
//
// Source: seed-data/sources/cee-electives-2026-11-06.json. Courses a major
// already requires are left out of its lists. enve-intro-bio keeps its existing
// ids and gains the two BIOSM courses.
//
// Re-seed after a change: seed-programs-2025.ts --only <id>, then
// backfill-slot-categories.ts --only <id>. --check verifies the files are current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-cee-electives.ts            (write the two program files)
//   npx tsx build-cee-electives.ts --check    (exit 1 if a file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, spliceCourseIds } from "./lib/elective-lists";

export type Source = {
  ce: {
    program: string;
    capstone: string[];
    design: string[];
    majorApproved: string[];
    additionalScience: string[];
    engComm: { ids: string[] };
  };
  enve: {
    program: string;
    capstone: string[];
    design: string[];
    focusAreas: string[];
    earthScience: string[];
    lab: string[];
    introBioPlus: string[];
  };
};

type Program = { id: string; slots: { kind: string; courseId: string | null }[]; electiveGroups: { id: string; courseIds?: string[] }[] };

const uniq = (...lists: string[][]) => [...new Set(lists.flat())];

/** group id → list, per program file. `program` supplies required ids and existing lists. */
export function buildLists(src: Source, ce: Program, enve: Program): Record<string, Record<string, string[]>> {
  const finish = (p: Program, ids: string[]) => {
    const required = new Set(p.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
    return uniq(ids)
      .filter((id) => !required.has(id))
      .sort((x, y) => x.localeCompare(y));
  };
  const c = src.ce;
  const e = src.enve;
  const introBio = enve.electiveGroups.find((g) => g.id === "enve-intro-bio")?.courseIds ?? [];
  return {
    [c.program]: {
      "ce-capstone-design": finish(ce, c.capstone),
      "ce-design-elective": finish(ce, uniq(c.design, c.capstone)),
      "ce-major-elective": finish(ce, uniq(c.majorApproved, c.design, c.capstone)),
      "ce-additional-science": finish(ce, c.additionalScience),
      "ce-eng-comm": finish(ce, c.engComm.ids),
    },
    [e.program]: {
      "enve-capstone": finish(enve, e.capstone),
      "enve-design-elective": finish(enve, uniq(e.capstone, e.design)),
      "enve-major-appr-elective": finish(enve, uniq(e.focusAreas, e.capstone, e.design)),
      "enve-earth-science": finish(enve, e.earthScience),
      "enve-lab-course": finish(enve, e.lab),
      "enve-intro-bio": finish(enve, uniq(introBio, e.introBioPlus)),
    },
  };
}

function main() {
  const check = process.argv.includes("--check");
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "cee-electives-2026-11-06.json"), "utf8")) as Source;
  const path = (id: string) => join(dataDir, "programs-2025", `${id}.json`);
  const texts: Record<string, string> = {
    [src.ce.program]: readFileSync(path(src.ce.program), "utf8"),
    [src.enve.program]: readFileSync(path(src.enve.program), "utf8"),
  };
  const lists = buildLists(src, JSON.parse(texts[src.ce.program]), JSON.parse(texts[src.enve.program]));

  const backup = newestBackup(resolve(__dirname, "backups"));
  const catalog = new Set(Object.keys((JSON.parse(readFileSync(backup, "utf8")) as { courses: object }).courses));

  console.log(`\n── build-cee-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot (for the "not offered" count): ${backup}`);
  let stale = false;
  for (const [programId, groups] of Object.entries(lists)) {
    let next = texts[programId];
    for (const [gid, ids] of Object.entries(groups)) {
      if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
      next = spliceCourseIds(next, programId, gid, ids);
      const missing = ids.filter((id) => !catalog.has(id));
      console.log(`   ${gid.padEnd(26)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + missing.join(", ") : ""})`);
    }
    if (next === texts[programId]) continue;
    stale = true;
    if (!check) writeFileSync(path(programId), next);
  }
  if (check) {
    if (stale) {
      console.error("\nSTALE: a program file differs from what the source produces. Re-run without --check.");
      process.exit(1);
    }
    console.log("\nProgram files are current.");
  } else console.log(stale ? "\nWrote the program files." : "\nNo change.");
}

if (require.main === module) main();
