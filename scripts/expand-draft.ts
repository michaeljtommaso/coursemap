// scripts/expand-draft.ts
// Turns a draft SOURCE into a draft (spec 019 Phase 5). In a source, any course
// rule may name an extracted list instead of spelling its courses:
//
//   { "list": "L3" }            → { "course": [every course id of list L3] }
//   { "list": ["L3", "L4"] }    → { "course": [the courses of both, page order] }
//
// List ids come from extract.json (extract-catalog-page.ts), which is re-derived
// from page.html before use. The expanded draft records which lists each row
// used in `listRefs`; check-draft.ts accepts a referenced list as the citation
// for its courses, so a row backed by an 800-course table needs no 800 quotes.
//
//   npx tsx expand-draft.ts <draft.src.json> [--out <draft.json>]
//
// --out defaults to the source path without ".src" (draft-a.src.json → draft-a.json).
// Exit: 0 written, 1 refused (an unknown list, nothing written), 2 bad usage or unreadable input.

import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { provenanceDir, rowUnits, type Layer } from "./layer-authoring";
import { listCourses, loadVerifiedExtract, type PageExtract } from "./extract-catalog-page";

type Json = unknown;

function isListLeaf(v: Json): v is { list: string | string[] } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  return keys.length === 1 && keys[0] === "list";
}

/** A deep copy of `v` with every { list } leaf replaced; `used` collects list ids. */
export function expandValue(v: Json, ex: Pick<PageExtract, "lists">, used: Set<string>): Json {
  if (Array.isArray(v)) return v.map((x) => expandValue(x, ex, used));
  if (isListLeaf(v)) {
    const ids = Array.isArray(v.list) ? v.list : [v.list];
    if (!ids.length) throw new Error("an empty { list: [] }");
    const course: string[] = [];
    for (const id of ids) {
      used.add(id);
      for (const c of listCourses(ex, id)) if (!course.includes(c)) course.push(c);
    }
    return { course };
  }
  if (v && typeof v === "object") {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as object)) out[k] = expandValue(x, ex, used);
    return out;
  }
  return v;
}

/** The expanded draft object and its listRefs (unit key → list ids, sorted). */
export function expandDraft(src: Record<string, Json>, ex: Pick<PageExtract, "lists">): Record<string, Json> {
  const rawLayer = src.layer as { rows?: Json[] } | undefined;
  if (!rawLayer || !Array.isArray(rawLayer.rows)) throw new Error("the source has no layer.rows");
  const listRefs: Record<string, string[]> = {};
  const rows = rawLayer.rows.map((row) => {
    const r = row as { id?: string; kind?: string; rows?: Json[] };
    if (r.kind === "anyOf" && Array.isArray(r.rows)) {
      const children = r.rows.map((child) => {
        const used = new Set<string>();
        const out = expandValue(child, ex, used) as { id?: string };
        if (used.size) listRefs[`${r.id}/${out.id}`] = [...used].sort();
        return out;
      });
      const { rows: _rows, ...rest } = r;
      const usedTop = new Set<string>();
      const top = expandValue(rest, ex, usedTop) as Record<string, Json>;
      if (usedTop.size) listRefs[String(r.id)] = [...usedTop].sort();
      return { ...top, rows: children };
    }
    const used = new Set<string>();
    const out = expandValue(row, ex, used);
    if (used.size) listRefs[String(r.id)] = [...used].sort();
    return out;
  });
  const layer = { ...(rawLayer as object), rows } as unknown as Layer;
  // Every listRefs key must be a row unit (it is, by construction; this guards drift).
  const keys = new Set(rowUnits(layer).map((u) => u.key));
  for (const k of Object.keys(listRefs)) if (!keys.has(k)) throw new Error(`listRefs key ${k} is not a row unit`);
  const { listRefs: _old, ...rest } = src;
  return { ...rest, layer, ...(Object.keys(listRefs).length ? { listRefs } : {}) };
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
