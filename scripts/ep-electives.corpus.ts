// scripts/ep-electives.corpus.ts
// Asserted, offline corpus runner for build-ep-electives.ts (spec 036): the
// technical subject/level/credit rules, the advanced AEP courses kept in the
// major-approved lists, and required courses, their cross-listings and the
// program's choice-group options left out. Exits nonzero on any mismatch.
//
// Run: npx tsx ep-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Course, type Source } from "./build-ep-electives";

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
  program: "cornell-ep-bs-2025",
  advancedCore: ["AEP-4340", "AEP-3560", "AEP-3620"],
  technical: {
    engineeringSubjects: ["AEP", "ECE"],
    scienceSubjects: ["MATH", "PHYS"],
    subjectPrefixes: ["BIO"],
    minCredits: 3,
    upperFrom: 3000,
    minNumber: 1100,
    exceptIds: ["MATH-1110"],
    excludeTitlePattern: "teach|entrepreneur",
  },
};

const c = (id: string, title: string, creditsMax = 4): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMax };
};
const catalog: Course[] = [
  c("AEP-3200", "Introductory Mathematical Physics"),
  c("PHYS-3200", "Introductory Mathematical Physics"), // a same-number twin of a required course
  c("AEP-3560", "Intermediate Electrodynamics"),
  c("AEP-3620", "Intermediate Quantum Mechanics"),
  c("AEP-4340", "Fluid and Continuum Mechanics"),
  c("AEP-4900", "Undergraduate Research in Engineering Physics", 6),
  c("ECE-3030", "Electromagnetic Fields and Waves"),
  c("ECE-4999", "Teaching in ECE"),
  c("ECE-4450", "Entrepreneurship for Engineers"),
  c("MATH-1110", "Calculus I"),
  c("MATH-2210", "Linear Algebra"),
  c("MATH-1006", "Academic Support", 1),
  c("PHYS-1112", "Physics I: Mechanics and Heat"),
  c("PHYS-3316", "Basics of Quantum Mechanics"),
  c("PHYS-4400", "Advanced Experimental Physics (half)", 2),
  c("BIOMG-1350", "Introductory Biology"),
  c("ECON-3130", "Intermediate Microeconomics"),
];
const program = {
  slots: [
    { kind: "course", courseId: "AEP-3200" },
    { kind: "elective", courseId: null },
  ],
  electiveGroups: [
    { id: "ep-phys1-choice", courseIds: ["PHYS-1112", "PHYS-1116"] },
    { id: "ep-advanced-core", courseIds: ["AEP-3560"] }, // own list: never treated as a choice group
  ],
};

check("advanced core sorted as named", () => {
  assertEqual("core", buildLists(src, program, catalog)["ep-advanced-core"], ["AEP-3560", "AEP-3620", "AEP-4340"]);
});

check("3000+: technical, 3+ credits, research kept, advanced AEP kept, required and twins out", () => {
  assertEqual("upper", buildLists(src, program, catalog)["ep-major-approved-elective"], [
    "AEP-3560",
    "AEP-3620",
    "AEP-4340",
    "AEP-4900",
    "ECE-3030",
    "PHYS-3316",
  ]);
});

check("any level: 1100+, no pre-curriculum exception, choice-group options out", () => {
  assertEqual("any", buildLists(src, program, catalog)["ep-major-approved-any"], [
    "AEP-3560",
    "AEP-3620",
    "AEP-4340",
    "AEP-4900",
    "BIOMG-1350",
    "ECE-3030",
    "MATH-2210",
    "PHYS-3316",
  ]);
});

console.log(`\n── ep-electives corpus — ${checks.length} case(s) ──`);
for (const k of checks) {
  const before = failures;
  try {
    k.fn();
  } catch (e) {
    fail(k.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${k.name}`);
}
console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
