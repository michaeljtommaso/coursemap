// scripts/review-sheet.ts
// One readable sheet per authored layer (spec 019 Phase 4/5): what each row asks
// for in plain words, the page text it rests on, what the verifier said, and
// how the row came to be (both authors agreed, or which way the resolver
// decided). Written for a non-technical reviewer and the hand check, so it
// leads with a status block and the open questions, and marks anything that
// needs a look with ⚠. Every layer kind works the same way (college, major,
// concentration); the folder is docs/provenance/<layer id>/.
//
// List-backed rows (Phase 5): when merged.json has `listRefs` (expand-draft.ts
// turned { list: "L3" } into course ids), each such unit shows where its courses
// came from — "from list L3 — 214 courses, under '<last heading>' (lead: '<first
// lead line>')" — read from extract.json, which is re-derived from page.html
// before use (loadVerifiedExtract). Lead lines and headings are the catalog's
// words: they appear only on this sheet (private provenance), never in a public
// file. Flagged (exit 1, never a crash): a broken or stale extract.json (also
// when no row uses it), a missing one when the layer names lists, a list id the
// extract lacks, a listRefs key that is not a row, and a row that no longer
// names every course of its list (re-run expand-draft). In row descriptions a
// course list longer than COURSE_LIST_MAX ids is shortened to its first
// COURSE_LIST_HEAD (sorted, as describeRule prints them) plus "… and N more".
//
// Stale files (flag, exit 1): verify.json and check-merged.json must carry the
// `layerSha256` of the exact merged.layer they were computed on. A file with no
// hash, or a different one, flags: an edited layer must never be released on an
// earlier file's word. (Layers promoted before the hashes existed need their two
// files re-stamped once, after confirming merged.json is unchanged.)
//
// College layers (Phase 5): an extra chain step compares the merged layer with a
// hand-built Phase 2 version and writes phase2-reconcile.json, renaming merged
// rows to the Phase 2 ids. The sheet reads it when present: a renamed row id is
// mapped back to its `from` id for the resolver-decision and A/B-diff lookups
// (those name the authors' ids), its needsMichael decisions count as open
// questions (Questions for Michael) and flag, and its decisions are shown on the
// rows they name and in a closing list. A malformed phase2-reconcile.json (bad
// JSON, wrong shape, a rename to a row the layer lacks) is a flag, never a crash.
//
// Run (from scripts/):
//   npx tsx review-sheet.ts --program <layerId> [--dir <provenanceDir>] [--out <file>]
// Reads merged.json (required) and, when present, verify.json, diff.json,
// resolution.json, golden-report.json, check-merged.json, snapshot/meta.json,
// extract.json, phase2-reconcile.json. Writes review.md (default <dir>/review.md).
// Exit 0 = nothing flagged, 1 = the sheet flags something, 2 = bad usage or an
// unreadable input.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import { loadVerifiedExtract, type CourseList, type PageExtract } from "./extract-catalog-page";
import {
  PROVENANCE_FILES,
  describeRow,
  layerSha256,
  normalizeCourseId,
  parseDraft,
  provenanceDir,
  quotesFor,
  rowUnits,
  type CheckReport,
  type ChildRow,
  type Draft,
  type FieldDiff,
  type GoldenReport,
  type Layer,
  type LayerDiff,
  type Resolution,
  type Row,
  type RowPair,
  type RowUnit,
  type SnapshotMeta,
  type Verification,
} from "./layer-authoring";

export type ReviewInputs = {
  merged: Draft;
  meta?: SnapshotMeta;
  verify?: Verification;
  diff?: LayerDiff;
  resolution?: Resolution;
  golden?: GoldenReport;
  checkMerged?: CheckReport;
  /** extract.json, verified against page.html (loadReviewInputs). */
  extract?: PageExtract;
  /** Why extract.json exists but cannot be used (broken, stale, unreadable). */
  extractError?: string;
  /** phase2-reconcile.json (college layers). */
  reconcile?: Phase2Reconcile;
  /** Why phase2-reconcile.json exists but cannot be used. */
  reconcileError?: string;
};

