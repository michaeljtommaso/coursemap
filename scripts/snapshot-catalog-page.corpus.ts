// scripts/snapshot-catalog-page.corpus.ts
// Asserted, offline corpus for snapshot-catalog-page.ts (spec 019 Phase 4). NO
// network: pages are invented HTML below and the CLI runs against a fake
// fetcher writing into a temp dir. Exits nonzero on any mismatch.
//
// Run: npx tsx snapshot-catalog-page.corpus.ts   (from the scripts/ folder)

import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSnapshot,
  decodeEntities,
  extractPageText,
  isChallengeResponse,
  jinaUrl,
  parseEdition,
  parseHtml,
  parseTitle,
  runSnapshot,
  sha256,
  type Fetcher,
} from "./snapshot-catalog-page";

type Check = { name: string; fn: () => void | Promise<void> };
const checks: Check[] = [];
let failures = 0;

function check(name: string, fn: () => void | Promise<void>) {
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
function lines(text: string): string[] {
  return text.split("\n");
}

// ── Fixture pages (invented) ────────────────────────────────────────────────
const CHROME_TOP = `
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>Fictional Studies (BA) &amp; More | Example University</title>
<style>.tab_content { display: none; } body { color: red; }</style>
<script>var x = "<div>not content</div>"; if (a < b) { y(); }</script>
</head><body>
<header id="header"><a href="/">Example University Catalog</a></header>
<button><span>2031&#8211;2032 Edition</span></button>
<aside id="sidebar"><nav id="cl-menu"><ul><li><a href="/a/">Sidebar Program Alpha</a></li><li><a href="/b/">Sidebar Program Beta</a></li></ul></nav></aside>
<nav id="breadcrumb" aria-label="Breadcrumb"><ul><li><a href="/">Home</a></li><li>Crumb Trail Text</li></ul></nav>
<!-- a comment with <p>markup</p> that is not content -->
`;
const CHROME_BOTTOM = `
<footer id="footer"><p>Footer contact text</p></footer>
<script>window.track && track("page");</script>
</body></html>
`;
/** Padding chrome so the page clears the challenge size floor. */
const PADDING = `<script>/* ${"x".repeat(2500)} */</script>`;

const CONTAINER_MAIN = `
<main id="contentarea">
  <h2 class="page-title">Fictional Studies (BA)</h2>
  <p class="college-text">Outside the tab panels</p>
  <aside class="taxbox"><h2 class="sr-only">Codes</h2><p>CODE: 00.0000</p></aside>
  <script>var defshow = "text";</script>
  <nav id="tabs"><ul><li><a href="#textcontainer">Overview</a></li><li><a href="#curriculumtextcontainer">Curriculum</a></li></ul></nav>
  <div id="textcontainer" class="page_content tab_content">
    <h2>Program Description</h2> <p>The imaginary major studies   invented things
    across two   lines.</p><p>Second paragraph with &ldquo;curly&rdquo; quotes, a caf&eacute;, and A&nbsp;&amp;&nbsp;B.</p>
    <h3>Admission</h3><p>Students must pass FAKE&#160;1010 with a B&#8211; or better.
  </div>
  <div id="curriculumtextcontainer" class="page_content tab_content" aria-hidden="true">
    <h2>Program Requirements</h2>
    <ul> <li>Complete 10 courses, all with grades of C&ndash; or better.</li> </ul>
    <table class="sc_courselist">
      <caption class="hidden noscript">Course List</caption>
      <thead><tr class="hidden noscript"><th>Code</th><th>Title</th><th>Hours</th></tr></thead>
      <tbody>
      <tr class="areaheader"><td colspan="2"><span class="courselistcomment areaheader">Core Courses</span> <sup>1</sup></td><td class="hourscol"></td></tr>
      <tr><td class="codecol"><a href="/search/?P=FAKE%201010">FAKE&#160;1010</a></td><td>Invented Foundations</td><td class="hourscol">3</td>
      <tr class="orclass"><td class="codecol orclass">or&#160;<a href="/search/?P=FAKE%201020">FAKE&#160;1020</a></td><td colspan="2"> Invented Alternatives</td></tr>
      <tr><td colspan="2"><span class="courselistcomment">At least 2 FAKE courses at the 4000-level</span></td><td class="hourscol">6-8</td></tr>
      </tbody>
    </table>
    <dl class="sc_footnotes"><dt> <sup> 1 </sup> </dt><dd><p class="noindent">Note: Core courses are made up for this test.</p></dd></dl>
    <h3>In addition:</h3>
    <ol>
      <li>first numbered item,
      <li>second item with a nested list:
        <ul><li>nested one</li><li>nested <strong>two</strong></li></ul>
      </li>
    </ol>
    <p>Line one<br>line two</p>
    <h4>Fourth level</h4><h5>Fifth level</h5>
  </div>
</main>
`;
const CONTAINER_PAGE = CHROME_TOP + PADDING + CONTAINER_MAIN + CHROME_BOTTOM;

const MAIN_ONLY_PAGE = `${CHROME_TOP}<main><h1>Plain Main Page</h1><p>Only main content here.</p><nav><p>Main nav text</p></nav></main>${CHROME_BOTTOM}`;
const BODY_ONLY_PAGE = `<html><head><title>Body Page</title></head><body><header>Top banner</header><h1>Body Heading</h1><p>Body paragraph.</p><footer>Bottom banner</footer></body></html>`;

const EXPECTED_CONTAINER_TEXT = [
  "# Fictional Studies (BA)",
  "",
  "## Program Description",
  "",
  "The imaginary major studies invented things across two lines.",
  "",
  "Second paragraph with “curly” quotes, a café, and A & B.",
  "",
  "### Admission",
  "",
  "Students must pass FAKE 1010 with a B– or better.",
  "",
  "## Program Requirements",
  "",
  "- Complete 10 courses, all with grades of C– or better.",
  "",
  "Core Courses 1",
  "FAKE 1010 | Invented Foundations | 3",
  "or FAKE 1020 | Invented Alternatives",
  "At least 2 FAKE courses at the 4000-level | 6-8",
  "",
  "1 Note: Core courses are made up for this test.",
  "",
  "### In addition:",
  "",
  "- first numbered item,",
  "- second item with a nested list:",
  "  - nested one",
  "  - nested two",
  "",
  "Line one",
  "line two",
  "",
  "#### Fourth level",
  "",
  "##### Fifth level",
  "",
].join("\n");

// ── Challenge detection ─────────────────────────────────────────────────────
check("challenge: 202 with an empty body is a challenge", () => {
  assertEqual("202 empty", isChallengeResponse(202, ""), true);
  assertEqual("202 even with a full body", isChallengeResponse(202, CONTAINER_PAGE), true);
});
check("challenge: a short 200 body is a challenge", () => {
  assertEqual("short", isChallengeResponse(200, "<html><body>wait</body></html>"), true);
  assertEqual("whitespace only", isChallengeResponse(200, " ".repeat(5000)), true);
});
check("challenge: a normal 200 page is not", () => {
  assertEqual("normal", isChallengeResponse(200, CONTAINER_PAGE), false);
});
check("challenge: firewall / captcha markers and block statuses are", () => {
  assertEqual("waf script", isChallengeResponse(200, `${PADDING}<script src="https://x.awswaf.com/challenge.js"></script>`), true);
  assertEqual("captcha", isChallengeResponse(200, `${PADDING}<div class="captcha"></div>`), true);
  assertEqual("403", isChallengeResponse(403, CONTAINER_PAGE), true);
  assertEqual("429", isChallengeResponse(429, CONTAINER_PAGE), true);
});

// ── Entities ────────────────────────────────────────────────────────────────
check("entities: named, decimal, hex; unknown names kept", () => {
  assertEqual("named", decodeEntities("A &amp; B &lt;x&gt; &quot;q&quot; &rsquo;s"), "A & B <x> \"q\" ’s");
  assertEqual("decimal nbsp", decodeEntities("ECON&#160;1"), "ECON 1");
  assertEqual("hex dash", decodeEntities("2031&#x2013;32"), "2031–32");
  assertEqual("unknown kept", decodeEntities("&notanentity; & alone"), "&notanentity; & alone");
  assertEqual("accented", decodeEntities("caf&eacute;"), "café");
});

// ── Parser robustness ───────────────────────────────────────────────────────
check("parser: script bodies, comments, unquoted attributes and implied end tags", () => {
  const doc = parseHtml(`<div id=a class=b><p>one<p>two<ul><li>x<li>y</ul><table><tr><td>c1<td>c2<tr><td>c3</table></div><script>"</div>"</script><!-- <p>no</p> -->`);
  const div = doc.children[0];
  assertTrue("div parsed", typeof div !== "string" && div.tag === "div" && div.attrs.id === "a" && div.attrs.class === "b", JSON.stringify(div));
  if (typeof div === "string") return;
  assertEqual("children of div", div.children.map((c) => (typeof c === "string" ? "#text" : c.tag)), ["p", "p", "ul", "table"]);
  const text = extractPageText(`<body><div id=a>${"<p>one<p>two<ul><li>x<li>y</ul><table><tr><td>c1<td>c2<tr><td>c3</table>"}</div><script>"</div>"</script></body>`);
  assertEqual("rendered", lines(text), ["one", "", "two", "", "- x", "- y", "", "c1 | c2", "c3", ""]);
});

// ── Content selection ───────────────────────────────────────────────────────
check("extract: tab panels + page title only; chrome, nav, script, hidden and sidebar dropped", () => {
  const text = extractPageText(CONTAINER_PAGE);
  for (const junk of ["not content", "Sidebar Program", "Crumb Trail", "Footer contact", "Outside the tab panels", "CODE: 00", "Overview", "Course List", "Code | Title", "defshow", "markup", "Example University Catalog"]) {
    assertTrue(`no "${junk}"`, !text.includes(junk), `page.txt contains "${junk}"`);
  }
});
check("extract: headings, paragraphs, lists, tables, footnotes, br — exact page.txt", () => {
  const text = extractPageText(CONTAINER_PAGE);
  if (text !== EXPECTED_CONTAINER_TEXT) {
    const got = lines(text);
    const want = lines(EXPECTED_CONTAINER_TEXT);
    const i = got.findIndex((l, k) => l !== want[k]);
    fail("exact text", `first difference at line ${i + 1}: expected ${JSON.stringify(want[i])}, got ${JSON.stringify(got[i])}`);
  }
});
check("extract: no runs of blank lines, LF only, one trailing newline", () => {
  const text = extractPageText(CONTAINER_PAGE);
  assertTrue("no double blank", !text.includes("\n\n\n"), "found a run of blank lines");
  assertTrue("no CR", !text.includes("\r"), "found a CR");
  assertTrue("ends with one newline", text.endsWith("\n") && !text.endsWith("\n\n"), JSON.stringify(text.slice(-5)));
  assertTrue("no leading blank", !text.startsWith("\n"), "starts with a blank line");
});
check("extract: falls back to <main>, then <body>", () => {
  assertEqual("main", lines(extractPageText(MAIN_ONLY_PAGE)), ["# Plain Main Page", "", "Only main content here.", ""]);
  assertEqual("body", lines(extractPageText(BODY_ONLY_PAGE)), ["# Body Heading", "", "Body paragraph.", ""]);
});

// ── Meta ────────────────────────────────────────────────────────────────────
check("meta: title and edition parsing", () => {
  assertEqual("title decoded", parseTitle(CONTAINER_PAGE), "Fictional Studies (BA) & More | Example University");
  assertEqual("edition with an en dash entity", parseEdition(CONTAINER_PAGE), "2031-2032");
  assertEqual("edition plain", parseEdition("<span>2040-2041 Edition</span>"), "2040-2041");
  assertEqual("no edition", parseEdition(BODY_ONLY_PAGE), null);
  assertEqual("no title", parseTitle("<html><body>x</body></html>"), null);
});
check("hash: stable across runs and line endings; text hash covers page.txt", () => {
  const at = new Date("2031-01-02T03:04:05.000Z");
  const a = buildSnapshot({ programId: "fictional-ba", url: "https://catalog.example.edu/p/", via: "direct", httpStatus: 200, html: CONTAINER_PAGE, fetchedAt: at });
  const b = buildSnapshot({ programId: "fictional-ba", url: "https://catalog.example.edu/p/", via: "direct", httpStatus: 200, html: CONTAINER_PAGE, fetchedAt: at });
  const crlf = buildSnapshot({ programId: "fictional-ba", url: "https://catalog.example.edu/p/", via: "direct", httpStatus: 200, html: CONTAINER_PAGE.replace(/\n/g, "\r\n"), fetchedAt: at });
  assertEqual("same meta twice", a.meta, b.meta);
  assertEqual("text hash = sha256(page.txt)", a.meta.textSha256, sha256(a.text));
  assertEqual("html hash = sha256(page.html)", a.meta.htmlSha256, sha256(a.html));
  assertEqual("CRLF html: same text hash", crlf.meta.textSha256, a.meta.textSha256);
  assertEqual("CRLF html: same html hash", crlf.meta.htmlSha256, a.meta.htmlSha256);
  assertEqual("textChars", a.meta.textChars, a.text.length);
  assertEqual("fetchedAt", a.meta.fetchedAt, "2031-01-02T03:04:05.000Z");
  assertTrue("hex", /^[0-9a-f]{64}$/.test(a.meta.textSha256), a.meta.textSha256);
  const changed = buildSnapshot({ programId: "fictional-ba", url: "https://catalog.example.edu/p/", via: "direct", httpStatus: 200, html: CONTAINER_PAGE.replace("10 courses", "11 courses"), fetchedAt: at });
  assertTrue("a word change changes the text hash", changed.meta.textSha256 !== a.meta.textSha256, "hash did not change");
});

// ── CLI with a fake fetcher ─────────────────────────────────────────────────
type Call = { url: string; headers: Record<string, string>; timeoutMs: number };
function fakeFetcher(direct: { status: number; body: string } | Error, jina: { status: number; body: string }): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers, timeoutMs: init.timeoutMs });
    if (url.startsWith("https://r.jina.ai/")) return jina;
    if (direct instanceof Error) throw direct;
    return direct;
  };
  return { fetcher, calls };
}
const PAGE_URL = "https://catalog.example.edu/programs/fictional-ba/";
const quiet = { log: () => {}, err: () => {} };

