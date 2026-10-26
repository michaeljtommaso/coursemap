// scripts/check-draft.corpus.ts
// Asserted, offline corpus for check-draft.ts (spec 019 Phase 4). NO network:
// the page text, the catalog and the drafts are invented below; the CLI runs
// against temp files. Exits nonzero on any mismatch.
//
// Run: npx tsx check-draft.corpus.ts   (from the scripts/ folder)

import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkDraft, closestLine, fragmentNamesCourse, fragmentsStateNumber, indexPage, keyOf, runCheck, samePage, type CheckInput } from "./check-draft";
import { QUOTE_MIN_CHARS, type CheckReport, type SnapshotMeta } from "./layer-authoring";
import { extractPageText, sha256 } from "./snapshot-catalog-page";
import { buildCatalog, type CatalogCourse } from "./validate-layers";

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
const PAGE_URL = "https://catalog.cornell.edu/programs/test-ba/";
const PAGE_HTML = [
  "<!doctype html><html><head><title>Test Studies (BA)</title></head><body>",
  "<header>Site banner</header>",
  "<main>",
  "<h1>Test Studies (BA)</h1>",
  "<h2>Program Requirements</h2>",
  "<ul><li>Complete the introductory course TEST&#160;1010 with a grade of C or better.</li></ul>",
  "<table><tbody>",
  '<tr><td colspan="3">Statistics</td></tr>',
  "<tr><td>TEST&#160;2010</td><td>Invented Statistics</td><td>4</td></tr>",
  '<tr><td>or TEST&#160;2020</td><td colspan="2">Invented Probability</td></tr>',
  '<tr><td colspan="3">Electives</td></tr>',
  '<tr><td colspan="2">At least 3 TEST courses at the 3000-level or above</td><td>9</td></tr>',
  "</tbody></table>",
  "<p>The department calls this the &ldquo;upper-level&rdquo; requirement &ndash; plan early.</p>",
  "<p>Students take two seminars from TEST 4010 or 4020, with no more than one per term.</p>",
  "</main><footer>Site footer</footer></body></html>",
  "",
].join("\n");
/** page.txt is what the snapshotter extracts from page.html, exactly. */
const PAGE_TEXT = extractPageText(PAGE_HTML);

const META: SnapshotMeta = {
  programId: "test-ba",
  url: PAGE_URL,
  fetchedAt: "2031-01-01T00:00:00.000Z",
  via: "jina",
  httpStatus: 200,
  title: "Test Studies (BA)",
  edition: "2031-2032",
  htmlSha256: sha256(PAGE_HTML),
  textSha256: sha256(PAGE_TEXT),
  textChars: PAGE_TEXT.length,
};

const course = (id: string, credits = 3): CatalogCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, creditsMin: credits, creditsMax: credits, attrs: [] };
};
const CATALOG_COURSES = ["TEST-1010", "TEST-2010", "TEST-2020", "TEST-3010", "TEST-3020", "TEST-4010", "TEST-4020"].map((id) => course(id));
const CATALOG = buildCatalog(CATALOG_COURSES);

const SRC = { url: PAGE_URL, anchor: "Program Requirements" };

function cleanDraft() {
  return {
    schemaVersion: 1,
    programId: "test-ba",
    author: "a",
    model: "test-model",
    framing: "row-by-row",
    snapshot: { url: PAGE_URL, textSha256: META.textSha256 },
    layer: {
      id: "test-ba",
      kind: "major",
      family: "cas",
      name: "Test Studies (BA)",
      catalogYear: "2031-32",
      programId: "test-ba",
      rows: [
        { id: "intro", kind: "seat", label: "Introductory course", group: "Core", source: SRC, rule: { course: ["TEST-1010"] } },
        {
          id: "stats",
          kind: "anyOf",
          label: "Statistics",
          group: "Core",
          source: SRC,
          rows: [
            { id: "stats-a", kind: "seat", label: "TEST 2010", group: "Core", source: SRC, rule: { course: ["TEST-2010"] } },
            { id: "stats-b", kind: "seat", label: "TEST 2020", group: "Core", source: SRC, rule: { course: ["TEST-2020"] } },
          ],
        },
        {
          id: "electives",
          kind: "pool",
          label: "Three upper-level courses",
          group: "Electives",
          source: { url: `${PAGE_URL}#electives`, anchor: "Electives" },
          rule: { allOf: [{ subject: ["TEST"] }, { number: { min: 3000 } }] },
          requiredCourses: 3,
          requiredCredits: 9,
        },
      ],
    },
    quotes: {
      intro: ["Complete the introductory course TEST 1010"],
      stats: ["TEST 2010 | Invented Statistics", "or TEST 2020 | Invented Probability"],
      electives: ["At least 3 TEST courses at the 3000-level or above | 9"],
    } as Record<string, string[]>,
  };
}
type DraftFixture = ReturnType<typeof cleanDraft>;
type AnyRow = Record<string, unknown> & { id: string };

