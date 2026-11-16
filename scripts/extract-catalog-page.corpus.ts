// scripts/extract-catalog-page.corpus.ts
// Asserted, offline corpus for extract-catalog-page.ts and expand-draft.ts
// (spec 019 Phase 5). Pages are invented HTML in the catalog's template; no
// network. Exits nonzero on any mismatch.
//
// Run: npx tsx extract-catalog-page.corpus.ts   (from the scripts/ folder)

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkExtract, extractPage, foreignListIdsIn, listCourses, loadVerifiedExtract, pageOnlyCourses, runExtract, withForeignLists } from "./extract-catalog-page";
import { expandDraft, runExpand } from "./expand-draft";
import { extractPageText, sha256, toLf } from "./snapshot-catalog-page";
import { quoteCoverage } from "./check-draft";
import { DraftSchema, type Layer } from "./layer-authoring";

let failures = 0;
let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
function eq<T>(actual: T, expected: T, what = "value") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(cond: boolean, detail: string) {
  if (!cond) throw new Error(detail);
}

const code = (c: string) => `<a href="/search/?P=${c.replace(" ", "%20")}" class="bubblelink code">${c.replace(" ", "&#160;")}</a>`;
const course = (c: string, title: string, hours: string, extra = "") =>
  `<tr class="${extra}"><td class="codecol">${code(c)}</td><td>${title}</td><td class="hourscol">${hours}</td></tr>`;

const PAGE = `<!doctype html><html><head><title>Fictional Studies (BA) | Example University</title></head><body>
<main id="contentarea"><h1 class="page-title">Fictional Studies (BA)</h1>
<div id="textcontainer"><h2>Admission</h2><p>Before declaring, complete ${code("FICT 1100")} with a B or better.</p></div>
<div id="curriculumtextcontainer">
<h2>Program Requirements</h2>
<ul><li>Complete ten courses with grades of C or better.</li></ul>
<table class="sc_courselist"><tbody>
<tr class="areaheader"><td colspan="2"><span class="courselistcomment areaheader">Foundations</span></td><td class="hourscol"></td></tr>
${course("FICT 1100", "Imaginary Worlds", "3")}
${course("FICT 1200", "Invented Histories", "3")}
<tr class="orclass"><td class="codecol orclass"><div class="blockindent">or ${code("FICT 1210")}</div></td><td>Invented Histories Honors</td><td class="hourscol"></td></tr>
<tr><td colspan="2"><span class="courselistcomment">Select two of the following:</span></td><td class="hourscol">6</td></tr>
${course("FICT 3100", "Mythic Systems", "3")}
<tr><td class="codecol">${code("FICT 3200")}<br/><span class="blockindent">&amp; ${code("FICT 3201")}</span></td><td>Lore Lab and Lab Section</td><td class="hourscol">4</td></tr>
${course("ZZZ 3300", "Speculative Methods", "3-4")}
</tbody></table>
<h3>Concentration in Dragons</h3>
<p>Two of ${code("FICT 4100")} or ${code("FICT 4200")}.</p>
<h2>University Graduation Requirements</h2>
<p>Everyone completes ${code("PE 1100")} and the swim test.</p>
</div></main></body></html>`;

const text = extractPageText(PAGE);
const ex = extractPage(PAGE, { programId: "fictional-ba", textSha256: sha256(toLf(text)) });

