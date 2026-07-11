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
// ── The grammar (derived from ~640 real FA26 samples) ─────────────────────────
// Cornell prose is remarkably regular. Precedence, widest → tightest:
//
//   1. SEMICOLON  ';'  → top-level AND.  Each semicolon-separated clause is an
//      independent requirement that must be satisfied.
//        "CS 2110; CS 2800"                → and(CS-2110, CS-2800)
//        "CS 1110 or CS 1112; CS 2800"     → and( or(1110,1112), 2800 )
//
//   2. Within a clause, the connective is decided by the words present:
//      • " and " / "&"        → AND across the comma-list
//      • " or " / bare commas → OR  across the comma-list
//      Cornell writes OR-lists as comma lists ("MATH 2210, MATH 2230, MATH 2310,
//      or MATH 2940" = pick one), and AND-lists with explicit "and"
//      ("MATH 1110 and MATH 1120" = both). A clause that mixes them is rare; we
//      resolve by: if it contains " and " AND no " or " → AND; else → OR. This is
//      the pragmatic Cornell reading ("or binds tighter within comma groups" per
//      the task brief — commas group as OR, and joins whole requirements which is
//      what the semicolon already did).
//
//   3. PARENTHESES  "X (or Y or Z)"  → the parenthetical is folded into an OR with
//      the token immediately before it:  MATH 4710 (or ENGRD 2700 or ENGRD 2720)
//      → or(MATH-4710, ENGRD-2700, ENGRD-2720). A leading "or"/"and" inside the
//      parens tells us how to fold; default OR.
//
//   4. RANGE / SEQUENCE  "MATH 4130-MATH 4140"  and  SLASH  "BIOMG 3310/BIOMG 3320"
//      → AND of both endpoints (a course sequence — you need the whole run). This
//      is a deliberate choice: these denote paired/sequential courses, not
//      alternatives, in every sampled case.
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
//   "or corequisites:" or the catalogCoreq field with "or prerequisites:" — these
//   are routed to the correct bucket (see splitLabeledSections). Recognised noise
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
  /\bgrade\s+of\s+[A-D][+-]?\b/i,
  /\baverage\s+of\s+[A-D][+-]?\b/i,
  /\bhigh\s+performance\b/i,
  /\bhigh\s+level\s+of\s+performance\b/i,
  /\bexcellent\s+performance\b/i,
  /\bstrong\s+performance\b/i,
  /\bminimum\s+grade\s+point\s+average\b/i,
  /\bGPA\b/i,
  /\bAP\s+credit\b/i,
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
    // Label leaks: a field literally beginning with "or corequisites:" /
    // "corequisite(s):" routes to coreq; "or prerequisites:" / "prerequisite(s):"
    // routes to prereq. Also a trailing "Corequisites: X" inside a prereq blob.
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
// Parse ONE prose blob (already routed to a bucket) into a PrereqExpr, tracking
// whether noise was found, how it should be handled (advisory vs. note), and
// whether anything failed to parse.
type ClauseOutcome = {
  // The parsed course expression for this clause (pre-advisory-wrap), or null
  // when the clause had no course at all.
  expr: PrereqExpr | null;
  // Connective this clause resolved to when it had course(s); null otherwise.
  connective: "and" | "or" | null;
  // A noise phrase was found somewhere in this clause.
  droppedNoise: boolean;
  // Human-readable, trimmed noise text extracted from the clause — set whenever
  // droppedNoise is true (course-bearing clause) OR the no-course clause was
  // recognised as noise. Null otherwise.
  noiseFragment: string | null;
  // True for a no-course clause that matched NO noise pattern — unrecognised
  // prose, information lost (replaces the old always-true `wasNoise` bug).
  unparsedResidue: boolean;
};

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

