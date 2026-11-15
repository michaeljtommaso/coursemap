// scripts/check-coverage.ts
// Sentence coverage for a single-author draft (spec 047 D12; the authoring
// workflow review's "coverage check"). Omissions were the largest class of
// errors that escaped the two-author chain, so the single author must account
// for every in-scope block of extract.json in the draft's sentence `ledger`,
// and this script proves it from the files:
//
//   - every prose block and table-row block of the extract (headings and
//     blocks with no word of three letters, such as footnote markers, are
//     exempt) is accounted for, in this order of precedence:
//       1. a ledger entry for the block itself ("P12", "T4");
//       2. a ledger entry for its list ("L3": every row of the list, its lead
//          lines included);
//       3. a row of the layer that was expanded from its list (the draft's
//          listRefs, written by expand-draft.ts);
//       4. a ledger entry for a heading above it ("H5": the whole section, up
//          to the next heading of the same or a higher level);
//   - every ledger entry names a block, list or heading of the extract, and
//     goes to a row unit of the layer, "sharing", "eligibility" or
//     "out-of-scope" (never "out-of-scope" together with anything else);
//     "eligibility" and "out-of-scope" need a reason, and so does "sharing"
//     when the layer sets no `sharing` (why nothing is encoded);
//   - a block whose words are about overlap, grades, residency or eligibility
//     (KEYWORDS below) may never be out of scope: an overlap sentence must go
//     to "sharing" or a row, a grade or residency sentence to a row (a confirm
//     row, or a creditKind exclusion), an eligibility sentence to a row or
//     "eligibility" (a minor's notOpenTo lives in its minor index entry);
//   - a layer that sets `sharing` has at least one block mapped to "sharing".
//
//   npx tsx check-coverage.ts <merged.json> [--json <out.json> | --no-write]
//
// extract.json is read from the draft's folder and re-derived from
// snapshot/page.html first (loadVerifiedExtract). The report (CoverageReport)
// goes to <folder>/coverage.json by default and carries the layerSha256 of the
// exact layer checked: the review sheet and promote-layer refuse a minor whose
// coverage.json is missing, failing or made on another version of the layer.
// check-draft.ts runs the same check (error code `sentence-coverage`) on every
// single-author draft and every draft that carries a ledger.
//
// Exit: 0 every block accounted for, 1 findings, 2 bad usage or unreadable input.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { loadVerifiedExtract, type Block, type PageExtract } from "./extract-catalog-page";
import {
  LEDGER_TARGETS,
  PROVENANCE_FILES,
  layerSha256,
  parseDraft,
  rowUnits,
  type Draft,
  type LedgerEntry,
} from "./layer-authoring";

// ─── Keywords ───────────────────────────────────────────────────────────────

export type KeywordClass = "overlap" | "grade" | "residency" | "eligibility";

/** Words that make a block a rule a student can be caught by. Generous on
 *  purpose: a false hit costs the author one ledger target, a miss costs a
 *  false green. */
export const KEYWORDS: Record<KeywordClass, RegExp[]> = {
  overlap: [
    /double[- ]?count/i,
    /\b(?:toward|towards|for) both\b/i,
    /\boverlap/i,
    /\bshar(?:e|ed|es|ing)\b/i,
    /\balso (?:count|satisfy|fulfill|apply|be (?:used|applied|counted))/i,
    /\bmore than one (?:major|minor|requirement|program)/i,
    /\bunique credits?\b/i,
    /\bsame course\b/i,
  ],
  grade: [
    /\bletter grade/i,
    /\bgrades? of\b/i,
    /\bminimum grade/i,
    /\bgrade point\b/i,
    /\bGPA\b/,
    /\bS\/U\b/,
    /\bpass\/fail\b/i,
    /(?<![A-Za-z])[A-D][+-]? or (?:better|higher|above)\b/,
  ],
  residency: [
    /\bat Cornell\b/i,
    /\bin residence\b/i,
    /\btransfer(?:red)? (?:credit|course)/i,
    /\bcredit by exam/i,
    /\bexam(?:ination)? credit/i,
    /\btest credit/i,
    /\badvanced placement\b/i,
    /\bplacement credit/i,
    /\bstudy abroad\b/i,
    /\bAP\b/,
    /\bIB\b/,
  ],
  eligibility: [
    /\bopen to\b/i,
    /\beligib/i,
    /\bmay not (?:declare|pursue|enroll)/i,
    /\bcannot (?:declare|pursue|enroll)/i,
    /\bapplication\b/i,
    /\bapply (?:to|for) (?:the )?(?:minor|major|program)/i,
    /\badmission/i,
    /\badmitted\b/i,
    /\bdeclar(?:e|ed|ing|ation)\b/i,
    /\bsign up\b/i,
    /\bexcept students\b/i,
    /\bmajoring in\b/i,
  ],
};