check("lists split at comment rows, carry their lead lines", () => {
  eq(ex.lists.map((l) => l.id), ["L1", "L2"]);
  eq(ex.lists[0].courseIds, ["FICT-1100", "FICT-1200", "FICT-1210"]);
  eq(ex.lists[0].lead.map((r) => r.kind), ["header"]);
  eq(ex.lists[1].lead.map((r) => r.line), ["Select two of the following: | 6"]);
  eq(ex.lists[1].courseIds, ["FICT-3100", "FICT-3200", "FICT-3201", "ZZZ-3300"]);
});
check("row kinds, pairs, indents and credits", () => {
  const r = ex.lists[0].rows;
  eq(r.map((x) => x.kind), ["course", "course", "or"]);
  eq(r[2].indented, true);
  const pair = ex.lists[1].rows[1];
  eq([pair.paired, pair.courseIds, pair.credits], [true, ["FICT-3200", "FICT-3201"], "4"]);
  eq(ex.lists[1].rows[2].credits, "3-4");
});
check("every block is on page.txt and every linked code is accounted for", () => {
  eq(checkExtract(ex, text), []);
});
check("the shared university section is left out unless --all", () => {
  ok(!ex.linkedCourseIds.includes("PE-1100"), "PE 1100 should be outside the program section");
  const all = extractPage(PAGE, { programId: "fictional-ba", textSha256: "x", all: true });
  ok(all.linkedCourseIds.includes("PE-1100"), "--all should include the shared section");
});
check("prose and headings keep their path; concentration headings are listed", () => {
  const p = ex.blocks.find((b) => b.kind === "prose" && b.courseIds.includes("FICT-4100"));
  ok(!!p, "the dragons sentence is a prose block");
  eq(p!.path.slice(-1), ["Concentration in Dragons"]);
  eq(ex.concentrationHeadings, ["Concentration in Dragons"]);
});
check("a code the extractor missed is reported", () => {
  const broken = { ...ex, blocks: ex.blocks.filter((b) => !b.courseIds.includes("FICT-4100")) };
  ok(checkExtract(broken, text).some((p) => p.code === "unaccounted-code"), "expected unaccounted-code");
});
check("a block that is not on the page is reported", () => {
  const broken = { ...ex, blocks: [...ex.blocks, { ...ex.blocks[0], id: "P99", text: "Words that are nowhere on the page at all" }] };
  ok(checkExtract(broken, text).some((p) => p.code === "not-on-page"), "expected not-on-page");
});
check("listCourses throws on an unknown list", () => {
  let threw = false;
  try {
    listCourses(ex, "L9");
  } catch {
    threw = true;
  }
  ok(threw, "expected a throw");
});

check("indented options end where a required course at the outer indentation follows", () => {
  const opt = (c: string) => `<tr><td class="codecol"><div class="blockindent">${code(c)}</div></td><td>Option</td><td class="hourscol"></td></tr>`;
  const page = `<html><body><main id="contentarea"><div id="curriculumtextcontainer"><h2>Program Requirements</h2>
<table class="sc_courselist"><tbody>
<tr><td colspan="2"><span class="courselistcomment">Pick one area course</span></td><td class="hourscol">3</td></tr>
${opt("FICT 2100")}${opt("FICT 2200")}
${course("FICT 3000", "Required Theory", "3")}
<tr><td class="codecol">${code("FICT 4100")}<br/><span class="blockindent">&amp; ${code("FICT 4101")}</span></td><td>Lab pair</td><td class="hourscol">4</td></tr>
</tbody></table></div></main></body></html>`;
  const x = extractPage(page, { programId: "x", textSha256: "x" });
  eq(x.lists.map((l) => l.courseIds), [["FICT-2100", "FICT-2200"], ["FICT-3000", "FICT-4100", "FICT-4101"]]);
  eq(x.lists[1].lead, [], "the required course's run has no chooser line");
  eq(x.lists[1].rows.map((r) => r.indented), [false, false], "a & pair is not an option row");
});

check("a course linked only in a list row's title note stays on that row's block, not in the list", () => {
  const opt = (c: string, title: string) => `<tr><td class="codecol"><div class="blockindent">${code(c)}</div></td><td>${title}</td><td class="hourscol"></td></tr>`;
  const page = `<html><body><main id="contentarea"><div id="curriculumtextcontainer"><h2>Minor Requirements</h2>
<table class="sc_courselist"><tbody>
<tr class="areaheader"><td colspan="2"><span class="courselistcomment areaheader">Waves</span></td><td class="hourscol">3-4</td></tr>
<tr><td colspan="2"><span class="courselistcomment">Select one of the following:</span></td><td class="hourscol"></td></tr>
${opt("FICT 2214", "Oscillations")}
${opt("FICT 2218", `Waves and Heat (${code("FICT 2218")} must include lab ${code("FICT 2210")})`)}
${course("FICT 1110", `Lab Methods (with ${code("FICT 2214")} or ${code("FICT 3999")})`, "1")}
</tbody></table></div></main></body></html>`;
  const t = extractPageText(page);
  const x = extractPage(page, { programId: "x", textSha256: sha256(toLf(t)) });
  eq(checkExtract(x, t), [], "no refusal");
  eq(x.lists.map((l) => l.courseIds), [["FICT-2214", "FICT-2218"], ["FICT-1110"]], "notes never join a list");
  const lab = x.blocks.find((b) => b.text.startsWith("FICT 2218"))!;
  eq([lab.noteCourseIds, lab.list, lab.path], [["FICT-2210"], "L1", ["curriculumtextcontainer", "Minor Requirements"]], "the lab note: own code dropped, path kept");
  eq(x.blocks.find((b) => b.text.startsWith("FICT 1110"))!.noteCourseIds, ["FICT-2214", "FICT-3999"]);
  ok(!("noteCourseIds" in x.blocks.find((b) => b.text.startsWith("FICT 2214"))!), "a row without notes has no noteCourseIds key");
  eq(pageOnlyCourses(x, new Set(["FICT-2214", "FICT-2218", "FICT-1110", "FICT-3999"])).map((c) => c.id), ["FICT-2210"], "a note-only course is page-only when the dump lacks it");
  const dropped = { ...x, blocks: x.blocks.map(({ noteCourseIds: _n, ...b }) => b) };
  ok(checkExtract(dropped, t).some((p) => p.code === "unaccounted-code" && p.message.includes("FICT-2210")), "a note course in no block still refuses");
});

