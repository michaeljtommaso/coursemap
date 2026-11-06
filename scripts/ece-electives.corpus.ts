// scripts/ece-electives.corpus.ts
// Asserted, offline corpus runner for build-ece-electives.ts (spec 026): title
// twins (cross-listings) and generic titles, the ECE elective and 4000+ lists,
// the exclusions and named CS courses, the outside-ECE whitelist (2000+, 1000
// with a prerequisite, twins and ENGRI/ENGRC out), and required courses left
// out. No network. Exits nonzero on any mismatch.
//
// Run: npx tsx ece-electives.corpus.ts   (from the scripts/ folder)

import {
  buildLists,
  eceTwins,
  GROUP_CDE,
  GROUP_ELECTIVE,
  GROUP_ELECTIVE_4000,
  GROUP_ENGRD,
  GROUP_OUTSIDE,
  type Source,
} from "./build-ece-electives";
import type { CatalogCourse } from "./lib/elective-lists";

const checks: { name: string; fn: () => void }[] = [];
let failures = 0;
const check = (name: string, fn: () => void) => checks.push({ name, fn });
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}

const src: Source = {
  eceElective: {
    from: 3000,
    fourThousandFrom: 4000,
    except: ["ECE-4999", "ECE-5830"],
    excludeTitlePattern: "teaching|research|seminar",
    plusAt4000: ["CS-4120"],
  },
  cde: ["ECE-4750", "ECE-4762"],
  crossListing: { genericTitlePattern: "research|independent|seminar", minTitleLength: 11 },
  outside: {
    subjects: ["CS", "MAE", "MATH", "ENGRD", "PHYS"],
    subjectPrefixes: ["BIO"],
    from: 2000,
    allow1000WithPrereq: true,
    plus: ["ECE-5830", "ECE-4999"],
    excludeTitlePattern: "teach|leadership",
  },
  engrd: { ids: ["ENGRD-2020", "ENGRD-2300"] },
};

const course = (id: string, title: string, prereqExpr: unknown = null): CatalogCourse & { title: string } => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, prereqExpr };
};
const catalog = new Map(
  [
    course("ECE-3030", "Electromagnetic Fields and Waves"),
    course("ECE-3140", "Embedded Systems"),
    course("CS-3420", "Embedded Systems"),
    course("ECE-4750", "Computer Architecture"),
    course("CS-4420", "Computer Architecture"),
    course("ECE-4999", "Independent Project"),
    course("ECE-5830", "Introduction to Technical Management"),
    course("ECE-4900", "Independent Research"),
    course("MAE-4900", "Independent Research"),
    course("ECE-2100", "Intro to Circuits"),
    course("ECE-2720", "Data Science for Engineers"),
    course("ENGRD-2720", "Data Science for Engineers"),
    course("ENGRD-2020", "Statics and Mechanics of Solids"),
    course("MATH-2940", "Linear Algebra for Engineers"),
    course("MATH-4130", "Honors Introduction to Analysis I"),
    course("PHYS-1116", "Physics I: Mechanics and Special Relativity", { type: "course", id: "MATH-1910" }),
    course("PHYS-1101", "General Physics I"),
    course("CS-4090", "Teaching Experience in Computer Science"),
    course("BIOMG-3300", "Principles of Biochemistry"),
    course("HIST-3000", "A History Course"),
  ].map((c) => [c.id, c] as const)
);

check("title twins, generic titles skipped", () => {
  const t = eceTwins(catalog, src.crossListing);
  assertEqual("twins", [...t.keys()].sort(), ["CS-3420", "CS-4420", "ENGRD-2720"]);
});

check("ECE elective and 4000+ lists", () => {
  const l = buildLists(src, catalog, new Set(["MATH-2940", "ECE-2720", "ENGRD-2720"]));
  assertEqual("elective", l[GROUP_ELECTIVE], ["CS-3420", "CS-4120", "CS-4420", "ECE-3030", "ECE-3140", "ECE-4750"]);
  assertEqual("4000+", l[GROUP_ELECTIVE_4000], ["CS-4120", "CS-4420", "ECE-4750"]);
  assertEqual("cde", l[GROUP_CDE], ["ECE-4750", "ECE-4762"]);
});

check("outside-ECE whitelist", () => {
  const l = buildLists(src, catalog, new Set(["MATH-2940", "ECE-2720", "ENGRD-2720"]));
  assertEqual("outside", l[GROUP_OUTSIDE], [
    "BIOMG-3300",
    "ECE-4999",
    "ECE-5830",
    "ENGRD-2020",
    "MAE-4900",
    "MATH-4130",
    "PHYS-1116",
  ]);
  assertEqual("engrd", l[GROUP_ENGRD], ["ENGRD-2020", "ENGRD-2300"]);
});

console.log(`\n── ece-electives corpus — ${checks.length} case(s) ──`);
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
}
console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
