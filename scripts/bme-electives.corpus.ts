// scripts/bme-electives.corpus.ts
// Asserted, offline corpus runner for build-bme-electives.ts (spec 034): the
// concentration union, cornerstones kept out of the elective pool, and required
// courses left out. Exits nonzero on any mismatch.
//
// Run: npx tsx bme-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Source } from "./build-bme-electives";

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
  program: "cornell-bme-bs-2025",
  concentrations: {
    BMDD: ["BEE-3400", "MSE-4020", "BME-5830"],
    MCSE: ["BME-5830", "CHEME-5430", "BME-3210"],
  },
  cornerstones: ["BME-3110", "BME-3210", "BME-3310", "BME-3410"],
};

check("union of the concentrations, cornerstones out of the pool", () => {
  const lists = buildLists(src, { slots: [] });
  assertEqual("electives", lists["bme-concentration-elective"], ["BEE-3400", "BME-5830", "CHEME-5430", "MSE-4020"]);
  assertEqual("cornerstones", lists["bme-cornerstone"], ["BME-3110", "BME-3210", "BME-3310", "BME-3410"]);
});

check("required courses left out", () => {
  const lists = buildLists(src, { slots: [{ kind: "course", courseId: "MSE-4020" }] });
  assertEqual("electives", lists["bme-concentration-elective"], ["BEE-3400", "BME-5830", "CHEME-5430"]);
});

console.log(`\n── bme-electives corpus — ${checks.length} case(s) ──`);
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