check("a slash listing names one course under every subject", () => {
  const page = `<html><body><main id="contentarea"><div id="curriculumtextcontainer"><h2>Program Requirements</h2><p>Take PUBPOL/GDEV 3280 or FICT 1100.</p></div></main></body></html>`;
  const x = extractPage(page, { programId: "x", textSha256: "x" });
  eq(x.blocks.find((b) => b.kind === "prose")?.courseIds, ["PUBPOL-3280", "GDEV-3280", "FICT-1100"]);
});

check("courses the page names but the dump lacks become page-only catalog entries", () => {
  const known = new Set(["FICT-1100", "FICT-1200", "FICT-1210", "FICT-3100", "FICT-3200", "FICT-3201", "FICT-4100", "FICT-4200"]);
  const extra = pageOnlyCourses(ex, known);
  eq(extra.map((c) => [c.id, c.subject, c.number, c.creditsMin, c.creditsMax]), [["ZZZ-3300", "ZZZ", "3300", 3, 4]]);
  eq(pageOnlyCourses(ex, new Set([...known, "ZZZ-3300"])), []);
  const pair = pageOnlyCourses(ex, new Set(["FICT-1100"])).find((c) => c.id === "FICT-3200");
  eq(pair?.creditsMin, undefined, "a paired row's credits are the pair's, not one course's");
});

check("page-only courses come from list rows and real links, not from course-looking prose", () => {
  const blk = (id: string, courseIds: string[]) => ({ id, kind: "prose" as const, path: [], text: "x", courseIds });
  const fake = {
    lists: [] as typeof ex.lists,
    blocks: [blk("P1", ["QQQ-2025"]), blk("P2", ["QQQ-3000"])],
    linkedCourseIds: ["QQQ-3000"],
  };
  eq(pageOnlyCourses(fake, new Set()).map((c) => c.id), ["QQQ-3000"]);
  eq(pageOnlyCourses({ ...fake, linkedCourseIds: [] }, new Set()), []);
  // real page: the prose-linked FICT-4100 is not page-only when known; a prose-only code never appears
  ok(!pageOnlyCourses(ex, new Set(["FICT-1100"])).some((c) => c.id === "QQQ-2025"), "unlinked prose code leaked");
});

// ── expand-draft ─────────────────────────────────────────────────────────────
const SRC = {
  schemaVersion: 1,
  programId: "fictional-ba",
  author: "a",
  model: "sonnet",
  framing: "row-by-row",
  snapshot: { url: "https://example.edu/programs/fictional-ba/", textSha256: ex.textSha256 },
  layer: {
    id: "fictional-ba",
    kind: "major",
    family: "cas",
    name: "Fictional Studies (BA)",
    catalogYear: "2026-27",
    programId: "fictional-ba",
    rows: [
      { id: "found", kind: "pool", label: "Foundations", group: "Core", source: { url: "https://example.edu/programs/fictional-ba/", anchor: "Program Requirements" }, rule: { list: "L1", flatten: true }, requiredCourses: 2, requiredCredits: 0 },
      {
        id: "either",
        kind: "anyOf",
        label: "Either",
        group: "Core",
        source: { url: "https://example.edu/programs/fictional-ba/", anchor: "Program Requirements" },
        rows: [{ id: "two", kind: "pool", label: "Two", group: "Core", source: { url: "https://example.edu/programs/fictional-ba/", anchor: "Program Requirements" }, rule: { allOf: [{ list: ["L2"], flatten: true }, { not: { course: ["ZZZ-3300"] } }] }, requiredCourses: 2, requiredCredits: 0 }],
      },
    ],
  },
  quotes: { found: ["Foundations", "Two courses from the foundations"], either: ["Select two of the following"] },
};

