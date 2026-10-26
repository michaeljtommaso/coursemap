// scripts/sample-rows.corpus.ts
// Asserted, offline corpus runner for sample-rows.ts (spec 019 D16 hand check).
// NO network, no repo writes: layers are hand-built objects below; the one IO
// check uses a temp dir. Exits nonzero on any mismatch.
//
// Run: npx tsx sample-rows.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildUniverse,
  compareDraws,
  drawRecord,
  drawSample,
  mulberry32,
  parseSampleArgs,
  readLayerDirs,
  renderHandcheckMarkdown,
  universeHash,
  type LayerInput,
} from "./sample-rows";
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

// ── Fixture layers ──────────────────────────────────────────────────────────
const SRC = { url: "https://catalog.example.edu/x/", anchor: "Requirements" };
const seat = (id: string, course: string): Row => ({ id, kind: "seat", label: `Seat ${id}`, group: "Core", source: SRC, rule: { course: [course] } });
const confirmRow = (id: string): Row => ({ id, kind: "confirm", label: `Confirm ${id}`, group: "Other", source: SRC });
const anyOfRow = (id: string, a: string, b: string): Row => ({
  id,
  kind: "anyOf",
  label: `Either ${id}`,
  group: "Core",
  source: SRC,
  rows: [
    { id: `${id}-a`, kind: "seat", label: `Option ${a}`, group: "Core", source: SRC, rule: { course: [a] } },
    { id: `${id}-b`, kind: "seat", label: `Option ${b}`, group: "Core", source: SRC, rule: { course: [b] } },
  ],
});

const layer = (id: string, family: "cas" | "cals", rows: Row[]): Layer => ({
  id,
  kind: "major",
  family,
  name: `Major ${id}`,
  catalogYear: "2026-27",
  programId: id,
  rows,
});

/** 3 cas layers, 40 units in total, plus one cals layer that must be ignored. */
function fixtureInputs(): LayerInput[] {
  const rowsFor = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => seat(`${prefix}${i}`, `AAA-${1000 + i}`));
  return [
    { file: "b.json", layer: layer("major-b", "cas", [...rowsFor("b", 12), anyOfRow("bx", "BBB-1000", "BBB-2000"), confirmRow("bc")]) },
    { file: "a.json", layer: layer("major-a", "cas", rowsFor("a", 10)) },
    { file: "c.json", layer: layer("major-c", "cas", rowsFor("c", 13)) },
    { file: "z.json", layer: layer("major-z", "cals", rowsFor("z", 9)) },
  ];
}
const keysOf = (items: { layerId: string; unit: { key: string } }[]) => items.map((i) => `${i.layerId} ${i.unit.key}`);

// ── PRNG ────────────────────────────────────────────────────────────────────
check("mulberry32: same seed → same stream, values in [0,1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 50 }, () => a());
  const ys = Array.from({ length: 50 }, () => b());
  assertEqual("same stream", xs, ys);
  assertTrue("range", xs.every((x) => x >= 0 && x < 1), JSON.stringify(xs));
  assertTrue("different seed differs", mulberry32(43)() !== mulberry32(42)(), "seeds 42 and 43 gave the same first value");
});

// ── Universe ────────────────────────────────────────────────────────────────
check("universe: family filter, sorted by layer id then unit order", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  assertEqual("layer order", u.layers.map((l) => l.id), ["major-a", "major-b", "major-c"]);
  assertEqual("size", u.items.length, 10 + 12 + 3 + 1 + 13);
  assertEqual("first units", keysOf(u.items.slice(0, 2)), ["major-a a0", "major-a a1"]);
  assertTrue("no cals layer", u.items.every((i) => i.layerId !== "major-z"), "major-z leaked into the cas universe");
  assertEqual("units per layer", u.layers.map((l) => l.units), [10, 16, 13]);
});

check("universe: anyOf parents and children are units; confirm rows included", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const b = keysOf(u.items.filter((i) => i.layerId === "major-b")).slice(-4);
  assertEqual("anyOf + children + confirm", b, ["major-b bx", "major-b bx/bx-a", "major-b bx/bx-b", "major-b bc"]);
  const child = u.items.find((i) => i.unit.key === "bx/bx-a")!;
  assertEqual("child parent id", child.unit.parentId, "bx");
});

check("universe: independent of input (file-system) order", () => {
  const fwd = buildUniverse(fixtureInputs(), "cas");
  const rev = buildUniverse([...fixtureInputs()].reverse(), "cas");
  assertEqual("same items", keysOf(rev.items), keysOf(fwd.items));
  assertEqual("same hash", universeHash(rev.items), universeHash(fwd.items));
  assertEqual("same draw", keysOf(drawSample(rev.items, 7, 9).items), keysOf(drawSample(fwd.items, 7, 9).items));
});

