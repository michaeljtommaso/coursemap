// scripts/review-sheet.corpus.ts
// Asserted, offline corpus for review-sheet.ts. NO network: a fictional major
// built in code with invented quote text, and hand-written verifier, diff,
// resolution, golden and check reports. Exits nonzero on any mismatch.
//
// Run: npx tsx review-sheet.corpus.ts   (from the scripts/ folder)

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildReview, buildReviewSheet, decisionsFor, describeList, describeRowShort, loadReviewInputs, parseRef, type ReviewInputs } from "./review-sheet";
import { extractPage } from "./extract-catalog-page";
import {
  describeRow,
  layerSha256,
  parseDraft,
  rowUnits,
  type CheckReport,
  type Draft,
  type GoldenReport,
  type LayerDiff,
  type Resolution,
  type Row,
  type RowSide,
  type SnapshotMeta,
  type Verification,
} from "./layer-authoring";

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

// ── Fixtures (a fictional major; quotes are invented) ───────────────────────
const URL = "https://catalog.example.edu/demo-econ/";
const HASH = "a".repeat(64);
const src = (anchor: string) => ({ url: URL, anchor });

const rows: Row[] = [
  { id: "core-micro", kind: "seat", label: "Intermediate micro", group: "Core", source: src("Core"), rule: { course: ["ECON-1110"] } },
  {
    id: "upper",
    kind: "pool",
    label: "Upper-level electives",
    group: "Electives",
    source: src("Electives"),
    rule: { allOf: [{ subject: ["ECON"] }, { number: { min: 3000 } }] },
    requiredCourses: 3,
    requiredCredits: 9,
  },
  {
    id: "capstone",
    kind: "anyOf",
    label: "Capstone",
    group: "Capstone",
    source: src("Capstone"),
    rows: [
      { id: "honors", kind: "seat", label: "Honors thesis", group: "Capstone", source: src("Capstone"), rule: { course: ["ECON-4990"] } },
      {
        id: "project",
        kind: "pool",
        label: "Project courses",
        group: "Capstone",
        source: src("Capstone"),
        rule: { subject: ["ECON"] },
        requiredCourses: 2,
        requiredCredits: 6,
      },
    ],
  },
  { id: "grades", kind: "confirm", label: "Grade of C or better", group: "Policy", source: src("Policy") },
];

const merged: Draft = parseDraft({
  schemaVersion: 1,
  programId: "demo-econ-ba",
  author: "merged",
  model: "model-three",
  framing: "resolved",
  snapshot: { url: URL, textSha256: HASH },
  layer: { id: "demo-econ-ba", kind: "major", family: "cas", name: "Demo Economics (BA)", catalogYear: "2026-27", programId: "demo-econ-ba", rows },
  quotes: {
    "core-micro": ["Invented sentence: students take the micro course."],
    upper: ["Invented sentence: three electives at the 3000 level or above."],
    capstone: ["Invented sentence: complete one capstone option."],
    "capstone/project": ["Invented sentence: two project courses."],
    grades: ["Invented sentence: a C or better in every course."],
  },
});

const meta: SnapshotMeta = {
  programId: "demo-econ-ba",
  url: URL,
  fetchedAt: "2026-10-20T14:00:00.000Z",
  via: "direct",
  httpStatus: 200,
  title: "Demo Economics",
  edition: "2026-2027",
  htmlSha256: "b".repeat(64),
  textSha256: HASH,
  textChars: 1234,
};

const verify: Verification = {
  programId: "demo-econ-ba",
  verdicts: [
    { key: "core-micro", verdict: "correct", reason: "matches the sentence" },
    { key: "upper", verdict: "wrong", reason: "the page asks for 12 credits, not 9" },
    { key: "capstone", verdict: "correct", reason: "two options, either suffices" },
    { key: "capstone/honors", verdict: "unsure", reason: "the course number is not on the page" },
    { key: "grades", verdict: "correct", reason: "policy row" },
  ],
};

