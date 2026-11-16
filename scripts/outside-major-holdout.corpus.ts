// scripts/outside-major-holdout.corpus.ts
// Asserted, offline corpus for outside-major-holdout.ts. The layer majors and
// the minor are fictional (built in code); one check reads a real Engineering
// slot template from seed-data. Exits nonzero on any mismatch.
//
// Run: npx tsx outside-major-holdout.corpus.ts   (from the scripts/ folder)

import { courseMatchesRule } from "../cornell-degree-planner/src/lib/planner/distribution/rules";
import { loadTemplateProgram } from "./check-overlap-fixture";
import type { CourseRule, DistCourse, Layer } from "./layer-authoring";
import {
  anchored,
  branches,
  deriveHoldOut,
  holdOutRule,
  isHoldOut,
  majorHoldOut,
  positivePart,
  programPrefix,
  withHoldOut,
  type MajorSource,
} from "./outside-major-holdout";

type Check = { name: string; fn: () => void };
const checks: Check[] = [];
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

const course = (id: string, credits = 3, creditsMax?: number): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits, ...(creditsMax != null ? { creditsMax } : {}), attrs: [] };
};
const src = { url: "https://example.edu/test", anchor: "Requirements" };
const row = (id: string, kind: string, extra: Record<string, unknown>) => ({ id, label: id, group: "G", source: src, kind, ...extra });

// A fictional major: a required ZOO seat (home subject ZOO), a ZYX subject
// pool from 3000 (home subject ZYX), a named list with a 3-credit floor, a
// distribution category, a free elective by level only, and a confirm row.
const major: Layer = {
  id: "cornell-testmajor-bs-2026",
  kind: "major",
  family: "cals",
  name: "Test Major",
  catalogYear: "2026-27",
  programId: "cornell-testmajor-bs-2026",
  rows: [
    row("core", "seat", { rule: { course: ["ZOO-2000"] } }),
    row("dept", "pool", { rule: { allOf: [{ subject: ["ZYX"] }, { number: { min: 3000 } }] }, requiredCourses: 2, requiredCredits: 0 }),
    row("named", "pool", { rule: { allOf: [{ course: ["RRR-1000", "VAR-3000"] }, { minCredits: 3 }] }, requiredCourses: 1, requiredCredits: 0 }),
    row("spread", "distribution", { categories: [{ id: "a", label: "A", rule: { course: ["DDD-2000"] } }], requiredCourses: 1, minDistinctCategories: 1 }),
    row("free", "pool", { rule: { number: { min: 3000 } }, requiredCourses: 1, requiredCredits: 0 }),
    row("outside", "pool", { rule: { allOf: [{ not: { subject: ["ZYX"] } }, { number: { min: 2000 } }] }, requiredCourses: 1, requiredCredits: 0 }),
    row("ok", "confirm", {}),
  ],
} as unknown as Layer;
// A concentration of it naming one more course.
const conc: Layer = {
  id: "cornell-testmajor-bs-2026--focus",
  kind: "concentration",
  family: "cals",
  name: "Test Major: Focus",
  catalogYear: "2026-27",
  programId: "cornell-testmajor-bs-2026",
  concentrationId: "focus",
  courseSharing: "shared",
  rows: [row("focus", "pool", { rule: { anyOf: [{ course: ["CCC-3000"] }, { number: { min: 4000 } }] }, requiredCourses: 1, requiredCredits: 0 })],
} as unknown as Layer;
const testMajor: MajorSource = { prefix: "cornell-testmajor-bs", programId: "cornell-testmajor-bs-2026", kind: "layer", layers: [major, conc] };

const candidates = [
  course("ZOO-4000"), // home subject (required seat)
  course("ZYX-1000"), // home subject (subject pool), below the pool's floor
  course("RRR-1000", 2), // named, under the credit floor: still the major's
  course("VAR-3000", 2, 4), // named, variable credit
  course("DDD-2000"), // a distribution category
  course("CCC-3000"), // the concentration's named course
  course("QQQ-3000"), // only the free and outside electives admit it
  course("QQQ-4500"), // only the concentration's level-only branch admits it
];

check("anchored: names courses or subjects, never by level, attribute or exclusion alone", () => {
  assertEqual("course", anchored({ course: ["A-1000"] }), true);
  assertEqual("subject+number", anchored({ allOf: [{ subject: ["A"] }, { number: { min: 3000 } }] }), true);
  assertEqual("number", anchored({ number: { min: 3000 } }), false);
  assertEqual("tag", anchored({ tag: ["X"] }), false);
  assertEqual("not subject", anchored({ allOf: [{ not: { subject: ["A"] } }, { number: { min: 2000 } }] }), false);
  assertEqual("anyOf with an open branch", anchored({ anyOf: [{ course: ["A-1000"] }, { number: { min: 4000 } }] }), false);
});

