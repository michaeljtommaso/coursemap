// scripts/build-ece-electives.ts
// Fill the ECE major's list-based groups in seed-data/programs.json
// (cornell-ece-bs-2026) from ECE's B.S. requirements page (spec 026):
//
//   ece-elective       ECE Elective (3000+)
//   ece-elective-4000  ECE Elective (4000+), two of the five
//   ece-cde            Culminating Design Experience (the page's 10)
//   ece-outside-tech   Outside-ECE Technical Elective
//   ece-engrd-dist     second ENGRD: every category but Electrical Sciences
//
// Source: seed-data/sources/ece-electives-2026-11-06.json. ECE electives are the
// catalog's ECE courses at 3000+ minus the page's exclusions, plus the named CS
// courses and every course cross-listed with a qualifying ECE course. The
// catalog carries no cross-listing field, so a non-ECE course whose title is
// exactly an ECE course's title (generic titles aside) is a "twin": it counts
// as an ECE elective at its ECE number, and stays out of the outside-ECE list.
// Outside-ECE is a math/science/engineering subject whitelist at 2000+, plus
// 1000-level courses that have a prerequisite, plus ECE 5830 and ECE 4999 (the
// page allows up to 3 credits of independent study there). Courses the major
// already requires (and their catalog aliases) are left out of every list.
//
// Re-run after a roster sync, then re-seed ECE (seed-programs-legacy.ts --only
// cornell-ece-bs-2026). --check verifies programs.json is current.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-ece-electives.ts                 (write programs.json)
//   npx tsx build-ece-electives.ts --check         (exit 1 if programs.json is stale)
//   npx tsx build-ece-electives.ts --from <backup> (catalog snapshot; default: the
//                                                   newest backups/catalog-backup-*.json)

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COURSE_IDS_CAP,
  newestBackup,
  numberOf,
  prereqIds,
  spliceCourseIds,
  type CatalogCourse,
} from "./lib/elective-lists";

export const PROGRAM_ID = "cornell-ece-bs-2026";
export const GROUP_ELECTIVE = "ece-elective";
export const GROUP_ELECTIVE_4000 = "ece-elective-4000";
export const GROUP_CDE = "ece-cde";
export const GROUP_OUTSIDE = "ece-outside-tech";
export const GROUP_ENGRD = "ece-engrd-dist";

export type Source = {
  eceElective: { from: number; fourThousandFrom: number; except: string[]; excludeTitlePattern: string; plusAt4000: string[] };
  cde: string[];
  crossListing: { genericTitlePattern: string; minTitleLength: number };
  outside: {
    subjects: string[];
    subjectPrefixes: string[];
    from: number;
    allow1000WithPrereq: boolean;
    plus: string[];
    excludeTitlePattern: string;
  };
  engrd: { ids: string[] };
};

type Course = CatalogCourse & { title?: string | null };
export type Lists = Record<
  typeof GROUP_ELECTIVE | typeof GROUP_ELECTIVE_4000 | typeof GROUP_CDE | typeof GROUP_OUTSIDE | typeof GROUP_ENGRD,
  string[]
>;

const titleKey = (t: string | null | undefined) => (t ?? "").trim().toLowerCase();

/** Non-ECE course id → the ECE ids that share its exact (non-generic) title. */
export function eceTwins(courses: Map<string, Course>, x: Source["crossListing"]): Map<string, string[]> {
  const generic = new RegExp(x.genericTitlePattern, "i");
  const byTitle = new Map<string, string[]>();
  for (const c of courses.values()) {
    if (c.subject !== "ECE") continue;
    const k = titleKey(c.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), c.id]);
  }
  const twins = new Map<string, string[]>();
  for (const c of courses.values()) {
    if (c.subject === "ECE") continue;
    const k = titleKey(c.title);
    if (k.length < x.minTitleLength || generic.test(k)) continue;
    const ece = byTitle.get(k);
    if (ece) twins.set(c.id, ece);
  }
  return twins;
}