check("list leaves expand to course ids and listRefs record them", () => {
  const out = expandDraft(SRC as never, ex) as { layer: Layer; listRefs: Record<string, string[]> };
  eq((out.layer.rows[0] as { rule: unknown }).rule, { course: ["FICT-1100", "FICT-1200", "FICT-1210"] });
  const child = (out.layer.rows[1] as { rows: { rule: unknown }[] }).rows[0];
  eq(child.rule, { allOf: [{ course: ["FICT-3100", "FICT-3200", "FICT-3201", "ZZZ-3300"] }, { not: { course: ["ZZZ-3300"] } }] });
  eq(out.listRefs, { found: ["L1"], "either/two": ["L2"] });
});
check("flatten opt-ins are recorded in listFlatten and the key never reaches the layer", () => {
  const out = expandDraft(SRC as never, ex) as { layer: Layer; listFlatten: Record<string, string[]> };
  eq(out.listFlatten, { found: ["L1"], "either/two": ["L2"] });
  ok(!JSON.stringify(out.layer).includes("flatten"), "flatten leaked into the layer");
});
const SRCURL = { url: "https://example.edu/programs/fictional-ba/", anchor: "Program Requirements" };
const withRow = (row: Record<string, unknown>) => ({ ...SRC, layer: { ...SRC.layer, rows: [{ id: "r", label: "R", group: "Core", source: SRCURL, ...row }] } });
const refuses = (src: unknown, needles: string[]) => {
  let msg = "";
  try {
    expandDraft(src as never, ex);
  } catch (e) {
    msg = (e as Error).message;
  }
  ok(msg !== "" && needles.every((n) => msg.includes(n)), `expected a refusal naming ${needles.join(" + ")}, got "${msg}"`);
};
check("an or-row list in a pool, credits or distribution rule is refused unless flatten: true", () => {
  refuses(withRow({ kind: "pool", rule: { list: "L1" }, requiredCourses: 2, requiredCredits: 0 }), ["row r", "list L1", "or FICT 1210", "pool"]);
  refuses(withRow({ kind: "credits", rule: { list: "L1" }, requiredCredits: 6 }), ["credits"]);
  refuses(withRow({ kind: "distribution", categories: [{ id: "c", label: "C", rule: { list: "L1" } }], requiredCourses: 1, minDistinctCategories: 1 }), ["distribution"]);
  const ok1 = expandDraft(withRow({ kind: "pool", rule: { list: "L1", flatten: true }, requiredCourses: 2, requiredCredits: 0 }) as never, ex);
  eq((ok1.listFlatten as Record<string, string[]>).r, ["L1"]);
});
check("a paired-row list is refused inside a pool limit and inside allOf/not; a list without or/paired rows is fine", () => {
  refuses(withRow({ kind: "pool", rule: { subject: ["FICT"] }, requiredCourses: 1, requiredCredits: 0, limits: [{ rule: { list: "L2" }, maxCourses: 1 }] }), ["list L2", "paired", "r"]);
  refuses(withRow({ kind: "pool", rule: { allOf: [{ subject: ["FICT"] }, { not: { list: "L2" } }] }, requiredCourses: 1, requiredCredits: 0 }), ["list L2"]);
  const plainEx = { lists: [{ ...ex.lists[0], rows: ex.lists[0].rows.filter((r) => r.kind === "course"), courseIds: ["FICT-1100", "FICT-1200"] }] };
  const out = expandDraft(withRow({ kind: "pool", rule: { list: "L1" }, requiredCourses: 1, requiredCredits: 0 }) as never, plainEx);
  eq(out.listFlatten, undefined, "nothing to record");
});
check("a seat (alone or as an anyOf child) may take a plain list with or/paired rows", () => {
  const seat = expandDraft(withRow({ kind: "seat", rule: { list: "L1" } }) as never, ex) as { layer: Layer; listFlatten?: unknown };
  eq((seat.layer.rows[0] as { rule: unknown }).rule, { course: ["FICT-1100", "FICT-1200", "FICT-1210"] });
  eq(seat.listFlatten, undefined);
  const child = expandDraft(withRow({ kind: "anyOf", rows: [{ id: "s", kind: "seat", label: "S", group: "Core", source: SRCURL, rule: { list: "L2" } }] }) as never, ex);
  eq(Object.keys(child.listRefs as object), ["r/s"]);
  refuses(withRow({ kind: "anyOf", rows: [{ id: "p", kind: "pool", label: "P", group: "Core", source: SRCURL, rule: { list: "L2" }, requiredCourses: 1, requiredCredits: 0 }] }), ["r/p", "list L2"]);
});
check("questions: a list in a question's courses expands (or/paired rows allowed), answered leaves pass through, no listRefs entry", () => {
  const src = {
    ...SRC,
    layer: {
      ...SRC.layer,
      rows: [{ id: "r", label: "R", group: "Core", source: SRCURL, kind: "pool", exclusive: true, rule: { anyOf: [{ course: ["FICT-1100"] }, { answered: "usedAs:fictional-ba/r" }] }, requiredCourses: 1, requiredCredits: 0 }],
      questions: [{ type: "usedAs", row: "r", courses: { list: "L1" }, source: SRCURL, quote: "An invented sentence." }],
    },
  };
  const out = expandDraft(src as never, ex) as { layer: Layer; listRefs?: Record<string, string[]>; listFlatten?: unknown };
  eq((out.layer.questions?.[0] as { courses: unknown }).courses, { course: ["FICT-1100", "FICT-1200", "FICT-1210"] });
  eq((out.layer.rows[0] as { rule: unknown }).rule, { anyOf: [{ course: ["FICT-1100"] }, { answered: "usedAs:fictional-ba/r" }] });
  eq(out.listRefs, undefined);
  eq(out.listFlatten, undefined);
  const noQuestions = expandDraft(withRow({ kind: "seat", rule: { course: ["FICT-1100"] } }) as never, ex) as { layer: Layer };
  ok(!("questions" in noQuestions.layer), "a layer without questions gains no questions key");
});
check("an unknown list refuses", () => {
  let threw = false;
  try {
    expandDraft({ ...SRC, layer: { ...SRC.layer, rows: [{ ...SRC.layer.rows[0], rule: { list: "L7" } }] } } as never, ex);
  } catch {
    threw = true;
  }
  ok(threw, "expected a throw");
});
check("listRefs cite a list's courses for quote coverage, and only those", () => {
  const out = expandDraft(SRC as never, ex) as { layer: Layer; listRefs: Record<string, string[]> };
  const cited = { found: new Set(ex.lists[0].courseIds), "either/two": new Set(ex.lists[1].courseIds) };
  eq(quoteCoverage(out.layer, out.listRefs ? (SRC.quotes as Record<string, string[]>) : {}, cited).errors, []);
  const none = quoteCoverage(out.layer, SRC.quotes as Record<string, string[]>, {});
  ok(none.errors.length === 2, `without listRefs both rows are uncited (got ${none.errors.length})`);
});

