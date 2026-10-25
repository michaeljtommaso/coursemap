// scripts/validate-layers.corpus.ts
// Asserted, offline corpus runner for validate-layers.ts (spec 019 D4/D13). NO
// network calls: the catalog and the layers are hand-built objects below, same
// convention as scripts/validate-programs.corpus.ts. Exits nonzero on any
// mismatch.
//
// Run: npx tsx validate-layers.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCatalog,
  collectLayerFiles,
  courseMatchesRule,
  leafValues,
  loadCatalogDump,
  parseCatalogDump,
  readLayerFile,
  validateLayer,
  type CatalogCourse,
  type LayerFile,
  type LayerRow,
} from "./validate-layers";

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

// ── Fixture catalog ─────────────────────────────────────────────────────────
const course = (id: string, credits: number, tags: string[] = [], over: Partial<CatalogCourse> = {}): CatalogCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, creditsMin: credits, creditsMax: credits, attrs: tags.map((value) => ({ value })), ...over };
};

const fixtureCourses: CatalogCourse[] = [
  course("ENGL-1105", 3, ["WRT-AG"], { title: "FWS: Writing" }),
  course("ENGL-2880", 3, ["ALC-AS", "WRT-AG"]),
  course("HIST-1600", 4, ["HST-AS", "ETM-AS"]),
  course("HIST-2000", 1, ["HST-AS"]),
  course("MATH-1110", 4, ["SMR-AS", "MQL-AG"]),
  course("SPAN-1210", 4, ["FL-AG"]),
  course("SPAN-1220", 4, ["FL-AG"]),
  course("SPAN-2090", 3, ["FL-AG", "FLOPI-AS"]),
  course("FREN-1210", 4, ["FL-AG"]),
  course("BIOG-4990", 1, ["BIO-AS"], { creditsMax: 8 }),
  course("AEM-2700", 3, ["ORL-AG"]),
  course("PE-1100", 1),
];
const catalog = buildCatalog(fixtureCourses);

const SRC = { url: "https://catalog.cornell.edu/x/", anchor: "X" };
const layer = (rows: LayerRow[]): LayerFile => ({ id: "test", kind: "college", family: "cas", rows: rows.map((r) => ({ ...r, source: SRC }) as LayerRow) });
const run = (rows: LayerRow[], newTags?: string[]) => validateLayer("test.json", layer(rows), catalog, { newTags });

// ── Evaluator mirror ────────────────────────────────────────────────────────
check("evaluator: tag / subject / number / title / credits / variable / program leaves", () => {
  const c = fixtureCourses[0];
  assertEqual("tag hit", courseMatchesRule(c, { tag: ["WRT-AG"] }, null), true);
  assertEqual("subject miss", courseMatchesRule(c, { subject: ["HIST"] }, null), false);
  assertEqual("number range", courseMatchesRule(c, { number: { min: 1100, max: 1199 } }, null), true);
  assertEqual("title prefix", courseMatchesRule(c, { titleStartsWith: "FWS:" }, null), true);
  assertEqual("min credits", courseMatchesRule(c, { minCredits: 4 }, null), false);
  assertEqual("variable credit", courseMatchesRule(fixtureCourses[9], { variableCredit: true }, null), true);
  assertEqual("credit kind never on a catalog course", courseMatchesRule(c, { not: { creditKind: ["ap"] } }, null), true);
  assertEqual("program leaf without a program", courseMatchesRule(c, { program: ["p"] }, null), false);
  assertEqual("program leaf with it", courseMatchesRule(c, { program: ["p"] }, "p"), true);
  assertEqual("pattern", courseMatchesRule(c, { pattern: "ENGL 11xx" }, null), true);
  assertEqual("leafValues collects nested tags", leafValues({ allOf: [{ tag: ["A"] }, { not: { anyOf: [{ tag: ["B"] }] } }] }, "tag"), ["A", "B"]);
});