/** The college reconcile step's output (see the header). */
export const PHASE2_RECONCILE_FILE = "phase2-reconcile.json";
export type Phase2Reconcile = {
  decisions: { ref: string; chosen: "merged" | "phase2" | "neither"; explanation: string; needsMichael: boolean }[];
  renamed: { from: string; to: string }[];
};

type Decision = Resolution["decisions"][number];

const WARN = "⚠";

// ─── Matching decisions and diff entries to units ───────────────────────────

/** The row keys a decision ref names, and the anyOf child ids in its path.
 *  Ref forms: "pair <aKey>~<bKey> <path>", "onlyA <key>", "onlyB <key>",
 *  "layer <path>", and "added <key>" for a row a recorded decision adds after
 *  the diff (e.g. Michael's answer to an open question). */
export function parseRef(ref: string): { kind: "pair" | "onlyA" | "onlyB" | "added" | "layer" | "other"; keys: string[]; childIds: string[] } {
  const t = ref.trim();
  const m = t.match(/^(pair|onlyA|onlyB|added|layer)\s+(\S+)(?:\s+(.*))?$/);
  if (!m) return { kind: "other", keys: [], childIds: [] };
  const kind = m[1] as "pair" | "onlyA" | "onlyB" | "added" | "layer";
  if (kind === "layer") return { kind, keys: [], childIds: [] };
  const keys = kind === "pair" ? m[2].split("~").filter(Boolean) : [m[2]];
  const childIds: string[] = [];
  for (const b of (m[3] ?? "").matchAll(/rows\[([^\]]*)\]/g)) childIds.push(...b[1].split("~").filter(Boolean));
  // "onlyA parent/child" names a child directly.
  const direct = keys.flatMap((k) => (k.includes("/") ? [k] : []));
  return { kind, keys: keys.map((k) => k.split("/")[0]), childIds: [...childIds, ...direct.map((k) => k.split("/")[1])] };
}

/** Child ids of a unit's anyOf parent (or of the unit itself when it is one). */
function optionIds(unit: RowUnit, layer: Layer): string[] {
  const parent = layer.rows.find((r) => r.id === (unit.parentId ?? unit.key));
  return parent?.kind === "anyOf" ? parent.rows.map((c) => c.id) : [];
}

/** Does something that names these child ids belong to this unit? An option
 *  owns what names it; the parent owns what names no option it still has
 *  (including an option the merge dropped). */
function ownsChildIds(unit: RowUnit, layer: Layer, childIds: string[]): boolean {
  if (unit.parentId) return childIds.includes(unit.key.slice(unit.parentId.length + 1));
  const present = optionIds(unit, layer);
  return !childIds.some((c) => present.includes(c));
}

/** Decisions about this unit: those whose ref names its row and, for anyOf
 *  rows, the right option (see ownsChildIds). */
export function decisionsFor(unit: RowUnit, decisions: Decision[], layer: Layer): Decision[] {
  const parent = unit.parentId ?? unit.key;
  return decisions.filter((d) => {
    const r = parseRef(d.ref);
    return r.keys.includes(parent) && ownsChildIds(unit, layer, r.childIds);
  });
}

type Origin = { text: string; flagged: boolean };

function childIdsInPath(path: string): string[] {
  return [...path.matchAll(/rows\[([^\]]*)\]/g)].flatMap((m) => m[1].split("~").filter(Boolean));
}

/** How the unit came to be, from the diff when there is no decision. */
function originFromDiff(unit: RowUnit, diff: LayerDiff, layer: Layer): Origin {
  const parent = unit.parentId ?? unit.key;
  const pairs: RowPair[] = diff.pairs.filter((p) => p.a.key === parent || p.b.key === parent);
  const onlyA = diff.onlyA.some((s) => s.key === parent);
  const onlyB = diff.onlyB.some((s) => s.key === parent);
  if (!pairs.length && !onlyA && !onlyB) return { text: `${WARN} row id not found in the diff (renamed while merging?) — origin unknown`, flagged: true };
  if (!pairs.length) return { text: `${WARN} only author ${onlyA ? "A" : "B"} wrote this row, and no resolver decision mentions it`, flagged: true };
  // Differences on the whole anyOf row (flags, appliesTo, url) belong to the
  // parent's block; an option's block shows the ones that name it.
  const relevant = (f: FieldDiff) => ownsChildIds(unit, layer, childIdsInPath(f.path));
  const real = pairs.flatMap((p) => p.differences.filter((f) => f.severity === "real" && relevant(f)));
  const eq = pairs.flatMap((p) => p.differences.filter((f) => f.severity === "equivalent" && relevant(f)));
  const ambiguous = pairs.length > 1 || onlyA || onlyB ? " (this id appears in more than one diff entry)" : "";
  if (real.length) return { text: `${WARN} the authors differed here (${real.map((f) => f.path).join(", ")}) and no resolver decision mentions it${ambiguous}`, flagged: true };
  if (ambiguous) return { text: `${WARN} both authors agreed, but this id appears in more than one diff entry — check which row it is`, flagged: true };
  return { text: eq.length ? `both authors agreed (written differently, same catalog courses: ${eq.map((f) => f.path).join(", ")})` : "both authors agreed", flagged: false };
}

