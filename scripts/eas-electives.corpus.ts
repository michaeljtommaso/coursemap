// scripts/eas-electives.corpus.ts
// Asserted, offline corpus runner for build-eas-electives.ts (spec 035): the core
// and concentration unions with same-number cross-listings, required courses and
// their cross-listings left out, and the advisor-approved science course's
// subject, level, credit and exception rules. Exits nonzero on any mismatch.
//
// Run: npx tsx eas-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, sameNumberTwins, type Course, type Source } from "./build-eas-electives";

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
  program: "cornell-eas-bs-2025",
  biology: ["BIOG-1140", "BIOEE-1610"],
  biologyAlso: { ids: ["BIOG-1445"] },
  core2025: { Climate: ["EAS-3050", "EAS-3410"], Environmental: ["EAS-3030", "EAS-3450"] },
  core2026: { Climate: ["EAS-2250", "EAS-3050"], Environmental: ["EAS-2250", "EAS-4710"] },
  concentrations2026: { Climate: ["EAS-4800", "BEE-4800", "EAS-3030"], Ocean: ["EAS-3030", "SEA-3665"] },
  field: ["EAS-2500", "EAS-4370"],
  advisorCourse: {
    subjects: ["MATH", "CS", "PHYS", "EAS"],
    subjectPrefixes: ["BIO"],
    minCredits: 3,
    minNumber: 1100,
    exceptIds: ["MATH-1110"],
    excludeTitlePattern: "teach|career|research$|independent",
  },
};

const c = (id: string, title: string, creditsMax = 3): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMax };
};
const catalog: Course[] = [
  c("EAS-2250", "The Earth System", 4),
  c("ENGRD-2250", "The Earth System", 4),
  c("EAS-3030", "Introduction to Biogeochemistry", 4),
  c("NTRES-3030", "Introduction to Biogeochemistry", 4),
  c("EAS-5030", "Introduction to Biogeochemistry", 4), // a grad twin: not the same number
  c("EAS-4710", "Introduction to Groundwater"),
  c("BEE-4710", "Introduction to Groundwater"),
  c("EAS-3050", "Climate Dynamics"),
  c("MATH-1110", "Calculus I", 4),
  c("MATH-2210", "Linear Algebra", 4),
  c("MATH-1006", "Academic Support for MATH 1910", 1),
  c("CS-1710", "Introduction to Cognitive Science"),
  c("CS-4999", "Teaching in Computer Science"),
  c("BIOMI-2900", "General Microbiology Lectures"),
  c("PHYS-1110", "Introduction to Experimental Physics", 1),
  c("ECON-1110", "Introductory Microeconomics"),
  c("EAS-4910", "Undergraduate Research", 4),
  c("PHYS-4490", "Independent Study in Physics", 4),
];
const program = { slots: [{ kind: "course", courseId: "EAS-2250" }, { kind: "elective", courseId: null }] };

check("same-number twins only", () => {
  const t = sameNumberTwins(catalog);
  assertEqual("EAS-3030", t.get("EAS-3030"), ["NTRES-3030"]);
  assertEqual("EAS-3050", t.get("EAS-3050"), undefined);
});

check("core: both editions, twins added, the required EAS 2250 and its ENGRD twin left out", () => {
  const lists = buildLists(src, program, catalog);
  assertEqual("core", lists["eas-core"], ["BEE-4710", "EAS-3030", "EAS-3050", "EAS-3410", "EAS-3450", "EAS-4710", "NTRES-3030"]);
});

check("concentration: union of the lists with twins, unoffered ids kept", () => {
  const lists = buildLists(src, program, catalog);
  assertEqual("concentration", lists["eas-concentration"], ["BEE-4800", "EAS-3030", "EAS-4800", "NTRES-3030", "SEA-3665"]);
});

check("field and biology lists as named", () => {
  const lists = buildLists(src, program, catalog);
  assertEqual("field", lists["eas-field-course"], ["EAS-2500", "EAS-4370"]);
  assertEqual("biology", lists["eas-biology"], ["BIOEE-1610", "BIOG-1140", "BIOG-1445"]);
});

check("advisor course: science subjects 1100+, 3+ credits, no exceptions, no teaching or research credit", () => {
  const lists = buildLists(src, program, catalog);
  assertEqual("advisor", lists["eas-advisor-course"], [
    "BIOMI-2900",
    "CS-1710",
    "EAS-3030",
    "EAS-3050",
    "EAS-4710",
    "EAS-5030",
    "MATH-2210",
  ]);
});

console.log(`\n── eas-electives corpus — ${checks.length} case(s) ──`);
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
