// scripts/isst-electives.corpus.ts
// Asserted, offline corpus runner for build-isst-electives.ts (spec 033): the
// primary-concentration union, the all-concentration union, the major-approved
// additions and exclusions, CS 4152 left out everywhere, and required courses
// left out. Exits nonzero on any mismatch.
//
// Run: npx tsx isst-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Source } from "./build-isst-electives";

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
  program: "cornell-isst-bs-2025",
  mlDataScience: ["CS-3780", "ORIE-4740"],
  concentrations: {
    "Data Science": ["INFO-3300", "CS-3780", "INFO-4940"],
    "Interactive Technologies": ["INFO-4152", "CS-4152", "INFO-3300"],
    "Behavioral Science": ["INFO-4430", "COMM-4940"],
  },
  primary: ["Data Science", "Interactive Technologies"],
  majorApprovedPlus: ["INFO-2300", "INFO-2310"],
  majorApprovedExclude: ["INFO-4910", "INFO-4998", "INFO-4430"],
  excludeEverywhere: ["CS-4152"],
  fourthMathOrPhys: ["PHYS-2214", "MATH-2930", "MATH-3040"],
};

check("primary union, all union, CS 4152 out", () => {
  const lists = buildLists(src, { slots: [] });
  assertEqual("conc 1", lists["isst-concentration-1"], ["CS-3780", "INFO-3300", "INFO-4152", "INFO-4940"]);
  assertEqual("conc 2", lists["isst-concentration-2"], ["COMM-4940", "CS-3780", "INFO-3300", "INFO-4152", "INFO-4430", "INFO-4940"]);
});

check("major-approved: all + INFO 2300 / 2310, exclusions dropped", () => {
  const lists = buildLists(src, { slots: [] });
  assertEqual("major", lists["isst-major-approved"], [
    "COMM-4940",
    "CS-3780",
    "INFO-2300",
    "INFO-2310",
    "INFO-3300",
    "INFO-4152",
    "INFO-4940",
  ]);
});

check("named lists pass through; required courses left out", () => {
  const lists = buildLists(src, { slots: [{ kind: "course", courseId: "INFO-3300" }] });
  assertEqual("ml", lists["isst-ml-data-science"], ["CS-3780", "ORIE-4740"]);
  assertEqual("math/phys", lists["isst-cs2800-math2930-math3040"], ["MATH-2930", "MATH-3040", "PHYS-2214"]);
  assertEqual("conc 1", lists["isst-concentration-1"], ["CS-3780", "INFO-4152", "INFO-4940"]);
});

check("an unknown primary concentration name is an error", () => {
  let threw = false;
  try {
    buildLists({ ...src, primary: ["Nope"] }, { slots: [] });
  } catch {
    threw = true;
  }
  assertEqual("threw", threw, true);
});

console.log(`\n── isst-electives corpus — ${checks.length} case(s) ──`);
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
