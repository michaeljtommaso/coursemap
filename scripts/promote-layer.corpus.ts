// scripts/promote-layer.corpus.ts
// Asserted, offline corpus for promote-layer.ts (spec 019 Phase 5): major,
// concentration and college layers through a complete, clean, invented chain in
// temp folders (provenance, seed-data/layers, seed-data/golden/layers), plus the
// refusals: stale or unhashed verify/check files, lint and copied page text
// re-checked on the exact layer, fixture course data re-derived from the catalog
// (and the page's page-only courses), unknown fixture keys, free text copying the
// page. NO network, no catalog dump (an invented catalog map is passed in) and no
// repo writes. Exits nonzero on any mismatch.
//
// Run: npx tsx promote-layer.corpus.ts   (from the scripts/ folder)

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GoldenFixture } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import { buildGoldenReport, serializeFixture } from "./check-golden-layer";
import { extractPage } from "./extract-catalog-page";
import { checkPromotion, layerFileText, promote } from "./promote-layer";
import { buildReview, loadReviewInputs } from "./review-sheet";
import { layerSha256, rowUnits, type DistCourse, type Layer, type LayerDiff, type Row, type SnapshotMeta } from "./layer-authoring";

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

// ── Invented layers and courses ─────────────────────────────────────────────
const URL = "https://catalog.cornell.edu/invented-program/";
const HASH = "e".repeat(64);
const PAGE = "Invented page text for the corpus. Nothing here is from a real catalog.\n";
const seat = (id: string, course: string): Row => ({ id, kind: "seat", label: `Invented ${id}`, group: "G", source: { url: URL, anchor: "Invented" }, rule: { course: [course] } });
const fict = (id: string): DistCourse => ({ id, subject: "FICT", number: id.slice(5), title: `Invented ${id}`, credits: 3, attrs: [] });
const COURSES = ["FICT-1000", "FICT-2000", "FICT-3000"].map(fict);
/** The invented catalog the fixture's courses are re-derived from. */
const CATALOG = new Map(COURSES.map((c) => [c.id, c]));

const MAJOR: Layer = { id: "invented-bs-2026", kind: "major", family: "cals", name: "Invented Science (BS)", catalogYear: "2026-27", programId: "invented-bs-2026", rows: [seat("m1", "FICT-1000")] };
const CONC: Layer = { ...MAJOR, id: "invented-bs-2026--dairy", kind: "concentration", name: "Invented Science: Dairy", concentrationId: "dairy", rows: [seat("k1", "FICT-2000")] };
const COLLEGE: Layer = { id: "cals-college-2025", kind: "college", family: "cals", name: "Invented CALS College", catalogYear: "2026-27", appliesTo: [{ enteredFrom: "FA25" }], rows: [seat("c1", "FICT-3000")] };

const fixtureFor = (layer: Layer, layerIds: string[], ctx: GoldenFixture["ctx"], plan: string[]): GoldenFixture => ({
  programId: layer.id,
  description: "Fictional student who takes exactly the invented courses.",
  layerIds,
  ctx,
  plan,
  courses: COURSES.filter((c) => plan.includes(c.id)),
});
const MAJOR_FX = fixtureFor(MAJOR, [MAJOR.id], { programId: MAJOR.id, entryTerm: "FA26", transfer: "none" }, ["FICT-1000"]);
const CONC_FX = fixtureFor(CONC, [MAJOR.id, CONC.id], { programId: MAJOR.id, concentrationId: "dairy", entryTerm: "FA26", transfer: "none" }, ["FICT-1000", "FICT-2000"]);
const COLLEGE_FX = fixtureFor(COLLEGE, [COLLEGE.id], { programId: "any-cals-major", entryTerm: "FA26", transfer: "none" }, ["FICT-3000"]);

type Seed = { layersDir: string; goldenDir: string };
function seedDirs(): Seed {
  const root = mkdtempSync(join(tmpdir(), "promote-seed-"));
  return { layersDir: join(root, "layers"), goldenDir: join(root, "golden") };
}

/** A complete, clean provenance folder for `layer`. `reportLayers` are the layers
 *  the golden report is computed on (default: the fixture's, with `layer` itself). */
