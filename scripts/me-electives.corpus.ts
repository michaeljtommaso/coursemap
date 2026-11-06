// scripts/me-electives.corpus.ts
// Asserted, offline corpus runner for build-me-electives.ts (spec 025): the
// technical rule's subject and level cuts, the named 1000-level biology, the
// title exclusions, and the named lists (exceptions, required courses left
// out). No network. Exits nonzero on any mismatch.
//
// Run: npx tsx me-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, technicalByRule, GROUP_MAJOR, GROUP_MATH, GROUP_TECH, type Source } from "./build-me-electives";
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
  majorApproved: {
    areas: { A: ["MAE-3050", "MAE-4160", "MAE-4161", "MAE-4610"], B: ["MAE-4480", "BME-4490", "MAE-3050"] },
    except: ["MAE-4610", "MAE-4291"],
  },
  math: ["ENGRD-2700", "CS-2800", "MAE-9999"],
  technical: {
    engineeringSubjects: ["MAE", "ORIE", "ENGRG"],
    engineeringFrom: 2000,
    mathAbove: 2940,
    physicsAbove: 2214,
    chemistry: { exactly: [2080], above: 2090 },
    biologyPrefix: "BIO",
    biologyFrom: 2000,
    plus: ["BIOG-1440"],
    except: ["MAE-4980"],
    excludeTitlePattern: "\\beconomic|entrepreneur|teach|accounting|leadership|financ",
  },
};

const course = (id: string, title = "A technical course"): CatalogCourse & { title: string } => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title };
};
const catalog = new Map(
  [
    course("MAE-2250"),
    course("MAE-1100"),
    course("MAE-4980"),
    course("ORIE-3150", "Financial and Managerial Accounting"),
    course("ORIE-4580"),
    course("ENGRG-3400", "Engineering Project Team"),
    course("ENGRG-4980", "Undergraduate Teaching in Engineering"),
    course("MATH-2940"),
    course("MATH-3110"),
    course("PHYS-2214"),
    course("PHYS-3316"),
    course("CHEM-2080"),
    course("CHEM-2090"),
    course("CHEM-3570"),
    course("BIOMG-3300"),
    course("BIOMG-1350"),
    course("BEE-4620", "Water Quality and Management"),
    course("HIST-3000"),
  ].map((c) => [c.id, c] as const)
);

check("technical rule: subjects and level cuts", () => {
  const t = src.technical;
  const r = (id: string) => technicalByRule(catalog.get(id)!, t);
  assertEqual("MAE 2250 (engineering 2000+)", r("MAE-2250"), true);
  assertEqual("MAE 1100", r("MAE-1100"), false);
  assertEqual("MATH 2940 is not beyond 2940", r("MATH-2940"), false);
  assertEqual("MATH 3110", r("MATH-3110"), true);
  assertEqual("PHYS 2214 is not beyond 2214", r("PHYS-2214"), false);
  assertEqual("PHYS 3316", r("PHYS-3316"), true);
  assertEqual("CHEM 2080 (named)", r("CHEM-2080"), true);
  assertEqual("CHEM 2090 is not beyond 2090", r("CHEM-2090"), false);
  assertEqual("CHEM 3570", r("CHEM-3570"), true);
  assertEqual("BIOMG 3300", r("BIOMG-3300"), true);
  assertEqual("BIOMG 1350 by rule", r("BIOMG-1350"), false);
  assertEqual("BEE (not in this corpus's engineering list)", r("BEE-4620"), false);
  assertEqual("HIST", r("HIST-3000"), false);
});

check("technical list: exceptions, title filter, plus, required left out", () => {
  const lists = buildLists(src, catalog, new Set(["MAE-2250"]));
  assertEqual("tech", lists[GROUP_TECH], [
    "BIOG-1440",
    "BIOMG-3300",
    "CHEM-2080",
    "CHEM-3570",
    "ENGRG-3400",
    "MATH-3110",
    "ORIE-4580",
    "PHYS-3316",
  ]);
});

check("named lists: union of areas, exceptions out, missing ids kept", () => {
  const lists = buildLists(src, catalog, new Set(["MAE-2250"]));
  assertEqual("major", lists[GROUP_MAJOR], ["BME-4490", "MAE-3050", "MAE-4160", "MAE-4161", "MAE-4480"]);
  assertEqual("math", lists[GROUP_MATH], ["CS-2800", "ENGRD-2700", "MAE-9999"]);
});

console.log(`\n── me-electives corpus — ${checks.length} case(s) ──`);
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
