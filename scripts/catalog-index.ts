// scripts/catalog-index.ts
// Shared catalogIndex chunk logic, extracted from roster-sync.ts so parse-prereqs
// can regenerate the same denormalized index (and its hasPrereqs flags) after it
// writes parsed prereqExpr trees. Single source of truth for chunk shape/size.

import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { CatalogIndexChunkSchema, CatalogIndexRecordSchema } from "../cornell-degree-planner/src/lib/schemas";
import { withRosterSeason } from "./roster-convert";

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
  // Spec 017 D5 — the roster slug the course doc's sections came from ("SP27",
  // "FA26"), copied through so the /classes page can filter to the enrollment
  // term index-only. null when the doc predates roster stamping.
  roster: string | null;
  // Spec 017 D4/D5 — the lead lecturer of the course's primary component, from
  // the doc's own sections (see leadLecturer below). null when the course has no
  // sections or only staff/TBA instructors.
  lead: LeadLecturer | null;
  // Spec 021 — every distinct meeting option of the course's sections, compact,
  // so /classes can filter by days and time index-only (see meetingOptions).
  meets: string[];
};

export type LeadLecturer = { netid: string; name: string; more: number };

// Spec 021 — the schedule filters' index field. One string per distinct
// section meeting signature, in section order:
//
//   "<role><component>|<days> <start>-<end>[,<days> <start>-<end>…]"
//
// role "P" = the primary component (the component of primarySection(): first
// LEC section, else sections[0] — the same section the board card shows),
// "S" = any other component (discussion, lab, …). Times are minutes since
// midnight. A section with no well-formed meeting keeps an empty meeting list
// ("PIND|"), so the app knows the component exists but never claims a time
// for it. Deduped (first occurrence wins, so the first P entry IS the primary
// section) and capped so one huge roster entry can't bloat an index chunk.
// The parsers mirror src/lib/planner/sections.ts (parseDayTokens /
// parseClockToMinutes) for the same reason as patternToRegex above.
export const MEETS_CAP = 40;
export const MEET_MAX_LEN = 160;

function clockToMinutes(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(typeof t === "string" ? t.trim() : "");
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 12 || min > 59) return null;
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}

/** Cornell day pattern → canonical tokens joined ("TR", "MWF", "SSu"); "" when
 *  no day letter. "Su" is read before "S". */
function normalizeDays(pattern: unknown): string {
  const p = typeof pattern === "string" ? pattern.trim() : "";
  const out: string[] = [];
  let i = 0;
  while (i < p.length) {
    if ((p[i] === "S" || p[i] === "s") && (p[i + 1] === "u" || p[i + 1] === "U")) {
      out.push("Su");
      i += 2;
      continue;
    }
    const ch = p[i].toUpperCase();
    if ("MTWRFS".includes(ch)) out.push(ch);
    i += 1;
  }
  return out.join("");
}

export function meetingOptions(course: Record<string, any>): string[] {
  const sections: unknown[] = Array.isArray(course?.sections) ? course.sections : [];
  if (sections.length === 0) return [];
  const componentOf = (s: unknown): string => {
    const c = s && typeof s === "object" ? (s as { component?: unknown }).component : undefined;
    return typeof c === "string" ? c.trim().slice(0, 8) : "";
  };
  const primary = sections.find((s) => componentOf(s) === "LEC") ?? sections[0];
  const primaryComponent = componentOf(primary);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sections) {
    const component = componentOf(s);
    const role = component === primaryComponent ? "P" : "S";
    const meetings: unknown[] =
      s && typeof s === "object" && Array.isArray((s as { meetings?: unknown }).meetings)
        ? (s as { meetings: unknown[] }).meetings
        : [];
    const parts: string[] = [];
    for (const m of meetings) {
      if (!m || typeof m !== "object") continue;
      const r = m as { pattern?: unknown; timeStart?: unknown; timeEnd?: unknown };
      const days = normalizeDays(r.pattern);
      const start = clockToMinutes(r.timeStart);
      const end = clockToMinutes(r.timeEnd);
      if (!days || start == null || end == null || end <= start) continue;
      parts.push(`${days} ${start}-${end}`);
    }
    const sig = `${role}${component}|${[...new Set(parts)].join(",")}`;
    if (sig.length > MEET_MAX_LEN || seen.has(sig)) continue;
    seen.add(sig);
    out.push(sig);
    if (out.length >= MEETS_CAP) break;
  }
  return out;
}

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

// Spec 017 D4 — the lead lecturer shown on a /classes row. It must name the
// same person the board card and detail panel name, so it is taken from the
// SAME single section they show: primarySection() in
// src/lib/planner/sections.ts (first LEC section, else sections[0]), mirrored
// here for the same reason as patternToRegex above: scripts/ cannot import from
// cornell-degree-planner/src. Keep the two in sync.
//
// lead = the first instructor of that primary section with a non-empty
// "First Last" name (built exactly like sectionInstructorNames). netid may be
// "" — the app then shows the name only and never joins a rating. `more` counts
// the OTHER distinct named instructors across every section of the primary
// section's component (keyed by netid, or by name when the netid is empty).
// null when there are no sections or the primary section is staff/TBA only.
// Clamped so one odd roster entry can't bloat or break an index chunk.
export const LEAD_NAME_MAX = 140;
export const LEAD_NETID_MAX = 16;
export const LEAD_MORE_MAX = 200;

