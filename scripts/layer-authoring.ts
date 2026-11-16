// scripts/layer-authoring.ts
// The shared CONTRACT for the spec 019 Phase 4 authoring chain (D4, D12). Every
// authoring tool imports from here and nothing else defines these shapes:
//
//   snapshot-catalog-page.ts  saves a catalog page        → <prov>/snapshot/
//   check-draft.ts            schema + lint + quotes + catalog check of a draft
//   diff-layers.ts            two blind drafts, row by row → <prov>/diff.json|md
//   review-sheet.ts           one readable sheet per major → <prov>/review.md
//   check-golden-layer.ts     known-good plan scores 100%, any removal drops it
//   sample-rows.ts            seeded 150-row draw for the D16 hand check
//   author-layer.workflow.js  the Claude Code workflow that runs the chain
//   check-coverage.ts         (spec 047) every in-scope sentence in the ledger
//   check-overlap-fixture.ts  (spec 047) a minor's overlap limit binds
//   seed-minor-index.ts       (spec 047) catalog/minorIndex from promoted minors
//
// <prov> is docs/provenance/<programId>/ — PRIVATE (publish/private.txt). It
// holds everything that quotes Cornell: the page snapshot, both drafts (with
// their per-row quotes), the diff, the resolution, the verifier's verdicts and
// the review sheet. Public files (scripts/, seed-data/) carry only a row's
// `source.url` + `anchor` (a section heading), never catalog text.
//
// Provenance layout for one program (file names are part of the contract):
//   snapshot/page.html     the fetched page, as received
//   snapshot/page.txt      the requirement text authors read and quote from
//   snapshot/meta.json     SnapshotMeta
//   draft-a.json           Draft (author "a": row by row from the page)
//   draft-b.json           Draft (author "b": plain-English checklist first)
//   check-a.json / -b      CheckReport for each draft
//   diff.json / diff.md    LayerDiff
//   resolution.json        Resolution (resolver agent)
//   merged.json            Draft (author "merged"): the resolved layer
//   check-merged.json      CheckReport for the merged draft
//   verify.json            Verification (verifier agent)
//   golden-report.json     GoldenReport (check-golden-layer.ts)
//   review.md              the review sheet
// Minor layers (spec 047 D12) run the leaner single-author chain instead of the
// blind pair: one author writes merged.src.json directly (author "merged",
// framing "single-author") with a sentence `ledger`, and three more files join:
//   coverage.json          CoverageReport (check-coverage.ts): every in-scope
//                          extract block accounted for by the ledger
//   golden-overlap.json    OverlapFixture (check-overlap-fixture.ts): the minor
//                          with a real major whose overlap limit binds
//   overlap-report.json    OverlapReport for that fixture
// Hand-check draws live in docs/provenance/_handcheck/<family>-seed<N>.{md,json}.
//
// CLI conventions for every tool: run from scripts/ with `npx tsx <tool>.ts`;
// exit 0 = clean, 1 = findings or errors, 2 = bad usage or unreadable input.
// Pure functions are exported and exercised by a `<tool>.corpus.ts` with zero IO
// beyond temp dirs (house style: validate-layers.corpus.ts).

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { LayerSchema } from "../cornell-degree-planner/src/lib/schemas";
import { crossListedSubjectsLookup, matchCredits, withCrossListings } from "../cornell-degree-planner/src/lib/planner/matchAdapters";
import { courseMatchesRule } from "../cornell-degree-planner/src/lib/planner/distribution/rules";
import { questionRef } from "../cornell-degree-planner/src/lib/planner/questions/keys";
import { questionText } from "../cornell-degree-planner/src/lib/planner/questions/registry";
import type {
  ChildRow,
  CourseRule,
  DistCourse,
  Layer,
  Question,
  Row,
} from "../cornell-degree-planner/src/lib/planner/distribution/types";
import { canonicalStringify } from "./canonical-json";
import { loadCatalogDump, type CatalogCourse } from "./validate-layers";

export type { ChildRow, CourseRule, DistCourse, Layer, Question, Row };

// ─── Paths ──────────────────────────────────────────────────────────────────

export const REPO_ROOT = resolve(__dirname, "..");
export const PROVENANCE_ROOT = resolve(REPO_ROOT, "docs", "provenance");
export const HANDCHECK_DIR = resolve(PROVENANCE_ROOT, "_handcheck");
export const LAYERS_DIR = resolve(__dirname, "seed-data", "layers");
export const TEST_LAYERS_DIR = resolve(__dirname, "seed-data", "layers-test");
export const GOLDEN_LAYERS_DIR = resolve(__dirname, "seed-data", "golden", "layers");
/** Promoted minor layers (spec 047 D12), whatever their family: minors are
 *  fetched by id and never pick a college layer, so they get one folder. */
