// scripts/edit-ledger.ts
// Targeted edits to a verified layer, released on per-row sign-offs instead of
// a fresh whole-layer verifier run (Michael's decision 3, 2026-11-01, Phase 5
// resolutions campaign). The verifier's verdicts in verify.json are bound to the
// exact layer they were made on; an edit used to make every verdict stale. With
// a ledger, the review sheet (and so promote-layer) accepts an edited layer when
// a script proves that only the rows the ledger lists changed against the
// verified layer, and every listed row carries its resolution reference and a
// Cornell sentence found on page.txt. Unchanged rows keep their verdicts.
//
// Two files in the provenance folder:
//   edit-base.json  the verified layer (the merged.layer verify.json was made on),
//                   written once by --start; never edited by hand.
//   edits.json      the ledger: { programId, baseLayerSha256, rows, layerFields,
//                   answers, missing } (EditLedger below).
//
// A ledger entry:
//   rows[]        { key, change, resolution, quote, why }  key is a RowUnit key
//                 ("row" or "row/option"); change is "changed" | "added" |
//                 "removed" | "affirmed" (unchanged, but its earlier verdict is
//                 replaced by this sign-off: e.g. a row the verifier was unsure of
//                 that a resolution confirms).
//   layerFields[] { field, resolution, quote, why }  a changed top-level field
//                 other than rows (questions, concentrations, notes, …).
//   answers[]     { ref, resolution, why, quote? }  closes a needsMichael
//                 decision (resolution.json, or phase2-reconcile.json) by its ref.
//   missing[]     { quote, resolution, why }  answers a verify.json `missing`
//                 item (quoted exactly as there): the row that now covers it, or
//                 why it is dropped.
//
// What the ledger cannot do: replace check-merged.json (check-draft must re-run
// on the edited layer), the golden report (it must re-run at 100% with its
// probes on the edited layer), or any of promote-layer's own checks. Those stay
// bound to the exact layer. A full chain re-run (reset-run.ts) moves the ledger
// aside with everything else.
//
// Problems (each is a review-sheet flag, so promotion refuses):
//   - the base is not the layer verify.json was made on, or the ledger names
//     another base;
//   - a row changed, appeared or disappeared that the ledger does not list, or a
//     listed row's real change differs from the one listed (an "affirmed" row
//     must be unchanged);
//   - a top-level field changed that layerFields does not list, or a listed
//     field did not change;
//   - an entry without a resolution or why, or whose quote is not on page.txt
//     word for word (rows, layerFields, missing; an answer's quote is optional
//     but checked when given);
//   - an answer whose ref is not an open question, or a missing entry that
//     matches no verify.json missing item.
//
// Run (from scripts/):
//   npx tsx edit-ledger.ts --start  --program <layerId> [--dir <provenanceDir>]
//       snapshot the verified layer into edit-base.json and write an empty
//       edits.json; refuses unless verify.json was made on merged.json as it is
//       now, and refuses to overwrite an existing base.
//   npx tsx edit-ledger.ts --status --program <layerId> [--dir <provenanceDir>]
//       print what changed against the base, which entries cover it, and every
//       problem. Exit 0 clean, 1 problems, 2 bad usage or unreadable input.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import { canonicalStringify } from "./canonical-json";
import { PROVENANCE_FILES, checkQuote, layerSha256, parseDraft, provenanceDir, rowUnits, type Layer, type RowUnit, type Verification } from "./layer-authoring";

const str = z.string();
const nonEmpty = z.string().trim().min(1);

export const EditLedgerShape = z.object({
  programId: str,
  baseLayerSha256: str,
  rows: z.array(z.object({ key: nonEmpty, change: z.enum(["changed", "added", "removed", "affirmed"]), resolution: nonEmpty, quote: nonEmpty, why: nonEmpty })).default([]),
  layerFields: z.array(z.object({ field: nonEmpty, resolution: nonEmpty, quote: nonEmpty, why: nonEmpty })).default([]),
  answers: z.array(z.object({ ref: nonEmpty, resolution: nonEmpty, why: nonEmpty, quote: z.string().optional() })).default([]),
  missing: z.array(z.object({ quote: nonEmpty, resolution: nonEmpty, why: nonEmpty })).default([]),
});
export type EditLedger = z.infer<typeof EditLedgerShape>;
export type RowEdit = EditLedger["rows"][number];
export type RowChange = "changed" | "added" | "removed";

