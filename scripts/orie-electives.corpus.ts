// scripts/orie-electives.corpus.ts
// Asserted, offline corpus runner for build-orie-electives.ts: rule expansion
// (subject ranges with exceptions, transitive "with X as a prerequisite"),
// list building (categories, outside-ORIE, required courses left out) and the
// text splice into programs.json. No network. Exits nonzero on any mismatch.
//
// Run: npx tsx orie-electives.corpus.ts   (from the scripts/ folder)

import {
  buildLists,
  expandRule,
  makeReaches,
  spliceCourseIds,
  GROUP_A,
  GROUP_ORIE,
  GROUP_OUTSIDE,
  type CatalogCourse,
  type Source,
} from "./build-orie-electives";

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
const and = (...children: unknown[]) => ({ type: "and", children });
const or = (...children: unknown[]) => ({ type: "or", children });
function course(id: string, prereqExpr: unknown = null): CatalogCourse {
  const [subject, number] = id.split("-");
  return { id, subject, number, prereqExpr };
}
const catalog = new Map(
  [
    course("CS-2110"),
    course("CS-3110", req("CS-2110")),
    course("CS-4820", and(req("CS-3110"), req("CS-2800"))),
    course("CS-2800"),
    course("CS-4999", { type: "advisory", expr: req("CS-2110") }),
    course("CS-1110"),
    course("MATH-2940"),
    course("MATH-3110"),
    course("MATH-4710"),
    course("MATH-4130", or(req("MATH-3110"), req("MATH-2940"))),
    course("ORIE-3150"),
    course("ORIE-3741"),
    course("ORIE-4580"),
    course("ORIE-4152"),
    course("ORIE-4741"),
    course("ORIE-5920"),
    course("ENGRD-2700"),
    course("ENGRD-2110"),
    course("AEM-4060"),
    course("PHYS-3316", req("PHYS-2214")),
    course("PHYS-2214"),
    // A prerequisite cycle must not hang or count.
    course("CHEM-9001", req("CHEM-9002")),
    course("CHEM-9002", req("CHEM-9001")),
  ].map((c) => [c.id, c])
);

check("subject rule: minimum and exceptions", () => {
  const reaches = makeReaches(catalog);
  assertEqual(
    "MATH 3000+ except 4710",
    expandRule({ kind: "subject", subject: "MATH", min: 3000, except: [4710] }, catalog, reaches).sort(),
    ["MATH-3110", "MATH-4130"]
  );
  assertEqual(
    "ENGRD except 2700",
    expandRule({ kind: "subject", subject: "ENGRD", except: [2700] }, catalog, reaches),
    ["ENGRD-2110"]
  );
});

check("needsPrereq: direct, transitive, advisory; not the prereq itself", () => {
  const reaches = makeReaches(catalog);
  assertEqual(
    "CS needing CS 2110",
    expandRule({ kind: "needsPrereq", subject: "CS", prereqs: ["CS-2110"] }, catalog, reaches).sort(),
    ["CS-3110", "CS-4820", "CS-4999"]
  );
  assertEqual(
    "cycle neither hangs nor counts",
    expandRule({ kind: "needsPrereq", subject: "CHEM", prereqs: ["CHEM-2080"] }, catalog, reaches),
    []
  );
});

check("subject rule `plus` adds named extras", () => {
  const reaches = makeReaches(catalog);
  assertEqual(
    "ORIE 4000+ minus 4152, plus 3741",
    expandRule({ kind: "subject", subject: "ORIE", min: 4000, except: [4152, 5920], plus: ["ORIE-3741"] }, catalog, reaches).sort(),
    ["ORIE-3741", "ORIE-4580", "ORIE-4741"]
  );
});

check("buildLists: categories, outside-ORIE, required courses left out", () => {
  const src: Source = {
    named: [
      { category: "A", text: "CS 2800", ids: ["CS-2800"] },
      { category: "A", text: "CS 5722", ids: ["CS-5722"] }, // not in the catalog: kept
      { category: "B", text: "AEM 4060", ids: ["AEM-4060"] },
      { category: "B", text: "ORIE 4152/ENGRG 4610", ids: ["ORIE-4152", "ENGRG-4610"] },
    ],
    rules: [
      { category: "A", kind: "subject", subject: "ORIE", min: 3000, except: [4152, 5920] },
      { category: "A", kind: "needsPrereq", subject: "PHYS", prereqs: ["PHYS-2214"] },
    ],
    orieElectivesRule: { kind: "subject", subject: "ORIE", min: 4000, except: [4152, 5920], plus: ["ORIE-3741"] },
  };
  const lists = buildLists(src, catalog, new Set(["ORIE-4580", "ORIE-3150"]));
  assertEqual("Category A", lists[GROUP_A], ["CS-2800", "CS-5722", "ORIE-3741", "ORIE-4741", "PHYS-3316"]);
  assertEqual("outside ORIE (A or B; twin of an ORIE course stays out)", lists[GROUP_OUTSIDE], [
    "AEM-4060",
    "CS-2800",
    "CS-5722",
    "PHYS-3316",
  ]);
  assertEqual("ORIE electives (required 4580 out)", lists[GROUP_ORIE], ["ORIE-3741", "ORIE-4741"]);
});

check("spliceCourseIds: replaces only that group's array, keeps line endings", () => {
  const text = [
    "[",
    "  {",
    '    "id": "other-prog",',
    '    "electiveGroups": [{ "id": "g1", "courseIds": ["X-1"] }]',
    "  },",
    "  {",
    '    "id": "cornell-ore-bs-2026",',
    '    "electiveGroups": [',
    "      {",
    '        "id": "g1",',
    '        "courseIds": []',
    "      },",
    "      {",
    '        "id": "g2",',
    '        "courseIds": ["OLD-1"]',
    "      }",
    "    ]",
    "  }",
    "]",
  ].join("\r\n");
  const out = spliceCourseIds(text, "cornell-ore-bs-2026", "g2", ["A-1", "B-2"]);
  assertEqual("other program untouched", out.includes('"courseIds": ["X-1"]'), true);
  assertEqual("g1 untouched", out.includes('"id": "g1",\r\n        "courseIds": []'), true);
  assertEqual(
    "g2 rewritten, CRLF, indented",
    out.includes('"courseIds": [\r\n          "A-1",\r\n          "B-2"\r\n        ]'),
    true
  );
  assertEqual("still valid JSON", JSON.parse(out)[1].electiveGroups[1].courseIds, ["A-1", "B-2"]);
  let threw = false;
  try {
    spliceCourseIds(text, "cornell-ore-bs-2026", "missing", []);
  } catch {
    threw = true;
  }
  assertEqual("unknown group throws", threw, true);
});

console.log(`\n── orie-electives corpus — ${checks.length} case(s) ──`);
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