function variant(edit: (d: DraftFixture) => void): DraftFixture {
  const d = JSON.parse(JSON.stringify(cleanDraft())) as DraftFixture;
  edit(d);
  return d;
}
function rowOf(d: DraftFixture, id: string): AnyRow {
  return (d.layer.rows as AnyRow[]).find((r) => r.id === id) as AnyRow;
}
function run(draftRaw: unknown, over: Partial<CheckInput> = {}): CheckReport {
  return checkDraft({ draftRaw, draftPath: "draft-a.json", pageText: PAGE_TEXT, pageHtml: PAGE_HTML, meta: META, catalog: CATALOG, ...over });
}
const codes = (fs: { code: string }[]) => [...new Set(fs.map((f) => f.code))].sort();

// ── Clean ───────────────────────────────────────────────────────────────────
check("clean draft passes (no errors; only low-coverage catalog warnings)", () => {
  const r = run(cleanDraft());
  assertEqual("ok", r.ok, true);
  assertEqual("no errors", r.errors, []);
  assertEqual("warning codes", codes(r.warnings), ["catalog"]);
  assertEqual("draft path recorded", r.draft, "draft-a.json");
});

// ── Each error code ─────────────────────────────────────────────────────────
check("schema: a missing field fails and stops further checks", () => {
  const r = run(variant((d) => delete (d as Partial<DraftFixture>).model));
  assertEqual("ok", r.ok, false);
  assertEqual("codes", codes(r.errors), ["schema"]);
  assertTrue("names the field", r.errors.some((e) => e.key === "model"), JSON.stringify(r.errors));
  assertEqual("no warnings after a schema stop", r.warnings, []);
});
check("schema: a malformed sha and an unknown key fail", () => {
  const r = run(variant((d) => ((d.snapshot.textSha256 = "abc"), ((d as Record<string, unknown>).extra = 1))));
  assertEqual("codes", codes(r.errors), ["schema"]);
  assertTrue("sha path", r.errors.some((e) => e.key === "snapshot.textSha256"), JSON.stringify(r.errors));
});
check("lint: a pool that requires nothing", () => {
  const r = run(variant((d) => Object.assign(rowOf(d, "electives"), { requiredCourses: 0, requiredCredits: 0 })));
  assertEqual("codes", codes(r.errors), ["lint"]);
  assertEqual("key", r.errors[0]?.key, "electives");
});
check("lint: a duplicate anyOf child id is keyed to the child", () => {
  const r = run(variant((d) => (((rowOf(d, "stats").rows as AnyRow[])[1].id = "stats-a"))));
  assertTrue("lint error", r.errors.some((e) => e.code === "lint" && e.key === "stats/stats-a"), JSON.stringify(r.errors));
});
check("id: programId differs from layer.id", () => {
  const r = run(variant((d) => (d.programId = "other-ba")));
  assertEqual("codes", codes(r.errors), ["id"]);
});
check("snapshot: draft names another snapshot text", () => {
  const r = run(variant((d) => (d.snapshot.textSha256 = "0".repeat(64))));
  assertEqual("codes", codes(r.errors), ["snapshot"]);
  assertEqual("one error", r.errors.length, 1);
});
check("snapshot: draft names another url", () => {
  const r = run(variant((d) => (d.snapshot.url = "https://catalog.cornell.edu/programs/elsewhere/")));
  assertEqual("codes", codes(r.errors), ["snapshot"]);
});
check("snapshot: page.txt edited after meta.json was written", () => {
  const r = run(cleanDraft(), { pageText: `${PAGE_TEXT}An extra line.\n` });
  assertEqual("codes", codes(r.errors), ["snapshot"]);
  assertTrue("says page.txt", /page\.txt/.test(r.errors[0]?.message ?? ""), JSON.stringify(r.errors));
});
check("snapshot: CRLF page.txt still matches its LF hash", () => {
  assertEqual("no errors", run(cleanDraft(), { pageText: PAGE_TEXT.replace(/\n/g, "\r\n") }).errors, []);
});
check("quote-missing: a top-level row without fragments", () => {
  const r = run(variant((d) => delete d.quotes.intro));
  assertEqual("codes", codes(r.errors), ["quote-missing"]);
  assertEqual("key", r.errors[0]?.key, "intro");
});
check("quote-key: keys that are not row units", () => {
  const r = run(variant((d) => ((d.quotes.nope = ["Complete the introductory course"]), (d.quotes["stats/ghost"] = ["TEST 2010 | Invented Statistics"]))));
  assertEqual("codes", codes(r.errors), ["quote-key"]);
  assertEqual("keys", r.errors.map((e) => e.key).sort(), ["nope", "stats/ghost"]);
});
check("quote-not-found: names the fragment and the closest page line", () => {
  const r = run(variant((d) => (d.quotes.intro = ["Complete the introductory course TEST 1011 with a grade"])));
  // The invented fragment also no longer cites TEST 1010 (quote-coverage).
  assertEqual("codes", codes(r.errors), ["quote-coverage", "quote-not-found"]);
  const m = r.errors[0]?.message ?? "";
  assertTrue("fragment shown", m.includes("TEST 1011"), m);
  assertTrue("hint line", m.includes("closest page line") && m.includes("TEST 1010 with a grade of C or better"), m);
});
check("quote-not-found: a reworded fragment with no long overlap gets no hint", () => {
  const r = run(variant((d) => (d.quotes.intro = ["entirely unrelated wording here"])));
  assertEqual("codes", codes(r.errors), ["quote-coverage", "quote-not-found"]);
  assertTrue("no hint", !(r.errors[0]?.message ?? "").includes("closest page line"), r.errors[0]?.message ?? "");
});
check(`quote-too-short: a fragment under ${QUOTE_MIN_CHARS} characters`, () => {
  const r = run(variant((d) => (d.quotes.intro = ["TEST 1010"])));
  assertEqual("codes", codes(r.errors), ["quote-too-short"]);
});
check("catalog: a rule no catalog course satisfies", () => {
  const r = run(variant((d) => (rowOf(d, "intro").rule = { course: ["TEST-9999"] })));
  // No quote cites TEST 9999 either.
  assertEqual("codes", codes(r.errors), ["catalog", "quote-coverage"]);
  assertTrue("keyed to the row", r.errors.every((e) => e.key === "intro"), JSON.stringify(r.errors));
});
check("catalog: an unreachable credit total", () => {
  const r = run(variant((d) => Object.assign(rowOf(d, "electives"), { requiredCourses: 5, requiredCredits: 15 })));
  assertEqual("codes", codes(r.errors), ["catalog"]);
});

