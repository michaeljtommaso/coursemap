// scripts/expand-draft.ts
// Turns a draft SOURCE into a draft (spec 019 Phase 5). In a source, any course
// rule may name an extracted list instead of spelling its courses:
//
//   { "list": "L3" }            → { "course": [every course id of list L3] }
//   { "list": ["L3", "L4"] }    → { "course": [the courses of both, page order] }
//   { "list": "L3", "flatten": true }   same, with the author's assertion below
//
// OR / PAIRED ROWS. A list may hold "or" rows (alternatives) or "&" rows (two
// courses taken together). Flattened into a pool, credits or distribution rule
// (or a limit / category inside one) every course would count on its own, so
// alternatives or the two halves of a pair could be double-counted: a false
// green. expandDraft therefore REFUSES a { list } leaf whose list has such rows
// when the leaf sits anywhere inside a row of kind pool, credits or distribution,
// unless the leaf says "flatten": true (the author asserts every member counts
// individually). In a seat row (or an anyOf child that is a seat) a plain
// { list } stays allowed: a seat takes one course. The "flatten" key is dropped
// from the expanded layer; each opt-in is recorded in the draft as
// listFlatten: { "<unitKey>": ["L3"] } so reviewers see it.
//
// List ids come from extract.json (extract-catalog-page.ts), which is re-derived
// from page.html before use. The expanded draft records which lists each row
// used in `listRefs` (and the opt-ins in `listFlatten`); check-draft.ts accepts a referenced list as the citation
// for its courses, so a row backed by an 800-course table needs no 800 quotes.
//
//   npx tsx expand-draft.ts <draft.src.json> [--out <draft.json>]
//
// QUESTIONS (spec 020). A question's `courses` rule may name a list too; it is
// expanded the same way, never refused for or/paired rows (each matching course
// is asked about on its own), and not recorded in listRefs (keys are row units;
// a question carries its own Cornell quote). `answered` leaves pass through.
//
// --out defaults to the source path without ".src" (draft-a.src.json → draft-a.json).
// Exit: 0 written, 1 refused (an unknown list or an unflagged or/paired list in a counted rule; nothing written), 2 bad usage or unreadable input.

import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { provenanceDir, rowUnits, type Layer } from "./layer-authoring";
import { listCourses, loadVerifiedExtract, type PageExtract } from "./extract-catalog-page";

type Json = unknown;

function isListLeaf(v: Json): v is { list: string | string[]; flatten?: boolean } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  return keys.includes("list") && keys.every((k) => k === "list" || k === "flatten");
}

/** Where a leaf sits, so the or/paired refusal can name the row and the kind. */
export type ExpandCtx = {
  /** RowUnit key of the row being expanded. */
  key: string;
  /** The row's kind; pool, credits and distribution count courses individually. */
  rowKind: string;
  /** Collects the list ids of leaves that opted in with "flatten": true. */
  flattened: Set<string>;
};

const COUNTED_KINDS = new Set(["pool", "credits", "distribution"]);

/** A deep copy of `v` with every { list } leaf replaced; `used` collects list ids. */
export function expandValue(v: Json, ex: Pick<PageExtract, "lists">, used: Set<string>, ctx?: ExpandCtx): Json {
  if (Array.isArray(v)) return v.map((x) => expandValue(x, ex, used, ctx));
  if (isListLeaf(v)) {
    const ids = Array.isArray(v.list) ? v.list : [v.list];
    if (!ids.length) throw new Error("an empty { list: [] }");
    if (v.flatten !== undefined && v.flatten !== true) throw new Error(`row ${ctx?.key ?? "?"}: "flatten" must be true when present`);
    const course: string[] = [];
    for (const id of ids) {
      const alt = alternativeRow(ex, id);
      if (alt && ctx && COUNTED_KINDS.has(ctx.rowKind)) {
        if (v.flatten !== true)
          throw new Error(
            `row ${ctx.key}: list ${id} has ${alt.what} (\"${alt.line}\") but sits in a ${ctx.rowKind} row, where every member would count on its own; ` +
              `model the alternatives as a seat/anyOf, or write { "list": "${id}", "flatten": true } to assert each member counts individually`
          );
        ctx.flattened.add(id);
      }
      used.add(id);
      for (const c of listCourses(ex, id)) if (!course.includes(c)) course.push(c);
    }
    return { course };
  }
  if (v && typeof v === "object") {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as object)) out[k] = expandValue(x, ex, used, ctx);
    return out;
  }
  return v;
}