function provenance(
  layer: Layer,
  fx: GoldenFixture,
  reportLayers: Layer[],
  over: { report?: object; verifyHash?: string | null; checkHash?: string | null; pageHtml?: string } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "promote-prov-"));
  mkdirSync(join(dir, "snapshot"));
  const meta: SnapshotMeta = { programId: layer.id, url: URL, fetchedAt: "2026-10-26T00:00:00.000Z", via: "direct", httpStatus: 200, title: "Invented", edition: null, htmlSha256: "f".repeat(64), textSha256: HASH, textChars: PAGE.length };
  const units = rowUnits(layer);
  const side = (key: string) => ({ key, kind: "seat", label: key, anchor: "Invented", quotes: [] });
  const diff: LayerDiff = { programId: layer.id, layerFields: [], pairs: layer.rows.map((r) => ({ a: side(r.id), b: side(r.id), differences: [] })), onlyA: [], onlyB: [], realCount: 0 };
  const merged = {
    schemaVersion: 1,
    programId: layer.id,
    author: "merged",
    model: "corpus",
    framing: "resolved",
    snapshot: { url: URL, textSha256: HASH },
    layer,
    quotes: Object.fromEntries(layer.rows.map((r) => [r.id, ["Invented page text for the corpus."]])),
  };
  const files: Record<string, unknown> = {
    "merged.json": merged,
    "snapshot/meta.json": meta,
    "diff.json": diff,
    "resolution.json": { programId: layer.id, decisions: [] },
    "check-merged.json": { draft: "merged.json", ok: true, errors: [], warnings: [], ...(over.checkHash === null ? {} : { layerSha256: over.checkHash ?? layerSha256(layer) }) },
    "verify.json": {
      programId: layer.id,
      verdicts: units.map((u) => ({ key: u.key, verdict: "correct", reason: "ok" })),
      ...(over.verifyHash === null ? {} : { layerSha256: over.verifyHash ?? layerSha256(layer) }),
    },
    "golden-report.json": over.report ?? buildGoldenReport(reportLayers, fx),
  };
  for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(v, null, 2));
  writeFileSync(join(dir, "snapshot", "page.txt"), PAGE);
  writeFileSync(join(dir, "golden-fixture.json"), serializeFixture(fx));
  if (over.pageHtml) {
    writeFileSync(join(dir, "snapshot", "page.html"), over.pageHtml);
    writeFileSync(join(dir, "extract.json"), JSON.stringify(extractPage(over.pageHtml, { programId: layer.id, textSha256: HASH }), null, 2));
  }
  return dir;
}

const quiet = { out: [] as string[], err: [] as string[] };
function run(program: string, base: string, seed: Seed): number {
  quiet.out = [];
  quiet.err = [];
  return promote({ program, family: "cals", base, catalog: CATALOG, ...seed }, (s) => quiet.out.push(s), (s) => quiet.err.push(s));
}
const refusals = (program: string, base: string, seed: Seed) => checkPromotion({ program, family: "cals", base, catalog: CATALOG, ...seed }).refusals;
const hasRefusal = (rs: string[], s: string) => rs.some((r) => r.includes(s));

// ── Cases ───────────────────────────────────────────────────────────────────
check("major: promoted to layers/<family>/<id>.json and golden/<id>.json; a re-run is UNCHANGED", () => {
  const seed = seedDirs();
  const base = provenance(MAJOR, MAJOR_FX, [MAJOR]);
  assertEqual("refusals", refusals(MAJOR.id, base, seed), []);
  assertEqual("exit 0", run(MAJOR.id, base, seed), 0);
  assertEqual("layer file (same content)", layerSha256(JSON.parse(readFileSync(join(seed.layersDir, "cals", `${MAJOR.id}.json`), "utf-8"))), layerSha256(MAJOR));
  assertEqual("golden file", readFileSync(join(seed.goldenDir, `${MAJOR.id}.json`), "utf-8"), serializeFixture(MAJOR_FX));
  run(MAJOR.id, base, seed);
  assertTrue("unchanged", quiet.out.filter((l) => l.startsWith("UNCHANGED")).length === 2, quiet.out.join("\n"));
});

