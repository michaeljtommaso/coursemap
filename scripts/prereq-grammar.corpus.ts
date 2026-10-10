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
const conc = (id: string): PrereqExpr => ({ type: "concurrent", id });
const adv = (expr: PrereqExpr, note: string): PrereqExpr => ({ type: "advisory", expr, note });

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

// ── Label leaks mean "prerequisite or corequisite" (PB5) ──────────────────────
// The roster strips each field's own label, so CS 3110's coreq field
// "or prerequisites: CS 2800." was "Corequisites or prerequisites: CS 2800." —
// take it before OR alongside. It lands as a concurrent leaf, never a hard
// earlier-semester prereq (this case used to route it to the prereq bucket).
check('CS 3110 coreq "or prerequisites: CS 2800." → concurrent CS-2800', () => {
  const buckets = splitLabeledSections(null, "or prerequisites: CS 2800.");
  assertTrue("CS 3110 leak", buckets.concurrentProse.some((s) => /CS\s+2800/.test(s)), "concurrentProse carries CS 2800");
  assertTrue("CS 3110 leak", buckets.prereqProse.length === 0 && buckets.coreqProse.length === 0, "nothing in prereq/coreq buckets");
  const r = parsePrereqs("CS 2110 or equivalent.", "or prerequisites: CS 2800.");
  assertEqual(
    "CS 3110 leak",
    r.prereqExpr,
    and(adv(course("CS-2110"), "or equivalent"), conc("CS-2800")),
    "prereqExpr"
  );
  assertEqual("CS 3110 leak", r.coreqExpr, null, "coreqExpr");
});

check('MSE 3120 coreq "or prerequisite: MSE 3040." (singular) → concurrent', () => {
  const r = parsePrereqs("MSE 3110.", "or prerequisite: MSE 3040.");
  assertEqual("MSE 3120", r.prereqExpr, and(course("MSE-3110"), conc("MSE-3040")), "prereqExpr");
});

check('BEE 3500 prereq field "or corequisites: MATH 2930 and BEE 3310; or equivalents." → advisory concurrent', () => {
  const r = parsePrereqs("or corequisites: MATH 2930 and BEE 3310; or equivalents.", null);
  assertEqual(
    "BEE 3500",
    r.prereqExpr,
    adv(and(conc("MATH-2930"), conc("BEE-3310")), "or equivalents"),
    "prereqExpr"
  );
  assertEqual("BEE 3500", r.coreqExpr, null, "coreqExpr");
});

// ── "; or …" clauses (PB1) ────────────────────────────────────────────────────
check('CS 2800 "MATH 1110; CS 1110 or CS 1112; or equivalents." → advisory over the whole', () => {
  const r = parsePrereqs("MATH 1110; CS 1110 or CS 1112; or equivalents.", null);
  assertEqual(
    "CS 2800",
    r.prereqExpr,
    adv(and(course("MATH-1110"), or(course("CS-1110"), course("CS-1112"))), "or equivalents"),
    "prereqExpr"
  );
  assertClass("CS 2800", r, "annotated");
});

check('CS 3700 "…; CS 2800; or permission of instructor." → advisory over the whole', () => {
  const r = parsePrereqs("CS 2110 or ENGRD 2110; CS 2800; or permission of instructor.", null);
  assertEqual(
    "CS 3700",
    r.prereqExpr,
    adv(and(or(course("CS-2110"), course("ENGRD-2110")), course("CS-2800")), "or permission of instructor"),
    "prereqExpr"
  );
});

check('PHYS 1110 coreq "PHYS 1112 or PHYS 1116; or PHYS 2213 or PHYS 2217; or PHYS 2214." → one OR', () => {
  const r = parsePrereqs(null, "PHYS 1112 or PHYS 1116; or PHYS 2213 or PHYS 2217; or PHYS 2214.");
  assertEqual(
    "PHYS 1110",
    r.coreqExpr,
    or(course("PHYS-1112"), course("PHYS-1116"), course("PHYS-2213"), course("PHYS-2217"), course("PHYS-2214")),
    "coreqExpr"
  );
  assertClass("PHYS 1110", r, "clean");
});

