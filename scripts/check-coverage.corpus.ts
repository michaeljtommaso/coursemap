// scripts/check-coverage.corpus.ts
// Asserted, offline corpus for check-coverage.ts (spec 047 D12). NO network:
// the page, its extract and the drafts are invented below (a fictional minor);
// the CLI runs against a temp folder. Exits nonzero on any mismatch.
//
// Run: npx tsx check-coverage.corpus.ts   (from the scripts/ folder)

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkCoverage, coverageProblem, isTrivial, keywordsOf, runCoverage, type CoverageReport } from "./check-coverage";
import { extractPage, type Block, type PageExtract } from "./extract-catalog-page";
import { layerSha256, type Draft, type Layer, type SnapshotMeta } from "./layer-authoring";
import { extractPageText, sha256 } from "./snapshot-catalog-page";

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
const URL = "https://catalog.cornell.edu/programs/fiction-minor/";
const SHA = "a".repeat(64);
const SRC = { url: URL, anchor: "Requirements" };

const heading = (id: string, level: number, text: string): Block => ({ id, kind: "heading", level, path: [], text, courseIds: [] });
const prose = (id: string, text: string): Block => ({ id, kind: "prose", path: [], text, courseIds: [] });
const row = (id: string, text: string, list?: string, rowKind: Block["rowKind"] = "course"): Block => ({ id, kind: "row", path: [], text, courseIds: [], ...(list ? { list } : {}), rowKind });

const EXTRACT: Pick<PageExtract, "blocks" | "lists" | "textSha256"> = {
  textSha256: SHA,
  blocks: [
    heading("H1", 1, "Fiction (Minor)"),
    heading("H2", 2, "Requirements"),
    prose("P1", "Students complete six invented courses for this minor."),
    row("T1", "Select four of the following: | 12", "L1", "comment"),
    row("T2", "FICT 2000 | Invented Course", "L1"),
    row("T3", "FICT 2100 | Another Invented Course", "L1"),
    prose("P2", "Each course must be completed with a grade of C or better."),
    prose("P3", "Students may count at most two courses toward both the minor and their major."),
    prose("P4", "The minor is not open to students majoring in Fiction."),
    heading("H3", 2, "Advising"),
    prose("P5", "Contact the coordinator with questions about planning."),
    prose("P6", "1"),
  ],
  lists: [{ id: "L1", path: [], lead: [], rows: [], courseIds: ["FICT-2000", "FICT-2100"] }],
};

const LAYER: Layer = {
  id: "fiction-minor-2031",
  kind: "minor",
  family: "other",
  name: "Fiction (Minor)",
  catalogYear: "2031-32",
  programId: "fiction-minor-2031",
  sharing: { otherMajors: { maxCourses: 2 } },
  rows: [
    { id: "core", kind: "seat", label: "Core course", group: "Core", source: SRC, rule: { course: ["FICT-1000"] } },
    { id: "electives", kind: "pool", label: "Four electives", group: "Electives", source: SRC, rule: { course: ["FICT-2000", "FICT-2100"] }, requiredCourses: 4, requiredCredits: 0 },
    { id: "grades", kind: "confirm", label: "Minimum grade", group: "Grades", source: SRC },
  ],
} as Layer;

function cleanDraft(): Draft {
  return {
    schemaVersion: 1,
    programId: LAYER.id,
    author: "merged",
    model: "test-model",
    framing: "single-author",
    snapshot: { url: URL, textSha256: SHA },
    layer: JSON.parse(JSON.stringify(LAYER)) as Layer,
    quotes: {},
    listRefs: { electives: ["L1"] },
    ledger: [
      { block: "P1", to: "core" },
      { block: "P2", to: "grades" },
      { block: "P3", to: "sharing" },
      { block: "P4", to: "eligibility", reason: "notOpenTo in the minor index entry" },
      { block: "H3", to: "out-of-scope", reason: "advising contacts, not a requirement" },
    ],
  };
}
function variant(edit: (d: Draft) => void): Draft {
  const d = cleanDraft();
  edit(d);
  return d;
}
const codesOf = (r: CoverageReport) => r.findings.map((f) => `${f.code}:${f.block ?? ""}`);

// ── Pure checks ─────────────────────────────────────────────────────────────
check("keywords: each class is recognised, plain prose is not", () => {
  assertEqual("grade", keywordsOf("Each course must be completed with a grade of C or better."), ["grade"]);
  assertEqual("overlap", keywordsOf("At most two courses may count toward both programs."), ["overlap"]);
  assertEqual("residency", keywordsOf("All courses must be taken at Cornell; AP credit does not count."), ["residency"]);
  assertEqual("eligibility", keywordsOf("The minor is not open to students majoring in Fiction."), ["eligibility"]);
  assertEqual("none", keywordsOf("Students complete six invented courses for this minor."), []);
  assertEqual("an article 'a or better' is not a grade", keywordsOf("pick a or better b"), []);
  assertTrue("footnote marker is trivial", isTrivial("1") && isTrivial(" | ") && !isTrivial("Six courses"), "isTrivial");
});