check("concentration: refused until its major is promoted, then promoted beside it", () => {
  const seed = seedDirs();
  const base = provenance(CONC, CONC_FX, [MAJOR, CONC]);
  assertEqual("refused → 1", run(CONC.id, base, seed), 1);
  assertTrue("says promote the major first", quiet.err.join("\n").includes("promote the major first"), quiet.err.join("\n"));
  assertTrue("nothing written", !existsSync(join(seed.layersDir, "cals", `${CONC.id}.json`)), "concentration written");
  assertEqual("major → 0", run(MAJOR.id, provenance(MAJOR, MAJOR_FX, [MAJOR]), seed), 0);
  assertEqual("concentration → 0", run(CONC.id, base, seed), 0);
  assertEqual("layer file (same content)", layerSha256(JSON.parse(readFileSync(join(seed.layersDir, "cals", `${CONC.id}.json`), "utf-8"))), layerSha256(CONC));
  const fx = JSON.parse(readFileSync(join(seed.goldenDir, `${CONC.id}.json`), "utf-8")) as GoldenFixture;
  assertEqual("golden fixture names the major first", fx.layerIds, [MAJOR.id, CONC.id]);
});

check("concentration: a golden report computed on another version of the major is refused", () => {
  const seed = seedDirs();
  mkdirSync(join(seed.layersDir, "cals"), { recursive: true });
  writeFileSync(join(seed.layersDir, "cals", `${MAJOR.id}.json`), layerFileText({ ...MAJOR, name: "Invented Science (BS), re-promoted" }));
  const rs = refusals(CONC.id, provenance(CONC, CONC_FX, [MAJOR, CONC]), seed);
  assertTrue("stale major hash", hasRefusal(rs, `different version of ${MAJOR.id} than the one promoted`), JSON.stringify(rs));
});

check("concentration: wrong fixture shape, a mismatched ctx, a bad id, a major of another family are refused", () => {
  const seed = seedDirs();
  mkdirSync(join(seed.layersDir, "cals"), { recursive: true });
  writeFileSync(join(seed.layersDir, "cals", `${MAJOR.id}.json`), layerFileText(MAJOR));
  const only = { ...CONC_FX, layerIds: [CONC.id] };
  assertTrue("layerIds", hasRefusal(refusals(CONC.id, provenance(CONC, only, [CONC]), seed), `must be ["${MAJOR.id}","${CONC.id}"]`), "accepted [conc] only");
  const ctx = { ...CONC_FX, ctx: { ...CONC_FX.ctx, concentrationId: "beef" } };
  assertTrue("ctx", hasRefusal(refusals(CONC.id, provenance(CONC, ctx, [MAJOR, CONC]), seed), "ctx.concentrationId is beef"), "accepted a wrong concentrationId");
  const badId: Layer = { ...CONC, id: "invented-bs-2026--wrong" };
  const rs = refusals(badId.id, provenance(badId, { ...CONC_FX, programId: badId.id, layerIds: [MAJOR.id, badId.id] }, [MAJOR, badId]), seed);
  assertTrue("id contract", hasRefusal(rs, "must be <programId>--<concentrationId>"), JSON.stringify(rs));
  writeFileSync(join(seed.layersDir, "cals", `${MAJOR.id}.json`), layerFileText({ ...MAJOR, kind: "concentration", concentrationId: "x" }));
  const notMajor = refusals(CONC.id, provenance(CONC, CONC_FX, [MAJOR, CONC]), seed);
  assertTrue("promoted file is not a major", hasRefusal(notMajor, "is not the cals major"), JSON.stringify(notMajor));
});

check("college: promoted with layerIds [id]; a ctx its appliesTo does not select is refused", () => {
  const seed = seedDirs();
  const base = provenance(COLLEGE, COLLEGE_FX, [COLLEGE]);
  assertEqual("exit 0", run(COLLEGE.id, base, seed), 0);
  assertTrue("written", existsSync(join(seed.layersDir, "cals", `${COLLEGE.id}.json`)) && existsSync(join(seed.goldenDir, `${COLLEGE.id}.json`)), quiet.out.join("\n"));
  const early = { ...COLLEGE_FX, ctx: { ...COLLEGE_FX.ctx, entryTerm: "FA24" } };
  const rs = refusals(COLLEGE.id, provenance(COLLEGE, early, [COLLEGE]), seedDirs());
  assertTrue("version not selected", hasRefusal(rs, "does not apply to the fixture's student"), JSON.stringify(rs));
});