// ── Row checks ──────────────────────────────────────────────────────────────
check("a satisfiable layer has no errors and reports coverage counts", () => {
  const r = run([
    { id: "fws", kind: "pool", rule: { anyOf: [{ titleStartsWith: "FWS:" }, { course: ["ENGL-2880"] }] }, requiredCourses: 2, requiredCredits: 0 },
    {
      id: "dist",
      kind: "distribution",
      rule: { allOf: [{ minCredits: 3 }, { not: { variableCredit: true } }] },
      categories: [
        { id: "alc", rule: { tag: ["ALC-AS"] } },
        { id: "hst", rule: { tag: ["HST-AS"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
    },
    {
      id: "language",
      kind: "anyOf",
      rows: [
        { id: "opt-1", kind: "seat", rule: { allOf: [{ tag: ["FLOPI-AS"] }, { number: { min: 2000 } }] } },
        { id: "opt-2", kind: "credits", rule: { subject: ["SPAN", "FREN"] }, requiredCredits: 11, sameSubject: true },
      ],
    },
    { id: "credits", kind: "credits", rule: { not: { subject: ["PE"] } }, requiredCredits: 30 },
    { id: "confirm", kind: "confirm" },
  ]);
  assertEqual("no errors", r.errors, []);
  assertEqual("rows checked (anyOf children count, confirm does not)", [r.rowsChecked, r.confirmRows], [5, 1]);
  const count = (where: string) => r.coverage.find((c) => c.where === where)?.count;
  assertEqual("fws count", count("test:fws"), 2);
  assertEqual("hst count excludes the 1-credit course", count("test:dist[hst]"), 1);
  assertEqual("language opt-2 count", count("test:language/opt-2"), 4);
  assertEqual("credits count excludes PE", count("test:credits"), 11);
});

check("a rule nothing matches is an ERROR", () => {
  const r = run([{ id: "s", kind: "seat", rule: { allOf: [{ tag: ["WRT-AG"] }, { number: { min: 5000 } }] } }]);
  assertTrue("error names the row", r.errors.some((e) => e.includes("test:s: no catalog course matches")), JSON.stringify(r.errors));
});

check("an unknown tag is an ERROR, or a WARNING when declared new", () => {
  const rows: LayerRow[] = [{ id: "s", kind: "seat", rule: { tag: ["WRT-AG", "ZZZ-AG"] } }];
  const r = run(rows);
  assertTrue("error", r.errors.some((e) => e.includes("tag ZZZ-AG")), JSON.stringify(r.errors));
  const w = run(rows, ["ZZZ-AG"]);
  assertEqual("downgraded: no errors", w.errors, []);
  assertTrue("downgraded: warning", w.warnings.some((x) => x.includes("tag ZZZ-AG")), JSON.stringify(w.warnings));
});

check("an unknown tag inside a not / limit / category is still caught", () => {
  const r = run([
    {
      id: "p",
      kind: "pool",
      rule: { allOf: [{ tag: ["WRT-AG"] }, { not: { tag: ["NOPE-1"] } }] },
      requiredCourses: 0,
      requiredCredits: 3,
      limits: [{ rule: { tag: ["NOPE-2"] }, maxCourses: 1 }],
    },
    { id: "d", kind: "distribution", categories: [{ id: "x", rule: { tag: ["ALC-AS", "NOPE-3"] } }], requiredCourses: 1, minDistinctCategories: 1 },
  ]);
  for (const t of ["NOPE-1", "NOPE-2", "NOPE-3"]) assertTrue(t, r.errors.some((e) => e.includes(`tag ${t}`)), JSON.stringify(r.errors));
});

check("unknown subjects and course ids are ERRORs", () => {
  const r = run([{ id: "s", kind: "seat", rule: { anyOf: [{ subject: ["ENGL", "XYZQ"] }, { course: ["ENGL-9999"] }] } }]);
  assertTrue("subject", r.errors.some((e) => e.includes("subject XYZQ")), JSON.stringify(r.errors));
  assertTrue("course", r.errors.some((e) => e.includes("course ENGL-9999")), JSON.stringify(r.errors));
});

check("a dead distribution category and too few fillable categories are ERRORs", () => {
  const r = run([
    {
      id: "d",
      kind: "distribution",
      rule: { minCredits: 3 },
      categories: [
        { id: "alc", rule: { tag: ["ALC-AS"] } },
        { id: "bio", rule: { tag: ["BIO-AS"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
    },
  ]);
  assertTrue("dead category (BIO-AS only on a 1-credit variable course)", r.errors.some((e) => e.includes("test:d[bio]: no catalog course matches")), JSON.stringify(r.errors));
  assertTrue("fillable count", r.errors.some((e) => e.includes("only 1 categories are fillable, needs 2")), JSON.stringify(r.errors));
  assertTrue("required courses", r.errors.some((e) => e.includes("needs 2 courses, only 1 catalog courses")), JSON.stringify(r.errors));
});

check("unreachable credits are ERRORs (sameSubject uses the best subject)", () => {
  const r = run([
    { id: "lang", kind: "credits", rule: { tag: ["FL-AG"] }, requiredCredits: 12, sameSubject: true },
    { id: "pool", kind: "pool", rule: { subject: ["SPAN"] }, requiredCourses: 4, requiredCredits: 0 },
  ]);
  assertTrue("same subject", r.errors.some((e) => e.includes("test:lang: needs 12 credits in one subject, catalog has 11")), JSON.stringify(r.errors));
  assertTrue("pool courses", r.errors.some((e) => e.includes("test:pool: needs 4 courses, catalog has 3")), JSON.stringify(r.errors));
});

check("a limit with a minimum nothing satisfies is an ERROR; a max-only limit is not", () => {
  const r = run([
    {
      id: "w",
      kind: "pool",
      rule: { tag: ["WRT-AG", "ORL-AG"] },
      requiredCourses: 0,
      requiredCredits: 9,
      limits: [
        { rule: { tag: ["MQL-AG"] }, minCourses: 1 },
        { rule: { tag: ["ORL-AG"] }, maxCourses: 1 },
        { rule: { tag: ["WRT-AG"] }, minCredits: 7 },
      ],
    },
  ]);
  assertTrue("min limit", r.errors.some((e) => e.includes("limit[0]") && e.includes("no catalog course the row counts")), JSON.stringify(r.errors));
  assertTrue("max-only limit is fine", !r.errors.some((e) => e.includes("limit[1]")), JSON.stringify(r.errors));
  assertTrue("min credits", r.errors.some((e) => e.includes("limit[2]") && e.includes("needs 7 credits, catalog has 6")), JSON.stringify(r.errors));
  assertTrue("pool credits reachable (9 of 9)", !r.errors.some((e) => e.startsWith("test:w: needs")), JSON.stringify(r.errors));
});

check("a dead anyOf child is an ERROR", () => {
  const r = run([
    {
      id: "either",
      kind: "anyOf",
      rows: [
        { id: "a", kind: "seat", rule: { tag: ["FLOPI-AS"] } },
        { id: "b", kind: "seat", rule: { allOf: [{ tag: ["FLOPI-AS"] }, { number: { min: 3000 } }] } },
      ],
    },
  ]);
  assertTrue("child b", r.errors.some((e) => e.includes("test:either/b: no catalog course matches")), JSON.stringify(r.errors));
});

check("a program-gated rule is counted under its program", () => {
  const r = run([{ id: "aem", kind: "credits", rule: { allOf: [{ subject: ["AEM"] }, { program: ["test-aem"] }] }, requiredCredits: 3 }]);
  assertEqual("no errors", r.errors, []);
  assertEqual("count", r.coverage.find((c) => c.where === "test:aem")?.count, 1);
});

check("low coverage is a WARNING", () => {
  const r = run([{ id: "orl", kind: "seat", rule: { tag: ["ORL-AG"] } }]);
  assertEqual("no errors", r.errors, []);
  assertTrue("warning", r.warnings.some((w) => w.includes("only 1 catalog course")), JSON.stringify(r.warnings));
});

// ── IO paths ────────────────────────────────────────────────────────────────
check("dump loader accepts an array and the backup { courses: { id: doc } } shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-layers-"));
  const arr = join(dir, "array.json");
  const obj = join(dir, "backup.json");
  writeFileSync(arr, JSON.stringify(fixtureCourses));
  const map: Record<string, Omit<CatalogCourse, "id">> = {};
  for (const { id, ...rest } of fixtureCourses) map[id] = rest;
  writeFileSync(obj, JSON.stringify({ courses: map, programs: {} }));
  assertEqual("array", loadCatalogDump(arr).length, fixtureCourses.length);
  const fromMap = loadCatalogDump(obj);
  assertEqual("map ids restored", fromMap.map((c) => c.id).sort(), fixtureCourses.map((c) => c.id).sort());
  let threw = false;
  try {
    parseCatalogDump({ nope: true });
  } catch {
    threw = true;
  }
  assertTrue("rejects other shapes", threw, "parseCatalogDump accepted a bad shape");
});

check("layer files are collected recursively from directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-layers-dir-"));
  mkdirSync(join(dir, "cas"));
  writeFileSync(join(dir, "cas", "college.json"), JSON.stringify(layer([{ id: "s", kind: "seat", rule: { tag: ["WRT-AG"] } }])));
  writeFileSync(join(dir, "notes.txt"), "ignored");
  const files = collectLayerFiles([dir]);
  assertEqual("one json file", files.length, 1);
  assertEqual("reads it", readLayerFile(files[0]).id, "test");
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── validate-layers corpus — ${checks.length} case(s) ──`);
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
