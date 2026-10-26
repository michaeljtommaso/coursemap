// scripts/seed-layers.corpus.ts
// Asserted, offline corpus for seed-layers.ts (collectSeedLayers) and
// seed-program-index.ts (buildProgramIndex). NO network and no Firestore: the
// layers are invented and written to temp dirs; the last case reads the real
// seed files without writing anything. Exits nonzero on any mismatch.
//
// Run: npx tsx seed-layers.corpus.ts   (from the scripts/ folder)

import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectSeedLayers, type SeedLayerDirs } from "./seed-layers";
import { buildProgramIndex } from "./seed-program-index";
import type { Layer, Row } from "./layer-authoring";

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

// ── Invented layers ─────────────────────────────────────────────────────────
const SRC = { url: "https://catalog.cornell.edu/invented/", anchor: "Invented" };
const seat = (id: string): Row => ({ id, kind: "seat", label: `Invented ${id}`, group: "G", source: SRC, rule: { course: ["FICT-1000"] } });
const college = (id: string, name: string, family: "cas" | "cals" = "cals"): Layer => ({ id, kind: "college", family, name, catalogYear: "2026-27", rows: [seat("c1")] });
const MAJOR: Layer = { id: "invented-bs-2026", kind: "major", family: "cals", name: "Invented Science (BS)", catalogYear: "2026-27", programId: "invented-bs-2026", rows: [seat("m1")] };
const CONC: Layer = { ...MAJOR, id: "invented-bs-2026--dairy", kind: "concentration", name: "Invented Science: Dairy", concentrationId: "dairy", rows: [seat("k1")] };

/** A fresh set of seed folders with the given files ({ "layers/cals/x.json": layer }). */
function seedDirs(files: Record<string, unknown>): SeedLayerDirs {
  const root = mkdtempSync(join(tmpdir(), "seed-layers-"));
  const dirs = { layers: join(root, "layers"), test: join(root, "layers-test"), fixtures: join(root, "fixtures") };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value));
  }
  return dirs;
}

// ── seed-layers ─────────────────────────────────────────────────────────────
check("--test: a Phase 2 fixture whose id is in seed-data is skipped (seed-data wins), not a duplicate", () => {
  const authored = college("cals-college-2025", "Authored version");
  const dirs = seedDirs({
    "layers/cals/cals-college-2025.json": authored,
    "fixtures/cals-college-2025.json": college("cals-college-2025", "Phase 2 fixture version"),
    "fixtures/cas-college.json": college("cas-college", "Phase 2 CAS fixture", "cas"),
  });
  const r = collectSeedLayers({ test: true, dirs });
  assertEqual("no errors", r.errors, []);
  assertEqual("ids", r.layers.map((l) => l.layer.id).sort(), ["cas-college", "cals-college-2025"].sort());
  assertEqual("the authored one is seeded", r.layers.find((l) => l.layer.id === "cals-college-2025")?.layer.name, "Authored version");
  assertEqual("one skipped", r.skipped.length, 1);
  assertTrue("skip names the fixture and the winner", r.skipped[0].includes("fixtures/cals-college-2025.json") && r.skipped[0].includes("layers/cals/cals-college-2025.json"), r.skipped[0]);
  const live = collectSeedLayers({ test: false, dirs });
  assertEqual("without --test no fixture is read", [live.layers.map((l) => l.layer.id), live.skipped], [["cals-college-2025"], []]);
});

check("a real duplicate is still an error (two authored files, or a test layer vs an authored one)", () => {
  const two = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/a.json": MAJOR, "layers/cas/b.json": MAJOR }) });
  assertTrue("authored twice", two.errors.some((e) => e.includes(`layer id ${MAJOR.id} also defined in`)), JSON.stringify(two.errors));
  const vsTest = collectSeedLayers({ test: true, dirs: seedDirs({ "layers/cals/a.json": MAJOR, "layers-test/a.json": MAJOR }) });
  assertTrue("test vs authored", vsTest.errors.some((e) => e.includes("also defined in")), JSON.stringify(vsTest.errors));
  assertEqual("nothing skipped", vsTest.skipped, []);
});

check("a broken fixture is still an error under --test, even beside an authored layer", () => {
  const r = collectSeedLayers({ test: true, dirs: seedDirs({ "layers/cals/x.json": MAJOR, "fixtures/bad.json": "{ not json" }) });
  assertTrue("broken fixture reported", r.errors.some((e) => e.includes("bad.json") && e.includes("not valid JSON")), JSON.stringify(r.errors));
});

