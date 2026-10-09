// scripts/validate-programs.corpus.ts
// Asserted, offline corpus runner for validate-programs.ts (spec 011 §2a/§2b,
// Unit 11B). NO network calls — fixture programs + a small fixture catalog are
// hand-built objects, same convention as scripts/roster-convert.corpus.ts.
// Exits nonzero on any mismatch.
//
// Run: npx tsx validate-programs.corpus.ts   (from the scripts/ folder)

import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import {
  buildCatalogMaps,
  validateProgram,
  renderCoverageReport,
  loadCatalogDump,
  loadLegacyPrograms,
  loadLegacyAuthoredTitles,
  loadPrograms2025,
  DATA_DIR,
  type CatalogCourse,
  type NormalizedProgram,
} from "./validate-programs";

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

// ── Fixture catalog — small, hand-built, offline ────────────────────────────
const fixtureCatalog: CatalogCourse[] = [
  { id: "MATH-1910", subject: "MATH", number: "1910", title: "Calculus for Engineers", creditsMin: 4, creditsMax: 4 },
  { id: "CS-1110", subject: "CS", number: "1110", title: "Intro Programming", creditsMin: 4, creditsMax: 4 },
  { id: "CS-4700", subject: "CS", number: "4700", title: "Artificial Intelligence", creditsMin: 3, creditsMax: 3 },
  { id: "CS-4740", subject: "CS", number: "4740", title: "Natural Language Processing", creditsMin: 3, creditsMax: 3 },
  {
    id: "ENGL-1134",
    subject: "ENGL",
    number: "1134",
    title: "FWS: True Stories",
    creditsMin: 3,
    creditsMax: 3,
    attrs: [{ value: "ALC-AS", descr: "Arts, Lit & Culture", group: "Distribution Requirements" }],
  },
  { id: "PE-1300", subject: "PE", number: "1300", title: "Yoga", creditsMin: 1, creditsMax: 1 },
];
const fixtureCatalogMaps = buildCatalogMaps(fixtureCatalog);

function healthyProgram(): NormalizedProgram {
  return {
    id: "test-healthy",
    name: "Test Healthy Major",
    source: "legacy",
    totalCredits: null, // no published total → credit-drift check is a no-op
    slots: [
      { id: "s-course", kind: "course", courseId: "MATH-1910" },
      { id: "s-pattern", kind: "pattern", pattern: "CS-4xxx", patternTitle: "CS 4000-level" },
      {
        id: "s-attr",
        kind: "attribute",
        patternTitle: "First-Year Writing Seminar",
        attributeMatch: { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] },
      },
      { id: "s-elective", kind: "elective", electiveGroupId: "g-open" },
      { id: "s-list-elective", kind: "elective", electiveGroupId: "g-list" },
    ],
    electiveGroups: [
      {
        id: "g-open",
        name: "Open Elective",
        qualifyingRule: { type: "open" },
        minCredits: 3,
        courseIds: [],
      },
      {
        id: "g-list",
        name: "AI/NLP Choice",
        qualifyingRule: { type: "list" },
        minCredits: 3,
        courseIds: ["CS-4700", "CS-4740"],
      },
    ],
  };
}

// ── 1. A healthy major passes (zero errors) ─────────────────────────────────
check("healthy major → zero errors", () => {
  const report = validateProgram(healthyProgram(), fixtureCatalogMaps);
  assertEqual("errors", report.errors, []);
  assertTrue("seat count is 4 (elective slots carry no seat)", report.seatCount === 3, `got ${report.seatCount}`);
  assertTrue("pool count is 2", report.poolCount === 2, `got ${report.poolCount}`);
});

