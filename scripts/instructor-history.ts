// scripts/instructor-history.ts
// PURE extraction + merge logic for the courseInstructorHistory pipeline
// (spec 013 §3d). NO IO/firebase — scripts/instructor-history.corpus.ts imports
// it directly; the IO shell (Cornell fetch + Firestore write) is
// scripts/instructor-history-sync.ts. Reuses roster-convert.ts's ClassRow shape
// so the parsing nesting (instructors under meetings) stays defined in ONE place.

import type { ClassRow } from "./roster-convert";

const MAX_TERMS = 24; // spec 013 §3d cap — keep in sync with schemas.ts / firestore.rules
const MAX_INSTRUCTORS_PER_TERM = 20;

export type HistoryInstructor = { netid: string; name: string };
export type HistoryTerm = { roster: string; instructors: HistoryInstructor[] };
export type CourseHistoryDoc = { courseId: string; terms: HistoryTerm[] };

/** Chronological key for a roster slug ("FA25" < "SP26" < "FA26"); unparseable
 *  slugs sort last. Local copy (scripts can't import the app's horizon.ts). */
function rosterKey(slug: string): number {
  const m = /^([A-Za-z]{2})(\d{2})$/.exec((slug ?? "").trim());
  if (!m) return 0;
  const term = m[1].toUpperCase();
  const rank = term === "SP" ? 1 : term === "SU" ? 2 : term === "FA" ? 3 : term === "WI" ? 4 : 0;
  if (rank === 0) return 0;
  return (2000 + parseInt(m[2], 10)) * 10 + rank;
}

/**
 * Extract each course's instructor list from one roster's class rows (spec §3d).
 * Instructors nest under enrollGroups[].classSections[].meetings[].instructors
 * (measured live — see roster-convert.ts header); union them across every
 * section/meeting of a course and dedupe by netid (missing netid → name key,
 * stored netid stays ""). Returns courseId → HistoryInstructor[].
 */
export function extractCourseInstructors(rows: ClassRow[]): Map<string, HistoryInstructor[]> {
  const out = new Map<string, HistoryInstructor[]>();
  for (const row of rows) {
    if (!row?.subject || !row?.catalogNbr) continue;
    const courseId = `${row.subject}-${row.catalogNbr}`;
    const byKey = out.get(courseId) ?? [];
    const seen = new Set(byKey.map((i) => (i.netid ? `netid:${i.netid}` : `name:${i.name}`)));
    for (const eg of row.enrollGroups ?? []) {
      for (const cs of eg.classSections ?? []) {
        for (const m of cs.meetings ?? []) {
          for (const instr of m.instructors ?? []) {
            const netid = typeof instr.netid === "string" ? instr.netid : "";
            const first = typeof instr.firstName === "string" ? instr.firstName : "";
            const last = typeof instr.lastName === "string" ? instr.lastName : "";
            const name = `${first} ${last}`.trim();
            if (!name && !netid) continue;
            const key = netid ? `netid:${netid}` : `name:${name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            byKey.push({ netid, name });
          }
        }
      }
    }
    if (byKey.length > 0) out.set(courseId, byKey);
  }
  return out;
}

/**
 * Merge one roster's instructor list for a course into its history doc
 * (spec §3d). Idempotent per roster: an existing term with the same slug is
 * REPLACED (a re-sync overwrites, never duplicates). Terms are kept newest-first
 * and capped to MAX_TERMS (oldest dropped); instructors are deduped by netid and
 * capped to MAX_INSTRUCTORS_PER_TERM. Passing an empty instructor list still
 * records the (empty) term so a known "no instructor announced" roster isn't
 * confused with an un-synced one.
 */
export function mergeRoster(
  doc: CourseHistoryDoc | null,
  courseId: string,
  roster: string,
  instructors: HistoryInstructor[]
): CourseHistoryDoc {
  const base = doc ?? { courseId, terms: [] };
  const deduped: HistoryInstructor[] = [];
  const seen = new Set<string>();
  for (const i of instructors) {
    const key = i.netid ? `netid:${i.netid}` : `name:${i.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (deduped.length >= MAX_INSTRUCTORS_PER_TERM) break;
    deduped.push({ netid: i.netid ?? "", name: i.name });
  }
  const terms = base.terms.filter((t) => t.roster !== roster);
  terms.push({ roster, instructors: deduped });
  terms.sort((a, b) => rosterKey(b.roster) - rosterKey(a.roster));
  return { courseId, terms: terms.slice(0, MAX_TERMS) };
}

/** The distinct netids across every term of a history doc (drops the "" netid —
 *  a name-only instructor can't be joined to an RMP page). Handy for the sync
 *  shell to know which professorReviews docs a course will need. */
export function historyNetids(doc: CourseHistoryDoc): string[] {
  const set = new Set<string>();
  for (const t of doc.terms) for (const i of t.instructors) if (i.netid) set.add(i.netid);
  return [...set];
}
