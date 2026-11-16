// scripts/check-overlap-fixture.corpus.ts
// Asserted, offline corpus for check-overlap-fixture.ts (spec 047 D7/D12). NO
// network, no catalog dump: an invented major, an invented minor and invented
// courses below. Exits nonzero on any mismatch.
//
// Run: npx tsx check-overlap-fixture.corpus.ts   (from the scripts/ folder)

import {
  capOf,
  loadTemplateProgram,
  overlapKeyProblems,
  pairLimit,
  rowCountsForOverlap,
  runOverlapFixture,
  runTemplateOverlapFixture,
  serializeOverlapFixture,
  stricter,
  templateSha256,
  type OverlapFixture,
  type TemplateProgram,
} from "./check-overlap-fixture";
import type { DistCourse, Layer } from "./layer-authoring";

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

// ── Fixtures (invented) ─────────────────────────────────────────────────────
const SRC = { url: "https://catalog.cornell.edu/programs/invented/", anchor: "Requirements" };
const fict = (n: string, credits = 3): DistCourse => ({ id: `FICT-${n}`, subject: "FICT", number: n, title: `Invented ${n}`, attrs: [], credits });
const COURSES = ["1000", "2000", "2100", "2200"].map((n) => fict(n));
const upper = { allOf: [{ subject: ["FICT"] }, { number: { min: 2000 } }] };

const MAJOR: Layer = {
  id: "invented-ba-2031",
  kind: "major",
  family: "cas",
  name: "Invented Studies (BA)",
  catalogYear: "2031-32",
  programId: "invented-ba-2031",
  rows: [
    { id: "m-core", kind: "seat", label: "Core", group: "Core", source: SRC, rule: { course: ["FICT-1000"] } },
    { id: "m-electives", kind: "pool", label: "Three upper-level courses", group: "Electives", source: SRC, rule: upper, requiredCourses: 3, requiredCredits: 0 },
  ],
} as Layer;

const MINOR: Layer = {
  id: "fiction-minor-2031",
  kind: "minor",
  family: "other",
  name: "Fiction (Minor)",
  catalogYear: "2031-32",
  programId: "fiction-minor-2031",
  sharing: { otherMajors: { maxCourses: 1 } },
  rows: [{ id: "n-courses", kind: "pool", label: "Three upper-level courses", group: "Courses", source: SRC, rule: upper, requiredCourses: 3, requiredCredits: 0 }],
} as Layer;

function cleanFixture(): OverlapFixture {
  return {
    programId: MINOR.id,
    description: "An invented major and minor that share three upper-level courses.",
    layerIds: [MAJOR.id, MINOR.id],
    ctx: { programId: MAJOR.id, entryTerm: "FA31", transfer: "none" },
    plan: ["FICT-1000", "FICT-2000", "FICT-2100", "FICT-2200"],
    limit: { maxCourses: 1 },
    shared: ["FICT-2000", "FICT-2100", "FICT-2200"],
    heldBack: [
      { courseId: "FICT-2100", from: MINOR.id, why: "Only one course may count for both." },
      { courseId: "FICT-2200", from: MINOR.id, why: "Only one course may count for both." },
    ],
    courses: COURSES,
  };
}
const fx = (edit: (f: OverlapFixture) => void): OverlapFixture => {
  const f = JSON.parse(JSON.stringify(cleanFixture())) as OverlapFixture;
  edit(f);
  return f;
};
const minorWith = (sharing: Layer["sharing"]): Layer => ({ ...MINOR, sharing } as Layer);
const has = (problems: string[], re: RegExp) => problems.some((p) => re.test(p));

// ── Limits ──────────────────────────────────────────────────────────────────
check("capOf / stricter / pairLimit: none, with-scoping, the stricter bound of each side", () => {
  assertEqual("absent", capOf(undefined, "x"), null);
  assertEqual("none", capOf("none", "x"), { maxCourses: 0 });
  assertEqual("with matches a year", capOf({ maxCredits: 12, with: ["invented-ba"] }, "invented-ba-2031"), { maxCredits: 12 });
  assertEqual("with misses", capOf({ maxCredits: 12, with: ["other-ba"] }, "invented-ba-2031"), null);
  assertEqual("bounds mixed", stricter({ maxCourses: 2 }, { maxCourses: 1, maxCredits: 6 }), { maxCourses: 1, maxCredits: 6 });
  assertEqual("minor side only", pairLimit(MAJOR, MINOR), { maxCourses: 1 });
  const majorCap = { ...MAJOR, sharing: { minors: { maxCourses: 0 } } } as Layer;
  assertEqual("major side stricter", pairLimit(majorCap, MINOR), { maxCourses: 0 });
  assertEqual("no limit", pairLimit(MAJOR, minorWith(undefined)), null);
});