export const MINOR_LAYERS_DIR = resolve(LAYERS_DIR, "minors");
/** Promoted overlap fixtures (golden-overlap.json), one per minor. */
export const GOLDEN_OVERLAP_DIR = resolve(__dirname, "seed-data", "golden", "overlap");
/** The hand-kept part of catalog/minorIndex (seed-minor-index.ts). */
export const MINOR_INDEX_ENTRIES = resolve(__dirname, "seed-data", "minor-index.json");
/** The offline catalog authoring runs against (spec D13). Gitignored backup. */
export const DEFAULT_DUMP = resolve(__dirname, "backups", "catalog-backup-2026-10-18T17-22-10-228Z.json");

export function provenanceDir(programId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(programId)) throw new Error(`bad program id: ${programId}`);
  return resolve(PROVENANCE_ROOT, programId);
}

export const PROVENANCE_FILES = {
  snapshotDir: "snapshot",
  pageHtml: "snapshot/page.html",
  pageText: "snapshot/page.txt",
  meta: "snapshot/meta.json",
  /** PageExtract (extract-catalog-page.ts): the page's lists and sentences, numbered. */
  extract: "extract.json",
  /** Draft sources: a Draft whose rules may name an extracted list ({ list: "L3" });
   *  expand-draft.ts writes the matching draft-*.json / merged.json. */
  draftASrc: "draft-a.src.json",
  draftBSrc: "draft-b.src.json",
  mergedSrc: "merged.src.json",
  draftA: "draft-a.json",
  draftB: "draft-b.json",
  checkA: "check-a.json",
  checkB: "check-b.json",
  diffJson: "diff.json",
  diffMd: "diff.md",
  resolution: "resolution.json",
  merged: "merged.json",
  checkMerged: "check-merged.json",
  verify: "verify.json",
  /** The golden plan while it is being authored; promote-layer copies it to
   *  seed-data/golden/layers/<id>.json (public) only when the major is clean. */
  goldenFixture: "golden-fixture.json",
  golden: "golden-report.json",
  /** Targeted edits after verification (edit-ledger.ts): the per-row sign-offs,
   *  and the verified layer they are measured against. */
  edits: "edits.json",
  editBase: "edit-base.json",
  /** Minor layers: the sentence-coverage report (check-coverage.ts). */
  coverage: "coverage.json",
  /** Minor layers: the overlap fixture and its report (check-overlap-fixture.ts). */
  goldenOverlap: "golden-overlap.json",
  overlapReport: "overlap-report.json",
  /** Outputs of an earlier run, moved aside before a re-run's drafts. */
  previousDir: "previous",
  review: "review.md",
} as const;

// ─── Snapshot ───────────────────────────────────────────────────────────────

export type SnapshotMeta = {
  programId: string;
  url: string;
  /** ISO timestamp. */
  fetchedAt: string;
  /** How the page was fetched: plain request, or the free Jina reader after a
   *  bot challenge. Never a paid fetcher. */
  via: "direct" | "jina";
  httpStatus: number;
  title: string | null;
  /** "2026-2027" when the page names its edition. */
  edition: string | null;
  htmlSha256: string;
  textSha256: string;
  textChars: number;
};

// ─── Quotes ─────────────────────────────────────────────────────────────────

/** A quote fragment shorter than this (after normalizing) proves nothing. */
export const QUOTE_MIN_CHARS = 12;

/** The normal form quotes are compared in: NFKC, zero-width characters dropped,
 *  curly quotes straightened, every dash to "-", whitespace collapsed. Case is
 *  kept: a quote must match the page's wording, not just its letters. */
export function normalizeQuoteText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export type QuoteCheck = { fragment: string; found: boolean; tooShort: boolean };

/** Is each fragment on the page, word for word (in normal form)? */
export function checkQuote(pageText: string, fragments: string[]): QuoteCheck[] {
  const page = normalizeQuoteText(pageText);
  return fragments.map((fragment) => {
    const f = normalizeQuoteText(fragment);
    const tooShort = f.length < QUOTE_MIN_CHARS;
    return { fragment, found: !tooShort && page.includes(f), tooShort };
  });
}

// ─── Public text ────────────────────────────────────────────────────────────

/** Words in a row that public text may not share with the page. Eight words
 *  is a sentence fragment; course titles and headings are shorter. */
export const COPIED_RUN_WORDS = 8;

function words(s: string): string[] {
  return normalizeQuoteText(s).toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? [];
}

/** The first run of COPIED_RUN_WORDS consecutive words `text` shares with
 *  `pageText`, or null. Used to keep catalog sentences out of public files. */
export function copiedRun(text: string, pageText: string, n = COPIED_RUN_WORDS): string | null {
  const t = words(text);
  if (t.length < n) return null;
  const page = ` ${words(pageText).join(" ")} `;
  for (let i = 0; i + n <= t.length; i++) {
    const run = t.slice(i, i + n).join(" ");
    if (page.includes(` ${run} `)) return run;
  }
  return null;
}