// ─── Markdown helpers ───────────────────────────────────────────────────────

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function quoteLines(quotes: string[]): string[] {
  if (!quotes.length) return [`${WARN} _no quote cited_`];
  return quotes.flatMap((q) => [`> ${oneLine(q)}`, ">"]).slice(0, -1);
}

function count<T>(xs: T[], f: (x: T) => boolean): number {
  return xs.filter(f).length;
}

// ─── Long course lists and extracted lists ──────────────────────────────────

/** A course list longer than this is shortened in a row description… */
export const COURSE_LIST_MAX = 12;
/** …to this many ids (sorted, as describeRule prints them) plus "… and N more". */
export const COURSE_LIST_HEAD = 8;

const isCourseLeaf = (v: unknown): v is { course: string[] } =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray((v as { course?: unknown }).course);

/** describeRow, with every course list longer than COURSE_LIST_MAX shortened.
 *  Each long list is swapped for a one-id placeholder before describing, then
 *  the placeholder is replaced by the list's first COURSE_LIST_HEAD ids in the
 *  order describeRule would print them (normalized, unique, sorted). */
export function describeRowShort(row: Row | ChildRow): string {
  const long: string[][] = [];
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (isCourseLeaf(v)) {
      const ids = [...new Set(v.course.map(normalizeCourseId))].sort();
      if (ids.length <= COURSE_LIST_MAX) return v;
      long.push(ids);
      return { course: [`ZZLONGLIST${long.length - 1}X`] };
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  let text = describeRow(swap(row) as Row | ChildRow);
  long.forEach((ids, i) => {
    const head = ids.slice(0, COURSE_LIST_HEAD).map((c) => c.replace("-", " ")).join(", ");
    text = text.split(`ZZLONGLIST${i}X`).join(`one of ${head} … and ${ids.length - COURSE_LIST_HEAD} more`);
  });
  return text;
}

/** Every course id a unit's row names in a { course } leaf (an anyOf parent's
 *  own fields only: its options are units of their own). */
export function namedCourses(row: Row | ChildRow): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (isCourseLeaf(v)) return v.course.forEach((c) => out.add(normalizeCourseId(c)));
    if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x);
  };
  if (row.kind === "anyOf") {
    const { rows: _options, ...own } = row;
    walk(own);
  } else walk(row);
  return out;
}

/** "from list L3 — 214 courses, under 'Electives' (lead: 'Select two of the following:')". */
export function describeList(list: CourseList): string {
  const heading = list.path.length ? list.path[list.path.length - 1] : "(no heading)";
  const lead = list.lead.length ? ` (lead: '${oneLine(list.lead[0].line)}')` : " (no lead line)";
  return `from list ${list.id} — ${list.courseIds.length} course${list.courseIds.length === 1 ? "" : "s"}, under '${oneLine(heading)}'${lead}`;
}