check('CS 4820 "CS 2800 and CS 3110; or a minimum grade of A- in CS 2110 or CS 2112 and CS 2800." → two paths', () => {
  const r = parsePrereqs("CS 2800 and CS 3110; or a minimum grade of A- in CS 2110 or CS 2112 and CS 2800.", null);
  assertEqual(
    "CS 4820",
    r.prereqExpr,
    or(
      and(course("CS-2800"), course("CS-3110")),
      and(or(course("CS-2110"), course("CS-2112")), course("CS-2800"))
    ),
    "prereqExpr"
  );
  assertTrue("CS 4820", r.prereqNotes.some((n) => /A-/.test(n)), "the A- grade note keeps its minus");
});

// ── Mixed and/or inside one clause (PB2) ──────────────────────────────────────
check('MAE 3780 "CS 1110/CS 1112 or equivalent programming experience, MATH 2930 and PHYS 2213." keeps MATH 2930 + PHYS 2213 hard', () => {
  const r = parsePrereqs("CS 1110/CS 1112 or equivalent programming experience, MATH 2930 and PHYS 2213.", null);
  assertTrue("MAE 3780", r.prereqExpr?.type === "and", "top level is AND");
  if (r.prereqExpr?.type === "and") {
    assertEqual("MAE 3780", r.prereqExpr.children.slice(1), [course("MATH-2930"), course("PHYS-2213")], "hard MATH 2930 + PHYS 2213");
    assertTrue("MAE 3780", r.prereqExpr.children[0].type === "advisory", "the programming alternative is advisory");
  }
});

check('CEE 3200 "CS 1110 or CS 1112, and MATH 2930. Prerequisite or corequisite: MATH 2940."', () => {
  const r = parsePrereqs("CS 1110 or CS 1112, and MATH 2930. Prerequisite or corequisite: MATH 2940.", null);
  assertEqual(
    "CEE 3200",
    r.prereqExpr,
    and(or(course("CS-1110"), course("CS-1112")), course("MATH-2930"), conc("MATH-2940")),
    "prereqExpr"
  );
});

check('BEE 4500 "MATH 2940, CS 1112, PHYS 1112 and PHYS 2213; and CEE 3040 or permission of instructor."', () => {
  const r = parsePrereqs("MATH 2940, CS 1112, PHYS 1112 and PHYS 2213; and CEE 3040 or permission of instructor.", null);
  assertEqual(
    "BEE 4500",
    r.prereqExpr,
    and(
      course("MATH-2940"),
      course("CS-1112"),
      course("PHYS-1112"),
      course("PHYS-2213"),
      adv(course("CEE-3040"), "or permission of instructor")
    ),
    "prereqExpr"
  );
});

check('CHEM 3570 "CHEM 2080 and CHEM 2081 or permission of instructor." → advisory(and)', () => {
  const r = parsePrereqs("CHEM 2080 and CHEM 2081 or permission of instructor.", null);
  assertEqual(
    "CHEM 3570",
    r.prereqExpr,
    adv(and(course("CHEM-2080"), course("CHEM-2081")), "or permission of instructor"),
    "prereqExpr"
  );
});

check('PHYS 4410 "PHYS 1110; PHYS 2214, or PHYS 2218 and 2210." carries the subject onto 2210', () => {
  const r = parsePrereqs("PHYS 1110; PHYS 2214, or PHYS 2218 and 2210.", null);
  assertEqual(
    "PHYS 4410",
    r.prereqExpr,
    and(course("PHYS-1110"), or(course("PHYS-2214"), and(course("PHYS-2218"), course("PHYS-2210")))),
    "prereqExpr"
  );
});

