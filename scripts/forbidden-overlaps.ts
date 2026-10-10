// scripts/forbidden-overlaps.ts
// Pure parser for Cornell's catalogForbiddenOverlaps field (spec 007 §5 / Unit 7D,
// debug doc #11). PURE on purpose — roster-sync.ts runs main() at module top
// level and can't be imported by tests; this module has no side effects and no
// top-level execution, so scripts/forbidden-overlaps.corpus.ts can import it
// directly with `npx tsx`.
//
// Scope: parsing only. No derived warning state, no UI — those belong to later
// units (spec 007 §1b "Overlap warning", §5 second bullet).
//
// Verified live samples (debug doc #11, Part 1.5):
//   CS 1110    → "CS 1110, CS 1112"
//   MATH 1910  → "MATH 1120, MATH 1910"        (NOT MATH 1110)
//   MATH 1920  → "MATH 1920, MATH 2220, MATH 2240"
// Gotcha: the field always includes the course itself — strip it.

// Same token shape as scripts/prereq-grammar.ts's COURSE_RE: SUBJ is 2–7
// uppercase letters; number is 3–4 digits with an optional trailing letter
// (e.g. "BIOMG 1350A"). Normalised form: "SUBJ-NNNN".
const COURSE_RE = /\b([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)\b/g;

function normalizeId(subj: string, num: string): string {
  return `${subj.toUpperCase()}-${num.toUpperCase()}`;
}

/**
 * Parse a catalogForbiddenOverlaps prose field into a deduped list of
 * "SUBJ-NNNN" course ids that overlap `selfId`.
 *
 * The field is a comma list of GROUPS, and credit is given for only one group:
 *   CHEM 2090 → "CHEM 1560 and CHEM 1561, CHEM 2070 and CHEM 2071, CHEM 2090 and CHEM 2091"
 * A group joined by "and" is a bundle (a lecture and its lab). The group that
 * contains the course itself is stripped whole — the API lists the course in
 * its own overlap field (debug doc #11), and its bundle partner (CHEM 2091 for
 * CHEM 2090) is a companion, not an overlap.
 *
 * Returns null when:
 *  - raw is null/undefined/blank, or
 *  - raw is non-empty but no course-code tokens can be extracted (pure prose
 *    like "See department for details") — defensive: never emit junk.
 */
export function parseForbiddenOverlaps(
  raw: string | null | undefined,
  selfId: string
): string[] | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const group of text.split(",")) {
    const members = [...group.matchAll(COURSE_RE)].map((m) => normalizeId(m[1], m[2]));
    if (members.includes(selfId)) continue; // the course's own group
    for (const id of members) {
      if (seen.has(id)) continue; // dedupe
      seen.add(id);
      ids.push(id);
    }
  }

  return ids.length > 0 ? ids : null;
}
