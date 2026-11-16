// scripts/check-golden-layer.corpus.ts
// Asserted, offline corpus runner for check-golden-layer.ts (spec 019 D4 step
// 4). NO network and no catalog dump: the catalog and layers are hand-built
// objects below; the layer-lookup check uses a temp dir. Exits nonzero on any
// mismatch.
//
// Run: npx tsx check-golden-layer.corpus.ts   (from the scripts/ folder)

import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runGoldenPlan } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import {
  buildGoldenReport,
  fillCourses,
  fixtureCourseProblems,
  fixtureKeyProblems,
  fixtureProblems,
  indexLayerFiles,
  rowsNotApplying,
  isAnswersShape,
  isProbe,
  parseGoldenArgs,
  renderGoldenReport,
  resolveLayers,
  serializeFixture,
  type FixtureInput,
} from "./check-golden-layer";
import { DEFAULT_DUMP, catalogToDist, layerSha256, type CourseRule, type GoldenReport, type Layer } from "./layer-authoring";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { extractPage } from "./extract-catalog-page";
import type { CatalogCourse } from "./validate-layers";

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

// ── Hand-built catalog + layer ──────────────────────────────────────────────
const course = (id: string, credits: number, tags: string[] = [], over: Partial<CatalogCourse> = {}): CatalogCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, creditsMin: credits, creditsMax: credits, attrs: tags.map((value) => ({ value, descr: "x" })), ...over };
};
const CATALOG = [
  course("AAA-1000", 3),
  course("BBB-2000", 4, ["X"]),
  course("BBB-2100", 3, ["X"]),
  course("CCC-3000", 3, ["X"]),
  course("DDD-4000", 1, [], { creditsMax: 4 }),
  course("EEE-1000", 3, ["X"]),
].map(catalogToDist);
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

const SRC = { url: "https://catalog.example.edu/x/", anchor: "Requirements" };
const LAYER: Layer = {
  id: "corpus-major",
  kind: "major",
  family: "cas",
  name: "Corpus Major",
  catalogYear: "2026-27",
  programId: "corpus-major",
  rows: [
    { id: "intro", kind: "seat", label: "Intro course", group: "Core", source: SRC, rule: { course: ["AAA-1000"] } },
    { id: "core", kind: "pool", label: "Two X courses", group: "Core", source: SRC, rule: { tag: ["X"] }, requiredCourses: 2, requiredCredits: 6 },
    { id: "advisor", kind: "confirm", label: "See an advisor", group: "Other", source: SRC },
  ],
};

const input = (plan: string[]): FixtureInput => ({
  programId: "corpus-major",
  description: "Fictional student.",
  layerIds: ["corpus-major"],
  ctx: { programId: "corpus-major", entryTerm: "FA26", transfer: "none" },
  plan,
});

// ── Args ────────────────────────────────────────────────────────────────────
check("args: fixture, repeated --layer, flags, defaults", () => {
  const a = parseGoldenArgs(["fx.json", "--layer", "l1.json", "--layer", "l2.json", "--write", "--report", "r.json"]);
  assertTrue("parses", !("error" in a), JSON.stringify(a));
  if (!("error" in a)) {
    assertEqual("fixture", a.fixture, "fx.json");
    assertEqual("layers", a.layers, ["l1.json", "l2.json"]);
    assertEqual("write", a.write, true);
    assertEqual("report", a.report, "r.json");
    assertEqual("default dump", a.dump, DEFAULT_DUMP);
  }
  assertTrue("no fixture", "error" in parseGoldenArgs(["--write"]), "accepted no fixture");
  assertTrue("two fixtures", "error" in parseGoldenArgs(["a.json", "b.json"]), "accepted two fixtures");
  assertTrue("unknown flag", "error" in parseGoldenArgs(["a.json", "--frobnicate"]), "accepted an unknown flag");
  assertTrue("missing value", "error" in parseGoldenArgs(["a.json", "--layer"]), "accepted --layer with no value");
});

// ── --write fill ────────────────────────────────────────────────────────────
check("fill: courses in first-occurrence plan order, deduped, from the catalog", () => {
  const r = fillCourses(input(["BBB-2100", "AAA-1000", "BBB-2100", "DDD-4000"]), BY_ID);
  assertEqual("no missing", r.missing, []);
  assertEqual("ids", r.fixture?.courses.map((c) => c.id), ["BBB-2100", "AAA-1000", "DDD-4000"]);
  const ddd = r.fixture?.courses.find((c) => c.id === "DDD-4000");
  assertEqual("variable credit kept (catalogToDist)", [ddd?.credits, ddd?.creditsMax], [1, 4]);
  assertEqual("attrs trimmed to value", r.fixture?.courses.find((c) => c.id === "BBB-2100")?.attrs, [{ value: "X" }]);
});

check("fill: a plan id not in the catalog → no fixture, ids listed", () => {
  const r = fillCourses(input(["AAA-1000", "ZZZ-1000", "YYY-2000"]), BY_ID);
  assertEqual("fixture", r.fixture, null);
  assertEqual("missing", r.missing, ["ZZZ-1000", "YYY-2000"]);
});