// ── Quote semantics ─────────────────────────────────────────────────────────
check("anyOf children inherit the parent's quotes; a child may add its own", () => {
  const own = run(variant((d) => (d.quotes["stats/stats-b"] = ["or TEST 2020 | Invented Probability"])));
  assertEqual("own child quote ok", own.errors, []);
  const childOnly = run(variant((d) => ((d.quotes["stats/stats-a"] = d.quotes.stats), delete d.quotes.stats)));
  assertEqual("parent still needs its own", childOnly.errors.map((e) => `${e.code}:${e.key}`), ["quote-missing:stats"]);
});
check("normalization: curly quotes, nbsp, em dash and spacing still match", () => {
  const r = run(variant((d) => d.quotes.electives.push("the “upper-level” requirement —   plan\n early")));
  assertEqual("no errors", r.errors, []);
});
check("normalization: case is not folded", () => {
  const r = run(variant((d) => (d.quotes.intro = ["complete the introductory course test 1010"])));
  assertEqual("codes", codes(r.errors), ["quote-not-found"]);
});

// ── Quote coverage ──────────────────────────────────────────────────────────
const SEMINAR_QUOTE = "Students take two seminars from TEST 4010 or 4020";
const coverage = (r: CheckReport) => [...r.errors, ...r.warnings].filter((f) => f.code === "quote-coverage");