/** A unit's own content: an anyOf parent without its options (they are units of
 *  their own), so an edited option is not also a change to its parent. */
function unitText(u: RowUnit): string {
  if (u.row.kind === "anyOf") {
    const { rows: _options, ...own } = u.row;
    return canonicalStringify(own);
  }
  return canonicalStringify(u.row);
}

/** Every unit that changed, appeared or disappeared from base to now, in the
 *  order of the current layer (removed ones last, in base order). */
export function unitChanges(base: Layer, now: Layer): { key: string; change: RowChange }[] {
  const before = new Map(rowUnits(base).map((u) => [u.key, unitText(u)]));
  const out: { key: string; change: RowChange }[] = [];
  const seen = new Set<string>();
  for (const u of rowUnits(now)) {
    seen.add(u.key);
    const was = before.get(u.key);
    if (was === undefined) out.push({ key: u.key, change: "added" });
    else if (was !== unitText(u)) out.push({ key: u.key, change: "changed" });
  }
  for (const key of before.keys()) if (!seen.has(key)) out.push({ key, change: "removed" });
  return out;
}

/** Top-level layer fields (everything but rows) whose value differs. */
export function fieldChanges(base: Layer, now: Layer): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(now)]);
  keys.delete("rows");
  const b = base as Record<string, unknown>;
  const n = now as Record<string, unknown>;
  return [...keys].filter((k) => canonicalStringify(b[k]) !== canonicalStringify(n[k])).sort();
}

export type LedgerInputs = {
  ledger: EditLedger;
  /** edit-base.json's layer, or undefined when the file is missing. */
  base: Layer | undefined;
  now: Layer;
  verify: Verification | undefined;
  pageText: string;
  /** Refs of the open needsMichael decisions (resolution.json and the reconcile). */
  openRefs: string[];
};