check("universe: a layer id in two files is an error", () => {
  const inputs = fixtureInputs();
  inputs.push({ file: "dup.json", layer: layer("major-a", "cas", [seat("x", "AAA-1000")]) });
  let msg = "";
  try {
    buildUniverse(inputs, "cas");
  } catch (e) {
    msg = (e as Error).message;
  }
  assertTrue("throws", msg.includes("major-a") && msg.includes("dup.json"), msg || "did not throw");
});

check("universeHash: changes when any one row changes (incl. an anyOf child)", () => {
  const base = universeHash(buildUniverse(fixtureInputs(), "cas").items);
  const edited = fixtureInputs();
  const row = edited[2].layer.rows[3] as Extract<Row, { kind: "seat" }>;
  row.rule = { course: ["AAA-9999"] };
  assertTrue("seat edit", universeHash(buildUniverse(edited, "cas").items) !== base, "hash unchanged after a rule edit");
  const edited2 = fixtureInputs();
  const any = edited2[0].layer.rows.find((r) => r.kind === "anyOf") as Extract<Row, { kind: "anyOf" }>;
  any.rows[1].label = "Renamed";
  assertTrue("child edit", universeHash(buildUniverse(edited2, "cas").items) !== base, "hash unchanged after a child label edit");
  const keyOrder = fixtureInputs();
  const r0 = keyOrder[1].layer.rows[0] as unknown as Record<string, unknown>;
  const reordered = Object.fromEntries(Object.entries(r0).reverse());
  keyOrder[1].layer.rows[0] = reordered as unknown as Row;
  assertEqual("key order is not a change", universeHash(buildUniverse(keyOrder, "cas").items), base);
});

// ── Draw ────────────────────────────────────────────────────────────────────
check("draw: same seed → identical draw; without replacement; presented in universe order", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const a = drawSample(u.items, 2026, 15);
  const b = drawSample(u.items, 2026, 15);
  assertEqual("identical", keysOf(a.items), keysOf(b.items));
  assertEqual("count", a.items.length, 15);
  assertEqual("no duplicates", new Set(keysOf(a.items)).size, 15);
  assertEqual("no warning", a.warning, null);
  const pos = a.items.map((it) => u.items.indexOf(it));
  assertEqual("sorted by universe position", pos, [...pos].sort((x, y) => x - y));
});

check("draw: different seed → different draw", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const a = keysOf(drawSample(u.items, 1, 15).items);
  const b = keysOf(drawSample(u.items, 2, 15).items);
  assertTrue("differs", a.join("|") !== b.join("|"), `seeds 1 and 2 drew the same rows: ${a.join(", ")}`);
});

check("draw: count ≥ universe → every row, with a warning", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const d = drawSample(u.items, 5, 150);
  assertEqual("all rows", keysOf(d.items), keysOf(u.items));
  assertTrue("warning", (d.warning ?? "").includes("only 39"), String(d.warning));
  const exact = drawSample(u.items, 5, u.items.length);
  assertEqual("count == universe also takes all", exact.items.length, u.items.length);
});

check("draw: every unit is reachable across seeds (incl. anyOf children)", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const seen = new Set<string>();
  for (let s = 0; s < 200; s++) for (const k of keysOf(drawSample(u.items, s, 5).items)) seen.add(k);
  assertEqual("all reached", seen.size, u.items.length);
});

// ── Draw record + verify ────────────────────────────────────────────────────
check("verify: an identical recomputation has no differences", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const rec = drawRecord(u, 9, 12, drawSample(u.items, 9, 12));
  const again = buildUniverse([...fixtureInputs()].reverse(), "cas");
  const rec2 = drawRecord(again, 9, 12, drawSample(again.items, 9, 12));
  assertEqual("no diffs", compareDraws(rec, rec2), []);
  assertEqual("record shape", Object.keys(rec), ["family", "seed", "count", "universeSize", "universeHash", "layers", "items"]);
  assertEqual("items numbered from 1", rec.items.map((i) => i.n), Array.from({ length: 12 }, (_, i) => i + 1));
});