/** The sheet lines for a list-backed unit, and whether they flag it. */
function listLines(unit: RowUnit, refs: string[], extract: PageExtract | undefined): { lines: string[]; flagged: boolean } {
  const lines: string[] = [];
  let flagged = false;
  if (!extract) {
    for (const id of refs) lines.push(`- ${WARN} From list ${id}: cannot show it (no usable ${PROVENANCE_FILES.extract})`);
    return { lines, flagged: true };
  }
  const named = namedCourses(unit.row);
  for (const id of refs) {
    const list = extract.lists.find((l) => l.id === id);
    if (!list) {
      lines.push(`- ${WARN} From list ${id}: not in ${PROVENANCE_FILES.extract} (re-run expand-draft)`);
      flagged = true;
      continue;
    }
    lines.push(`- From: ${describeList(list)}`);
    const absent = list.courseIds.filter((c) => !named.has(normalizeCourseId(c)));
    if (absent.length) {
      flagged = true;
      const shown = absent.slice(0, COURSE_LIST_HEAD).join(", ");
      lines.push(
        `  - ${WARN} the row does not name ${absent.length} of the list's courses (${shown}${absent.length > COURSE_LIST_HEAD ? ` … and ${absent.length - COURSE_LIST_HEAD} more` : ""}): re-run expand-draft or fix listRefs`,
      );
    }
  }
  return { lines, flagged };
}

// ─── College reconcile (renamed rows) ───────────────────────────────────────

/** Merged row id → the id before the reconcile step renamed it (units keyed
 *  "<parent>/<child>"). */
function renameBackMap(reconcile: Phase2Reconcile | undefined): Map<string, string> {
  return new Map((reconcile?.renamed ?? []).map((r) => [r.to, r.from]));
}

/** The layer with every renamed row (and anyOf option) carrying its pre-rename
 *  id, in the same order: resolver decisions and the A/B diff name those ids. */
function layerWithOriginalIds(layer: Layer, back: Map<string, string>): Layer {
  if (!back.size) return layer;
  const part = (key: string, fallback: string) => (back.get(key) ?? "").split("/").pop() || fallback;
  return {
    ...layer,
    rows: layer.rows.map((r) => {
      const id = part(r.id, r.id);
      if (r.kind !== "anyOf") return { ...r, id };
      return { ...r, id, rows: r.rows.map((c) => ({ ...c, id: part(`${r.id}/${c.id}`, c.id) })) };
    }),
  } as Layer;
}

// ─── The sheet ──────────────────────────────────────────────────────────────

export type ReviewSummary = { flags: number; units: number };

/** The review sheet as markdown. Pure. */
export function buildReviewSheet(inputs: ReviewInputs): string {
  return buildReview(inputs).markdown;
}