// ── Deterministic serialization ─────────────────────────────────────────────
check("serialize: stable key order regardless of input order; LF; trailing newline", () => {
  const filled = fillCourses(input(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!;
  const a = serializeFixture(filled);
  const shuffled = JSON.parse(JSON.stringify(filled), function (this: unknown, _k: string, v: unknown) {
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse());
    return v;
  });
  const b = serializeFixture(shuffled);
  assertEqual("byte-identical", b, a);
  assertTrue("trailing newline", a.endsWith("}\n") && !a.endsWith("\n\n"), JSON.stringify(a.slice(-4)));
  assertTrue("no CR", !a.includes("\r"), "CR in output");
  assertTrue("2-space", a.startsWith('{\n  "programId": "corpus-major",\n  "description"'), a.slice(0, 60));
  const parsed = JSON.parse(a);
  assertEqual("top keys", Object.keys(parsed), ["programId", "description", "layerIds", "ctx", "plan", "courses"]);
  assertEqual("ctx keys", Object.keys(parsed.ctx), ["programId", "entryTerm", "transfer"]);
  assertEqual("course keys", Object.keys(parsed.courses[0]), ["id", "subject", "number", "title", "credits", "attrs"]);
  assertEqual("round trip", serializeFixture(parsed), a);
});

check("serialize: a fixture without courses (before --write) has no courses key", () => {
  const s = serializeFixture(input(["AAA-1000"]));
  assertTrue("no courses", !s.includes('"courses"'), s);
});

// ── Fill + run end to end ───────────────────────────────────────────────────
check("run: a minimal filled plan passes; a slack course is caught", () => {
  const good = fillCourses(input(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!;
  const r = runGoldenPlan([LAYER], good);
  assertEqual("passes", r, { programId: "corpus-major", ok: true, pct: 100, unmetRows: [], notLoadBearing: [], unknownCourses: [], forbiddenCounted: [] });
  const slack = fillCourses(input(["AAA-1000", "BBB-2000", "BBB-2100", "DDD-4000"]), BY_ID).fixture!;
  assertEqual("slack", runGoldenPlan([LAYER], slack).notLoadBearing, ["DDD-4000"]);
});

// ── Report ──────────────────────────────────────────────────────────────────
check("report: pass, unmet rows with labels, not-load-bearing, unknown", () => {
  const pass: GoldenReport = { programId: "corpus-major", ok: true, pct: 100, unmetRows: [], notLoadBearing: [], unknownCourses: [] };
  assertEqual("pass text", renderGoldenReport(pass, [LAYER], { plan: ["A", "B"] }), "Golden plan for corpus-major: 2 course(s), scores 100%\nGOLDEN PASSED.");
  const bad: GoldenReport = {
    programId: "corpus-major",
    ok: false,
    pct: 83,
    unmetRows: [{ layerId: "corpus-major", rowId: "core", status: "partial" }],
    notLoadBearing: ["DDD-4000"],
    unknownCourses: ["ZZZ-1000"],
  };
  const text = renderGoldenReport(bad, [LAYER], { plan: ["A", "B", "C"] });
  assertTrue("score", text.includes("scores 83%"), text);
  assertTrue("unmet with label", text.includes('- corpus-major:core "Two X courses" is partial'), text);
  assertTrue("not load-bearing", text.includes("1 course(s) not load-bearing") && text.includes("- DDD-4000"), text);
  assertTrue("unknown", text.includes("- ZZZ-1000") && text.includes("--write"), text);
  assertTrue("verdict", text.endsWith("GOLDEN FAILED."), text);
});

// ── Negative probes + layer hashes ──────────────────────────────────────────
const PROBE = { courseId: "EEE-1000", rowId: "core", why: "below the 2000 level" };
const withProbe = (plan: string[]): FixtureInput => ({ ...input(plan), mustNotCount: [PROBE] });
/** The corpus layer with a level floor on "core", or without one. */
const coreLayer = (floor: boolean): Layer => ({
  ...LAYER,
  rows: LAYER.rows.map((r) =>
    r.id === "core" && r.kind === "pool" ? { ...r, rule: floor ? { allOf: [{ tag: ["X"] }, { number: { min: 2000 } }] } : { tag: ["X"] } } : r,
  ),
});

check("probes: --write fills probe ids after plan ids; a probe id not in the catalog is missing", () => {
  const r = fillCourses(withProbe(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID);
  assertEqual("ids", r.fixture?.courses.map((c) => c.id), ["AAA-1000", "BBB-2000", "BBB-2100", "EEE-1000"]);
  const dup = fillCourses({ ...withProbe(["AAA-1000", "EEE-1000"]) }, BY_ID);
  assertEqual("a probe id already in the plan is filled once", dup.fixture?.courses.map((c) => c.id), ["AAA-1000", "EEE-1000"]);
  const miss = fillCourses({ ...input(["AAA-1000"]), mustNotCount: [{ ...PROBE, courseId: "QQQ-1000" }] }, BY_ID);
  assertEqual("missing probe", miss.missing, ["QQQ-1000"]);
});

check("probes: serialized after plan, keys courseId/rowId/why", () => {
  const fx = fillCourses(withProbe(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!;
  const shuffled = { ...fx, mustNotCount: [{ why: PROBE.why, rowId: PROBE.rowId, courseId: PROBE.courseId }] };
  const parsed = JSON.parse(serializeFixture(shuffled));
  assertEqual("top keys", Object.keys(parsed), ["programId", "description", "layerIds", "ctx", "plan", "mustNotCount", "courses"]);
  assertEqual("probe keys", Object.keys(parsed.mustNotCount[0]), ["courseId", "rowId", "why"]);
  assertEqual("stable", serializeFixture(shuffled), serializeFixture(fx));
});

check("probes: shape check", () => {
  assertTrue("good", isProbe(PROBE), "rejected a good probe");
  assertTrue("no why", !isProbe({ courseId: "A-1", rowId: "r" }), "accepted a probe with no why");
  assertTrue("blank why", !isProbe({ ...PROBE, why: "  " }), "accepted a blank why");
  assertTrue("not object", !isProbe("A-1"), "accepted a string");
});

check("probes: a loose row fails the plan with the probe listed; the tight row passes", () => {
  const fx = fillCourses(withProbe(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!;
  const tight = buildGoldenReport([coreLayer(true)], fx);
  assertEqual("tight ok", [tight.ok, tight.forbiddenCounted], [true, []]);
  const loose = buildGoldenReport([coreLayer(false)], fx);
  assertEqual("loose", [loose.ok, loose.pct, loose.notLoadBearing, loose.forbiddenCounted], [
    false,
    100,
    [],
    [{ courseId: "EEE-1000", layerId: "corpus-major", rowId: "core" }],
  ]);
  const text = renderGoldenReport(loose, [coreLayer(false)], fx);
  assertTrue("listed with why", text.includes('- EEE-1000 counted by corpus-major:core "Two X courses": below the 2000 level'), text);
  assertTrue("count line", text.includes("1 probe(s) counted by a row that must not count them"), text);
  assertTrue("verdict", text.endsWith("GOLDEN FAILED."), text);
});

check("probes: a probe naming no row throws (main exits 2)", () => {
  const fx = fillCourses({ ...input(["AAA-1000", "BBB-2000", "BBB-2100"]), mustNotCount: [{ ...PROBE, rowId: "nope" }] }, BY_ID).fixture!;
  let msg = "";
  try {
    buildGoldenReport([LAYER], fx);
  } catch (e) {
    msg = (e as Error).message;
  }
  assertTrue("throws", msg.includes('no row "nope"'), msg || "did not throw");
});

check("report: anyOf option labels resolve from parent/child row ids", () => {
  const layer: Layer = {
    ...LAYER,
    rows: [
      ...LAYER.rows,
      {
        id: "quant",
        kind: "anyOf",
        label: "Quant",
        group: "Core",
        source: SRC,
        rows: [{ id: "stats", kind: "seat", label: "Statistics option", group: "Core", source: SRC, rule: { course: ["CCC-3000"] } }],
      },
    ],
  };
  const r: GoldenReport = {
    programId: "corpus-major",
    ok: false,
    pct: 100,
    unmetRows: [],
    notLoadBearing: [],
    unknownCourses: [],
    forbiddenCounted: [{ courseId: "DDD-4000", layerId: "corpus-major", rowId: "quant/stats" }],
  };
  const text = renderGoldenReport(r, [layer], { plan: ["A"], mustNotCount: [{ courseId: "DDD-4000", rowId: "quant/stats", why: "not statistics" }] });
  assertTrue("option label", text.includes('- DDD-4000 counted by corpus-major:quant/stats "Statistics option": not statistics'), text);
});

check("report: layerHashes carry each layer's layerSha256 and change when the layer does", () => {
  const fx = fillCourses(input(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!;
  const rep = buildGoldenReport([LAYER], fx);
  assertEqual("hashes", rep.layerHashes, { "corpus-major": layerSha256(LAYER) });
  assertTrue("hex", /^[0-9a-f]{64}$/.test(rep.layerHashes?.["corpus-major"] ?? ""), JSON.stringify(rep.layerHashes));
  const edited = buildGoldenReport([{ ...LAYER, name: "Corpus Major (edited)" }], fx);
  assertTrue("edit detected", edited.layerHashes?.["corpus-major"] !== rep.layerHashes?.["corpus-major"], "hash unchanged after an edit");
  const { layerHashes: _h, ...rest } = rep;
  void _h;
  assertEqual("rest is the app result", rest, runGoldenPlan([LAYER], fx));
});

// ── Layer lookup ────────────────────────────────────────────────────────────
check("layers: explicit --layer wins; bare and Draft files indexed by id; missing id throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-layer-"));
  mkdirSync(join(dir, "cas"));
  const other: Layer = { ...LAYER, id: "other-major", programId: "other-major" };
  writeFileSync(join(dir, "cas", "corpus-major.json"), JSON.stringify(LAYER));
  writeFileSync(join(dir, "other.json"), JSON.stringify({ schemaVersion: 1, layer: other }));
  writeFileSync(join(dir, "junk.json"), "{ not json");
  const index = indexLayerFiles([{ dir, recursive: true }]);
  assertEqual("indexed ids", [...index.keys()].sort(), ["corpus-major", "other-major"]);
  const flat = indexLayerFiles([{ dir, recursive: false }]);
  assertEqual("non-recursive", [...flat.keys()], ["other-major"]);

  const resolved = resolveLayers(["corpus-major", "other-major"], [], index);
  assertEqual("from files", resolved.map((l) => l.id), ["corpus-major", "other-major"]);
  const override: Layer = { ...LAYER, name: "Override" };
  assertEqual("explicit wins", resolveLayers(["corpus-major"], [override], index)[0].name, "Override");
  let msg = "";
  try {
    resolveLayers(["nope"], [], index);
  } catch (e) {
    msg = (e as Error).message;
  }
  assertTrue("missing id", msg.includes("no layer with id nope"), msg || "did not throw");
});

// ── Concentration and college fixtures (Phase 5) ────────────────────────────
const CONC: Layer = {
  id: "corpus-major--dragons",
  kind: "concentration",
  family: "cas",
  name: "Corpus Major: Dragons",
  catalogYear: "2026-27",
  programId: "corpus-major",
  concentrationId: "dragons",
  rows: [{ id: "dragon-seat", kind: "seat", label: "Dragon course", group: "Concentration", source: SRC, rule: { course: ["CCC-3000"] } }],
};
const concInput = (plan: string[]): FixtureInput => ({
  programId: CONC.id,
  description: "Fictional student in the dragons concentration.",
  layerIds: ["corpus-major", CONC.id],
  ctx: { programId: "corpus-major", concentrationId: "dragons", entryTerm: "FA26", transfer: "none" },
  plan,
});
const COLLEGE: Layer = {
  id: "corpus-college",
  kind: "college",
  family: "cas",
  name: "Corpus College (2025+)",
  catalogYear: "2026-27",
  appliesTo: [{ enteredFrom: "FA25" }],
  rows: [
    { id: "writing", kind: "seat", label: "Writing seminar", group: "College", source: SRC, rule: { course: ["AAA-1000"] } },
    { id: "transfer-only", kind: "seat", label: "Transfer seminar", group: "College", source: SRC, rule: { course: ["EEE-1000"] }, appliesTo: [{ transfer: ["external"] }] },
  ],
};

check("concentration: --layer gives only the concentration; the major comes from the index; both layers are proven", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-conc-"));
  mkdirSync(join(dir, "cas"));
  writeFileSync(join(dir, "cas", "corpus-major.json"), JSON.stringify(LAYER));
  const index = indexLayerFiles([{ dir, recursive: true }]);
  const layers = resolveLayers(["corpus-major", CONC.id], [CONC], index);
  assertEqual("major from the index, concentration explicit", layers.map((l) => [l.id, l.kind]), [["corpus-major", "major"], [CONC.id, "concentration"]]);
  const fx = fillCourses(concInput(["AAA-1000", "BBB-2000", "CCC-3000"]), BY_ID).fixture!;
  assertEqual("fits", fixtureProblems(layers, fx), []);
  const rep = buildGoldenReport(layers, fx);
  assertEqual("passes, both hashed", [rep.ok, rep.pct, Object.keys(rep.layerHashes ?? {})], [true, 100, ["corpus-major", CONC.id]]);
  const thin = fillCourses(concInput(["AAA-1000", "BBB-2000", "BBB-2100"]), BY_ID).fixture!; // no CCC-3000
  assertEqual("the concentration row is checked", buildGoldenReport(layers, thin).unmetRows, [{ layerId: CONC.id, rowId: "dragon-seat", status: "unmet" }]);
  let msg = "";
  try {
    resolveLayers(["corpus-major", CONC.id], [CONC], new Map());
  } catch (e) {
    msg = (e as Error).message;
  }
  assertTrue("unpromoted major named", msg.includes("no layer with id corpus-major") && msg.includes("promote the major first"), msg || "did not throw");
});

check("concentration: a fixture that does not fit its layers is refused", () => {
  const layers = [LAYER, CONC];
  const fx = concInput(["AAA-1000"]);
  const has = (probs: string[], s: string) => assertTrue(s, probs.some((p) => p.includes(s)), JSON.stringify(probs));
  has(fixtureProblems(layers, { ...fx, ctx: { ...fx.ctx, concentrationId: "griffins" } }), "ctx.concentrationId is griffins");
  has(fixtureProblems(layers, { ...fx, ctx: { ...fx.ctx, programId: "other" } }), "ctx.programId is other");
  has(fixtureProblems([CONC], { ...fx, layerIds: [CONC.id] }), "needs its major corpus-major in layerIds before it");
  has(fixtureProblems([CONC, LAYER], { ...fx, layerIds: [CONC.id, "corpus-major"] }), "must be in solve order");
  has(fixtureProblems([LAYER, LAYER], { ...fx, layerIds: ["corpus-major", "corpus-major"] }), "names a layer twice");
  has(fixtureProblems([LAYER], { layerIds: ["corpus-major"], ctx: { programId: "other" } }), "but major layer corpus-major is for corpus-major");
});

check("college: layerIds [collegeId]; the ctx must select this version; rows for other students are listed as untested", () => {
  const fx = { layerIds: [COLLEGE.id], ctx: { programId: "any-cas-major", entryTerm: "FA26", transfer: "none" as const } };
  assertEqual("fits", fixtureProblems([COLLEGE], fx), []);
  const early = fixtureProblems([COLLEGE], { ...fx, ctx: { ...fx.ctx, entryTerm: "FA24" } });
  assertTrue("pre-2025 student refused", early.some((p) => p.includes("does not apply to the fixture's student")), JSON.stringify(early));
  const unknown = fixtureProblems([COLLEGE], { ...fx, ctx: { programId: "x" } });
  assertTrue("no entry term refused (fail closed)", unknown.length === 1, JSON.stringify(unknown));
  assertEqual("untested rows", rowsNotApplying([COLLEGE], fx.ctx), ["corpus-college:transfer-only"]);
  const filled = fillCourses({ programId: COLLEGE.id, description: "Fictional first-year.", ...fx, plan: ["AAA-1000"] }, BY_ID).fixture!;
  assertEqual("college plan passes", buildGoldenReport([COLLEGE], filled).ok, true);
});

check("CLI: a concentration fixture resolves its promoted major from seed-data (index fallback)", () => {
  // The real promoted Economics major and its real golden plan, plus an invented
  // concentration passed as a Draft envelope with --layer.
  const majorFx = JSON.parse(readFileSync(join(__dirname, "seed-data", "golden", "layers", "cornell-economics-ba-2026.json"), "utf-8"));
  const majorId: string = majorFx.programId;
  const conc: Layer = { ...CONC, id: `${majorId}--corpus-dragons`, programId: majorId, concentrationId: "corpus-dragons", rows: [{ id: "dragon-seat", kind: "seat", label: "Dragon course", group: "Concentration", source: { url: "https://catalog.cornell.edu/invented-concentration/", anchor: "Invented" }, rule: { course: ["FICT-1000"] } }] };
  const fict = { id: "FICT-1000", subject: "FICT", number: "1000", title: "Invented Course", credits: 3, attrs: [] };
  const fx = {
    programId: conc.id,
    description: "Fictional student in an invented concentration.",
    layerIds: [majorId, conc.id],
    ctx: { ...majorFx.ctx, concentrationId: "corpus-dragons" },
    plan: [...majorFx.plan, "FICT-1000"],
    courses: [...majorFx.courses.filter((c: { id: string }) => majorFx.plan.includes(c.id)), fict],
  };
  const dir = mkdtempSync(join(tmpdir(), "golden-conc-cli-"));
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fx));
  writeFileSync(join(dir, "merged.json"), JSON.stringify({ schemaVersion: 1, layer: conc }));
  const run = (fixture: string, layer: string) =>
    spawnSync(`npx tsx check-golden-layer.ts "${fixture}" --layer "${layer}" --report "${join(dir, "report.json")}"`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  const r = run(join(dir, "fixture.json"), join(dir, "merged.json"));
  assertTrue("exit 0", r.status === 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assertTrue("passed", r.stdout.includes("GOLDEN PASSED."), r.stdout + r.stderr);
  const rep = JSON.parse(readFileSync(join(dir, "report.json"), "utf-8")) as GoldenReport;
  assertEqual("both layers hashed", Object.keys(rep.layerHashes ?? {}), [majorId, conc.id]);
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...fx, ctx: { ...fx.ctx, concentrationId: "other" } }));
  const bad = run(join(dir, "bad.json"), join(dir, "merged.json"));
  assertEqual("misfit → 1", bad.status, 1);
  assertEqual("misfit report not ok", (JSON.parse(readFileSync(join(dir, "report.json"), "utf-8")) as GoldenReport).ok, false);
  const orphan: Layer = { ...conc, id: "corpus-unpromoted-ba--x", programId: "corpus-unpromoted-ba", concentrationId: "x" };
  writeFileSync(join(dir, "orphan.json"), JSON.stringify({ ...fx, programId: orphan.id, layerIds: ["corpus-unpromoted-ba", orphan.id] }));
  writeFileSync(join(dir, "orphan-layer.json"), JSON.stringify(orphan));
  const o = run(join(dir, "orphan.json"), join(dir, "orphan-layer.json"));
  assertEqual("unpromoted major → 2", o.status, 2);
  assertTrue("says promote the major first", o.stderr.includes("promote the major first"), o.stderr);
});

// ── Review fixes: concentrationIds, key set, course re-derivation, page-only ─
check("fixtureProblems: ctx.concentrationIds (array) is accepted like the legacy concentrationId", () => {
  const major: Layer = { ...LAYER, id: "corpus-major", kind: "major" };
  const conc: Layer = { ...LAYER, id: "corpus-major--x", kind: "concentration", concentrationId: "x" };
  const ids = ["corpus-major", conc.id];
  const ctx = { programId: "corpus-major" };
  assertEqual("array form", fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationIds: ["x"] } }), []);
  assertEqual("legacy form", fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationId: "x" } }), []);
  assertEqual("array wins over the legacy id", fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationId: "other", concentrationIds: ["x"] } }), []);
  const wrong = fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationIds: ["y"] } });
  assertTrue("wrong id refused", wrong.some((p) => p.includes("ctx.concentrationIds is y")), JSON.stringify(wrong));
  const two = fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationIds: ["x", "y"] } });
  assertTrue("two chosen refused (the plan proves only one)", two.some((p) => p.includes("exactly that one")), JSON.stringify(two));
  const none = fixtureProblems([major, conc], { layerIds: ids, ctx: { ...ctx, concentrationIds: [] } });
  assertTrue("none chosen refused", none.some((p) => p.includes("(none)")), JSON.stringify(none));
});

