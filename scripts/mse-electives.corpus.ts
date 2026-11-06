// scripts/mse-electives.corpus.ts
// Asserted, offline corpus runner for build-mse-electives.ts (spec 029): the
// outside-MSE subject, level, id and title cuts; the application list as the
// union of the categories plus the Materials Electives; the ENGRD lists; and
// required courses left out. No network. Exits nonzero on any mismatch.
//
// Run: npx tsx mse-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Course, type Source } from "./build-mse-electives";

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
  program: "cornell-mse-bs-2025",
  materials: ["MSE-4100", "MSE-5550"],
  application: {
    Nanotechnology: ["MSE-5410", "ECE-4360", "MSE-9999"],
    "Information Science and Technology": ["ECE-4360", "MSE-5410", "ECE-3150"],
  },
  outside: {
    subjects: ["CS", "PHYS", "ENGRD"],
    from: 2000,
    minCredits: 3,
    excludeIds: ["ENGRD-2610", "ENGRD-2620"],
    excludeTitlePattern: "teach|leadership",
  },
  engrdMaterials: { ids: ["ENGRD-2610", "ENGRD-2620", "MSE-2610", "MSE-2620"] },
  engrdSecond: { ids: ["ENGRD-2020", "ENGRD-2700", "CHEM-3890"] },
  choice3050or4020: ["MSE-3050", "MSE-4020"],
};

const course = (id: string, title = "A technical course", creditsMax = 3): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMax };
};
const catalog = [
  course("CS-1110"),
  course("CS-2110"),
  course("CS-4090", "Teaching Experience in Computer Science"),
  course("PHYS-4454"),
  course("PHYS-7690", "Seminar in Physics", 1),
  course("ENGRD-2610"),
  course("ENGRD-2020"),
  course("MSE-4100"),
  course("MATH-3110"),
  course("ENGRG-3900", "Foundations of Engineering Leadership"),
];
const program = (required: string[]) => ({
  slots: required.map((courseId) => ({ kind: "course", courseId })),
});

check("outside: subject, level, credits, excluded ids and titles", () => {
  const lists = buildLists(src, program([]), catalog);
  assertEqual("outside", lists["mse-outside-tech"], ["CS-2110", "ENGRD-2020", "PHYS-4454"]);
});

check("application: categories + materials, de-duplicated, missing ids kept", () => {
  const lists = buildLists(src, program([]), catalog);
  assertEqual("application", lists["mse-engineering-elective"], [
    "ECE-3150",
    "ECE-4360",
    "MSE-4100",
    "MSE-5410",
    "MSE-5550",
    "MSE-9999",
  ]);
  assertEqual("materials", lists["mse-materials-elective"], ["MSE-4100", "MSE-5550"]);
});

check("named lists pass through; required courses left out everywhere", () => {
  const lists = buildLists(src, program(["MSE-4100", "CS-2110", "ENGRD-2020"]), catalog);
  assertEqual("materials", lists["mse-materials-elective"], ["MSE-5550"]);
  assertEqual("outside", lists["mse-outside-tech"], ["PHYS-4454"]);
  assertEqual("engrd second", lists["mse-engrd-second"], ["CHEM-3890", "ENGRD-2700"]);
  assertEqual("engr dist", lists["mse-engr-dist"], ["ENGRD-2610", "ENGRD-2620", "MSE-2610", "MSE-2620"]);
  assertEqual("3050/4020", lists["mse-3050-4020"], ["MSE-3050", "MSE-4020"]);
});

console.log(`\n── mse-electives corpus — ${checks.length} case(s) ──`);
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