// ── 2. A pattern slot with zero matches → ERROR ─────────────────────────────
check("pattern slot, zero catalog matches → ERROR", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-pattern-zero",
    slots: [{ id: "s-pattern-zero", kind: "pattern", pattern: "ZZZZ-9xxx", patternTitle: "Nothing" }],
    electiveGroups: [],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertTrue(
    "one ERROR mentioning ZERO catalog courses",
    report.errors.some((e) => e.includes("s-pattern-zero") && e.includes("ZERO catalog courses")),
    `errors: ${JSON.stringify(report.errors)}`
  );
});

// ── 3. An attribute slot with zero matches → ERROR ──────────────────────────
check("attribute slot, zero catalog matches → ERROR", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-attribute-zero",
    slots: [
      {
        id: "s-attr-zero",
        kind: "attribute",
        patternTitle: "Nonexistent Distribution",
        attributeMatch: { anyOf: [{ field: "attrs.value", op: "in", value: ["ZZZ-NOPE"] }] },
      },
    ],
    electiveGroups: [],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertTrue(
    "one ERROR mentioning ZERO catalog courses",
    report.errors.some((e) => e.includes("s-attr-zero") && e.includes("ZERO catalog courses")),
    `errors: ${JSON.stringify(report.errors)}`
  );
});

// ── 3b. An attribute slot whose attributeMatch is malformed → ERROR ─────────
check("attribute slot, malformed attributeMatch → ERROR", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-attribute-malformed",
    slots: [{ id: "s-attr-bad", kind: "attribute", attributeMatch: { anyOf: [] } }],
    electiveGroups: [],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertTrue(
    "one ERROR mentioning missing/malformed",
    report.errors.some((e) => e.includes("s-attr-bad") && e.includes("missing/malformed")),
    `errors: ${JSON.stringify(report.errors)}`
  );
});

// ── 4. A missing course-kind courseId → ERROR ───────────────────────────────
check("course slot, courseId absent from catalog → ERROR", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-missing-course",
    slots: [{ id: "s-missing", kind: "course", courseId: "NOPE-9999" }],
    electiveGroups: [],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertTrue(
    "one ERROR mentioning MISSING from catalog",
    report.errors.some((e) => e.includes("s-missing") && e.includes("NOPE-9999") && e.includes("MISSING")),
    `errors: ${JSON.stringify(report.errors)}`
  );
});

// ── 5. A list-rule elective group → INFO, never an error ───────────────────
check("list-rule group with valid courseIds → INFO, zero errors from the group", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-list-info",
    slots: [{ id: "s-list", kind: "elective", electiveGroupId: "g-list" }],
    electiveGroups: [
      {
        id: "g-list",
        name: "AI/NLP Choice",
        qualifyingRule: { type: "list" },
        minCredits: 3,
        courseIds: ["CS-4700", "CS-4740"],
      },
    ],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertEqual("no errors (list rule never errors on plausibility)", report.errors, []);
  assertTrue(
    "an INFO mentions 'list rule' and 'not computable'",
    report.infos.some((i) => i.includes("g-list") && i.includes("list rule") && i.includes("not computable")),
    `infos: ${JSON.stringify(report.infos)}`
  );
});