check("fixtureKeyProblems: unknown fixture, ctx, probe and course keys are listed; the known set is clean", () => {
  const fx = { ...input(["AAA-1000"]), mustNotCount: [{ courseId: "EEE-1000", rowId: "core", why: "invented" }], courses: [{ ...BY_ID.get("AAA-1000")!, pageOnly: true }] };
  assertEqual("clean", fixtureKeyProblems(fx), []);
  const bad = {
    ...fx,
    notes: "free text",
    ctx: { ...fx.ctx, extra: 1 },
    mustNotCount: [{ courseId: "EEE-1000", rowId: "core", why: "invented", comment: "free text" }],
    courses: [{ ...fx.courses[0], blurb: "free text" }],
  };
  const p = fixtureKeyProblems(bad);
  for (const s of ['unknown fixture key "notes"', 'unknown ctx key "extra"', 'unknown key "comment" on mustNotCount[0]', 'unknown key "blurb" on courses[0]'])
    assertTrue(s, p.includes(s), JSON.stringify(p));
});

check("fixtureCourseProblems: embedded course data must equal the dump; wrong credits, attrs, subject, number are refused", () => {
  const fx = { ...input(["AAA-1000", "BBB-2000"]), mustNotCount: [{ courseId: "EEE-1000", rowId: "core", why: "invented" }] };
  const good = fillCourses(fx, BY_ID).fixture!;
  assertEqual("a filled fixture is clean", fixtureCourseProblems(good, BY_ID, new Map()), []);
  const tweak = (id: string, over: object) => ({ ...good, courses: good.courses.map((c) => (c.id === id ? { ...c, ...over } : c)) });
  const has = (f: typeof good, s: string) => fixtureCourseProblems(f, BY_ID, new Map()).some((p) => p.includes(s));
  assertTrue("credits", has(tweak("AAA-1000", { credits: 1 }), "AAA-1000: the fixture's course data differs from the catalog dump"), "credits edit accepted");
  assertTrue("attrs", has(tweak("BBB-2000", { attrs: [{ value: "Y" }] }), "BBB-2000: the fixture's course data differs"), "attrs edit accepted");
  assertTrue("subject", has(tweak("AAA-1000", { subject: "ZZZ" }), "AAA-1000: the fixture's course data differs"), "subject edit accepted");
  assertTrue("number", has(tweak("AAA-1000", { number: "9999" }), "AAA-1000: the fixture's course data differs"), "number edit accepted");
  assertTrue("probe course too", has(tweak("EEE-1000", { credits: 9 }), "EEE-1000: the fixture's course data differs"), "probe course edit accepted");
  assertTrue("missing entry", has({ ...good, courses: good.courses.filter((c) => c.id !== "BBB-2000") }, "BBB-2000 has no course data"), "missing entry accepted");
  assertTrue("extra entry", has({ ...good, courses: [...good.courses, BY_ID.get("CCC-3000")!] }, "CCC-3000 is in courses but in no plan or probe"), "extra entry accepted");
  assertTrue("id in neither source", fixtureCourseProblems({ ...good, plan: [...good.plan, "ZZZ-1000"] }, BY_ID, new Map()).some((p) => p.includes("ZZZ-1000 is in neither")), "unknown id accepted");
  assertTrue("pageOnly marked on a catalog course", has(tweak("AAA-1000", { pageOnly: true }), "AAA-1000 is marked pageOnly but the catalog dump has it"), "false pageOnly accepted");
  assertEqual("a variable-credit course (creditsMax) round-trips", fixtureCourseProblems(fillCourses(input(["DDD-4000"]), BY_ID).fixture!, BY_ID, new Map()), []);
});

