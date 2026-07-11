// scripts/prereq-grammar.corpus.ts
// Asserted, offline corpus runner for prereq-grammar.ts (spec 007 §3 / Unit 7A).
// NO network calls — every case below is a verbatim string, not a live fetch.
// Exits nonzero on any mismatch so it can gate CI/local verification the same
// way a test file would.
//
// Run: npx tsx prereq-grammar.corpus.ts   (from the scripts/ folder)

import { parsePrereqs, splitLabeledSections, type ParseClass, type ParseResult } from "./prereq-grammar";
import { canonicalStringify, treeEqual } from "./canonical-json";
import type { PrereqExpr } from "../cornell-degree-planner/src/types/db";

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

function assertEqual<T>(name: string, actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail(name, `${label}: expected ${e}, got ${a}`);
  }
}

function assertTrue(name: string, cond: boolean, label: string) {
  if (!cond) fail(name, `${label}: expected true, got false`);
}

function assertClass(name: string, r: ParseResult, expected: ParseClass) {
  assertEqual(name, r.cls, expected, "cls");
}

function treeContainsId(expr: PrereqExpr | null | undefined, id: string): boolean {
  if (!expr) return false;
  if (expr.type === "course" || expr.type === "concurrent") return expr.id === id;
  if (expr.type === "pattern") return false;
  if (expr.type === "advisory") return treeContainsId(expr.expr, id);
  return expr.children.some((c) => treeContainsId(c, id));
}

function findAdvisory(expr: PrereqExpr | null | undefined): Extract<PrereqExpr, { type: "advisory" }> | null {
  if (!expr) return null;
  if (expr.type === "advisory") return expr;
  if (expr.type === "course" || expr.type === "concurrent" || expr.type === "pattern") return null;
  for (const c of expr.children) {
    const found = findAdvisory(c);
    if (found) return found;
  }
  return null;
}

const course = (id: string): PrereqExpr => ({ type: "course", id });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });

// ── MATH 1910 — the headline case (spec 007, debug doc #4/#10/#12) ────────────
check("MATH 1910 — e.g. parenthetical + high-school OR fully captured, no phantom node", () => {
  const text =
    "Three years high school mathematics, including trigonometry and logarithms, " +
    "and at least one course in differential and integral calculus (e.g., MATH 1110), " +
    "or equivalent AP credit.";
  const r = parsePrereqs(text, null);
  assertClass("MATH 1910", r, "annotated");
  assertEqual("MATH 1910", r.prereqExpr, null, "prereqExpr");
  assertTrue("MATH 1910", r.prereqNotes.length > 0, "prereqNotes non-empty");
  const dump = JSON.stringify(r);
  assertTrue("MATH 1910", !dump.includes("MATH-1110"), "no MATH-1110 anywhere in the output");
});

check('"a precalculus course (e.g., MATH 1101), or equivalent." — no MATH-1101 node', () => {
  const text = "Prerequisite: a precalculus course (e.g., MATH 1101), or equivalent.";
  const r = parsePrereqs(text, null);
  const dump = JSON.stringify(r);
  assertTrue("precalculus e.g.", !dump.includes("MATH-1101"), "no MATH-1101 anywhere in the output");
  assertEqual("precalculus e.g.", r.prereqExpr, null, "prereqExpr (no course survives)");
});

// ── MATH 1920 — OR-noise → advisory (spec 007 §3 decision 2b) ─────────────────
check('MATH 1920 — "MATH 1910 or equivalent AP credit." → advisory(MATH-1910)', () => {
  const r = parsePrereqs("MATH 1910 or equivalent AP credit.", null);
  assertClass("MATH 1920", r, "annotated");
  const adv = findAdvisory(r.prereqExpr);
  assertTrue("MATH 1920", adv !== null, "an advisory node exists in prereqExpr");
  if (adv) {
    assertTrue("MATH 1920", treeContainsId(adv.expr, "MATH-1910"), "advisory wraps course MATH-1910");
    assertTrue(
      "MATH 1920",
      /ap credit/i.test(adv.note),
      `note mentions AP credit (got "${adv.note}")`
    );
  }
});

check('"CS 2110 or permission of instructor." → advisory(CS-2110)', () => {
  const r = parsePrereqs("CS 2110 or permission of instructor.", null);
  const adv = findAdvisory(r.prereqExpr);
  assertTrue("CS 2110 or permission", adv !== null, "an advisory node exists in prereqExpr");
  if (adv) {
    assertTrue("CS 2110 or permission", treeContainsId(adv.expr, "CS-2110"), "advisory wraps course CS-2110");
    assertTrue(
      "CS 2110 or permission",
      /permission/i.test(adv.note),
      `note mentions permission (got "${adv.note}")`
    );
  }
});