check("golden: a report without layer hashes, and a fixture that no longer passes, are refused", () => {
  const seed = seedDirs();
  const { layerHashes: _h, ...noHashes } = buildGoldenReport([MAJOR], MAJOR_FX);
  void _h;
  const rs = refusals(MAJOR.id, provenance(MAJOR, MAJOR_FX, [MAJOR], { report: noHashes }), seed);
  assertTrue("no hashes", hasRefusal(rs, `has no hash for ${MAJOR.id}`), JSON.stringify(rs));
  // A report that says ok for the layer, beside a fixture whose plan was later emptied.
  const emptied = { ...MAJOR_FX, plan: ["FICT-3000"], courses: [fict("FICT-3000")] };
  const base = provenance(MAJOR, emptied, [MAJOR], { report: buildGoldenReport([MAJOR], MAJOR_FX) });
  const rs2 = refusals(MAJOR.id, base, seed);
  assertTrue("re-run fails", hasRefusal(rs2, "does not pass on the files being promoted"), JSON.stringify(rs2));
  assertEqual("nothing written", run(MAJOR.id, base, seed), 1);
});

// ── Review fixes ────────────────────────────────────────────────────────────
check("stale files: verify.json / check-merged.json with no hash, or another layer's hash, are refused and nothing is written", () => {
  const seed = seedDirs();
  for (const [name, over] of [
    ["verify without a hash", { verifyHash: null }],
    ["verify with a wrong hash", { verifyHash: "0".repeat(64) }],
    ["check-merged without a hash", { checkHash: null }],
    ["check-merged with a wrong hash", { checkHash: "0".repeat(64) }],
  ] as const) {
    const base = provenance(MAJOR, MAJOR_FX, [MAJOR], over);
    const rs = refusals(MAJOR.id, base, seed);
    assertTrue(name, hasRefusal(rs, "the review sheet raises 1 flag"), JSON.stringify(rs));
    assertEqual(`${name}: exit 1`, run(MAJOR.id, base, seed), 1);
    assertTrue(`${name}: nothing written`, !existsSync(join(seed.layersDir, "cals", `${MAJOR.id}.json`)), "layer written");
  }
  // The same chain, layer edited after stamping: both files are now stale.
  const edited: Layer = { ...MAJOR, name: "Invented Science (BS), edited after the chain" };
  const staleBase = provenance(MAJOR, MAJOR_FX, [MAJOR]);
  const merged = JSON.parse(readFileSync(join(staleBase, "merged.json"), "utf-8"));
  writeFileSync(join(staleBase, "merged.json"), JSON.stringify({ ...merged, layer: edited }));
  assertTrue("edited layer refused", hasRefusal(refusals(MAJOR.id, staleBase, seed), "the review sheet raises"), "edited layer accepted");
});

check("lint and public text are re-run on the exact layer, whatever check-merged.json says", () => {
  const seed = seedDirs();
  const badUrl: Layer = { ...MAJOR, rows: [{ ...seat("m1", "FICT-1000"), source: { url: "https://example.com/x", anchor: "Invented" } }] };
  const lintRs = refusals(MAJOR.id, provenance(badUrl, MAJOR_FX, [badUrl]), seed);
  assertTrue("lint refusal", hasRefusal(lintRs, "lint: "), JSON.stringify(lintRs));
  // Eight words of the page as a row label.
  const copied: Layer = { ...MAJOR, rows: [{ ...seat("m1", "FICT-1000"), label: "Invented page text for the corpus nothing here" }] };
  const copyRs = refusals(MAJOR.id, provenance(copied, MAJOR_FX, [copied]), seed);
  assertTrue("copied public text refused", hasRefusal(copyRs, "public text copies the page: m1 label"), JSON.stringify(copyRs));
  const note: Layer = { ...MAJOR, rows: [{ ...seat("m1", "FICT-1000"), note: "Nothing here is from a real catalog." }] };
  assertEqual("a short overlap (under 8 words) is fine", refusals(MAJOR.id, provenance(note, MAJOR_FX, [note]), seed), []);
});