check("concentration: seeded beside its major; without its major (or across families) it is an error", () => {
  const ok = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/major.json": MAJOR, "layers/cals/conc.json": CONC }) });
  assertEqual("clean", ok.errors, []);
  assertEqual("both seeded", ok.layers.map((l) => l.layer.kind).sort(), ["concentration", "major"]);
  const orphan = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/conc.json": CONC }) });
  assertTrue("orphan", orphan.errors.some((e) => e.includes(`concentration ${CONC.id} has no major layer ${MAJOR.id}`)), JSON.stringify(orphan.errors));
  const cross = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/major.json": MAJOR, "layers/cas/conc.json": { ...CONC, family: "cas" } }) });
  assertTrue("family mismatch", cross.errors.some((e) => e.includes("is cas, its major")), JSON.stringify(cross.errors));
  const badId = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/major.json": MAJOR, "layers/cals/conc.json": { ...CONC, id: "invented-bs-2026-dairy" } }) });
  assertTrue("id contract", badId.errors.some((e) => e.includes("must be <programId>--<concentrationId>")), JSON.stringify(badId.errors));
});

check("college versions: exactly one default (no layer-level appliesTo) per family", () => {
  const early: Layer = { ...college("cals-college-pre2025", "Invented early version"), appliesTo: [{ enteredBefore: "FA25" }] };
  const late = college("cals-college-2025", "Invented late version");
  const ok = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/early.json": early, "layers/cals/late.json": late }) });
  assertEqual("one default + one versioned: clean", ok.errors, []);
  const twoDefaults = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/a.json": college("cals-college-a", "A"), "layers/cals/b.json": college("cals-college-b", "B") }) });
  assertTrue("two defaults refused", twoDefaults.errors.some((e) => e.includes("cals: 2 college layers have no appliesTo") && e.includes("ambiguous")), JSON.stringify(twoDefaults.errors));
  const noDefault = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/early.json": early, "layers/cals/early2.json": { ...early, id: "cals-college-2026", appliesTo: [{ enteredFrom: "FA25" }] } }) });
  assertTrue("no default refused", noDefault.errors.some((e) => e.includes("cals: college layers") && e.includes("exactly one must have none")), JSON.stringify(noDefault.errors));
  const perFamily = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/late.json": late, "layers/cas/c.json": college("cas-college", "CAS", "cas") }) });
  assertEqual("each family has its own default", perFamily.errors, []);
  const noColleges = collectSeedLayers({ test: false, dirs: seedDirs({ "layers/cals/major.json": MAJOR }) });
  assertEqual("no college layer at all: nothing to check", noColleges.errors, []);
});

// ── seed-program-index ──────────────────────────────────────────────────────
check("program index: college and concentration layers add no entry and no error; the major is a hidden entry", () => {
  const dirs = seedDirs({
    "layers/cals/major.json": MAJOR,
    "layers/cals/conc.json": CONC,
    "layers/cals/college.json": college("cals-college-2025", "Invented CALS college"),
    "layers/cas/college.json": college("cas-college", "Invented CAS college", "cas"),
  });
  const r = buildProgramIndex({ test: false, layerDirs: dirs });
  assertEqual("no errors", r.errors, []);
  const ids = r.entries.map((e) => e.id);
  assertTrue("major listed", ids.includes(MAJOR.id), JSON.stringify(ids));
  for (const id of [CONC.id, "cals-college-2025", "cas-college"]) assertTrue(`${id} not listed`, !ids.includes(id), JSON.stringify(ids));
  const e = r.entries.find((x) => x.id === MAJOR.id);
  assertEqual("major entry", [e?.family, e?.collegeId, e?.status], ["cals", "cals", "hidden"]);
});

check("program index: an orphan concentration surfaces as an error", () => {
  const r = buildProgramIndex({ test: false, layerDirs: seedDirs({ "layers/cals/conc.json": CONC }) });
  assertTrue("error", r.errors.some((x) => x.includes("has no major layer")), JSON.stringify(r.errors));
});

check("real seed files: no errors; with --test nothing collides; only majors become entries", () => {
  const live = collectSeedLayers({ test: false });
  assertEqual("live errors", live.errors, []);
  const test = collectSeedLayers({ test: true });
  assertEqual("--test errors", test.errors, []);
  const nonMajors = new Set(test.layers.filter((l) => l.layer.kind !== "major").map((l) => l.layer.id));
  const index = buildProgramIndex({ test: true });
  assertEqual("index errors", index.errors, []);
  const leaked = index.entries.filter((e) => nonMajors.has(e.id)).map((e) => e.id);
  assertEqual("no college/concentration entry", leaked, []);
});

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`\n── seed-layers corpus — ${checks.length} case(s) ──`);
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