check("fixtureCourseProblems + fillCourses: a page-only course is filled from the page, marked, and checked", () => {
  const pageOnly = new Map([["PPP-1000", catalogToDist(course("PPP-1000", 3, [], { title: "(listed on the catalog page; not in the catalog dump)" }))]]);
  const fx = input(["AAA-1000", "PPP-1000"]);
  assertEqual("without the page the id is missing", fillCourses(fx, BY_ID).missing, ["PPP-1000"]);
  const filled = fillCourses(fx, BY_ID, pageOnly).fixture!;
  assertEqual("marked pageOnly, catalog course not", filled.courses.map((c) => [c.id, (c as { pageOnly?: boolean }).pageOnly ?? false]), [["AAA-1000", false], ["PPP-1000", true]]);
  assertEqual("clean against catalog + page", fixtureCourseProblems(filled, BY_ID, pageOnly), []);
  assertEqual("serialized with the flag, in the known key order", JSON.parse(serializeFixture(filled)).courses[1].pageOnly, true);
  assertTrue("unmarked page-only course refused", fixtureCourseProblems({ ...filled, courses: filled.courses.map(({ ...c }) => { delete (c as { pageOnly?: boolean }).pageOnly; return c; }) }, BY_ID, pageOnly).some((p) => p.includes('not marked "pageOnly": true')), "unmarked accepted");
  assertTrue("page-only course the page no longer lists refused", fixtureCourseProblems(filled, BY_ID, new Map()).some((p) => p.includes("PPP-1000 is in neither")), "stale page-only accepted");
});