/** Every author-written string of a layer that is published (the anchor is a
 *  page heading by design, so it is not included). */
export function publicTextFields(layer: Layer): { key?: string; where: string; text: string }[] {
  const out: { key?: string; where: string; text: string }[] = [{ where: "layer name", text: layer.name }];
  for (const unit of rowUnits(layer)) {
    const r = unit.row;
    out.push({ key: unit.key, where: `${unit.key} label`, text: r.label });
    out.push({ key: unit.key, where: `${unit.key} group`, text: r.group });
    if (r.note) out.push({ key: unit.key, where: `${unit.key} note`, text: r.note });
    if (r.kind === "distribution") for (const c of r.categories) out.push({ key: unit.key, where: `${unit.key} category ${c.id}`, text: c.label });
    if ((r.kind === "pool" || r.kind === "credits") && r.limits)
      r.limits.forEach((l, i) => l.label && out.push({ key: unit.key, where: `${unit.key} limit ${i} label`, text: l.label }));
  }
  return out;
}

// ─── Row units ──────────────────────────────────────────────────────────────

/** One checkable unit of a layer: a top-level row, or one child of an anyOf
 *  (keyed "<parentId>/<childId>"). anyOf parents are units too. Quotes, diffs,
 *  verdicts and the hand-check sample are all keyed by `key`. */
export type RowUnit = { key: string; row: Row | ChildRow; parentId?: string };

export function rowUnits(layer: Layer): RowUnit[] {
  const out: RowUnit[] = [];
  for (const row of layer.rows) {
    out.push({ key: row.id, row });
    if (row.kind === "anyOf") for (const child of row.rows) out.push({ key: `${row.id}/${child.id}`, row: child, parentId: row.id });
  }
  return out;
}