check("questions (spec 020): a question quoted from the page promotes; a quote not on the page is refused", () => {
  const seed = seedDirs();
  const question = { type: "studentFact", fact: "honorsProgram", subject: MAJOR.id, source: { url: URL, anchor: "Invented" }, quote: "Invented page text for the corpus." } as const;
  const withQ: Layer = { ...MAJOR, questions: [question] };
  assertEqual("clean", refusals(MAJOR.id, provenance(withQ, MAJOR_FX, [withQ]), seed), []);
  const misquoted: Layer = { ...MAJOR, questions: [{ ...question, quote: "Invented page text that the corpus page does not hold." }] };
  const rs = refusals(MAJOR.id, provenance(misquoted, MAJOR_FX, [misquoted]), seed);
  assertTrue("misquote refused", hasRefusal(rs, "question quote is not on the page word for word: questions[0] (studentFact)"), JSON.stringify(rs));
  const short: Layer = { ...MAJOR, questions: [{ ...question, quote: "Invented" }] };
  assertTrue("a too-short quote is refused", hasRefusal(refusals(MAJOR.id, provenance(short, MAJOR_FX, [short]), seed), "question quote"), "no refusal");
});

check("golden fixture course data is re-derived from the catalog: edited credits, attrs, subject, number, a missing or extra entry are refused", () => {
  const seed = seedDirs();
  const withCourses = (courses: DistCourse[]): GoldenFixture => ({ ...MAJOR_FX, courses });
  const cases: [string, GoldenFixture, string][] = [
    ["credits", withCourses([{ ...fict("FICT-1000"), credits: 1 }]), "FICT-1000: the fixture's course data differs from the catalog dump"],
    ["attrs", withCourses([{ ...fict("FICT-1000"), attrs: [{ value: "FREE-PASS" }] }]), "FICT-1000: the fixture's course data differs"],
    ["subject", withCourses([{ ...fict("FICT-1000"), subject: "OTHR" }]), "FICT-1000: the fixture's course data differs"],
    ["number", withCourses([{ ...fict("FICT-1000"), number: "1" }]), "FICT-1000: the fixture's course data differs"],
    ["missing entry", withCourses([fict("FICT-3000")]), "FICT-1000 has no course data"],
    ["extra entry", withCourses([fict("FICT-1000"), fict("FICT-2000")]), "FICT-2000 is in courses but in no plan or probe"],
  ];
  for (const [name, fx, want] of cases) {
    const rs = refusals(MAJOR.id, provenance(MAJOR, fx, [MAJOR]), seed);
    assertTrue(name, hasRefusal(rs, want), JSON.stringify(rs));
  }
  const noDump = checkPromotion({ program: MAJOR.id, family: "cals", base: provenance(MAJOR, MAJOR_FX, [MAJOR]), dump: join(tmpdir(), "no-such-dump.json"), ...seed }).refusals;
  assertTrue("no catalog dump: refused, not trusted", hasRefusal(noDump, "cannot re-derive the golden fixture's courses"), JSON.stringify(noDump));
});

check("golden fixture free text: unknown keys, probe keys and a probe why that copies the page are refused", () => {
  const seed = seedDirs();
  const probe = { courseId: "FICT-2000", rowId: "m1", why: "Invented reason: the seat names a different course." };
  const probeFx = (p: object, extra: object = {}): GoldenFixture => ({ ...MAJOR_FX, mustNotCount: [p as { courseId: string; rowId: string; why: string }], courses: [fict("FICT-1000"), fict("FICT-2000")], ...extra });
  assertEqual("a clean probe is accepted", refusals(MAJOR.id, provenance(MAJOR, probeFx(probe), [MAJOR]), seed), []);
  const copying = refusals(MAJOR.id, provenance(MAJOR, probeFx({ ...probe, why: "Invented page text for the corpus. Nothing here is from a real catalog." }), [MAJOR]), seed);
  assertTrue("why copies the page", hasRefusal(copying, "mustNotCount[0].why copies the page"), JSON.stringify(copying));
  const probeKey = refusals(MAJOR.id, provenance(MAJOR, probeFx({ ...probe, comment: "free text" }), [MAJOR]), seed);
  assertTrue("unknown probe key", hasRefusal(probeKey, 'unknown key "comment" on mustNotCount[0]'), JSON.stringify(probeKey));
  const topKey = refusals(MAJOR.id, provenance(MAJOR, probeFx(probe, { notes: "free text" }), [MAJOR]), seed);
  assertTrue("unknown fixture key", hasRefusal(topKey, 'unknown fixture key "notes"'), JSON.stringify(topKey));
  const ctxKey = refusals(MAJOR.id, provenance(MAJOR, { ...MAJOR_FX, ctx: { ...MAJOR_FX.ctx, remark: "x" } as GoldenFixture["ctx"] }, [MAJOR]), seed);
  assertTrue("unknown ctx key", hasRefusal(ctxKey, 'unknown ctx key "remark"'), JSON.stringify(ctxKey));
  const courseKey = refusals(MAJOR.id, provenance(MAJOR, { ...MAJOR_FX, courses: [{ ...fict("FICT-1000"), blurb: "x" } as DistCourse] }, [MAJOR]), seed);
  assertTrue("unknown course key", hasRefusal(courseKey, 'unknown key "blurb" on courses[0]'), JSON.stringify(courseKey));
});

