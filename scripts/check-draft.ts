// scripts/check-draft.ts
// Mechanical check of one authored requirement draft (spec 019 Phase 4, D4/D12):
// schema, structural lint, verbatim quotes against the frozen page snapshot, and
// catalog satisfiability against the offline dump.
//
//   npx tsx check-draft.ts <draft.json> [--snapshot <dir>] [--dump <path> | --no-catalog] [--json <out.json>]
//
// --snapshot defaults to provenanceDir(draft.programId)/snapshot (page.html,
// page.txt, meta.json); --dump defaults to DEFAULT_DUMP. --json writes the
// CheckReport.
//
// ERRORS (code):
//   schema           the draft fails DraftSchema (no further checks run)
//   lint             lintLayer() on the layer
//   id               draft.programId differs from layer.id
//   snapshot         the draft names another snapshot (textSha256 or url);
//                    page.txt no longer matches meta.json's textSha256;
//                    page.html is missing or no longer matches htmlSha256; or
//                    page.txt is not what the snapshotter extracts from
//                    page.html (so page.txt + meta.json cannot be rewritten
//                    together without page.html giving it away)
//   quote-missing    a top-level row has no quote fragments
//   quote-key        a quotes key is not a row unit of the layer
//   quote-not-found  a fragment is not on page.txt word for word (normal form)
//   quote-too-short  a fragment is shorter than QUOTE_MIN_CHARS
//   quote-coverage   a course the row's rules name ("SUBJ NNNN") appears in
//                    none of the row's quotes (anyOf children: their own plus
//                    the parent's), or in no extracted list the row was
//                    expanded from (listRefs, expand-draft.ts)
//   list-ref         listRefs names a list not in extract.json, a key that is
//                    not a row, or extract.json is missing/stale/hand-edited
//   public-text     a label, note, group or name copies a run of the page
//   catalog          a validate-layers error (a rule no catalog course satisfies)
// WARNINGS: validate-layers warnings (catalog), a row citing another page than
// the snapshot (source-url), a number the row encodes that none of its quotes
// states (quote-coverage), and the catalog check skipped (no-catalog).
//
// Exit: 0 no errors, 1 errors, 2 bad usage or unreadable input.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import {
  DEFAULT_DUMP,
  DraftSchema,
  PROVENANCE_FILES,
  QUOTE_MIN_CHARS,
  checkQuote,
  copiedRun,
  normalizeCourseId,
  normalizeQuoteText,
  publicTextFields,
  provenanceDir,
  quotesFor,
  rowUnits,
  type CheckReport,
  type ChildRow,
  type CourseRule,
  type Draft,
  type Finding,
  type Layer,
  type Row,
  type SnapshotMeta,
} from "./layer-authoring";
import { loadVerifiedExtract, type PageExtract } from "./extract-catalog-page";
import { extractPageText, sha256, toLf } from "./snapshot-catalog-page";
import { buildCatalog, loadCatalogDump, validateLayer, type Catalog, type LayerFile } from "./validate-layers";

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_SHOWN = 90;

export function truncate(s: string, max = MAX_SHOWN): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The row key a lint / validate-layers line is about ("<layerId>:<key>…: msg"), if any. */
export function keyOf(layerId: string, line: string): string | undefined {
  const head = `${layerId}:`;
  if (!line.startsWith(head)) return undefined;
  const m = /^[a-z0-9][a-z0-9/-]*/.exec(line.slice(head.length));
  return m ? m[0] : undefined;
}

/** A URL without its #fragment or a trailing slash, for "same page" comparisons. */
export function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

export type PageIndex = { text: string; lines: string[]; starts: number[] };

/** page.txt in quote normal form, with each non-blank line's offset in it. */
export function indexPage(pageText: string): PageIndex {
  const lines = pageText.split("\n").map(normalizeQuoteText).filter(Boolean);
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  return { text: lines.join(" "), lines, starts };
}

function lineAt(index: PageIndex, offset: number): string {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return index.lines[lo] ?? "";
}

/** Where a missing fragment goes wrong: the page line holding the longest
 *  matching start (or, failing that, end) of the fragment. Null when under
 *  QUOTE_MIN_CHARS of it is on the page anywhere. */