// ── AND-noise stays hard, noise becomes a note (spec 007 §3 decision 2c) ──────
check('"CS 2800; minimum grade of B- required." → hard CS-2800 + a note, annotated', () => {
  const r = parsePrereqs("CS 2800; minimum grade of B- required.", null);
  assertEqual("CS 2800 grade min", r.prereqExpr, course("CS-2800"), "prereqExpr is a bare hard CS-2800");
  assertTrue("CS 2800 grade min", r.prereqNotes.length > 0, "prereqNotes non-empty");
  assertClass("CS 2800 grade min", r, "annotated");
});

// ── CS 3110's malformed coreq field routes to the PREREQ bucket ───────────────
check('CS 3110 malformed coreq "or prerequisites: CS 2800." routes to PREREQ bucket', () => {
  const buckets = splitLabeledSections(null, "or prerequisites: CS 2800.");
  assertTrue("CS 3110 coreq routing", buckets.prereqProse.some((s) => /CS\s+2800/.test(s)), "prereqProse carries CS 2800");
  assertTrue("CS 3110 coreq routing", buckets.coreqProse.length === 0, "coreqProse is empty (label leak fully consumed)");

  const r = parsePrereqs(null, "or prerequisites: CS 2800.");
  assertEqual("CS 3110 coreq routing", r.prereqExpr, course("CS-2800"), "prereqExpr picks up CS 2800");
  assertEqual("CS 3110 coreq routing", r.coreqExpr, null, "coreqExpr stays null");
});

// ── Regressions — must keep working exactly as before ─────────────────────────
check('"CS 2110; CS 2800" → and(CS-2110, CS-2800), clean', () => {
  const r = parsePrereqs("CS 2110; CS 2800", null);
  assertEqual("CS 2110; CS 2800", r.prereqExpr, and(course("CS-2110"), course("CS-2800")), "prereqExpr");
  assertClass("CS 2110; CS 2800", r, "clean");
});

check('"MATH 2210, MATH 2230, or MATH 2940" → or of the three, clean', () => {
  const r = parsePrereqs("MATH 2210, MATH 2230, or MATH 2940", null);
  assertEqual(
    "MATH 2210/2230/2940",
    r.prereqExpr,
    or(course("MATH-2210"), course("MATH-2230"), course("MATH-2940")),
    "prereqExpr"
  );
  assertClass("MATH 2210/2230/2940", r, "clean");
});

check('"CS 1110 or CS 1112" → or, clean, NOT advisory', () => {
  const r = parsePrereqs("CS 1110 or CS 1112", null);
  assertEqual("CS 1110 or CS 1112", r.prereqExpr, or(course("CS-1110"), course("CS-1112")), "prereqExpr");
  assertClass("CS 1110 or CS 1112", r, "clean");
  assertTrue("CS 1110 or CS 1112", findAdvisory(r.prereqExpr) === null, "no advisory node anywhere");
});

// ── canonical-json — key-order-insensitive tree comparison (parse-prereqs F1) ──
check("treeEqual — Firestore-style shuffled key order compares equal", () => {
  // Freshly-parsed shape ({type,id}/{type,children}) vs a Firestore-read shape
  // with reversed key order ({id,type}/{children,type}). Must compare equal.
  const parsed: PrereqExpr = {
    type: "advisory",
    expr: { type: "or", children: [course("CS-1110"), course("CS-1112")] },
    note: "or equivalent",
  };
  const firestoreShaped = {
    note: "or equivalent",
    expr: { children: [{ id: "CS-1110", type: "course" }, { id: "CS-1112", type: "course" }], type: "or" },
    type: "advisory",
  };
  assertTrue("treeEqual shuffled", treeEqual(parsed, firestoreShaped), "shuffled key order is equal");
  assertEqual(
    "treeEqual shuffled",
    canonicalStringify(parsed),
    canonicalStringify(firestoreShaped),
    "canonicalStringify matches"
  );

  // Arrays must KEEP order — or(A,B) is not or(B,A) for comparison purposes.
  const swappedChildren = {
    type: "or",
    children: [{ type: "course", id: "CS-1112" }, { type: "course", id: "CS-1110" }],
  };
  assertTrue(
    "treeEqual shuffled",
    !treeEqual(parsed.type === "advisory" ? parsed.expr : null, swappedChildren),
    "reordered array children are NOT equal"
  );

  // Genuinely different trees stay different; null/undefined compare equal.
  assertTrue("treeEqual shuffled", !treeEqual(parsed, course("CS-1110")), "different trees differ");
  assertTrue("treeEqual shuffled", treeEqual(null, undefined), "null equals undefined (both = no tree)");
});

// ── Run ────────────────────────────────────────────────────────────────────────
console.log(`\n── prereq-grammar corpus — ${checks.length} case(s) ──`);
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
