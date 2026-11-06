// scripts/credit-tables.corpus.ts
// Asserted, offline corpus runner for build-credit-tables.ts: the HTML and value
// parsers, the build's own refusals (unmapped rows, unprinted course ids, missing
// evidence), the shape of the generated tables, the five legacy Engineering ids,
// spot facts read off the saved pages, and that the JSON on disk is current.
// No network. Exits nonzero on any mismatch.
//
// Run: npx tsx credit-tables.corpus.ts   (from the scripts/ folder)

import { readFileSync } from "node:fs";
import {
  EXAMS,
  OUT_FILE,
  ROWS,
  SNAPSHOT_DATE,
  TABLE_YEAR,
  buildTables,
  courseCodes,
  inlineCourseCredits,
  loadSnapshots,
  normalize,
  parseCredits,
  parsePage,
  parseScores,
  raiseTopGrades,
  renderJson,
  type RowSpec,
} from "./build-credit-tables";
import { LEGACY_EXAM_IDS, type CollegeExamTable, type ExamAward, type ExamTables } from "../cornell-degree-planner/src/lib/credit/types";

const checks: { name: string; fn: () => void }[] = [];
let failures = 0;
const check = (name: string, fn: () => void) => checks.push({ name, fn });
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}
function assertTrue(name: string, cond: boolean, message = "expected true") {
  if (!cond) fail(name, message);
}
function assertThrows(name: string, fn: () => unknown, pattern: RegExp) {
  try {
    fn();
    fail(name, `expected a throw matching ${pattern}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!pattern.test(msg)) fail(name, `threw, but not matching ${pattern}: ${msg.slice(0, 300)}`);
  }
}

const AP = ["1", "2", "3", "4", "5"];
const AL = ["E", "D", "C", "B", "A", "A*"];
const PREU = ["P3", "P2", "P1", "M3", "M2", "M1", "D3", "D2", "D1"];
const FB = Array.from({ length: 21 }, (_, i) => String(i));

// ─── Parsers ─────────────────────────────────────────────────────────────────

check("parseScores: printed score cells", () => {
  assertEqual("ap 4,5", parseScores("4,5", AP), ["4", "5"]);
  assertEqual("ap 4 or 5", parseScores("4 or 5", AP), ["4", "5"]);
  assertEqual("ap not accepted", parseScores("Not Accepted", AP), []);
  assertEqual("ap N/A", parseScores("N/A", AP), []);
  assertEqual("alevel A* or A", parseScores("A* or A", AL), ["A", "A*"]);
  assertEqual("alevel A*, A, B, or C", parseScores("A*, A, B, or C", AL), ["C", "B", "A", "A*"]);
  assertEqual("alevel A or B (no A*)", parseScores("A or B", AL), ["B", "A"]);
  assertEqual("alevel with a condition", parseScores("A*, A, or B and AP or Cornell Advanced Standing Exam (CASE) credit for MATH 1910", AL), ["B", "A", "A*"]);
  assertEqual("preu M3 or higher", parseScores("M3 or higher", PREU), ["M3", "M2", "M1", "D3", "D2", "D1"]);
  assertEqual("preu parts A and B", parseScores("D1, D2, D3 (on parts A and B)", PREU), ["D3", "D2", "D1"]);
  assertEqual("fb 16/20 or higher", parseScores("16/20 or higher", FB), ["16", "17", "18", "19", "20"]);
  assertEqual("bullet", parseScores("Physics C - Mechanics: 5 grade will receive credit for PHYS 2207", AP), ["5"]);
});

check("courseCodes / parseCredits / inlineCourseCredits", () => {
  assertEqual("pairs and suffixes", courseCodes("Placement out of CHEM 2070 & CHEM 2071 or BIOG 1101F; CHEM 2070 again"), ["CHEM-2070", "CHEM-2071", "BIOG-1101F"]);
  assertEqual("no ids", courseCodes("Placement out of 4 credits of Introductory Biology Cluster Courses"), []);
  assertEqual("bare number", parseCredits("8"), 8);
  assertEqual("3 or 4 is not a number", parseCredits("3 or 4"), null);
  assertEqual("first N credits", parseCredits("4 credits (PHYS 2207) or 3 credits (PHYS 1112)"), 4);
  assertEqual("N/A", parseCredits("N/A"), null);
  assertEqual("inline per-course", inlineCourseCredits("FREN 2000E (4 credits) and FREN 2000C (3 credits)"), { "FREN-2000E": 4, "FREN-2000C": 3 });
});

check("parsePage: headings, rows, <sup> dropped, bullets, entities", () => {
  const html = `<h2>Overview</h2><h3 class="toggle">University AP Exam Articulations</h3>
    <table><thead><tr><th>Subject</th><th>Score(s)</th><th>Credit</th><th>Course Placement</th></tr></thead>
    <tbody><tr><td>Economics (Micro<sup>1</sup>)</td><td>5</td><td>3</td><td>Placement out of <a>ECON&nbsp;1110</a>.<br/>Next&#8217;s</td></tr></tbody></table>
    <h3>College-specific Information</h3><h4>College of Arts and Sciences</h4><ul><li>Physics C - Mechanics: 5 grade</li></ul>
    <script>var x = "<td>no</td>";</script>`;
  const p = parsePage(html);
  assertEqual("one table", p.tables.length, 1);
  assertEqual("heads", p.tables[0].heads, ["", "Overview", "University AP Exam Articulations"]);
  assertEqual("cells", p.tables[0].rows[1], ["Economics (Micro)", "5", "3", "Placement out of ECON 1110. Next's"]);
  assertEqual("bullet", p.bullets.map((b) => [b.heads[3], b.text]), [["College of Arts and Sciences", "Physics C - Mechanics: 5 grade"]]);
  assertTrue("script dropped", !p.text.includes("var x"), p.text);
  assertEqual("normalize", normalize("A &amp; B​ ’x’"), "A & B 'x'");
});

// ─── The build refuses what it can't trace to the page ───────────────────────

const loaded = loadSnapshots();

check("build: every printed row is mapped, and a missing entry fails", () => {
  const some = Object.keys(ROWS)[0];
  const { [some]: _gone, ...rest } = ROWS;
  assertThrows("missing row", () => buildTables(loaded, rest), /row has no ROWS entry/);
  assertThrows("stale entry", () => buildTables(loaded, { ...ROWS, "ap|Underwater Basketry|5": { noCredit: ["ap-biology"] } }), /matches no row/);
});

check("build: a course id not printed in the row fails", () => {
  const bad: Record<string, RowSpec> = { ...ROWS, "ap|Psychology|4,5": { award: { exams: ["ap-psychology"], courses: ["PSYCH-2000"] } } };
  assertThrows("invented course", () => buildTables(loaded, bad), /PSYCH-2000 is not printed/);
});

check("build: a limit whose evidence isn't on the page fails", () => {
  const bad: Record<string, RowSpec> = {
    ...ROWS,
    "ap|Psychology|4,5": { award: { exams: ["ap-psychology"], limits: [{ text: "Psychology majors only.", from: "for Psychology majors only" }] } },
  };
  assertThrows("invented limit", () => buildTables(loaded, bad), /evidence not on the row/);
});

check("build: two awards for one exam score in one table fail", () => {
  const bad: Record<string, RowSpec> = { ...ROWS, "ap|Psychology|4,5": { award: [{ exams: ["ap-psychology"] }, { exams: ["ap-psychology"], scores: ["5"] }] } };
  assertThrows("overlap", () => buildTables(loaded, bad), /two awards for score 5/);
});

check("build: courseOptions must cover exactly the granted courses", () => {
  const bad: Record<string, RowSpec> = {
    ...ROWS,
    "ap|Chemistry|5": { award: { exams: ["ap-chemistry"], courses: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"], courseOptions: [["CHEM-2070", "CHEM-2071"], ["CHEM-2090"]] } },
  };
  assertThrows("union short", () => buildTables(loaded, bad), /courseOptions union/);
  const empty: Record<string, RowSpec> = {
    ...ROWS,
    "ap|Chemistry|5": { award: { exams: ["ap-chemistry"], courses: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"], courseOptions: [["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"], []] } },
  };
  assertThrows("empty set", () => buildTables(loaded, empty), /non-empty sets/);
});

check("raiseTopGrades: a higher grade with no award joins the top award", () => {
  const scale = ["E", "D", "C", "B", "A", "A*"];
  const byId = new Map([["x", { id: "x", family: "alevel" as const, name: "X", scale }]]);
  const awards = {
    t: [
      { exam: "x", scores: ["B", "A"], courses: ["BIOG-1102F"], credits: 8 },
      { exam: "x", scores: ["C"], courses: [], credits: 4 },
    ],
  };
  const raised = raiseTopGrades(awards, byId);
  assertEqual("scores", awards.t.map((a) => a.scores), [["B", "A", "A*"], ["C"]]);
  assertEqual("reported", raised.length, 1);
  const top = { t: [{ exam: "x", scores: ["A*"], courses: [], credits: 3 }] };
  assertEqual("already at the top", raiseTopGrades(top, byId), []);
});

check("build: an unprinted credit cell needs an explicit number", () => {
  const bad: Record<string, RowSpec> = { ...ROWS, "ap|Physics C-Mechanics|5": { award: { exams: ["ap-physics-c-mechanics"], courses: ["PHYS-2207"] } } };
  assertThrows("3 or 4", () => buildTables(loaded, bad), /credits not printed as a number/);
});

// ─── Shape of the generated tables ───────────────────────────────────────────

const tables: ExamTables = buildTables(loaded);
const all: CollegeExamTable[] = [tables.university, tables.overrides.cas!, tables.overrides.cals!, tables.engineering];
const examIds = new Set(tables.exams.map((e) => e.id));
const COURSE_ID = /^[A-Z]{2,6}-\d{4}[A-Z]?$/;

check("exams: unique ids, family prefix, known scales lowest first", () => {
  assertEqual("unique", examIds.size, tables.exams.length);
  for (const e of tables.exams) {
    const prefix = e.family === "alevel" ? "alevel-" : `${e.family}-`;
    if (!e.id.startsWith(prefix)) fail("prefix", `${e.id} lacks ${prefix}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) fail("kebab", e.id);
    if (e.family === "intl" && !e.group) fail("intl group", e.id);
    const want = e.family === "ap" ? AP : e.family === "ib" ? ["1", "2", "3", "4", "5", "6", "7"] : e.family === "alevel" ? AL : e.group === "Cambridge Pre-U" ? PREU : FB;
    assertEqual(`${e.id} scale`, e.scale, want);
  }
  for (const id of ["ap-calculus-bc", "ap-chemistry", "ap-physics-c-mechanics", "ap-physics-c-electricity-and-magnetism", "ap-computer-science-a"])
    assertTrue(`required AP id ${id}`, examIds.has(id));
  const common = tables.exams.filter((e) => e.common).map((e) => e.id);
  assertTrue("~15 common AP exams", common.length >= 14 && common.length <= 17 && common.every((id) => id.startsWith("ap-")), common.join(", "));
});

