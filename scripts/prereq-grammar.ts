// scripts/prereq-grammar.ts
// Deterministic, rule-based parser: Cornell free-text prerequisite/corequisite
// strings  →  PrereqExpr trees (see cornell-degree-planner/src/types/db.ts).
//
// This module is PURE (no IO, no Firestore) so it can be unit-tested against a
// fixed corpus and reused by both parse-prereqs.ts and the test harness.
//
// ── Source of the text ────────────────────────────────────────────────────────
// The Cornell API (classes.cornell.edu/api/2.0/search/classes.json) exposes THREE
// free-text fields per class. Verified live on the FA26 roster (2026-07-07):
//   • catalogPrereqCoreq  — advertised in the spec, but EMPTY on all 709 sampled
//                           courses. Kept as a fallback only.
//   • catalogPrereq       — the real prerequisite prose (353/709 populated).
//   • catalogCoreq        — the real corequisite prose (36/709 populated).
// roster-sync captures catalogPrereq→prereqText and catalogCoreq→coreqText.
//
// ── The grammar (derived from ~640 real FA26 samples, revised against the
//    full 1,394-course FA26 prose set) ─────────────────────────────────────────
// See "Clause grammar" below for the full precedence rules. In short:
//
//   1. SEMICOLON ';' clauses are ANDed, except that a clause opening with "or"
//      is an alternative to everything before it ("A; B; or C"), and a
//      course-less "; or equivalents." makes everything before it advisory.
//        "CS 2110; CS 2800"                → and(CS-2110, CS-2800)
//        "MATH 1110; CS 1110 or CS 1112; or equivalents."
//                                          → advisory(and(1110, or(1110, 1112)))
//
//   2. COMMA lists take the connective in front of their last item ("A, B, or
//      C" → OR; "A, B, and C" → AND); a list mixing both splits at its last
//      connective. Within an item, "or" binds tighter than "and".
//
//   3. PARENTHESES  "X (or Y or Z)"  → the parenthetical is folded into an OR with
//      the token immediately before it:  MATH 4710 (or ENGRD 2700 or ENGRD 2720)
//      → or(MATH-4710, ENGRD-2700, ENGRD-2720). A leading "or"/"and" inside the
//      parens tells us how to fold; default OR.
//
//   4. RANGE "MATH 4130-MATH 4140" is a sequence (both). SLASH "A/B" is read by
//      shape: cross-listed or cross-level pairs are alternatives, same-subject
//      same-level pairs are sequences (see expandSequences).
//
// ── The e.g./i.e. rule (spec 007 §3, decision 2) ───────────────────────────────
//   BEFORE anything else runs (including the parenthetical-fold in step 3 above),
//   any parenthetical that OPENS with "e.g." or "i.e." (optional comma/spacing —
//   "(e.g., MATH 1110)", "(e.g. MATH 1110)", "(i.e., MATH 1110)") is stripped
//   ENTIRELY. A course code inside such a parenthetical is an *example*, never a
//   requirement, and must never become a node. This kills the MATH 1910 →
//   MATH 1110 fiction and its MATH 1110 → MATH 1101 twin: both cite a course as
//   an illustration of "a precalculus/calculus course," not as the requirement
//   itself. If stripping the parenthetical leaves the clause with no course
//   tokens at all, the clause is re-evaluated as prose (see NOISE_PATTERNS below)
//   rather than as a course requirement.
//
// ── Noise (recognised, then handled without inventing a hard requirement) ──────
//   "or equivalent(s)", "or permission of instructor/department/instructors",
//   "or graduate standing…", grade/GPA clauses ("minimum grade of B-…",
//   "with average of B- or better"), "high school…", "AP …". Noise is never
//   silently deleted anymore (spec 007 §3, decisions 2b/2c):
//     • OR-noise (the clause's connective is "or" and a noise phrase matched) →
//       the surviving course expression is wrapped in an `advisory` node; the
//       matched noise text becomes its `note`. A single surviving alternative
//       can therefore never be promoted to a hard requirement — see the old
//       group()-collapse bug this replaces.
//     • AND-noise (a noise phrase alongside a course in a non-OR clause, e.g. a
//       trailing grade minimum) → the course tree stays HARD, and the noise text
//       is pushed onto `ParseResult.prereqNotes` instead of being dropped.
//     • A whole clause that is recognised noise (no course at all) → also a
//       `prereqNotes` entry; contributes nothing to the tree.
//   A no-course clause that matches NONE of NOISE_PATTERNS is genuinely
//   unrecognised prose, not noise — it sets `unparsedResidue` (see the
//   `wasNoise` bug fix below), which downgrades the whole parse to `partial`
//   (courses coexist) or `failed` (nothing else parsed).
//
// ── Recommendations (EXCLUDED entirely — not prerequisites) ───────────────────
//   "Recommended prerequisite:" / "Recommended corequisite:" and any clause
//   introduced by "recommended" are removed before parsing. If removing them
//   leaves nothing, there is no prereq (this is `clean`, not `annotated` — a
//   recommendation was never a hard requirement to begin with, so nothing was
//   lost by dropping it).
//
// ── Concurrency ───────────────────────────────────────────────────────────────
//   An inline "Prerequisite or corequisite:" label (and its "Prerequisites or
//   corequisites:" plural) means the following courses MAY be taken concurrently
//   → each becomes {type:"concurrent", id}. Plain "Corequisite:" text arrives via
//   the catalogCoreq field and becomes coreqExpr (still a PrereqExpr tree).
//   Label leaks: the catalogPrereq field sometimes literally starts with
//   "or corequisites:" or the catalogCoreq field with "or prerequisites:" — the
//   roster stripped the field's own label, so both mean "prerequisite or
//   corequisite" and route to the concurrent bucket. Recognised noise
//   found on the coreq side lands in `prereqNotes` prefixed "coreq: ".

