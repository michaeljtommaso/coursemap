// scripts/catalog-index.ts
// Shared catalogIndex chunk logic, extracted from roster-sync.ts so parse-prereqs
// can regenerate the same denormalized index (and its hasPrereqs flags) after it
// writes parsed prereqExpr trees. Single source of truth for chunk shape/size.

import type { Firestore, WriteBatch } from "firebase-admin/firestore";

export const CHUNK_SIZE = 300; // mirror seed-firestore.ts (spec §3)

export type IndexRecord = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  hasPrereqs: boolean;
  // Offered terms (spec 006 §E3) — copied from the course doc so the directory /
  // drawer "offered" filter works index-only. Empty when the course has no
  // roster term data.
  offered: string[];
  // Spec 010 §3 (Unit 10A) — lightweight derived flags so attribute matching is
  // an index filter, not a per-doc read. `attrs` is just the crseAttrs VALUES
  // (e.g. "WRT-AG"), capped at 40, mirroring the course doc's `attrs` array.
  attrs: string[];
  // `fws` — the durable First-Year Writing Seminar signal (debug doc Part 1.5 /
  // spec 010 §0): title/titleLong starting with "FWS:". Not a subject/pattern
  // match — FWS courses are taught across ~20 subjects with no shared code.
  fws: boolean;
  // Spec 008 §3a (Unit 8A) — the forward "unlocks" reverse-adjacency, precomputed
  // HERE at sync time (deliberate refinement of §3a's "built once per catalog
  // load" note): every OTHER course id whose prereqExpr/coreqExpr references this
  // course (direct id, concurrent id, advisory inner ref, or pattern expansion).
  // The lean client index carries no prereqExpr trees, and loading all 4,472
  // course docs client-side to compute this would violate the read-budget law —
  // buildIndexRecords already has every doc in memory, so the reverse index is
  // built once here and shipped as plain data. Self excluded, capped at
  // UNLOCKS_CAP, alphabetical for determinism.
  unlocks: string[];
};

// Duplicated from src/lib/planner/satisfies.ts's patternToRegex — scripts/ is a
// standalone package (own tsconfig/node_modules; see repo CLAUDE.md) with no
// import path into cornell-degree-planner/src, so the wildcard-matching logic
// is intentionally mirrored here rather than cross-imported. Keep both in sync
// if the pattern grammar (dash separators, x/X/* wildcards) ever changes.
export function patternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/-/g, " ");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/[*xX]/g, ".");
  return new RegExp(`^${withWildcards}$`, "i");
}

// Every course/concurrent id AND pattern string a prereqExpr/coreqExpr tree
// references, descending through and/or children and advisory inner exprs.
// Corpus-testable in isolation (scripts/unlocks.corpus.ts) — mirrors
// parse-prereqs.ts's collectCourseIds but ALSO records pattern nodes (needed
// here for pattern expansion; parse-prereqs never needed patterns since it
// only diffs course-id removals between old/new trees).
export type PrereqRefs = { ids: Set<string>; patterns: Set<string> };

export function collectPrereqRefs(
  expr: unknown,
  out: PrereqRefs,
  visited: Set<unknown> = new Set()
): void {
  if (!expr || typeof expr !== "object") return;
  if (visited.has(expr)) return; // cycle guard — never hang on malformed data
  const nextVisited = new Set(visited);
  nextVisited.add(expr);

  const e = expr as Record<string, unknown>;
  if ((e.type === "course" || e.type === "concurrent") && typeof e.id === "string") {
    out.ids.add(e.id);
    return;
  }
  if (e.type === "pattern" && typeof e.pattern === "string") {
    out.patterns.add(e.pattern);
    return;
  }
  if (e.type === "advisory") {
    collectPrereqRefs(e.expr, out, nextVisited);
    return;
  }
  if (Array.isArray(e.children)) {
    for (const c of e.children) collectPrereqRefs(c, out, nextVisited);
  }
}

// Cap per spec 008 §2 binding decision 2 — a course can be referenced by at
// most this many dependents in the shipped index; overflow is counted, never
// silently unbounded.
export const UNLOCKS_CAP = 200;

export type UnlocksStats = { overflowCount: number };
export function newUnlocksStats(): UnlocksStats {
  return { overflowCount: 0 };
}