// A page listing a course the invented catalog lacks (FICT-4000).
const code = (c: string) => `<a href="/search/?P=${c.replace("-", "%20")}" class="bubblelink code">${c.replace("-", "&#160;")}</a>`;
const PAGE_HTML = `<!doctype html><html><head><title>Invented (BS)</title></head><body><main id="contentarea"><h1 class="page-title">Invented (BS)</h1>
<div id="curriculumtextcontainer"><h2>Invented Core</h2><table class="sc_courselist"><tbody>
<tr><td class="codecol">${code("FICT-4000")}</td><td>Invented page-only course</td><td class="hourscol">3</td></tr>
</tbody></table></div></main></body></html>`;
const PAGE_ONLY_COURSE = { id: "FICT-4000", subject: "FICT", number: "4000", title: "(listed on the catalog page; not in the catalog dump)", credits: 3, attrs: [] };

check("page-only courses: promoted when marked pageOnly and the folder's verified extract lists them; refused otherwise", () => {
  const seed = seedDirs();
  const layer: Layer = { ...MAJOR, rows: [seat("m1", "FICT-1000"), seat("m2", "FICT-4000")] };
  const fx = (c: object): GoldenFixture => ({ ...MAJOR_FX, plan: ["FICT-1000", "FICT-4000"], courses: [fict("FICT-1000"), c as DistCourse] });
  const ok = provenance(layer, fx({ ...PAGE_ONLY_COURSE, pageOnly: true }), [layer], { pageHtml: PAGE_HTML });
  assertEqual("marked and listed: clean", refusals(MAJOR.id, ok, seed), []);
  assertEqual("promoted", run(MAJOR.id, ok, seed), 0);
  const unmarked = refusals(MAJOR.id, provenance(layer, fx(PAGE_ONLY_COURSE), [layer], { pageHtml: PAGE_HTML }), seed);
  assertTrue("unmarked", hasRefusal(unmarked, 'FICT-4000 is a page-only course but is not marked "pageOnly": true'), JSON.stringify(unmarked));
  const noExtract = refusals(MAJOR.id, provenance(layer, fx({ ...PAGE_ONLY_COURSE, pageOnly: true }), [layer]), seed);
  assertTrue("no extract.json: the id is in neither source", hasRefusal(noExtract, "FICT-4000 is in neither the catalog dump nor the saved page's lists"), JSON.stringify(noExtract));
  const wrongCredits = refusals(MAJOR.id, provenance(layer, fx({ ...PAGE_ONLY_COURSE, credits: 4, pageOnly: true }), [layer], { pageHtml: PAGE_HTML }), seed);
  assertTrue("page-only credits must match the page", hasRefusal(wrongCredits, "FICT-4000: the fixture's course data differs from the saved page"), JSON.stringify(wrongCredits));
  const dir = provenance(layer, fx({ ...PAGE_ONLY_COURSE, pageOnly: true }), [layer], { pageHtml: PAGE_HTML });
  writeFileSync(join(dir, "extract.json"), "{ broken");
  const broken = refusals(MAJOR.id, dir, seed);
  assertTrue("a broken extract.json is refused", hasRefusal(broken, "extract.json cannot be used"), JSON.stringify(broken));
});