check('ENGRD 2190 "CHEM 2080 or CHEM 2150, CHEM 2070 or CHEM 2090, and an ENGRI course." → AND of two ORs', () => {
  const r = parsePrereqs("CHEM 2080 or CHEM 2150, CHEM 2070 or CHEM 2090, and an ENGRI course.", null);
  assertEqual(
    "ENGRD 2190",
    r.prereqExpr,
    and(or(course("CHEM-2080"), course("CHEM-2150")), or(course("CHEM-2070"), course("CHEM-2090"))),
    "prereqExpr"
  );
});

check('FDSC 4010 "FDSC 3940, FDSC 4170, and FDSC 4210 or permission of instructor." → permission relaxes the list', () => {
  const r = parsePrereqs("FDSC 3940, FDSC 4170, and FDSC 4210 or permission of instructor.", null);
  assertEqual(
    "FDSC 4010",
    r.prereqExpr,
    adv(and(course("FDSC-3940"), course("FDSC-4170"), course("FDSC-4210")), "or permission of instructor"),
    "prereqExpr"
  );
});

check('MATH 5250 "…, or MATH 2940 or equivalent, and one additional mathematics course…" splits at the last connective', () => {
  const r = parsePrereqs(
    "MATH 2210, MATH 2230-MATH 2240, MATH 2310, or MATH 2940 or equivalent, and one additional mathematics course numbered 3000 or above.",
    null
  );
  assertTrue("MATH 5250", r.prereqExpr?.type === "advisory", "the OR group is advisory");
  if (r.prereqExpr?.type === "advisory") {
    assertEqual(
      "MATH 5250",
      r.prereqExpr.expr,
      or(course("MATH-2210"), and(course("MATH-2230"), course("MATH-2240")), course("MATH-2310"), course("MATH-2940")),
      "advisory body"
    );
  }
});

check('Unrecognised prose beside a course stays clean: "ECON 1110 and a First-Year Writing Seminar."', () => {
  const r = parsePrereqs("ECON 1110 and a First-Year Writing Seminar.", null);
  assertEqual("ECON 1110 + FWS", r.prereqExpr, course("ECON-1110"), "prereqExpr");
  assertClass("ECON 1110 + FWS", r, "clean");
});

// ── Slash pairs (PB3) ─────────────────────────────────────────────────────────
check('Cross-listed slash "ENGRD 2610/MSE 2610 or ENGRD 2620/MSE 2620, and MSE 3110." → OR', () => {
  const r = parsePrereqs("ENGRD 2610/MSE 2610 or ENGRD 2620/MSE 2620, and MSE 3110.", null);
  assertEqual(
    "MSE 3070",
    r.prereqExpr,
    and(or(course("ENGRD-2610"), course("MSE-2610"), course("ENGRD-2620"), course("MSE-2620")), course("MSE-3110")),
    "prereqExpr"
  );
});

check('Same-level slash is a sequence: "PHYS 2217/PHYS 2218, or PHYS 2213/PHYS 2214."', () => {
  const r = parsePrereqs("PHYS 2217/PHYS 2218, or PHYS 2213/PHYS 2214.", null);
  assertEqual(
    "PHYS 3327",
    r.prereqExpr,
    or(and(course("PHYS-2217"), course("PHYS-2218")), and(course("PHYS-2213"), course("PHYS-2214"))),
    "prereqExpr"
  );
});

check('Cross-level slash "ORIE 3300/5300 and ORIE 3500/5500." → undergrad or grad version', () => {
  const r = parsePrereqs("ORIE 3300/5300 and ORIE 3500/5500.", null);
  assertEqual(
    "ORIE 5120",
    r.prereqExpr,
    and(or(course("ORIE-3300"), course("ORIE-5300")), or(course("ORIE-3500"), course("ORIE-5500"))),
    "prereqExpr"
  );
});