check("awards: exam exists, scores on its scale, course ids well formed, credits sane", () => {
  for (const t of all)
    for (const a of t.awards) {
      const where = `${t.college}:${a.exam}@${a.scores.join(",")}`;
      if (!examIds.has(a.exam)) fail("exam exists", where);
      const scale = tables.exams.find((e) => e.id === a.exam)?.scale ?? [];
      if (!a.scores.length) fail("has scores", where);
      for (const s of a.scores) if (!scale.includes(s)) fail("score on scale", `${where}: ${s}`);
      assertEqual(`${where} scores lowest first`, a.scores, scale.filter((s) => a.scores.includes(s)));
      for (const c of a.courses) if (!COURSE_ID.test(c)) fail("course id", `${where}: ${c}`);
      if (!Number.isInteger(a.credits) || a.credits < 0 || a.credits > 12) fail("credits", `${where}: ${a.credits}`);
      if (a.courseCredits) {
        const sum = Object.values(a.courseCredits).reduce((x, y) => x + y, 0);
        assertEqual(`${where} courseCredits sum`, sum, a.credits);
      }
      for (const s of [...(a.limits ?? []), ...(a.note ? [a.note] : [])]) if (!s.trim() || s.length > 260) fail("limit/note length", `${where}: ${s}`);
    }
});