const side = (key: string, kind: string, label: string): RowSide => ({ key, kind, label, anchor: "X", quotes: [] });
const diff: LayerDiff = {
  programId: "demo-econ-ba",
  layerFields: [{ path: "name", a: "x", b: "y", severity: "harmless" }],
  pairs: [
    { a: side("core-micro", "seat", "Micro"), b: side("micro", "seat", "Micro"), differences: [{ path: "id", a: "core-micro", b: "micro", severity: "harmless" }] },
    { a: side("upper", "pool", "Electives"), b: side("electives", "pool", "Electives"), differences: [{ path: "requiredCredits", a: 9, b: 12, severity: "real" }] },
    {
      a: side("capstone", "anyOf", "Capstone"),
      b: side("cap", "anyOf", "Capstone"),
      differences: [
        { path: "rows[project~proj].requiredCourses", a: 2, b: 3, severity: "real" },
        { path: "rows[honors~thesis].rule", a: { course: ["ECON-4990"] }, b: { pattern: "ECON 499x" }, severity: "equivalent", note: "same courses" },
      ],
    },
  ],
  onlyA: [],
  onlyB: [side("grades", "confirm", "Grades")],
  realCount: 2 + 1,
};

const resolution: Resolution = {
  programId: "demo-econ-ba",
  decisions: [
    { ref: "pair upper~electives requiredCredits", chosen: "a", explanation: "the cited sentence says nine credits", needsMichael: false },
    { ref: "pair capstone~cap rows[project~proj].requiredCourses", chosen: "b", explanation: "the page is unclear between two and three courses", needsMichael: true },
    { ref: "onlyB grades", chosen: "b", explanation: "the page states a grade policy", needsMichael: false },
  ],
};

const golden: GoldenReport = { programId: "demo-econ-ba", ok: false, pct: 92, unmetRows: [{ layerId: "demo-econ-ba", rowId: "upper", status: "partial" }], notLoadBearing: ["ECON-3120"], unknownCourses: [] };
const checkMerged: CheckReport = { draft: "merged.json", ok: true, errors: [], warnings: [{ code: "low-coverage", key: "core-micro", message: "only 1 catalog course" }] };

const full: ReviewInputs = { merged, meta, verify, diff, resolution, golden, checkMerged };