check("cli: auto falls back to jina on a 202 empty body and writes LF files", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const { fetcher, calls } = fakeFetcher({ status: 202, body: "" }, { status: 200, body: CONTAINER_PAGE.replace(/\n/g, "\r\n") });
  const code = await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out], { fetcher, ...quiet, now: () => new Date("2031-05-06T00:00:00Z") });
  assertEqual("exit", code, 0);
  assertEqual("two calls", calls.map((c) => c.url), [PAGE_URL, jinaUrl(PAGE_URL)]);
  assertEqual("jina header", calls[1]?.headers["X-Return-Format"], "html");
  assertEqual("timeouts", calls.map((c) => c.timeoutMs), [30_000, 60_000]);
  assertTrue("browser UA", /Mozilla\/5\.0/.test(calls[0]?.headers["User-Agent"] ?? ""), JSON.stringify(calls[0]?.headers));
  const meta = JSON.parse(readFileSync(join(out, "snapshot", "meta.json"), "utf-8"));
  const html = readFileSync(join(out, "snapshot", "page.html"), "utf-8");
  const text = readFileSync(join(out, "snapshot", "page.txt"), "utf-8");
  assertEqual("via", meta.via, "jina");
  assertEqual("status", meta.httpStatus, 200);
  assertEqual("program", meta.programId, "fictional-ba");
  assertEqual("url", meta.url, PAGE_URL);
  assertEqual("edition", meta.edition, "2031-2032");
  assertEqual("page.txt", text, EXPECTED_CONTAINER_TEXT);
  assertTrue("LF html", !html.includes("\r"), "page.html has CR");
  assertEqual("text hash on disk", meta.textSha256, sha256(text));
  assertEqual("html hash on disk", meta.htmlSha256, sha256(html));
});