check("clean: every block accounted for, by ledger, listRefs and section", () => {
  const r = checkCoverage(cleanDraft(), EXTRACT);
  assertEqual("ok", r.ok, true);
  assertEqual("no findings", r.findings, []);
  assertEqual("counts", r.counts, { blocks: 12, exempt: 4, accounted: 8, unaccounted: 0, toRows: 5, toSharing: 1, toEligibility: 1, outOfScope: 1 });
  assertEqual("list rows via listRefs", r.blocks.filter((b) => b.via === "listRefs").map((b) => b.id), ["T1", "T2", "T3"]);
  assertEqual("section", r.blocks.find((b) => b.id === "P5")?.via, "section");
  assertEqual("hash", r.layerSha256, layerSha256(LAYER));
  assertEqual("coverageProblem clean", coverageProblem(r, layerSha256(LAYER)), null);
  assertTrue("coverageProblem stale", /different version/.test(coverageProblem(r, "b".repeat(64)) ?? ""), "stale hash");
  assertTrue("coverageProblem missing", /missing/.test(coverageProblem(undefined, "x") ?? ""), "missing");
});

check("unaccounted: a sentence the ledger skips fails; so do the rows of a list no row uses", () => {
  const r = checkCoverage(variant((d) => (d.ledger = d.ledger!.filter((e) => e.block !== "P1"))), EXTRACT);
  assertEqual("P1", codesOf(r), ["unaccounted:P1"]);
  const lists = checkCoverage(variant((d) => delete d.listRefs), EXTRACT);
  assertEqual("T1-T3", codesOf(lists), ["unaccounted:T1", "unaccounted:T2", "unaccounted:T3"]);
  const listEntry = checkCoverage(variant((d) => (delete d.listRefs, d.ledger!.push({ block: "L1", to: "out-of-scope", reason: "suggested courses only" }))), EXTRACT);
  assertEqual("a list entry covers its rows", listEntry.findings, []);
});

check("keyword: a grade, overlap or eligibility sentence can't be out of scope or misfiled", () => {
  const grade = checkCoverage(variant((d) => (d.ledger![1] = { block: "P2", to: "out-of-scope", reason: "advice" })), EXTRACT);
  assertEqual("grade out of scope", codesOf(grade), ["keyword:P2"]);
  const overlap = checkCoverage(variant((d) => (d.ledger![2] = { block: "P3", to: "eligibility", reason: "x" })), EXTRACT);
  assertEqual("overlap to eligibility (and sharing now unmapped)", codesOf(overlap), ["keyword:P3", "sharing:"]);
  const overlapToRow = checkCoverage(variant((d) => (d.ledger![2] = { block: "P3", to: "electives" }, (d.layer as Layer).sharing = undefined)), EXTRACT);
  assertEqual("overlap to a row is fine", overlapToRow.findings, []);
  const elig = checkCoverage(variant((d) => (d.ledger![3] = { block: "P4", to: "sharing" })), EXTRACT);
  assertEqual("eligibility to sharing", codesOf(elig), ["keyword:P4"]);
  const swallowed = checkCoverage(variant((d) => (d.ledger = d.ledger!.filter((e) => e.block !== "P2"), d.ledger.push({ block: "H2", to: "out-of-scope", reason: "everything" }))), EXTRACT);
  assertTrue("a section entry cannot swallow a grade sentence", codesOf(swallowed).includes("keyword:P2"), JSON.stringify(swallowed.findings));
});

check("ledger: unknown blocks and targets, duplicates, missing reasons, out-of-scope mixed with a row", () => {
  const r = checkCoverage(
    variant((d) =>
      d.ledger!.push(
        { block: "P99", to: "core" },
        { block: "P1", to: "core" },
        { block: "P5", to: "no-such-row" },
        { block: "T2", to: ["out-of-scope", "electives"], reason: "x" },
      ),
    ),
    EXTRACT,
  );
  const msgs = r.findings.filter((f) => f.code === "ledger").map((f) => f.block);
  assertEqual("ledger findings", msgs, ["P99", "P1", "P5", "T2"]);
  const noReason = checkCoverage(variant((d) => (d.ledger![3] = { block: "P4", to: "eligibility" })), EXTRACT);
  assertEqual("eligibility needs a reason", codesOf(noReason), ["ledger:P4"]);
  const sharingNoLimit = checkCoverage(variant((d) => ((d.layer as Layer).sharing = undefined)), EXTRACT);
  assertEqual("sharing with no limit needs a reason", codesOf(sharingNoLimit), ["ledger:P3"]);
  const withReason = checkCoverage(variant((d) => (((d.layer as Layer).sharing = undefined), (d.ledger![2] = { block: "P3", to: "sharing", reason: "the page allows unlimited sharing" }))), EXTRACT);
  assertEqual("with a reason it is fine", withReason.findings, []);
});

