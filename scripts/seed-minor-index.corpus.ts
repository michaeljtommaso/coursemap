// scripts/seed-minor-index.corpus.ts
// Asserted, offline corpus for seed-minor-index.ts (spec 047 D12): the index
// builder and the backend choice. NO Firestore: nothing here initialises the
// Admin SDK. Exits nonzero on any mismatch.
//
// Run: npx tsx seed-minor-index.corpus.ts   (from the scripts/ folder)

import { readFileSync } from "fs";
import { buildMinorIndex, chooseBackend, metaProblems, type MinorIndexMeta } from "./seed-minor-index";
import { MINOR_INDEX_ENTRIES, type Layer } from "./layer-authoring";

type Check = { name: string; fn: () => void };
const checks: Check[] = [];
let failures = 0;
function check(name: string, fn: () => void) {
  checks.push({ name, fn });
}
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}
function assertTrue(name: string, cond: boolean, detail: string) {
  if (!cond) fail(name, detail);
}

const SRC = { url: "https://catalog.cornell.edu/programs/invented-minor/", anchor: "Requirements" };
const minor = (id: string, over: Partial<Layer> = {}): Layer =>
  ({ id, kind: "minor", family: "other", name: `Invented ${id}`, catalogYear: "2031-32", programId: id, rows: [{ id: "c", kind: "confirm", label: "Confirm", group: "G", source: SRC }], ...over }) as Layer;
const META: Record<string, MinorIndexMeta> = {
  "invented-b-minor-2031": { shortName: "B minor", offeredBy: "Invented College", notOpenTo: ["invented-b-ba"] },
  "invented-a-minor-2031": { shortName: "A minor", offeredBy: "Invented College", name: "Invented A (Minor)", visible: false },
};

check("builds sorted entries from promoted minors and the hand-kept file", () => {
  const r = buildMinorIndex([minor("invented-b-minor-2031"), minor("invented-a-minor-2031")], META);
  assertEqual("errors", r.errors, []);
  assertEqual("warnings", r.warnings, []);
  assertEqual("entries", r.entries, [
    { id: "invented-a-minor-2031", name: "Invented A (Minor)", shortName: "A minor", offeredBy: "Invented College", catalogYear: "2031-32", visible: false },
    { id: "invented-b-minor-2031", name: "Invented invented-b-minor-2031", shortName: "B minor", offeredBy: "Invented College", catalogYear: "2031-32", notOpenTo: ["invented-b-ba"] },
  ]);
});
check("a promoted minor without an entry is an error; an entry ahead of its layer a warning; a major is refused", () => {
  const r = buildMinorIndex([minor("invented-c-minor-2031")], META);
  assertTrue("no entry", r.errors.some((e) => /has no entry/.test(e)), JSON.stringify(r.errors));
  assertEqual("two entries skipped", r.warnings.length, 2);
  const major = buildMinorIndex([minor("invented-a-minor-2031", { kind: "major" })], META);
  assertTrue("major", major.errors.some((e) => /not a minor/.test(e)), JSON.stringify(major.errors));
  const twice = buildMinorIndex([minor("invented-a-minor-2031"), minor("invented-a-minor-2031")], META);
  assertTrue("twice", twice.errors.some((e) => /twice/.test(e)), JSON.stringify(twice.errors));
});
check("the hand-kept file: required fields, unknown keys, bad prefixes; the schema catches a bad catalog year", () => {
  const bad = metaProblems({ "Bad Id": { shortName: "", offeredBy: "x", extra: 1, notOpenTo: ["Not A Prefix"], visible: "yes" } });
  assertEqual("problems", bad.length, 5);
  const year = buildMinorIndex([minor("invented-a-minor-2031", { catalogYear: "2031" })], { "invented-a-minor-2031": META["invented-a-minor-2031"] });
  assertTrue("schema", year.errors.some((e) => /MinorIndexSchema/.test(e)), JSON.stringify(year.errors));
  assertEqual("the repo's minor-index.json is well formed", metaProblems(JSON.parse(readFileSync(MINOR_INDEX_ENTRIES, "utf-8"))), []);
});
check("backend: offline by default, emulator by env, live only with --live and credentials", () => {
  const env = (emulatorHost: string | null, credentials: boolean) => ({ emulatorHost, credentials });
  assertEqual("dry, nothing set", chooseBackend({ apply: false, live: false }, env(null, true)).kind, "offline");
  assertEqual("credentials alone never go live", chooseBackend({ apply: true, live: false }, env(null, true)).kind, "refused");
  assertEqual("emulator", chooseBackend({ apply: true, live: false }, env("127.0.0.1:8080", false)).kind, "emulator");
  assertEqual("live needs credentials", chooseBackend({ apply: true, live: true }, env(null, false)).kind, "refused");
  assertEqual("live", chooseBackend({ apply: true, live: true }, env(null, true)).kind, "live");
  assertEqual("live and emulator are exclusive", chooseBackend({ apply: true, live: true }, env("127.0.0.1:8080", true)).kind, "refused");
});

console.log(`\n── seed-minor-index corpus — ${checks.length} case(s) ──`);
let failedCases = 0;
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
  else failedCases++;
}
console.log(`\n${checks.length - failedCases}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
