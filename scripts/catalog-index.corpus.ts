// scripts/catalog-index.corpus.ts
// Asserted, offline corpus for the catalogIndex builder's guards (2026-11-08:
// one course with a null title made the app reject the whole index, and course
// search went down until the index was restored). Exits nonzero on any mismatch.
//
// Run: npx tsx catalog-index.corpus.ts   (from the scripts/ folder)

import { assertIndexReadable, buildIndexRecords } from "./catalog-index";

let failures = 0;
const checks: { name: string; fn: () => void }[] = [];
const check = (name: string, fn: () => void) => checks.push({ name, fn });
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}

const course = (id: string, title: unknown) => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMin: 3, creditsMax: 3, offered: ["FA"], roster: "FA25" };
};

check("a course with no title is indexed under its code", () => {
  const records = buildIndexRecords([course("PLSCI-4960", null), course("CS-2110", "Object-Oriented Programming")]);
  const t = Object.fromEntries(records.map((r) => [r.id, r.title]));
  if (t["PLSCI-4960"] !== "PLSCI 4960") fail("null title", `got ${JSON.stringify(t["PLSCI-4960"])}`);
  if (t["CS-2110"] !== "Object-Oriented Programming") fail("real title kept", `got ${JSON.stringify(t["CS-2110"])}`);
  assertIndexReadable(records); // must not throw
});

check("an index the app can't read is refused before any write", () => {
  const records = buildIndexRecords([course("CS-2110", "Object-Oriented Programming")]);
  const broken = [{ ...records[0], title: null as unknown as string }];
  try {
    assertIndexReadable(broken);
    fail("broken record", "assertIndexReadable did not throw");
  } catch (e) {
    if (!String(e).includes("CS-2110")) fail("names the record", String(e));
  }
});

console.log(`\n── catalog-index corpus — ${checks.length} case(s) ──`);
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