check("no ledger, another snapshot, sharing set but never mapped", () => {
  assertEqual("no ledger", checkCoverage(variant((d) => delete d.ledger), EXTRACT).findings[0]?.code, "no-ledger");
  assertEqual("snapshot", checkCoverage(cleanDraft(), { ...EXTRACT, textSha256: "c".repeat(64) }).findings.map((f) => f.code), ["extract"]);
  const r = checkCoverage(variant((d) => (d.ledger![2] = { block: "P3", to: "electives" })), EXTRACT);
  assertEqual("sharing unmapped", codesOf(r), ["sharing:"]);
});

// ── CLI on a temp provenance folder ─────────────────────────────────────────
check("CLI: writes coverage.json next to the draft; exit 0 clean, 1 findings, 2 bad input", () => {
  const html = [
    "<!doctype html><html><head><title>Fiction (Minor)</title></head><body><main>",
    "<h1>Fiction (Minor)</h1>",
    "<h2>Requirements</h2>",
    "<p>Students complete one invented core course for this minor.</p>",
    "<p>Each course must be completed with a grade of C or better.</p>",
    "</main></body></html>",
    "",
  ].join("\n");
  const text = extractPageText(html);
  const meta: SnapshotMeta = { programId: LAYER.id, url: URL, fetchedAt: "2031-01-01T00:00:00.000Z", via: "direct", httpStatus: 200, title: "Fiction (Minor)", edition: null, htmlSha256: sha256(html), textSha256: sha256(text), textChars: text.length };
  const dir = mkdtempSync(join(tmpdir(), "check-coverage-corpus-"));
  mkdirSync(join(dir, "snapshot"));
  writeFileSync(join(dir, "snapshot", "page.html"), html);
  writeFileSync(join(dir, "snapshot", "page.txt"), text);
  writeFileSync(join(dir, "snapshot", "meta.json"), JSON.stringify(meta));
  const ex = extractPage(html, { programId: LAYER.id, textSha256: meta.textSha256 });
  writeFileSync(join(dir, "extract.json"), JSON.stringify(ex, null, 2));
  const idOf = (needle: string) => ex.blocks.find((b) => b.text.includes(needle))!.id;
  const { sharing: _none, ...noSharing } = LAYER;
  const layer: Layer = { ...noSharing, rows: [LAYER.rows[0], LAYER.rows[2]] } as Layer;
  const draft = { ...cleanDraft(), snapshot: { url: URL, textSha256: meta.textSha256 }, layer, listRefs: undefined, ledger: [{ block: idOf("core course"), to: "core" }, { block: idOf("grade of C"), to: "grades" }] };
  const good = join(dir, "merged.json");
  writeFileSync(good, JSON.stringify(draft));
  const quiet = { log: () => {}, err: () => {} };
  assertEqual("clean → 0", runCoverage([good], quiet), 0);
  const saved = JSON.parse(readFileSync(join(dir, "coverage.json"), "utf-8")) as CoverageReport;
  assertEqual("report written and bound to the layer", [saved.ok, saved.layerSha256], [true, layerSha256(layer)]);
  writeFileSync(good, JSON.stringify({ ...draft, ledger: [draft.ledger[0]] }));
  assertEqual("unaccounted → 1", runCoverage([good, "--no-write"], quiet), 1);
  assertEqual("--no-write left the report alone", (JSON.parse(readFileSync(join(dir, "coverage.json"), "utf-8")) as CoverageReport).ok, true);
  assertEqual("no args → 2", runCoverage([], quiet), 2);
  assertEqual("unknown flag → 2", runCoverage([good, "--fix"], quiet), 2);
  assertEqual("unreadable draft → 2", runCoverage([join(dir, "absent.json")], quiet), 2);
  writeFileSync(join(dir, "extract.json"), JSON.stringify({ ...ex, blocks: [] }));
  assertEqual("hand-edited extract → 2", runCoverage([good], quiet), 2);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── check-coverage corpus — ${checks.length} case(s) ──`);
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