// ── AP alternatives (PB4) ─────────────────────────────────────────────────────
check('BEE 2510 "CHEM 2070 or CHEM 2090 or AP Chem." → advisory, never a hard block for AP students', () => {
  const r = parsePrereqs("CHEM 2070 or CHEM 2090 or AP Chem.", "or prerequisites: MATH 2930.");
  assertEqual(
    "BEE 2510",
    r.prereqExpr,
    and(adv(or(course("CHEM-2070"), course("CHEM-2090")), "or AP Chem"), conc("MATH-2930")),
    "prereqExpr"
  );
});

// ── Review findings (2026-10-10) — each a real Cornell string ──────────────────
check('PHYS 1112 coreq: a commentary sentence naming courses is a note, never a requirement', () => {
  const r = parsePrereqs(
    null,
    "PHYS 1110. MATH 1910 may be allowed by instructor in exceptional cases, but continuation in PHYS 2213 will then have to be deferred until MATH 1920 is completed."
  );
  assertEqual("PHYS 1112 coreq", r.coreqExpr, course("PHYS-1110"), "coreqExpr");
  assertTrue("PHYS 1112 coreq", r.prereqNotes.some((n) => /exceptional cases/.test(n)), "the sentence is kept as a note");
});

check('MAE 4020 "MAE 3230 (or equivalent) or MAE 3050; MAE 3270" — a course-less "(or …)" relaxes, never vanishes', () => {
  const r = parsePrereqs("MAE 3230 (or equivalent) or MAE 3050; MAE 3270", null);
  assertEqual(
    "MAE 4020",
    r.prereqExpr,
    and(adv(or(course("MAE-3230"), course("MAE-3050")), "or equivalent"), course("MAE-3270")),
    "prereqExpr"
  );
});

check('VIEN 3610 "VIEN 2204 (or concurrent enrollment)" is advisory, not a hard earlier prereq', () => {
  const r = parsePrereqs(
    "VIEN 1104, VIEN 2204 (or concurrent enrollment), one semester of introductory biology, and one semester of introductory chemistry.",
    null
  );
  assertEqual("VIEN 3610", r.prereqExpr, and(course("VIEN-1104"), adv(course("VIEN-2204"), "or concurrent enrollment")), "prereqExpr");
});

check("Cohort-split prose ORs the cohorts instead of ANDing them", () => {
  const r = parsePrereqs(
    "for Design and Environmental Analysis (DEA) students: DEA 6100; DEA 2730/INFO 3450 or equivalent. Prerequisites for non-DEA students: INFO 4400; INFO 3450/DEA 2730 or equivalent.",
    null
  );
  assertTrue("DEA 6400", r.prereqExpr?.type === "or", "top level is OR across cohorts");
});

check('PHYS 2213 "PHYS 1112 (or strong performance in PHYS 2207) and one of MATH 1920, MATH 2220, or MATH 2240"', () => {
  const r = parsePrereqs("PHYS 1112 (or strong performance in PHYS 2207) and one of MATH 1920, MATH 2220, or MATH 2240", null);
  assertEqual(
    "PHYS 2213",
    r.prereqExpr,
    and(or(course("PHYS-1112"), course("PHYS-2207")), or(course("MATH-1920"), course("MATH-2220"), course("MATH-2240"))),
    "prereqExpr"
  );
});

check('PHYS 2214 "PHYS 2213 (…), plus vector calculus at the level of one of the following: …" keeps PHYS 2213', () => {
  const r = parsePrereqs(
    "PHYS 2213 (or strong performance in PHYS 2208), plus vector calculus at the level of one of the following: MATH 1920, MATH 2220, or MATH 2240.",
    null
  );
  assertEqual(
    "PHYS 2214",
    r.prereqExpr,
    and(or(course("PHYS-2213"), course("PHYS-2208")), or(course("MATH-1920"), course("MATH-2220"), course("MATH-2240"))),
    "prereqExpr"
  );
});

check('"GERST 3000-3209 level course" is a level range, not two courses', () => {
  const r = parsePrereqs("GERST 3000-3209 level course or permission of instructor.", null);
  assertEqual("GERST range", r.prereqExpr, null, "no course nodes");
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