check("verify: a changed row is detected and its layer named", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const rec = JSON.parse(JSON.stringify(drawRecord(u, 9, 12, drawSample(u.items, 9, 12))));
  const edited = fixtureInputs();
  (edited[1].layer.rows[4] as Extract<Row, { kind: "seat" }>).credits = 4;
  const eu = buildUniverse(edited, "cas");
  const diffs = compareDraws(rec, drawRecord(eu, 9, 12, drawSample(eu.items, 9, 12)));
  assertTrue("hash diff", diffs.some((d) => d.startsWith("universe hash changed")), JSON.stringify(diffs));
  assertTrue("layer named", diffs.some((d) => d.includes("layer major-a changed")), JSON.stringify(diffs));
});

check("verify: an added row shifts the draw and is reported", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const rec = drawRecord(u, 3, 20, drawSample(u.items, 3, 20));
  const grown = fixtureInputs();
  grown[1].layer.rows.unshift(seat("a-new", "AAA-5000"));
  const gu = buildUniverse(grown, "cas");
  const diffs = compareDraws(rec, drawRecord(gu, 3, 20, drawSample(gu.items, 3, 20)));
  assertTrue("size diff", diffs.some((d) => d.includes("universe size changed: 39 → 40")), JSON.stringify(diffs));
  assertTrue("rows diff", diffs.some((d) => d.startsWith("drawn rows differ")), JSON.stringify(diffs));
});

// ── Sheet ───────────────────────────────────────────────────────────────────
check("sheet: instructions, one block per row, quotes or the no-quote marker", () => {
  const u = buildUniverse(fixtureInputs(), "cas");
  const d = drawSample(u.items, 11, 150);
  const rec = drawRecord(u, 11, 150, d);
  const md = renderHandcheckMarkdown(rec, d, (layerId, unit) => (layerId === "major-a" && unit.key === "a1" ? ["Fragment one", "Fragment two"] : null));
  assertTrue("title", md.startsWith("# Hand check: CAS rows, seed 11"), md.slice(0, 60));
  assertTrue("release rule", md.includes("0 wrong → the family is released") && md.includes("NEW seed"), "missing release rule");
  assertTrue("verify hint", md.includes("--verify"), "missing verify hint");
  assertTrue("warning shown", md.includes("**Warning:**"), "warning missing");
  assertEqual("mark lines", md.split("- [ ] right  - [ ] wrong  — note:").length - 1, 39);
  assertEqual("no-quote markers", md.split("(no provenance quote)").length - 1, 38);
  assertTrue("quotes", md.includes("  > Fragment one\n  > Fragment two"), "quote fragments missing");
  assertEqual("layer headings", md.split("\n## Major ").length - 1, 3);
  assertTrue("child marked", md.includes("`bx/bx-a`, kind seat (one option of `bx`)"), "anyOf child not marked");
  assertTrue("source", md.includes(`${SRC.url} — section "${SRC.anchor}"`), "source line missing");
  assertTrue("plain-English rule", md.includes("- Rule: One course: AAA 1001."), "describeRow output missing");
});

// ── Args + IO ───────────────────────────────────────────────────────────────
check("args: required flags, defaults, bad values", () => {
  const ok = parseSampleArgs(["--family", "cals", "--seed", "4", "--layers", "x", "--layers", "y"]);
  assertTrue("parses", !("error" in ok), JSON.stringify(ok));
  if (!("error" in ok)) {
    assertEqual("count default", ok.count, 150);
    assertEqual("layers", ok.layers, ["x", "y"]);
  }
  assertTrue("bad family", "error" in parseSampleArgs(["--family", "eng", "--seed", "1"]), "accepted --family eng");
  assertTrue("bad seed", "error" in parseSampleArgs(["--family", "cas", "--seed", "1.5"]), "accepted --seed 1.5");
  assertTrue("missing seed", "error" in parseSampleArgs(["--family", "cas"]), "accepted no --seed");
  assertTrue("verify alone", !("error" in parseSampleArgs(["--verify", "d.json"])), "rejected --verify alone");
  assertTrue("zero count", "error" in parseSampleArgs(["--family", "cas", "--seed", "1", "--count", "0"]), "accepted --count 0");
});

check("io: layer dirs are read recursively; an invalid layer file is an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "sample-rows-"));
  mkdirSync(join(dir, "nested"));
  const [b, a] = fixtureInputs();
  writeFileSync(join(dir, "b.json"), JSON.stringify(b.layer));
  writeFileSync(join(dir, "nested", "a.json"), JSON.stringify(a.layer));
  const read = readLayerDirs([dir]);
  assertEqual("both read", read.map((r) => r.layer.id).sort(), ["major-a", "major-b"]);
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ id: "bad", rows: [] }));
  let msg = "";
  try {
    readLayerDirs([dir]);
  } catch (e) {
    msg = (e as Error).message;
  }
  assertTrue("invalid file rejected", msg.includes("bad.json"), msg || "did not throw");
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