check("tables: one award per exam score, overrides list what they replace, sources stamped", () => {
  for (const t of all) {
    const seen = new Set<string>();
    for (const a of t.awards)
      for (const s of a.scores) {
        const k = `${a.exam}@${s}`;
        if (seen.has(k)) fail("one award per score", `${t.college}: ${k}`);
        seen.add(k);
      }
    assertEqual(`${t.college} year`, t.year, TABLE_YEAR);
    assertEqual(`${t.college} fetched`, t.source.fetched, SNAPSHOT_DATE);
    assertTrue(`${t.college} url`, /^https:\/\/[a-z.]*cornell\.edu\//.test(t.source.url), t.source.url);
  }
  for (const t of [tables.overrides.cas!, tables.overrides.cals!])
    assertEqual(`${t.college} replaces`, t.replaces, [...new Set(t.awards.map((a) => a.exam))].sort());
  assertEqual("university has no replaces", tables.university.replaces, undefined);
  assertEqual("cas has no college limits", tables.overrides.cas!.collegeLimits, undefined);
  assertEqual("cals college limits", tables.overrides.cals!.collegeLimits?.length, 1);
});

check("courseOptions: non-empty sets whose union is the granted courses", () => {
  let n = 0;
  for (const t of all)
    for (const a of t.awards) {
      if (!a.courseOptions) continue;
      n++;
      const where = `${t.college}:${a.exam}@${a.scores.join(",")}`;
      assertTrue(`${where} two or more sets`, a.courseOptions.length >= 2);
      if (a.courseOptions.some((o) => !o.length)) fail("no empty set", where);
      const union = [...new Set(a.courseOptions.flat())].sort();
      assertEqual(`${where} union = courses`, union, [...a.courses].sort());
    }
  assertEqual("awards with courseOptions", n, 9);
  const U = tables.university;
  const opt = (exam: string, score: string) => U.awards.find((a) => a.exam === exam && a.scores.includes(score))?.courseOptions;
  // Catalog: "Placement out of CHEM 2070 & CHEM 2071 or CHEM 2090 & CHEM 2091"
  assertEqual("ap chem options", opt("ap-chemistry", "5"), [["CHEM-2070", "CHEM-2071"], ["CHEM-2090", "CHEM-2091"]]);
  // "Placement out of PHYS 1112 (for 3 credits) or PHYS 2207 (for 4 credits)"
  assertEqual("ap mech options", opt("ap-physics-c-mechanics", "5"), [["PHYS-1112"], ["PHYS-2207"]]);
  assertEqual("ap stats one per course", opt("ap-statistics", "5")?.length, 13);
  // Engineering grants one pair outright: no options there.
  assertEqual("eng chem no options", tables.engineering.awards.find((a) => a.exam === "ap-chemistry")?.courseOptions, undefined);
});

check("no grade gap: from an exam's lowest awarded grade up, every grade has an award in that table", () => {
  for (const t of all) {
    const byExam = new Map<string, Set<string>>();
    for (const a of t.awards) for (const s of a.scores) byExam.set(a.exam, (byExam.get(a.exam) ?? new Set()).add(s));
    for (const [exam, scored] of byExam) {
      const scale = tables.exams.find((e) => e.id === exam)?.scale ?? [];
      const low = Math.min(...[...scored].map((s) => scale.indexOf(s)));
      const gaps = scale.slice(low).filter((s) => !scored.has(s));
      if (gaps.length) fail("grade gap", `${t.college}: ${exam} awards ${[...scored].join(",")} but not ${gaps.join(",")}`);
    }
  }
  const at2 = (t: CollegeExamTable, exam: string, s: string) => t.awards.some((a) => a.exam === exam && a.scores.includes(s));
  assertTrue("univ A-Level Biology A*", at2(tables.university, "alevel-biology", "A*"));
  assertTrue("eng A-Level Biology A*", at2(tables.engineering, "alevel-biology", "A*"));
  assertTrue("eng A-Level English FWS A*", tables.engineering.awards.some((a) => a.exam === "alevel-english-literature" && a.scores.includes("A*") && a.courses.includes("ENGL-1100F")));
  assertTrue("univ Pre-U Chemistry D1", at2(tables.university, "intl-cambridge-pre-u-chemistry", "D1"));
});

check("legacy Engineering ids: each exam at 5 earns credit in Engineering", () => {
  for (const [legacy, { exam, score }] of Object.entries(LEGACY_EXAM_IDS)) {
    assertTrue(`${legacy} exam exists`, examIds.has(exam), exam);
    assertEqual(`${legacy} score`, score, "5");
    const hit = tables.engineering.awards.find((a) => a.exam === exam && a.scores.includes(score));
    assertTrue(`${legacy} earns in Engineering`, !!hit && hit.credits > 0 && hit.courses.length > 0, JSON.stringify(hit));
  }
});

// ─── Spot facts, read off the saved pages ────────────────────────────────────

const at = (t: CollegeExamTable, exam: string, score: string): Pick<ExamAward, "courses" | "credits"> | null => {
  const a = t.awards.find((x) => x.exam === exam && x.scores.includes(score));
  return a ? { courses: a.courses, credits: a.credits } : null;
};
check("spot facts", () => {
  const U = tables.university;
  const E = tables.engineering;
  const CAS = tables.overrides.cas!;
  const CALS = tables.overrides.cals!;
  // Catalog AP table: "Mathematics BC for non-engineering majors | 4,5 | 8 | Placement out of ... (MATH 1110) and ... (MATH 1120)"
  assertEqual("univ BC 5", at(U, "ap-calculus-bc", "5"), { courses: ["MATH-1110", "MATH-1120"], credits: 8 });
  assertEqual("univ BC 4", at(U, "ap-calculus-bc", "4"), { courses: ["MATH-1110", "MATH-1120"], credits: 8 });
  // Engineering: "CEEB AP BC Exam | 5 | MATH 1910 | MATH 1910 | 4"; a 4 earns nothing there.
  assertEqual("eng BC 5", at(E, "ap-calculus-bc", "5"), { courses: ["MATH-1910"], credits: 4 });
  assertEqual("eng BC 4", at(E, "ap-calculus-bc", "4"), null);
  // Neither A&S nor CALS changes Calculus BC: both fall back to the university row.
  assertEqual("cas BC", at(CAS, "ap-calculus-bc", "5"), null);
  assertEqual("cals BC", at(CALS, "ap-calculus-bc", "5"), null);
  assertTrue("cas/cals don't replace BC", !CAS.replaces?.includes("ap-calculus-bc") && !CALS.replaces?.includes("ap-calculus-bc"));
  // AB (non-engineering): "4,5 | 4 | Placement out of Calculus I (MATH 1110)"
  assertEqual("univ AB 4", at(U, "ap-calculus-ab", "4"), { courses: ["MATH-1110"], credits: 4 });
  // Chemistry: catalog "5 | 4 | CHEM 2070 & 2071 or CHEM 2090 & 2091"; Engineering "CHEM 2090 & CHEM 2091 | 4".
  assertEqual("univ chem 5", at(U, "ap-chemistry", "5")?.credits, 4);
  assertEqual("eng chem 5", at(E, "ap-chemistry", "5"), { courses: ["CHEM-2090", "CHEM-2091"], credits: 4 });
  // Physics C Mechanics: Engineering PHYS 1112 (3); A&S bullet "5 grade will receive credit for PHYS 2207".
  assertEqual("eng mech 5", at(E, "ap-physics-c-mechanics", "5"), { courses: ["PHYS-1112"], credits: 3 });
  assertEqual("cas mech 5", at(CAS, "ap-physics-c-mechanics", "5"), { courses: ["PHYS-2207"], credits: 4 });
  assertEqual("eng e&m 5", at(E, "ap-physics-c-electricity-and-magnetism", "5"), { courses: ["PHYS-2213"], credits: 4 });
  assertEqual("eng cs a 5", at(E, "ap-computer-science-a", "5"), { courses: ["CS-1110"], credits: 4 });
  assertEqual("univ cs a 5", at(U, "ap-computer-science-a", "5"), { courses: ["CS-1110"], credits: 4 });
  // Statistics: CALS "5 | 4 credits" + catalog CALS bullet "credit for STSCI 2100"; a 4 earns nothing in CALS.
  assertEqual("cals stats 5", at(CALS, "ap-statistics", "5"), { courses: ["STSCI-2100"], credits: 4 });
  assertEqual("cals stats 4", at(CALS, "ap-statistics", "4"), null);
  assertEqual("univ stats 4 credits", at(U, "ap-statistics", "4")?.credits, 4);
  assertEqual("eng stats", at(E, "ap-statistics", "5"), null);
  // Psychology "4,5 | 3 | Placement out of PSYCH 1101."
  assertEqual("univ psych 4", at(U, "ap-psychology", "4"), { courses: ["PSYCH-1101"], credits: 3 });
  // English: university "Varies by college"; A&S "5 | 3 credits, placement out of one FWS"; Engineering ENGL 1100F at 5.
  assertEqual("univ eng lit", at(U, "ap-english-literature-and-composition", "5"), null);
  assertEqual("cas eng lit 5", at(CAS, "ap-english-literature-and-composition", "5"), { courses: [], credits: 3 });
  assertEqual("cals eng lang 5", at(CALS, "ap-english-language-and-composition", "5"), { courses: [], credits: 3 });
  assertEqual("eng eng lang 5", at(E, "ap-english-language-and-composition", "5"), { courses: ["ENGL-1100F"], credits: 3 });
  assertEqual("eng eng lang 4", at(E, "ap-english-language-and-composition", "4"), { courses: ["ENGL-1101A"], credits: 3 });
  // IB: "Economics | 7 | 6 credits (ECON 1110 and ECON 1120)"; Biology 7 "8 credits awarded as BIOG 1102F".
  assertEqual("univ ib econ 7", at(U, "ib-economics-hl", "7"), { courses: ["ECON-1110", "ECON-1120"], credits: 6 });
  assertEqual("univ ib bio 7", at(U, "ib-biology-hl", "7"), { courses: ["BIOG-1102F"], credits: 8 });
  // A-Level: "Mathematics | A*, A, B, or C | 4 credits ... (MATH 1110)"; Engineering only the Singapore exam.
  assertEqual("univ alevel math C", at(U, "alevel-mathematics", "C"), { courses: ["MATH-1110"], credits: 4 });
  assertEqual("eng alevel math", at(E, "alevel-mathematics", "A*"), null);
  assertEqual("eng alevel math sg", at(E, "alevel-mathematics-singapore", "A"), { courses: ["MATH-1910"], credits: 4 });
  // French Baccalaureat, Engineering: "16/20 or higher | FREN 2000E (4 credits) and FREN 2000C (3 credits) | 7"
  const fb = tables.engineering.awards.find((a) => a.exam === "intl-french-baccalaureate-francais-ecrit" && a.scores.includes("18"));
  assertEqual("eng fb 18 per-course", fb?.courseCredits, { "FREN-2000E": 4, "FREN-2000C": 3 });
  assertEqual("eng fb 14", at(E, "intl-french-baccalaureate-francais-ecrit", "14"), { courses: ["FREN-2000C"], credits: 3 });
  // "Not Accepted": the exam exists and earns nothing anywhere.
  assertTrue("apush exists", examIds.has("ap-united-states-history"));
  assertTrue("apush earns nothing", all.every((t) => !t.awards.some((a) => a.exam === "ap-united-states-history")));
});

check("the JSON on disk is current (--check)", () => {
  const disk = readFileSync(OUT_FILE, "utf8").replace(/\r\n/g, "\n");
  assertTrue("current", disk === renderJson(tables), `${TABLE_YEAR}.json is stale: run npx tsx build-credit-tables.ts`);
  assertEqual("exam count", EXAMS.length, tables.exams.length);
});

for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.stack ?? e.message : String(e));
  }
  console.log(`${failures === before ? "  ✓" : "  ✗"} ${c.name}`);
}
if (failures) {
  console.error(`\nCORPUS FAILED: ${failures} problem(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