check("overlap rows: consuming and credits rows count, overlay and confirm rows don't", () => {
  const l = {
    ...MAJOR,
    rows: [
      ...MAJOR.rows,
      { id: "c", kind: "credits", label: "Credits", group: "G", source: SRC, rule: upper, requiredCredits: 9 },
      { id: "o", kind: "pool", label: "Overlay", group: "G", source: SRC, rule: upper, requiredCourses: 1, requiredCredits: 0, overlay: true },
      { id: "k", kind: "confirm", label: "Confirm", group: "G", source: SRC },
    ],
  } as Layer;
  assertEqual("rows", ["m-core", "c", "o", "k", "nope"].map((id) => rowCountsForOverlap(l, id)), [true, true, false, false, false]);
});

// ── The fixture ─────────────────────────────────────────────────────────────
check("clean: the limit binds, the hold-back brings the pair within it", () => {
  const r = runOverlapFixture([MAJOR, MINOR], cleanFixture());
  assertEqual("problems", r.problems, []);
  assertEqual("ok", r.ok, true);
  assertEqual("shared before", r.sharedBefore, ["FICT-2000", "FICT-2100", "FICT-2200"]);
  assertEqual("shared after", r.sharedAfter, ["FICT-2000"]);
  assertEqual("minor complete before, short after", [r.pctBefore[MINOR.id], r.pctAfter[MINOR.id] < 100], [100, true]);
});