check("branches: anyOf splits, allOf distributes over a nested anyOf", () => {
  const r: CourseRule = { allOf: [{ number: { min: 3000 } }, { anyOf: [{ subject: ["A"] }, { subject: ["B"] }] }] };
  assertEqual("two branches", branches(r), [
    { allOf: [{ number: { min: 3000 } }, { subject: ["A"] }] },
    { allOf: [{ number: { min: 3000 } }, { subject: ["B"] }] },
  ]);
  assertEqual("concentration anyOf", branches({ anyOf: [{ course: ["CCC-3000"] }, { number: { min: 4000 } }] }).length, 2);
});

check("layer major: named, matched and home-subject courses held; free electives not", () => {
  const h = majorHoldOut(testMajor, candidates, new Map());
  assertEqual("subjects", h.subjects, ["ZOO", "ZYX"]);
  assertEqual("courses", h.courses, ["CCC-3000", "DDD-2000", "RRR-1000", "VAR-3000"]);
});

check("Engineering template: department subject and list courses held, open groups not", () => {
  const me = loadTemplateProgram("cornell-me-bs-2026");
  if (!me) return fail("template", "cornell-me-bs-2026 is not in seed-data");
  const cands = [course("MAE-4180"), course("ENGRI-1200"), course("ZZQ-3000")];
  const h = majorHoldOut({ prefix: "cornell-me-bs", programId: me.id, kind: "template", template: me }, cands, new Map());
  assertEqual("MAE is home", h.subjects.includes("MAE"), true);
  assertEqual("ENGRI seat", h.courses.includes("ENGRI-1200"), true);
  assertEqual("a fictional course only open groups admit", h.courses.includes("ZZQ-3000") || h.subjects.includes("ZZQ"), false);
});

const minor: Layer = {
  id: "cornell-testminor-minor-2026",
  kind: "minor",
  family: "cals",
  name: "Test Minor",
  catalogYear: "2026-27",
  programId: "cornell-testminor-minor-2026",
  rows: [row("electives", "pool", { rule: { course: candidates.map((c) => c.id) }, requiredCourses: 2, requiredCredits: 0 })],
} as unknown as Layer;

check("deriveHoldOut: the rule holds out exactly the major's courses, for that major only", () => {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const self: MajorSource = { prefix: "cornell-testminor-minor", programId: minor.id, kind: "layer", layers: [major] };
  const res = deriveHoldOut(minor, "electives", byId, new Map(), [testMajor, self]);
  assertEqual("candidates", res.candidates.length, candidates.length);
  assertEqual("the minor itself holds nothing", Object.keys(res.perMajor), ["cornell-testmajor-bs"]);
  const rule = withHoldOut((minor.rows[0] as unknown as { rule: CourseRule }).rule, res.rule);
  const counted = (pid: string) => candidates.filter((c) => courseMatchesRule(c, rule, { programId: pid })).map((c) => c.id);
  assertEqual("test major", counted("cornell-testmajor-bs-2026"), ["QQQ-3000", "QQQ-4500"]);
  assertEqual("another major", counted("cornell-other-ba-2026").length, candidates.length);
  assertEqual("a second major on the plan", candidates.filter((c) => courseMatchesRule(c, rule, { programId: "cornell-other-ba-2026", additionalProgramIds: ["cornell-testmajor-bs-2026"] })).length, 2);
});

check("holdOutRule: over 40 branches nests chunks; positivePart/withHoldOut round-trip", () => {
  const per = new Map<string, { courses: string[]; subjects: string[] }>();
  for (let i = 0; i < 45; i++) per.set(`cornell-m${String(i).padStart(2, "0")}-ba`, { courses: [`AAA-${1000 + i}`], subjects: [] });
  const h = holdOutRule(per)!;
  const inner = (h as { not: { anyOf: CourseRule[] } }).not.anyOf;
  assertEqual("two chunks", inner.length, 2);
  assertEqual("chunk sizes", inner.map((c) => (c as { anyOf: CourseRule[] }).anyOf.length), [40, 5]);
  assertEqual("recognized", isHoldOut(h), true);
  const pos: CourseRule = { course: ["AAA-1000", "AAA-1044"] };
  const full = withHoldOut(pos, h);
  assertEqual("positive part", positivePart(full), pos);
  assertEqual("replace is idempotent", withHoldOut(full, h), full);
  assertEqual("held for its major", courseMatchesRule(course("AAA-1044"), full, { programId: "cornell-m44-ba-2026" }), false);
  assertEqual("free for another", courseMatchesRule(course("AAA-1044"), full, { programId: "cornell-m00-ba-2026" }), true);
  assertEqual("no hold-out leaves the rule bare", withHoldOut(full, null), pos);
  assertEqual("a plain not is not a hold-out", isHoldOut({ not: { course: ["A-1000"] } }), false);
});

check("programPrefix drops only a trailing catalog year", () => {
  assertEqual("year", programPrefix("cornell-cs-bs-2026"), "cornell-cs-bs");
  assertEqual("no year", programPrefix("cornell-cs-bs"), "cornell-cs-bs");
});

for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.stack ?? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
}

console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