export type LedgerResult = {
  problems: string[];
  /** Unit key → the sign-off that stands in for its verdict (changed, added, affirmed). */
  signoffs: Map<string, RowEdit>;
  /** Unit keys the ledger lists as removed. */
  removed: Set<string>;
  /** Open-question refs the ledger answers. */
  answered: Set<string>;
  /** verify.json missing quotes the ledger answers (normalized whitespace). */
  missingAnswered: Set<string>;
  /** True when verify.json was made on the base and the base is intact. */
  baseOk: boolean;
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** A decision ref as the sheet compares them (markdown backticks off). */
export const normRef = (ref: string) => ref.trim().replace(/^`+|`+$/g, "").trim();

/** Every check of the ledger against the files. Pure. */
export function checkLedger(inp: LedgerInputs): LedgerResult {
  const { ledger, base, now, verify, pageText } = inp;
  const problems: string[] = [];
  const signoffs = new Map<string, RowEdit>();
  const removed = new Set<string>();
  const answered = new Set<string>();
  const missingAnswered = new Set<string>();
  const where = PROVENANCE_FILES.edits;

  let baseOk = false;
  if (!base) problems.push(`${PROVENANCE_FILES.editBase} is missing (run edit-ledger.ts --start before editing)`);
  else {
    const h = layerSha256(base);
    if (h !== ledger.baseLayerSha256) problems.push(`${where} names base ${ledger.baseLayerSha256.slice(0, 12)}…, but ${PROVENANCE_FILES.editBase} is ${h.slice(0, 12)}…`);
    else if (verify?.layerSha256 !== h) problems.push(`${PROVENANCE_FILES.verify} was not made on ${PROVENANCE_FILES.editBase}: the verdicts kept for unchanged rows would not be the base's`);
    else baseOk = true;
  }
  if (ledger.programId !== now.id) problems.push(`${where} is for ${ledger.programId}, not ${now.id}`);

  const onPage = (q: string) => !!pageText && checkQuote(pageText, [q])[0].found;
  const quoteProblem = (what: string, q: string) => {
    if (!onPage(q)) problems.push(`${where} ${what}: the quote is not on ${PROVENANCE_FILES.pageText} word for word ("${oneLine(q).slice(0, 80)}")`);
  };

  // Rows: every real change listed, every listed change real.
  const real = base ? unitChanges(base, now) : [];
  const realByKey = new Map(real.map((c) => [c.key, c.change]));
  const nowKeys = new Set(rowUnits(now).map((u) => u.key));
  const listed = new Map<string, RowEdit>();
  for (const e of ledger.rows) {
    if (listed.has(e.key)) problems.push(`${where} lists row ${e.key} twice`);
    listed.set(e.key, e);
    quoteProblem(`row ${e.key}`, e.quote);
    if (!base) continue;
    const actual = realByKey.get(e.key);
    if (e.change === "affirmed") {
      if (actual) problems.push(`${where} row ${e.key} is listed as affirmed (unchanged) but it was ${actual}`);
      else if (!nowKeys.has(e.key)) problems.push(`${where} row ${e.key} is affirmed but the layer has no such row`);
    } else if (actual !== e.change) problems.push(`${where} row ${e.key} is listed as ${e.change} but it was ${actual ?? "not changed"}`);
    if (e.change === "removed") removed.add(e.key);
    else signoffs.set(e.key, e);
  }
  for (const c of real) if (!listed.has(c.key)) problems.push(`row ${c.key} was ${c.change} but ${where} does not list it`);

  // Top-level fields.
  const fields = base ? fieldChanges(base, now) : [];
  const listedFields = new Set<string>();
  for (const f of ledger.layerFields) {
    listedFields.add(f.field);
    quoteProblem(`layer field ${f.field}`, f.quote);
    if (base && !fields.includes(f.field)) problems.push(`${where} lists layer field ${f.field}, but it did not change`);
  }
  for (const f of fields) if (!listedFields.has(f)) problems.push(`layer field ${f} changed but ${where} does not list it`);

  // Answers to open questions.
  const open = new Set(inp.openRefs.map(normRef));
  for (const a of ledger.answers) {
    const ref = normRef(a.ref);
    if (!open.has(ref)) problems.push(`${where} answers "${oneLine(a.ref)}", which is not an open question`);
    else answered.add(ref);
    if (a.quote) quoteProblem(`answer to ${oneLine(a.ref)}`, a.quote);
  }

  // Answers to the verifier's missing items.
  const missingQuotes = new Set((verify?.missing ?? []).map((m) => oneLine(m.quote)));
  for (const m of ledger.missing) {
    const q = oneLine(m.quote);
    if (!missingQuotes.has(q)) problems.push(`${where} answers a missing item that ${PROVENANCE_FILES.verify} does not list ("${q.slice(0, 80)}")`);
    else missingAnswered.add(q);
  }

  return { problems, signoffs, removed, answered, missingAnswered, baseOk };
}

// ─── Files ──────────────────────────────────────────────────────────────────

export class LedgerInputError extends Error {}

/** edits.json (parsed) and edit-base.json's layer, when edits.json exists.
 *  Throws LedgerInputError on a malformed file. */
export function loadLedger(base: string): { ledger: EditLedger; baseLayer: Layer | undefined } | undefined {
  const at = (f: string) => join(base, f);
  if (!existsSync(at(PROVENANCE_FILES.edits))) return undefined;
  let ledger: EditLedger;
  try {
    const r = EditLedgerShape.safeParse(JSON.parse(readFileSync(at(PROVENANCE_FILES.edits), "utf-8")));
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    ledger = r.data;
  } catch (e) {
    throw new LedgerInputError(`${PROVENANCE_FILES.edits} cannot be used: ${e instanceof Error ? e.message : String(e)}`);
  }
  let baseLayer: Layer | undefined;
  if (existsSync(at(PROVENANCE_FILES.editBase))) {
    try {
      baseLayer = JSON.parse(readFileSync(at(PROVENANCE_FILES.editBase), "utf-8")) as Layer;
    } catch (e) {
      throw new LedgerInputError(`${PROVENANCE_FILES.editBase} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ledger, baseLayer };
}

/** --start: snapshot the verified layer. Returns an error message, or null. */
export function startLedger(base: string): string | null {
  const at = (f: string) => join(base, f);
  if (existsSync(at(PROVENANCE_FILES.editBase))) return `${PROVENANCE_FILES.editBase} already exists: the base is the layer verify.json was made on, set once`;
  if (!existsSync(at(PROVENANCE_FILES.merged))) return `no ${PROVENANCE_FILES.merged}`;
  if (!existsSync(at(PROVENANCE_FILES.verify))) return `no ${PROVENANCE_FILES.verify}: a ledger starts from a verified layer`;
  const merged = parseDraft(JSON.parse(readFileSync(at(PROVENANCE_FILES.merged), "utf-8")));
  const verify = JSON.parse(readFileSync(at(PROVENANCE_FILES.verify), "utf-8")) as Verification;
  const h = layerSha256(merged.layer);
  if (verify.layerSha256 !== h) return `${PROVENANCE_FILES.verify} was not made on ${PROVENANCE_FILES.merged} as it is now: re-run the verifier (or restore the verified layer) first`;
  writeFileSync(at(PROVENANCE_FILES.editBase), `${JSON.stringify(merged.layer, null, 2)}\n`);
  if (!existsSync(at(PROVENANCE_FILES.edits))) {
    const empty: EditLedger = { programId: merged.layer.id, baseLayerSha256: h, rows: [], layerFields: [], answers: [], missing: [] };
    writeFileSync(at(PROVENANCE_FILES.edits), `${JSON.stringify(empty, null, 2)}\n`);
  }
  return null;
}

function main(): number {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const program = flag("--program");
  const dirArg = flag("--dir");
  const mode = args.includes("--start") ? "start" : args.includes("--status") ? "status" : null;
  if (!program || !mode) {
    console.error("usage: npx tsx edit-ledger.ts --start|--status --program <layerId> [--dir <provenanceDir>]");
    return 2;
  }
  let base: string;
  try {
    base = dirArg ? resolve(dirArg) : provenanceDir(program);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (mode === "start") {
    const err = startLedger(base);
    if (err) {
      console.error(`REFUSED: ${err}`);
      return 1;
    }
    console.log(`wrote ${PROVENANCE_FILES.editBase} and ${PROVENANCE_FILES.edits} for ${program}`);
    return 0;
  }
  // --status
  let loaded: ReturnType<typeof loadLedger>;
  try {
    loaded = loadLedger(base);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (!loaded) {
    console.error(`no ${PROVENANCE_FILES.edits} (run --start first)`);
    return 2;
  }
  const at = (f: string) => join(base, f);
  const rawMerged = JSON.parse(readFileSync(at(PROVENANCE_FILES.merged), "utf-8")) as object;
  const now = parseDraft(rawMerged).layer;
  // The base through the same parse as the merged layer (so absent and undefined fields hash alike).
  if (loaded.baseLayer) loaded.baseLayer = parseDraft({ ...rawMerged, layer: loaded.baseLayer }).layer;
  const verify = existsSync(at(PROVENANCE_FILES.verify)) ? (JSON.parse(readFileSync(at(PROVENANCE_FILES.verify), "utf-8")) as Verification) : undefined;
  const pageText = existsSync(at(PROVENANCE_FILES.pageText)) ? readFileSync(at(PROVENANCE_FILES.pageText), "utf-8") : "";
  const openRefs = openQuestionRefs(base);
  const r = checkLedger({ ledger: loaded.ledger, base: loaded.baseLayer, now, verify, pageText, openRefs });
  if (loaded.baseLayer) {
    for (const c of unitChanges(loaded.baseLayer, now)) console.log(`${c.change.padEnd(8)} ${c.key}${loaded.ledger.rows.some((e) => e.key === c.key) ? "" : "   ← not in the ledger"}`);
    for (const f of fieldChanges(loaded.baseLayer, now)) console.log(`field    ${f}${loaded.ledger.layerFields.some((e) => e.field === f) ? "" : "   ← not in the ledger"}`);
  }
  for (const ref of openRefs) if (!r.answered.has(normRef(ref))) console.log(`open     ${oneLine(ref)}   ← not answered`);
  for (const m of verify?.missing ?? []) if (!r.missingAnswered.has(oneLine(m.quote))) console.log(`missing  "${oneLine(m.quote).slice(0, 80)}"   ← not answered`);
  for (const p of r.problems) console.log(`PROBLEM  ${p}`);
  console.log(r.problems.length ? `${r.problems.length} problem(s)` : "ledger clean");
  return r.problems.length ? 1 : 0;
}

/** The refs of every open (needsMichael) decision in resolution.json and
 *  phase2-reconcile.json; unreadable files give none (the sheet reports them). */
export function openQuestionRefs(base: string): string[] {
  const refs: string[] = [];
  for (const f of [PROVENANCE_FILES.resolution, "phase2-reconcile.json"]) {
    const p = join(base, f);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf-8")) as { decisions?: { ref: string; needsMichael: unknown }[] };
      for (const d of j.decisions ?? []) if (d.needsMichael === true) refs.push(d.ref);
    } catch {
      // reported by the review sheet
    }
  }
  return refs;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
