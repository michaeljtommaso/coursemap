// scripts/be-electives.corpus.ts
// Asserted, offline corpus runner for build-be-electives.ts (spec 031): the
// upper-level biology rule (subject, level, credits, parsed and text biology
// prerequisites, exclusions), the named lists, and required courses left out.
// Exits nonzero on any mismatch.
//
// Run: npx tsx be-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, upperBioByRule, type Course, type Source } from "./build-be-electives";

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
  program: "cornell-be-bs-2025",
  focusAreas: { "Area 1": ["BEE-4590", "CHEME-5430"], "Area 4": ["CHEME-5430", "BME-3010"] },
  biochem: ["BIOMG-3300", "BIOMG-3310", "BIOMG-3320", "BIOMG-3350"],
  thermodynamics: ["BEE-2220", "ENGRD-2210", "CHEME-3130", "MSE-3030"],
  upperBio: {
    subjectPrefix: "BIO",
    from: 2000,
    minCredits: 3,
    prereqTextPattern: "biolog|ecology|microbiolog|genetics|\\bBIO[A-Z]{1,2} ?\\d{4}",
    excludeIds: ["BIOG-4980", "BIOG-4990"],
    excludeTitlePattern: "teach|research|independent study|internship",
    plus: ["CEE-4510"],
  },
};

const bioPre = { type: "course", id: "BIOG-1440" };
const course = (id: string, o: Partial<Course> = {}): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: "A biology course", creditsMax: 3, ...o };
};
const catalog = [
  course("BIOMI-2900", { prereqExpr: bioPre }),
  course("BIOMG-3300", { creditsMax: 4, prereqText: "one majors-level biology course and one year general chemistry" }),
  course("BIOCB-4381", { prereqText: "CS 1110; STSCI 2200 or BTRY 3010" }),
  course("BIONB-4990", { title: "Independent Undergraduate Research in Neurobiology", prereqExpr: bioPre }),
  course("BIOG-4980", { prereqExpr: bioPre }),
  course("BIONB-4210", { creditsMax: 1, prereqExpr: bioPre }),
  course("BIOG-1440"),
  course("BIOEE-2640", { prereqText: "" }),
  course("CHEM-3570", { prereqText: "introductory biology recommended" }),
];

check("upper-level biology rule", () => {
  const r = (id: string) => upperBioByRule(catalog.find((c) => c.id === id)!, src.upperBio);
  assertEqual("BIOMI 2900 (parsed BIO prerequisite)", r("BIOMI-2900"), true);
  assertEqual("BIOMG 3300 (biology in the prerequisite text)", r("BIOMG-3300"), true);
  assertEqual("BIOCB 4381 (no biology prerequisite)", r("BIOCB-4381"), false);
  assertEqual("BIONB 4990 (research title)", r("BIONB-4990"), false);
  assertEqual("BIOG 4980 (named exclusion)", r("BIOG-4980"), false);
  assertEqual("BIONB 4210 (1-credit seminar)", r("BIONB-4210"), false);
  assertEqual("BIOG 1440 (below 2000)", r("BIOG-1440"), false);
  assertEqual("BIOEE 2640 (no prerequisite)", r("BIOEE-2640"), false);
  assertEqual("CHEM 3570 (not a BIO subject)", r("CHEM-3570"), false);
});

check("lists: focus union, biochem, thermo, upper bio + CEE 4510", () => {
  const lists = buildLists(src, { slots: [] }, catalog);
  assertEqual("focus", lists["be-focus-elective"], ["BEE-4590", "BME-3010", "CHEME-5430"]);
  assertEqual("biochem", lists["be-biochem"], ["BIOMG-3300", "BIOMG-3310", "BIOMG-3320", "BIOMG-3350"]);
  assertEqual("thermo", lists["be-2220-2210"], ["BEE-2220", "CHEME-3130", "ENGRD-2210", "MSE-3030"]);
  assertEqual("upper bio", lists["be-upper-bio"], ["BIOMG-3300", "BIOMI-2900", "CEE-4510"]);
});

check("required courses left out", () => {
  const lists = buildLists(src, { slots: [{ kind: "course", courseId: "BME-3010" }] }, catalog);
  assertEqual("focus", lists["be-focus-elective"], ["BEE-4590", "CHEME-5430"]);
});

console.log(`\n── be-electives corpus — ${checks.length} case(s) ──`);
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
