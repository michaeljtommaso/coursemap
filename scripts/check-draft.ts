// scripts/check-draft.ts
// Mechanical check of one authored requirement draft (spec 019 Phase 4, D4/D12):
// schema, structural lint, verbatim quotes against the frozen page snapshot, and
// catalog satisfiability against the offline dump.
//
//   npx tsx check-draft.ts <draft.json> [--snapshot <dir>] [--dump <path> | --no-catalog] [--json <out.json>]
//
// --snapshot defaults to provenanceDir(draft.programId)/snapshot (page.txt +
// meta.json); --dump defaults to DEFAULT_DUMP. --json writes the CheckReport.
//
// ERRORS (code):
//   schema           the draft fails DraftSchema (no further checks run)
//   lint             lintLayer() on the layer
//   id               draft.programId differs from layer.id
//   snapshot         the draft names another snapshot (textSha256 or url), or
//                    page.txt no longer matches meta.json's textSha256
//   quote-missing    a top-level row has no quote fragments
//   quote-key        a quotes key is not a row unit of the layer
//   quote-not-found  a fragment is not on page.txt word for word (normal form)
//   quote-too-short  a fragment is shorter than QUOTE_MIN_CHARS
//   catalog          a validate-layers error (a rule no catalog course satisfies)
// WARNINGS: validate-layers warnings (catalog), a row citing another page than
// the snapshot (source-url), and the catalog check skipped (no-catalog).
//
// Exit: 0 no errors, 1 errors, 2 bad usage or unreadable input.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import {
  DEFAULT_DUMP,
  DraftSchema,
  PROVENANCE_FILES,
  QUOTE_MIN_CHARS,
  checkQuote,
  normalizeQuoteText,
  provenanceDir,
  quotesFor,
  rowUnits,
  type CheckReport,
  type Draft,
  type Finding,
  type SnapshotMeta,
} from "./layer-authoring";
import { sha256, toLf } from "./snapshot-catalog-page";
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

// ─── The check ──────────────────────────────────────────────────────────────

export type CheckInput = {
  draftRaw: unknown;
  draftPath: string;
  pageText: string;
  meta: SnapshotMeta;
  /** Absent: the catalog check is skipped (a warning). */
  catalog?: Catalog;
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

  // Rows citing another page.
  for (const unit of units) {
    if (!samePage(unit.row.source.url, meta.url)) {
      warnings.push({ code: "source-url", key: unit.key, message: `row ${unit.key} cites ${unit.row.source.url}, not the snapshot page ${meta.url}` });
    }
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
  try {
    pageText = readFileSync(join(resolve(snapshotDir), "page.txt"), "utf-8");
    meta = JSON.parse(readFileSync(join(resolve(snapshotDir), "meta.json"), "utf-8")) as SnapshotMeta;
    if (typeof meta.textSha256 !== "string" || typeof meta.url !== "string") throw new Error("meta.json lacks textSha256/url");
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

  const result = checkDraft({ draftRaw, draftPath, pageText, meta, catalog });
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