check("CLI --write: a course the dump lacks but the folder's verified extract lists is filled and marked pageOnly; an id in neither is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-pageonly-"));
  mkdirSync(join(dir, "snapshot"));
  const code = (c: string) => `<a href="/search/?P=${c.replace("-", "%20")}" class="bubblelink code">${c.replace("-", "&#160;")}</a>`;
  const html = `<!doctype html><html><head><title>Invented (BA)</title></head><body><main id="contentarea"><h1 class="page-title">Invented (BA)</h1>
<div id="curriculumtextcontainer"><h2>Invented Core</h2><table class="sc_courselist"><tbody>
<tr><td class="codecol">${code("PPP-1000")}</td><td>Invented page-only course</td><td class="hourscol">3</td></tr>
</tbody></table></div></main></body></html>`;
  const meta = { textSha256: "a".repeat(64) };
  writeFileSync(join(dir, "snapshot", "page.html"), html);
  writeFileSync(join(dir, "snapshot", "meta.json"), JSON.stringify(meta));
  writeFileSync(join(dir, "extract.json"), JSON.stringify(extractPage(html, { programId: "corpus-major", textSha256: meta.textSha256 }), null, 2));
  const dump = join(dir, "dump.json");
  writeFileSync(dump, JSON.stringify([course("AAA-1000", 3)]));
  const src = { url: "https://catalog.cornell.edu/invented/", anchor: "Invented Core" };
  const layer: Layer = { ...LAYER, rows: [{ ...LAYER.rows[0], source: src }, { id: "page", kind: "seat", label: "Page-only course", group: "Core", source: src, rule: { course: ["PPP-1000"] } }] };
  writeFileSync(join(dir, "layer.json"), JSON.stringify(layer));
  const fixture = (plan: string[]) => JSON.stringify({ programId: "corpus-major", description: "Invented student.", layerIds: ["corpus-major"], ctx: { programId: "corpus-major" }, plan });
  const run = () => spawnSync(`npx tsx check-golden-layer.ts "${join(dir, "golden-fixture.json")}" --layer "${join(dir, "layer.json")}" --dump "${dump}" --write`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  writeFileSync(join(dir, "golden-fixture.json"), fixture(["AAA-1000", "PPP-1000"]));
  const ok = run();
  assertEqual("exit 0", ok.status, 0);
  const written = JSON.parse(readFileSync(join(dir, "golden-fixture.json"), "utf-8")) as { courses: { id: string; pageOnly?: boolean; credits: number }[] };
  assertEqual("page-only marked, credits from the page", written.courses.map((c) => [c.id, c.pageOnly ?? false, c.credits]), [["AAA-1000", false, 3], ["PPP-1000", true, 3]]);
  writeFileSync(join(dir, "golden-fixture.json"), fixture(["AAA-1000", "QQQ-9999"]));
  const bad = run();
  assertEqual("an id in neither source → 1", bad.status, 1);
  assertTrue("says so", bad.stderr.includes("QQQ-9999") && bad.stderr.includes("neither the catalog dump nor the saved page"), bad.stderr);
  writeFileSync(join(dir, "extract.json"), "{ broken");
  writeFileSync(join(dir, "golden-fixture.json"), fixture(["AAA-1000", "PPP-1000"]));
  const broken = run();
  assertEqual("a broken extract refuses the page-only id", broken.status, 1);
  assertTrue("says why", broken.stderr.includes("could not be used"), broken.stderr);
});