// ── Targeted edits released on an edit ledger (edit-ledger.ts) ──────────────
// The verified layer has m1 and m2; the edit points m2 at another course.
const V1: Layer = { ...MAJOR, rows: [seat("m1", "FICT-1000"), seat("m2", "FICT-2000")] };
const V2: Layer = { ...MAJOR, rows: [seat("m1", "FICT-1000"), seat("m2", "FICT-3000")] };
const V2_FX = fixtureFor(V2, [V2.id], MAJOR_FX.ctx, ["FICT-1000", "FICT-3000"]);
const ON_PAGE = "Nothing here is from a real catalog.";
const m2Edit = (over: object = {}) => ({ key: "m2", change: "changed", resolution: "corpus resolution 1", quote: ON_PAGE, why: "the page names the other course", ...over });

/** A provenance folder holding V2 (checked and golden-tested on V2) whose
 *  verify.json was made on `verifiedOn`, with edit-base.json = `base` and the
 *  given ledger (null: no edits.json). */
function edited(ledger: object | null, o: { base?: Layer; verifiedOn?: Layer; report?: object; decisions?: object[] } = {}): string {
  const base = o.base ?? V1;
  const dir = provenance(V2, V2_FX, [V2], { verifyHash: layerSha256(o.verifiedOn ?? base), report: o.report });
  writeFileSync(join(dir, "edit-base.json"), JSON.stringify(base, null, 2));
  if (ledger) writeFileSync(join(dir, "edits.json"), JSON.stringify({ programId: V2.id, baseLayerSha256: layerSha256(base), ...ledger }, null, 2));
  if (o.decisions) writeFileSync(join(dir, "resolution.json"), JSON.stringify({ programId: V2.id, decisions: o.decisions }, null, 2));
  return dir;
}

check("edit ledger: a clean edit (only the listed row changed, quote on the page, golden passing) is promoted", () => {
  const seed = seedDirs();
  const base = edited({ rows: [m2Edit()] });
  assertEqual("refusals", refusals(V2.id, base, seed), []);
  assertEqual("exit 0", run(V2.id, base, seed), 0);
  assertEqual("the edited layer is written", layerSha256(JSON.parse(readFileSync(join(seed.layersDir, "cals", `${V2.id}.json`), "utf-8"))), layerSha256(V2));
});

check("edit ledger: without one, a layer edited after verification is still refused (the full-chain rule)", () => {
  const rs = refusals(V2.id, edited(null), seedDirs());
  assertTrue("stale verify", hasRefusal(rs, "flag(s)"), JSON.stringify(rs));
});

check("edit ledger: a change the ledger does not list is refused", () => {
  const seed = seedDirs();
  const dir = edited({ rows: [] });
  const rs = refusals(V2.id, dir, seed);
  assertTrue("refused", hasRefusal(rs, "flag(s)"), JSON.stringify(rs));
  assertTrue("the sheet names the row", sheetHas(dir, "row m2 was changed but edits.json does not list it"), "no unlisted-change line");
  assertEqual("nothing written", run(V2.id, dir, seed), 1);
});

check("edit ledger: a sign-off whose quote is not on page.txt is refused", () => {
  const dir = edited({ rows: [m2Edit({ quote: "A sentence the page never says anywhere." })] });
  assertTrue("refused", hasRefusal(refusals(V2.id, dir, seedDirs()), "flag(s)"), "accepted");
  assertTrue("the sheet says so", sheetHas(dir, "the quote is not on snapshot/page.txt word for word"), "no quote line");
});

check("edit ledger: a golden plan that fails on the edited layer is refused", () => {
  const stale = fixtureFor(V2, [V2.id], MAJOR_FX.ctx, ["FICT-1000", "FICT-2000"]);
  const dir = edited({ rows: [m2Edit()] }, { report: buildGoldenReport([V2], stale) });
  const rs = refusals(V2.id, dir, seedDirs());
  assertTrue("golden not ok flags", hasRefusal(rs, "flag(s)") && sheetHas(dir, "Golden plan: ⚠ NOT ok"), JSON.stringify(rs));
});

