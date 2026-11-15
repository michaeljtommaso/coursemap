// scripts/build-credit-tables.ts
// Builds Cornell's exam credit tables (spec 028) from saved copies of Cornell's own
// pages into cornell-degree-planner/src/data/credit-tables/<year>.json (ExamTables).
//
// Sources (saved under docs/provenance/credit-tables/, never fetched here):
//   catalog      University Credit by Exam page: the AP table, the IB, French
//                Baccalaureat, GCE A-Level and Cambridge Pre-U tables, and the
//                "College-specific Information" bullets
//   cas          Arts & Sciences: its English exam table
//   cals         CALS-specific AP credit table (English, Statistics)
//   cals-policy  CALS AP and transfer credit policy (the 15-credit cap)
//   engineering  Engineering's own 2026-27 AP credit table (all exam families)
//
// How it works: every table row on those pages is parsed mechanically into cells.
// ROWS below says, for each row, which exam(s) it belongs to and anything the page
// states in free text (an "or" between courses, a per-major limit). The script
// fails when a page row has no entry in ROWS, when an entry matches no row, when
// a course id given in ROWS is not printed in that row (or its named evidence row),
// and when a limit or note's evidence phrase is not on its page. Scores, credits
// and course ids default to what the row prints; ROWS overrides them only where
// the printed cell is not a plain value ("3 or 4", a list of placement courses of
// which only some are granted). Cornell's "X or Y" course sets are emitted as
// courseOptions. One rule is applied after mapping (raiseTopGrades): a higher grade
// never earns less, so grades above an exam's top awarded grade join that award.
//
// Engineering liberal studies (spec 037 D4): where Engineering's "Degree Requirement
// Fulfilled" cell says the credit counts as a Liberal Studies Distribution
// Requirement, the award gets `liberalStudies`, the category codes the cell prints
// in parentheses ("... in the Foreign Language (FL) category" → ["FL"]).
//
// Run (from scripts/):
//   npx tsx build-credit-tables.ts           (write the JSON)
//   npx tsx build-credit-tables.ts --check   (exit 1 if the JSON on disk is stale)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollegeExamTable, ExamAward, ExamDef, ExamFamily, ExamTables } from "../cornell-degree-planner/src/lib/credit/types";

export const TABLE_YEAR = "2026-27";
/** Date stamp of the saved snapshots (also `source.fetched`). */
export const SNAPSHOT_DATE = "2026-11-06";

export type PageKey = "catalog" | "cas" | "cals" | "cals-policy" | "engineering";
export const PAGES: Record<PageKey, { file: string; url: string }> = {
  catalog: {
    file: `catalog-credit-by-exam-${SNAPSHOT_DATE}.html`,
    url: "https://catalog.cornell.edu/enrollment-credit-requirements/advanced-placement-standing/",
  },
  cas: {
    file: `cas-ap-ib-alevel-${SNAPSHOT_DATE}.html`,
    url: "https://as.cornell.edu/advising/ap-ib-a-level-credits",
  },
  cals: {
    file: `cals-specific-ap-table-${SNAPSHOT_DATE}.html`,
    url: "https://cals.cornell.edu/undergraduate-students/cals-student-services/academic-resources/advanced-placement-ap-and-transfer-credit-policy/cals-specific-advanced-placement-ap-credit-table",
  },
  "cals-policy": {
    file: `cals-ap-transfer-credit-policy-${SNAPSHOT_DATE}.html`,
    url: "https://cals.cornell.edu/undergraduate-students/cals-student-services/academic-resources/advanced-placement-ap-and-transfer-credit-policy",
  },
  engineering: {
    file: `engineering-ap-2026-27-${SNAPSHOT_DATE}.html`,
    url: "https://www.duffield.cornell.edu/registrar/advanced-placement-ap-and-transfer-credit/advanced-placement-ap-credit-table/2026-2027-advanced-placement-credit-table/",
  },
};

export const SNAPSHOT_DIR = resolve(__dirname, "../docs/provenance/credit-tables");
export const OUT_FILE = resolve(__dirname, `../cornell-degree-planner/src/data/credit-tables/${TABLE_YEAR}.json`);

// ─── HTML → tables, bullets, text ────────────────────────────────────────────

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', uarr: "↑", rarr: "→", larr: "←", bull: "•", middot: "·",
  eacute: "é", egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô",
  icirc: "î", uuml: "ü", ouml: "ö", auml: "ä", ntilde: "ñ", times: "×", copy: "©", reg: "®", zwnj: "", zwj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[ref] ?? NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** One line of plain text: entities decoded, curly quotes straightened, zero-width
 *  characters removed, whitespace collapsed. Keys and evidence use this form. */
export function normalize(s: string): string {
  return decodeEntities(s)
    .replace(/[​‌‍﻿]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s ]+/g, " ")
    .trim();
}

export type ParsedTable = { heads: string[]; rows: string[][] };
export type ParsedBullet = { heads: string[]; text: string };
export type ParsedPage = { tables: ParsedTable[]; bullets: ParsedBullet[]; text: string };

const BLOCK = new Set(["p", "div", "li", "td", "th", "tr", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "section", "figure", "figcaption", "caption", "br", "details", "summary", "dd", "dt"]);

/**
 * A small streaming parser, enough for these pages: headings (h1–h6, tracked as a
 * path), table rows and cells, list items, and the page's whole text. <sup>
 * footnote markers, captions, scripts, styles and comments are dropped.
 */