/** The quote fragments that back a unit: its own, else (anyOf child) its parent's. */
export function quotesFor(draft: Pick<Draft, "quotes">, unit: RowUnit): string[] {
  const own = draft.quotes[unit.key];
  if (own?.length) return own;
  return unit.parentId ? draft.quotes[unit.parentId] ?? [] : [];
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

export type AuthorId = "a" | "b" | "merged";

/** How a draft was written. "single-author" (spec 047 D12, minors): one author
 *  writes merged.src.json directly, checklist first, with a sentence ledger;
 *  no blind pair, no diff, no resolver. */
export type Framing = "row-by-row" | "checklist-first" | "resolved" | "single-author";
export const FRAMINGS = ["row-by-row", "checklist-first", "resolved", "single-author"] as const;

/** The quotes key for the layer's `sharing` field (spec 047 D7): the page's
 *  sentence(s) that set the overlap limit. Not a row unit. */
export const SHARING_QUOTE_KEY = "sharing";

/** Where a sentence-ledger entry sends a block: a row unit key ("row" or
 *  "parent/child"), or one of these. */
export const LEDGER_TARGETS = ["sharing", "eligibility", "out-of-scope"] as const;
export type LedgerTarget = (typeof LEDGER_TARGETS)[number];

/** One entry of the sentence ledger (check-coverage.ts). `block` is an
 *  extract.json block id ("P12", "T4"), a list id ("L3": every row of the list)
 *  or a heading id ("H5": every block of that section, up to the next heading
 *  of the same or a higher level). `to` is one target or several (a sentence
 *  that sets a limit AND names a course). `reason` is required for
 *  "eligibility" (what goes to the minor index, e.g. its notOpenTo) and
 *  "out-of-scope" (why the page text is not a requirement of this layer), and
 *  for "sharing" when the layer sets no sharing (why nothing is encoded). */
export type LedgerEntry = { block: string; to: string | string[]; reason?: string };

export type Draft = {
  schemaVersion: 1;
  /** The layer id this draft is for (= programId for a major). */
  programId: string;
  author: AuthorId;
  /** "opus", "fable", … — recorded, not interpreted. */
  model: string;
  framing: Framing;
  /** The snapshot the author read; must equal snapshot/meta.json's textSha256. */
  snapshot: { url: string; textSha256: string };
  layer: Layer;
  /** RowUnit key → verbatim fragments of snapshot/page.txt. Every top-level row
   *  needs at least one; anyOf children inherit their parent's. The key
   *  "sharing" (SHARING_QUOTE_KEY) backs the layer's `sharing` field, and may
   *  also hold the sentence that allows unlimited sharing when `sharing` is
   *  absent. */
  quotes: Record<string, string[]>;
  /** single-author drafts: every in-scope extract block → where it went
   *  (check-coverage.ts). */
  ledger?: LedgerEntry[];
  /** Author "b" writes its plain-English checklist here before encoding. */
  checklist?: string[];
  /** Ambiguities the author noticed and how it read them. */
  notes?: string[];
  /** Written by expand-draft.ts: RowUnit key → the extracted lists (extract.json
   *  ids) the unit's rules were expanded from. Those lists' courses count as
   *  cited by the page itself. A "<programId>:L3" id is a list of another
   *  program's saved page (same catalog edition; withForeignLists). */
  listRefs?: Record<string, string[]>;
  /** Written by expand-draft.ts: RowUnit key → extracted lists that hold "or" or
   *  paired ("&") rows and were flattened into a counting rule on purpose
   *  ({ list, flatten: true }). Shown to reviewers: each member counts alone. */
  listFlatten?: Record<string, string[]>;
  /** RowUnit key → a plain explanation of how a number the row encodes follows
   *  from the page without any quote stating it ("the remaining 3 of 12").
   *  check-draft.ts downgrades that unit's unstated-number errors to warnings. */
  derivedNumbers?: Record<string, string>;
};

/** A listRefs / listFlatten id: this page's list ("L3"), or another program's
 *  saved page's list ("cornell-music-ba-2026:L3", extract-catalog-page.ts withForeignLists). */
export const LIST_REF_ID = /^(?:[a-z0-9][a-z0-9-]{0,100}:)?L\d+$/;

export const DraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    programId: z.string().min(1),
    author: z.enum(["a", "b", "merged"]),
    model: z.string().min(1),
    framing: z.enum(FRAMINGS),
    snapshot: z.object({ url: z.string().url(), textSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    layer: LayerSchema,
    quotes: z.record(z.string(), z.array(z.string().min(1)).min(1)),
    checklist: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional(),
    listFlatten: z.record(z.string(), z.array(z.string().regex(LIST_REF_ID)).min(1)).optional(),
    derivedNumbers: z.record(z.string(), z.string().min(1)).optional(),
    listRefs: z.record(z.string(), z.array(z.string().regex(LIST_REF_ID)).min(1)).optional(),
    ledger: z
      .array(
        z
          .object({
            block: z.string().regex(/^[HPTL][0-9]+$/, 'a block id ("P12", "T4"), list id ("L3") or heading id ("H5")'),
            to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
            reason: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function parseDraft(raw: unknown): Draft {
  return DraftSchema.parse(raw) as unknown as Draft;
}

export function readDraft(path: string): Draft {
  return parseDraft(JSON.parse(readFileSync(path, "utf-8")));
}

/** A file that is either a bare Layer or a Draft envelope → the Layer. */
export function readLayerOrDraft(path: string): Layer {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const layer = raw && typeof raw === "object" && "layer" in raw ? raw.layer : raw;
  return LayerSchema.parse(layer) as Layer;
}

// ─── Check report (check-draft.ts) ──────────────────────────────────────────

export type Finding = { code: string; key?: string; message: string };
export type CheckReport = {
  draft: string;
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
  /** layerSha256() of the draft's layer when the check ran (absent when the
   *  draft failed the schema), so a report left over from another version of
   *  the layer is detectable. */
  layerSha256?: string;
};

// ─── Diff (diff-layers.ts) ──────────────────────────────────────────────────

/** real: the two drafts mean different things. equivalent: written differently
 *  but match the same catalog courses (needs --dump; shown, not counted).
 *  harmless: ids, labels, headings, notes, order. */
export type DiffSeverity = "real" | "equivalent" | "harmless";

export type FieldDiff = { path: string; a: unknown; b: unknown; severity: DiffSeverity; note?: string };

export type RowSide = { key: string; kind: string; label: string; anchor: string; quotes: string[] };

export type RowPair = { a: RowSide; b: RowSide; differences: FieldDiff[] };

export type LayerDiff = {
  programId: string;
  layerFields: FieldDiff[];
  pairs: RowPair[];
  onlyA: RowSide[];
  onlyB: RowSide[];
  /** Real differences in total: real field diffs + unpaired rows. 0 = agree. */
  realCount: number;
};

// ─── Resolution (resolver agent) and verification (verifier agent) ─────────

export type Resolution = {
  programId: string;
  decisions: {
    /** Which disagreement, copied from diff.md's `ref:` line: "pair <aKey>~<bKey> <path>"
     *  (anyOf options: path "rows[<aChild>~<bChild>].<field>", or "rows[<child>~]" /
     *  "rows[~<child>]" for an option only one author wrote), "onlyA <key>",
     *  "onlyB <key>", "layer <path>"; "added <key>" for a row a recorded decision
     *  (Michael's answer to an open question) adds after the diff. */
    ref: string;
    chosen: "a" | "b" | "neither" | "both";
    /** Grounded in the cited sentence; quote fragments may be repeated here. */
    explanation: string;
    /** Could not be settled from the page: goes to Michael. */
    needsMichael: boolean;
  }[];
};

export type Verdict = "correct" | "wrong" | "unsure";

export type Verification = {
  programId: string;
  /** One verdict per RowUnit of merged.json, keyed like the quotes. */
  verdicts: { key: string; verdict: Verdict; reason: string }[];
  /** Requirements on the page the layer leaves out, each with its verbatim quote. */
  missing?: { quote: string; reason: string }[];
  /** layerSha256() of the merged layer the verdicts were made on. */
  layerSha256?: string;
};

// ─── Golden (check-golden-layer.ts) ─────────────────────────────────────────

export type GoldenReport = {
  programId: string;
  ok: boolean;
  pct: number;
  /** Checkable rows (not confirm) that are not met by the full plan. */
  unmetRows: { layerId: string; rowId: string; status: string }[];
  /** Courses whose removal leaves the plan at 100% (plan slack, or a layer too loose). */
  notLoadBearing: string[];
  /** Plan course ids absent from the fixture's course data / the catalog. */
  unknownCourses: string[];
  /** Negative probes (fixture `mustNotCount`) a row counted anyway: the layer is
   *  looser than the page there. */
  forbiddenCounted?: { courseId: string; layerId: string; rowId: string }[];
  /** Only when the fixture has `answers` (spec 020 questions): rows met only
   *  because of them, with their status without answers and the answer keys
   *  whose removal alone drops each. The reviewer checks the page leaves each
   *  of these to the student or department. */
  metByAnswer?: { layerId: string; rowId: string; without: string; answers: string[] }[];
  /** "yes" / credit answers whose removal leaves every row met (a failure). */
  answersNotLoadBearing?: string[];
  /** Answers that do not fit the layers or plan (a failure). */
  answerProblems?: string[];
  /** layerId → layerSha256() of the layer this report was computed on, so a
   *  report left over from an earlier version of the layer is detectable. */
  layerHashes?: Record<string, string>;
};

/** A stable hash of a layer's content (key order does not matter). */
export function layerSha256(layer: Layer): string {
  return createHash("sha256").update(canonicalStringify(layer)).digest("hex");
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/** "MATH 1910" / "math-1910" → "MATH-1910". */
export function normalizeCourseId(id: string): string {
  return id.trim().toUpperCase().replace(/\s+/g, "-");
}

function sortedUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

/** One normal form per meaning, as far as syntax shows it: nested same-kind
 *  groups flattened, children deduped and sorted, one-child groups unwrapped,
 *  double negation removed, leaf lists sorted and deduped, course ids
 *  normalized, default flags dropped. Two rules with the same canonical form
 *  match the same courses; different forms may still (compare on a catalog). */
export function canonicalRule(rule: CourseRule): CourseRule {
  if ("allOf" in rule || "anyOf" in rule) {
    const op = "allOf" in rule ? "allOf" : "anyOf";
    const kids = ("allOf" in rule ? rule.allOf : rule.anyOf).map(canonicalRule);
    const flat: CourseRule[] = [];
    for (const k of kids) {
      if (op in k) flat.push(...((k as Record<string, CourseRule[]>)[op]));
      else flat.push(k);
    }
    const byKey = new Map<string, CourseRule>();
    for (const k of flat) byKey.set(canonicalStringify(k), k);
    const uniq = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, k]) => k);
    if (uniq.length === 1) return uniq[0];
    return (op === "allOf" ? { allOf: uniq } : { anyOf: uniq }) as CourseRule;
  }
  if ("not" in rule) {
    const inner = canonicalRule(rule.not);
    return "not" in inner ? inner.not : { not: inner };
  }
  if ("tag" in rule) return { tag: sortedUnique(rule.tag) };
  if ("subject" in rule) {
    const out: { subject: string[]; crossListed?: boolean } = { subject: sortedUnique(rule.subject.map((s) => s.trim().toUpperCase())) };
    if (rule.crossListed) out.crossListed = true;
    return out;
  }
  if ("number" in rule) {
    const n: { min?: number; max?: number } = {};
    if (rule.number.min != null) n.min = rule.number.min;
    if (rule.number.max != null) n.max = rule.number.max;
    return { number: n };
  }
  if ("course" in rule) return { course: sortedUnique(rule.course.map(normalizeCourseId)) };
  if ("creditKind" in rule) return { creditKind: [...new Set(rule.creditKind)].sort() };
  if ("examScore" in rule) return { examScore: { exam: sortedUnique(rule.examScore.exam), scores: sortedUnique(rule.examScore.scores) } };
  if ("program" in rule) return { program: sortedUnique(rule.program) };
  return rule;
}

export function ruleKey(rule: CourseRule): string {
  return canonicalStringify(canonicalRule(rule));
}

// ─── Catalog ────────────────────────────────────────────────────────────────

/** A catalog course as the board would place it (credits via the app's own
 *  matchCredits: a fixed 0–0 course counts 0, missing data counts 3). */
export function catalogToDist(c: CatalogCourse): DistCourse {
  const min = c.creditsMin ?? 0;
  const max = c.creditsMax ?? min;
  const out: DistCourse = {
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title ?? null,
    attrs: (c.attrs ?? []).map((a) => ({ value: a.value })),
    credits: matchCredits(min, max, true),
  };
  if (max > min) out.creditsMax = max;
  return out;
}

export type DistCatalog = { courses: DistCourse[]; byId: Map<string, DistCourse> };

/** The committed cross-listing maps the app reads from catalog/meta: aliases
 *  (seed-aliases.ts) and roster cross-listings (seed-cross-listings.ts). */
export const ALIASES_FILE = resolve(__dirname, "seed-data", "aliases.json");
export const CROSS_LISTINGS_FILE = resolve(__dirname, "seed-data", "cross-listings.json");

/** The alias map carrying the roster cross-listings, exactly as CatalogProvider
 *  builds it, from the committed seed files ({} when absent). */
export function seededAliasMap(files: { aliases?: string; crossListings?: string } = {}): Record<string, string> {
  const aliasesFile = files.aliases ?? ALIASES_FILE;
  const crossFile = files.crossListings ?? CROSS_LISTINGS_FILE;
  const aliases = existsSync(aliasesFile) ? (JSON.parse(readFileSync(aliasesFile, "utf-8")) as Record<string, string>) : {};
  const cross = existsSync(crossFile) ? (JSON.parse(readFileSync(crossFile, "utf-8")) as { crossListings?: Record<string, string> }).crossListings : undefined;
  return withCrossListings(aliases, cross);
}

/** Give each course the cross-listed subjects the app gives it on the board
 *  (matchAdapters' crossListedSubjectsLookup over the seeded maps). */
export function withCrossListedSubjects(courses: DistCourse[], aliasMap: Record<string, string>): DistCourse[] {
  const lookup = crossListedSubjectsLookup(aliasMap);
  return courses.map((c) => {
    const subjects = lookup(c.id, c.subject);
    return subjects ? { ...c, crossListedSubjects: subjects } : c;
  });
}

/** The catalog dump as board courses. Each course carries the cross-listed
 *  subjects the app derives from the committed alias and cross-listing maps
 *  (`crossListings: false` leaves them off). */
export function loadDistCatalog(dumpPath: string = DEFAULT_DUMP, opts: { crossListings?: boolean } = {}): DistCatalog {
  if (!existsSync(dumpPath)) throw new Error(`catalog dump not found: ${dumpPath}`);
  let courses = loadCatalogDump(dumpPath).map(catalogToDist);
  if (opts.crossListings !== false) courses = withCrossListedSubjects(courses, seededAliasMap());
  return { courses, byId: new Map(courses.map((c) => [c.id, c])) };
}

/** Ids of every catalog course the rule matches, sorted (the app's evaluator). */
export function matchingIds(rule: CourseRule, catalog: DistCatalog, programId: string | null = null): string[] {
  return catalog.courses
    .filter((c) => courseMatchesRule(c, rule, { programId }))
    .map((c) => c.id)
    .sort();
}

// ─── Plain English (review sheet, hand-check sheet) ─────────────────────────

const KIND_TEXT: Record<string, string> = { ap: "AP", ib: "IB", alevel: "A-Level", intl: "international exam", transfer: "transfer", placement: "placement" };

// ─── Sharing (spec 047 D7) ──────────────────────────────────────────────────

type SharingLimitLike = "none" | "forbidden" | { maxCourses?: number; maxCredits?: number; with?: string[] };

function describeLimit047(limit: SharingLimitLike): string {
  if (limit === "none") return "no course may count for both";
  if (limit === "forbidden") return "cannot be combined with any second major";
  const caps: string[] = [];
  if (limit.maxCourses != null) caps.push(`at most ${plural(limit.maxCourses, "course")}`);
  if (limit.maxCredits != null) caps.push(`at most ${plural(limit.maxCredits, "credit")}`);
  const cap = caps.length ? `${caps.join(" and ")} may count for both` : "no cap";
  return limit.with?.length ? `${cap}, only with ${limit.with.join(", ")} (no cap with any other program)` : cap;
}

/** A layer's `sharing` in words, one line per field; [] when absent. On a
 *  minor layer `otherMajors` means any major on the plan and `minors` another
 *  minor; on a major layer, a second major and a minor. */
export function describeSharing(layer: Pick<Layer, "kind" | "sharing">): string[] {
  const s = layer.sharing;
  if (!s) return [];
  const out: string[] = [];
  const minor = layer.kind === "minor";
  if (s.otherMajors !== undefined) out.push(`${minor ? "With any major on the plan" : "With a second major"}: ${describeLimit047(s.otherMajors)}`);
  if (s.minors !== undefined) out.push(`${minor ? "With another minor" : "With a minor"}: ${describeLimit047(s.minors)}`);
  if (s.forbiddenWith?.length) out.push(`Cannot be combined with: ${s.forbiddenWith.join(", ")}`);
  return out;
}

// ─── Questions (spec 020 D9) ────────────────────────────────────────────────

/** Question ref → the question's prompt in the app's wording, so an
 *  `answered` leaf reads as the question it names. */
export type QuestionLookup = (ref: string) => string | undefined;

/** A question's course rule as a course label: "ENGL 2860 or ENGL 2880" for a
 *  short list, else the rule in words. */
function coursesLabel(rule: CourseRule): string {
  const r = canonicalRule(rule);
  if ("course" in r) {
    const codes = r.course.map((c) => c.replace("-", " "));
    if (codes.length === 1) return codes[0];
    if (codes.length <= 3) return `${codes.slice(0, -1).join(", ")} or ${codes[codes.length - 1]}`;
    return `one of ${codes.join(", ")}`;
  }
  return `a course (${describeRule(r)})`;
}

/** The label of a row (top-level or an anyOf option) by id. */
function rowLabel(layer: Pick<Layer, "rows">, id: string): string | undefined {
  for (const row of layer.rows) {
    if (row.id === id) return row.label;
    if (row.kind === "anyOf") for (const c of row.rows) if (c.id === id) return c.label;
  }
  return undefined;
}

/** The prompt the app shows for a question (questions/registry.ts wording),
 *  with the labels the layer itself gives: the target row's label, the course
 *  rule as a course label, the layer's name for its own program. */
export function questionPrompt(layer: Pick<Layer, "id" | "kind" | "name" | "programId" | "rows">, q: Question): string {
  const row = "row" in q && q.row ? rowLabel(layer, q.row) : undefined;
  const course = "courses" in q ? coursesLabel(q.courses) : undefined;
  const program = q.type === "studentFact" && layer.programId != null && q.subject === layer.programId ? layer.name : undefined;
  return questionText(q, { row, course, program }).prompt;
}

export function questionLookup(layer: Pick<Layer, "id" | "kind" | "name" | "programId" | "rows" | "questions">): QuestionLookup {
  const prompts = new Map<string, string>();
  for (const q of layer.questions ?? []) prompts.set(questionRef(layer.id, q), questionPrompt(layer, q));
  return (ref) => prompts.get(ref);
}

/** A question in words: its type and parameters, then the app's prompt. */
export function describeQuestion(layer: Pick<Layer, "id" | "kind" | "name" | "programId" | "rows">, q: Question): string {
  const parts: string[] = [];
  switch (q.type) {
    case "usedAs":
      parts.push(`usedAs → row ${q.row}; courses: ${describeRule(q.courses)}; a yes counts the course there and nowhere else`);
      break;
    case "approvedFor":
      parts.push(`approvedFor (${q.approver}) → row ${q.row}; courses: ${describeRule(q.courses)}`);
      break;
    case "courseCondition":
      parts.push(`courseCondition (${q.condition}) → row ${q.row}; courses: ${describeRule(q.courses)}`);
      break;
    case "creditsTaken":
      parts.push(`creditsTaken: ${q.course.replace("-", " ")} at ${q.values.join(" / ")} credits (every row)`);
      break;
    case "sequenceDone":
      parts.push(`sequenceDone: ${q.sequence.map((c) => c.replace("-", " ")).join(", ")} → ${q.course.replace("-", " ")} counts ${plural(q.credits, "credit")}`);
      break;
    case "studentFact":
      parts.push(`studentFact (${q.fact}, ${q.subject})${q.row ? ` → row ${q.row}` : ""}`);
      break;
  }
  return `${parts[0]}. Asks: "${questionPrompt(layer, q)}"`;
}

/** A rule in words, mechanically. Not pretty; unambiguous. With `questions`
 *  (questionLookup(layer)), an `answered` leaf shows the question's prompt. */
export function describeRule(rule: CourseRule, questions?: QuestionLookup): string {
  const r = canonicalRule(rule);
  const sub = (x: CourseRule) => describeRule(x, questions);
  if ("allOf" in r) return r.allOf.map(sub).map((s) => `(${s})`).join(" and ");
  if ("anyOf" in r) return r.anyOf.map(sub).map((s) => `(${s})`).join(" or ");
  if ("not" in r) return `not (${sub(r.not)})`;
  if ("answered" in r) {
    const prompt = questions?.(r.answered);
    return prompt ? `answered yes: "${prompt}"` : `answered yes: ${r.answered}`;
  }
  if ("tag" in r) return `tagged ${r.tag.join(" or ")}`;
  if ("subject" in r) return `${r.subject.join("/")} courses${r.crossListed ? " (cross-listings count)" : ""}`;
  if ("number" in r) {
    const { min, max } = r.number;
    if (min != null && max != null) return `numbered ${min}–${max}`;
    if (min != null) return `numbered ${min} or higher`;
    return `numbered ${max} or lower`;
  }
  if ("course" in r) return r.course.length === 1 ? r.course[0].replace("-", " ") : `one of ${r.course.map((c) => c.replace("-", " ")).join(", ")}`;
  if ("pattern" in r) return `matching ${r.pattern}`;
  if ("titleStartsWith" in r) return `titled "${r.titleStartsWith}…"`;
  if ("minCredits" in r) return `worth at least ${r.minCredits} credits`;
  if ("variableCredit" in r) return "variable-credit";
  if ("creditKind" in r) return `${r.creditKind.map((k) => KIND_TEXT[k] ?? k).join("/")} credit`;
  if ("examScore" in r) return `exam credit from ${r.examScore.exam.join(" or ")} at ${r.examScore.scores.join("/")}`;
  if ("program" in r) return `for students in ${r.program.join(", ")}`;
  return JSON.stringify(r);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Which subjects share one department cap: "departments: FREN+ITAL; GERST+DUTCH". */
function describeSubjectGroups(groups: string[][] | undefined): string | null {
  if (!groups?.length) return null;
  return `departments: ${groups.map((g) => g.join("+")).join("; ")}`;
}

/** The per-department cap, with the shared departments when subjectGroups is set. */
function describeDepartmentCap(maxPerSubject: number | undefined, groups: string[][] | undefined): string | null {
  const shared = describeSubjectGroups(groups);
  if (maxPerSubject == null) return shared;
  return `at most ${maxPerSubject} per department${shared ? ` (${shared})` : ""}`;
}

/** A row in words: what it requires, then its flags. `questions` as for describeRule. */
export function describeRow(row: Row | ChildRow, questions?: QuestionLookup): string {
  const rule = (r: CourseRule) => describeRule(r, questions);
  const flags: string[] = [];
  if (row.exclusive) flags.push("counts for nothing else");
  if (row.overlay) flags.push("does not use courses up");
  if (row.appliesTo) flags.push(`only for: ${row.appliesTo.map((c) => canonicalStringify(c)).join(" or ")}`);
  const tail = flags.length ? ` [${flags.join("; ")}]` : "";
  switch (row.kind) {
    case "seat":
      return `One course: ${rule(row.rule)}${row.credits != null ? ` (counts ${plural(row.credits, "credit")})` : ""}.${tail}`;
    case "pool": {
      const parts = [`${plural(row.requiredCourses, "course")} and ${plural(row.requiredCredits, "credit")} from: ${rule(row.rule)}`];
      const cap = describeDepartmentCap(row.maxPerSubject, row.subjectGroups);
      if (cap) parts.push(cap);
      for (const l of row.limits ?? []) parts.push(describeLimit(l, questions));
      return `${parts.join("; ")}.${tail}`;
    }
    case "distribution": {
      const cats = row.categories.map((c) => `${c.label} = ${rule(c.rule)}`).join("; ");
      const parts = [`${plural(row.requiredCourses, "course")} across at least ${plural(row.minDistinctCategories, "category", "categories")}`];
      if (row.rule) parts.push(`each ${rule(row.rule)}`);
      if ((row.maxCategoriesPerCourse ?? 1) > 1) parts.push(`a course may fill up to ${row.maxCategoriesPerCourse} categories`);
      if (row.maxDoubleCountCourses != null) parts.push(`at most ${plural(row.maxDoubleCountCourses, "course")} may double count`);
      const cap = describeDepartmentCap(row.maxPerSubject, row.subjectGroups);
      if (cap) parts.push(cap);
      for (const [id, mm] of Object.entries(row.perCategory ?? {})) {
        const label = row.categories.find((c) => c.id === id)?.label ?? id;
        parts.push(`${label}: ${mm.min != null ? `min ${mm.min}` : ""}${mm.min != null && mm.max != null ? ", " : ""}${mm.max != null ? `max ${mm.max}` : ""}`);
      }
      return `${parts.join("; ")}. Categories: ${cats}.${tail}`;
    }
    case "credits": {
      const parts = [`${plural(row.requiredCredits, "credit")} from: ${rule(row.rule)}`];
      if (row.sameSubject) parts.push("all in one subject");
      for (const l of row.limits ?? []) parts.push(describeLimit(l, questions));
      return `${parts.join("; ")}.${tail}`;
    }
    case "anyOf":
      return `Any one of: ${row.rows.map((c) => `"${c.label}"`).join(", ")}.${tail}`;
    case "confirm":
      return `Not checkable: confirm with an advisor.${tail}`;
  }
}

function describeLimit(l: NonNullable<Extract<Row, { kind: "pool" }>["limits"]>[number], questions?: QuestionLookup): string {
  const b: string[] = [];
  if (l.minCourses != null) b.push(`at least ${plural(l.minCourses, "course")}`);
  if (l.maxCourses != null) b.push(`at most ${plural(l.maxCourses, "course")}`);
  if (l.minCredits != null) b.push(`at least ${plural(l.minCredits, "credit")}`);
  if (l.maxCredits != null) b.push(`at most ${plural(l.maxCredits, "credit")}`);
  return `${b.join(", ")} ${describeRule(l.rule, questions)}`;
}
