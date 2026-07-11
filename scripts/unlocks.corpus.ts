// scripts/unlocks.corpus.ts
// Asserted, offline corpus runner for the sync-time "unlocks" reverse index
// (spec 008 §3a, Unit 8A — scripts/catalog-index.ts collectPrereqRefs /
// buildUnlocksIndex / buildIndexRecords). NO network calls — every fixture is a
// hand-built course-doc-shaped object. Exits nonzero on any mismatch, same
// contract as scripts/roster-convert.corpus.ts.
//
// Run: npx tsx unlocks.corpus.ts   (from the scripts/ folder)

import {
  buildIndexRecords,
  buildUnlocksIndex,
  collectPrereqRefs,
  UNLOCKS_CAP,
  type PrereqRefs,
} from "./catalog-index";

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

function emptyRefs(): PrereqRefs {
  return { ids: new Set(), patterns: new Set() };
}

// ── collectPrereqRefs — the pure tree-reference helper ──────────────────────

check("collectPrereqRefs: direct course id ref", () => {
  const refs = emptyRefs();
  collectPrereqRefs({ type: "course", id: "CS-1110" }, refs);
  assertEqual("ids", [...refs.ids], ["CS-1110"]);
  assertEqual("patterns", [...refs.patterns], []);
});

check("collectPrereqRefs: concurrent id ref", () => {
  const refs = emptyRefs();
  collectPrereqRefs({ type: "concurrent", id: "MATH-1920" }, refs);
  assertEqual("ids", [...refs.ids], ["MATH-1920"]);
});

check("collectPrereqRefs: advisory inner ref descends", () => {
  const refs = emptyRefs();
  collectPrereqRefs(
    { type: "advisory", expr: { type: "course", id: "MATH-1910" }, note: "n" },
    refs
  );
  assertEqual("advisory inner id collected", [...refs.ids], ["MATH-1910"]);
});

check("collectPrereqRefs: pattern node recorded (not expanded here)", () => {
  const refs = emptyRefs();
  collectPrereqRefs({ type: "pattern", pattern: "CS-2xxx" }, refs);
  assertEqual("patterns", [...refs.patterns], ["CS-2xxx"]);
  assertEqual("ids empty", [...refs.ids], []);
});

check("collectPrereqRefs: and/or recursion collects every child", () => {
  const refs = emptyRefs();
  collectPrereqRefs(
    {
      type: "and",
      children: [
        { type: "course", id: "CS-1110" },
        { type: "or", children: [{ type: "course", id: "CS-1112" }, { type: "pattern", pattern: "MATH-1xxx" }] },
      ],
    },
    refs
  );
  assertEqual("ids", [...refs.ids].sort(), ["CS-1110", "CS-1112"]);
  assertEqual("patterns", [...refs.patterns], ["MATH-1xxx"]);
});

check("collectPrereqRefs: null/undefined/malformed input never throws", () => {
  const refs = emptyRefs();
  collectPrereqRefs(null, refs);
  collectPrereqRefs(undefined, refs);
  collectPrereqRefs({ type: "and", children: null }, refs);
  collectPrereqRefs("not an object", refs);
  assertEqual("still empty", { ids: [...refs.ids], patterns: [...refs.patterns] }, {
    ids: [],
    patterns: [],
  });
});

check("collectPrereqRefs: cyclic tree does not hang", () => {
  const cyclic: any = { type: "and", children: [] };
  cyclic.children.push(cyclic);
  const refs = emptyRefs();
  const start = Date.now();
  collectPrereqRefs(cyclic, refs);
  assertTrue("returned quickly", Date.now() - start < 1000, "took too long — possible hang");
});

// ── buildUnlocksIndex / buildIndexRecords — the sync-time reverse index ─────