type NamedInstructor = { netid: string; name: string; key: string };

function namedInstructors(section: unknown): NamedInstructor[] {
  const instructors =
    section && typeof section === "object" ? (section as { instructors?: unknown }).instructors : undefined;
  if (!Array.isArray(instructors)) return [];
  const out: NamedInstructor[] = [];
  for (const i of instructors) {
    if (!i || typeof i !== "object") continue;
    const r = i as { netid?: unknown; firstName?: unknown; lastName?: unknown };
    const first = typeof r.firstName === "string" ? r.firstName : "";
    const last = typeof r.lastName === "string" ? r.lastName : "";
    const name = `${first} ${last}`.trim();
    if (!name) continue;
    const netid = typeof r.netid === "string" ? r.netid.trim() : "";
    out.push({ netid, name, key: netid ? `n:${netid}` : `s:${name}` });
  }
  return out;
}

export function leadLecturer(course: Record<string, any>): LeadLecturer | null {
  const sections: unknown[] = Array.isArray(course?.sections) ? course.sections : [];
  if (sections.length === 0) return null;

  const componentOf = (s: unknown): unknown =>
    s && typeof s === "object" ? (s as { component?: unknown }).component : undefined;
  const primary = sections.find((s) => componentOf(s) === "LEC") ?? sections[0];
  const first = namedInstructors(primary)[0];
  if (!first) return null;

  const primaryComponent = componentOf(primary);
  const others = new Set<string>();
  for (const s of sections) {
    if (componentOf(s) !== primaryComponent) continue;
    for (const i of namedInstructors(s)) {
      if (i.key !== first.key) others.add(i.key);
    }
  }
  return {
    netid: first.netid.slice(0, LEAD_NETID_MAX),
    name: first.name.slice(0, LEAD_NAME_MAX),
    more: Math.min(others.size, LEAD_MORE_MAX),
  };
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
      // A course doc can lack a title (Cornell's roster sometimes has none); the
      // app rejects the whole index over one such record, so use the code.
      title: typeof c.title === "string" && c.title.trim() ? c.title : `${c.subject} ${c.number}`,
      creditsMin: c.creditsMin,
      creditsMax: c.creditsMax,
      hasPrereqs: c.prereqExpr != null,
      // Plus the season of the course's roster term: docs written by older
      // syncs (and --add-only) list only Cornell's offering history.
      offered: withRosterSeason(Array.isArray(c.offered) ? c.offered : [], c.roster),
      attrs: Array.isArray(c.attrs)
        ? c.attrs
            .map((a: any) => a?.value)
            .filter((v: any): v is string => typeof v === "string")
            .slice(0, 40)
        : [],
      fws: typeof c.title === "string" && c.title.startsWith("FWS:"),
      unlocks: unlocksById.get(c.id) ?? [],
      roster: typeof c.roster === "string" && c.roster.trim() ? c.roster.trim() : null,
      lead: leadLecturer(c),
      meets: meetingOptions(c),
    }));
}

// Regenerate catalogIndex/chunk-NNN docs from index records, deleting any stale
// trailing chunks from a previously larger catalog. Returns the number of chunks
// written and the number of document ops committed (for write-quota accounting).
// `commitBatch` lets the caller thread its own flush/write-count bookkeeping; if
// omitted, a simple internal batching is used (400-op flush).
/** Throws, naming every failing record, unless each record and each chunk
 *  passes the app's own schema (the one fetchCatalogIndex runs). */
export function assertIndexReadable(records: IndexRecord[]): void {
  const failures: string[] = [];
  for (const r of records) {
    const p = CatalogIndexRecordSchema.safeParse(r);
    if (!p.success) {
      failures.push(`${r.id}: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `catalogIndex not written: ${failures.length} record(s) fail the app's schema:\n  ${failures.slice(0, 20).join("\n  ")}`
    );
  }
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const p = CatalogIndexChunkSchema.safeParse({ records: records.slice(i, i + CHUNK_SIZE) });
    if (!p.success) throw new Error(`catalogIndex not written: chunk ${i / CHUNK_SIZE} fails the app's schema`);
  }
}

export async function regenerateCatalogIndex(
  db: Firestore,
  records: IndexRecord[]
): Promise<{ chunkCount: number; ops: number }> {
  // The app parses every chunk with CatalogIndexChunkSchema and shows "Couldn't
  // reach the course catalog" if ANY record fails (2026-11-08: one null title
  // took search down). Refuse to write an index the app can't read.
  assertIndexReadable(records);
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