check("quote-coverage: the clean draft cites every course and number it encodes", () => {
  assertEqual("none", coverage(run(cleanDraft())), []);
});
check("quote-coverage: a course the rule names (kept or excluded) that no quote cites is an error", () => {
  const extra = run(variant((d) => (rowOf(d, "intro").rule = { course: ["TEST-1010", "TEST-3010"] })));
  assertEqual("codes", codes(extra.errors), ["quote-coverage"]);
  assertTrue("names the course and the row", extra.errors[0]?.key === "intro" && (extra.errors[0]?.message ?? "").includes("TEST 3010"), JSON.stringify(extra.errors));
  const excluded = variant((d) => (rowOf(d, "electives").rule = { allOf: [{ subject: ["TEST"] }, { number: { min: 3000 } }, { not: { course: ["TEST-4010"] } }] }));
  const r = run(excluded);
  assertEqual("excluded course", r.errors.map((e) => `${e.code}:${e.key}`), ["quote-coverage:electives"]);
  excluded.quotes.electives.push(SEMINAR_QUOTE);
  assertEqual("cited once quoted", run(excluded).errors, []);
});
check("quote-coverage: a bare number counts when the fragment names the subject; anyOf children use own + parent quotes", () => {
  assertEqual("SUBJ NNNN", fragmentNamesCourse("Complete TEST 1010 first", "TEST-1010"), true);
  assertEqual("SUBJ-NNNN", fragmentNamesCourse("Complete TEST-1010 first", "TEST-1010"), true);
  assertEqual("bare number after the subject", fragmentNamesCourse(SEMINAR_QUOTE, "TEST-4020"), true);
  assertEqual("bare number, no subject", fragmentNamesCourse("seminars numbered 4010 or 4020", "TEST-4020"), false);
  assertEqual("longer number", fragmentNamesCourse("TEST 40201 only", "TEST-4020"), false);
  assertEqual("other subject", fragmentNamesCourse("XTEST 4020 only", "TEST-4020"), false);
  const childRule = (d: DraftFixture) => ((rowOf(d, "stats").rows as AnyRow[])[1].rule = { course: ["TEST-2020", "TEST-4020"] });
  const missing = run(variant(childRule));
  assertEqual("child course uncited", missing.errors.map((e) => `${e.code}:${e.key}`), ["quote-coverage:stats/stats-b"]);
  const own = run(variant((d) => (childRule(d), (d.quotes["stats/stats-b"] = [SEMINAR_QUOTE]))));
  assertEqual("own quote + parent quote cover the child", own.errors, []);
});
check("quote-coverage: a number no quote states is a warning; digits, number words and course levels count", () => {
  const r = run(variant((d) => (rowOf(d, "electives").requiredCourses = 4)));
  assertEqual("still ok", r.ok, true);
  assertEqual("warning", coverage(r).map((f) => [f.key, f.message.includes("requiredCourses is 4")]), [["electives", true]]);
  const words = run(
    variant((d) => {
      Object.assign(rowOf(d, "electives"), { requiredCourses: 2, requiredCredits: 0 });
      d.quotes.electives = ["at the 3000-level or above", SEMINAR_QUOTE];
    }),
  );
  assertEqual("'two' covers 2, '3000-level' covers min 3000", coverage(words), []);
  assertEqual("digits in a range", fragmentsStateNumber(["Hours | 9-12"], 12), true);
  assertEqual("digits inside a course number do not count", fragmentsStateNumber(["TEST 1010 only"], 10), false);
  assertEqual("a level is not its first digit", fragmentsStateNumber(["the 3000-level or above"], 3), false);
  assertEqual("level for a 999 bound", fragmentsStateNumber(["at the 4000-level"], 4999), true);
  assertEqual("xxx form", fragmentsStateNumber(["any TEST 3xxx course"], 3000), true);
  assertEqual("number word", fragmentsStateNumber(["Twelve courses in all"], 12), true);
  assertEqual("absent", fragmentsStateNumber(["At least 3 TEST courses"], 5), false);
});