export function keywordsOf(text: string): KeywordClass[] {
  return (Object.keys(KEYWORDS) as KeywordClass[]).filter((k) => KEYWORDS[k].some((re) => re.test(text)));
}

/** A block with no word of three letters (a footnote marker, a bare credit
 *  number, a "|") states nothing. */
export function isTrivial(text: string): boolean {
  return !/[A-Za-z]{3,}/.test(text);
}

// ─── Report ─────────────────────────────────────────────────────────────────

export type CoverageFindingCode = "no-ledger" | "unaccounted" | "keyword" | "ledger" | "sharing" | "extract";
export type CoverageFinding = { code: CoverageFindingCode; block?: string; message: string };

/** How a block was accounted for (see the header's precedence). */
export type CoverageVia = "ledger" | "list" | "listRefs" | "section";

export type CoverageBlock = { id: string; to: string[]; via: CoverageVia; keywords: KeywordClass[]; reason?: string };

export type CoverageReport = {
  schemaVersion: 1;
  programId: string;
  /** layerSha256() of the layer checked. */
  layerSha256: string;
  /** extract.json's textSha256 (the snapshot the blocks come from). */
  extractTextSha256: string;
  ok: boolean;
  counts: {
    blocks: number;
    exempt: number;
    accounted: number;
    unaccounted: number;
    toRows: number;
    toSharing: number;
    toEligibility: number;
    outOfScope: number;
  };
  findings: CoverageFinding[];
  blocks: CoverageBlock[];
};

const asList = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

