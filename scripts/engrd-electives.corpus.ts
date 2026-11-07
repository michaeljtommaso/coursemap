// scripts/engrd-electives.corpus.ts
// Asserted, offline corpus runner for build-engrd-electives.ts (spec 040): the
// category exclusions, substitutes, same-number twins, required courses and their
// twins left out, a program's other list joined in, and the engineering 3000+
// rule without liberal studies courses. Exits nonzero on any mismatch.
//
// Run: npx tsx engrd-electives.corpus.ts   (from the scripts/ folder)

import { buildLists, type Course, type LiberalStudiesData, type Major, type Source } from "./build-engrd-electives";

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
  categories: [
    { name: "Scientific Computing", ids: ["ENGRD-2110", "ENGRD-3200"] },
    { name: "Mechanics", ids: ["ENGRD-2020"] },
    { name: "Thermodynamics", ids: ["ENGRD-2210"] },
    { name: "Earth and Life Sciences", ids: ["ENGRD-2250", "ENGRD-2510", "ENGRD-2520"] },
  ],
  substitutes: { "MATH-4710": { category: "Probability and Statistics", majors: "Engineering Physics" } },
};

const course = (id: string, title: string, credits = 3, attrs: string[] = []): Course => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMax: credits, attrs: attrs.map((value) => ({ value })) };
};
const catalog: Course[] = [
  course("ENGRD-2110", "Object-Oriented Programming", 4),
  course("CS-2110", "Object-Oriented Programming", 4),
  course("ENGRD-3200", "Engineering Computation", 4),
  course("ENGRD-2020", "Statics and Mechanics of Solids", 4),
  course("MAE-2020", "Statics and Mechanics of Solids", 4),
  course("ENGRD-2210", "Thermodynamics"),
  course("MAE-2210", "Thermodynamics"),
  course("ENGRD-2250", "The Earth System", 4),
  course("EAS-2250", "The Earth System", 4),
  course("ENGRD-2510", "Engineering Processes"),
  course("BEE-2510", "Engineering Processes"),
  course("MATH-4710", "Basic Probability", 4),
  course("CEE-3310", "Fluid Mechanics", 4),
  course("CEE-3080", "Infrastructure and Society", 3, ["SBA-EN"]),
  course("CEE-3090", "Petitioned Course"),
  course("CEE-3990", "Undergraduate Teaching", 3),
  course("CEE-4000", "One-Credit Seminar", 1),
  course("CEE-2550", "Lower-Level Course"),
  course("PHYS-3310", "Physics Course", 4),
];
const ls: LiberalStudiesData = {
  cohorts: [{ groups: [{ bases: ["SBA"], exact: [] }] }],
  petitions: { "CEE-3090": [] },
};
const program = (id: string, requiredIds: string[], lists: Record<string, string[]> = {}) => ({
  id,
  slots: requiredIds.map((courseId) => ({ kind: "course", courseId })),
  electiveGroups: Object.entries(lists).map(([gid, courseIds]) => ({ id: gid, courseIds })),
});

check("a covered category is left out with its twins; substitutes join", () => {
  const majors: Major[] = [{ program: "ep", groups: ["ep-engrd"], excludeCategories: ["Mechanics"], substitutes: ["MATH-4710"] }];
  const lists = buildLists(src, majors, { ep: program("ep", ["AEP-3330"]) }, catalog, ls);
  assertEqual("ep", lists.ep["ep-engrd"], [
    "BEE-2510",
    "CS-2110",
    "EAS-2250",
    "ENGRD-2110",
    "ENGRD-2210",
    "ENGRD-2250",
    "ENGRD-2510",
    "ENGRD-2520",
    "ENGRD-3200",
    "MAE-2210",
    "MATH-4710",
  ]);
});

check("required courses and their cross-listings are left out; both seats share the list", () => {
  const majors: Major[] = [{ program: "eas", groups: ["eas-engrd", "eas-engrd-second"] }];
  const lists = buildLists(src, majors, { eas: program("eas", ["EAS-2250"]) }, catalog, ls);
  const expected = ["BEE-2510", "CS-2110", "ENGRD-2020", "ENGRD-2110", "ENGRD-2210", "ENGRD-2510", "ENGRD-2520", "ENGRD-3200", "MAE-2020", "MAE-2210"];
  assertEqual("first", lists.eas["eas-engrd"], expected);
  assertEqual("second", lists.eas["eas-engrd-second"], expected);
});

check("another list of the program joins the seat", () => {
  const majors: Major[] = [{ program: "ce", groups: ["ce-engrd"], excludeCategories: ["Mechanics"], plusGroups: ["ce-major"] }];
  const p = program("ce", ["ENGRD-2020", "ENGRD-3200", "BEE-2510"], { "ce-major": ["CEE-3310", "ENGRD-3200"] });
  const lists = buildLists(src, majors, { ce: p }, catalog, ls);
  assertEqual("ce", lists.ce["ce-engrd"], ["CEE-3310", "CS-2110", "EAS-2250", "ENGRD-2110", "ENGRD-2210", "ENGRD-2250", "ENGRD-2520", "MAE-2210"]);
});

check("engineering 3000+: 3+ credits, no liberal studies tag or petition, no teaching", () => {
  const majors: Major[] = [
    {
      program: "enve",
      groups: ["enve-engrd"],
      plusEngineering: { subjects: ["CEE", "ENGRD"], from: 3000, minCredits: 3, excludeTitlePattern: "teach" },
    },
  ];
  const lists = buildLists(src, majors, { enve: program("enve", ["BEE-2510", "ENGRD-3200"]) }, catalog, ls);
  assertEqual("enve", lists.enve["enve-engrd"], [
    "CEE-3310",
    "CS-2110",
    "EAS-2250",
    "ENGRD-2020",
    "ENGRD-2110",
    "ENGRD-2210",
    "ENGRD-2250",
    "ENGRD-2520",
    "MAE-2020",
    "MAE-2210",
  ]);
});

check("an unknown category or substitute fails loudly", () => {
  let threw = 0;
  for (const m of [
    { program: "x", groups: ["g"], excludeCategories: ["Mechanic"] },
    { program: "x", groups: ["g"], substitutes: ["MATH-9999"] },
  ] as Major[]) {
    try {
      buildLists(src, [m], { x: program("x", []) }, catalog, ls);
    } catch {
      threw++;
    }
  }
  assertEqual("threw", threw, 2);
});

console.log(`\n── engrd-electives corpus — ${checks.length} case(s) ──`);
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