check("cli: auto uses the direct page when it is not a challenge", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const { fetcher, calls } = fakeFetcher({ status: 200, body: CONTAINER_PAGE }, { status: 500, body: "" });
  const code = await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out], { fetcher, ...quiet });
  assertEqual("exit", code, 0);
  assertEqual("one call", calls.length, 1);
  assertEqual("via", JSON.parse(readFileSync(join(out, "snapshot", "meta.json"), "utf-8")).via, "direct");
});

check("cli: auto falls back when the direct request throws", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const { fetcher } = fakeFetcher(new Error("connect timeout"), { status: 200, body: CONTAINER_PAGE });
  assertEqual("exit", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out], { fetcher, ...quiet }), 0);
  assertEqual("via", JSON.parse(readFileSync(join(out, "snapshot", "meta.json"), "utf-8")).via, "jina");
});

check("cli: --via direct on a challenge fails and writes nothing", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const { fetcher, calls } = fakeFetcher({ status: 202, body: "" }, { status: 200, body: CONTAINER_PAGE });
  assertEqual("exit", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out, "--via", "direct"], { fetcher, ...quiet }), 1);
  assertEqual("no jina call", calls.length, 1);
  assertEqual("nothing written", existsSync(join(out, "snapshot")), false);
});

check("cli: a jina challenge or empty page fails; a near-empty page is refused", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const bad = fakeFetcher({ status: 202, body: "" }, { status: 200, body: "<html>tiny</html>" });
  assertEqual("jina stub", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out], { fetcher: bad.fetcher, ...quiet }), 1);
  const empty = fakeFetcher({ status: 200, body: `<html><body>${PADDING}<main><p>tiny</p></main></body></html>` }, { status: 500, body: "" });
  assertEqual("too little text", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out], { fetcher: empty.fetcher, ...quiet }), 1);
  assertEqual("nothing written", existsSync(join(out, "snapshot")), false);
});

