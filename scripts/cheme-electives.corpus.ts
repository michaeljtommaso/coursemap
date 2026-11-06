// scripts/cheme-electives.corpus.ts
// Asserted, offline corpus runner for build-cheme-electives.ts (spec 030): the
// Advanced list as the union of three editions, the Biology list with the exam
// credit id, the Major-approved subject / level / credit / title cuts and named
// 2000-level courses, and required courses left out. Exits nonzero on any mismatch.
//
// Run: npx tsx cheme-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Course, type Source } from "./build-cheme-electives";

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
  program: "cornell-cheme-bs-2025",
  advanced: {
    fall2025: ["CHEME-5310", "CHEME-6680", "CHEME-4020"],
    fall2026: ["CHEME-4310", "CHEME-5310", "CHEME-4020"],
    coursesOfStudy2026: ["CHEME-4310", "CHEME-6682"],
  },
  biology: { singleCourse: ["CHEME-2880", "BIOMG-3300"], examCredit: { ids: ["BIOG-1102F"] } },
  majorApproved: {
    engineeringSubjects: ["CHEME", "CS"],
    scienceSubjects: ["MATH"],
    subjectPrefixes: ["BIO"],
    from: 3000,
    minCredits: 3,
    plus: ["ENGRD-2700", "CS-2800"],
    excludeTitlePattern: "teach|leadership",
  },
};

const course = (id: string, title = "A technical course", creditsMax = 3): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMax };
};
const catalog = [
  course("CHEME-4020"),
  course("CHEME-3010", "Career Perspectives", 1),
  course("CHEME-4980", "Undergraduate Teaching"),
  course("CS-2110"),
  course("CS-4780"),
  course("MATH-4130"),
  course("BIOMG-3300", "Principles of Biochemistry", 4),
  course("BIOMG-3320", "Molecular Biology", 2),
  course("HIST-3000"),
];
const program = (required: string[]) => ({ slots: required.map((courseId) => ({ kind: "course", courseId })) });

check("advanced: union of the three editions, sorted", () => {
  const lists = buildLists(src, program([]), catalog);
  assertEqual("advanced", lists["cheme-adv-cheme-elect"], ["CHEME-4020", "CHEME-4310", "CHEME-5310", "CHEME-6680", "CHEME-6682"]);
});

check("biology: single-course options plus the exam credit id", () => {
  const lists = buildLists(src, program([]), catalog);
  assertEqual("biology", lists["cheme-bio-elective"], ["BIOG-1102F", "BIOMG-3300", "CHEME-2880"]);
});

check("major-approved: subjects, 3000+, 3+ credits, titles, named 2000-level", () => {
  const lists = buildLists(src, program([]), catalog);
  assertEqual("major", lists["cheme-major-appr-elect"], ["BIOMG-3300", "CHEME-4020", "CS-2800", "CS-4780", "ENGRD-2700", "MATH-4130"]);
});

check("required courses left out everywhere", () => {
  const lists = buildLists(src, program(["CHEME-4020", "CS-2800"]), catalog);
  assertEqual("advanced", lists["cheme-adv-cheme-elect"], ["CHEME-4310", "CHEME-5310", "CHEME-6680", "CHEME-6682"]);
  assertEqual("major", lists["cheme-major-appr-elect"], ["BIOMG-3300", "CS-4780", "ENGRD-2700", "MATH-4130"]);
});

console.log(`\n── cheme-electives corpus — ${checks.length} case(s) ──`);
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