// Expand ranges "A-B" and slashes "A/B" into "A and B" (sequence = both).
function expandSequences(clause: string): string {
  let out = clause;
  // range: SUBJ NNNN-SUBJ MMMM  (also "SUBJ NNNN-MMMM")
  out = out.replace(
    /([A-Z]{2,7}\s+\d{3,4})\s*-\s*(?:([A-Z]{2,7})\s+)?(\d{3,4})/g,
    (_w, a, subjB, numB) => {
      const subjA = a.match(/^[A-Z]{2,7}/)![0];
      return `${a} and ${subjB ?? subjA} ${numB}`;
    }
  );
  // slash: SUBJ NNNN/SUBJ MMMM
  out = out.replace(
    /([A-Z]{2,7}\s+\d{3,4})\s*\/\s*(?:([A-Z]{2,7})\s+)?(\d{3,4})/g,
    (_w, a, subjB, numB) => {
      const subjA = a.match(/^[A-Z]{2,7}/)![0];
      return `${a} and ${subjB ?? subjA} ${numB}`;
    }
  );
  return out;
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

function parseClause(rawClause: string): ClauseOutcome {
  let clause = stripLeadingQualifier(rawClause.trim());
  // The e.g./i.e. rule MUST run before foldParentheticals — an example course
  // code must never be folded into a real OR alternative.
  clause = stripExampleParentheticals(clause);
  clause = foldParentheticals(clause);
  clause = expandSequences(clause);

  // Does the clause contain any course at all (after the e.g./i.e. strip)?
  if (!tokenHasCourse(clause)) {
    const wasNoise = NOISE_PATTERNS.some((re) => re.test(clause));
    if (wasNoise) {
      return {
        expr: null,
        connective: null,
        droppedNoise: false,
        noiseFragment: extractNoiseFragment(clause) ?? (clause.trim() || null),
        unparsedResidue: false,
      };
    }
    // No course, and nothing we recognise as noise → unrecognised prose. This
    // is the fixed `wasNoise` bug: previously `|| clause.length > 0` made this
    // branch unreachable and every no-course clause was (wrongly) "noise".
    return {
      expr: null,
      connective: null,
      droppedNoise: false,
      noiseFragment: null,
      unparsedResidue: clause.trim().length > 0,
    };
  }

  // Decide connective: AND only if " and " present and " or " absent AND no commas
  // acting as OR. Cornell's comma lists are OR; "and" joins requirements.
  const hasAnd = /\band\b/i.test(clause);
  const hasOr = /\bor\b/i.test(clause) || clause.includes(",");
  const connective: "and" | "or" = hasAnd && !hasOr ? "and" : "or";

  // Extract every course token in order.
  COURSE_RE.lastIndex = 0;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = COURSE_RE.exec(clause)) !== null) {
    ids.push(normalizeId(m[1], m[2]));
  }
  // Dedupe preserving order.
  const seen = new Set<string>();
  const uniq = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  // Was there noise in this clause? (noise phrase present alongside courses)
  const droppedNoise = NOISE_PATTERNS.some((re) => re.test(clause));
  const noiseFragment = droppedNoise ? extractNoiseFragment(clause) : null;

  const expr = group(connective, uniq.map(courseNode));
  return { expr, connective, droppedNoise, noiseFragment, unparsedResidue: false };
}

// Parse a set of prose blobs (each may contain semicolons → top-level AND across
// clauses) into a single PrereqExpr, plus bookkeeping.
//
// Noise handling per clause (spec 007 §3, decisions 2b/2c):
//   • course-bearing clause, connective "or", noise found → wrap the clause's
//     expr in an `advisory` node (note = the noise fragment). A single
//     surviving alternative can never be silently promoted to hard.
//   • course-bearing clause, connective "and", noise found → keep the hard
//     expr, push the noise fragment onto `notes` instead.
//   • no-course clause, recognised as noise → push the noise fragment onto
//     `notes`; contributes nothing to the tree.
//   • no-course clause, unrecognised prose → `hasResidue` (information lost).
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
  const clauseExprs: PrereqExpr[] = [];

  for (const blob of blobs) {
    if (blob.trim()) anyTextPresent = true;
    // Semicolon = top-level AND. Split, parse each, AND them together.
    const clauses = blob.split(";").map((c) => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      const out = parseClause(clause);
      if (out.unparsedResidue) hasResidue = true;

      if (out.expr) {
        anyCourse = true;
        if (out.connective === "or" && out.droppedNoise) {
          hasAdvisory = true;
          clauseExprs.push({
            type: "advisory",
            expr: out.expr,
            note: out.noiseFragment ?? "noise stripped",
          });
        } else {
          if (out.droppedNoise && out.noiseFragment) notes.push(out.noiseFragment);
          clauseExprs.push(out.expr);
        }
      } else if (out.noiseFragment) {
        notes.push(out.noiseFragment);
      }
    }
  }

  return {
    expr: group("and", clauseExprs),
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
  const prereqExpr = group("and", prereqParts);
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