// ── Answers (spec 020 questions) ────────────────────────────────────────────
// An invented layer: "approved" counts two courses a director approves (the
// page prints no list; the question's scope is the X courses), "accepted"
// needs DDD-4000 and acceptance to the program (a student fact).
const Q_SRC = { url: "https://catalog.cornell.edu/invented/", anchor: "Invented" };
const APPROVED_REF = "approvedFor:corpus-q/approved";
const FACT_REF = "studentFact:acceptedToProgram:corpus-q";
const qLayer = (approvedRule: CourseRule): Layer => ({
  id: "corpus-q",
  kind: "major",
  family: "cas",
  name: "Corpus Questions",
  catalogYear: "2026-27",
  programId: "corpus-q",
  rows: [
    { id: "intro", kind: "seat", label: "Intro course", group: "Core", source: Q_SRC, rule: { course: ["AAA-1000"] } },
    { id: "approved", kind: "pool", label: "Two approved courses", group: "Core", source: Q_SRC, rule: approvedRule, requiredCourses: 2, requiredCredits: 0 },
    { id: "accepted", kind: "seat", label: "Program course after acceptance", group: "Core", source: Q_SRC, rule: { allOf: [{ course: ["DDD-4000"] }, { answered: FACT_REF }] } },
  ],
  questions: [
    { type: "approvedFor", row: "approved", approver: "director", courses: { tag: ["X"] }, source: Q_SRC, quote: "Invented: courses approved by the director." },
    { type: "studentFact", fact: "acceptedToProgram", subject: "corpus-q", row: "accepted", source: Q_SRC, quote: "Invented: students apply to the program." },
  ],
});
/** As the page says: only an approved course counts. */
const Q_TIGHT = qLayer({ allOf: [{ tag: ["X"] }, { answered: APPROVED_REF }] });
/** Structurally loose: any X course counts, approved or not. */
const Q_LOOSE = qLayer({ anyOf: [{ tag: ["X"] }, { allOf: [{ tag: ["X"] }, { answered: APPROVED_REF }] }] });
const Q_ANSWERS = {
  marks: { [`${APPROVED_REF}@BBB-2100`]: "yes" as const, [`${APPROVED_REF}@BBB-2000`]: "yes" as const },
  facts: { [FACT_REF]: "yes" as const },
};
const qFixture = (over: Partial<FixtureInput> = {}) => {
  const base: FixtureInput = {
    programId: "corpus-q",
    description: "Fictional student with approvals.",
    layerIds: ["corpus-q"],
    ctx: { programId: "corpus-q", entryTerm: "FA26", transfer: "none" },
    plan: ["AAA-1000", "BBB-2000", "BBB-2100", "DDD-4000"],
    answers: Q_ANSWERS,
    ...over,
  };
  return fillCourses(base, BY_ID).fixture!;
};