check("cli: a re-snapshot reports unchanged / CHANGED text", async () => {
  const out = mkdtempSync(join(tmpdir(), "snapshot-corpus-"));
  const logs: string[] = [];
  const io = { log: (s: string) => logs.push(s), err: (s: string) => logs.push(s) };
  const run = (html: string) => runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--out", out, "--via", "direct"], { fetcher: fakeFetcher({ status: 200, body: html }, { status: 500, body: "" }).fetcher, ...io });
  await run(CONTAINER_PAGE);
  assertTrue("first run: no comparison", !logs.some((l) => /existing snapshot/.test(l)), logs.join("\n"));
  logs.length = 0;
  await run(CONTAINER_PAGE.replace("<p class=\"college-text\">", "<p class=\"college-text\">ignored "));
  assertTrue("unchanged", logs.some((l) => /text unchanged/.test(l)), logs.join("\n"));
  logs.length = 0;
  await run(CONTAINER_PAGE.replace("10 courses", "11 courses"));
  assertTrue("CHANGED", logs.some((l) => /text CHANGED \([0-9a-f]{12} → [0-9a-f]{12}\)/.test(l)), logs.join("\n"));
  assertTrue("overwritten", readFileSync(join(out, "snapshot", "page.txt"), "utf-8").includes("11 courses"), "page.txt not overwritten");
});

check("cli: bad usage exits 2", async () => {
  const { fetcher, calls } = fakeFetcher({ status: 200, body: CONTAINER_PAGE }, { status: 200, body: CONTAINER_PAGE });
  assertEqual("no url", await runSnapshot(["--program", "fictional-ba"], { fetcher, ...quiet }), 2);
  assertEqual("http url", await runSnapshot(["--program", "fictional-ba", "--url", "http://catalog.example.edu/"], { fetcher, ...quiet }), 2);
  assertEqual("bad program id", await runSnapshot(["--program", "../escape", "--url", PAGE_URL], { fetcher, ...quiet }), 2);
  assertEqual("bad via", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--via", "paid"], { fetcher, ...quiet }), 2);
  assertEqual("unknown flag", await runSnapshot(["--program", "fictional-ba", "--url", PAGE_URL, "--crawl"], { fetcher, ...quiet }), 2);
  assertEqual("never fetched", calls.length, 0);
});

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n── snapshot-catalog-page corpus — ${checks.length} case(s) ──`);
  let failedCases = 0;
  for (const c of checks) {
    const before = failures;
    try {
      await c.fn();
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
}
main();
