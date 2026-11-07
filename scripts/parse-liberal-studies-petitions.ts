// scripts/parse-liberal-studies-petitions.ts
// Normalizes Engineering's "Currently Approved Liberal Studies Petitions List"
// (spec 037 D3) into seed-data/sources/liberal-studies-petitions-<date>.json, the
// committed source build-liberal-studies.ts reads.
//
// Input: the PDF's table rows as extracted by pdfplumber, a JSON array of rows
//   [prefix, number, title, college, categories, credits, originalReview,
//    latestReview, notes], the first row being the PDF's header. The PDF itself
//   (and its extraction) stays outside the repo; this script reads only the rows.
//
// Each row keeps its printed cells and gains:
//   ids           dash-form course ids; "CEE 4560/61/62" names three
//                 (CEE-4560, CEE-4561, CEE-4562)
//   categories    the printed category cell split on commas ("SBA, SSC" →
//                 ["SBA", "SSC"]); "SCD" stays as printed (no college suffix). A
//                 "See Notes Column" row takes its categories from the note
//                 ("Approved in KCM, ETM category if taken Summer 2024 and prior")
//   takenThrough  on those rows, the last term the approval covers ("SU24");
//                 later terms use the course's roster tags
//   crossListed   the cross-listings the note names ("Also HIST 2005 and ENGL 2999
//                 (crosslisted)" → HIST-2005, ENGL-2999); the approval covers them
//                 too, except where the note limits it to the printed course ("only
//                 allowed for liberal studies credit when taken as PMA 1200")
//
// A row that doesn't parse stops the script with every problem listed.
//
// Offline: reads local files only.
// Run (from scripts/):
//   npx tsx parse-liberal-studies-petitions.ts --rows <rows.json> --revised 10/23/26
//   (--revised is the PDF's "Revised" date as printed; add --out <file> to write
//   somewhere other than the dated source file)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PETITIONS_URL = "https://liberal-studies.engineering.cornell.edu/approved";
export const PETITIONS_TITLE = "Currently Approved Liberal Studies Petitions List";
export const RETRIEVED = "2026-11-07";

/** Every category code the petitions list may print (base codes, no college suffix). */
export const KNOWN_CATEGORIES = ["CA", "LA", "LAD", "ALC", "SCD", "HA", "HST", "KCM", "ETM", "SBA", "SSC", "GLC", "FL", "CE", "D"];

export const HEADER = [
  "Course Prefix",
  "Course Number",
  "Course Title",
  "College",
  "Lib. Studies Category",
  "Credits",
  "Original Review Date",
  "Latest Review Date",
  "Notes (e.g., cross-listed equivalents, former course #'s)",
];

export type PetitionRow = {
  prefix: string;
  number: string;
  title: string;
  college: string;
  category: string;
  credits: string;
  originalReview: string;
  latestReview: string;
  notes: string;
  ids: string[];
  categories: string[];
  takenThrough?: string;
  /** Cross-listed ids the note names ("Also GOVT 3303 (crosslisted)"); the row's
   *  approval covers them too. */
  crossListed?: string[];
};

export type PetitionsSource = {
  title: string;
  url: string;
  /** The PDF's "Revised" date as printed ("10/23/26") and as an ISO date. */
  revisedAsPrinted: string;
  revised: string;
  retrieved: string;
  extractedWith: string;
  columns: string[];
  rows: PetitionRow[];
};

/** One line of plain text: whitespace (incl. no-break spaces) collapsed, trimmed. */
export function clean(s: unknown): string {
  return String(s ?? "").replace(/[\s ]+/g, " ").trim();
}

/**
 * The course numbers a printed number cell names. "4560" → ["4560"];
 * "4560/61/62" → ["4560", "4561", "4562"] (each later part replaces the trailing
 * digits of the first). null when the cell isn't one of those shapes.
 */
export function expandNumbers(cell: string): string[] | null {
  const parts = clean(cell).split("/").map((p) => p.trim());
  if (!/^\d{4}$/.test(parts[0])) return null;
  const out = [parts[0]];
  for (const p of parts.slice(1)) {
    if (!/^\d{1,4}$/.test(p)) return null;
    out.push(parts[0].slice(0, 4 - p.length) + p);
  }
  return out;
}

/** "SBA, SSC" / "CA,LA,SBA,KCM" → base codes, in order, without repeats. */
export function splitCategories(cell: string): string[] {
  const out: string[] = [];
  for (const c of clean(cell).split(",").map((x) => x.trim()).filter(Boolean)) if (!out.includes(c)) out.push(c);
  return out;
}

const SEASON: Record<string, string> = { spring: "SP", summer: "SU", fall: "FA", winter: "WI" };

/**
 * A "See Notes Column" row's note: "Approved in <X[, Y]> category if taken
 * <Season> <Year> and prior" → the categories and the last term ("SU24"). null
 * when the note doesn't say that.
 */
export function notesApproval(note: string): { categories: string[]; takenThrough: string } | null {
  const m = /Approved in ([A-Z]+(?:\s*,\s*[A-Z]+)*) categor(?:y|ies) if taken (Spring|Summer|Fall|Winter) (\d{4}) and prior/i.exec(clean(note));
  if (!m) return null;
  return { categories: splitCategories(m[1]), takenThrough: `${SEASON[m[2].toLowerCase()]}${m[3].slice(2)}` };
}

/**
 * The cross-listings a note names: "Also HIST 2005 and ENGL 2999 (crosslisted)",
 * "Also FREN 2350, ITAL 2350, and MEDVL 2350 (crosslisted)", "Also ECE 2750, INFO
 * 2750, STS 2751 (crosslisted)" → dash-form ids. The approval covers each of them
 * as it covers the printed course. A note that limits the approval to the printed
 * course ("…, however, only allowed for liberal studies credit when taken as PMA
 * 1200") names none. [] when the note names no cross-listing; null when it says
 * "crosslisted" in a shape this doesn't read.
 */