/** The check. Pure. */
export function checkCoverage(draft: Draft, extract: Pick<PageExtract, "blocks" | "lists" | "textSha256">): CoverageReport {
  const layer = draft.layer;
  const findings: CoverageFinding[] = [];
  const unitKeys = new Set(rowUnits(layer).map((u) => u.key));
  const special = new Set<string>(LEDGER_TARGETS);
  const ledger = draft.ledger ?? [];

  if (extract.textSha256 !== draft.snapshot.textSha256)
    findings.push({ code: "extract", message: "extract.json was made from a different snapshot than the draft; re-run extract-catalog-page.ts" });
  if (!draft.ledger) findings.push({ code: "no-ledger", message: "the draft has no sentence ledger: map every in-scope extract block to a row, sharing, eligibility or out-of-scope" });

  // Ledger entries: names, targets, reasons.
  const blockIds = new Set(extract.blocks.map((b) => b.id));
  const listIds = new Set(extract.lists.map((l) => l.id));
  const headingIds = new Set(extract.blocks.filter((b) => b.kind === "heading").map((b) => b.id));
  const entries = new Map<string, LedgerEntry>();
  for (const e of ledger) {
    if (entries.has(e.block)) findings.push({ code: "ledger", block: e.block, message: `${e.block} has more than one ledger entry; merge them (to may list several targets)` });
    entries.set(e.block, e);
    if (!blockIds.has(e.block) && !listIds.has(e.block)) findings.push({ code: "ledger", block: e.block, message: `${e.block} is not a block, list or heading of extract.json` });
    const to = asList(e.to);
    for (const t of to)
      if (!unitKeys.has(t) && !special.has(t))
        findings.push({ code: "ledger", block: e.block, message: `${e.block} goes to "${t}", which is not a row of the layer ("row" or "parent/child") nor one of ${LEDGER_TARGETS.join(", ")}` });
    if (to.includes("out-of-scope") && to.length > 1)
      findings.push({ code: "ledger", block: e.block, message: `${e.block} is "out-of-scope" and also goes to ${to.filter((t) => t !== "out-of-scope").join(", ")}; it is one or the other` });
    const needsReason = to.some((t) => t === "eligibility" || t === "out-of-scope") || (to.includes("sharing") && layer.sharing == null);
    if (needsReason && !e.reason?.trim())
      findings.push({
        code: "ledger",
        block: e.block,
        message: `${e.block} goes to ${to.join(", ")} and needs a reason${to.includes("sharing") && layer.sharing == null ? " (the layer sets no sharing: say why the sentence sets no limit)" : ""}`,
      });
  }

  // Lists the layer's rows were expanded from.
  const listUsers = new Map<string, string[]>();
  for (const [key, ids] of Object.entries(draft.listRefs ?? {})) for (const id of ids) listUsers.set(id, [...(listUsers.get(id) ?? []), key]);

  const out: CoverageBlock[] = [];
  const counts = { blocks: 0, exempt: 0, accounted: 0, unaccounted: 0, toRows: 0, toSharing: 0, toEligibility: 0, outOfScope: 0 };
  const stack: Block[] = [];
  for (const b of extract.blocks) {
    counts.blocks++;
    if (b.kind === "heading") {
      while (stack.length && (stack[stack.length - 1].level ?? 9) >= (b.level ?? 9)) stack.pop();
      stack.push(b);
      counts.exempt++;
      continue;
    }
    if (isTrivial(b.text)) {
      counts.exempt++;
      continue;
    }
    let to: string[] | null = null;
    let via: CoverageVia = "ledger";
    let reason: string | undefined;
    const own = entries.get(b.id);
    const ofList = b.list ? entries.get(b.list) : undefined;
    const users = b.list ? listUsers.get(b.list) : undefined;
    const section = [...stack].reverse().find((h) => headingIds.has(h.id) && entries.has(h.id));
    if (own) [to, via, reason] = [asList(own.to), "ledger", own.reason];
    else if (ofList) [to, via, reason] = [asList(ofList.to), "list", ofList.reason];
    else if (users?.length) [to, via] = [users, "listRefs"];
    else if (section) {
      const e = entries.get(section.id)!;
      [to, via, reason] = [asList(e.to), "section", e.reason];
    }
    const keywords = keywordsOf(b.text);
    if (!to) {
      counts.unaccounted++;
      findings.push({
        code: "unaccounted",
        block: b.id,
        message: `${b.id} is not accounted for${b.list ? ` (row of list ${b.list}, which no row uses)` : ""}${keywords.length ? ` [${keywords.join(", ")}]` : ""}: "${short(b.text)}"`,
      });
      continue;
    }
    counts.accounted++;
    const toRow = to.some((t) => unitKeys.has(t));
    if (toRow) counts.toRows++;
    if (to.includes("sharing")) counts.toSharing++;
    if (to.includes("eligibility")) counts.toEligibility++;
    if (to.includes("out-of-scope")) counts.outOfScope++;
    for (const k of keywords) {
      const ok =
        k === "overlap" ? toRow || to.includes("sharing") : k === "eligibility" ? toRow || to.includes("eligibility") : toRow;
      if (!ok) {
        const want = k === "overlap" ? `"sharing" or a row` : k === "eligibility" ? `a row or "eligibility"` : "a row (a confirm row, or a creditKind exclusion)";
        findings.push({
          code: "keyword",
          block: b.id,
          message: `${b.id} reads as a${k === "overlap" || k === "eligibility" ? "n" : ""} ${k} rule but goes to ${to.join(", ")} (via ${via}${via === "section" ? ` ${section!.id}` : ""}); map it to ${want}: "${short(b.text)}"`,
        });
      }
    }
    out.push({ id: b.id, to, via, keywords, ...(reason ? { reason } : {}) });
  }
  if (layer.sharing != null && counts.toSharing === 0)
    findings.push({ code: "sharing", message: "the layer sets sharing, but no block of the page is mapped to \"sharing\": map the sentence that sets the limit" });

  return {
    schemaVersion: 1,
    programId: draft.programId,
    layerSha256: layerSha256(layer),
    extractTextSha256: extract.textSha256,
    ok: findings.length === 0,
    counts,
    findings,
    blocks: out,
  };
}