/** The block for one unit: from its heading to the next heading. */
function block(md: string, key: string): string {
  const start = md.search(new RegExp("^### .*`" + key.replace(/[/]/g, "\\/") + "`", "m"));
  if (start < 0) return "";
  const rest = md.slice(start + 4);
  const end = rest.search(/^##/m);
  return end < 0 ? rest : rest.slice(0, end);
}

// ── Cases ───────────────────────────────────────────────────────────────────
check("refs parse into row keys and option ids", () => {
  assertEqual("pair", parseRef("pair upper~electives requiredCredits"), { kind: "pair", keys: ["upper", "electives"], childIds: [] });
  assertEqual("pair child", parseRef("pair capstone~cap rows[project~proj].requiredCourses").childIds, ["project", "proj"]);
  assertEqual("unpaired option", parseRef("pair capstone~cap rows[~internship]").childIds, ["internship"]);
  assertEqual("onlyB", parseRef("onlyB grades").keys, ["grades"]);
  assertEqual("layer", parseRef("layer catalogYear"), { kind: "layer", keys: [], childIds: [] });
});

check("decisions attach to the right rows (option decisions to the option, not the parent)", () => {
  const units = rowUnits(merged.layer);
  const refs = (key: string) => decisionsFor(units.find((u) => u.key === key)!, resolution.decisions, merged.layer).map((d) => d.ref);
  assertEqual("upper", refs("upper"), ["pair upper~electives requiredCredits"]);
  assertEqual("capstone parent", refs("capstone"), []);
  assertEqual("capstone/project", refs("capstone/project"), ["pair capstone~cap rows[project~proj].requiredCourses"]);
  assertEqual("capstone/honors", refs("capstone/honors"), []);
  assertEqual("grades", refs("grades"), ["onlyB grades"]);
  assertEqual("core-micro", refs("core-micro"), []);
  const dropped = decisionsFor(units.find((u) => u.key === "capstone")!, [{ ref: "pair capstone~cap rows[~internship]", chosen: "a", explanation: "x", needsMichael: false }], merged.layer);
  assertEqual("a dropped option's decision goes to the parent", dropped.length, 1);
  const whole = (ref: string, key: string) =>
    decisionsFor(units.find((u) => u.key === key)!, [{ ref, chosen: "b", explanation: "x", needsMichael: false }], merged.layer).length;
  assertEqual("a whole anyOf row one author wrote covers its options", whole("onlyB capstone", "capstone/project"), 1);
  assertEqual("an added anyOf row covers its options", whole("added capstone", "capstone/honors"), 1);
  assertEqual("a pair decision on the parent does not cover an option", whole("pair capstone~cap label", "capstone/project"), 0);
});

check("a ref copied with its markdown backticks is the same ref", () => {
  assertEqual("backticks", parseRef("`pair upper~electives requiredCredits`"), parseRef("pair upper~electives requiredCredits"));
  assertEqual("onlyA", parseRef(" `onlyA grades` ").keys, ["grades"]);
});

check("full sheet: title, source, status block", () => {
  const md = buildReviewSheet(full);
  for (const s of [
    "# Review: Demo Economics (BA)",
    "`demo-econ-ba`",
    "catalog year 2026-27",
    `- Page: ${URL}`,
    "fetched 2026-10-20",
    "via direct",
    `text \`${HASH}\``,
    "- Rows: 4 (6 checkable units",
    "3 correct",
    "⚠ 1 wrong",
    "⚠ 1 unsure",
    "⚠ 1 not verified",
    "- Questions for Michael: ⚠ 1 open",
    "3 real difference(s)",
    "- Golden plan: ⚠ NOT ok (92%)",
    "upper (partial)",
    "courses the plan does not need (removing one still scores 100%): ECON-3120",
    "- Checks on the merged layer: ok (0 error(s), 1 warning(s))",
    "only 1 catalog course",
  ])
    assertTrue(`contains ${s}`, md.includes(s), md);
});

check("full sheet: open questions surfaced up top", () => {
  const md = buildReviewSheet(full);
  const q = md.indexOf("## ⚠ Questions for Michael");
  assertTrue("section exists before the rows", q >= 0 && q < md.indexOf("## Rows"), md);
  assertTrue("lists the question", md.slice(q, md.indexOf("## Rows")).includes("the page is unclear between two and three courses"), md);
});

check("full sheet: wrong / unsure rows flagged, resolutions on the right rows", () => {
  const md = buildReviewSheet(full);
  const upper = block(md, "upper");
  assertTrue("upper flagged", upper.startsWith("⚠"), upper);
  assertTrue("upper wrong", upper.includes("**⚠ Verifier: wrong** — the page asks for 12 credits, not 9"), upper);
  assertTrue("upper resolved", upper.includes("Resolved — chose a (`pair upper~electives requiredCredits`): the cited sentence says nine credits"), upper);
  assertTrue("upper meaning", upper.includes("- Means: 3 courses and 9 credits from:"), upper);
  assertTrue("upper quote", upper.includes("> Invented sentence: three electives at the 3000 level or above."), upper);

  const honors = block(md, "capstone/honors");
  assertTrue("honors flagged unsure", honors.startsWith("⚠") && honors.includes("**⚠ Verifier: unsure**"), honors);
  assertTrue("honors inherits the parent's quote", honors.includes("> Invented sentence: complete one capstone option."), honors);
  assertTrue("honors agreed (equivalent)", honors.includes("both authors agreed (written differently, same catalog courses: rows[honors~thesis].rule)"), honors);

  const project = block(md, "capstone/project");
  assertTrue("project open question", project.startsWith("⚠") && project.includes("⚠ **open question** — Resolved — chose b"), project);
  assertTrue("project not verified", project.includes("⚠ not verified"), project);

  const cap = block(md, "capstone");
  assertTrue("capstone parent clean", !cap.startsWith("⚠") && cap.includes("How it came to be: both authors agreed"), cap);
  const micro = block(md, "core-micro");
  assertTrue("core-micro agreed, not flagged", !micro.startsWith("⚠") && micro.includes("both authors agreed") && micro.includes("Verifier: correct"), micro);
  const grades = block(md, "grades");
  assertTrue("grades resolved from onlyB", grades.includes("Resolved — chose b (`onlyB grades`)"), grades);
});

check("full sheet: the decision list closes the sheet", () => {
  const md = buildReviewSheet(full);
  const tail = md.slice(md.indexOf("## Resolver decisions"));
  assertTrue("three decisions", tail.includes("1. `pair upper~electives requiredCredits` — chose **a**") && tail.includes("3. `onlyB grades`"), tail);
  assertTrue("open one marked", tail.includes("2. ⚠ `pair capstone~cap rows[project~proj].requiredCourses` — chose **b** (needs Michael)"), tail);
});

check("only merged.json: every optional input reported missing, nothing invented", () => {
  const { markdown: md, summary } = buildReview({ merged });
  for (const s of ["Verifier: ⚠ not run (no verify.json)", "Golden plan: not run", "Checks on the merged layer: not run", "Blind drafts: no diff.json", "no snapshot/meta.json", "No resolution.json.", "How it came to be: no diff on file", "- Verifier: not verified"])
    assertTrue(`contains ${s}`, md.includes(s), md);
  assertTrue("no questions section", !md.includes("Questions for Michael\n"), md);
  assertTrue("no agreement claimed", !md.includes("both authors agreed"), md);
  assertTrue("flagged (no verifier)", summary.flags > 0, String(summary.flags));
  assertEqual("units", summary.units, 6);
});

check("a row the diff never saw, or an unresolved difference, is flagged", () => {
  const renamed = parseDraft({ ...merged, layer: { ...merged.layer, rows: merged.layer.rows.map((r) => (r.id === "core-micro" ? { ...r, id: "micro-core" } : r)) }, quotes: { ...merged.quotes, "micro-core": ["Invented sentence: students take the micro course."] } });
  const md = buildReviewSheet({ ...full, merged: renamed });
  assertTrue("unknown origin", block(md, "micro-core").includes("⚠ row id not found in the diff"), block(md, "micro-core"));
  const md2 = buildReviewSheet({ ...full, resolution: { programId: "demo-econ-ba", decisions: [] } });
  assertTrue("unresolved", block(md2, "upper").includes("⚠ the authors differed here (requiredCredits) and no resolver decision mentions it"), block(md2, "upper"));
  assertTrue("only one author", block(md2, "grades").includes("⚠ only author B wrote this row"), block(md2, "grades"));
});

check("a merged layer written from another snapshot is flagged", () => {
  const md = buildReviewSheet({ ...full, meta: { ...meta, textSha256: "c".repeat(64) } });
  assertTrue("snapshot mismatch", md.includes("⚠ **the merged layer was written from a different snapshot**"), md);
});

check("a clean sheet has no flags", () => {
  const clean: ReviewInputs = {
    merged,
    meta,
    verify: { programId: "demo-econ-ba", verdicts: rowUnits(merged.layer).map((u) => ({ key: u.key, verdict: "correct" as const, reason: "ok" })), layerSha256: layerSha256(merged.layer) } as Verification,
    golden: { ...golden, ok: true, pct: 100, unmetRows: [], notLoadBearing: [] },
    checkMerged: { ...checkMerged, warnings: [], layerSha256: layerSha256(merged.layer) } as CheckReport,
  };
  const { markdown, summary } = buildReview(clean);
  assertEqual("flags", summary.flags, 0);
  assertTrue("no ⚠ anywhere", !markdown.includes("⚠"), markdown);
});

check("CLI: writes review.md; exit 2 without merged.json; exit 1 when flagged", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-sheet-"));
  const run = (...args: string[]) => spawnSync(`npx tsx review-sheet.ts ${args.map((x) => `"${x}"`).join(" ")}`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  assertEqual("missing merged → 2", run("--program", "demo-econ-ba", "--dir", dir).status, 2);
  assertEqual("no program → 2", run("--dir", dir).status, 2);
  writeFileSync(join(dir, "merged.json"), JSON.stringify(merged));
  mkdirSync(join(dir, "snapshot"));
  writeFileSync(join(dir, "snapshot", "meta.json"), JSON.stringify(meta));
  for (const [f, v] of [["verify.json", verify], ["diff.json", diff], ["resolution.json", resolution], ["golden-report.json", golden], ["check-merged.json", checkMerged]] as const)
    writeFileSync(join(dir, f), JSON.stringify(v));
  const r = run("--program", "demo-econ-ba", "--dir", dir);
  assertEqual("flagged → 1", r.status, 1);
  assertTrue("review.md written", existsSync(join(dir, "review.md")) && readFileSync(join(dir, "review.md"), "utf-8").includes("# Review: Demo Economics (BA)"), r.stderr);
  writeFileSync(join(dir, "verify.json"), "{ broken");
  assertEqual("unreadable optional input → 2", run("--program", "demo-econ-ba", "--dir", dir, "--out", join(dir, "x.md")).status, 2);
});

// ── List-backed rows (Phase 5) ───────────────────────────────────────────────
// An invented page in the catalog's list template: one heading, one lead line,
// fourteen invented courses (more than COURSE_LIST_MAX).
const LIST_IDS = Array.from({ length: 14 }, (_, i) => `FICT-${3100 + i * 10}`);
const code = (c: string) => `<a href="/search/?P=${c.replace("-", "%20")}" class="bubblelink code">${c.replace("-", "&#160;")}</a>`;
const LIST_PAGE = `<!doctype html><html><head><title>Fictional Studies (BA)</title></head><body>
<main id="contentarea"><h1 class="page-title">Fictional Studies (BA)</h1>
<div id="curriculumtextcontainer"><h2>Invented Electives</h2>
<table class="sc_courselist"><tbody>
<tr><td colspan="2"><span class="courselistcomment">Choose any three of these invented courses:</span></td><td class="hourscol"></td></tr>
${LIST_IDS.map((c) => `<tr><td class="codecol">${code(c)}</td><td>Invented Topic ${c.slice(5)}</td><td class="hourscol">3</td></tr>`).join("\n")}
</tbody></table></div></main></body></html>`;
const LIST_EX = extractPage(LIST_PAGE, { programId: "demo-econ-ba", textSha256: HASH });
const wideRow = (ids: string[]): Extract<Row, { kind: "pool" }> => ({ id: "wide", kind: "pool", label: "Invented electives", group: "Electives", source: src("Electives"), rule: { course: ids }, requiredCourses: 3, requiredCredits: 9 });
const listMerged = (ids: string[], listRefs: Record<string, string[]> | undefined): Draft =>
  parseDraft({
    ...merged,
    layer: { ...merged.layer, rows: [wideRow(ids)] },
    quotes: { wide: ["Invented sentence: three electives from the list."] },
    ...(listRefs ? { listRefs } : {}),
  });
const allCorrect = (d: Draft): Verification =>
  ({ programId: d.programId, verdicts: rowUnits(d.layer).map((u) => ({ key: u.key, verdict: "correct" as const, reason: "ok" })), layerSha256: layerSha256(d.layer) }) as Verification;
const stampedCheck = (d: Draft): CheckReport => ({ ...checkMerged, warnings: [], layerSha256: layerSha256(d.layer) }) as CheckReport;
const cleanFor = (d: Draft): ReviewInputs => ({ merged: d, meta, verify: allCorrect(d), golden: { ...golden, ok: true, pct: 100, unmetRows: [], notLoadBearing: [] }, checkMerged: stampedCheck(d) });

check("long course lists: shortened to the first 8 sorted ids plus a count; short lists unchanged", () => {
  const thirteen = [...LIST_IDS.slice(0, 13)].reverse();
  const text = describeRowShort(wideRow(thirteen));
  const sorted = [...thirteen].sort();
  assertTrue("first eight, sorted", text.includes(`one of ${sorted.slice(0, 8).map((c) => c.replace("-", " ")).join(", ")} … and 5 more`), text);
  assertTrue("ninth not printed", !text.includes(sorted[8].replace("-", " ")), text);
  assertEqual("rest of the sentence kept", text.endsWith("… and 5 more."), true);
  const twelve = wideRow(LIST_IDS.slice(0, 12));
  assertEqual("12 ids: same as describeRow", describeRowShort(twelve), describeRow(twelve));
  const nested: Row = { ...wideRow([]), rule: { allOf: [{ course: LIST_IDS }, { not: { course: ["FICT-3100"] } }] } };
  const n = describeRowShort(nested);
  assertTrue("nested long list shortened, short one kept", n.includes("… and 6 more") && n.includes("not (FICT 3100)"), n);
});

check("list-backed unit: shows list, count, heading and lead; no flag when clean", () => {
  const d = listMerged(LIST_IDS, { wide: ["L1"] });
  const { markdown: md, summary } = buildReview({ ...cleanFor(d), extract: LIST_EX });
  const b = block(md, "wide");
  assertTrue("list line", b.includes("- From: from list L1 — 14 courses, under 'Invented Electives' (lead: 'Choose any three of these invented courses:')"), b);
  assertTrue("status line", md.includes("- Extracted lists: 1 unit(s) use 1 list(s) from extract.json"), md);
  assertTrue("means shortened", b.includes("… and 6 more") && !b.includes(LIST_IDS[13].replace("-", " ")), b);
  assertEqual("flags", summary.flags, 0);
  assertTrue("describeList", describeList(LIST_EX.lists[0]).startsWith("from list L1 — 14 courses"), describeList(LIST_EX.lists[0]));
});

check("list-backed unit: a row missing a list course, an unknown list, a stray key are flagged", () => {
  const short = listMerged(LIST_IDS.slice(1), { wide: ["L1"] });
  const r1 = buildReview({ ...cleanFor(short), extract: LIST_EX });
  assertTrue("missing course flagged", block(r1.markdown, "wide").startsWith("⚠") && block(r1.markdown, "wide").includes("the row does not name 1 of the list's courses (FICT-3100)"), r1.markdown);
  assertEqual("one flag", r1.summary.flags, 1);
  const unknown = listMerged(LIST_IDS, { wide: ["L9"] });
  const r2 = buildReview({ ...cleanFor(unknown), extract: LIST_EX });
  assertTrue("unknown list flagged", block(r2.markdown, "wide").includes("⚠ From list L9: not in extract.json"), r2.markdown);
  assertTrue("unknown → flag", r2.summary.flags > 0, String(r2.summary.flags));
  const stray = listMerged(LIST_IDS, { wide: ["L1"], gone: ["L1"] });
  const r3 = buildReview({ ...cleanFor(stray), extract: LIST_EX });
  assertTrue("stray key flagged", r3.markdown.includes("⚠ listRefs name rows not in this layer: gone"), r3.markdown);
});

check("list-backed unit: no extract, or a broken one, is a flag (not a crash)", () => {
  const d = listMerged(LIST_IDS, { wide: ["L1"] });
  const r1 = buildReview(cleanFor(d));
  assertTrue("no extract", r1.markdown.includes("⚠ Extracted lists: the layer names extracted lists but there is no extract.json"), r1.markdown);
  assertTrue("unit says why", block(r1.markdown, "wide").includes("⚠ From list L1: cannot show it"), r1.markdown);
  const r2 = buildReview({ ...cleanFor(d), extractError: "extract.json does not match page.html" });
  assertTrue("broken extract", r2.markdown.includes("⚠ Extracted lists: extract.json cannot be used: extract.json does not match page.html"), r2.markdown);
  const r3 = buildReview({ ...cleanFor(listMerged(LIST_IDS, undefined)), extractError: "Unexpected token" });
  assertTrue("a broken extract flags even when no row uses it", r3.summary.flags > 0, r3.markdown);
  const r4 = buildReview({ ...cleanFor(d), extract: { ...LIST_EX, textSha256: "d".repeat(64) } });
  assertTrue("extract from another snapshot", r4.markdown.includes("⚠ extract.json was made from a different snapshot"), r4.markdown);
});

check("CLI: a verified extract.json is shown (exit 0); a stale or broken one flags (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-sheet-list-"));
  const run = () => spawnSync(`npx tsx review-sheet.ts --program demo-econ-ba --dir "${dir}"`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  const d = listMerged(LIST_IDS, { wide: ["L1"] });
  writeFileSync(join(dir, "merged.json"), JSON.stringify(d));
  mkdirSync(join(dir, "snapshot"));
  writeFileSync(join(dir, "snapshot", "meta.json"), JSON.stringify(meta));
  writeFileSync(join(dir, "snapshot", "page.html"), LIST_PAGE);
  writeFileSync(join(dir, "verify.json"), JSON.stringify(allCorrect(d)));
  writeFileSync(join(dir, "golden-report.json"), JSON.stringify({ ...golden, ok: true, pct: 100, unmetRows: [], notLoadBearing: [] }));
  writeFileSync(join(dir, "check-merged.json"), JSON.stringify(stampedCheck(d)));
  writeFileSync(join(dir, "extract.json"), `${JSON.stringify(LIST_EX, null, 2)}\n`);
  const ok = run();
  assertEqual("clean → 0", ok.status, 0);
  assertTrue("list shown", readFileSync(join(dir, "review.md"), "utf-8").includes("from list L1 — 14 courses"), ok.stdout + ok.stderr);
  writeFileSync(join(dir, "extract.json"), JSON.stringify({ ...LIST_EX, lists: [{ ...LIST_EX.lists[0], courseIds: LIST_IDS.slice(1) }] }));
  const stale = run();
  assertEqual("hand-edited → 1", stale.status, 1);
  assertTrue("says stale", readFileSync(join(dir, "review.md"), "utf-8").includes("does not match page.html"), stale.stdout + stale.stderr);
  writeFileSync(join(dir, "extract.json"), "{ broken");
  const broken = run();
  assertEqual("broken → 1 (not 2)", broken.status, 1);
  assertTrue("says unusable", readFileSync(join(dir, "review.md"), "utf-8").includes("extract.json cannot be used"), broken.stdout + broken.stderr);
});