// Build the courseId -> unlocks[] reverse adjacency for the WHOLE dump in one
// pass: direct course/concurrent id refs are O(1) lookups; pattern refs are
// expanded against every course CODE present in the dump (not the catalog's
// full id space) — exactly what patternToRegex-vs-"SUBJ NNNN" would match at
// evaluate-time. Self-references are excluded (a course never unlocks itself).
export function buildUnlocksIndex(
  courses: Array<Record<string, any>>
): { unlocksById: Map<string, string[]>; stats: UnlocksStats } {
  const codeToId = new Map<string, string>();
  for (const c of courses) {
    if (
      typeof c.id === "string" &&
      typeof c.subject === "string" &&
      typeof c.number === "string"
    ) {
      codeToId.set(`${c.subject} ${c.number}`, c.id);
    }
  }

  const unlocksSets = new Map<string, Set<string>>(); // targetId -> Set<dependentId>
  const addUnlock = (targetId: string, dependentId: string) => {
    if (targetId === dependentId) return; // self excluded
    let set = unlocksSets.get(targetId);
    if (!set) {
      set = new Set();
      unlocksSets.set(targetId, set);
    }
    set.add(dependentId);
  };

  for (const c of courses) {
    if (typeof c.id !== "string") continue;
    const refs: PrereqRefs = { ids: new Set(), patterns: new Set() };
    collectPrereqRefs(c.prereqExpr, refs);
    collectPrereqRefs(c.coreqExpr, refs);

    for (const id of refs.ids) addUnlock(id, c.id);

    for (const pattern of refs.patterns) {
      const re = patternToRegex(pattern);
      for (const [code, targetId] of codeToId) {
        if (re.test(code)) addUnlock(targetId, c.id);
      }
    }
  }

  const unlocksById = new Map<string, string[]>();
  const stats = newUnlocksStats();
  for (const [id, set] of unlocksSets) {
    const sorted = [...set].sort((a, b) => a.localeCompare(b));
    if (sorted.length > UNLOCKS_CAP) stats.overflowCount++;
    unlocksById.set(id, sorted.slice(0, UNLOCKS_CAP));
  }

  return { unlocksById, stats };
}

// Build the sorted index records from raw course docs. hasPrereqs is true when a
// course has a non-null prereqExpr (coreqExpr does not flip the dot — matches the
// original roster-sync behavior). `offered` is carried through for the E3 filter.
// `unlocksStats`, when passed, accumulates the unlocks cap-overflow count so
// callers can report it (roster-sync.ts / parse-prereqs.ts summaries) — optional
// so existing call sites that don't care about the stat need no changes.
export function buildIndexRecords(
  courses: Array<Record<string, any>>,
  unlocksStats?: UnlocksStats
): IndexRecord[] {
  const { unlocksById, stats } = buildUnlocksIndex(courses);
  if (unlocksStats) unlocksStats.overflowCount += stats.overflowCount;

  return [...courses]
    .sort(
      (a, b) =>
        String(a.subject).localeCompare(String(b.subject)) ||
        String(a.number).localeCompare(String(b.number))
    )
    .map((c) => ({
      id: c.id,
      subject: c.subject,
      number: c.number,
      title: c.title,
      creditsMin: c.creditsMin,
      creditsMax: c.creditsMax,
      hasPrereqs: c.prereqExpr != null,
      offered: Array.isArray(c.offered) ? c.offered : [],
      attrs: Array.isArray(c.attrs)
        ? c.attrs
            .map((a: any) => a?.value)
            .filter((v: any): v is string => typeof v === "string")
            .slice(0, 40)
        : [],
      fws: typeof c.title === "string" && c.title.startsWith("FWS:"),
      unlocks: unlocksById.get(c.id) ?? [],
    }));
}

// Regenerate catalogIndex/chunk-NNN docs from index records, deleting any stale
// trailing chunks from a previously larger catalog. Returns the number of chunks
// written and the number of document ops committed (for write-quota accounting).
// `commitBatch` lets the caller thread its own flush/write-count bookkeeping; if
// omitted, a simple internal batching is used (400-op flush).
export async function regenerateCatalogIndex(
  db: Firestore,
  records: IndexRecord[]
): Promise<{ chunkCount: number; ops: number }> {
  const chunkCount = Math.max(1, Math.ceil(records.length / CHUNK_SIZE));
  let ops = 0;
  let batch: WriteBatch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if ((force && pending > 0) || pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (let i = 0; i < chunkCount; i++) {
    const id = `chunk-${String(i).padStart(3, "0")}`;
    const slice = records.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    batch.set(db.collection("catalogIndex").doc(id), { records: slice });
    pending++;
    ops++;
    await flush();
  }

  // Reap stale chunks beyond the new count.
  const existing = await db.collection("catalogIndex").get();
  for (const d of existing.docs) {
    const n = Number(d.id.replace("chunk-", ""));
    if (!Number.isNaN(n) && n >= chunkCount) {
      batch.delete(d.ref);
      pending++;
      ops++;
      await flush();
    }
  }
  await flush(true);
  return { chunkCount, ops };
}