check("declared limit and shared set must match the layers", () => {
  assertTrue("limit", has(runOverlapFixture([MAJOR, MINOR], fx((f) => (f.limit = { maxCourses: 2 }))).problems, /fixture's limit is at most 2/), "limit");
  assertTrue("shared", has(runOverlapFixture([MAJOR, MINOR], fx((f) => (f.shared = ["FICT-2000"]))).problems, /shared courses are/), "shared");
});

check("a limit that does not bind, or no limit, fails", () => {
  const loose = minorWith({ otherMajors: { maxCourses: 3 } });
  const r = runOverlapFixture([MAJOR, loose], fx((f) => (f.limit = { maxCourses: 3 })));
  assertTrue("does not bind", has(r.problems, /does not bind/), JSON.stringify(r.problems));
  const none = runOverlapFixture([MAJOR, minorWith(undefined)], cleanFixture());
  assertTrue("no limit", has(none.problems, /set no limit/), JSON.stringify(none.problems));
});

check("heldBack: too little, not shared, wrong program, twice, empty, no why", () => {
  const little = runOverlapFixture([MAJOR, MINOR], fx((f) => (f.heldBack = f.heldBack.slice(0, 1))));
  assertTrue("still over", has(little.problems, /still shares/), JSON.stringify(little.problems));
  const notShared = runOverlapFixture([MAJOR, MINOR], fx((f) => f.heldBack.push({ courseId: "FICT-1000", from: MINOR.id, why: "x" })));
  assertTrue("not shared", has(notShared.problems, /FICT-1000 is not a shared course/), JSON.stringify(notShared.problems));
  const wrongFrom = runOverlapFixture([MAJOR, MINOR], fx((f) => (f.heldBack[0].from = "elsewhere")));
  assertTrue("wrong from", has(wrongFrom.problems, /neither/), JSON.stringify(wrongFrom.problems));
  const twice = runOverlapFixture([MAJOR, MINOR], fx((f) => f.heldBack.push({ ...f.heldBack[0] })));
  assertTrue("twice", has(twice.problems, /twice/), JSON.stringify(twice.problems));
  const empty = runOverlapFixture([MAJOR, MINOR], fx((f) => (f.heldBack = [])));
  assertTrue("empty", has(empty.problems, /heldBack is empty/), JSON.stringify(empty.problems));
  const noWhy = runOverlapFixture([MAJOR, MINOR], fx((f) => (f.heldBack[0].why = " ")));
  assertTrue("no why", has(noWhy.problems, /needs a why/), JSON.stringify(noWhy.problems));
  const fromMajor = runOverlapFixture([MAJOR, MINOR], fx((f) => f.heldBack.forEach((h) => (h.from = MAJOR.id))));
  assertEqual("holding back from the major works too", fromMajor.problems, []);
});

check("layers: major then minor, named for the minor, ctx is the major's; the plan completes the minor", () => {
  assertTrue("order", has(runOverlapFixture([MINOR, MAJOR], fx((f) => (f.layerIds = [MINOR.id, MAJOR.id]))).problems, /must be a major/), "order");
  assertTrue("named for the minor", has(runOverlapFixture([MAJOR, MINOR], fx((f) => (f.programId = MAJOR.id))).problems, /fixture is for/), "name");
  assertTrue("ctx", has(runOverlapFixture([MAJOR, MINOR], fx((f) => (f.ctx.programId = "someone-else"))).problems, /ctx.programId/), "ctx");
  const short = runOverlapFixture([MAJOR, MINOR], fx((f) => ((f.plan = ["FICT-1000", "FICT-2000", "FICT-2100"]), (f.shared = ["FICT-2000", "FICT-2100"]), (f.heldBack = f.heldBack.slice(0, 1)))));
  assertTrue("minor incomplete", has(short.problems, /does not complete the minor/), JSON.stringify(short.problems));
  assertTrue("unknown course", has(runOverlapFixture([MAJOR, MINOR], fx((f) => (f.courses = f.courses.slice(1)))).problems, /no course data/), "courses");
});

check("keys and serialization: unknown keys are refused; the file is stable", () => {
  assertEqual("clean keys", overlapKeyProblems(cleanFixture()), []);
  const bad = { ...cleanFixture(), notes: "free text", heldBack: [{ courseId: "FICT-2100", from: MINOR.id, why: "x", extra: 1 }], limit: { maxCourses: 1, minCourses: 1 } };
  assertEqual("unknown keys", overlapKeyProblems(bad), ['unknown fixture key "notes"', 'unknown limit key "minCourses"', 'unknown key "extra" on heldBack[0]']);
  const text = serializeOverlapFixture(cleanFixture());
  assertEqual("stable", serializeOverlapFixture(JSON.parse(text) as OverlapFixture), text);
  assertTrue("key order", text.indexOf('"programId"') < text.indexOf('"heldBack"') && text.indexOf('"heldBack"') < text.indexOf('"courses"'), text.slice(0, 200));
});

// ── Engineering majors (slot templates) ─────────────────────────────────────
// An invented Engineering-style program: one core course and two major
// electives from a list. The app's slot matcher counts all three toward
// overlap; the minor counts the upper-level ones.
const ENG: TemplateProgram = {
  id: "invented-eng-bs-2031",
  name: "Invented Engineering, B.S.",
  shortName: "InvEng",
  doc: {
    id: "invented-eng-bs-2031",
    name: "Invented Engineering, B.S.",
    shortName: "InvEng",
    college: "College of Engineering",
    catalogYear: 2031,
    electiveGroups: [
      { id: "inv-major-elective", programId: "invented-eng-bs-2031", name: "Major Elective", qualifyingRule: { type: "list" }, minCredits: 3, advisorApproval: false, courseIds: ["FICT-2000", "FICT-2100", "FICT-2200"] },
    ],
    slots: [
      { id: "inv-core", programId: "invented-eng-bs-2031", kind: "course", courseId: "FICT-1000", pattern: null, patternTitle: null, electiveGroupId: null, suggestedSemester: 1, slotRow: 0 },
      { id: "inv-major1", programId: "invented-eng-bs-2031", kind: "elective", courseId: null, pattern: null, patternTitle: null, electiveGroupId: "inv-major-elective", suggestedSemester: 7, slotRow: 0 },
      { id: "inv-major2", programId: "invented-eng-bs-2031", kind: "elective", courseId: null, pattern: null, patternTitle: null, electiveGroupId: "inv-major-elective", suggestedSemester: 8, slotRow: 0 },
    ],
    edges: [],
  },
};
const ENG_MINOR: Layer = { ...MINOR, sharing: { otherMajors: { maxCourses: 1, with: ["invented-eng-bs"] } } } as Layer;

function cleanTemplateFixture(): OverlapFixture {
  return {
    programId: ENG_MINOR.id,
    description: "An invented engineering major and minor that share two upper-level courses.",
    layerIds: [ENG.id, ENG_MINOR.id],
    ctx: { programId: ENG.id, entryTerm: "FA31", transfer: "none" },
    plan: ["FICT-1000", "FICT-2000", "FICT-2100", "FICT-2200"],
    limit: { maxCourses: 1 },
    shared: ["FICT-2000", "FICT-2100"],
    heldBack: [{ courseId: "FICT-2000", from: ENG_MINOR.id, why: "Only one course may count for both." }],
    courses: COURSES,
  };
}
const tfx = (edit: (f: OverlapFixture) => void): OverlapFixture => {
  const f = JSON.parse(JSON.stringify(cleanTemplateFixture())) as OverlapFixture;
  edit(f);
  return f;
};

check("template major (pass): the app's matcher and D7 loop agree with the fixture", () => {
  const r = runTemplateOverlapFixture(ENG, ENG_MINOR, cleanTemplateFixture());
  assertEqual("problems", r.problems, []);
  assertEqual("ok", r.ok, true);
  assertEqual("limit", r.limit, { maxCourses: 1 });
  assertEqual("shared before", r.sharedBefore, ["FICT-2000", "FICT-2100"]);
  assertEqual("shared after", r.sharedAfter, ["FICT-2100"]);
  assertEqual("minor complete before, short after", [r.pctBefore[ENG_MINOR.id], r.pctAfter[ENG_MINOR.id] < 100], [100, true]);
  assertEqual("the app holds back one course, from the minor", (r.appHeldBack ?? []).map((h) => h.endsWith(`from ${ENG_MINOR.id}`)), [true]);
});

check("template major (fail): a hold-back from the Engineering major, too few, or the wrong ctx", () => {
  const fromMajor = runTemplateOverlapFixture(ENG, ENG_MINOR, tfx((f) => (f.heldBack[0].from = ENG.id)));
  assertTrue("from the major", has(fromMajor.problems, /never re-solves an Engineering major/), JSON.stringify(fromMajor.problems));
  assertTrue("from the major leaves the pair over", has(fromMajor.problems, /still shares/), JSON.stringify(fromMajor.problems));
  const none = runTemplateOverlapFixture(ENG, ENG_MINOR, tfx((f) => (f.heldBack = [])));
  assertTrue("empty", has(none.problems, /heldBack is empty/) && has(none.problems, /the app holds back 1 course/), JSON.stringify(none.problems));
  const twoHeld = runTemplateOverlapFixture(ENG, ENG_MINOR, tfx((f) => f.heldBack.push({ courseId: "FICT-2100", from: ENG_MINOR.id, why: "x" })));
  assertTrue("more than the app holds back", has(twoHeld.problems, /but the fixture names 2/), JSON.stringify(twoHeld.problems));
  const ctx = runTemplateOverlapFixture(ENG, ENG_MINOR, tfx((f) => (f.ctx.programId = "invented-ba-2031")));
  assertTrue("ctx", has(ctx.problems, /ctx.programId/), JSON.stringify(ctx.problems));
  const shared = runTemplateOverlapFixture(ENG, ENG_MINOR, tfx((f) => (f.shared = ["FICT-2000", "FICT-2100", "FICT-2200"])));
  assertTrue("the template counts only two electives", has(shared.problems, /shared courses are/), JSON.stringify(shared.problems));
});

check("template major (fail): a limit scoped to another major, or none at all", () => {
  const other = { ...ENG_MINOR, sharing: { otherMajors: { maxCourses: 1, with: ["other-eng-bs"] } } } as Layer;
  assertTrue("with misses", has(runTemplateOverlapFixture(ENG, other, cleanTemplateFixture()).problems, /set no limit/), "with");
  const loose = { ...ENG_MINOR, sharing: { otherMajors: { maxCourses: 2 } } } as Layer;
  assertTrue("does not bind", has(runTemplateOverlapFixture(ENG, loose, tfx((f) => (f.limit = { maxCourses: 2 }))).problems, /does not bind/), "bind");
});

check("loadTemplateProgram: an Engineering program from seed-data; anything else is null", () => {
  const me = loadTemplateProgram("cornell-me-bs-2026");
  assertTrue("legacy programs.json entry", !!me && Array.isArray(me.doc.slots), "cornell-me-bs-2026");
  assertTrue("programs-2025 file", !!loadTemplateProgram("cornell-mse-bs-2025"), "cornell-mse-bs-2025");
  assertEqual("not a program", loadTemplateProgram("cornell-economics-ba-2026"), null);
  assertEqual("not an id", loadTemplateProgram("../programs"), null);
  assertTrue("hash is stable", !!me && templateSha256(me) === templateSha256({ ...me, doc: JSON.parse(JSON.stringify(me.doc)) }), "hash");
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── check-overlap-fixture corpus — ${checks.length} case(s) ──`);
let failedCases = 0;
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
  else failedCases++;
}
console.log(`\n${checks.length - failedCases}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