// ── Stale verifier / check files (review fix 1) ──────────────────────────────
check("verify.json and check-merged.json must carry the hash of this exact layer: missing and wrong both flag", () => {
  const base = cleanFor(merged);
  assertEqual("stamped inputs: clean", buildReview(base).summary.flags, 0);
  const unstamped = (o: object) => {
    const { layerSha256: _h, ...rest } = o as { layerSha256?: string };
    void _h;
    return rest;
  };
  const noV = buildReview({ ...base, verify: unstamped(base.verify!) as Verification });
  assertTrue("verify without a hash", noV.summary.flags === 1 && noV.markdown.includes("⚠ verify.json carries no layer hash"), noV.markdown);
  const noC = buildReview({ ...base, checkMerged: unstamped(base.checkMerged!) as CheckReport });
  assertTrue("check-merged without a hash", noC.summary.flags === 1 && noC.markdown.includes("⚠ check-merged.json carries no layer hash"), noC.markdown);
  const wrongV = buildReview({ ...base, verify: { ...base.verify!, layerSha256: "0".repeat(64) } as Verification });
  assertTrue("verify with another layer's hash", wrongV.summary.flags === 1 && wrongV.markdown.includes("⚠ verify.json was made on a different version of this layer"), wrongV.markdown);
  const wrongC = buildReview({ ...base, checkMerged: { ...base.checkMerged!, layerSha256: "0".repeat(64) } as CheckReport });
  assertTrue("check-merged with another layer's hash", wrongC.summary.flags === 1 && wrongC.markdown.includes("⚠ check-merged.json was made on a different version of this layer"), wrongC.markdown);
  // The layer edited after the files were stamped: both go stale at once.
  const edited = parseDraft({ ...merged, layer: { ...merged.layer, name: "Demo Economics (BA), edited" } });
  assertEqual("an edited layer flags both stale files", buildReview({ ...base, merged: edited }).summary.flags, 2);
});

