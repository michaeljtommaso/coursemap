// scripts/cs-electives.corpus.ts
// Asserted, offline corpus runner for build-cs-electives.ts (spec 024): what
// makes a technical elective (named qualifier, ENGRD subject, corequisite,
// advisory node, text rule, recommended-only text, transitive chain, cycle),
// the credit and level cuts, the CS rules, and required courses left out.
// No network. Exits nonzero on any mismatch.
//
// Run: npx tsx cs-electives.corpus.ts   (from the scripts/ folder)

import {
  buildLists,
  makeQualifies,
  GROUP_CS,
  GROUP_ENGRD,
  GROUP_PRACTICUM,
  GROUP_TECH,
  GROUP_TECH_2000,
  type Source,
} from "./build-cs-electives";
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

const req = (id: string) => ({ type: "course", id });
const or = (...children: unknown[]) => ({ type: "or", children });
function course(id: string, opts: Partial<CatalogCourse> = {}): CatalogCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, creditsMin: 3, creditsMax: 3, ...opts };
}

const src: Source = {
  csElectives: { subject: "CS", min: 4000, except: [4090, 4997, 4998, 4999], plus: ["CS-3700", "CS-3780"] },
  practicum: ["CS-4411", "CS-5150", "CS-9999"],
  technical: {
    minCredits: 3,
    csAlwaysFrom: 3000,
    csExcept: [4090, 4997, 4998],
    qualifyingCourses: ["MATH-1920", "CS-2110"],
    qualifyingSubjects: ["ENGRD"],
    textPattern: "probability|statistics|college-level biology",
  },
  engrd: { ids: ["ENGRD-2700", "CHEM-3890"] },
};

const catalog = new Map(
  [
    course("MATH-1920"),
    course("CS-2110"),
    course("CS-3110", { prereqExpr: req("CS-2110") }),
    course("CS-3700"),
    course("CS-4090"),
    course("CS-4820", { prereqExpr: req("CS-3110") }),
    course("CS-4999", { creditsMin: 1, creditsMax: 4 }),
    course("CS-4998", { creditsMax: 4 }),
    course("CS-4411", { creditsMin: 2, creditsMax: 2 }),
    course("CS-3999", { creditsMin: 1, creditsMax: 1 }),
    course("ENGRD-2700"),
    course("MATH-4710", { prereqExpr: { type: "advisory", expr: req("MATH-1920"), note: "or equivalent" } }),
    course("MATH-4130", { prereqExpr: or(req("MATH-4710"), req("HIST-1000")) }),
    course("ECE-3100", { prereqExpr: req("ENGRD-2700") }),
    course("PHYS-3360", { coreqExpr: req("MATH-1920") }),
    course("ECON-3140", { prereqText: "Introductory statistics." }),
    course("SOC-3010", { prereqText: "Statistics recommended." }),
    course("BIOMG-4000", { prereqText: "College-level biology." }),
    course("HIST-1000"),
    course("HIST-3000", { prereqExpr: req("HIST-1000") }),
    course("MATH-2930", { prereqExpr: req("MATH-1920") }),
    course("MATH-1940", { prereqExpr: req("MATH-1920") }),
    course("LOOP-3100", { prereqExpr: req("LOOP-3200") }),
    course("LOOP-3200", { prereqExpr: req("LOOP-3100") }),
    course("ORIE-3500", { prereqExpr: req("MATH-1920"), creditsMax: 2 }),
  ].map((c) => [c.id, c] as const)
);

check("named, ENGRD-subject, corequisite and advisory qualifiers", () => {
  const q = makeQualifies(catalog, src.technical);
  assertEqual("advisory MATH 1920", q("MATH-4710"), true);
  assertEqual("ENGRD prerequisite", q("ECE-3100"), true);
  assertEqual("corequisite", q("PHYS-3360"), true);
  assertEqual("no qualifier", q("HIST-3000"), false);
});

check("text rule, recommended text ignored", () => {
  const q = makeQualifies(catalog, src.technical);
  assertEqual("statistics", q("ECON-3140"), true);
  assertEqual("college-level biology", q("BIOMG-4000"), true);
  assertEqual("statistics recommended only", q("SOC-3010"), false);
});

check("chain is transitive; a cycle never qualifies itself", () => {
  const q = makeQualifies(catalog, src.technical);
  assertEqual("MATH 4130 via MATH 4710 via MATH 1920", q("MATH-4130"), true);
  assertEqual("CS 4820 via CS 3110 via CS 2110", q("CS-4820"), true);
  assertEqual("cycle", q("LOOP-3100"), false);
});

check("technical lists: levels, credits, CS rules, required left out", () => {
  const lists = buildLists(src, catalog, new Set(["CS-4820"]));
  const t3 = lists[GROUP_TECH];
  const t2 = lists[GROUP_TECH_2000];
  assertEqual("3000+ list", t3, [
    "BIOMG-4000",
    "CS-3110",
    "CS-3700",
    "CS-4999",
    "ECE-3100",
    "ECON-3140",
    "MATH-4130",
    "MATH-4710",
    "PHYS-3360",
  ]);
  assertEqual("2000+ list adds the 2000-level qualifier only", t2.filter((id) => !t3.includes(id)), ["MATH-2930"]);
  assertEqual("1000-level never", t2.includes("MATH-1940"), false);
  assertEqual("2-credit course out", t2.includes("ORIE-3500"), false);
  assertEqual("1-credit CS course out", t2.includes("CS-3999"), false);
  assertEqual("CS 4090 / 4998 out", [t2.includes("CS-4090"), t2.includes("CS-4998")], [false, false]);
  assertEqual("ENGRD course itself needs a qualifier", t2.includes("ENGRD-2700"), false);
});

check("CS electives, practicum and ENGRD lists", () => {
  const lists = buildLists(src, catalog, new Set(["CS-4820"]));
  assertEqual("CS 4000+ (3+ credits) minus exceptions, plus 3700/3780, minus required", lists[GROUP_CS], [
    "CS-3700",
    "CS-3780",
  ]);
  assertEqual("practicum kept as named (missing ids too)", lists[GROUP_PRACTICUM], ["CS-4411", "CS-5150", "CS-9999"]);
  assertEqual("ENGRD named", lists[GROUP_ENGRD], ["CHEM-3890", "ENGRD-2700"]);
});

console.log(`\n── cs-electives corpus — ${checks.length} case(s) ──`);
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