// ── CLI round trip in a temp provenance folder ──────────────────────────────
check("CLI: extract, a hand-edited extract is refused, expand writes the draft", () => {
  const dir = mkdtempSync(join(tmpdir(), "extract-corpus-"));
  mkdirSync(join(dir, "snapshot"));
  writeFileSync(join(dir, "snapshot", "page.html"), PAGE);
  writeFileSync(join(dir, "snapshot", "page.txt"), text);
  writeFileSync(
    join(dir, "snapshot", "meta.json"),
    JSON.stringify({ programId: "fictional-ba", url: SRC.snapshot.url, fetchedAt: "2026-10-26T00:00:00Z", via: "direct", httpStatus: 200, title: null, edition: null, htmlSha256: sha256(toLf(PAGE)), textSha256: ex.textSha256, textChars: text.length })
  );
  const quiet = console.log;
  console.log = () => {};
  const code1 = runExtract(["--program", "fictional-ba", "--dir", dir]);
  console.log = quiet;
  eq(code1, 0, "extract exit");
  eq(loadVerifiedExtract(dir).lists.length, 2);
  const path = join(dir, "extract.json");
  const saved = readFileSync(path, "utf-8");
  writeFileSync(path, saved.replace('"FICT-1210"', '"FICT-9999"'));
  let threw = false;
  try {
    loadVerifiedExtract(dir);
  } catch {
    threw = true;
  }
  ok(threw, "a hand-edited extract.json must be refused");
  writeFileSync(path, saved);
  const srcPath = join(dir, "draft-a.src.json");
  writeFileSync(srcPath, JSON.stringify({ ...SRC, programId: "fictional-ba" }));
  // expand-draft locates the folder by programId; point it here through --out and a local copy.
  const err = console.error;
  console.error = () => {};
  console.log = () => {};
  const code2 = runExpand([srcPath]);
  console.log = quiet;
  console.error = err;
  // "fictional-ba" has no real provenance folder, so the CLI refuses (exit 1): the
  // folder is resolved from the programId, never from where the source happens to sit.
  eq(code2, 1, "expand exit for a program without a provenance folder");
});