/** The first "or" or paired row of a list, if it has one. */
function alternativeRow(ex: Pick<PageExtract, "lists">, listId: string): { what: string; line: string } | null {
  const l = ex.lists.find((x) => x.id === listId);
  if (!l) return null; // listCourses reports the unknown list
  const r = l.rows.find((x) => x.kind === "or" || x.paired);
  if (!r) return null;
  return { what: r.kind === "or" ? 'an "or" row' : 'a paired ("&") row', line: r.line };
}

/** The expanded draft object and its listRefs (unit key → list ids, sorted). */
export function expandDraft(src: Record<string, Json>, ex: Pick<PageExtract, "lists">): Record<string, Json> {
  const rawLayer = src.layer as { rows?: Json[] } | undefined;
  if (!rawLayer || !Array.isArray(rawLayer.rows)) throw new Error("the source has no layer.rows");
  const listRefs: Record<string, string[]> = {};
  const listFlatten: Record<string, string[]> = {};
  const rows = rawLayer.rows.map((row) => {
    const r = row as { id?: string; kind?: string; rows?: Json[] };
    if (r.kind === "anyOf" && Array.isArray(r.rows)) {
      const children = r.rows.map((child) => {
        const used = new Set<string>();
        const key = `${r.id}/${(child as { id?: string }).id}`;
        const flattened = new Set<string>();
        const out = expandValue(child, ex, used, { key, rowKind: String((child as { kind?: string }).kind), flattened }) as { id?: string };
        if (used.size) listRefs[key] = [...used].sort();
        if (flattened.size) listFlatten[key] = [...flattened].sort();
        return out;
      });
      const { rows: _rows, ...rest } = r;
      const usedTop = new Set<string>();
      const flatTop = new Set<string>();
      const top = expandValue(rest, ex, usedTop, { key: String(r.id), rowKind: "anyOf", flattened: flatTop }) as Record<string, Json>;
      if (usedTop.size) listRefs[String(r.id)] = [...usedTop].sort();
      if (flatTop.size) listFlatten[String(r.id)] = [...flatTop].sort();
      return { ...top, rows: children };
    }
    const used = new Set<string>();
    const flattened = new Set<string>();
    const out = expandValue(row, ex, used, { key: String(r.id), rowKind: String(r.kind), flattened });
    if (used.size) listRefs[String(r.id)] = [...used].sort();
    if (flattened.size) listFlatten[String(r.id)] = [...flattened].sort();
    return out;
  });
  const rawQuestions = (rawLayer as { questions?: Json[] }).questions;
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.map((q, i) => expandValue(q, ex, new Set<string>(), { key: `questions[${i}]`, rowKind: "question", flattened: new Set<string>() }))
    : undefined;
  const layer = { ...(rawLayer as object), rows, ...(questions ? { questions } : {}) } as unknown as Layer;
  // Every listRefs key must be a row unit (it is, by construction; this guards drift).
  const keys = new Set(rowUnits(layer).map((u) => u.key));
  for (const k of [...Object.keys(listRefs), ...Object.keys(listFlatten)]) if (!keys.has(k)) throw new Error(`listRefs key ${k} is not a row unit`);
  const { listRefs: _old, listFlatten: _oldFlat, ...rest } = src;
  return { ...rest, layer, ...(Object.keys(listRefs).length ? { listRefs } : {}), ...(Object.keys(listFlatten).length ? { listFlatten } : {}) };
}

const USAGE = "usage: npx tsx expand-draft.ts <draft.src.json> [--out <draft.json>]";

export function runExpand(argv: string[]): number {
  const srcPath = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out");
  const outIdx = argv.indexOf("--out");
  if (!srcPath) {
    console.error(USAGE);
    return 2;
  }
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : srcPath.replace(/\.src\.json$/, ".json");
  if (!outPath || outPath === srcPath) {
    console.error(`cannot derive the output path from ${srcPath}; pass --out\n${USAGE}`);
    return 2;
  }
  let src: Record<string, Json>;
  try {
    src = JSON.parse(readFileSync(resolve(srcPath), "utf-8"));
  } catch (e) {
    console.error(`cannot read ${srcPath}: ${(e as Error).message}`);
    return 2;
  }
  let dir: string;
  try {
    const programId = typeof src.programId === "string" ? src.programId : "";
    dir = programId ? provenanceDir(programId) : dirname(resolve(srcPath));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  try {
    const ex = loadVerifiedExtract(dir);
    const out = expandDraft(src, ex);
    writeFileSync(resolve(outPath), `${JSON.stringify(out, null, 2)}\n`);
    const refs = (out.listRefs ?? {}) as Record<string, string[]>;
    console.log(`WROTE ${outPath}: ${Object.keys(refs).length} row(s) use extracted lists`);
    return 0;
  } catch (e) {
    console.error(`REFUSED: ${(e as Error).message} (nothing written)`);
    return 1;
  }
}

if (require.main === module) process.exit(runExpand(process.argv.slice(2)));