export function buildReview(inputs: ReviewInputs): { markdown: string; summary: ReviewSummary } {
  const { merged, meta, verify, diff, resolution, golden, checkMerged, extract, extractError, reconcile, reconcileError } = inputs;
  const layer = merged.layer;
  const units = rowUnits(layer);
  const decisions = resolution?.decisions ?? [];
  const reconcileDecisions = reconcile?.decisions ?? [];
  const origLayer = layerWithOriginalIds(layer, renameBackMap(reconcile));
  const origUnits = rowUnits(origLayer);
  const thisHash = layerSha256(layer);
  const verdictByKey = new Map((verify?.verdicts ?? []).map((v) => [v.key, v]));
  const unitKeys = new Set(units.map((u) => u.key));
  let flags = 0;
  const L: string[] = [];

  // Title and source.
  L.push(`# Review: ${layer.name}`, "");
  L.push(`- Program: \`${merged.programId}\` · layer \`${layer.id}\` (${layer.family.toUpperCase()} ${layer.kind}) · catalog year ${layer.catalogYear}`);
  L.push(`- Page: ${meta?.url ?? merged.snapshot.url}`);
  if (meta) {
    L.push(`- Snapshot: fetched ${meta.fetchedAt.slice(0, 10)} (${meta.fetchedAt}) via ${meta.via}, HTTP ${meta.httpStatus}${meta.edition ? `, edition ${meta.edition}` : ""}`);
    L.push(`- Hash: text \`${meta.textSha256}\` · html \`${meta.htmlSha256}\``);
    if (meta.textSha256 !== merged.snapshot.textSha256) {
      flags++;
      L.push(`- ${WARN} **the merged layer was written from a different snapshot** (\`${merged.snapshot.textSha256}\`)`);
    }
  } else L.push(`- Snapshot: ${WARN} no snapshot/meta.json — text hash in the draft: \`${merged.snapshot.textSha256}\``);
  L.push("");

  // Status block.
  L.push("## Status", "");
  L.push(`- Rows: ${layer.rows.length} (${units.length} checkable units, counting each anyOf option)`);
  if (verify) {
    const vs = units.map((u) => verdictByKey.get(u.key));
    const nWrong = count(vs, (v) => v?.verdict === "wrong");
    const nUnsure = count(vs, (v) => v?.verdict === "unsure");
    const nCorrect = count(vs, (v) => v?.verdict === "correct");
    const nNone = count(vs, (v) => !v);
    const stale = (verify.verdicts ?? []).filter((v) => !unitKeys.has(v.key)).map((v) => v.key);
    L.push(
      `- Verifier: ${nCorrect} correct · ${nWrong ? `${WARN} ` : ""}${nWrong} wrong · ${nUnsure ? `${WARN} ` : ""}${nUnsure} unsure` +
        `${nNone ? ` · ${WARN} ${nNone} not verified` : ""}${stale.length ? ` · ${WARN} verdicts for rows not in this layer: ${stale.join(", ")}` : ""}`,
    );
    if (nWrong || nUnsure || nNone || stale.length) flags++;
    const vHash = (verify as { layerSha256?: string }).layerSha256;
    if (vHash !== thisHash) {
      L.push(`  - ${WARN} ${PROVENANCE_FILES.verify} ${vHash ? "was made on a different version of this layer" : "carries no layer hash"}: re-run the verifier on the layer as it is now`);
      flags++;
    }
    const missing = verify.missing ?? [];
    L.push(`- Requirements the verifier found missing from the layer: ${missing.length ? `${WARN} ${missing.length}` : "none"}`);
    for (const m of missing) L.push(`  - ${WARN} ${oneLine(m.reason)}`, `    > ${oneLine(m.quote)}`);
    if (missing.length) flags++;
  } else {
    flags++;
    L.push(`- Verifier: ${WARN} not run (no verify.json)`);
  }
  const open = decisions.filter((d) => d.needsMichael);
  const openReconcile = reconcileDecisions.filter((d) => d.needsMichael);
  const nOpen = open.length + openReconcile.length;
  L.push(`- Questions for Michael: ${nOpen ? `${WARN} ${nOpen} open` : "none"}`);
  if (nOpen) flags++;
  if (reconcileError) {
    L.push(`- ${WARN} Phase 2 reconcile: ${PHASE2_RECONCILE_FILE} cannot be used: ${oneLine(reconcileError)}`);
    flags++;
  } else if (reconcile) {
    L.push(`- Phase 2 reconcile: ${reconcileDecisions.length} decision(s), ${reconcile.renamed.length} row(s) renamed to the Phase 2 ids`);
    const unitKeySet = new Set(units.map((u) => u.key));
    const lost = reconcile.renamed.filter((r) => !unitKeySet.has(r.to));
    if (lost.length) {
      L.push(`  - ${WARN} renamed to rows the layer does not have: ${lost.map((r) => `${r.from} → ${r.to}`).join(", ")}`);
      flags++;
    }
  }
  if (diff) {
    // Every real difference and every "equivalent on the catalog" entry needs a
    // resolver decision: equivalents match the same courses today, not always tomorrow.
    const equivalent = diff.pairs.reduce((n, p) => n + p.differences.filter((d) => d.severity === "equivalent").length, 0);
    const needed = diff.realCount + equivalent;
    const short = decisions.length < needed;
    L.push(
      `- Blind drafts: ${diff.realCount} real difference(s) and ${equivalent} equivalent-on-the-catalog between the two authors; ` +
        `${short ? `${WARN} ` : ""}${decisions.length} resolver decision(s)${short ? ` (needs at least ${needed})` : ""}`,
    );
    if (short) flags++;
  } else L.push("- Blind drafts: no diff.json");
  if (golden?.layerHashes) {
    const want = golden.layerHashes[layer.id];
    if (want !== layerSha256(layer)) {
      L.push(`- ${WARN} Golden report was computed on ${want ? "a different version of" : "another"} layer: re-run check-golden-layer`);
      flags++;
    }
  }
  if (golden?.forbiddenCounted?.length) {
    L.push(`- ${WARN} Golden probes counted where the page forbids it: ${golden.forbiddenCounted.map((f) => `${f.courseId} in ${f.rowId}`).join(", ")}`);
    flags++;
  }
  if (golden) {
    L.push(
      `- Golden plan: ${golden.ok ? "ok" : `${WARN} NOT ok`} (${golden.pct}%)` +
        `${golden.unmetRows.length ? ` · unmet: ${golden.unmetRows.map((r) => `${r.rowId} (${r.status})`).join(", ")}` : ""}`,
    );
    if (golden.notLoadBearing.length) L.push(`  - ${WARN} courses the plan does not need (removing one still scores 100%): ${golden.notLoadBearing.join(", ")}`);
    if (golden.unknownCourses.length) L.push(`  - ${WARN} plan courses not in the catalog: ${golden.unknownCourses.join(", ")}`);
    if (!golden.ok || golden.notLoadBearing.length || golden.unknownCourses.length) flags++;
  } else L.push("- Golden plan: not run (no golden-report.json)");
  if (checkMerged) {
    L.push(`- Checks on the merged layer: ${checkMerged.ok ? "ok" : `${WARN} NOT ok`} (${checkMerged.errors.length} error(s), ${checkMerged.warnings.length} warning(s))`);
    for (const e of checkMerged.errors) L.push(`  - ${WARN} ${e.key ? `\`${e.key}\` ` : ""}${oneLine(e.message)}`);
    for (const w of checkMerged.warnings) L.push(`  - ${w.key ? `\`${w.key}\` ` : ""}${oneLine(w.message)}`);
    if (!checkMerged.ok || checkMerged.errors.length) flags++;
    const cHash = (checkMerged as { layerSha256?: string }).layerSha256;
    if (cHash !== thisHash) {
      L.push(`  - ${WARN} ${PROVENANCE_FILES.checkMerged} ${cHash ? "was made on a different version of this layer" : "carries no layer hash"}: re-run check-draft on the layer as it is now`);
      flags++;
    }
  } else L.push("- Checks on the merged layer: not run (no check-merged.json)");
  const listRefs = merged.listRefs ?? {};
  const listUnits = Object.keys(listRefs);
  if (extractError) {
    L.push(`- ${WARN} Extracted lists: ${PROVENANCE_FILES.extract} cannot be used: ${oneLine(extractError)}`);
    flags++;
  } else if (listUnits.length && !extract) {
    L.push(`- ${WARN} Extracted lists: the layer names extracted lists but there is no ${PROVENANCE_FILES.extract}`);
    flags++;
  } else if (listUnits.length && extract) {
    const ids = new Set(Object.values(listRefs).flat());
    L.push(`- Extracted lists: ${listUnits.length} unit(s) use ${ids.size} list(s) from ${PROVENANCE_FILES.extract}`);
    if (extract.textSha256 !== merged.snapshot.textSha256) {
      L.push(`  - ${WARN} ${PROVENANCE_FILES.extract} was made from a different snapshot than the merged layer`);
      flags++;
    }
  }
  const strayRefs = listUnits.filter((k) => !unitKeys.has(k));
  if (strayRefs.length) {
    L.push(`- ${WARN} listRefs name rows not in this layer: ${strayRefs.join(", ")}`);
    flags++;
  }
  L.push("");

  // Questions for Michael.
  if (nOpen) {
    L.push(`## ${WARN} Questions for Michael`, "");
    open.forEach((d, i) => L.push(`${i + 1}. **${d.ref}** — ${oneLine(d.explanation)}`));
    openReconcile.forEach((d, i) => L.push(`${open.length + i + 1}. **Phase 2 reconcile: ${d.ref}** (kept: ${d.chosen}) — ${oneLine(d.explanation)}`));
    L.push("");
  }

  // One block per unit.
  L.push("## Rows", "");
  for (const [unitAt, unit] of units.entries()) {
    const row = unit.row;
    const orig = origUnits[unitAt];
    const v = verdictByKey.get(unit.key);
    // Resolver decisions and the diff name the authors' ids, not the renamed ones.
    const ds = decisionsFor(orig, decisions, origLayer);
    const rds = reconcileDecisions.filter((d) => d.ref === unit.key || d.ref === orig.key);
    const unitFlag = v?.verdict === "wrong" || v?.verdict === "unsure" || ds.some((d) => d.needsMichael) || rds.some((d) => d.needsMichael);
    let origin: Origin | null = null;
    if (!ds.length) origin = diff ? originFromDiff(orig, diff, origLayer) : { text: "no diff on file", flagged: false };
    const fromLists = listRefs[unit.key] ? listLines(unit, listRefs[unit.key], extractError ? undefined : extract) : null;
    const flagged = unitFlag || !!origin?.flagged || !!fromLists?.flagged;
    if (flagged) flags++;

    L.push(`### ${flagged ? `${WARN} ` : ""}\`${unit.key}\` — ${row.label}`, "");
    L.push(`- Group: ${row.group} · Kind: ${row.kind}${unit.parentId ? ` · option of \`${unit.parentId}\`` : ""}`);
    L.push(`- Means: ${describeRowShort(row)}`);
    if (fromLists) L.push(...fromLists.lines);
    if (row.note) L.push(`- Note: ${oneLine(row.note)}`);
    L.push(`- Source: ${row.source.anchor}${row.source.url !== merged.snapshot.url ? ` (${row.source.url})` : ""}`);
    L.push("", ...quoteLines(quotesFor(merged, unit)), "");
    if (!v) L.push(`- Verifier: ${verify ? `${WARN} not verified` : "not verified"}`);
    else if (v.verdict === "correct") L.push(`- Verifier: correct — ${oneLine(v.reason)}`);
    else L.push(`- **${WARN} Verifier: ${v.verdict}** — ${oneLine(v.reason)}`);
    if (ds.length) {
      for (const d of ds)
        L.push(`- ${d.needsMichael ? `${WARN} **open question** — ` : ""}Resolved — chose ${d.chosen} (\`${d.ref}\`): ${oneLine(d.explanation)}`);
    } else if (origin) L.push(`- How it came to be: ${origin.text}`);
    if (orig.key !== unit.key) L.push(`- Renamed by the Phase 2 reconcile from \`${orig.key}\``);
    for (const d of rds)
      L.push(`- ${d.needsMichael ? `${WARN} **open question** — ` : ""}Phase 2 reconcile — kept ${d.chosen}: ${oneLine(d.explanation)}`);
    L.push("");
  }

  // Decision list.
  L.push("## Resolver decisions", "");
  if (!resolution) L.push("No resolution.json.");
  else if (!decisions.length) L.push("None (the authors agreed on everything).");
  decisions.forEach((d, i) => L.push(`${i + 1}. ${d.needsMichael ? `${WARN} ` : ""}\`${d.ref}\` — chose **${d.chosen}**${d.needsMichael ? " (needs Michael)" : ""}: ${oneLine(d.explanation)}`));
  L.push("");
  if (reconcile) {
    L.push("## Phase 2 reconcile decisions", "");
    if (!reconcileDecisions.length) L.push("None.");
    reconcileDecisions.forEach((d, i) =>
      L.push(`${i + 1}. ${d.needsMichael ? `${WARN} ` : ""}\`${d.ref}\` — kept **${d.chosen}**${d.needsMichael ? " (needs Michael)" : ""}: ${oneLine(d.explanation)}`),
    );
    L.push("");
  }

  return { markdown: L.join("\n"), summary: { flags, units: units.length } };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx review-sheet.ts --program <programId> [--dir <provenanceDir>] [--out <file>]";