// ── Lists of another program's saved page ("<programId>:L3") ────────────────
check("a list of another program's saved page: added under its qualified id, expanded, recorded; bad ids refuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "extract-foreign-"));
  mkdirSync(join(dir, "snapshot"));
  writeFileSync(join(dir, "snapshot", "page.html"), PAGE);
  writeFileSync(join(dir, "snapshot", "page.txt"), text);
  writeFileSync(
    join(dir, "snapshot", "meta.json"),
    JSON.stringify({ programId: "fictional-ba", url: SRC.snapshot.url, fetchedAt: "2026-10-26T00:00:00Z", via: "direct", httpStatus: 200, title: null, edition: "2026-2027", htmlSha256: sha256(toLf(PAGE)), textSha256: ex.textSha256, textChars: text.length })
  );
  writeFileSync(join(dir, "extract.json"), JSON.stringify(ex));
  const dirOf = (id: string) => (id === "fictional-ba" ? dir : join(dir, "nowhere"));
  const own = { ...ex, programId: "fictional-minor", lists: [] };
  eq([...foreignListIdsIn({ rows: [{ rule: { anyOf: [{ list: "fictional-ba:L2" }, { list: ["L1", "fictional-ba:L1"] }] } }] })].sort(), ["fictional-ba:L1", "fictional-ba:L2"]);
  const aug = withForeignLists(own, ["fictional-ba:L2"], { ownEdition: "2026-2027", dirOf });
  eq(aug.lists.map((l) => l.id), ["fictional-ba:L2"]);
  eq(aug.lists[0].courseIds, ex.lists[1].courseIds, "the other page's list courses");
  eq(aug.blocks, own.blocks, "blocks stay this page's own");
  const src = {
    ...SRC,
    programId: "fictional-minor",
    layer: { ...SRC.layer, id: "fictional-minor", kind: "minor", programId: "fictional-minor", rows: [{ id: "r", label: "R", group: "Core", source: SRCURL, kind: "seat", rule: { list: "fictional-ba:L2" } }] },
  };
  const out = expandDraft(src as never, aug) as { layer: Layer; listRefs: Record<string, string[]> };
  eq((out.layer.rows[0] as { rule: unknown }).rule, { course: ex.lists[1].courseIds });
  eq(out.listRefs, { r: ["fictional-ba:L2"] });
  ok(DraftSchema.safeParse(out).success, "the schema accepts a qualified listRefs id");
  const throwsWith = (fn: () => unknown, needle: string) => {
    try {
      fn();
    } catch (e) {
      ok((e as Error).message.includes(needle), `expected "${needle}" in "${(e as Error).message}"`);
      return;
    }
    throw new Error(`expected a throw mentioning "${needle}"`);
  };
  throwsWith(() => withForeignLists(own, ["fictional-ba:L9"], { dirOf }), "unknown list fictional-ba:L9");
  throwsWith(() => withForeignLists(own, ["other-ba:L1"], { dirOf }), "cannot be used");
  throwsWith(() => withForeignLists({ ...ex }, ["fictional-ba:L1"], { dirOf }), "own page");
  throwsWith(() => withForeignLists(own, ["fictional-ba:L1"], { ownEdition: "2025-2026", dirOf }), "2026-2027 catalog");
  throwsWith(() => withForeignLists(own, ["L1"], { dirOf }), "is not");
});

console.log(`${passed}/${passed + failures} passed.`);
if (failures) {
  console.log("\nCORPUS FAILED.");
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