function short(s: string, max = 110): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function renderCoverage(r: CoverageReport): string {
  const c = r.counts;
  const lines = [
    `check-coverage ${r.programId}`,
    `  layer sha256: ${r.layerSha256}`,
    `  blocks ${c.blocks} (exempt ${c.exempt}): accounted ${c.accounted}, unaccounted ${c.unaccounted}; to rows ${c.toRows}, sharing ${c.toSharing}, eligibility ${c.toEligibility}, out of scope ${c.outOfScope}`,
  ];
  if (r.findings.length) lines.push(`  FINDINGS (${r.findings.length}):`, ...r.findings.map((f) => `    x [${f.code}] ${f.message}`));
  lines.push(r.ok ? "  OK: every in-scope block is accounted for." : `  FAILED: ${r.findings.length} finding(s).`);
  return lines.join("\n");
}

// ─── Report file (review sheet, promote) ────────────────────────────────────

/** Why a coverage.json cannot release this exact layer, or null. */
export function coverageProblem(report: CoverageReport | undefined, layerHash: string): string | null {
  if (!report) return `${PROVENANCE_FILES.coverage} is missing (run check-coverage.ts)`;
  if (report.layerSha256 !== layerHash) return `${PROVENANCE_FILES.coverage} was made on a different version of this layer: re-run check-coverage.ts`;
  if (!report.ok) return `${PROVENANCE_FILES.coverage} has ${report.findings.length} finding(s): every in-scope sentence must be accounted for`;
  return null;
}

export function readCoverageReport(dir: string): CoverageReport | undefined {
  const p = join(dir, PROVENANCE_FILES.coverage);
  if (!existsSync(p)) return undefined;
  const raw = JSON.parse(readFileSync(p, "utf-8")) as CoverageReport;
  if (!raw || raw.schemaVersion !== 1 || typeof raw.layerSha256 !== "string" || typeof raw.ok !== "boolean" || !Array.isArray(raw.findings))
    throw new Error(`${p} is not a coverage report`);
  return raw;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx check-coverage.ts <merged.json> [--json <out.json> | --no-write]";

export function runCoverage(argv: string[], io: { log?: (s: string) => void; err?: (s: string) => void } = {}): number {
  const log = io.log ?? ((s: string) => console.log(s));
  const err = io.err ?? ((s: string) => console.error(s));
  let draftPath: string | null = null;
  let jsonOut: string | null = null;
  let noWrite = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      jsonOut = argv[++i] ?? null;
      if (!jsonOut) {
        err(USAGE);
        return 2;
      }
    } else if (a === "--no-write") noWrite = true;
    else if (a.startsWith("--")) {
      err(`unknown option: ${a}\n${USAGE}`);
      return 2;
    } else if (draftPath == null) draftPath = a;
    else {
      err(`one draft at a time\n${USAGE}`);
      return 2;
    }
  }
  if (!draftPath || (noWrite && jsonOut)) {
    err(USAGE);
    return 2;
  }
  const dir = dirname(resolve(draftPath));
  let draft: Draft;
  let extract: PageExtract;
  try {
    draft = parseDraft(JSON.parse(readFileSync(resolve(draftPath), "utf-8")));
  } catch (e) {
    err(`cannot read the draft ${draftPath}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  try {
    extract = loadVerifiedExtract(dir);
  } catch (e) {
    err(`cannot use ${join(dir, PROVENANCE_FILES.extract)}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const report = checkCoverage(draft, extract);
  log(renderCoverage(report));
  if (!noWrite) {
    const out = resolve(jsonOut ?? join(dir, PROVENANCE_FILES.coverage));
    try {
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
      log(`  report: ${out}`);
    } catch (e) {
      err(`cannot write ${out}: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(runCoverage(process.argv.slice(2)));
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