export class InputError extends Error {}

function readJson<T>(path: string, required: boolean): T | undefined {
  if (!existsSync(path)) {
    if (required) throw new InputError(`missing ${path}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (e) {
    throw new InputError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Agent-written files are checked for the fields the sheet reads, so a
// malformed one is a clear input error (exit 2), never a crash mid-sheet.
const str = z.string();
const VerificationShape = z.object({
  programId: str,
  verdicts: z.array(z.object({ key: str, verdict: z.enum(["correct", "wrong", "unsure"]), reason: str })),
  missing: z.array(z.object({ quote: str, reason: str })).optional(),
});
const ResolutionShape = z.object({
  programId: str,
  decisions: z.array(z.object({ ref: str, chosen: z.enum(["a", "b", "neither", "both"]), explanation: str, needsMichael: z.boolean() })),
});
const ReconcileShape = z.object({
  decisions: z.array(z.object({ ref: str, chosen: z.enum(["merged", "phase2", "neither"]), explanation: str, needsMichael: z.boolean() })),
  renamed: z.array(z.object({ from: str, to: str })),
});
const GoldenShape = z.object({
  programId: str,
  ok: z.boolean(),
  pct: z.number(),
  unmetRows: z.array(z.object({ layerId: str, rowId: str, status: str })),
  notLoadBearing: z.array(str),
  unknownCourses: z.array(str),
  forbiddenCounted: z.array(z.object({ courseId: str, layerId: str, rowId: str })).optional(),
  layerHashes: z.record(str, str).optional(),
});

function checked<T>(value: unknown, shape: z.ZodType, path: string): T | undefined {
  if (value === undefined) return undefined;
  const r = shape.safeParse(value);
  if (!r.success) throw new InputError(`${path} has the wrong shape: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return value as T;
}

/** Every input the sheet reads from one provenance folder. Throws InputError. */
export function loadReviewInputs(base: string): ReviewInputs {
  const rawMerged = readJson<unknown>(join(base, PROVENANCE_FILES.merged), true);
  let merged: Draft;
  try {
    merged = parseDraft(rawMerged);
  } catch (e) {
    throw new InputError(`merged.json is not a valid draft: ${e instanceof Error ? e.message : String(e)}`);
  }
  const at = (f: string) => join(base, f);
  // A broken or stale extract is reported on the sheet (a flag), not thrown.
  let extract: PageExtract | undefined;
  let extractError: string | undefined;
  if (existsSync(at(PROVENANCE_FILES.extract))) {
    try {
      extract = loadVerifiedExtract(base);
      if (!Array.isArray(extract.lists)) throw new Error("it has no lists");
    } catch (e) {
      extract = undefined;
      extractError = e instanceof Error ? e.message : String(e);
    }
  }
  // phase2-reconcile.json: malformed is reported on the sheet (a flag), not thrown.
  let reconcile: Phase2Reconcile | undefined;
  let reconcileError: string | undefined;
  if (existsSync(at(PHASE2_RECONCILE_FILE))) {
    try {
      const r = ReconcileShape.safeParse(JSON.parse(readFileSync(at(PHASE2_RECONCILE_FILE), "utf-8")));
      if (!r.success) throw new Error(`wrong shape: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      reconcile = r.data;
    } catch (e) {
      reconcileError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    extract,
    extractError,
    reconcile,
    reconcileError,
    merged,
    meta: readJson<SnapshotMeta>(at(PROVENANCE_FILES.meta), false),
    verify: checked<Verification>(readJson(at(PROVENANCE_FILES.verify), false), VerificationShape, PROVENANCE_FILES.verify),
    diff: readJson<LayerDiff>(at(PROVENANCE_FILES.diffJson), false),
    resolution: checked<Resolution>(readJson(at(PROVENANCE_FILES.resolution), false), ResolutionShape, PROVENANCE_FILES.resolution),
    golden: checked<GoldenReport>(readJson(at(PROVENANCE_FILES.golden), false), GoldenShape, PROVENANCE_FILES.golden),
    checkMerged: readJson<CheckReport>(at(PROVENANCE_FILES.checkMerged), false),
  };
}

function main(): number {
  const args = process.argv.slice(2);
  let program: string | undefined;
  let dir: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === "--program") program = args[++i];
    else if (x === "--dir") dir = args[++i];
    else if (x === "--out") out = args[++i];
    else {
      console.error(`unexpected argument ${x}\n${USAGE}`);
      return 2;
    }
  }
  if (!program || (args.includes("--dir") && !dir) || (args.includes("--out") && !out)) {
    console.error(USAGE);
    return 2;
  }
  let base: string;
  try {
    base = dir ? resolve(dir) : provenanceDir(program);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  let inputs: ReviewInputs;
  try {
    inputs = loadReviewInputs(base);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (inputs.merged.programId !== program) console.warn(`note: merged.json is for ${inputs.merged.programId}, not ${program}`);

  const { markdown, summary } = buildReview(inputs);
  const outPath = out ? resolve(out) : join(base, PROVENANCE_FILES.review);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown);
  console.log(`wrote ${outPath}: ${summary.units} unit(s), ${summary.flags} flag(s)`);
  return summary.flags === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