// ── Snapshot integrity ──────────────────────────────────────────────────────
check("snapshot: page.txt + meta.json rewritten together are caught by page.html", () => {
  const forged = PAGE_TEXT.replace("plan early", "plan ahead");
  const meta = { ...META, textSha256: sha256(forged), textChars: forged.length };
  const r = run(variant((d) => (d.snapshot.textSha256 = meta.textSha256)), { pageText: forged, meta });
  assertEqual("one snapshot error", r.errors.map((e) => e.code), ["snapshot"]);
  assertTrue("says re-extraction differs", (r.errors[0]?.message ?? "").includes("extracts from page.html"), JSON.stringify(r.errors));
});
check("snapshot: page.html edited, missing, or CRLF", () => {
  const edited = run(cleanDraft(), { pageHtml: PAGE_HTML.replace("Site footer", "Another footer") });
  assertEqual("edited html: one error", edited.errors.map((e) => e.code), ["snapshot"]);
  assertTrue("names htmlSha256", (edited.errors[0]?.message ?? "").includes("htmlSha256"), JSON.stringify(edited.errors));
  const missing = run(cleanDraft(), { pageHtml: null });
  assertEqual("missing html: one error", missing.errors.map((e) => e.code), ["snapshot"]);
  assertTrue("says missing", (missing.errors[0]?.message ?? "").includes("page.html is missing"), JSON.stringify(missing.errors));
  assertEqual("CRLF html still matches", run(cleanDraft(), { pageHtml: PAGE_HTML.replace(/\n/g, "\r\n") }).errors, []);
});

// ── Public text ─────────────────────────────────────────────────────────────
check("public-text: a label or note sharing an 8-word run with the page is an error; shorter runs pass", () => {
  const r = run(
    variant((d) => {
      rowOf(d, "intro").label = "Complete the introductory course TEST 1010 with a grade";
      rowOf(d, "electives").note = "The department calls this the upper-level requirement - plan early";
      rowOf(d, "electives").group = "The department calls this the upper-level requirement";
    }),
  );
  assertEqual("codes", codes(r.errors), ["public-text"]);
  assertEqual("where", r.errors.map((e) => e.key).sort(), ["electives", "intro"]);
  assertTrue("label and note, not the 7-word group", r.errors.some((e) => e.message.startsWith("intro label")) && r.errors.some((e) => e.message.startsWith("electives note")) && !r.errors.some((e) => e.message.startsWith("electives group")), JSON.stringify(r.errors));
});