check("answers: the invented question layers lint clean", () => {
  assertEqual("tight", lintLayer(Q_TIGHT), []);
  assertEqual("loose", lintLayer(Q_LOOSE), []);
});

check("answers: a plan met through approvals and a fact passes; each answered row is listed with its answers", () => {
  const r = runGoldenPlan([Q_TIGHT], qFixture());
  assertEqual("ok", r.ok, true);
  assertEqual("pct", r.pct, 100);
  assertEqual("answers all load-bearing", r.answersNotLoadBearing, []);
  assertEqual("no answer problems", r.answerProblems, []);
  assertEqual("metByAnswer", r.metByAnswer, [
    { layerId: "corpus-q", rowId: "approved", without: "unmet", answers: [`${APPROVED_REF}@BBB-2100`, `${APPROVED_REF}@BBB-2000`] },
    { layerId: "corpus-q", rowId: "accepted", without: "unmet", answers: [FACT_REF] },
  ]);
  const text = renderGoldenReport({ ...r, layerHashes: {} }, [Q_TIGHT], qFixture());
  assertTrue("report lists the answered rows", text.includes("2 row(s) met only because of the fixture's answers") && text.includes(`- corpus-q:approved "Two approved courses" (unmet without answers) via ${APPROVED_REF}@BBB-2100`), text);
  assertTrue("passes", text.endsWith("GOLDEN PASSED."), text);
});

check("answers: the same plan without answers cannot reach 100%; a fixture without answers keeps the old result shape", () => {
  const r = runGoldenPlan([Q_TIGHT], qFixture({ answers: undefined }));
  assertEqual("not ok", r.ok, false);
  assertEqual("unmet rows", r.unmetRows.map((u) => u.rowId), ["approved", "accepted"]);
  assertEqual("no answer keys on the result", ["metByAnswer", "answersNotLoadBearing", "answerProblems"].filter((k) => k in r), []);
  const fact = runGoldenPlan([Q_TIGHT], qFixture({ answers: { marks: Q_ANSWERS.marks, facts: { [FACT_REF]: "no" } } }));
  assertEqual("a fact answered no reads as unanswered", fact.unmetRows.map((u) => u.rowId), ["accepted"]);
});

check("answers: on a structurally loose row an answer is decorative, so it fails as not load-bearing (no masking a false green)", () => {
  const r = runGoldenPlan([Q_LOOSE], qFixture());
  assertEqual("not ok", r.ok, false);
  assertEqual("both approvals decorative", r.answersNotLoadBearing, [`${APPROVED_REF}@BBB-2100`, `${APPROVED_REF}@BBB-2000`]);
  assertEqual("the loose row is not listed as met by an answer", r.metByAnswer?.map((m) => m.rowId), ["accepted"]);
  const text = renderGoldenReport({ ...r, layerHashes: {} }, [Q_LOOSE], qFixture());
  assertTrue("report says so", text.includes("2 answer(s) not load-bearing") && text.endsWith("GOLDEN FAILED."), text);
});

check("answers: probes still run (with the plan's answers); a probe course is never answered for", () => {
  const probe = { courseId: "EEE-1000", rowId: "approved", why: "invented: not approved" };
  const tight = runGoldenPlan([Q_TIGHT], qFixture({ mustNotCount: [probe] }));
  assertEqual("tight: probe not counted", [tight.ok, tight.forbiddenCounted], [true, []]);
  const loose = runGoldenPlan([Q_LOOSE], qFixture({ mustNotCount: [probe] }));
  assertEqual("loose: probe counted", loose.forbiddenCounted, [{ courseId: "EEE-1000", layerId: "corpus-q", rowId: "approved" }]);
  const answeredProbe = qFixture({ mustNotCount: [probe], answers: { ...Q_ANSWERS, marks: { ...Q_ANSWERS.marks, [`${APPROVED_REF}@EEE-1000`]: "yes" } } });
  const p = fixtureProblems([Q_TIGHT], answeredProbe);
  assertTrue("answering for the probe course is refused", p.some((s) => s.includes("EEE-1000, which is not in the plan")), JSON.stringify(p));
  assertEqual("and fails the plan", runGoldenPlan([Q_TIGHT], answeredProbe).ok, false);
});