export function closestLine(index: PageIndex, fragment: string): { line: string; matched: string } | null {
  const f = normalizeQuoteText(fragment);
  const longest = (probe: (k: number) => string): number => {
    let lo = 0;
    let hi = f.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (index.text.includes(probe(mid))) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const pre = longest((k) => f.slice(0, k));
  const suf = longest((k) => f.slice(f.length - k));
  const best = Math.max(pre, suf);
  if (best < QUOTE_MIN_CHARS) return null;
  const matched = (pre >= suf ? f.slice(0, pre) : f.slice(f.length - suf)).trim();
  // Locate by the trimmed span: a leading space would otherwise land on the previous line's end.
  return { line: lineAt(index, index.text.indexOf(matched)), matched };
}

// ─── Quote coverage ─────────────────────────────────────────────────────────
// A fragment being on the page proves the words exist, not that they back the
// row. These checks tie a row's quotes to what the row encodes: every course
// it names must be cited, and every number it encodes should be.

type AnyRow = Row | ChildRow;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every rule a row tests with: its rule, its categories', its limits'. */
function rulesOf(row: AnyRow): CourseRule[] {
  const out: CourseRule[] = [];
  if ("rule" in row && row.rule) out.push(row.rule);
  if (row.kind === "distribution") for (const c of row.categories) out.push(c.rule);
  if ((row.kind === "pool" || row.kind === "credits") && row.limits) for (const l of row.limits) out.push(l.rule);
  return out;
}

function walkLeaves(rule: CourseRule, visit: (leaf: CourseRule) => void) {
  if ("allOf" in rule) for (const r of rule.allOf) walkLeaves(r, visit);
  else if ("anyOf" in rule) for (const r of rule.anyOf) walkLeaves(r, visit);
  else if ("not" in rule) walkLeaves(rule.not, visit);
  else visit(rule);
}

/** Course ids ("SUBJ-NNNN") a row's rules name, positive or excluded, sorted. */
export function courseIdsOf(row: AnyRow): string[] {
  const ids = new Set<string>();
  for (const r of rulesOf(row)) walkLeaves(r, (leaf) => "course" in leaf && leaf.course.forEach((c) => ids.add(normalizeCourseId(c))));
  return [...ids].sort();
}

/** Does a quote fragment cite this course: "SUBJ NNNN" (or "SUBJ-NNNN"), or a
 *  bare "NNNN" in a fragment that names the subject ("ECON 3110 or 3130")? */
export function fragmentNamesCourse(fragment: string, courseId: string): boolean {
  const f = normalizeQuoteText(fragment);
  const dash = courseId.indexOf("-");
  if (dash <= 0) return f.includes(courseId);
  const subj = escapeRe(courseId.slice(0, dash));
  const num = escapeRe(courseId.slice(dash + 1));
  if (new RegExp(`(?<![A-Za-z0-9])${subj}[\\s-]?${num}(?![A-Za-z0-9])`, "i").test(f)) return true;
  return new RegExp(`(?<![A-Za-z])${subj}(?![A-Za-z])`, "i").test(f) && new RegExp(`(?<![A-Za-z0-9])${num}(?![A-Za-z0-9])`, "i").test(f);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** The numbers a row encodes that its quotes should state: required counts and
 *  credits, category minimums, number-range bounds, limit bounds. Zero is
 *  skipped (it means "none required"); defaults are never listed here. */
export function numbersOf(row: AnyRow): { field: string; value: number }[] {
  const out: { field: string; value: number }[] = [];
  const add = (field: string, value: number | undefined) => {
    if (value != null && value !== 0 && !out.some((x) => x.field === field && x.value === value)) out.push({ field, value });
  };
  if (row.kind === "pool" || row.kind === "distribution") add("requiredCourses", row.requiredCourses);
  if (row.kind === "pool" || row.kind === "credits") add("requiredCredits", row.requiredCredits);
  if (row.kind === "distribution") add("minDistinctCategories", row.minDistinctCategories);
  for (const r of rulesOf(row))
    walkLeaves(r, (leaf) => {
      if ("number" in leaf) {
        add("number.min", leaf.number.min);
        add("number.max", leaf.number.max);
      }
    });
  if ((row.kind === "pool" || row.kind === "credits") && row.limits)
    for (const l of row.limits) {
      add("limit minCourses", l.minCourses);
      add("limit maxCourses", l.maxCourses);
      add("limit minCredits", l.minCredits);
      add("limit maxCredits", l.maxCredits);
    }
  return out;
}

/** How a page may write `n`: its digits; one…twelve as a word; and for a
 *  course-number bound, the level it closes ("4000-level", "4xxx" for 4999,
 *  "2400" for 2499). */
function spellings(n: number): RegExp[] {
  const digits = (k: number) => new RegExp(`(?<![0-9.])${k}(?![0-9])`);
  const out = [digits(n)];
  if (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length) out.push(new RegExp(`\\b${NUMBER_WORDS[n]}\\b`, "i"));
  if (n >= 1000 && n % 1000 === 999) out.push(digits(n - 999));
  if (n >= 100 && n % 100 === 99) out.push(digits(n - 99));
  if (n >= 1000 && (n % 1000 === 0 || n % 1000 === 999)) out.push(new RegExp(`(?<![0-9])${Math.floor(n / 1000)}xxx\\b`, "i"));
  return out;
}

export function fragmentsStateNumber(fragments: string[], n: number): boolean {
  const res = spellings(n);
  return fragments.some((f) => {
    const t = normalizeQuoteText(f);
    return res.some((re) => re.test(t));
  });
}

/** quote-coverage findings for a layer: errors for uncited courses, warnings
 *  for unstated numbers. anyOf parents are covered through their children;
 *  confirm rows encode nothing checkable. */
export function quoteCoverage(
  layer: Layer,
  quotes: Record<string, string[]>,
  /** RowUnit key → course ids cited by the page's own extracted lists (listRefs). */
  listCited: Record<string, Set<string>> = {}
): { errors: Finding[]; warnings: Finding[] } {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  for (const unit of rowUnits(layer)) {
    const row = unit.row;
    if (row.kind === "anyOf" || row.kind === "confirm") continue;
    const fragments = [...(quotes[unit.key] ?? []), ...(unit.parentId ? quotes[unit.parentId] ?? [] : [])];
    if (!fragments.length) continue; // quote-missing reports it
    const fromLists = new Set([...(listCited[unit.key] ?? []), ...(unit.parentId ? listCited[unit.parentId] ?? [] : [])]);
    const uncited = courseIdsOf(row).filter((id) => !fromLists.has(id) && !fragments.some((f) => fragmentNamesCourse(f, id)));
    if (uncited.length)
      errors.push({
        code: "quote-coverage",
        key: unit.key,
        message: `${unit.key}: the rule names ${uncited.map((id) => id.replace("-", " ")).join(", ")}, but no quote of the row cites ${uncited.length === 1 ? "it" : "them"}`,
      });
    for (const { field, value } of numbersOf(row))
      if (!fragmentsStateNumber(fragments, value))
        warnings.push({ code: "quote-coverage", key: unit.key, message: `${unit.key}: ${field} is ${value}, but no quote of the row states ${value}` });
  }
  return { errors, warnings };
}

// ─── The check ──────────────────────────────────────────────────────────────

export type CheckInput = {
  draftRaw: unknown;
  draftPath: string;
  pageText: string;
  /** snapshot/page.html; null when the file is missing (an error: the
   *  snapshot cannot be verified without it). */
  pageHtml: string | null;
  meta: SnapshotMeta;
  /** Absent: the catalog check is skipped (a warning). */
  catalog?: Catalog;
  /** The verified extract.json of the snapshot, or the reason it could not be
   *  loaded. Needed only when the draft has listRefs. */
  extract?: PageExtract | { error: string };
};

export function checkDraft(input: CheckInput): CheckReport {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const report = (): CheckReport => ({ draft: input.draftPath, ok: errors.length === 0, errors, warnings });

  // Schema (stop here on failure: nothing below can trust the shape).
  const parsed = DraftSchema.safeParse(input.draftRaw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      errors.push({ code: "schema", key: path || undefined, message: `${path || "(root)"}: ${issue.message}` });
    }
    return report();
  }
  const draft = parsed.data as unknown as Draft;
  const layer = draft.layer;

  // Lint.
  for (const line of lintLayer(layer)) errors.push({ code: "lint", key: keyOf(layer.id, line), message: line });

  // Ids.
  if (draft.programId !== layer.id) {
    errors.push({ code: "id", message: `draft programId "${draft.programId}" differs from layer id "${layer.id}"` });
  }

  // Snapshot.
  const { meta } = input;
  if (draft.snapshot.textSha256 !== meta.textSha256) {
    errors.push({
      code: "snapshot",
      message: `draft was written against snapshot text ${draft.snapshot.textSha256.slice(0, 12)}, the snapshot is ${meta.textSha256.slice(0, 12)}`,
    });
  }
  if (draft.snapshot.url !== meta.url) {
    errors.push({ code: "snapshot", message: `draft snapshot url ${draft.snapshot.url} differs from the snapshot's ${meta.url}` });
  }
  const pageSha = sha256(toLf(input.pageText));
  if (pageSha !== meta.textSha256) {
    errors.push({ code: "snapshot", message: `page.txt (sha256 ${pageSha.slice(0, 12)}) does not match meta.json textSha256 ${meta.textSha256.slice(0, 12)}` });
  }
  if (input.pageHtml == null) {
    errors.push({ code: "snapshot", message: "page.html is missing, so page.txt cannot be verified against the page it was extracted from" });
  } else {
    const html = toLf(input.pageHtml);
    const htmlSha = sha256(html);
    if (htmlSha !== meta.htmlSha256) {
      errors.push({ code: "snapshot", message: `page.html (sha256 ${htmlSha.slice(0, 12)}) does not match meta.json htmlSha256 ${String(meta.htmlSha256).slice(0, 12)}` });
    }
    if (toLf(extractPageText(html)) !== toLf(input.pageText)) {
      errors.push({ code: "snapshot", message: "page.txt is not the text the snapshotter extracts from page.html (page.txt was edited, or page.html replaced)" });
    }
  }

  // Quotes.
  const units = rowUnits(layer);
  const unitKeys = new Set(units.map((u) => u.key));
  for (const unit of units) {
    if (unit.parentId == null && quotesFor(draft, unit).length === 0) {
      errors.push({ code: "quote-missing", key: unit.key, message: `row ${unit.key} has no quote fragments` });
    }
  }
  const index = indexPage(input.pageText);
  for (const [key, fragments] of Object.entries(draft.quotes)) {
    if (!unitKeys.has(key)) {
      errors.push({ code: "quote-key", key, message: `quotes key "${key}" is not a row of the layer (row ids, or "<anyOfId>/<childId>")` });
    }
    for (const q of checkQuote(input.pageText, fragments)) {
      if (q.tooShort) {
        errors.push({
          code: "quote-too-short",
          key,
          message: `${key}: fragment "${truncate(q.fragment)}" is under ${QUOTE_MIN_CHARS} characters; quote a longer stretch`,
        });
      } else if (!q.found) {
        const near = closestLine(index, q.fragment);
        const hint = near ? `; matches the page up to "${truncate(near.matched, 50)}", closest page line: "${truncate(near.line, 120)}"` : "";
        errors.push({ code: "quote-not-found", key, message: `${key}: fragment "${truncate(q.fragment)}" is not on page.txt${hint}` });
      }
    }
  }

  // Extracted lists the draft's rows were expanded from (expand-draft.ts).
  const listCited: Record<string, Set<string>> = {};
  if (draft.listRefs && Object.keys(draft.listRefs).length) {
    const ex = input.extract;
    if (!ex || "error" in ex) {
      errors.push({ code: "list-ref", message: `the draft names extracted lists, but extract.json cannot be used: ${ex && "error" in ex ? ex.error : "not loaded"}` });
    } else if (ex.textSha256 !== meta.textSha256) {
      errors.push({ code: "list-ref", message: "extract.json was made from a different snapshot; re-run extract-catalog-page.ts" });
    } else {
      for (const [key, ids] of Object.entries(draft.listRefs)) {
        if (!unitKeys.has(key)) errors.push({ code: "list-ref", key, message: `listRefs key "${key}" is not a row of the layer` });
        const set = new Set<string>();
        for (const id of ids) {
          const l = ex.lists.find((x) => x.id === id);
          if (!l) errors.push({ code: "list-ref", key, message: `${key}: list ${id} is not in extract.json` });
          else l.courseIds.forEach((c) => set.add(c));
        }
        listCited[key] = set;
      }
    }
  }

  // Quotes that back what the row encodes.
  const coverage = quoteCoverage(layer, draft.quotes, listCited);
  errors.push(...coverage.errors);
  warnings.push(...coverage.warnings);

  // Rows citing another page.
  for (const unit of units) {
    if (!samePage(unit.row.source.url, meta.url)) {
      warnings.push({ code: "source-url", key: unit.key, message: `row ${unit.key} cites ${unit.row.source.url}, not the snapshot page ${meta.url}` });
    }
  }

  // Public text must not copy the page (labels, notes and headings are published).
  for (const f of publicTextFields(layer)) {
    const run = copiedRun(f.text, input.pageText);
    if (run) errors.push({ code: "public-text", key: f.key, message: `${f.where} copies the page ("${truncate(run)}"); paraphrase it` });
  }

  // Catalog.
  if (input.catalog) {
    const r = validateLayer(input.draftPath, layer as unknown as LayerFile, input.catalog);
    for (const e of r.errors) errors.push({ code: "catalog", key: keyOf(layer.id, e), message: e });
    for (const w of r.warnings) warnings.push({ code: "catalog", key: keyOf(layer.id, w), message: w });
  } else {
    warnings.push({ code: "no-catalog", message: "catalog check skipped (--no-catalog): rules were not checked against the catalog dump" });
  }

  return report();
}

export function renderCheck(r: CheckReport): string {
  const lines = [`check-draft ${r.draft}`];
  if (r.errors.length) lines.push(`  ERRORS (${r.errors.length}):`, ...r.errors.map((e) => `    x [${e.code}] ${e.message}`));
  if (r.warnings.length) lines.push(`  WARNINGS (${r.warnings.length}):`, ...r.warnings.map((w) => `    ! [${w.code}] ${w.message}`));
  const counts = new Map<string, number>();
  for (const e of r.errors) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  const byCode = [...counts.entries()].map(([c, n]) => `${c} ${n}`).join(", ");
  lines.push(r.ok ? `  OK: no errors, ${r.warnings.length} warning(s).` : `  FAILED: ${r.errors.length} error(s) (${byCode}), ${r.warnings.length} warning(s).`);
  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx check-draft.ts <draft.json> [--snapshot <dir>] [--dump <path> | --no-catalog] [--json <out.json>]";

export type CliIo = { log?: (s: string) => void; err?: (s: string) => void };

/** The whole CLI as a function: returns the exit code instead of exiting. */
export function runCheck(argv: string[], io: CliIo = {}): number {
  const log = io.log ?? ((s: string) => console.log(s));
  const err = io.err ?? ((s: string) => console.error(s));
  let draftPath: string | null = null;
  let snapshotDir: string | null = null;
  let dumpPath: string | null = null;
  let noCatalog = false;
  let jsonOut: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot") snapshotDir = argv[++i] ?? null;
    else if (a === "--dump") dumpPath = argv[++i] ?? null;
    else if (a === "--no-catalog") noCatalog = true;
    else if (a === "--json") jsonOut = argv[++i] ?? null;
    else if (a.startsWith("--")) {
      err(`unknown option: ${a}\n${USAGE}`);
      return 2;
    } else if (draftPath == null) draftPath = a;
    else {
      err(`one draft at a time\n${USAGE}`);
      return 2;
    }
  }
  if (!draftPath) {
    err(USAGE);
    return 2;
  }
  if (noCatalog && dumpPath) {
    err(`--dump and --no-catalog are exclusive\n${USAGE}`);
    return 2;
  }

  let draftRaw: unknown;
  try {
    draftRaw = JSON.parse(readFileSync(resolve(draftPath), "utf-8"));
  } catch (e) {
    err(`cannot read draft ${draftPath}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  if (!snapshotDir) {
    const programId = draftRaw && typeof draftRaw === "object" ? (draftRaw as { programId?: unknown }).programId : undefined;
    try {
      if (typeof programId !== "string") throw new Error("the draft has no programId");
      snapshotDir = join(provenanceDir(programId), PROVENANCE_FILES.snapshotDir);
    } catch (e) {
      err(`cannot locate the snapshot (${e instanceof Error ? e.message : String(e)}); pass --snapshot <dir>`);
      return 2;
    }
  }

  let pageText: string;
  let meta: SnapshotMeta;
  let pageHtml: string | null = null;
  try {
    pageText = readFileSync(join(resolve(snapshotDir), "page.txt"), "utf-8");
    meta = JSON.parse(readFileSync(join(resolve(snapshotDir), "meta.json"), "utf-8")) as SnapshotMeta;
    if (typeof meta.textSha256 !== "string" || typeof meta.url !== "string") throw new Error("meta.json lacks textSha256/url");
    const htmlPath = join(resolve(snapshotDir), "page.html");
    if (existsSync(htmlPath)) pageHtml = readFileSync(htmlPath, "utf-8");
  } catch (e) {
    err(`cannot read the snapshot in ${snapshotDir}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  let catalog: Catalog | undefined;
  if (!noCatalog) {
    const dump = resolve(dumpPath ?? DEFAULT_DUMP);
    if (!existsSync(dump)) {
      err(`catalog dump not found: ${dump} (pass --dump <path> or --no-catalog)`);
      return 2;
    }
    try {
      catalog = buildCatalog(loadCatalogDump(dump));
    } catch (e) {
      err(`cannot read the catalog dump ${dump}: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  let extract: PageExtract | { error: string } | undefined;
  const hasRefs = !!(draftRaw && typeof draftRaw === "object" && (draftRaw as { listRefs?: unknown }).listRefs);
  if (hasRefs) {
    try {
      extract = loadVerifiedExtract(dirname(resolve(snapshotDir)));
    } catch (e) {
      extract = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const result = checkDraft({ draftRaw, draftPath, pageText, pageHtml, meta, catalog, extract });
  log(renderCheck(result));
  if (jsonOut) {
    try {
      writeFileSync(resolve(jsonOut), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    } catch (e) {
      err(`cannot write ${jsonOut}: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(runCheck(process.argv.slice(2)));
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