// ── College reconcile (review fix 5) ─────────────────────────────────────────
const RENAMES = [
  { from: "core-micro", to: "micro-core" },
  { from: "capstone/project", to: "capstone/proj-courses" },
];
const renamedMerged: Draft = parseDraft({
  ...merged,
  layer: {
    ...merged.layer,
    rows: merged.layer.rows.map((r) =>
      r.id === "core-micro"
        ? { ...r, id: "micro-core" }
        : r.kind === "anyOf"
          ? { ...r, rows: r.rows.map((c) => (c.id === "project" ? { ...c, id: "proj-courses" } : c)) }
          : r,
    ),
  },
  quotes: {
    "micro-core": merged.quotes["core-micro"],
    upper: merged.quotes.upper,
    capstone: merged.quotes.capstone,
    "capstone/proj-courses": merged.quotes["capstone/project"],
    grades: merged.quotes.grades,
  },
});
const reconcileClean = { decisions: [{ ref: "micro-core", chosen: "phase2" as const, explanation: "the hand-built version names the same course", needsMichael: false }], renamed: RENAMES };

check("phase2-reconcile: renamed rows are looked up by their old ids (no 'row id not found'); decisions are shown", () => {
  const noFile = buildReviewSheet({ ...full, merged: renamedMerged });
  assertTrue("without the reconcile file the rename is flagged", block(noFile, "micro-core").includes("⚠ row id not found in the diff"), block(noFile, "micro-core"));
  const md = buildReviewSheet({ ...full, merged: renamedMerged, reconcile: reconcileClean });
  const micro = block(md, "micro-core");
  assertTrue("origin found through the old id", !micro.includes("not found in the diff") && micro.includes("both authors agreed"), micro);
  assertTrue("rename stated", micro.includes("Renamed by the Phase 2 reconcile from `core-micro`"), micro);
  assertTrue("decision shown on its row", micro.includes("Phase 2 reconcile — kept phase2: the hand-built version names the same course"), micro);
  const proj = block(md, "capstone/proj-courses");
  assertTrue("renamed option still gets its resolver decision", proj.includes("Resolved — chose b (`pair capstone~cap rows[project~proj].requiredCourses`)"), proj);
  assertTrue("option rename stated", proj.includes("from `capstone/project`"), proj);
  assertTrue("status line", md.includes("- Phase 2 reconcile: 1 decision(s), 2 row(s) renamed to the Phase 2 ids"), md);
  assertTrue("decision list", md.includes("## Phase 2 reconcile decisions") && md.includes("1. `micro-core` — kept **phase2**"), md);
});

