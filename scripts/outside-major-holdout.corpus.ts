// scripts/outside-major-holdout.corpus.ts
// Asserted, offline corpus for outside-major-holdout.ts. The layer majors and
// the minor are fictional (built in code); one check reads a real Engineering
// slot template from seed-data. Exits nonzero on any mismatch.
//
// Run: npx tsx outside-major-holdout.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { courseMatchesRule } from "../cornell-degree-planner/src/lib/planner/distribution/rules";
import { loadTemplateProgram } from "./check-overlap-fixture";
import type { CourseRule, DistCourse, Layer } from "./layer-authoring";
import {
  anchored,
  applyToRow,
  branches,
  departmentSubjects,
  deriveHoldOut,
  holdOutRule,
  isHoldOut,
  listMajors,
  loadDepartmentTable,
  loadRowSpecs,
  majorDepartmentHoldOut,
  majorHoldOut,
  majorNamesAny,
  makeTwins,
  mentionsProgram,
  pageTitles,
  positivePart,
  programPrefix,
  specProblems,
  withHoldOut,
  type DepartmentTable,
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
  const res = deriveHoldOut(minor, { row: "electives", mode: "major" }, byId, new Map(), [testMajor, self]);
  assertEqual("candidates", res.candidates.length, candidates.length);
  assertEqual("the minor itself holds nothing", Object.keys(res.perMajor), ["cornell-testmajor-bs"]);
  const rule = withHoldOut((minor.rows[0] as unknown as { rule: CourseRule }).rule, holdOutRule(new Map(Object.entries(res.perMajor))));
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

// ─── Department mode, twins, courses mode, limit output, the table ──────────

const table: DepartmentTable = {
  departments: [{ name: "Zoology", subjects: ["ZOO", "ZOH"] }],
  majors: {
    "cornell-testmajor-bs": { department: ["EXT"] },
    "cornell-offline-bs": { notInApp: true, subjects: ["OFF"] },
  },
};

check("departmentSubjects: counted-whole subjects, the main subject, then the table", () => {
  // ZYX is counted whole (subject leaf); ZOO, RRR, VAR, DDD, CCC are named once each: all tie for main.
  assertEqual("no table", departmentSubjects(testMajor, new Map()), ["CCC", "DDD", "RRR", "VAR", "ZOO", "ZYX"]);
  const narrow: MajorSource = {
    prefix: "cornell-narrow-ba",
    programId: "cornell-narrow-ba-2026",
    kind: "layer",
    layers: [{ ...major, id: "cornell-narrow-ba-2026", programId: "cornell-narrow-ba-2026", rows: [row("a", "seat", { rule: { course: ["ZOO-1000"] } }), row("b", "pool", { rule: { course: ["ZOO-2000", "QQQ-2000"] }, requiredCourses: 1, requiredCredits: 0 })] } as unknown as Layer],
  };
  assertEqual("plurality", departmentSubjects(narrow, new Map()), ["ZOO"]);
  assertEqual("department group widens", departmentSubjects(narrow, new Map(), table), ["ZOH", "ZOO"]);
  assertEqual("major entry adds", departmentSubjects(testMajor, new Map(), table).includes("EXT"), true);
  const me = loadTemplateProgram("cornell-me-bs-2026");
  if (!me) return fail("template", "cornell-me-bs-2026 is not in seed-data");
  const meDept = departmentSubjects({ prefix: "cornell-me-bs", programId: me.id, kind: "template", template: me }, new Map());
  assertEqual("ME template: MAE from its core seats", meDept.includes("MAE"), true);
  assertEqual("ME template: common curriculum is not the department", ["MATH", "PHYS", "CHEM", "CS", "ENGRD"].some((s) => meDept.includes(s)), false);
});

check("makeTwins: roster families, page-title pairs for page-only courses, placeholder titles ignored", () => {
  const fam = new Map([["111", ["ZOO-3100", "QQQ-3100"]], ["222", ["AAA-1000"]]]);
  const cands = [course("QQQ-3100"), { ...course("PGE-2000"), title: "Shared Title" }, { ...course("ZOO-2000"), title: "Shared Title" }, { ...course("PLC-1000"), title: "(listed on the catalog page; not in the catalog dump)" }, { ...course("PLD-1000"), title: "(listed on the catalog page; not in the catalog dump)" }];
  const tw = makeTwins(fam, cands, new Map([["PLC-1000", "Page Title"], ["PLD-1000", "Page Title"]]));
  assertEqual("family", tw.of("QQQ-3100"), ["ZOO-3100"]);
  assertEqual("a family of one is no twin", tw.of("AAA-1000"), []);
  assertEqual("title pair", tw.of("PGE-2000"), ["ZOO-2000"]);
  assertEqual("page title", tw.of("PLC-1000"), ["PLD-1000"]);
  assertEqual("placeholder titles alone never pair", makeTwins(new Map(), cands).of("PLC-1000"), []);
  assertEqual("page titles from list lines", [...pageTitles([{ rows: [{ line: "ZOO 1000 | Animals | 3", courseIds: ["ZOO-1000"] }, { line: "ZOO 3306 | 4", courseIds: ["ZOO-3306"] }] }])], [["ZOO-1000", "Animals"]]);
});

check("department mode: department subjects and their cross-listings held, the major's other courses not", () => {
  const fam = new Map([["1", ["ZOO-3100", "QQQ-3100"]]]);
  const cands = [course("ZOO-4000"), course("ZOH-2000"), course("QQQ-3100"), course("RRR-1000"), course("QQQ-3000")];
  const narrow: MajorSource = { prefix: "cornell-narrow-ba", programId: "cornell-narrow-ba-2026", kind: "layer", layers: [{ ...major, rows: [row("a", "seat", { rule: { course: ["ZOO-1000"] } })] } as unknown as Layer] };
  const h = majorDepartmentHoldOut(narrow, cands, new Map(), makeTwins(fam, cands), table);
  assertEqual("subjects", h.subjects, ["ZOH", "ZOO"]);
  assertEqual("cross-listed course", h.courses, ["QQQ-3100"]);
  const off = listMajors(undefined, undefined, table).find((m) => m.prefix === "cornell-offline-bs");
  assertEqual("a notInApp major is listed with its subjects", off && off.kind === "offline" ? off.subjects : null, ["OFF"]);
  assertEqual("no table, no offline majors", listMajors().some((m) => m.kind === "offline"), false);
});

check("major mode with twins: a cross-listing of a held or home-subject course is held", () => {
  const fam = new Map([["1", ["ZOO-3100", "QQQ-3100"]], ["2", ["DDD-2000", "QQQ-2000"]]]);
  const cands = [course("QQQ-3100"), course("QQQ-2000"), course("DDD-2000"), course("QQQ-3000")];
  const plain = majorHoldOut(testMajor, cands, new Map());
  const twinned = majorHoldOut(testMajor, cands, new Map(), makeTwins(fam, cands));
  assertEqual("without twins", plain.courses, ["DDD-2000"]);
  assertEqual("with twins", twinned.courses, ["DDD-2000", "QQQ-2000", "QQQ-3100"]);
});

check("courses mode: holdOut courses held only for majors whose requirements name a requires course", () => {
  const cands = [course("RRR-1000"), course("QQQ-3000"), course("CCC-3000")];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const other: MajorSource = { prefix: "cornell-other-ba", programId: "cornell-other-ba-2026", kind: "layer", layers: [{ ...major, rows: [row("x", "pool", { rule: { subject: ["RRR"] }, requiredCourses: 1, requiredCredits: 0 })] } as unknown as Layer] };
  assertEqual("names it", majorNamesAny(testMajor, [course("RRR-1000")], byId), true);
  assertEqual("a subject leaf is not naming", majorNamesAny(other, [course("RRR-1000")], byId), false);
  const m2: Layer = { ...minor, rows: [row("core", "seat", { rule: { course: cands.map((c) => c.id) } })] } as unknown as Layer;
  const res = deriveHoldOut(m2, { row: "core", mode: "courses", requires: ["RRR-1000"], holdOut: ["RRR-1000", "CCC-3000"] }, byId, new Map(), [testMajor, other]);
  assertEqual("held for the naming major only", res.perMajor, { "cornell-testmajor-bs": { courses: ["CCC-3000", "RRR-1000"], subjects: [] } });
  const me = loadTemplateProgram("cornell-me-bs-2026");
  if (me) assertEqual("a template seat pattern names CS 1110", majorNamesAny({ prefix: "cornell-me-bs", programId: me.id, kind: "template", template: me }, [course("CS-1110")], new Map()), true);
});

check("applyToRow: limit output replaces program-naming limits only; max over inside, min over outside", () => {
  const per = new Map<string, { courses: string[]; subjects: string[] }>([["cornell-testmajor-bs", { courses: ["QQQ-3000"], subjects: ["ZOO"] }]]);
  const src = { id: "r", rule: { allOf: [{ course: ["QQQ-3000", "ZOO-4000", "RRR-1000"] }, { not: { anyOf: [{ allOf: [{ course: ["X-1"] }, { program: ["p"] }] }] } }] } as CourseRule, limits: [{ rule: { course: ["RRR-1000"] } as CourseRule, maxCourses: 1 }, { rule: { allOf: [{ subject: ["ZOO"] }, { program: ["old"] }] } as CourseRule, maxCourses: 1 }] };
  const maxed = applyToRow(src, { output: { limit: { maxCourses: 1, label: "L" } } }, per);
  assertEqual("rule loses its hold-out", maxed.rule, { course: ["QQQ-3000", "ZOO-4000", "RRR-1000"] });
  assertEqual("kept the plain limit, replaced the program one", maxed.limits!.map((l) => l.maxCourses), [1, 1]);
  const inside = maxed.limits![1].rule;
  const pid = { programId: "cornell-testmajor-bs-2026" };
  assertEqual("inside for the major", ["QQQ-3000", "ZOO-4000", "RRR-1000"].map((id) => courseMatchesRule(course(id), inside, pid)), [true, true, false]);
  assertEqual("nothing inside for another major", courseMatchesRule(course("ZOO-4000"), inside, { programId: "cornell-other-ba-2026" }), false);
  const minned = applyToRow(src, { output: { limit: { minCourses: 1 } } }, per);
  const outside = minned.limits![1].rule;
  assertEqual("min limit counts outside courses", [courseMatchesRule(course("RRR-1000"), outside, pid), courseMatchesRule(course("ZOO-4000"), outside, pid)], [true, false]);
  assertEqual("min limit is a hold-out", isHoldOut(outside), true);
  assertEqual("hold-out output is idempotent", applyToRow(applyToRow(src, {}, per), {}, per), applyToRow(src, {}, per));
  assertEqual("no majors: no managed limit", applyToRow(src, { output: { limit: { maxCourses: 1 } } }, new Map()).limits!.length, 1);
  assertEqual("mentionsProgram", [mentionsProgram({ not: { allOf: [{ program: ["x"] }] } }), mentionsProgram({ course: ["A-1"] })], [true, false]);
});

check("specs and the table: bad specs and over-long prefixes are refused", () => {
  assertEqual("courses mode needs its lists", specProblems({ program: "p", row: "r", mode: "courses" }).length, 1);
  assertEqual("limit needs one bound", specProblems({ program: "p", row: "r", mode: "major", output: { limit: { maxCourses: 1, minCourses: 1 } } }).length, 1);
  assertEqual("a good spec", specProblems({ program: "p", row: "r", mode: "department", output: { limit: { maxCourses: 1 } } }), []);
  const tmp = join(mkdtempSync(join(tmpdir(), "omh-")), "t.json");
  writeFileSync(tmp, JSON.stringify({ departments: [], majors: { ["cornell-" + "x".repeat(40)]: { notInApp: true, subjects: ["X"] } } }));
  let refused = false;
  try {
    loadDepartmentTable(tmp);
  } catch {
    refused = true;
  }
  assertEqual("long prefix", refused, true);
  for (const s of loadRowSpecs()) assertEqual(`committed spec ${s.program}/${s.row}`, specProblems(s), []);
  const committed = loadDepartmentTable();
  assertEqual("committed table loads", committed.departments.length > 0, true);
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
