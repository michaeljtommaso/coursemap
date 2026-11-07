// scripts/build-engrd-electives.ts
// Fill the second Engineering Distribution lists of the four 2025 majors whose
// ENGRD seat was an open "ENGRD 2xxx" pattern (spec 040). The college requires
// two ENGRD courses from two different categories; each major's rule:
//
//   CE    ce-engrd-second    every category but Mechanics (ENGRD 2020 is
//                            required), plus the major-approved list: ENGRD 3200
//                            or BEE 2510 may be the second distribution, and then
//                            one more major-approved elective is taken
//   EnvE  enve-engrd-second  every category (ENGRD 3200, required, may be the
//                            second distribution), plus engineering courses at
//                            3000+ with 3+ credits that carry no liberal studies
//                            tag or petition
//   EAS   eas-engrd,         every category, for both seats (the two-categories
//         eas-engrd-second   rule is in the notes; the app can't check it)
//   EP    ep-engrd-second    every category but Mechanics (AEP 3330 is EP's), plus
//                            MATH 4710 (EP's substitute for ENGRD 2700)
//
// Every list gains its ENGRD courses' same-number title twins from the catalog
// (ENGRD 2210 ↔ MAE 2210), and leaves out the courses the major requires and
// their twins (EAS 2250 ↔ ENGRD 2250, BEE 2510 ↔ ENGRD 2510).
//
// Source: seed-data/sources/engrd-distribution-2026-11-07.json (categories and
// substitutes from the handbook and catalog). Liberal studies tags and petitions:
// cornell-degree-planner/src/data/liberal-studies/2026-11-07.json.
//
// Run build-cee-electives.ts first: CE's list reads ce-major-elective from the
// program file. Re-seed after a change: seed-programs-2025.ts --only <id>
// (dry-run first: it writes by default), then backfill-slot-categories.ts --only
// <id>. --check verifies the files are current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-engrd-electives.ts            (write the four program files)
//   npx tsx build-engrd-electives.ts --check    (exit 1 if a file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COURSE_IDS_CAP, newestBackup, sameNumberTwins, spliceCourseIds } from "./lib/elective-lists";

export type Source = {
  categories: { name: string; ids: string[] }[];
  substitutes: Record<string, { category: string; majors: string }>;
};

export type Course = {
  id: string;
  subject: string;
  number: string;
  title?: string | null;
  creditsMax?: number | null;
  attrs?: { value: string }[] | null;
};

/** The liberal studies data the app ships (spec 037): tag bases and exact tags
 *  per group, and the approved petitions keyed by course id. */
export type LiberalStudiesData = {
  cohorts: { groups: { bases: string[]; exact: string[] }[] }[];
  petitions: Record<string, unknown>;
};

type Program = {
  id: string;
  slots: { kind: string; courseId: string | null }[];
  electiveGroups: { id: string; courseIds?: string[] }[];
};

export type Major = {
  program: string;
  groups: string[];
  /** Categories the major's required courses already cover. */
  excludeCategories?: string[];
  /** Substitute ids (from the source's `substitutes`) this major may use. */
  substitutes?: string[];
  /** Other groups of the same program whose lists also fill this seat. */
  plusGroups?: string[];
  /** Engineering courses at `from`+ that also fill this seat. */
  plusEngineering?: { subjects: string[]; from: number; minCredits: number; excludeTitlePattern: string };
};

export const MAJORS: Major[] = [
  { program: "cornell-ce-bs-2025", groups: ["ce-engrd-second"], excludeCategories: ["Mechanics"], plusGroups: ["ce-major-elective"] },
  {
    program: "cornell-enve-bs-2025",
    groups: ["enve-engrd-second"],
    plusEngineering: {
      subjects: ["AEP", "BEE", "BME", "CEE", "CHEME", "CS", "ECE", "ENGRD", "ENMGT", "MAE", "MSE", "ORIE", "SYSEN"],
      from: 3000,
      minCredits: 3,
      excludeTitlePattern: "teach|leadership|time management|managing conflict|practical training|career",
    },
  },
  { program: "cornell-eas-bs-2025", groups: ["eas-engrd", "eas-engrd-second"] },
  { program: "cornell-ep-bs-2025", groups: ["ep-engrd-second"], excludeCategories: ["Mechanics"], substitutes: ["MATH-4710"] },
];

const numberOf = (c: Course) => Number.parseInt(c.number, 10) || 0;