// ── Warnings ────────────────────────────────────────────────────────────────
check("warning: a row citing another page; the same page with a #fragment is fine", () => {
  const r = run(variant((d) => (rowOf(d, "intro").source = { url: "https://catalog.cornell.edu/programs/other-ba/", anchor: "X" })));
  assertEqual("still ok", r.ok, true);
  assertEqual("source-url keys", r.warnings.filter((w) => w.code === "source-url").map((w) => w.key), ["intro"]);
  assertEqual("samePage fragment", samePage(`${PAGE_URL}#electives`, PAGE_URL), true);
  assertEqual("samePage slash", samePage("https://a.cornell.edu/x", "https://a.cornell.edu/x/"), true);
  assertEqual("samePage other", samePage("https://a.cornell.edu/x/", "https://a.cornell.edu/y/"), false);
});
check("warning: no catalog given", () => {
  const r = run(cleanDraft(), { catalog: undefined });
  assertEqual("ok", r.ok, true);
  assertEqual("warning codes", codes(r.warnings), ["no-catalog"]);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
check("helpers: keyOf and closestLine", () => {
  assertEqual("row", keyOf("test-ba", "test-ba:electives: pool requires neither"), "electives");
  assertEqual("child", keyOf("test-ba", "test-ba:stats/stats-a: duplicate child row id"), "stats/stats-a");
  assertEqual("category", keyOf("test-ba", "test-ba:dist[alc]: no catalog course matches"), "dist");
  assertEqual("layer-level", keyOf("test-ba", "test-ba: a major layer needs a programId"), undefined);
  assertEqual("other layer", keyOf("test-ba", "zzz:row: msg"), undefined);
  const idx = indexPage(PAGE_TEXT);
  assertEqual("suffix match", closestLine(idx, "Something else entirely: TEST 2010 | Invented Statistics")?.line, "TEST 2010 | Invented Statistics | 4");
  assertEqual("nothing close", closestLine(idx, "zzzz qqqq wwww"), null);
});

// ── CLI ─────────────────────────────────────────────────────────────────────
check("cli: exit codes 0 / 1 / 2 and --json", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-draft-corpus-"));
  const snap = join(dir, "snapshot");
  mkdirSync(snap);
  writeFileSync(join(snap, "page.html"), PAGE_HTML);
  writeFileSync(join(snap, "page.txt"), PAGE_TEXT);
  writeFileSync(join(snap, "meta.json"), JSON.stringify(META));
  const noHtml = join(dir, "snapshot-no-html");
  mkdirSync(noHtml);
  writeFileSync(join(noHtml, "page.txt"), PAGE_TEXT);
  writeFileSync(join(noHtml, "meta.json"), JSON.stringify(META));
  const dump = join(dir, "dump.json");
  writeFileSync(dump, JSON.stringify(CATALOG_COURSES));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify(cleanDraft()));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify(variant((d) => delete d.quotes.intro)));
  const quiet = { log: () => {}, err: () => {} };

  const out = join(dir, "check.json");
  assertEqual("clean → 0", runCheck([good, "--snapshot", snap, "--dump", dump, "--json", out], quiet), 0);
  const report = JSON.parse(readFileSync(out, "utf-8")) as CheckReport;
  assertEqual("json ok", report.ok, true);
  assertEqual("json draft", report.draft, good);

  assertEqual("errors → 1", runCheck([bad, "--snapshot", snap, "--dump", dump], quiet), 1);
  const out3 = join(dir, "check-nohtml.json");
  assertEqual("snapshot without page.html → 1", runCheck([good, "--snapshot", noHtml, "--no-catalog", "--json", out3], quiet), 1);
  assertEqual("snapshot error", codes((JSON.parse(readFileSync(out3, "utf-8")) as CheckReport).errors), ["snapshot"]);
  const out2 = join(dir, "check-nocat.json");
  assertEqual("--no-catalog → 0", runCheck([good, "--snapshot", snap, "--no-catalog", "--json", out2], quiet), 0);
  assertEqual("no-catalog warning", codes((JSON.parse(readFileSync(out2, "utf-8")) as CheckReport).warnings), ["no-catalog"]);

  const notJson = join(dir, "broken.json");
  writeFileSync(notJson, "{ not json");
  assertEqual("no args → 2", runCheck([], quiet), 2);
  assertEqual("missing draft → 2", runCheck([join(dir, "absent.json"), "--snapshot", snap, "--no-catalog"], quiet), 2);
  assertEqual("broken json → 2", runCheck([notJson, "--snapshot", snap, "--no-catalog"], quiet), 2);
  assertEqual("missing snapshot → 2", runCheck([good, "--snapshot", join(dir, "nowhere"), "--no-catalog"], quiet), 2);
  assertEqual("missing dump → 2", runCheck([good, "--snapshot", snap, "--dump", join(dir, "nodump.json")], quiet), 2);
  assertEqual("--dump with --no-catalog → 2", runCheck([good, "--snapshot", snap, "--dump", dump, "--no-catalog"], quiet), 2);
  assertEqual("unknown flag → 2", runCheck([good, "--fix"], quiet), 2);
  assertTrue("no stray json", !existsSync(join(dir, "check-bad.json")), "unexpected file");
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── check-draft corpus — ${checks.length} case(s) ──`);
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
