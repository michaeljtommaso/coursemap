// scripts/forbidden-overlaps.corpus.ts
// Asserted, offline corpus runner for forbidden-overlaps.ts (spec 007 §5 / Unit
// 7D). NO network calls — every case below is a verbatim string, not a live
// fetch. Exits nonzero on any mismatch so it can gate CI/local verification the
// same way a test file would.
//
// Run: npx tsx forbidden-overlaps.corpus.ts   (from the scripts/ folder)

import { parseForbiddenOverlaps } from "./forbidden-overlaps";

type Check = {
  name: string;
  fn: () => void;
};

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
  if (a !== e) {
    fail(name, `expected ${e}, got ${a}`);
  }
}

// ── Verified live samples (debug doc #11, Part 1.5) ─────────────────────────

check("CS 1110 — self-stripped from its own overlap list", () => {
  const out = parseForbiddenOverlaps("CS 1110, CS 1112", "CS-1110");
  assertEqual("CS 1110", out, ["CS-1112"]);
});

check("MATH 1910 — self-stripped, list does NOT contain MATH 1110", () => {
  const out = parseForbiddenOverlaps("MATH 1120, MATH 1910", "MATH-1910");
  assertEqual("MATH 1910", out, ["MATH-1120"]);
});

check("MATH 1920 — three-course list, self-stripped", () => {
  const out = parseForbiddenOverlaps("MATH 1920, MATH 2220, MATH 2240", "MATH-1920");
  assertEqual("MATH 1920", out, ["MATH-2220", "MATH-2240"]);
});

// ── Self not first in the list — stripping isn't position-dependent ─────────
// (binding decision spec 007 §5 / Unit 7D worklist: "a list not containing
// self ('MATH 1120, MATH 1910' for self 'MATH-1910' → ['MATH-1120']"). Same
// raw text as the MATH 1910 verified sample above — restated as its own case
// because self sits SECOND here, unlike CS 1110 where self sits first.

check('self stripped regardless of position ("MATH 1120, MATH 1910" for self MATH-1910)', () => {
  const out = parseForbiddenOverlaps("MATH 1120, MATH 1910", "MATH-1910");
  assertEqual("self not first", out, ["MATH-1120"]);
});

// ── Self genuinely absent from the raw text — nothing to strip ──────────────

check("self genuinely absent from the raw text — nothing stripped", () => {
  const out = parseForbiddenOverlaps("MATH 1120, MATH 1910", "MATH-1930");
  assertEqual("self absent", out, ["MATH-1120", "MATH-1910"]);
});

// ── Null / empty / whitespace-only → null ────────────────────────────────────

check("null raw → null", () => {
  assertEqual("null raw", parseForbiddenOverlaps(null, "CS-1110"), null);
});

check("undefined raw → null", () => {
  assertEqual("undefined raw", parseForbiddenOverlaps(undefined, "CS-1110"), null);
});

check("empty string → null", () => {
  assertEqual("empty string", parseForbiddenOverlaps("", "CS-1110"), null);
});

check("whitespace-only → null", () => {
  assertEqual("whitespace-only", parseForbiddenOverlaps("   \n\t  ", "CS-1110"), null);
});

// ── Prose with no course codes → null (defensive: never emit junk) ──────────

check('"See department for details" — no codes extractable → null', () => {
  const out = parseForbiddenOverlaps("See department for details", "CS-1110");
  assertEqual("no codes", out, null);
});

// ── A list that is ONLY the course itself → null after stripping ────────────

check("list containing only self → null after stripping", () => {
  const out = parseForbiddenOverlaps("CS 1110", "CS-1110");
  assertEqual("only self", out, null);
});

// ── Dedupe of repeated codes ──────────────────────────────────────────────────

check("dedupe of repeated codes", () => {
  const out = parseForbiddenOverlaps("CS 1112, CS 1112, CS 1112", "CS-1110");
  assertEqual("dedupe", out, ["CS-1112"]);
});

// ── Trailing-letter course code (e.g. BIOMG 1350A style) ────────────────────

check("trailing-letter course code survives (BIOMG 1350A style)", () => {
  const out = parseForbiddenOverlaps("BIOMG 1350, BIOMG 1350A", "BIOMG-1350");
  assertEqual("trailing letter", out, ["BIOMG-1350A"]);
});

// ── Lecture + lab bundles (Cornell's grouped form, FA26 CHEM) ──────────────

check("CHEM 2090 — its own bundle (CHEM 2090 and CHEM 2091) is stripped whole; the lab is not an overlap", () => {
  const raw = "CHEM 1560 and CHEM 1561, CHEM 2070 and CHEM 2071, CHEM 2090 and CHEM 2091";
  assertEqual("CHEM 2090", parseForbiddenOverlaps(raw, "CHEM-2090"), ["CHEM-1560", "CHEM-1561", "CHEM-2070", "CHEM-2071"]);
  assertEqual("CHEM 2091", parseForbiddenOverlaps(raw, "CHEM-2091"), ["CHEM-1560", "CHEM-1561", "CHEM-2070", "CHEM-2071"]);
});

check("CHEM 2080 — bundle stripped, the single-course group CHEM 2150 stays", () => {
  const out = parseForbiddenOverlaps("CHEM 2080 and CHEM 2081, CHEM 2150", "CHEM-2080");
  assertEqual("CHEM 2080", out, ["CHEM-2150"]);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── forbidden-overlaps corpus — ${checks.length} case(s) ──`);
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