export function crossListings(note: string): string[] | null {
  const text = clean(note);
  if (!/crosslisted/i.test(text)) return [];
  const m = /\bAlso ([A-Z]{2,8} \d{4}(?:(?:, and |, | and )[A-Z]{2,8} \d{4})*) \(crosslisted\)/.exec(text);
  if (!m) return null;
  if (/only allowed for liberal studies credit when taken as/i.test(text.slice(m.index + m[0].length))) return [];
  return m[1].split(/, and |, | and /).map((code) => code.replace(" ", "-"));
}

/** "10/23/26" → "2026-10-23". */
export function isoDate(printed: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(clean(printed));
  if (!m) throw new Error(`not a date: "${printed}"`);
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** One printed row → a PetitionRow, or the reasons it doesn't parse. */
export function normalizeRow(cells: unknown[]): { row: PetitionRow } | { problems: string[] } {
  const problems: string[] = [];
  if (cells.length !== HEADER.length) problems.push(`${cells.length} cells, expected ${HEADER.length}`);
  const [prefix, number, title, college, category, credits, originalReview, latestReview, notes] = HEADER.map((_, i) => clean(cells[i]));
  const label = `${prefix} ${number}`;
  if (!/^[A-Z]{2,8}$/.test(prefix)) problems.push(`${label}: prefix "${prefix}" is not a subject code`);
  const numbers = expandNumbers(number);
  if (!numbers) problems.push(`${label}: number "${number}" is not a course number`);
  let categories: string[];
  let takenThrough: string | undefined;
  if (/^See Notes Column$/i.test(category)) {
    const approval = notesApproval(notes);
    if (!approval) problems.push(`${label}: "See Notes Column" but the note names no category: "${notes}"`);
    categories = approval?.categories ?? [];
    takenThrough = approval?.takenThrough;
  } else {
    categories = splitCategories(category);
  }
  if (!categories.length) problems.push(`${label}: no category`);
  for (const c of categories) if (!KNOWN_CATEGORIES.includes(c)) problems.push(`${label}: unknown category "${c}"`);
  if (!/^\d+(\.\d+)?(-\d+(\.\d+)?)?$/.test(credits)) problems.push(`${label}: credits "${credits}" is not a number or range`);
  const crossListed = crossListings(notes);
  if (!crossListed) problems.push(`${label}: the note says "crosslisted" but names no course this reads: "${notes}"`);
  if (problems.length) return { problems };
  const row: PetitionRow = {
    prefix,
    number,
    title,
    college,
    category,
    credits,
    originalReview,
    latestReview,
    notes,
    ids: numbers!.map((n) => `${prefix}-${n}`),
    categories,
  };
  if (takenThrough) row.takenThrough = takenThrough;
  const own = new Set(row.ids);
  const extra = crossListed!.filter((id) => !own.has(id));
  if (extra.length) row.crossListed = extra;
  return { row };
}

/** The extracted table (header first) → the source document, or throws listing every row that doesn't parse. */
export function parsePetitions(table: unknown[][], revisedAsPrinted: string): PetitionsSource {
  const [header, ...body] = table;
  const problems: string[] = [];
  if (!header || header.map(clean).join("|") !== HEADER.join("|")) problems.push(`header row differs from the expected columns: ${JSON.stringify(header)}`);
  const rows: PetitionRow[] = [];
  for (const cells of body) {
    if (!Array.isArray(cells) || cells.every((c) => !clean(c))) continue;
    const r = normalizeRow(cells);
    if ("problems" in r) problems.push(...r.problems);
    else rows.push(r.row);
  }
  if (problems.length) throw new Error(`parse-liberal-studies-petitions: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`);
  return {
    title: PETITIONS_TITLE,
    url: PETITIONS_URL,
    revisedAsPrinted: clean(revisedAsPrinted),
    revised: isoDate(revisedAsPrinted),
    retrieved: RETRIEVED,
    extractedWith: "pdfplumber table extraction of the PDF",
    columns: [...HEADER],
    rows,
  };
}

export const SOURCE_FILE = resolve(__dirname, "seed-data", "sources", `liberal-studies-petitions-${RETRIEVED}.json`);

function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const rowsPath = arg("--rows");
  const revised = arg("--revised");
  if (!rowsPath || !revised) {
    console.error("usage: npx tsx parse-liberal-studies-petitions.ts --rows <rows.json> --revised <MM/DD/YY> [--out <file>]");
    process.exit(2);
  }
  const out = resolve(arg("--out") ?? SOURCE_FILE);
  const src = parsePetitions(JSON.parse(readFileSync(resolve(rowsPath), "utf8")), revised);
  writeFileSync(out, JSON.stringify(src, null, 2) + "\n");
  const ids = src.rows.flatMap((r) => r.ids);
  console.log(`\n── parse-liberal-studies-petitions ──`);
  console.log(`   rows ${src.rows.length}`);
  console.log(`   ids ${ids.length} (${new Set(ids).size} distinct)`);
  console.log(`   rows with several ids: ${src.rows.filter((r) => r.ids.length > 1).map((r) => `${r.prefix} ${r.number}`).join(", ") || "none"}`);
  console.log(`   "See Notes Column" rows (takenThrough): ${src.rows.filter((r) => r.takenThrough).length}`);
  console.log(`   rows naming cross-listings: ${src.rows.filter((r) => r.crossListed).length} (${src.rows.flatMap((r) => r.crossListed ?? []).length} ids)`);
  console.log(`   revised ${src.revised}`);
  console.log(`\nWrote ${out}.`);
}

if (require.main === module) main();