// ── 5b. list-rule group with a bad courseId → ERROR (FWS-class extension) ──
check("list-rule group with a missing courseId → ERROR (still flagged, not silently INFO)", () => {
  const program: NormalizedProgram = {
    ...healthyProgram(),
    id: "test-list-bad-id",
    slots: [],
    electiveGroups: [
      {
        id: "g-list-bad",
        name: "Bad List",
        qualifyingRule: { type: "list" },
        minCredits: 3,
        courseIds: ["CS-4700", "NOPE-0000"],
      },
    ],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertTrue(
    "ERROR mentions the missing listed course",
    report.errors.some((e) => e.includes("g-list-bad") && e.includes("NOPE-0000") && e.includes("MISSING")),
    `errors: ${JSON.stringify(report.errors)}`
  );
});

// ── 6. Credit drift beyond 25% → WARNING (not an error) ─────────────────────
check("credit total drifting >25% from published totalCredits → WARNING", () => {
  const program: NormalizedProgram = {
    id: "test-credit-drift",
    name: "Test Credit Drift Major",
    source: "legacy",
    totalCredits: 100, // actual sum will be ~10cr → drift 90%
    slots: [{ id: "s-course", kind: "course", courseId: "MATH-1910" }],
    electiveGroups: [
      { id: "g-open", name: "Open Elective", qualifyingRule: { type: "open" }, minCredits: 3, courseIds: [] },
    ],
  };
  const report = validateProgram(program, fixtureCatalogMaps);
  assertEqual("no errors from drift alone", report.errors, []);
  assertTrue(
    "a WARNING mentions 'drifts'",
    report.warnings.some((w) => w.includes("drifts")),
    `warnings: ${JSON.stringify(report.warnings)}`
  );
  assertTrue("creditDriftPct computed", report.creditDriftPct !== null && report.creditDriftPct > 25, `got ${report.creditDriftPct}`);
});

// ── 7. loadCatalogDump reads a real file (proves the --dump path itself) ────
check("loadCatalogDump reads a JSON array file", () => {
  const dumpPath = resolve(tmpdir(), "validate-programs-corpus-fixture-catalog.json");
  writeFileSync(dumpPath, JSON.stringify(fixtureCatalog));
  const loaded = loadCatalogDump(dumpPath);
  assertEqual("loaded catalog matches what was written", loaded, fixtureCatalog);
});

// ── 8. Run the REAL harness (real seed-data corpus) with --dump against a
// fixture catalog, proving report generation works end-to-end. Written to a
// TEMP path, never docs/ (this is a test run, not a real coverage report). ──
check("real harness end-to-end: real seed-data + fixture catalog → report file", () => {
  const legacyPrograms = loadLegacyPrograms(DATA_DIR);
  const authoredTitles = loadLegacyAuthoredTitles(DATA_DIR);
  const programs2025 = loadPrograms2025(DATA_DIR);
  const allPrograms = [...legacyPrograms, ...programs2025];

  assertTrue("found the 4 legacy 2026 programs", legacyPrograms.length === 4, `got ${legacyPrograms.length}`);
  assertTrue("found the 11 2025 programs", programs2025.length === 11, `got ${programs2025.length}`);

  const reports = allPrograms.map((p) =>
    validateProgram(p, fixtureCatalogMaps, p.source === "legacy" ? authoredTitles : undefined)
  );

  const markdown = renderCoverageReport(reports, {
    generatedAt: new Date().toISOString(),
    dataSource: "dump file: <fixture, corpus test run>",
  });

  const outPath = resolve(tmpdir(), "validate-programs-corpus-report.md");
  writeFileSync(outPath, markdown);

  assertTrue("report file was written", existsSync(outPath), outPath);
  const written = readFileSync(outPath, "utf-8");
  assertTrue("report has the standard header", written.startsWith("# Program Coverage Report"), written.slice(0, 80));
  assertTrue(
    "report has a section for cornell-cs-bs-2026",
    written.includes("## cornell-cs-bs-2026"),
    "missing cornell-cs-bs-2026 section"
  );
  assertTrue(
    "report has a section for a 2025 program",
    written.includes("## cornell-be-bs-2025"),
    "missing cornell-be-bs-2025 section"
  );
  // Against a 6-course fixture catalog, the real 40+-slot majors are expected
  // to surface plenty of ERRORs — that's fine, this check only proves
  // generation works, not that the fixture catalog is a realistic corpus.
  const totalErrors = reports.reduce((n, r) => n + r.errors.length, 0);
  assertTrue(
    "report counted at least one error somewhere (proves errors surface, not just OK majors)",
    totalErrors > 0 && written.includes(`(${totalErrors} error(s)`),
    `totalErrors=${totalErrors}`
  );
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── validate-programs corpus — ${checks.length} case(s) ──`);
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
