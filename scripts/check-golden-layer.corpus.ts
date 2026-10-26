// scripts/check-golden-layer.corpus.ts
// Asserted, offline corpus runner for check-golden-layer.ts (spec 019 D4 step
// 4). NO network and no catalog dump: the catalog and layers are hand-built
// objects below; the layer-lookup check uses a temp dir. Exits nonzero on any
// mismatch.
//
// Run: npx tsx check-golden-layer.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runGoldenPlan } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import {
  buildGoldenReport,
  fillCourses,
  indexLayerFiles,
  isProbe,
  parseGoldenArgs,
  renderGoldenReport,
  resolveLayers,
  serializeFixture,
  type FixtureInput,
} from "./check-golden-layer";
import { DEFAULT_DUMP, catalogToDist, layerSha256, type GoldenReport, type Layer } from "./layer-authoring";
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
process.exit(failures ? 1 : 0);