check("answers: fixtureProblems refuses unknown questions, the wrong half, courses off the plan or out of scope, and wrong values", () => {
  const withMarks = (marks: Record<string, unknown>, facts: Record<string, unknown> = Q_ANSWERS.facts) =>
    fixtureProblems([Q_TIGHT], qFixture({ answers: { marks, facts } as FixtureInput["answers"] }));
  assertEqual("clean", fixtureProblems([Q_TIGHT], qFixture()), []);
  const cases: [string, string[], Record<string, unknown>, Record<string, unknown>?][] = [
    ["unknown question", ["no layer of this fixture (corpus-q) asks approvedFor:corpus-q/nope"], { "approvedFor:corpus-q/nope@BBB-2000": "yes" }],
    ["another layer's question", ["asks approvedFor:other-layer/approved"], { "approvedFor:other-layer/approved@BBB-2000": "yes" }],
    ["fact in marks", ["is a student fact: it belongs in answers.facts"], { [FACT_REF]: "yes" }],
    ["mark in facts", ["is a course mark: it belongs in answers.marks"], {}, { [`${APPROVED_REF}@BBB-2000`]: "yes" }],
    ["course not in plan", ["CCC-3000, which is not in the plan"], { [`${APPROVED_REF}@CCC-3000`]: "yes" }],
    ["course outside the question's scope", ["AAA-1000 is outside the courses approvedFor:corpus-q/approved asks about"], { [`${APPROVED_REF}@AAA-1000`]: "yes" }],
    ["row mark without a course", ['a approvedFor answer is per course ("approvedFor:corpus-q/approved@<courseId>")'], { [APPROVED_REF]: "yes" }],
    ["wrong value", ['must be "yes" or "no"'], { [`${APPROVED_REF}@BBB-2000`]: "maybe" }],
    ["numeric value on a row mark", ['must be "yes" or "no"'], { [`${APPROVED_REF}@BBB-2000`]: 3 }],
    ["not an answer key", ["is not a valid answer key"], { "approved by the director": "yes" }],
    ["not a ref", ["names no question"], { "frobnicate:x@BBB-2000": "yes" }],
  ];
  for (const [name, want, marks, facts] of cases) {
    const p = withMarks(marks, facts);
    for (const w of want) assertTrue(name, p.some((s) => s.includes(w)), `${w} not in ${JSON.stringify(p)}`);
  }
  assertTrue("fact value", withMarks({}, { [FACT_REF]: "sure" }).some((s) => s.includes('must be "yes" or "no"')), "accepted a bad fact value");
  const shape = fixtureProblems([Q_TIGHT], { ...qFixture(), answers: [] as unknown as FixtureInput["answers"] });
  assertTrue("answers not an object", shape.some((s) => s.includes("answers must be { marks, facts }")), JSON.stringify(shape));
  const r = runGoldenPlan([Q_TIGHT], qFixture({ answers: { ...Q_ANSWERS, marks: { ...Q_ANSWERS.marks, [`${APPROVED_REF}@AAA-1000`]: "yes" } } }));
  assertEqual("the plan fails on an answer problem", r.ok, false);
  assertTrue("listed on the result", (r.answerProblems ?? []).some((s) => s.includes("AAA-1000 is outside")), JSON.stringify(r.answerProblems));
});

check("answers: serialized after mustNotCount, halves and keys in a stable order; key check covers answers", () => {
  const fx = qFixture({ mustNotCount: [{ courseId: "EEE-1000", rowId: "approved", why: "invented" }] });
  const parsed = JSON.parse(serializeFixture(fx));
  assertEqual("top keys", Object.keys(parsed), ["programId", "description", "layerIds", "ctx", "plan", "mustNotCount", "answers", "courses"]);
  assertEqual("halves", Object.keys(parsed.answers), ["marks", "facts"]);
  assertEqual("marks sorted", Object.keys(parsed.answers.marks), [`${APPROVED_REF}@BBB-2000`, `${APPROVED_REF}@BBB-2100`]);
  assertEqual("stable", serializeFixture({ ...fx, answers: { facts: Q_ANSWERS.facts, marks: Q_ANSWERS.marks } }), serializeFixture(fx));
  assertEqual("keys clean", fixtureKeyProblems(parsed), []);
  assertEqual("unknown answers key", fixtureKeyProblems({ ...parsed, answers: { ...parsed.answers, notes: "free text" } }), ['unknown answers key "notes"']);
  assertTrue("shape", isAnswersShape(Q_ANSWERS) && isAnswersShape({ marks: {} }) && !isAnswersShape([]) && !isAnswersShape({ marks: [] }), "shape check wrong");
});

check("answers CLI: passes with answers and reports metByAnswer; a bad answer exits 1; a malformed answers block exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-answers-cli-"));
  writeFileSync(join(dir, "layer.json"), JSON.stringify({ schemaVersion: 1, layer: Q_TIGHT }));
  const run = (fx: unknown) => {
    writeFileSync(join(dir, "fixture.json"), JSON.stringify(fx));
    return spawnSync(`npx tsx check-golden-layer.ts "${join(dir, "fixture.json")}" --layer "${join(dir, "layer.json")}" --report "${join(dir, "report.json")}"`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  };
  const ok = run(qFixture());
  assertEqual("exit 0", ok.status, 0);
  assertTrue("lists the answered rows", ok.stdout.includes("met only because of the fixture's answers"), ok.stdout + ok.stderr);
  const rep = JSON.parse(readFileSync(join(dir, "report.json"), "utf-8")) as GoldenReport;
  assertEqual("report metByAnswer", rep.metByAnswer?.map((m) => m.rowId), ["approved", "accepted"]);
  const bad = run(qFixture({ answers: { ...Q_ANSWERS, marks: { ...Q_ANSWERS.marks, [`${APPROVED_REF}@AAA-1000`]: "yes" } } }));
  assertEqual("answer problem → 1", bad.status, 1);
  assertEqual("report not ok", (JSON.parse(readFileSync(join(dir, "report.json"), "utf-8")) as GoldenReport).ok, false);
  const malformed = run({ ...qFixture(), answers: ["yes"] });
  assertEqual("malformed → 2", malformed.status, 2);
  assertTrue("says the shape", malformed.stderr.includes("answers must be"), malformed.stderr);
});

// ── Run ─────────────────────────────────────────────────────────────────────
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, `threw: ${(e as Error).stack ?? e}`);
  }
  console.log(`${failures === before ? "✓" : "✗"} ${c.name}`);
}
console.log(`\n${checks.length} checks, ${failures} failure(s).`);
if (failures) {
  console.error("\nCORPUS FAILED.");
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
