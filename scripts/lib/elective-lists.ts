// scripts/lib/elective-lists.ts
// Shared helpers for the per-major elective-list builders (build-orie-electives.ts,
// build-cs-electives.ts): prerequisite-tree walking, the transitive "reaches"
// closure, the byte-preserving courseIds splice into programs.json, and the
// newest-catalog-backup lookup. Offline only.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Mirrors ElectiveGroupSchema's courseIds cap in cornell-degree-planner/src/lib/schemas.ts. */
export const COURSE_IDS_CAP = 2000;

export type CatalogCourse = {
  id: string;
  subject: string;
  number: string;
  creditsMin?: number | null;
  creditsMax?: number | null;
  prereqExpr?: unknown;
  coreqExpr?: unknown;
  prereqText?: string | null;
  coreqText?: string | null;
};

export const subjectOf = (id: string) => id.split("-")[0];
export const numberOf = (c: { number: string }) => parseInt(c.number, 10);

/** Every course id a prerequisite tree names (course, concurrent, advisory inner).
 *  "advisory" nodes are real prerequisites with an escape hatch ("or permission
 *  of instructor", "or equivalent"), so they count. */
export function prereqIds(expr: unknown, out: Set<string> = new Set(), seen: Set<unknown> = new Set()): Set<string> {
  if (!expr || typeof expr !== "object" || seen.has(expr)) return out;
  seen.add(expr);
  const e = expr as Record<string, unknown>;
  if ((e.type === "course" || e.type === "concurrent") && typeof e.id === "string") out.add(e.id);
  if (e.type === "advisory") prereqIds(e.expr, out, seen);
  if (Array.isArray(e.children)) for (const c of e.children) prereqIds(c, out, seen);
  return out;
}

/** Does this course's prerequisite tree reach any target, directly or through
 *  other courses' prerequisites? Memoized; cycles read as "no". Prerequisites
 *  only (ORIE's rule); CS's builder walks corequisites too, with its own walk. */
export function makeReaches(courses: Map<string, CatalogCourse>) {
  const memo = new Map<string, Set<string>>();
  const closure = (id: string, stack: Set<string>): Set<string> => {
    const hit = memo.get(id);
    if (hit) return hit;
    if (stack.has(id)) return new Set();
    stack.add(id);
    const out = new Set<string>();
    for (const p of prereqIds(courses.get(id)?.prereqExpr)) {
      out.add(p);
      for (const q of closure(p, stack)) out.add(q);
    }
    stack.delete(id);
    memo.set(id, out);
    return out;
  };
  return (id: string, targets: readonly string[]) => {
    const all = closure(id, new Set());
    return targets.some((t) => all.has(t));
  };
}

/**
 * Replace one group's "courseIds": [...] array in the programs.json TEXT, leaving
 * every other byte alone (the file mixes inline and expanded formatting, so a
 * parse-and-reprint would rewrite all of it). The group is found by its id line
 * within the given program's block.
 */
export function spliceCourseIds(text: string, programId: string, groupId: string, ids: readonly string[]): string {
  const progAt = text.indexOf(`"id": "${programId}"`);
  if (progAt < 0) throw new Error(`program ${programId} not found`);
  const groupAt = text.indexOf(`"id": "${groupId}"`, progAt);
  if (groupAt < 0) throw new Error(`group ${groupId} not found in ${programId}`);
  const keyAt = text.indexOf(`"courseIds": [`, groupAt);
  const nextObj = text.indexOf(`"id": "`, groupAt + 1);
  if (keyAt < 0 || (nextObj >= 0 && keyAt > nextObj)) throw new Error(`group ${groupId} has no courseIds`);
  const open = keyAt + `"courseIds": `.length;
  const close = text.indexOf("]", open);
  const lineStart = text.lastIndexOf("\n", keyAt) + 1;
  const indent = text.slice(lineStart, keyAt);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const body =
    ids.length === 0 ? "[]" : `[${nl}${ids.map((id) => `${indent}  ${JSON.stringify(id)}`).join(`,${nl}`)}${nl}${indent}]`;
  return text.slice(0, open) + body + text.slice(close + 1);
}

export function newestBackup(dir: string): string {
  const f = readdirSync(dir).filter((n) => n.startsWith("catalog-backup-") && n.endsWith(".json")).sort().pop();
  if (!f) throw new Error("no backups/catalog-backup-*.json; pass --from <file>");
  return join(dir, f);
}

const titleKey = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Each id's same-number cross-listings: other subjects, same number, same exact
 *  catalog title (EAS 3030 ↔ NTRES 3030). The catalog has no cross-listing field;
 *  a same-number title twin is the safe reading (spec 035). */
export function sameNumberTwins(
  courses: Iterable<{ id: string; number: string; title?: string | null }>
): Map<string, string[]> {
  const all = [...courses];
  const byKey = new Map<string, string[]>();
  for (const c of all) {
    const k = `${c.number}|${titleKey(c.title)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c.id]);
  }
  const twins = new Map<string, string[]>();
  for (const c of all) {
    if (!titleKey(c.title)) continue;
    const others = (byKey.get(`${c.number}|${titleKey(c.title)}`) ?? []).filter((id) => id !== c.id);
    if (others.length) twins.set(c.id, others);
  }
  return twins;
}