import type { PrereqExpr } from "../cornell-degree-planner/src/types/db";

export type ParseClass = "clean" | "annotated" | "partial" | "failed" | "empty";

export type ParseResult = {
  prereqExpr: PrereqExpr | null;
  coreqExpr: PrereqExpr | null;
  cls: ParseClass;
  // true when any noise was recognised anywhere (advisory-wrapped and/or
  // captured as a prereqNotes entry). Kept for back-compat/debugging; the
  // classification itself is driven by the more granular signals internally.
  droppedNoise: boolean;
  // human-readable notes for eyeballing (why partial/failed, recommendation
  // drops, etc.) — NOT written to Firestore.
  notes: string[];
  // human-readable prose preserved from AND-noise / standalone-noise clauses
  // (grade minimums, permission-of-instructor asides, whole-clause noise like
  // MATH 1910's "high school math" branch). Coreq-side entries are prefixed
  // "coreq: ". Written to Firestore alongside prereqExpr (may accompany a null
  // prereqExpr — that's exactly the MATH 1910 shape).
  prereqNotes: string[];
};

// ── Course-code token ─────────────────────────────────────────────────────────
// SUBJ is 2–7 uppercase letters; number is 3–4 digits with an optional trailing
// letter (e.g. 2210, 1110, 4130). Cornell codes are 4 digits but we allow 3 for
// safety. Normalised form: "SUBJ-NNNN".
const COURSE_RE = /\b([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)\b/g;
const SINGLE_COURSE_RE = /^([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)$/;

function normalizeId(subj: string, num: string): string {
  return `${subj.toUpperCase()}-${num.toUpperCase()}`;
}

// Phrases that are pure noise. Matched case-insensitively as substrings/clauses.
const NOISE_PATTERNS: RegExp[] = [
  /\bor\s+equivalents?\b/i,
  /\bequivalents?\b/i,
  /\bor\s+permission\s+of\s+(the\s+)?instructors?\b/i,
  /\bpermission\s+of\s+(the\s+)?instructors?\b/i,
  /\bpermission\s+of\s+(the\s+)?department\b/i,
  /\bpermission\s+of\s+the\s+instructors?\b/i,
  /\bby\s+permission\b/i,
  /\bgraduate\s+standing\b/i,
  /\bminimum\s+grade\b/i,
  /\bgrade\s+of\s+[A-D][+-]?(?!\w)/i,
  /\baverage\s+of\s+[A-D][+-]?(?!\w)/i,
  /\bhigh\s+performance\b/i,
  /\bhigh\s+level\s+of\s+performance\b/i,
  /\bexcellent\s+performance\b/i,
  /\bstrong\s+performance\b/i,
  /\bminimum\s+grade\s+point\s+average\b/i,
  /\bGPA\b/i,
  /\bAP\s+credit\b/i,
  // "or AP Chem." / "or AP Calculus BC" — an AP alternative, never a course.
  // Case-sensitive: "AP" followed by a capitalised word.
  /\bAP\s+[A-Z][a-z]/,
  /\bhigh\s+school\b/i,
];

// A token (comma/word split piece) is "noise" if it contains no course code and
// matches something in NOISE_PATTERNS, OR simply contains no course code at all.
function tokenHasCourse(s: string): boolean {
  COURSE_RE.lastIndex = 0;
  return COURSE_RE.test(s);
}

// Strip a leading "for X majors:" / "for undergraduates:" / "Prerequisites for
// students matriculated before …:" style qualifier from a clause, keeping the
// course list that follows.
function stripLeadingQualifier(s: string): string {
  // "... : <courses>"  — if there's a colon and courses live after it, keep after.
  const colon = s.indexOf(":");
  if (colon !== -1) {
    const after = s.slice(colon + 1);
    if (tokenHasCourse(after)) return after.trim();
  }
  return s;
}

// Strip any parenthetical that OPENS with "e.g." or "i.e." (optional comma and
// spacing) ENTIRELY — including any course codes inside it. Must run BEFORE
// foldParentheticals so an example course code never gets folded into a real
// OR alternative. "differential and integral calculus (e.g., MATH 1110)" →
// "differential and integral calculus".
function stripExampleParentheticals(clause: string): string {
  return clause
    .replace(/\(\s*(?:e\.g\.|i\.e\.)\s*,?\s*[^)]*\)/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Section splitting ─────────────────────────────────────────────────────────
// Given the raw prereqText and coreqText, produce three prose buckets:
//   prereqProse | coreqProse | concurrentProse
// handling inline "Prerequisite or corequisite:" labels and the label-leak cases
// where the prereq field starts "or corequisites:" or coreq field starts
// "or prerequisites:".
export type Buckets = {
  prereqProse: string[];
  coreqProse: string[];
  concurrentProse: string[]; // "prereq or coreq" → concurrent
  hadRecommendation: boolean;
};

// Remove any sentence/clause that is a recommendation.
function stripRecommendations(text: string): { text: string; had: boolean } {
  let had = false;
  // Split on sentence boundaries and drop any sentence mentioning "recommend".
  const kept = text
    .split(/(?<=\.)\s+/)
    .filter((sentence) => {
      if (/\brecommend/i.test(sentence)) {
        had = true;
        return false;
      }
      return true;
    })
    .join(" ");
  return { text: kept, had };
}

// Pull an inline labeled section out of a prose blob. Returns the matched course
// prose for the label and the remaining prose.
function extractLabeled(
  text: string,
  labelRe: RegExp
): { matched: string | null; rest: string } {
  const m = text.match(labelRe);
  if (!m || m.index === undefined) return { matched: null, rest: text };
  const start = m.index + m[0].length;
  // The labeled section runs to the end of the sentence (first "." that is not
  // part of a course token) or end of string.
  const tail = text.slice(start);
  const dot = tail.search(/\.(?:\s|$)/);
  const matched = (dot === -1 ? tail : tail.slice(0, dot)).trim();
  const rest = (text.slice(0, m.index) + (dot === -1 ? "" : tail.slice(dot + 1))).trim();
  return { matched, rest };
}

export function splitLabeledSections(
  prereqText: string | null,
  coreqText: string | null
): Buckets {
  const prereqProse: string[] = [];
  const coreqProse: string[] = [];
  const concurrentProse: string[] = [];
  let hadRecommendation = false;

  const handle = (raw: string | null, defaultBucket: "prereq" | "coreq") => {
    if (!raw || !raw.trim()) return;
    const rec = stripRecommendations(raw);
    if (rec.had) hadRecommendation = true;
    let text = rec.text.trim();
    if (!text) return;

    // Inline "Prerequisite or corequisite(s):" → concurrent bucket.
    const concLabel = /prerequisites?\s+or\s+corequisites?\s*:/i;
    {
      const { matched, rest } = extractLabeled(text, concLabel);
      if (matched) {
        concurrentProse.push(matched);
        text = rest;
      }
    }
    // Label leaks: the roster strips the field's own label, so a prereq field
    // that BEGINS "or corequisite(s):" was "Prerequisites or corequisites: …",
    // and a coreq field that begins "or prerequisite(s):" was "Corequisites or
    // prerequisites: …". Both mean "before or alongside" → concurrent.
    {
      const leakLabel =
        defaultBucket === "prereq" ? /^or\s+corequisites?\s*:/i : /^or\s+prerequisites?\s*:/i;
      const { matched, rest } = extractLabeled(text, leakLabel);
      if (matched) {
        concurrentProse.push(matched);
        text = rest;
      }
    }
    // Embedded labels: a "Corequisite(s): X" sentence inside a prereq blob routes
    // to coreq, and a "Prerequisite(s): X" sentence inside a coreq blob to prereq.
    {
      const coreqLabel = /(?:^|\.\s*)(?:or\s+)?corequisites?\s*:/i;
      const { matched, rest } = extractLabeled(text, coreqLabel);
      if (matched) {
        coreqProse.push(matched);
        text = rest;
      }
    }
    {
      const prereqLabel = /(?:^|\.\s*)(?:or\s+)?prerequisites?\s*:/i;
      const { matched, rest } = extractLabeled(text, prereqLabel);
      if (matched) {
        prereqProse.push(matched);
        text = rest;
      }
    }

    if (text.trim()) {
      (defaultBucket === "prereq" ? prereqProse : coreqProse).push(text.trim());
    }
  };

  handle(prereqText, "prereq");
  handle(coreqText, "coreq");

  return { prereqProse, coreqProse, concurrentProse, hadRecommendation };
}

// ── Clause parsing ────────────────────────────────────────────────────────────
// The parse of one piece of prose (a comma item, a ;-clause, a whole blob).
type Parsed = {
  // The course expression, advisory wraps included; null when no course.
  expr: PrereqExpr | null;
  // AND-noise prose kept alongside a hard tree (grade minimums etc.), and
  // whole-piece noise with no course at all.
  notes: string[];
  // An advisory wrap was produced somewhere inside.
  advisory: boolean;
  // Unrecognised course-less prose — information lost.
  residue: boolean;
};

const EMPTY: Parsed = { expr: null, notes: [], advisory: false, residue: false };

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

function cleanNote(text: string): string {
  return text.trim().replace(/\s{2,}/g, " ").replace(/[.,;:\s]+$/, "");
}

function advisoryOf(expr: PrereqExpr, note: string): PrereqExpr {
  // advisory(advisory(X, a), b) reads as one relaxation: advisory(X, "a b").
  if (expr.type === "advisory") return { type: "advisory", expr: expr.expr, note: `${expr.note} ${note}` };
  return { type: "advisory", expr, note };
}

// Build an and/or node, flattening single children and same-type nesting
// ("or(or(A,B),C)" → "or(A,B,C)").
function groupFlat(type: "and" | "or", children: (PrereqExpr | null)[]): PrereqExpr | null {
  const flat: PrereqExpr[] = [];
  for (const c of children) {
    if (!c) continue;
    if (c.type === type) flat.push(...c.children);
    else flat.push(c);
  }
  return group(type, flat);
}

// Expand "X (or Y or Z)" parentheticals into "X or Y or Z" by folding the paren
// into the token before it. Handles nested-free, single-level parens (all we see).
function foldParentheticals(clause: string): string {
  return clause.replace(/([A-Z]{2,7}\s+\d{3,4}[A-Z]?)\s*\(([^)]*)\)/g, (whole, before, inside) => {
    const innerCourses = inside.match(/[A-Z]{2,7}\s+\d{3,4}[A-Z]?/g);
    if (!innerCourses) return before; // paren held only noise → keep just the course
    const lead = /\band\b/i.test(inside) && !/\bor\b/i.test(inside) ? " and " : " or ";
    return before + lead + innerCourses.join(lead);
  });
}

// Marker joining the two ends of a course SEQUENCE into one atom. It contains no
// "and"/"or" word, so the connective splitting in parseItem can't break a
// sequence apart; parseAlternative turns an atom carrying it into an AND node.
const SEQ = " && ";

// Expand ranges and slash pairs.
//   • Range "MATH 4130-MATH 4140" (or "MATH 4130-4140") is a sequence: both.
//   • Slash "A/B" is read by shape, measured against every slash pair in the
//     FA26 catalog:
//       - different subjects ("ENGRD 2610/MSE 2610", "DEA 2730/INFO 3450") are
//         cross-listings → either one;
//       - same subject, different level ("ORIE 3300/5300") are the undergrad
//         and grad versions → either one;
//       - same subject, same level ("BIOMG 3310/BIOMG 3320", "PHYS 2217/PHYS
//         2218") are two-semester sequences → both.
//     The same-level rule misreads the rare true alternative written that way
//     (MAE 3780's "CS 1110/CS 1112"); those are corrected by prose errata
//     (seed-data/prereq-errata.json) rather than by guessing here.
function expandSequences(clause: string): string {
  let out = clause;
  out = out.replace(
    /([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)\s*-\s*(?:([A-Z]{2,7})\s+)?(\d{3,4}[A-Z]?)\b/g,
    (_w, subjA, numA, subjB, numB) => `${subjA} ${numA}${SEQ}${subjB ?? subjA} ${numB}`
  );
  out = out.replace(
    /([A-Z]{2,7})\s+(\d{3,4}[A-Z]?)\s*\/\s*(?:([A-Z]{2,7})\s+)?(\d{3,4}[A-Z]?)\b/g,
    (_w, subjA, numA, subjB, numB) => {
      const subj2 = subjB ?? subjA;
      const sameLevel = subj2 === subjA && numA[0] === numB[0];
      return `${subjA} ${numA}${sameLevel ? SEQ : " or "}${subj2} ${numB}`;
    }
  );
  return out;
}

// Carry a subject onto bare course numbers that follow it in a list:
// "PHYS 2218 and 2210" → "PHYS 2218 and PHYS 2210". Only 4-digit numbers
// separated from the previous course by a list connective are touched, so years
// and credit counts in running prose are left alone.
function carrySubjects(clause: string): string {
  const re = /\b([A-Z]{2,7})\s+(\d{4}[A-Z]?)((?:\s*(?:,|\/|-|\band\b|\bor\b)\s*(?:and\s+|or\s+)?\d{4}[A-Z]?\b)+)/g;
  return clause.replace(re, (_w, subj, num, tail: string) => {
    const carried = tail.replace(/(\d{4}[A-Z]?)\b/g, `${subj} $1`);
    return `${subj} ${num}${carried}`;
  });
}

function courseNode(id: string): PrereqExpr {
  return { type: "course", id };
}

// Build an and/or node, flattening single children.
function group(type: "and" | "or", children: PrereqExpr[]): PrereqExpr | null {
  const flat = children.filter(Boolean);
  if (flat.length === 0) return null;
  if (flat.length === 1) return flat[0];
  return { type, children: flat };
}

// Extract the smallest contiguous substring of `clause` that covers every
// NOISE_PATTERNS match — trimmed, human-readable ("or equivalent AP credit",
// "or permission of instructor", "minimum grade of B-"). Returns null when
// nothing matched.
function extractNoiseFragment(clause: string): string | null {
  let start = Infinity;
  let end = -1;
  for (const re of NOISE_PATTERNS) {
    const m = clause.match(re);
    if (m && m.index !== undefined) {
      start = Math.min(start, m.index);
      end = Math.max(end, m.index + m[0].length);
    }
  }
  if (end === -1) return null;
  return clause.slice(start, end).trim().replace(/\s{2,}/g, " ");
}

// ── Clause grammar ────────────────────────────────────────────────────────────
// Cornell's prose nests three levels, loosest → tightest:
//
//   1. ";" clauses are ANDed with the clauses before them — unless a clause
//      opens with "or", which makes it an ALTERNATIVE to everything before it:
//        "CS 2800 and CS 3110; or a minimum grade of A- in CS 2110 or CS 2112
//         and CS 2800."  → or(and(2800, 3110), and(or(2110, 2112), 2800))
//      A course-less "or" clause ("; or equivalents.", "; or permission of
//      instructor.") turns everything before it advisory instead.
//
//   2. "," items within a clause. The connective in front of the last item
//      decides the list ("A, B, or C" → OR; "A, B, and C" → AND), and so does
//      the last item's own connective when the others are bare course codes
//      ("A, B or C" → OR; "A, B and C" → AND). A list whose items carry their
//      own structure ("CS 1110 or CS 1112, and MATH 2930"; "BEE 2600, BIOMG
//      3300 or equivalent, MATH 2930") is an AND of its items. A bare comma
//      list with no connective at all is an OR (Cornell's comma-OR lists). A
//      trailing course-less ", or …" item makes the whole list advisory.
//
//   3. Within an item, trailing course-less "or …" alternatives ("or
//      equivalent", "or permission of instructor", "or AP Chem") make the item
//      advisory; the rest splits on "and" (loose) and then "or" (tight):
//        "CS 2110 or CS 2112 and CS 2800" → and(or(2110, 2112), 2800).
//
// An advisory alternative inside an OR list is hoisted over the whole list
// ("A, B, or C or equivalent" → advisory(or(A, B, C))), since "or equivalent"
// relaxes the requirement, not one option of it.

const BARE_COURSE_RE = /^[A-Z]{2,7}\s+\d{3,4}[A-Z]?$/;

function coursesIn(text: string): string[] {
  COURSE_RE.lastIndex = 0;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = COURSE_RE.exec(text)) !== null) ids.push(normalizeId(m[1], m[2]));
  return [...new Set(ids)];
}

function trimTail(s: string): string {
  return s.trim().replace(/[.;:,\s]+$/, "").trim();
}

function isBareCourse(s: string): boolean {
  return BARE_COURSE_RE.test(trimTail(s));
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function leadingConj(s: string): { conj: "and" | "or" | null; rest: string } {
  const t = s.trim();
  const m = t.match(/^(and|or)\b[\s,]*/i);
  if (!m) return { conj: null, rest: t };
  return { conj: m[1].toLowerCase() as "and" | "or", rest: t.slice(m[0].length).trim() };
}

// Peel trailing course-less "or …" alternatives off a piece of prose:
// "BME 2010 or equivalent or permission of instructor" → body "BME 2010",
// note "or equivalent or permission of instructor". A course-less alternative
// the grammar doesn't recognise ("or one year of college biology") is peeled
// the same way: it is an alternative path, so the requirement before it is
// relaxed, never hard. A tail that names a course stops the peel.
function peelNoiseAlternatives(text: string): { body: string; note: string | null } {
  let body = trimTail(text);
  const peeled: string[] = [];
  for (;;) {
    const m = body.match(/^(.*\S)\s+or\s+(.+)$/is);
    if (!m) break;
    const tail = trimTail(m[2]);
    if (tail.includes(",") || coursesIn(tail).length > 0) break;
    peeled.unshift(tail);
    body = trimTail(m[1]);
  }
  return { body, note: peeled.length ? cleanNote(`or ${peeled.join(" or ")}`) : null };
}

// One "or"-alternative: its course codes (a sequence atom → AND, otherwise OR)
// with any noise prose beside them kept as a note ("a minimum grade of A- in
// CS 2110" stays a hard CS 2110 plus the grade note).
function parseAlternative(alt: string): Parsed {
  const text = trimTail(alt);
  if (!text) return EMPTY;
  const ids = coursesIn(text);
  if (ids.length === 0) {
    return isNoise(text) ? { ...EMPTY, notes: [cleanNote(text)] } : { ...EMPTY, residue: true };
  }
  const nodes = ids.map(courseNode);
  const expr = text.includes(SEQ.trim()) ? groupFlat("and", nodes) : groupFlat("or", nodes);
  const fragment = extractNoiseFragment(text);
  return { expr, notes: fragment ? [fragment] : [], advisory: false, residue: false };
}

// One comma item (no top-level commas left).
function parseItem(raw: string): Parsed {
  const { body, note: tailNote } = peelNoiseAlternatives(raw);
  const notes: string[] = [];
  let advisory = false;
  let residue = false;
  const partExprs: PrereqExpr[] = [];

  for (const part of body.split(/\s+and\s+/i)) {
    const alts = part.split(/\s+or\s+/i).map(trimTail).filter(Boolean);
    const parsed = alts.map(parseAlternative);
    const withCourse = parsed.filter((p) => p.expr);
    const withoutCourse = alts.filter((_a, i) => !parsed[i].expr);

    if (withCourse.length === 0) {
      // A course-less part: AND-noise ("minimum grade of B- required") is kept
      // as a note; anything else is unrecognised prose.
      if (parsed.some((p) => p.notes.length)) notes.push(...parsed.flatMap((p) => p.notes));
      else if (part.trim()) residue = true;
      continue;
    }

    notes.push(...withCourse.flatMap((p) => p.notes));
    let expr = groupFlat("or", withCourse.map((p) => p.expr));
    // A course-less alternative beside courses ("CS 2110 or equivalent", "CS
    // 1110 or programming experience") relaxes this part: advisory, never hard.
    if (expr && withoutCourse.length) {
      expr = advisoryOf(expr, cleanNote(`or ${withoutCourse.join(" or ")}`));
      advisory = true;
    }
    if (expr) partExprs.push(expr);
  }

  let expr = groupFlat("and", partExprs);
  if (tailNote) {
    if (expr) {
      expr = advisoryOf(expr, tailNote);
      advisory = true;
    } else {
      notes.push(tailNote);
    }
  }
  return { expr, notes, advisory, residue };
}

// Combine sibling pieces under one connective. In an OR, a piece that is only
// noise or unrecognised prose is an alternative path the tree can't express, so
// the whole OR becomes advisory; an advisory child is hoisted over the OR.
function combine(conj: "and" | "or", pieces: Parsed[], texts: string[]): Parsed {
  const notes = pieces.flatMap((p) => p.notes);
  const advisory = pieces.some((p) => p.advisory);
  const residue = pieces.some((p) => p.residue);
  if (conj === "and") {
    return { expr: groupFlat("and", pieces.map((p) => p.expr)), notes, advisory, residue };
  }

  const relaxNotes: string[] = [];
  const children: PrereqExpr[] = [];
  pieces.forEach((p, i) => {
    if (!p.expr) {
      relaxNotes.push(cleanNote(texts[i]));
      return;
    }
    if (p.expr.type === "advisory") {
      relaxNotes.push(p.expr.note);
      children.push(p.expr.expr);
    } else {
      children.push(p.expr);
    }
  });
  const inner = groupFlat("or", children);
  if (inner && relaxNotes.length) {
    const note = relaxNotes.map((n) => `or ${n.replace(/^\s*or\s+/i, "")}`).join(" ");
    // The course-less alternatives are captured in the advisory note, so they
    // no longer count as lost prose or as standalone notes.
    const kept = pieces.filter((p) => p.expr);
    return {
      expr: advisoryOf(inner, note),
      notes: kept.flatMap((p) => p.notes),
      advisory: true,
      residue: kept.some((p) => p.residue),
    };
  }
  return { expr: inner, notes, advisory, residue };
}

// One ";"-clause (leading "and"/"or" already removed).
function parseList(clause: string): Parsed {
  const raw = splitTopLevelCommas(clause);
  const items = raw.map(leadingConj);

  // A list mixing ", or" and ", and" ("A, B, or C, and D") splits at its last
  // connective: everything before it is one sub-list, everything from it on is
  // the other ("(A, B, or C) and D").
  const conjs = new Set(items.slice(1).map((it) => it.conj).filter(Boolean));
  if (conjs.size > 1) {
    let k = items.length - 1;
    while (!items[k].conj) k--;
    const left = parseList(raw.slice(0, k).join(", "));
    const right = parseList([items[k].rest, ...raw.slice(k + 1)].join(", "));
    return combine(items[k].conj!, [left, right], [raw.slice(0, k).join(", "), items[k].rest]);
  }

  // Trailing course-less ", or …" items relax the whole list.
  const relax: string[] = [];
  while (items.length > 1) {
    const last = items[items.length - 1];
    if (last.conj === "or" && coursesIn(last.rest).length === 0 && isNoise(last.rest)) {
      relax.unshift(trimTail(last.rest));
      items.pop();
    } else {
      break;
    }
  }

  let result: Parsed;
  if (items.length === 1) {
    result = parseItem(items[0].rest);
  } else {
    const last = items[items.length - 1];
    const others = items.slice(0, -1);
    let conj: "and" | "or";
    let texts = items.map((it) => it.rest);
    if (last.conj) {
      conj = last.conj;
    } else if (others.every((o) => !o.conj && isBareCourse(o.rest))) {
      const inner = trimTail(last.rest).match(/^([A-Z]{2,7}\s+\d{3,4}[A-Z]?)\s+(and|or)\s+(.+)$/i);
      if (inner) {
        conj = inner[2].toLowerCase() as "and" | "or";
        texts = [...others.map((o) => o.rest), inner[1], inner[3]];
      } else {
        conj = "or";
      }
    } else {
      conj = "and";
    }
    // A trailing "or permission of instructor" / "or equivalent" on the LAST
    // item relaxes the whole list, not just that item: "FDSC 3940, FDSC 4170,
    // and FDSC 4210 or permission of instructor".
    const lastPeel = peelNoiseAlternatives(texts[texts.length - 1]);
    if (lastPeel.note && lastPeel.body) {
      texts = [...texts.slice(0, -1), lastPeel.body];
      relax.push(lastPeel.note.replace(/^or\s+/i, ""));
    }
    result = combine(conj, texts.map(parseItem), texts);
  }

  if (relax.length) {
    const note = cleanNote(`or ${relax.join(" or ")}`);
    if (result.expr) result = { ...result, expr: advisoryOf(result.expr, note), advisory: true };
    else result = { ...result, notes: [...result.notes, note] };
  }
  return result;
}

// Normalise one ";"-clause before parsing.
function prepareClause(raw: string): string {
  let clause = stripLeadingQualifier(raw.trim());
  // The e.g./i.e. rule MUST run before foldParentheticals — an example course
  // code must never be folded into a real OR alternative.
  clause = stripExampleParentheticals(clause);
  clause = clause.replace(/\band\s*\/\s*or\b/gi, "or");
  clause = carrySubjects(clause);
  clause = foldParentheticals(clause);
  clause = expandSequences(clause);
  return clause;
}

// Parse a set of prose blobs (each may contain ";"-clauses) into one tree.
function parseProseSet(blobs: string[]): {
  expr: PrereqExpr | null;
  anyCourse: boolean;
  anyTextPresent: boolean;
  hasResidue: boolean;
  hasAdvisory: boolean;
  notes: string[];
} {
  let anyCourse = false;
  let anyTextPresent = false;
  let hasResidue = false;
  let hasAdvisory = false;
  const notes: string[] = [];
  const blobExprs: PrereqExpr[] = [];

  for (const blob of blobs) {
    if (blob.trim()) anyTextPresent = true;
    let acc: PrereqExpr[] = [];
    for (const rawClause of blob.split(";").map((c) => c.trim()).filter(Boolean)) {
      const { conj, rest } = leadingConj(rawClause);
      const clause = prepareClause(rest);
      const alternative = conj === "or" && acc.length > 0;

      if (!tokenHasCourse(clause)) {
        const text = trimTail(clause);
        if (!text) continue;
        if (alternative) {
          // "; or equivalents." / "; or permission of instructor." — everything
          // so far becomes advisory. Unrecognised prose in this position is an
          // alternative path the tree can't express; it relaxes the tree the
          // same way.
          acc = [advisoryOf(groupFlat("and", acc)!, cleanNote(`or ${text}`))];
          hasAdvisory = true;
        } else if (isNoise(text)) {
          notes.push(extractNoiseFragment(text) ?? cleanNote(text));
        } else {
          hasResidue = true;
        }
        continue;
      }

      const p = parseList(clause);
      notes.push(...p.notes);
      if (p.advisory) hasAdvisory = true;
      // Unrecognised prose only counts as lost when the clause yields no course
      // at all; beside a course ("ECON 1110 and a First-Year Writing Seminar")
      // the course requirement is kept and the prose is ignored, as before.
      if (!p.expr) {
        if (p.residue) hasResidue = true;
        continue;
      }
      anyCourse = true;
      acc = alternative ? [groupFlat("or", [groupFlat("and", acc), p.expr])!] : [...acc, p.expr];
    }
    const blobExpr = groupFlat("and", acc);
    if (blobExpr) blobExprs.push(blobExpr);
  }

  return {
    expr: groupFlat("and", blobExprs),
    anyCourse,
    anyTextPresent,
    hasResidue,
    hasAdvisory,
    notes,
  };
}

// Mark every node in an expr as concurrent (for "prereq or coreq" sections).
function toConcurrent(expr: PrereqExpr | null): PrereqExpr | null {
  if (!expr) return null;
  if (expr.type === "course") return { type: "concurrent", id: expr.id };
  if (expr.type === "concurrent" || expr.type === "pattern") return expr;
  if (expr.type === "advisory") {
    return { type: "advisory", expr: toConcurrent(expr.expr)!, note: expr.note };
  }
  return { type: expr.type, children: expr.children.map((c) => toConcurrent(c)!).filter(Boolean) };
}

// ── Public entry point ────────────────────────────────────────────────────────
export function parsePrereqs(
  prereqText: string | null,
  coreqText: string | null
): ParseResult {
  const notes: string[] = [];
  const prereqNotes: string[] = [];
  const noText = (!prereqText || !prereqText.trim()) && (!coreqText || !coreqText.trim());
  if (noText) {
    return {
      prereqExpr: null,
      coreqExpr: null,
      cls: "empty",
      droppedNoise: false,
      notes,
      prereqNotes,
    };
  }

  const buckets = splitLabeledSections(prereqText, coreqText);
  if (buckets.hadRecommendation) notes.push("dropped recommendation clause");

  const pre = parseProseSet(buckets.prereqProse);
  const co = parseProseSet(buckets.coreqProse);
  const conc = parseProseSet(buckets.concurrentProse);

  prereqNotes.push(...pre.notes, ...conc.notes);
  prereqNotes.push(...co.notes.map((n) => `coreq: ${n}`));

  // Concurrent section: parse as prereq tree, then re-tag as concurrent, then
  // fold into the prereqExpr with AND (you must satisfy them, possibly same term).
  const concExpr = toConcurrent(conc.expr);
  const prereqParts = [pre.expr, concExpr].filter(Boolean) as PrereqExpr[];
  const prereqExpr = groupFlat("and", prereqParts);
  const coreqExpr = co.expr;

  const anyCourse = pre.anyCourse || co.anyCourse || conc.anyCourse;
  const anyTextPresent = pre.anyTextPresent || co.anyTextPresent || conc.anyTextPresent;
  const hasResidue = pre.hasResidue || co.hasResidue || conc.hasResidue;
  const hasAdvisory = pre.hasAdvisory || co.hasAdvisory || conc.hasAdvisory;
  const hasNotes = prereqNotes.length > 0;

  // Classify (spec 007 §3, decision 2e):
  //   clean     — courses parsed, zero information dropped.
  //   annotated — information dropped but FULLY captured (advisory wrap and/or
  //               prereqNotes), including the whole-text-is-noise case (no
  //               courses at all, prereqExpr null, notes non-empty — MATH 1910).
  //   partial   — unrecognised residue alongside parsed courses (info lost).
  //   failed    — text present, nothing parsed, not recognised noise.
  let cls: ParseClass;
  if (!anyCourse) {
    if (buckets.hadRecommendation && !anyTextPresent) {
      // The only text was a recommendation, fully stripped — there genuinely is
      // no prereq here; dropping a *recommendation* isn't losing a requirement.
      cls = "clean";
    } else if (hasResidue) {
      cls = "failed";
      notes.push("text present but no course code parsed");
    } else if (hasNotes || hasAdvisory) {
      cls = "annotated";
    } else if (anyTextPresent) {
      cls = "failed";
      notes.push("text present but no course code parsed");
    } else {
      cls = "clean";
    }
  } else if (hasResidue) {
    cls = "partial";
    notes.push("unrecognized residue alongside parsed course(s)");
  } else {
    cls = hasNotes || hasAdvisory ? "annotated" : "clean";
  }

  return {
    prereqExpr,
    coreqExpr,
    cls,
    droppedNoise: hasNotes || hasAdvisory,
    notes,
    prereqNotes,
  };
}