check("edit ledger: wrong change kind, a base verify.json was not made on, and a non-open answer are refused", () => {
  const affirmed = edited({ rows: [m2Edit({ change: "affirmed" })] });
  assertTrue("affirmed but changed", sheetHas(affirmed, "row m2 is listed as affirmed (unchanged) but it was changed") && refusals(V2.id, affirmed, seedDirs()).length > 0, "accepted");
  const otherBase = edited({ rows: [m2Edit()] }, { verifiedOn: MAJOR });
  assertTrue("verify not on the base", sheetHas(otherBase, "verify.json was not made on edit-base.json") && refusals(V2.id, otherBase, seedDirs()).length > 0, "accepted");
  const notOpen = edited({ rows: [m2Edit()], answers: [{ ref: "onlyA m9", resolution: "r", why: "w" }] });
  assertTrue("answer to nothing", sheetHas(notOpen, 'answers "onlyA m9", which is not an open question'), "no line");
});

check("edit ledger: an open question is closed by an answer; affirmed rows replace an unsure verdict", () => {
  const open = [{ ref: "onlyA m2", chosen: "a", explanation: "page unclear", needsMichael: true }];
  const unanswered = edited({ rows: [m2Edit()] }, { decisions: open });
  assertTrue("open question still refuses", refusals(V2.id, unanswered, seedDirs()).length > 0, "accepted with an open question");
  const answered = edited({ rows: [m2Edit()], answers: [{ ref: "`onlyA m2`", resolution: "corpus resolution 2", why: "settled by the page" }] }, { decisions: open });
  assertEqual("answered → clean", refusals(V2.id, answered, seedDirs()), []);
  // m1 unchanged but its verifier verdict was "unsure": an affirmed sign-off stands in for it.
  const dir = edited({ rows: [m2Edit(), { key: "m1", change: "affirmed", resolution: "corpus resolution 3", quote: ON_PAGE, why: "confirmed" }] });
  const v = JSON.parse(readFileSync(join(dir, "verify.json"), "utf-8"));
  v.verdicts = v.verdicts.map((x: { key: string }) => (x.key === "m1" ? { ...x, verdict: "unsure" } : x));
  writeFileSync(join(dir, "verify.json"), JSON.stringify(v, null, 2));
  assertEqual("affirmed → clean", refusals(V2.id, dir, seedDirs()), []);
});

/** A single-author new layer: V2 with no diff, resolution, verify or edit-base. */
function singleAuthor(rows: object[]): string {
  const dir = edited(null);
  for (const f of ["diff.json", "resolution.json", "verify.json", "edit-base.json"]) rmSync(join(dir, f));
  writeFileSync(join(dir, "edits.json"), JSON.stringify({ programId: V2.id, baseLayerSha256: "", newLayer: true, rows }, null, 2));
  return dir;
}
const added = (key: string) => ({ key, change: "added", resolution: "single author", quote: ON_PAGE, why: "the page says so" });

check("new layer (single author): every row signed off as added promotes without diff, resolution or verify", () => {
  const seed = seedDirs();
  const dir = singleAuthor([added("m1"), added("m2")]);
  assertEqual("refusals", refusals(V2.id, dir, seed), []);
  assertEqual("exit 0", run(V2.id, dir, seed), 0);
});

check("new layer (single author): a row without a sign-off, a verify.json beside it, or a failing golden plan is refused", () => {
  const one = singleAuthor([added("m1")]);
  assertTrue("unlisted row", sheetHas(one, "row m2 was added but edits.json does not list it") && refusals(V2.id, one, seedDirs()).length > 0, "accepted");
  const withVerify = singleAuthor([added("m1"), added("m2")]);
  writeFileSync(join(withVerify, "verify.json"), JSON.stringify({ programId: V2.id, verdicts: [], layerSha256: layerSha256(V2) }));
  assertTrue("verify beside it", sheetHas(withVerify, "cannot sit beside a verify.json") && refusals(V2.id, withVerify, seedDirs()).length > 0, "accepted");
  const stale = fixtureFor(V2, [V2.id], MAJOR_FX.ctx, ["FICT-1000", "FICT-2000"]);
  const failing = singleAuthor([added("m1"), added("m2")]);
  writeFileSync(join(failing, "golden-report.json"), JSON.stringify(buildGoldenReport([V2], stale)));
  assertTrue("golden", refusals(V2.id, failing, seedDirs()).length > 0, "accepted a failing golden plan");
});

function sheetHas(dir: string, text: string): boolean {
  return buildReview(loadReviewInputs(dir)).markdown.includes(text);
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`\n── promote-layer corpus — ${checks.length} case(s) ──`);
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