check("phase2-reconcile: needsMichael decisions are open questions (counted, listed, row flagged)", () => {
  const ask = { decisions: [{ ref: "upper", chosen: "neither" as const, explanation: "the two versions disagree on the credit total", needsMichael: true }], renamed: RENAMES };
  const { markdown: md, summary } = buildReview({ ...full, merged: renamedMerged, reconcile: ask });
  assertTrue("two open (one resolver, one reconcile)", md.includes("- Questions for Michael: ⚠ 2 open"), md);
  const q = md.slice(md.indexOf("## ⚠ Questions for Michael"), md.indexOf("## Rows"));
  assertTrue("listed after the resolver's", q.includes("2. **Phase 2 reconcile: upper** (kept: neither) — the two versions disagree on the credit total"), q);
  assertTrue("row flagged and marked", block(md, "upper").startsWith("⚠") && block(md, "upper").includes("⚠ **open question** — Phase 2 reconcile"), block(md, "upper"));
  // On an otherwise clean sheet it is the only flag source.
  const d = renamedMerged;
  const clean = buildReview({ ...cleanFor(d), reconcile: { decisions: ask.decisions.map((x) => ({ ...x, ref: "micro-core" })), renamed: [{ from: "core-micro", to: "micro-core" }] } });
  assertEqual("exactly the open question (+ its row)", clean.summary.flags, 2);
  assertTrue("positive: a clean reconcile adds no flag", buildReview({ ...cleanFor(d), reconcile: { decisions: [], renamed: [{ from: "core-micro", to: "micro-core" }] } }).summary.flags === 0, "flagged");
  void summary;
});