/** "SBA-AG" → "SBA" (split at the LAST hyphen, as the app does). */
const tagBase = (tag: string) => {
  const i = tag.lastIndexOf("-");
  return i > 0 ? tag.slice(0, i) : tag;
};

/** True when the course counts for liberal studies in either entering-class
 *  policy: a roster tag in some group, or an approved petition. */
export function liberalStudiesCourse(ls: LiberalStudiesData): (c: Course) => boolean {
  const bases = new Set<string>();
  const exact = new Set<string>();
  for (const cohort of ls.cohorts)
    for (const g of cohort.groups) {
      g.bases.forEach((b) => bases.add(b));
      g.exact.forEach((e) => exact.add(e));
    }
  return (c) =>
    Object.prototype.hasOwnProperty.call(ls.petitions, c.id) ||
    (c.attrs ?? []).some((a) => a?.value && (exact.has(a.value) || bases.has(tagBase(a.value))));
}

/** group id → list, per program. */
export function buildLists(
  src: Source,
  majors: Major[],
  programs: Record<string, Program>,
  courses: Course[],
  ls: LiberalStudiesData
): Record<string, Record<string, string[]>> {
  const twins = sameNumberTwins(courses);
  const withTwins = (ids: Iterable<string>) => {
    const out = new Set<string>();
    for (const id of ids) {
      out.add(id);
      for (const t of twins.get(id) ?? []) out.add(t);
    }
    return out;
  };
  const isLiberal = liberalStudiesCourse(ls);
  const out: Record<string, Record<string, string[]>> = {};
  for (const m of majors) {
    const p = programs[m.program];
    if (!p) throw new Error(`no program ${m.program}`);
    const required = withTwins(p.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
    const known = new Set(src.categories.map((c) => c.name));
    for (const name of m.excludeCategories ?? []) if (!known.has(name)) throw new Error(`no category ${name}`);
    const ids = new Set<string>();
    for (const c of src.categories) if (!(m.excludeCategories ?? []).includes(c.name)) c.ids.forEach((id) => ids.add(id));
    for (const s of m.substitutes ?? []) {
      if (!src.substitutes[s]) throw new Error(`no substitute ${s}`);
      ids.add(s);
    }
    const list = withTwins(ids);
    for (const gid of m.plusGroups ?? []) {
      const g = p.electiveGroups.find((x) => x.id === gid);
      if (!g?.courseIds) throw new Error(`${m.program}: no list ${gid}`);
      g.courseIds.forEach((id) => list.add(id));
    }
    const e = m.plusEngineering;
    if (e) {
      const excludeTitle = new RegExp(e.excludeTitlePattern, "i");
      for (const c of courses) {
        if (!e.subjects.includes(c.subject) || numberOf(c) < e.from) continue;
        if ((c.creditsMax ?? 0) < e.minCredits || excludeTitle.test(c.title ?? "") || isLiberal(c)) continue;
        list.add(c.id);
      }
    }
    const finished = [...list].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
    out[m.program] = Object.fromEntries(m.groups.map((gid) => [gid, finished]));
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const src = JSON.parse(readFileSync(join(dataDir, "sources", "engrd-distribution-2026-11-07.json"), "utf8")) as Source;
  const ls = JSON.parse(
    readFileSync(resolve(__dirname, "..", "cornell-degree-planner", "src", "data", "liberal-studies", "2026-11-07.json"), "utf8")
  ) as LiberalStudiesData;
  const path = (id: string) => join(dataDir, "programs-2025", `${id}.json`);
  const texts = Object.fromEntries(MAJORS.map((m) => [m.program, readFileSync(path(m.program), "utf8")]));
  const programs = Object.fromEntries(MAJORS.map((m) => [m.program, JSON.parse(texts[m.program]) as Program]));
  const catalog = (JSON.parse(readFileSync(backup, "utf8")) as { courses: Record<string, Course> }).courses;
  const lists = buildLists(src, MAJORS, programs, Object.values(catalog), ls);

  console.log(`\n── build-engrd-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup}`);
  let stale = false;
  for (const [programId, groups] of Object.entries(lists)) {
    let next = texts[programId];
    for (const [gid, ids] of Object.entries(groups)) {
      if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
      next = spliceCourseIds(next, programId, gid, ids);
      const missing = ids.filter((id) => !catalog[id]);
      const shown = missing.length > 12 ? `${missing.slice(0, 12).join(", ")}, …` : missing.join(", ");
      console.log(`   ${gid.padEnd(20)} ${String(ids.length).padStart(4)} courses (${missing.length} not in the snapshot${missing.length ? ": " + shown : ""})`);
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