export function buildLists(src: Source, courses: Map<string, Course>, required: ReadonlySet<string>): Lists {
  const e = src.eceElective;
  const twins = eceTwins(courses, src.crossListing);
  // The page's "such as ECE 4999 / 5870 / 5880": independent projects, project
  // teams, seminars, teaching and research are not ECE electives.
  const nonTechnical = new RegExp(e.excludeTitlePattern, "i");
  const eceOk = (id: string) => {
    if (e.except.includes(id)) return false;
    const c = courses.get(id);
    return !!c && numberOf(c) >= e.from && !nonTechnical.test(c.title ?? "");
  };
  const eceLevel = (id: string) => numberOf(courses.get(id)!);

  const elective = new Set<string>(e.plusAt4000);
  const elective4000 = new Set<string>(e.plusAt4000);
  for (const c of courses.values()) {
    if (c.subject === "ECE" && eceOk(c.id)) {
      elective.add(c.id);
      if (eceLevel(c.id) >= e.fourThousandFrom) elective4000.add(c.id);
    }
  }
  for (const [id, ece] of twins) {
    const ok = ece.filter(eceOk);
    if (ok.length === 0) continue;
    elective.add(id);
    if (ok.some((x) => eceLevel(x) >= e.fourThousandFrom)) elective4000.add(id);
  }

  const o = src.outside;
  const excludeTitle = new RegExp(o.excludeTitlePattern, "i");
  const outside = new Set<string>(o.plus);
  for (const c of courses.values()) {
    const inSubject = o.subjects.includes(c.subject) || o.subjectPrefixes.some((p) => c.subject.startsWith(p));
    if (!inSubject || twins.has(c.id) || excludeTitle.test(c.title ?? "")) continue;
    const n = numberOf(c);
    if (Number.isNaN(n)) continue;
    if (n >= o.from) outside.add(c.id);
    else if (o.allow1000WithPrereq && n >= 1000 && prereqIds(c.prereqExpr).size > 0) outside.add(c.id);
  }

  const finish = (s: Iterable<string>) =>
    [...new Set(s)].filter((id) => !required.has(id)).sort((x, y) => x.localeCompare(y));
  return {
    [GROUP_ELECTIVE]: finish(elective),
    [GROUP_ELECTIVE_4000]: finish(elective4000),
    [GROUP_CDE]: finish(src.cde),
    [GROUP_OUTSIDE]: finish(outside),
    [GROUP_ENGRD]: finish(src.engrd.ids),
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const fromAt = args.indexOf("--from");
  const backup = fromAt >= 0 ? resolve(args[fromAt + 1]) : newestBackup(resolve(__dirname, "backups"));
  const dataDir = resolve(__dirname, "seed-data");
  const programsPath = join(dataDir, "programs.json");

  const src = JSON.parse(readFileSync(join(dataDir, "sources", "ece-electives-2026-11-06.json"), "utf8")) as Source;
  const raw = JSON.parse(readFileSync(backup, "utf8")) as {
    courses: Record<string, Course>;
    catalog?: { meta?: { aliases?: Record<string, string> } };
  };
  const courses = new Map(Object.entries(raw.courses).map(([id, c]) => [id, { ...c, id }]));
  const aliases = raw.catalog?.meta?.aliases ?? {};
  const text = readFileSync(programsPath, "utf8");
  const program = (JSON.parse(text) as { id: string; slots: { kind: string; courseId: string | null }[] }[]).find(
    (p) => p.id === PROGRAM_ID
  );
  if (!program) throw new Error(`${PROGRAM_ID} not in programs.json`);
  // Required courses and every alias of one (ENGRD 2300 is ECE 2300, which ECE requires).
  const required = new Set(program.slots.filter((s) => s.kind === "course" && s.courseId).map((s) => s.courseId!));
  for (const [from, to] of Object.entries(aliases)) if (required.has(to)) required.add(from);

  const lists = buildLists(src, courses, required);
  let next = text;
  for (const [gid, ids] of Object.entries(lists)) {
    if (ids.length > COURSE_IDS_CAP) throw new Error(`${gid}: ${ids.length} ids exceeds the ${COURSE_IDS_CAP} cap`);
    next = spliceCourseIds(next, PROGRAM_ID, gid, ids);
  }

  console.log(`\n── build-ece-electives (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   catalog snapshot: ${backup} (${courses.size} courses)`);
  console.log(`   cross-listed twins of ECE courses: ${eceTwins(courses, src.crossListing).size}`);
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