check("phase2-reconcile: a rename to a row the layer lacks is flagged", () => {
  const r = buildReview({ ...cleanFor(merged), reconcile: { decisions: [], renamed: [{ from: "x", to: "nowhere" }] } });
  assertTrue("flagged", r.summary.flags === 1 && r.markdown.includes("⚠ renamed to rows the layer does not have: x → nowhere"), r.markdown);
});

check("phase2-reconcile: a malformed file is a flag, not a crash (loader and sheet)", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-sheet-reconcile-"));
  writeFileSync(join(dir, "merged.json"), JSON.stringify(merged));
  const load = () => loadReviewInputs(dir);
  writeFileSync(join(dir, "phase2-reconcile.json"), "{ broken");
  const bad = load();
  assertTrue("bad JSON → reconcileError, no reconcile", bad.reconcile === undefined && !!bad.reconcileError, JSON.stringify(bad.reconcileError));
  writeFileSync(join(dir, "phase2-reconcile.json"), JSON.stringify({ decisions: [{ ref: "x", chosen: "a", explanation: "e", needsMichael: false }], renamed: [] }));
  const shape = load();
  assertTrue("wrong shape (chosen) → reconcileError", shape.reconcile === undefined && !!shape.reconcileError?.includes("wrong shape"), JSON.stringify(shape.reconcileError));
  writeFileSync(join(dir, "phase2-reconcile.json"), JSON.stringify({ decisions: [] }));
  assertTrue("missing renamed → reconcileError", !!load().reconcileError, "accepted");
  const r = buildReview({ ...cleanFor(merged), reconcileError: shape.reconcileError });
  assertTrue("sheet flags it", r.summary.flags === 1 && r.markdown.includes("⚠ Phase 2 reconcile: phase2-reconcile.json cannot be used: wrong shape"), r.markdown);
  writeFileSync(join(dir, "phase2-reconcile.json"), JSON.stringify(reconcileClean));
  const good = load();
  assertTrue("valid file loads", good.reconcile?.renamed.length === 2 && good.reconcileError === undefined, JSON.stringify(good.reconcileError));
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── review-sheet corpus — ${checks.length} case(s) ──`);
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