check("direct id ref: MATH-2940 requires MATH-1910 → MATH-1910 unlocks MATH-2940", () => {
  const courses = [
    { id: "MATH-1910", subject: "MATH", number: "1910", prereqExpr: null, coreqExpr: null },
    {
      id: "MATH-2940",
      subject: "MATH",
      number: "2940",
      prereqExpr: { type: "course", id: "MATH-1910" },
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("MATH-1910 unlocks", unlocksById.get("MATH-1910"), ["MATH-2940"]);
  assertEqual("MATH-2940 unlocks nothing", unlocksById.get("MATH-2940") ?? [], []);
});

check("concurrent ref: PHYS-2213 concurrent-requires MATH-1920 → MATH-1920 unlocks PHYS-2213", () => {
  const courses = [
    { id: "MATH-1920", subject: "MATH", number: "1920", prereqExpr: null, coreqExpr: null },
    {
      id: "PHYS-2213",
      subject: "PHYS",
      number: "2213",
      prereqExpr: { type: "concurrent", id: "MATH-1920" },
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("MATH-1920 unlocks via concurrent leaf", unlocksById.get("MATH-1920"), ["PHYS-2213"]);
});

check("advisory inner ref: MATH-2940 advisory-requires MATH-1910 → still counts as unlock", () => {
  const courses = [
    { id: "MATH-1910", subject: "MATH", number: "1910", prereqExpr: null, coreqExpr: null },
    {
      id: "MATH-2940",
      subject: "MATH",
      number: "2940",
      prereqExpr: {
        type: "advisory",
        expr: { type: "course", id: "MATH-1910" },
        note: "or equivalent AP credit",
      },
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("MATH-1910 unlocks via advisory inner ref", unlocksById.get("MATH-1910"), ["MATH-2940"]);
});

check("pattern expansion: 'CS-2xxx' unlocks from a CS 2110 doc among others", () => {
  const courses = [
    { id: "CS-2110", subject: "CS", number: "2110", prereqExpr: null, coreqExpr: null },
    { id: "CS-2112", subject: "CS", number: "2112", prereqExpr: null, coreqExpr: null },
    { id: "CS-3110", subject: "CS", number: "3110", prereqExpr: null, coreqExpr: null }, // not 2xxx
    {
      id: "CS-4999",
      subject: "CS",
      number: "4999",
      prereqExpr: { type: "pattern", pattern: "CS-2xxx" },
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("CS-2110 unlocks CS-4999 via pattern", unlocksById.get("CS-2110"), ["CS-4999"]);
  assertEqual("CS-2112 unlocks CS-4999 via pattern", unlocksById.get("CS-2112"), ["CS-4999"]);
  assertEqual("CS-3110 (non-matching) unlocks nothing", unlocksById.get("CS-3110") ?? [], []);
});

check("self-exclusion: a course whose own tree references its own id never unlocks itself", () => {
  const courses = [
    {
      id: "CS-1110",
      subject: "CS",
      number: "1110",
      prereqExpr: { type: "course", id: "CS-1110" }, // malformed/self-referential
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("CS-1110 unlocks nothing (self excluded)", unlocksById.get("CS-1110") ?? [], []);
});

check("self-exclusion also applies through pattern expansion", () => {
  const courses = [
    {
      id: "CS-4410",
      subject: "CS",
      number: "4410",
      prereqExpr: { type: "pattern", pattern: "CS-4xxx" }, // matches itself
      coreqExpr: null,
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("CS-4410 unlocks nothing (self excluded via pattern)", unlocksById.get("CS-4410") ?? [], []);
});

check("cap overflow: >200 dependents on one course are capped and counted", () => {
  const target = { id: "CS-1110", subject: "CS", number: "1110", prereqExpr: null, coreqExpr: null };
  const dependents = Array.from({ length: UNLOCKS_CAP + 5 }, (_, i) => ({
    id: `CS-${9000 + i}`,
    subject: "CS",
    number: String(9000 + i),
    prereqExpr: { type: "course", id: "CS-1110" },
    coreqExpr: null,
  }));
  const { unlocksById, stats } = buildUnlocksIndex([target, ...dependents]);
  assertEqual("capped at UNLOCKS_CAP", unlocksById.get("CS-1110")?.length, UNLOCKS_CAP);
  assertEqual("overflow counted for exactly 1 course", stats.overflowCount, 1);
  const sorted = [...(unlocksById.get("CS-1110") ?? [])];
  const alsoSorted = [...sorted].sort((a, b) => a.localeCompare(b));
  assertEqual("alphabetical for determinism", sorted, alsoSorted);
});

check("coreq_expr also feeds the unlocks index", () => {
  const courses = [
    { id: "CHEM-2080", subject: "CHEM", number: "2080", prereqExpr: null, coreqExpr: null },
    {
      id: "CHEM-2081",
      subject: "CHEM",
      number: "2081",
      prereqExpr: null,
      coreqExpr: { type: "course", id: "CHEM-2080" },
    },
  ];
  const { unlocksById } = buildUnlocksIndex(courses);
  assertEqual("CHEM-2080 unlocks CHEM-2081 via coreq_expr", unlocksById.get("CHEM-2080"), ["CHEM-2081"]);
});

check("buildIndexRecords: unlocks field is wired onto each IndexRecord, alphabetical, capped", () => {
  const courses = [
    { id: "CS-1110", subject: "CS", number: "1110", title: "A", creditsMin: 4, creditsMax: 4, prereqExpr: null, offered: [] },
    {
      id: "CS-2110",
      subject: "CS",
      number: "2110",
      title: "B",
      creditsMin: 4,
      creditsMax: 4,
      prereqExpr: { type: "course", id: "CS-1110" },
      offered: [],
    },
    {
      id: "CS-2112",
      subject: "CS",
      number: "2112",
      title: "C",
      creditsMin: 4,
      creditsMax: 4,
      prereqExpr: { type: "course", id: "CS-1110" },
      offered: [],
    },
  ];
  const records = buildIndexRecords(courses);
  const cs1110 = records.find((r) => r.id === "CS-1110");
  assertEqual("CS-1110.unlocks", cs1110?.unlocks, ["CS-2110", "CS-2112"]);
  const cs2110 = records.find((r) => r.id === "CS-2110");
  assertEqual("CS-2110.unlocks empty", cs2110?.unlocks, []);
});

check("buildIndexRecords: unlocksStats out-param accumulates overflow across the whole dump", () => {
  const target = { id: "CS-1110", subject: "CS", number: "1110", title: "A", creditsMin: 4, creditsMax: 4, prereqExpr: null, offered: [] };
  const dependents = Array.from({ length: UNLOCKS_CAP + 3 }, (_, i) => ({
    id: `CS-${9000 + i}`,
    subject: "CS",
    number: String(9000 + i),
    title: `dep ${i}`,
    creditsMin: 4,
    creditsMax: 4,
    prereqExpr: { type: "course", id: "CS-1110" },
    offered: [],
  }));
  const stats = { overflowCount: 0 };
  buildIndexRecords([target, ...dependents], stats);
  assertEqual("overflow reported through the stats out-param", stats.overflowCount, 1);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── unlocks corpus — ${checks.length} case(s) ──`);
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