export function parsePage(html: string): ParsedPage {
  const tables: ParsedTable[] = [];
  const bullets: ParsedBullet[] = [];
  const textParts: string[] = [];
  const heads: string[] = [];
  let heading: { level: number; buf: string } | null = null;
  const tableStack: { t: ParsedTable; row: string[] | null; cell: string | null }[] = [];
  const liStack: string[] = [];
  let skipDepth = 0; // inside <sup> or <caption>/<figcaption>

  const re = /<!--[\s\S]*?-->|<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const pushText = (raw: string) => {
    if (skipDepth > 0) return;
    textParts.push(raw);
    if (heading) heading.buf += raw;
    const top = tableStack[tableStack.length - 1];
    if (top?.cell != null) top.cell += raw;
    for (let i = 0; i < liStack.length; i++) liStack[i] += raw;
  };
  while ((m = re.exec(html))) {
    if (m[4] != null) {
      pushText(m[4]);
      continue;
    }
    if (!m[3]) continue; // comment or dropped element
    const close = m[2] === "/";
    const tag = m[3].toLowerCase();
    if (tag === "sup" || tag === "caption" || tag === "figcaption") {
      skipDepth += close ? -1 : 1;
      if (skipDepth < 0) skipDepth = 0;
      continue;
    }
    if (BLOCK.has(tag)) pushText(" ");
    const hm = /^h([1-6])$/.exec(tag);
    if (hm) {
      const level = Number(hm[1]);
      if (!close) heading = { level, buf: "" };
      else if (heading) {
        heads.length = heading.level;
        heads[heading.level - 1] = normalize(heading.buf);
        heading = null;
      }
      continue;
    }
    if (tag === "table") {
      if (!close) tableStack.push({ t: { heads: Array.from(heads, (h) => h ?? ""), rows: [] }, row: null, cell: null });
      else {
        const done = tableStack.pop();
        if (done) tables.push(done.t);
      }
      continue;
    }
    const top = tableStack[tableStack.length - 1];
    if (tag === "tr" && top) {
      if (!close) top.row = [];
      else if (top.row) {
        if (top.cell != null) top.row.push(normalize(top.cell));
        top.cell = null;
        top.t.rows.push(top.row);
        top.row = null;
      }
      continue;
    }
    if ((tag === "td" || tag === "th") && top && top.row) {
      if (!close) {
        if (top.cell != null) top.row.push(normalize(top.cell));
        top.cell = "";
      } else if (top.cell != null) {
        top.row.push(normalize(top.cell));
        top.cell = null;
      }
      continue;
    }
    if (tag === "li" && tableStack.length === 0) {
      if (!close) liStack.push("");
      else if (liStack.length) {
        const text = normalize(liStack.pop() as string);
        bullets.push({ heads: Array.from(heads, (h) => h ?? ""), text });
      }
    }
  }
  return { tables, bullets, text: normalize(textParts.join("")) };
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/** A row a page prints: `table` names which printed table it came from. */
export type RawRow = {
  page: PageKey;
  table: string;
  key: string;
  cells: string[];
  /** The cell holding scores (or the bullet text). */
  score: string;
  /** The cell holding credits, when the table has one. */
  credit: string | null;
  /** The cell whose course ids are granted by default. */
  courseText: string;
  /** Engineering only: the "Engineering Degree Requirement Fulfilled" cell. */
  requirement?: string;
  /** Every cell joined: what a row's evidence is checked against. */
  text: string;
};

function catalogTableName(heads: string[]): string | null {
  const h3 = heads[2] ?? "";
  if (/University AP Exam Articulations/i.test(h3)) return "ap";
  if (/International Baccalaureate/i.test(h3)) return "ib";
  if (/French Baccalaur/i.test(h3)) return "fb";
  if (/General Certificate of Education/i.test(h3)) return "alevel";
  if (/Cambridge Pre-University/i.test(h3)) return "preu";
  return null; // the CASE table (under an h2 only) and anything else
}

/** Every credit-table row on one page, keyed `table|cell0|cell1` (+ `#n` for repeats). */
export function rowsOf(page: PageKey, parsed: ParsedPage): RawRow[] {
  const out: RawRow[] = [];
  const seen = new Map<string, number>();
  const push = (r: Omit<RawRow, "key" | "text" | "page"> & { keyParts: string[] }) => {
    const base = [r.table, ...r.keyParts].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const { keyParts: _k, ...rest } = r;
    out.push({ ...rest, page, key: n > 1 ? `${base}#${n}` : base, text: r.cells.join(" | ") });
  };
  for (const t of parsed.tables) {
    const [header, ...body] = t.rows;
    if (!header || header.length < 3) continue;
    let table: string | null = null;
    if (page === "catalog") table = catalogTableName(t.heads);
    else if (page === "cas") table = "cas";
    else if (page === "cals") table = "cals";
    else if (page === "engineering") table = `eng:${t.heads[1] ?? ""}`;
    if (!table) continue;
    for (const cells of body) {
      if (!cells.length || cells.every((c) => !c)) continue;
      if (page === "catalog" && table === "ap") {
        push({ table, keyParts: [cells[0], cells[1] ?? ""], cells, score: cells[1] ?? "", credit: cells[2] ?? null, courseText: cells[3] ?? cells[1] ?? "" });
      } else if (page === "catalog") {
        push({ table, keyParts: [cells[0], cells[1] ?? ""], cells, score: cells[1] ?? "", credit: cells[2] ?? null, courseText: cells[2] ?? "" });
      } else if (page === "cas" || page === "cals") {
        push({ table, keyParts: [cells[0], cells[1] ?? ""], cells, score: cells[2] ?? "", credit: cells[3] ?? null, courseText: cells[3] ?? "" });
      } else {
        push({ table, keyParts: [cells[0], cells[1] ?? ""], cells, score: cells[1] ?? "", credit: cells[4] ?? null, courseText: cells[2] ?? "", requirement: cells[3] ?? "" });
      }
    }
  }
  if (page === "catalog") {
    for (const b of parsed.bullets) {
      if (!/College-specific Information/i.test(b.heads[2] ?? "") || !b.heads[3]) continue;
      push({ table: `bullet:${b.heads[3]}`, keyParts: [b.text], cells: [b.text], score: b.text, credit: null, courseText: b.text });
    }
  }
  return out;
}

// ─── Value parsing ───────────────────────────────────────────────────────────

/** Course ids printed in a text, dash form, in order, without repeats ("CHEM 2070" → "CHEM-2070"). */
export function courseCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z]{2,6}) ?(\d{4}[A-Z]?)\b/g)) {
    const id = `${m[1]}-${m[2]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The scores a printed score cell names, lowest first. "X or higher" means X and up.
 *  Words that aren't on the scale ("or", "AP", "parts A and B" on a Pre-U scale) are ignored. */
export function parseScores(cell: string, scale: string[]): string[] {
  const c = cell.replace(/\/20\b/g, "");
  const hi = /^\s*(\S+?)\s+or\s+higher\b/i.exec(c);
  if (hi) {
    const i = scale.indexOf(hi[1]);
    return i < 0 ? [] : scale.slice(i);
  }
  const tokens = c.split(/[\s,()]+/).filter(Boolean);
  return scale.filter((s) => tokens.includes(s));
}

/** Credits printed in a cell: a bare number, or the first "N credit(s)". A
 *  placement phrase ("Placement out of 3 credits of written expression") states
 *  what the student is excused from, not credit granted: it is never read as a
 *  credit figure, so a row printing only that needs an explicit `credits`. */
export function parseCredits(cell: string | null): number | null {
  if (cell == null) return null;
  const bare = /^\s*(\d+)\s*$/.exec(cell);
  if (bare) return Number(bare[1]);
  const granted = cell.replace(/\bplacement (?:out )?of (?:\w+ )?\d+ credits?\b/gi, " ");
  const m = /\b(\d+) credits?\b/i.exec(granted);
  return m ? Number(m[1]) : null;
}

/** Split a dash-form course id into subject and a plain 4-digit number (null
 *  when the number carries a suffix letter, "ENGL-1100F"). */
function plainNumber(id: string): { subject: string; n: number } | null {
  const m = /^([A-Z]{2,6})-(\d{4})$/.exec(id);
  return m ? { subject: m[1], n: Number(m[2]) } : null;
}

/** Is `id` the lab of a lecture granted with it? Cornell numbers a lecture's
 *  lab one above it, ending in 1, in the same subject (CHEM 2071 with CHEM
 *  2070). PHYS 1101 + 1102 are two lectures, not a lecture and lab: 1101 has no
 *  1100 beside it, and 1102 doesn't end in 1. */
export function isLabIn(id: string, granted: readonly string[]): boolean {
  const p = plainNumber(id);
  if (!p || p.n % 10 !== 1) return false;
  return granted.includes(`${p.subject}-${String(p.n - 1).padStart(4, "0")}`);
}

/**
 * Rule (lecture + lab): when a grant includes a lecture and its lab, the lab
 * counts 0 and the grant's credits go to the lectures, spread evenly in whole
 * credits (the first lecture takes any remainder, as the resolver does). So AP
 * Chemistry's 4 credits are CHEM 2070: 4 + CHEM 2071: 0, never 2 + 2 (a 2-credit
 * CHEM 2070 would fail a "3 credits or more" requirement the exam should fill).
 * Applied per option set; a course must get the same figure in every set it is
 * in (else `conflict` says why). `credits` is null when no set has a lab (the
 * resolver spreads those totals evenly).
 */
export function lectureLabCredits(sets: readonly string[][], credits: number): { credits: Record<string, number> | null; conflict?: string } {
  if (!sets.some((set) => set.some((id) => isLabIn(id, set)))) return { credits: null };
  const out: Record<string, number> = {};
  for (const set of sets) {
    const lectures = set.filter((id) => !isLabIn(id, set));
    const each = lectures.length ? Math.floor(credits / lectures.length) : 0;
    const share: Record<string, number> = {};
    for (const id of set) share[id] = 0;
    lectures.forEach((id, i) => (share[id] = i === 0 ? credits - each * (lectures.length - 1) : each));
    for (const [id, c] of Object.entries(share)) {
      if (out[id] != null && out[id] !== c) return { credits: null, conflict: `${id} gets ${out[id]} in one option and ${c} in another` };
      out[id] = c;
    }
  }
  return { credits: out };
}

/** Problems with per-course credits: each option set (or the whole grant, when
 *  there are no options) must name every course and sum to the grant's credits. */
export function courseCreditsProblems(courseCredits: Record<string, number>, courses: readonly string[], sets: readonly string[][] | undefined, credits: number): string[] {
  const problems: string[] = [];
  for (const c of Object.keys(courseCredits)) if (!courses.includes(c)) problems.push(`courseCredits names ${c}, not a granted course`);
  for (const set of sets ?? [courses as string[]]) {
    const missing = set.filter((id) => courseCredits[id] == null);
    if (missing.length) problems.push(`courseCredits has no figure for ${missing.join(", ")}`);
    const sum = set.reduce((x, id) => x + (courseCredits[id] ?? 0), 0);
    if (sum !== credits) problems.push(`courseCredits sum ${sum} ≠ credits ${credits}${sets ? ` in option ${set.join(" & ")}` : ""}`);
  }
  return problems;
}

/** Per-course credits printed inline: "FREN 2000E (4 credits) and FREN 2000C (3 credits)". */
export function inlineCourseCredits(text: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/\b([A-Z]{2,6}) ?(\d{4}[A-Z]?) \((\d+) credits?\)/g)) out[`${m[1]}-${m[2]}`] = Number(m[3]);
  return Object.keys(out).length ? out : null;
}

// ─── Exams ───────────────────────────────────────────────────────────────────

const AP_SCALE = ["1", "2", "3", "4", "5"];
const IB_SCALE = ["1", "2", "3", "4", "5", "6", "7"];
const ALEVEL_SCALE = ["E", "D", "C", "B", "A", "A*"];
/** Cambridge Pre-U principal subjects: Pass 3 (lowest) to Distinction 1. */
const PREU_SCALE = ["P3", "P2", "P1", "M3", "M2", "M1", "D3", "D2", "D1"];
/** French Baccalaureat marks out of 20. */
const FB_SCALE = Array.from({ length: 21 }, (_, i) => String(i));

export const GROUP_FB = "French Baccalauréat";
export const GROUP_PREU = "Cambridge Pre-U";

type ExamSeed = [id: string, name: string, common?: boolean];
const ap = (rows: ExamSeed[]): ExamDef[] => rows.map(([id, name, common]) => ({ id, family: "ap", name, scale: AP_SCALE, ...(common ? { common } : {}) }));
const ib = (rows: ExamSeed[]): ExamDef[] => rows.map(([id, name]) => ({ id, family: "ib", name, scale: IB_SCALE }));
const al = (rows: ExamSeed[]): ExamDef[] => rows.map(([id, name]) => ({ id, family: "alevel", name, scale: ALEVEL_SCALE }));
const intl = (group: string, scale: string[], rows: ExamSeed[]): ExamDef[] =>
  rows.map(([id, name]) => ({ id, family: "intl" as ExamFamily, name, group, scale }));

/**
 * Every exam a student can pick: one per exam the pages print (AP names in the
 * College Board's current form; the catalog prints "History, American",
 * "Economics (Micro)", "Mathematics BC ..."). `common` marks the most-taken AP exams.
 */
export const EXAMS: ExamDef[] = [
  ...ap([
    ["ap-art-history", "Art History"],
    ["ap-biology", "Biology", true],
    ["ap-calculus-ab", "Calculus AB", true],
    ["ap-calculus-bc", "Calculus BC", true],
    ["ap-chemistry", "Chemistry", true],
    ["ap-comparative-government-and-politics", "Comparative Government and Politics"],
    ["ap-computer-science-a", "Computer Science A", true],
    ["ap-computer-science-principles", "Computer Science Principles"],
    ["ap-english-language-and-composition", "English Language and Composition", true],
    ["ap-english-literature-and-composition", "English Literature and Composition", true],
    ["ap-european-history", "European History"],
    ["ap-french-language-and-culture", "French Language and Culture"],
    ["ap-french-literature", "French Literature"],
    ["ap-german-language-and-culture", "German Language and Culture"],
    ["ap-human-geography", "Human Geography"],
    ["ap-italian-language-and-culture", "Italian Language and Culture"],
    ["ap-japanese-language-and-culture", "Japanese Language and Culture"],
    ["ap-latin", "Latin"],
    ["ap-macroeconomics", "Macroeconomics", true],
    ["ap-microeconomics", "Microeconomics", true],
    ["ap-music-theory", "Music Theory"],
    ["ap-physics-1", "Physics 1", true],
    ["ap-physics-2", "Physics 2", true],
    ["ap-physics-c-mechanics", "Physics C: Mechanics", true],
    ["ap-physics-c-electricity-and-magnetism", "Physics C: Electricity and Magnetism", true],
    ["ap-psychology", "Psychology", true],
    ["ap-spanish-language-and-culture", "Spanish Language and Culture"],
    ["ap-spanish-literature-and-culture", "Spanish Literature and Culture"],
    ["ap-statistics", "Statistics", true],
    ["ap-united-states-government-and-politics", "United States Government and Politics"],
    ["ap-united-states-history", "United States History", true],
    ["ap-world-history", "World History: Modern"],
  ]),
  ...ib([
    ["ib-anthropology-hl", "Anthropology HL"],
    ["ib-biology-hl", "Biology HL"],
    ["ib-chemical-and-physical-systems-hl", "Chemical and Physical Systems HL"],
    ["ib-chemistry-hl", "Chemistry HL"],
    ["ib-computer-science-hl", "Computer Science HL"],
    ["ib-economics-hl", "Economics HL"],
    ["ib-english-language-and-literature-hl", "English Language and Literature HL"],
    ["ib-english-literature-hl", "English Literature HL"],
    ["ib-german-hl", "German HL"],
    ["ib-history-hl", "History HL"],
    ["ib-mathematics-analysis-and-approaches-hl", "Mathematics: Analysis and Approaches HL"],
    ["ib-mathematics-applications-and-interpretation-hl", "Mathematics: Applications and Interpretation HL"],
    ["ib-music-hl", "Music HL"],
    ["ib-philosophy-hl", "Philosophy HL"],
    ["ib-physical-science-hl", "Physical Science HL"],
    ["ib-physics-hl", "Physics HL"],
  ]),
  ...al([
    ["alevel-biology", "Biology"],
    ["alevel-chemistry", "Chemistry"],
    ["alevel-economics", "Economics"],
    ["alevel-english-language", "English Language"],
    ["alevel-english-literature", "English Literature"],
    ["alevel-further-mathematics", "Further Mathematics"],
    ["alevel-mathematics", "Mathematics"],
    ["alevel-mathematics-singapore", "Mathematics or Pure Mathematics (taken in Singapore)"],
    ["alevel-music", "Music"],
    ["alevel-philosophy", "Philosophy"],
    ["alevel-physics", "Physics"],
    ["alevel-statistics", "Statistics"],
  ]),
  ...intl(GROUP_FB, FB_SCALE, [
    ["intl-french-baccalaureate-francais-ecrit", "Français écrit"],
    ["intl-french-baccalaureate-histoire-et-geographie", "Histoire et Géographie"],
    ["intl-french-baccalaureate-mathematiques-sciences-physiques-biologie", "Mathématiques, Sciences Physiques, Biologie"],
    ["intl-french-baccalaureate-philosophie", "Philosophie"],
  ]),
  ...intl(GROUP_PREU, PREU_SCALE, [
    ["intl-cambridge-pre-u-biology", "Biology"],
    ["intl-cambridge-pre-u-chemistry", "Chemistry"],
    ["intl-cambridge-pre-u-economics", "Economics"],
    ["intl-cambridge-pre-u-english", "English"],
    ["intl-cambridge-pre-u-history", "History"],
    ["intl-cambridge-pre-u-mathematics", "Mathematics"],
    ["intl-cambridge-pre-u-physics", "Physics"],
  ]),
];

// ─── Row interpretations ─────────────────────────────────────────────────────

/** A student-facing sentence and the phrase(s) on the page it rests on. Evidence is
 *  checked (case-insensitive) against the row's text, or the whole `page` when given. */
export type Said = { text: string; from: string | string[]; page?: PageKey };
export type AwardSpec = {
  exams: string[];
  /** Default: the scores the row's score cell names. */
  scores?: string[];
  /** Default: the row's credit cell. */
  credits?: number;
  /** Default: every course id the row's course cell prints. When given, each id
   *  must be printed in the row (or in the `coursesFrom` row). */
  courses?: string[];
  coursesFrom?: string;
  /** Cornell's "X or Y": mutually exclusive course sets in the order the page
   *  prints them; their union must equal the granted courses. "each" = one set
   *  per granted course ("placement out of" a list). */
  courseOptions?: string[][] | "each";
  /** Per-course credits the page states; `courseCreditsFrom` is the phrase in
   *  the row that states them (required with courseCredits). Without it, the
   *  lecture + lab rule (lectureLabCredits) applies. */
  courseCredits?: Record<string, number>;
  courseCreditsFrom?: string;
  placementOnly?: boolean;
  limits?: Said[];
  note?: Said;
  /** Catalog "College-specific Information" bullets only: the override table. */
  to?: "cas" | "cals";
};
export type RowSpec =
  | { award: AwardSpec | AwardSpec[] }
  /** The exam(s) exist; this row earns nothing ("Not Accepted", "No credit", "Varies by college"). */
  | { noCredit: string[] }
  /** Not a credit row for this planner (with the reason). */
  | { skip: string }
  /** Stated by another row's interpretation (named). */
  | { foldedInto: string };

const say = (text: string, from: string | string[], page?: PageKey): Said => ({ text, from, ...(page ? { page } : {}) });
const award = (exams: string | string[], o: Omit<AwardSpec, "exams"> = {}): RowSpec => ({ award: { exams: [exams].flat(), ...o } });
const noCredit = (...exams: string[]): RowSpec => ({ noCredit: exams });
const skip = (why: string): RowSpec => ({ skip: why });

const BIO_MAJORS_AP = say(
  "Biological Sciences majors: elective credit only. It counts toward the 120 credits to graduate but not toward the major.",
  "cannot be used to fulfill requirements for the Biological Sciences major",
);
const BIO_MAJORS_INTL = say(
  "Biological Sciences majors: elective credit only. It counts toward the 120 credits to graduate but not toward the major.",
  "cannot be used toward the biological science major",
);
const BIO_OTHERS_8 = say(
  "Other majors: places you out of 8 credits of introductory biology; ask your major how it counts.",
  "8 credits awarded for placement out of Introductory Biology Cluster Courses",
);
const CHEM_OPTIONS = [
  ["CHEM-2070", "CHEM-2071"],
  ["CHEM-2090", "CHEM-2091"],
];
const CHEM_PAIR = say(
  "Cornell grants this as CHEM 2070 & 2071 or as CHEM 2090 & 2091 (one pair, not both).",
  "CHEM 2070 & CHEM 2071 or CHEM 2090 & CHEM 2091",
);
const PHYSICS_MAJORS = say(
  "Physics majors are advised to give up this credit and take PHYS 1116.",
  "recommended to forfeit all credit",
);
const ECON_MAJORS = (course: string, exam: string) =>
  say(
    `Economics majors: to count it as ${course} for the major, also pass the ${exam} Placement Exam at orientation (not needed if you were a full-time college student before May 1, 2026).`,
    [`students must in addition pass the ${exam} Placement Exam during orientation`, "matriculated as a full-time student at a college or university prior to May 1, 2026"],
  );
const STATS_FORFEIT = say(
  "Places you out of the introductory statistics courses listed; taking one of them at Cornell gives up this credit.",
  "they will forfeit those credits if they take AEM 2100",
  "catalog",
);
const ENG_MAY_POST = (from: string) => say("Engineering may post this as ENGL 1101A or ENGL 1102A.", from);
const ENG_PHYS_1110 = say("You must still enroll in PHYS 1110.", "Students awarded credit for PHYS 1112 must still enroll in PHYS 1110", "engineering");
const ENG_CHEME = say(
  "Thinking of Chemical Engineering? You may take CHEM 2150 in your first fall; passing it counts as CHEM 2080 & 2081.",
  ["thinking of majoring in Chemical Engineering may consider enrolling in CHEM 2150", "will be considered to have completed the equivalent to CHEM 2080 & CHEM 2081"],
  "engineering",
);
const CAS_FWS = say("Places you out of one First-Year Writing Seminar.", "placement out of one FWS");
// CALS prints placement, not credit, for its English rows ("Placement out of 3
// credits of written expression."), where its Statistics rows print "4 credits.":
// the English awards are placement only (0 credits).
const CALS_WRITING = say("Places you out of 3 credits of written expression (placement, no credit); only one exam can count toward it.", [
  "Placement out of 3 credits of written expression",
  "Students allowed to use one test to fulfill written expression",
]);
const CALS_MAJOR = say("Check with your major department before counting this toward major requirements.", "Major requirements are not included");
const CALS_NOT_BE = say("Not for Biological Engineering or Environmental Engineering (BE/EnvE) majors.", "(excluding BE/EnvE)");
/** CALS English rows: placement, no credit (see CALS_WRITING). */
const CALS_WRITING_AWARD: Omit<AwardSpec, "exams"> = { credits: 0, placementOnly: true, note: CALS_WRITING, limits: [CALS_MAJOR] };
/** CALS Statistics rows (AP 5; A-Level A*, A, B): "4 credits" for one of the
 *  statistics courses the row says taking would forfeit the credit. STSCI 2100
 *  comes first: the catalog's CALS bullet says "5 grade will receive credit for
 *  STSCI 2100". The row prints "ILRST/STSCI 2100", read as STSCI 2100 (ILRST
 *  2100 is its cross-listing). Taking any of them at Cornell uses the credit up,
 *  which is how an "X or Y" award already behaves. */
const CALS_STATS: Omit<AwardSpec, "exams"> = {
  courses: ["STSCI-2100", "AEM-2100", "BTRY-3010", "BTRY-6010", "PAM-2100", "ILRST-6100", "PSYCH-2500", "STSCI-2150", "SOC-3010"],
  courseOptions: "each",
  note: say(
    "Credit for STSCI 2100 (or one similar course); taking AEM 2100, BTRY 3010, PSYCH 2500 or a similar statistics course at Cornell gives up this credit.",
    "Students taking AEM 2100, BTRY 3010, BTRY 6010, PAM 2100, ILRST/STSCI 2100, ILRST 6100, PSYCH 2500, STSCI 2150, SOC 3010, or equivalent will forfeit credit",
  ),
  limits: [CALS_NOT_BE, CALS_MAJOR],
};

/** CALS rules for every exam award it grants (from the AP and transfer credit policy page). */
const CALS_COLLEGE_LIMITS: Said[] = [
  say(
    "At most 15 credits from exams and transfer courses, combined, count toward a CALS degree for students who enter as first-year students.",
    ["first-year students may apply a maximum of 15 transfer credits toward CALS degree requirements", "and advanced placement (AP) credits"],
    "cals-policy",
  ),
  say(
    "Students who transfer to CALS from another school may count up to 60 credits from outside Cornell, at most 15 of them from exams.",
    ["matriculate to CALS from outside Cornell may earn a maximum of 60 total transfer credits", "which includes the 15 AP credits"],
    "cals-policy",
  ),
];

const ENG = (section: string, rest: string) => `eng:${section}|${rest}`;

/** Every credit-table row on the five pages, keyed as rowsOf() keys them. */
export const ROWS: Record<string, RowSpec> = {
  // ── University AP table (catalog) ──
  "ap|Biology|4": award("ap-biology", {
    limits: [BIO_MAJORS_AP],
    note: say("Other majors: places you out of 4 credits of introductory biology; ask your major how it counts.", "Placement out of 4 credits of Introductory Biology Cluster Courses"),
  }),
  "ap|Biology|5": award("ap-biology", {
    limits: [BIO_MAJORS_AP],
    note: say("Other majors: places you out of 8 credits of introductory biology; ask your major how it counts.", "Placement out of 8 credits of Introductory Biology Cluster Courses"),
  }),
  "ap|Chemistry|5": award("ap-chemistry", { courses: ["CHEM-2070", "CHEM-2071", "CHEM-2090", "CHEM-2091"], courseOptions: CHEM_OPTIONS, note: CHEM_PAIR }),
  "ap|Computer Science A|5": award("ap-computer-science-a"),
  "ap|Computer Science Principles|Not Accepted": noCredit("ap-computer-science-principles"),
  "ap|Economics (Micro)|5": award("ap-microeconomics", { courses: ["ECON-1110"], limits: [ECON_MAJORS("ECON 1110", "Microeconomics")] }),
  "ap|Economics (Macro)|5": award("ap-macroeconomics", { courses: ["ECON-1120"], limits: [ECON_MAJORS("ECON 1120", "Macroeconomics")] }),
  "ap|English Language and Composition|N/A": noCredit("ap-english-language-and-composition"),
  "ap|English Literature and Composition|N/A": noCredit("ap-english-literature-and-composition"),
  "ap|French Language and Culture|4,5": {
    award: [
      { exams: ["ap-french-language-and-culture"], scores: ["4"], courses: [], note: say("Places you into FREN 2090 or equivalent.", "With a score of 4, placement into FREN 2090 or equivalent") },
      { exams: ["ap-french-language-and-culture"], scores: ["5"], courses: [], note: say("Romance Studies sets your placement; take the CASE.", "With a score of 5, Department of Romance Studies determines placement") },
    ],
  },
  "ap|German|4,5": award("ap-german-language-and-culture", {
    credits: 0, // printed "N/A": the department decides
    note: say("German Studies decides credit (0 or 3) and placement from its own exam.", "Department of German Studies determines credit and placement based on departmental examination (0 or 3 credits)"),
  }),
  "ap|Government & Politics, US|Not Accepted": noCredit("ap-united-states-government-and-politics"),
  "ap|Government & Politics, comparative|Not Accepted": noCredit("ap-comparative-government-and-politics"),
  "ap|Greek, Ancient|N/A": skip("no AP exam in this subject; credit comes from Cornell's own CASE exam"),
  "ap|Hebrew|N/A": skip("no AP exam in this subject; credit comes from Cornell's own CASE exam"),
  "ap|History, American|Not Accepted": noCredit("ap-united-states-history"),
  "ap|History, European|Not Accepted": noCredit("ap-european-history"),
  "ap|History, World|Not Accepted": noCredit("ap-world-history"),
  "ap|History of Art|Not Accepted": noCredit("ap-art-history"),
  "ap|Human Geography|Not Accepted": noCredit("ap-human-geography"),
  "ap|Italian Language and Culture|4,5": award("ap-italian-language-and-culture", {
    note: say("Romance Studies sets your placement from the CASE.", "Department of Romance Studies determines placement based on CASE"),
  }),
  "ap|Japanese|N/A": noCredit("ap-japanese-language-and-culture"),
  "ap|Latin|N/A": noCredit("ap-latin"),
  "ap|Mathematics BC for non-engineering majors|4,5": award("ap-calculus-bc", { courses: ["MATH-1110", "MATH-1120"] }),
  "ap|Mathematics BC for engineering majors|5": skip("Engineering students: Engineering's own table applies"),
  "ap|Mathematics AB or AB subscore of the Mathematics BC exam for non-engineering majors|4,5": award("ap-calculus-ab", {
    courses: ["MATH-1110"],
    note: say("An AB subscore of 4 or 5 on the Calculus BC exam earns the same: enter it as Calculus AB.", "AB subscore of the Mathematics BC exam"),
  }),
  "ap|Music Theory|Not Accepted": noCredit("ap-music-theory"),
  "ap|Persian|": skip("no AP exam in this subject; credit comes from Cornell's own CASE exam"),
  "ap|Physics I|5": award("ap-physics-1", { courses: ["PHYS-2207"] }),
  "ap|Physics II|5": award("ap-physics-2", { courses: ["PHYS-2208"] }),
  "ap|Physics C-Mechanics|5": award("ap-physics-c-mechanics", {
    courses: ["PHYS-2207", "PHYS-1112"],
    courseOptions: [["PHYS-1112"], ["PHYS-2207"]], // "PHYS 1112 (for 3 credits) or PHYS 2207 (for 4 credits)"
    credits: 4, // printed "3 or 4": PHYS 2207 for 4, or PHYS 1112 for 3
    note: say("Credit is for PHYS 2207 (4 credits) or PHYS 1112 (3 credits, and you then enroll in PHYS 1110), not both.", [
      "Placement out of PHYS 1112 (for 3 credits) or PHYS 2207 (for 4 credits)",
      "Students given credit for PHYS 1112 must enroll in PHYS 1110",
    ]),
    limits: [
      say("CALS Biological and Environmental Engineering (BEE) majors: credit can only be PHYS 1112.", "Students in CALS majoring in BEE can only be assigned credit for PHYS 1112"),
      PHYSICS_MAJORS,
    ],
  }),
  "ap|Physics C-Electricity & Magnetism|5": award("ap-physics-c-electricity-and-magnetism", {
    courses: ["PHYS-2213"],
    limits: [PHYSICS_MAJORS],
    note: say("To continue to PHYS 2214, first complete PHYS 1110 (unless you took it with PHYS 1112 or PHYS 1116).", "Students planning to continue with PHYS 2214 must first complete PHYS 1110"),
  }),
  "ap|Psychology|4,5": award("ap-psychology"),
  "ap|Spanish Language and Culture|4,5": award("ap-spanish-language-and-culture", {
    note: say("Take the LPS and then the CASE for placement.", "Students should take the LPS and afterward the CASE"),
  }),
  "ap|Spanish Literature and Culture|4,5": award("ap-spanish-literature-and-culture", {
    note: say("Romance Studies sets your placement: take the LPS and then the CASE.", ["Department of Romance Studies determines placement", "Students should take the LPS and afterward the CASE"]),
  }),
  "ap|Statistics (excluding Engineering, Nolan School and Brooks School students)|4,5": award("ap-statistics", {
    courseOptions: "each", // "Placement out of" the listed courses
    note: STATS_FORFEIT,
    limits: [
      say("Not for Engineering, Nolan School or Brooks School students.", "excluding Engineering, Nolan School and Brooks School students"),
      say(
        "Biological Sciences and Urban and Regional Studies majors: your college's own listing decides how this counts.",
        "Biological Sciences majors, Brooks students, CALS students, Engineering students, Nolan School students and URS majors should refer to their college listing",
      ),
    ],
  }),
  "ap|Turkish|N/A": skip("no AP exam in this subject; credit comes from Cornell's own CASE exam"),
  "ap|Yiddish|N/A": skip("no AP exam in this subject; credit comes from Cornell's own CASE exam"),

  // ── IB Higher Level (catalog) ──
  "ib|Anthropology|N/A": noCredit("ib-anthropology-hl"),
  "ib|Biology|6": award("ib-biology-hl", {
    limits: [BIO_MAJORS_INTL],
    note: say("Other majors: places you out of 4 credits of introductory biology; ask your major how it counts.", "placement out of 4 credits of Introductory Biology Cluster Courses"),
  }),
  "ib|Biology|7": award("ib-biology-hl", { limits: [BIO_MAJORS_INTL], note: BIO_OTHERS_8 }),
  "ib|Chemical and Physical Systems|6 or 7": award("ib-chemical-and-physical-systems-hl"),
  "ib|Chemistry|6 or 7": award("ib-chemistry-hl", { courseOptions: CHEM_OPTIONS, note: CHEM_PAIR }),
  "ib|Computer Science|6 or 7": award("ib-computer-science-hl"),
  "ib|Economics|7": award("ib-economics-hl"),
  "ib|Economics|7#2": skip("Nolan School students only (HADM 1410); the Nolan School isn't a college this planner covers"),
  "ib|English Literature|N/A": noCredit("ib-english-literature-hl"),
  "ib|English Language and Literature|N/A": noCredit("ib-english-language-and-literature-hl"),
  "ib|German|6 or 7": award("ib-german-hl", {
    credits: 0, // the department decides
    note: say("German Studies decides credit from its own exam.", "Credit is based on departmental exam"),
  }),
  "ib|History|N/A": noCredit("ib-history-hl"),
  "ib|Mathematics (AA or AI)|6 or 7": award(["ib-mathematics-analysis-and-approaches-hl", "ib-mathematics-applications-and-interpretation-hl"], {
    note: say("More credit is possible by passing a placement exam at orientation.", "More credit may be obtained by passing a placement exam"),
  }),
  "ib|Music|N/A": noCredit("ib-music-hl"),
  "ib|Philosophy|N/A": noCredit("ib-philosophy-hl"),
  "ib|Physical Science|6 or 7": award("ib-physical-science-hl", {
    // The page states the split (the lab CHEM 2071 rides with its lecture).
    courseCredits: { "CHEM-2070": 4, "CHEM-2071": 0, "PHYS-1101": 4 },
    courseCreditsFrom: "8 credits (4 credits, CHEM 2070 & CHEM 2071; 4 credits, PHYS 1101)",
  }),
  "ib|Physics|6 or 7": award("ib-physics-hl", {
    courses: ["PHYS-2207", "PHYS-1112"],
    courseOptions: [["PHYS-2207"], ["PHYS-1112"]],
    note: say("Credit is for PHYS 2207 (4 credits) or PHYS 1112 (3 credits, and you then enroll in PHYS 1110), not both.", "4 credits (PHYS 2207) or 3 credits (PHYS 1112 - must enroll in PHYS 1110)"),
  }),

  // ── French Baccalaureat (catalog) ──
  "fb|Francais écrit (Séries ES, L, S)|14/20 or higher": award("intl-french-baccalaureate-francais-ecrit", {
    scores: ["14", "15"], // 16 and up is the next row
    credits: 0,
    note: say("Credit and placement come from a placement exam (LPF/CASE) at orientation.", "Credit and placement determined by taking a placement exam (LPF/CASE) during orientation"),
  }),
  "fb|Francais écrit (Séries ES, L, S)|16/20 or higher": award("intl-french-baccalaureate-francais-ecrit", {
    credits: 0,
    note: say("Credit and placement come from a placement exam (LPF/CASE) at orientation.", "Credit and placement determined by taking a placement exam (LPF/CASE) during orientation"),
  }),
  "fb|Histoire et Géographie (Séries)|N/A": noCredit("intl-french-baccalaureate-histoire-et-geographie"),
  "fb|Philosophie|14/20 or higher": award("intl-french-baccalaureate-philosophie", { limits: [say("Séries ES and L only.", "(Séries ES and L) 3 credits")] }),
  "fb|Mathématiques, Sciences Physiques, Biologie|N/A": noCredit("intl-french-baccalaureate-mathematiques-sciences-physiques-biologie"),

  // ── GCE A-Level (catalog) ──
  "alevel|Biology|A or B": award("alevel-biology", { limits: [BIO_MAJORS_INTL], note: BIO_OTHERS_8 }),
  "alevel|Chemistry|A* or A": award("alevel-chemistry", {
    // "CHEM 2070 & 2071 or CHEM 2090 & 2091 and CHEM 2080 & 2081": the second pair comes with either.
    courseOptions: [
      ["CHEM-2070", "CHEM-2071", "CHEM-2080", "CHEM-2081"],
      ["CHEM-2090", "CHEM-2091", "CHEM-2080", "CHEM-2081"],
    ],
    note: say(
      "Cornell grants CHEM 2070 & 2071 or CHEM 2090 & 2091 (one pair, not both), plus CHEM 2080 & 2081.",
      "CHEM 2070 & CHEM 2071 or CHEM 2090 & CHEM 2091 and CHEM 2080 & CHEM 2081",
    ),
  }),
  "alevel|Chemistry|B": award("alevel-chemistry", { courseOptions: CHEM_OPTIONS, note: CHEM_PAIR }),
  "alevel|Economics|A* or A": award("alevel-economics"),
  "alevel|Economics|A* or A#2": skip("HADM 1410 credit is the Nolan School's (as the IB table says); the Nolan School isn't a college this planner covers"),
  "alevel|English Literature|N/A": noCredit("alevel-english-literature"),
  "alevel|Further Mathematics|N/A": noCredit("alevel-further-mathematics"),
  "alevel|Mathematics|A*, A, B, or C": {
    award: [
      {
        exams: ["alevel-mathematics"],
        courses: ["MATH-1110"],
        note: say("More credit is possible by passing a placement exam at orientation.", "More credit may be obtained by passing a placement exam"),
      },
      {
        exams: ["alevel-mathematics-singapore"],
        courses: ["MATH-1110", "MATH-1120"],
        credits: 8, // 4 + "an additional 4 credits"
        note: say("Taken in Singapore: an extra 4 credits and placement out of MATH 1120.", "Non-engineering majors who take the A level exam in Singapore will receive an additional 4 credits and placement out of Calculus II (MATH 1120)"),
      },
    ],
  },
  "alevel|Music|N/A": noCredit("alevel-music"),
  "alevel|Philosophy|A*, A, or B": award("alevel-philosophy", { credits: 0, note: say("Subject to department review.", "Subject to department review") }),
  "alevel|Physics|A*, A, or B": award("alevel-physics", {
    courses: ["PHYS-2207", "PHYS-1112"],
    courseOptions: [["PHYS-2207"], ["PHYS-1112"]],
    note: say(
      "Credit is for PHYS 2207 (4 credits) or PHYS 1112 (3 credits, with PHYS 1110), not both. An A or B plus at least 8 math exam credits also earns PHYS 2208 (4 more credits).",
      ["4 credits for PHYS 2207. 3 credits for PHYS 1112 - requires PHYS 1110 enrollment", "4 additional credits for PHYS 2208 are granted for a combination of grades of A or B and a minimum of 8 advanced placement or advanced standing credits in mathematics"],
    ),
    limits: [PHYSICS_MAJORS],
  }),
  "alevel|Statistics (excluding Engineering and Brooks School students)|A*, A, or B": award("alevel-statistics", {
    courseOptions: "each", // "Placement out of" the listed courses
    note: STATS_FORFEIT,
    limits: [say("Not for Engineering or Brooks School students.", "excluding Engineering and Brooks School students")],
  }),

  // ── Cambridge Pre-U (catalog) ──
  "preu|Biology|M3 or higher": award("intl-cambridge-pre-u-biology", { limits: [BIO_MAJORS_INTL], note: BIO_OTHERS_8 }),
  "preu|Chemistry|D2": award("intl-cambridge-pre-u-chemistry"),
  "preu|Economics|D1, D2, D3": award("intl-cambridge-pre-u-economics"),
  "preu|English|N/A": noCredit("intl-cambridge-pre-u-english"),
  "preu|History|N/A": noCredit("intl-cambridge-pre-u-history"),
  "preu|Mathematics|N/A": noCredit("intl-cambridge-pre-u-mathematics"),
  "preu|Physics|D1, D2, D3 (on parts A and B)": award("intl-cambridge-pre-u-physics", {
    courses: ["PHYS-2207"],
    note: say("This is credit for PHYS 2207, not PHYS 1112.", "but not PHYS 1112"),
    limits: [say("Needs D1–D3 on both parts A and B.", "(on parts A and B)")],
  }),

  // ── Catalog "College-specific Information" bullets ──
  "bullet:College of Agriculture and Life Sciences|Students should refer to the CALS website for credit and placement information.": skip(
    "pointer to the CALS page (saved as cals-specific-ap-table)",
  ),
  "bullet:College of Agriculture and Life Sciences|Statistics: 5 grade will receive credit for STSCI 2100": {
    foldedInto: "cals|CEEB's AP Exams|Statistics (excluding BE/EnvE)",
  },
  "bullet:College of Arts and Sciences|Physics C - Mechanics: 5 grade will receive credit for PHYS 2207": award("ap-physics-c-mechanics", {
    to: "cas",
    credits: 4, // the AP table: "PHYS 2207 (for 4 credits)"
    limits: [{ ...PHYSICS_MAJORS, page: "catalog" }], // the AP table's advice for physics majors
  }),
  "bullet:Duffield College of Engineering|Chemistry: 5 grade will receive credit for CHEM 2090/CHEM 2091": skip("Engineering's own table covers it"),
  "bullet:Duffield College of Engineering|Mathematics - Calculus BC: 5 grade will receive credit for MATH 1910": skip("Engineering's own table covers it"),
  "bullet:Duffield College of Engineering|Physics C - Mechanics: 5 grade will receive credit for PHYS 1112": skip("Engineering's own table covers it"),
  "bullet:Dyson School of Applied Economics and Management|Students should refer to the Dyson website for credit and placement information.": skip(
    "the Dyson School isn't a college this planner covers",
  ),
  "bullet:Nolan School of Hotel Administration|AP Microeconomics: A score of 5 will fulfill HADM 1410": skip("the Nolan School isn't a college this planner covers"),
  "bullet:Nolan School of Hotel Administration|AP English Language & Composition or AP English Literature and Composition: A score of 5 will fulfill the First-Year Writing Seminar. A score of 4 will fulfill Additional Distribution credit.":
    skip("the Nolan School isn't a college this planner covers"),
  "bullet:Nolan School of Hotel Administration|AP Statistics: Not eligible for transfer.": skip("the Nolan School isn't a college this planner covers"),
  "bullet:School of Industrial and Labor Relations|Statistics: 4 or 5 grade will receive credit for ILRST 2100": skip("the ILR School isn't a college this planner covers"),

  // ── Arts & Sciences (its English table) ──
  "cas|CEEB'S AP Exams|English Literature and Composition OR English Language and Composition": award(
    ["ap-english-literature-and-composition", "ap-english-language-and-composition"],
    { note: CAS_FWS },
  ),
  "cas|International Baccalaureate (IB)|English Literature A (HL) OR English Language and Literature A (HL)": award(
    ["ib-english-literature-hl", "ib-english-language-and-literature-hl"],
    { note: CAS_FWS },
  ),
  "cas|GCE A-Level|English Literature": award("alevel-english-literature", { note: CAS_FWS }),
  "cas|Cambridge Pre-U Exam|English": award("intl-cambridge-pre-u-english", { note: CAS_FWS }),

  // ── CALS-specific table ──
  "cals|CEEB's AP Exams|English literature and composition OR English language and composition": award(
    ["ap-english-literature-and-composition", "ap-english-language-and-composition"],
    CALS_WRITING_AWARD,
  ),
  "cals|CEEB's AP Exams|Statistics (excluding BE/EnvE)": award("ap-statistics", CALS_STATS),
  "cals|International Baccalaureate (IB)|English Literature A (HL) OR English Language and Literature A (HL)": award(
    ["ib-english-literature-hl", "ib-english-language-and-literature-hl"],
    CALS_WRITING_AWARD,
  ),
  "cals|GCE A-Level|English Literature": award("alevel-english-literature", CALS_WRITING_AWARD),
  "cals|GCE A-Level|Statistics (excluding BE/EnvE)": award("alevel-statistics", CALS_STATS),
  "cals|Cambridge Pre-U Exam|English": award("intl-cambridge-pre-u-english", CALS_WRITING_AWARD),

  // ── Engineering's own table ──
  [ENG("Math", "CEEB AP BC Exam|5")]: award("ap-calculus-bc"),
  [ENG("Math", "GCE A-Level Math or Pure Math exams only if the exams were taken in Singapore|A*, A, B, or C")]: award("alevel-mathematics-singapore"),
  [ENG("Physics", "Mechanics portion of CEEB AP C exam|5")]: award("ap-physics-c-mechanics", { limits: [ENG_PHYS_1110] }),
  [ENG("Physics", "GCE A-Level Exam|A*, A or B")]: award("alevel-physics", {
    limits: [ENG_PHYS_1110],
    note: say("With AP or CASE credit for MATH 1910, you also get PHYS 2213 (7 credits in all).", "A*, A, or B and AP or Cornell Advanced Standing Exam (CASE) credit for MATH 1910", "engineering"),
  }),
  [ENG("Physics", "IB Higher Level Exam|6 or 7")]: award("ib-physics-hl", { limits: [ENG_PHYS_1110] }),
  [ENG("Physics", "Electricity and magnetism portion of CEEB AP C exam|5")]: award("ap-physics-c-electricity-and-magnetism"),
  [ENG("Physics", "GCE A-Level Exam|A*, A, or B and AP or Cornell Advanced Standing Exam (CASE) credit for MATH 1910")]: {
    foldedInto: ENG("Physics", "GCE A-Level Exam|A*, A or B"),
  },
  [ENG("Chemistry", "CEEB AP Exam|5")]: award("ap-chemistry", { note: ENG_CHEME }),
  [ENG("Chemistry", "GCE A-Level Exam|B")]: award("alevel-chemistry", { note: ENG_CHEME }),
  [ENG("Chemistry", "IB Higher Level Exam|6 or 7")]: award("ib-chemistry-hl", { note: ENG_CHEME }),
  [ENG("Chemistry", "GCE A-Level Exam|A* or A")]: award("alevel-chemistry"),
  [ENG("Computer Science", "CEEB AP A Exam|5")]: award("ap-computer-science-a"),
  [ENG("Computer Science", "IB Higher Level Exam|6 or 7")]: award("ib-computer-science-hl"),
  [ENG("Biology", "CEEB AP Exam|4")]: award("ap-biology", {
    limits: [
      say(
        "Biomedical Engineering majors need a 5, not a 4, to place out of BIOMG 1350.",
        "For Biomedical Engineering majors, a score of 5 on the Biology AP exam is required to place out of BIOMG 1350",
        "engineering",
      ),
    ],
  }),
  [ENG("Biology", "IB Higher Level Exam|6")]: award("ib-biology-hl"),
  [ENG("Biology", "CEEB AP Exam|5")]: award("ap-biology", {
    note: say(
      "Biomedical Engineering majors: a 5 also places you out of BIOMG 1350.",
      "For Biomedical Engineering majors, a score of 5 on the Biology AP exam is required to place out of BIOMG 1350",
      "engineering",
    ),
  }),
  [ENG("Biology", "GCE A-Level Exam|A or B")]: award("alevel-biology"),
  [ENG("Biology", "IB Higher Level Exam|7")]: award("ib-biology-hl"),
  [ENG("Biology", "Cambridge Pre-University Principal Subject Exam|M3 or higher")]: award("intl-cambridge-pre-u-biology"),
  [ENG("English Language and Literature", "CEEB AP English Language and Composition Exam*|5")]: award("ap-english-language-and-composition"),
  [ENG("English Language and Literature", "CEEB AP English Literature and Composition Exam*|5")]: award("ap-english-literature-and-composition"),
  [ENG("English Language and Literature", "GCE A-Level Exam*|A")]: award(["alevel-english-literature", "alevel-english-language"]),
  [ENG("English Language and Literature", "IB Higher Level Exam*|7")]: award(["ib-english-literature-hl", "ib-english-language-and-literature-hl"]),
  [ENG("English Language and Literature", "Cambridge Pre-University Principal Subject Exam*|D1, D2, D3")]: award("intl-cambridge-pre-u-english"),
  [ENG("English Language and Literature", "CEEB AP English Language and Composition Exam|4")]: award("ap-english-language-and-composition"),
  // The IB and A-Level rows at 6 / B list ENGL 1101A and ENGL 1102A without saying which
  // exam gets which; they follow the AP rows (language → 1101A, literature → 1102A).
  [ENG("English Language and Literature", "All IB Higher Level English Exams|6")]: award("ib-english-language-and-literature-hl", { note: ENG_MAY_POST("All IB Higher Level English Exams") }),
  [ENG("English Language and Literature", "GCE A-level English Exam|B")]: award("alevel-english-language", { note: ENG_MAY_POST("GCE A-level English Exam") }),
  [ENG("English Language and Literature", "CEEB AP English Literature and Composition Exam|4")]: award("ap-english-literature-and-composition"),
  [ENG("English Language and Literature", "All IB Higher Level English Exams|6#2")]: award("ib-english-literature-hl", { note: ENG_MAY_POST("All IB Higher Level English Exams") }),
  [ENG("English Language and Literature", "GCE A-level English Exam|B#2")]: award("alevel-english-literature", { note: ENG_MAY_POST("GCE A-level English Exam") }),
  [ENG("Foreign Language", "CEEB AP French Language Exam|4 or 5")]: award("ap-french-language-and-culture"),
  [ENG("Foreign Language", "CEEB AP Italian Language and Culture Exam|4 or 5")]: award("ap-italian-language-and-culture"),
  [ENG("Foreign Language", "CEEB AP Spanish Language Exam|4 or 5")]: award("ap-spanish-language-and-culture"),
  [ENG("Foreign Literature", "CEEB AP French Literature Exam|4 or 5")]: award("ap-french-literature"),
  [ENG("Foreign Literature", "French Baccalauréat Francais écrit Exam|14/20 or higher")]: award("intl-french-baccalaureate-francais-ecrit", {
    scores: ["14", "15"], // 16 and up is the next row
  }),
  [ENG("Foreign Literature", "French Baccalauréat Francais écrit Exam|16/20 or higher")]: award("intl-french-baccalaureate-francais-ecrit"),
  [ENG("Foreign Literature", "CEEB AP Spanish Literature Exam|4 or 5")]: award("ap-spanish-literature-and-culture"),
  [ENG("Economics", "CEEB AP Exam (Micro)|5")]: award("ap-microeconomics"),
  [ENG("Economics", "CEEB AP Exam (Macro)|5")]: award("ap-macroeconomics"),
  [ENG("Economics", "IB Higher Level Exam|7")]: award("ib-economics-hl"),
  [ENG("Economics", "GCE A-Level Exam|A* or A")]: award("alevel-economics"),
  [ENG("Economics", "Cambridge Pre-University Principal Subject Exam|D1, D2, D3")]: award("intl-cambridge-pre-u-economics"),
  [ENG("Philosophy", "French Baccalauréat Philosophie Exam|14/20 or higher")]: award("intl-french-baccalaureate-philosophie"),
  [ENG("Philosophy", "GCE A-Level Exam|A*, A, or B")]: award("alevel-philosophy", { credits: 0, note: say("Subject to department review.", "Subject to Department Review") }),
  [ENG("Psychology", "CEEB AP Exam|4 or 5")]: award("ap-psychology"),
};

// ─── Build ───────────────────────────────────────────────────────────────────

export type Loaded = { rows: RawRow[]; byKey: Map<string, RawRow>; pageText: Record<PageKey, string> };

export function loadSnapshots(dir = SNAPSHOT_DIR): Loaded {
  const rows: RawRow[] = [];
  const pageText = {} as Record<PageKey, string>;
  for (const page of Object.keys(PAGES) as PageKey[]) {
    const file = resolve(dir, PAGES[page].file);
    if (!existsSync(file)) throw new Error(`missing snapshot ${PAGES[page].file}`);
    const parsed = parsePage(readFileSync(file, "utf8"));
    pageText[page] = parsed.text;
    rows.push(...rowsOf(page, parsed));
  }
  return { rows, byKey: new Map(rows.map((r) => [r.key, r])), pageText };
}

const ENG_FWS_LIMIT = say(
  "Only one exam can earn the First-Year Writing Seminar; credit from a second counts toward Liberal Studies (LA or ALC) instead.",
  ["students can only earn credit for one First-Year Writing Seminar (FWS) from the above exam options", "can be applied toward the Literature and the Arts or the Arts, Literature, and Culture category"],
  "engineering",
);

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** The title Engineering's exam-credit FWS course carries in a match pool.
 *  Engineering's FWS seats test `title startsWith "FWS:"` (real seminars are
 *  titled "FWS: …"), and a synthetic credit course has no catalog title. */
export const ENG_FWS_TITLE = "FWS: First-Year Writing Seminar (exam credit)";

/**
 * The liberal studies categories an Engineering "Degree Requirement Fulfilled"
 * cell names: the base codes it prints in parentheses, in order, without repeats
 * ("Liberal Studies Distribution Requirement in the Literature and the Arts (LA)
 * or Arts, Literature, and Culture (ALC) category" → ["LA", "ALC"]). null when
 * the cell isn't a liberal studies requirement; [] when it is but prints no code
 * (buildTables reports that).
 */
export function liberalStudiesCategories(requirement: string): string[] | null {
  if (!/\bLiberal Studies\b/i.test(requirement)) return null;
  const out: string[] = [];
  for (const m of requirement.matchAll(/\(([A-Z]{2,4})\)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Engineering's "Degree Requirement Fulfilled" cell, when it says more than the
 *  course; when that cell says the course fills the First-Year Writing
 *  Seminar, the FWS title for the granted course; and the liberal studies
 *  categories it names (liberalStudiesCategories). */
function engineeringExtras(
  row: RawRow,
  courses: string[],
): { limits: Said[]; note: Said | null; courseTitles: Record<string, string> | null; liberalStudies: string[] | null } {
  const limits: Said[] = [];
  let note: Said | null = null;
  const req = row.requirement ?? "";
  const liberalStudies = liberalStudiesCategories(req);
  const courseTitles = /^First-Year Writing Seminar\b/i.test(req) && courses.length === 1 ? { [courses[0]]: ENG_FWS_TITLE } : null;
  if (/^TBD\b/.test(req)) {
    limits.push(say("Engineering hasn't set which requirement this fills: check with Engineering Advising and your major department.", req));
  } else if (req && !/^Subject to Department Review$/i.test(req) && !sameSet(courseCodes(req), courses)) {
    note = say(`Counts in Engineering as: ${req.replace(/\.$/, "")}.`, req);
  }
  if (/\*$/.test(row.cells[0] ?? "")) limits.push(ENG_FWS_LIMIT);
  return { limits, note, courseTitles, liberalStudies };
}

const TABLE_OF: Record<PageKey, "university" | "cas" | "cals" | "engineering" | null> = {
  catalog: "university",
  cas: "cas",
  cals: "cals",
  "cals-policy": null,
  engineering: "engineering",
};

/** Builds ExamTables from loaded snapshots, or throws listing every problem found. */
export function buildTables(
  loaded: Loaded,
  rows: Record<string, RowSpec> = ROWS,
  exams: ExamDef[] = EXAMS,
  report: { raised: string[] } = { raised: [] },
): ExamTables {
  const errors: string[] = [];
  const examById = new Map(exams.map((e) => [e.id, e]));
  const usedExams = new Set<string>();
  const awards: Record<"university" | "cas" | "cals" | "engineering", ExamAward[]> = { university: [], cas: [], cals: [], engineering: [] };

  const evidence = (s: Said, row: RawRow, where: string) => {
    const hay = (s.page ? loaded.pageText[s.page] : row.text).toLowerCase();
    for (const f of [s.from].flat()) if (!hay.includes(normalize(f).toLowerCase())) errors.push(`${where}: evidence not on the ${s.page ?? "row"}: "${f}"`);
  };

  for (const key of Object.keys(rows)) if (!loaded.byKey.has(key)) errors.push(`ROWS entry matches no row on the pages: ${key}`);
  for (const row of loaded.rows) {
    const spec = rows[row.key];
    if (!spec) {
      errors.push(`row has no ROWS entry: ${row.key}  (${row.text.slice(0, 120)})`);
      continue;
    }
    if ("skip" in spec) continue;
    if ("foldedInto" in spec) {
      if (!rows[spec.foldedInto] || !("award" in rows[spec.foldedInto])) errors.push(`${row.key}: foldedInto names no award row: ${spec.foldedInto}`);
      continue;
    }
    if ("noCredit" in spec) {
      for (const id of spec.noCredit) {
        if (!examById.has(id)) errors.push(`${row.key}: unknown exam ${id}`);
        usedExams.add(id);
      }
      continue;
    }
    for (const a of [spec.award].flat()) {
      const table = a.to ?? TABLE_OF[row.page];
      if (!table) {
        errors.push(`${row.key}: no table for page ${row.page}`);
        continue;
      }
      if (row.page === "catalog" && row.table.startsWith("bullet:") && !a.to) errors.push(`${row.key}: a bullet award needs "to"`);
      const defs = a.exams.map((id) => examById.get(id));
      if (defs.some((d) => !d)) {
        errors.push(`${row.key}: unknown exam in ${a.exams.join(", ")}`);
        continue;
      }
      const scale = defs[0]!.scale;
      if (defs.some((d) => d!.scale.join() !== scale.join())) errors.push(`${row.key}: exams with different scales share one award`);
      const scores = a.scores ?? parseScores(row.score, scale);
      if (!scores.length) errors.push(`${row.key}: no scores (printed "${row.score}")`);
      for (const s of scores) if (!scale.includes(s)) errors.push(`${row.key}: score ${s} is not on the scale`);
      const credits = a.credits ?? parseCredits(row.credit);
      if (credits == null) {
        errors.push(`${row.key}: credits not printed as a number ("${row.credit}"); give credits`);
        continue;
      }
      const evidenceRow = a.coursesFrom ? loaded.byKey.get(a.coursesFrom) : row;
      if (!evidenceRow) {
        errors.push(`${row.key}: coursesFrom names no row: ${a.coursesFrom}`);
        continue;
      }
      const printed = courseCodes(evidenceRow.text);
      const courses = a.courses ?? courseCodes(row.courseText);
      for (const c of courses) if (!printed.includes(c)) errors.push(`${row.key}: ${c} is not printed in ${a.coursesFrom ?? "the row"}`);
      const courseOptions = a.courseOptions === "each" ? courses.map((c) => [c]) : a.courseOptions;
      if (courseOptions) {
        const union = [...new Set(courseOptions.flat())];
        if (courseOptions.length < 2 || courseOptions.some((o) => !o.length)) errors.push(`${row.key}: courseOptions needs two or more non-empty sets`);
        if (!sameSet(union, courses)) errors.push(`${row.key}: courseOptions union ${union.join(",")} ≠ courses ${courses.join(",")}`);
        if (!/\bor\b|placement out of/i.test(row.courseText)) errors.push(`${row.key}: courseOptions but the row prints no "or" / "placement out of"`);
      }
      if (a.courseCredits && !a.courseCreditsFrom) errors.push(`${row.key}: courseCredits needs courseCreditsFrom (the phrase that states them)`);
      if (a.courseCreditsFrom && !row.text.toLowerCase().includes(normalize(a.courseCreditsFrom).toLowerCase()))
        errors.push(`${row.key}: courseCreditsFrom not in the row: "${a.courseCreditsFrom}"`);
      const stated = a.courseCredits ?? (row.page === "engineering" ? inlineCourseCredits(row.courseText) ?? undefined : undefined);
      let courseCredits = stated;
      if (!courseCredits && !a.placementOnly) {
        const rule = lectureLabCredits(courseOptions ?? [courses], credits);
        if (rule.conflict) errors.push(`${row.key}: lecture + lab rule: ${rule.conflict}; give courseCredits`);
        courseCredits = rule.credits ?? undefined;
      }
      if (courseCredits) for (const p of courseCreditsProblems(courseCredits, courses, courseOptions, credits)) errors.push(`${row.key}: ${p}`);
      const extra = row.page === "engineering" ? engineeringExtras(row, courses) : { limits: [], note: null, courseTitles: null, liberalStudies: null };
      if (extra.liberalStudies && !extra.liberalStudies.length) errors.push(`${row.key}: a liberal studies requirement with no category code in parentheses`);
      const limits = [...extra.limits, ...(a.limits ?? [])];
      const notes = [extra.note, a.note].filter((n): n is Said => n != null);
      for (const l of limits) evidence(l, row, `${row.key} limit`);
      for (const n of notes) evidence(n, row, `${row.key} note`);
      for (const id of a.exams) {
        usedExams.add(id);
        const out: ExamAward = { exam: id, scores: [...scores], courses: [...courses], credits };
        if (courseOptions) out.courseOptions = courseOptions.map((o) => [...o]);
        if (courseCredits) out.courseCredits = { ...courseCredits };
        if (extra.courseTitles) out.courseTitles = { ...extra.courseTitles };
        if (a.placementOnly) out.placementOnly = true;
        if (limits.length) out.limits = limits.map((l) => l.text);
        if (notes.length) out.note = notes.map((n) => n.text).join(" ");
        if (extra.liberalStudies?.length) out.liberalStudies = [...extra.liberalStudies];
        awards[table].push(out);
      }
    }
  }
  for (const e of exams) if (!usedExams.has(e.id)) errors.push(`exam ${e.id} is on no row of any table`);
  const collegeLimits = CALS_COLLEGE_LIMITS;
  for (const l of collegeLimits) {
    const hay = loaded.pageText[l.page ?? "cals-policy"].toLowerCase();
    for (const f of [l.from].flat()) if (!hay.includes(normalize(f).toLowerCase())) errors.push(`CALS college limit: evidence not on the page: "${f}"`);
  }
  report.raised = raiseTopGrades(awards, examById);
  for (const [table, list] of Object.entries(awards)) {
    const seen = new Map<string, string>();
    for (const a of list)
      for (const s of a.scores) {
        const k = `${a.exam}@${s}`;
        if (seen.has(k)) errors.push(`${table}: ${a.exam} has two awards for score ${s}`);
        seen.set(k, table);
      }
  }
  if (errors.length) throw new Error(`build-credit-tables: ${errors.length} problem(s)\n  - ${errors.join("\n  - ")}`);

  const source = (page: PageKey) => ({ url: PAGES[page].url, fetched: SNAPSHOT_DATE });
  const replaces = (list: ExamAward[]) => [...new Set(list.map((a) => a.exam))].sort();
  const university: CollegeExamTable = { college: "university", year: TABLE_YEAR, source: source("catalog"), awards: awards.university };
  const cas: CollegeExamTable = { college: "cas", year: TABLE_YEAR, source: source("cas"), awards: awards.cas, replaces: replaces(awards.cas) };
  const cals: CollegeExamTable = {
    college: "cals",
    year: TABLE_YEAR,
    source: source("cals"),
    awards: awards.cals,
    replaces: replaces(awards.cals),
    collegeLimits: collegeLimits.map((l) => l.text),
  };
  const engineering: CollegeExamTable = { college: "engineering", year: TABLE_YEAR, source: source("engineering"), awards: awards.engineering };
  return { year: TABLE_YEAR, exams, university, overrides: { cas, cals }, engineering };
}

/**
 * Rule: a higher grade never earns less. Where an exam's highest awarded grade in a
 * table is below the top of its scale and the grades above it have no award of their
 * own there (A-Level Biology "A or B" without A*; Pre-U Chemistry "D2" without D1),
 * those grades join that award. Mutates the awards; returns what it raised.
 */
export function raiseTopGrades(awards: Record<string, ExamAward[]>, examById: Map<string, ExamDef>): string[] {
  const raised: string[] = [];
  for (const [table, list] of Object.entries(awards)) {
    const byExam = new Map<string, ExamAward[]>();
    for (const a of list) byExam.set(a.exam, [...(byExam.get(a.exam) ?? []), a]);
    for (const [exam, group] of byExam) {
      const scale = examById.get(exam)?.scale ?? [];
      let top: ExamAward | null = null;
      let topIndex = -1;
      for (const a of group)
        for (const s of a.scores) {
          const i = scale.indexOf(s);
          if (i > topIndex) [top, topIndex] = [a, i];
        }
      if (!top || topIndex === scale.length - 1) continue;
      const above = scale.slice(topIndex + 1);
      top.scores.push(...above);
      raised.push(`${table}: ${exam} ${top.scores.slice(0, -above.length).join(",")} + ${above.join(",")}`);
    }
  }
  return raised;
}

export function renderJson(tables: ExamTables): string {
  return JSON.stringify(tables, null, 2) + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  const report = { raised: [] as string[] };
  const tables = buildTables(loadSnapshots(), ROWS, EXAMS, report);
  const next = renderJson(tables);
  const prev = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8").replace(/\r\n/g, "\n") : null;
  console.log(`\n── build-credit-tables (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   exams ${tables.exams.length}`);
  console.log(`   university awards ${tables.university.awards.length}`);
  console.log(`   cas awards ${tables.overrides.cas?.awards.length ?? 0} (replaces ${tables.overrides.cas?.replaces?.length ?? 0})`);
  console.log(`   cals awards ${tables.overrides.cals?.awards.length ?? 0} (replaces ${tables.overrides.cals?.replaces?.length ?? 0})`);
  console.log(`   engineering awards ${tables.engineering.awards.length}`);
  const withOptions = [tables.university, tables.overrides.cas, tables.overrides.cals, tables.engineering].flatMap((t) => t?.awards ?? []).filter((x) => x.courseOptions).length;
  console.log(`   awards with courseOptions ${withOptions}`);
  console.log(`   engineering awards with liberalStudies ${tables.engineering.awards.filter((x) => x.liberalStudies).length}`);
  for (const r of report.raised) console.log(`   top grades raised (a higher grade never earns less): ${r}`);
  if (check) {
    if (prev !== next) {
      console.error(`\nSTALE: ${TABLE_YEAR}.json differs from what the snapshots produce. Re-run without --check.`);
      process.exit(1);
    }
    console.log(`\n${TABLE_YEAR}.json is current.`);
    return;
  }
  if (prev === next) console.log("\nNo change.");
  else {
    writeFileSync(OUT_FILE, next);
    console.log(`\nWrote ${TABLE_YEAR}.json.`);
  }
}

if (require.main === module) {
  if (process.argv.includes("--dump")) {
    for (const r of loadSnapshots().rows) console.log(`${r.key}  ::  score=[${r.score}] credit=[${r.credit ?? ""}] courses=${courseCodes(r.courseText).join(",")}`);
  } else main();
}
