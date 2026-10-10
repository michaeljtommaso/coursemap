// scripts/audit-prereqs.ts
// READ-ONLY prerequisite accuracy audit. For every course referenced by the
// supported majors' templates, every hand-authored seed course, and one hop of
// prerequisite references from those, it compares three things:
//
//   (a) Cornell's prerequisite/corequisite prose from the public Class Roster
//       API (primary roster, falling back to an earlier roster when the course
//       is not offered in the primary one);
//   (b) the prereqExpr / coreqExpr (and provenance stamps) stored on the live
//       Firestore course doc — exactly what the app evaluates;
//   (c) what prereq-grammar.ts produces from (a) today.
//
// It then simulates a FRESH plan for every major (template courses placed in
// their suggested semesters, nothing completed, no AP credit) through the
// app's own computeSlotStatusMap, so every "Needs X first" a new user would
// see is listed and attributed to its cause.
//
// It never writes to Firestore. Its only writes are local files under
// scripts/out/ (gitignored): a roster cache and the audit report.
//
// Setup: cd scripts && npm install
// Auth:  set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path.
// Run:
//   npx tsx audit-prereqs.ts                     (uses cached roster JSON when present)
//   npx tsx audit-prereqs.ts --refresh           (re-fetch roster JSON)
//   npx tsx audit-prereqs.ts --roster FA26 --fallback SP26
//
// Output:
//   scripts/out/prereq-audit.json   one row per course + per-program fresh-plan blocks
//   scripts/out/prereq-audit.md     mismatch table + fresh-plan block table
//
// Finding tags (a course can carry several):
//   FALSE_PREREQ    stored tree hard-requires a course no version of the prose requires
//   MISSING_PREREQ  today's prose requires a course the stored tree never mentions
//   WRONG_LOGIC     same courses, wrong shape: AND/OR, coreq stored as prereq,
//                   "or equivalent"/AP alternative stored as a hard block, etc.
//   PLACEHOLDER     stored tree contains a wildcard pattern leaf ("CS 111x") — the
//                   UI prints it verbatim ("Needs CS 111x first")
//   DANGLING_REF    stored tree names a course id that has no course doc
//   NO_DOC          template course with no course doc (off-roster placeholder slot;
//                   the engine never evaluates it)
//   STALE           stored tree is what an older run produced; today's parser on
//                   today's prose disagrees (a re-run fixes it unless overridden)
//   REVIEW          heuristic flag: prose shapes the grammar is known to handle
//                   imperfectly — eyeball the parser output for a PARSER_BUG
// Origin (where the stored value came from) is reported separately per side.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { parsePrereqs, type ParseResult } from "./prereq-grammar";
import { applyErrata, loadErrata } from "./prereq-errata";
import { cleanProse, createRosterReader, type Prose } from "./roster-prose";
import { treeEqual } from "./canonical-json";
import type { PrereqExpr, Course, ProgramSlotWithData } from "../cornell-degree-planner/src/types/db";
import {
  computeSlotStatusMap,
  semesterPrereqPools,
} from "../cornell-degree-planner/src/lib/planner/computeSlotStatusMap";
import { blockedLine } from "../cornell-degree-planner/src/lib/planner/statusLine";
import { findPendingChoice, type OpenChoice } from "../cornell-degree-planner/src/lib/planner/pendingChoices";
import { patternToRegex } from "../cornell-degree-planner/src/lib/planner/satisfies";

// ── CLI ───────────────────────────────────────────────────────────────────────
function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PRIMARY_ROSTER = argValue("--roster", "FA26");
const FALLBACK_ROSTER = argValue("--fallback", "SP26");
const REFRESH = process.argv.includes("--refresh");
const PROJECT_ID = "degree-planner-app";

const SEED_DIR = join(__dirname, "seed-data");
const OUT_DIR = join(__dirname, "out");
const JSON_OUT = join(OUT_DIR, "prereq-audit.json");
const MD_OUT = join(OUT_DIR, "prereq-audit.md");

// ── Types ─────────────────────────────────────────────────────────────────────
type Side = "prereq" | "coreq";
type Leaf = { ref: string; kind: "course" | "concurrent" | "pattern"; hard: boolean; side: Side };

type RawSlot = {
  id: string;
  kind: string;
  courseId?: string | null;
  pattern?: string | null;
  patternTitle?: string | null;
  electiveGroupId?: string | null;
  suggestedSemester: number;
  slotRow?: number;
};
type RawGroup = { id: string; name: string; courseIds?: string[] };
type RawProgram = { id: string; shortName?: string; slots?: RawSlot[]; electiveGroups?: RawGroup[] };

type CourseDoc = {
  id: string;
  subject?: string;
  number?: string;
  title?: string;
  creditsMin?: number;
  offered?: string[];
  prereqText?: string | null;
  coreqText?: string | null;
  prereqExpr?: PrereqExpr | null;
  coreqExpr?: PrereqExpr | null;
  prereqNotes?: string[];
  prereqSource?: string | null;
  coreqSource?: string | null;
  roster?: string | null;
};

type Finding = { tag: string; detail: string };

type AuditRow = {
  id: string;
  title: string | null;
  scope: "template" | "authored" | "hop";
  programs: string[];
  docExists: boolean;
  liveProse: Prose | null; // null = course in neither roster
  storedProse: { prereq: string | null; coreq: string | null; roster: string | null };
  proseDrift: boolean;
  stored: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null; prereqSource: string | null; coreqSource: string | null; prereqNotes: string[] };
  seed: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null } | null;
  parsedLive: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null; cls: string; prereqNotes: string[] } | null;
  parsedStoredText: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null; cls: string } | null;
  matchesParser: boolean;
  origin: { prereq: string; coreq: string };
  findings: Finding[];
  reviewFlags: string[];
};

// ── Small helpers ─────────────────────────────────────────────────────────────
const clean = cleanProse;

// Prose errata (seed-data/prereq-errata.json) apply to every parse here, so the
// audit judges exactly the text parse-prereqs.ts will parse.
const ERRATA = loadErrata();
function parseWithErrata(id: string, prereq: string | null, coreq: string | null): ParseResult {
  const e = applyErrata(id, prereq, coreq, ERRATA);
  return parsePrereqs(e.prereqText, e.coreqText);
}
const code = (id: string) => id.replace(/-/g, " ");
const subjectOf = (id: string) => id.split("-")[0];
const COURSE_ID_RE = /^[A-Z]{2,7}-\d{4}[A-Z]?$/;

function fail(msg: string): never {
  console.error(`\nAUDIT-PREREQS ABORTED: ${msg}`);
  process.exit(1);
}

/** Every leaf of a tree, with whether it is hard (not under an advisory node). */
function leaves(expr: PrereqExpr | null | undefined, side: Side, hard = true, out: Leaf[] = []): Leaf[] {
  if (!expr) return out;
  switch (expr.type) {
    case "course":
    case "concurrent":
      out.push({ ref: expr.id, kind: expr.type, hard, side });
      break;
    case "pattern":
      out.push({ ref: expr.pattern, kind: "pattern", hard, side });
      break;
    case "advisory":
      leaves(expr.expr, side, false, out);
      break;
    case "and":
    case "or":
      for (const c of expr.children) leaves(c, side, hard, out);
      break;
  }
  return out;
}
const bothLeaves = (pre: PrereqExpr | null | undefined, co: PrereqExpr | null | undefined) => [
  ...leaves(pre, "prereq"),
  ...leaves(co, "coreq"),
];

/** Rebuild a tree keeping only the keys its node type defines. Firestore
 *  set({merge:true}) deep-merges map fields, so a node rewritten from one type
 *  to another keeps the old type's keys (an advisory node carrying a stale
 *  `children` or `id`). The app switches on `type`, so evaluation is unaffected,
 *  but raw comparisons are not. */
function normalizeTree(expr: PrereqExpr | null | undefined): PrereqExpr | null {
  if (!expr) return null;
  switch (expr.type) {
    case "course":
    case "concurrent":
      return { type: expr.type, id: expr.id };
    case "pattern":
      return { type: "pattern", pattern: expr.pattern };
    case "advisory":
      return { type: "advisory", expr: normalizeTree(expr.expr)!, note: expr.note };
    case "and":
    case "or":
      return { type: expr.type, children: expr.children.map((c) => normalizeTree(c)!) };
  }
}

/** Order-insensitive canonical form (and/or children sorted) for shape comparison. */
function shapeKey(expr: PrereqExpr | null | undefined): string {
  if (!expr) return "null";
  switch (expr.type) {
    case "course":
      return `C(${expr.id})`;
    case "concurrent":
      return `K(${expr.id})`;
    case "pattern":
      return `P(${expr.pattern})`;
    case "advisory":
      return `A(${shapeKey(expr.expr)})`;
    case "and":
    case "or":
      return `${expr.type}[${expr.children.map(shapeKey).sort().join(",")}]`;
  }
}

/** Compact one-line rendering for tables: "MATH-1910 & (CS-1110 | CS-1112)". */
function render(expr: PrereqExpr | null | undefined): string {
  if (!expr) return "—";
  switch (expr.type) {
    case "course":
      return expr.id;
    case "concurrent":
      return `~${expr.id}`;
    case "pattern":
      return `pattern:${expr.pattern}`;
    case "advisory":
      return `adv(${render(expr.expr)})`;
    case "and":
    case "or": {
      const sep = expr.type === "and" ? " & " : " | ";
      return expr.children
        .map((c) => (c.type === "and" || c.type === "or" ? `(${render(c)})` : render(c)))
        .join(sep);
    }
  }
}

// Prose shapes prereq-grammar.ts is known to handle imperfectly. A flag is a
// prompt to eyeball the parser output, not a verdict.
const REVIEW_PATTERNS: Array<[RegExp, string]> = [
  [/\bco-?registration\b|\bconcurrent(ly)?\b|\bco-?requisite\b(?!s?\s*:)/i, "inline concurrency wording outside a label"],
  [/\b(one|two|three) of\b|\bany (one|two)\b|\bat least (one|two)\b/i, "n-of-m wording"],
  [/\b\d{4}-level\b|\blevel\b/i, "course-level wording"],
  [/\bconsent\b|\bapproval\b|\binstructor\b/i, "permission wording outside the noise list"],
  [/\bplacement\b|\bAP\b|\bIB\b/, "AP/placement alternative"],
  [/\bmajors?\b|\bstudents\b|\bstanding\b|\bjuniors?\b|\bseniors?\b/i, "population qualifier"],
  [/\bor\b[^;.]*\band\b|\band\b[^;.]*\bor\b/i, "mixed and/or in one clause"],
  [/\bexcept\b|\bnot\b|\bwithout\b/i, "negation"],
  [/\be\.g\.|\bi\.e\.|\bsuch as\b|\bfor example\b/i, "example wording"],
  [/;\s*or\b/i, "'; or X' alternative clause (grammar ANDs semicolon clauses)"],
  [/(^|\|\s*)or\s+prerequisites?\s*:/i, "coreq field 'or prerequisites:' label (grammar makes it a hard prereq; Cornell means prereq-or-coreq)"],
  [/[A-Z]{2,7}\s+\d{4}\s*\/\s*[A-Z]{2,7}\s+\d{4}[^;.]*\bor\b/, "slash pair inside an or-list (grammar reads slash as AND)"],
];
function reviewFlags(p: Prose | null): string[] {
  if (!p) return [];
  const text = [p.prereq, p.coreq].filter(Boolean).join(" | ");
  return REVIEW_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

// ── Inputs ────────────────────────────────────────────────────────────────────
function loadSeedPrograms(): RawProgram[] {
  const dir2025 = join(SEED_DIR, "programs-2025");
  const modern = readdirSync(dir2025)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir2025, f), "utf8")) as RawProgram);
  const legacy = JSON.parse(readFileSync(join(SEED_DIR, "programs.json"), "utf8")) as RawProgram[];
  return [...modern, ...legacy];
}

function loadSeedCourses(): Map<string, { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null }> {
  const raw = JSON.parse(readFileSync(join(SEED_DIR, "courses.json"), "utf8")) as Array<{
    id: string;
    prereqExpr: PrereqExpr | null;
    coreqExpr: PrereqExpr | null;
  }>;
  return new Map(raw.map((c) => [c.id, { prereqExpr: c.prereqExpr ?? null, coreqExpr: c.coreqExpr ?? null }]));
}

/** Course ids a program template references directly (course slots, exact-code
 *  pattern slots, and elective-group course lists). */
function templateCourseIds(p: RawProgram): Set<string> {
  const ids = new Set<string>();
  for (const s of p.slots ?? []) {
    if (s.courseId) ids.add(s.courseId);
    if (s.pattern && COURSE_ID_RE.test(s.pattern)) ids.add(s.pattern);
  }
  for (const g of p.electiveGroups ?? []) for (const id of g.courseIds ?? []) ids.add(id);
  return ids;
}

async function fetchDocs(db: Firestore, ids: string[]): Promise<Map<string, CourseDoc>> {
  const out = new Map<string, CourseDoc>();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.collection("courses").doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) out.set(s.id, { id: s.id, ...(s.data() as object) } as CourseDoc);
  }
  return out;
}

const roster = createRosterReader({ refresh: REFRESH });
const liveProseFor = (ids: string[]) => roster.proseFor(ids, [PRIMARY_ROSTER, FALLBACK_ROSTER]);

// ── Per-course analysis ───────────────────────────────────────────────────────
function originOf(
  side: Side,
  doc: CourseDoc | undefined,
  seed: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null } | null,
  parsedStoredText: ParseResult | null
): string {
  if (!doc) return "no course doc";
  const stored = normalizeTree(side === "prereq" ? doc.prereqExpr : doc.coreqExpr);
  const source = side === "prereq" ? doc.prereqSource : doc.coreqSource;
  const seedVal = seed ? (side === "prereq" ? seed.prereqExpr : seed.coreqExpr) : undefined;
  const parsedVal = parsedStoredText
    ? side === "prereq"
      ? parsedStoredText.prereqExpr
      : parsedStoredText.coreqExpr
    : null;
  if (source === "authored") {
    if (seedVal !== undefined && treeEqual(stored, seedVal)) return "authored seed (seed-data/courses.json)";
    return "pre-stamp value frozen by authored stamp (differs from seed)";
  }
  if (typeof source === "string" && source.startsWith("parsed")) {
    if (treeEqual(stored, parsedVal)) return `${source} (= current grammar on stored prose)`;
    return `${source} (older grammar output, not refreshed)`;
  }
  if (stored == null) return "unset (never written)";
  return `unstamped (${source ?? "no source"})`;
}

function analyze(
  id: string,
  scope: "template" | "authored" | "hop",
  programs: string[],
  doc: CourseDoc | undefined,
  prose: Prose | null,
  seed: { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null } | null,
  existingIds: Set<string>
): AuditRow {
  const rawPre = doc?.prereqExpr ?? null;
  const rawCo = doc?.coreqExpr ?? null;
  const storedPre = normalizeTree(rawPre);
  const storedCo = normalizeTree(rawCo);
  const mergeResidue = !treeEqual(rawPre, storedPre) || !treeEqual(rawCo, storedCo);
  const storedProse = {
    prereq: doc?.prereqText ?? null,
    coreq: doc?.coreqText ?? null,
    roster: doc?.roster ?? null,
  };
  const live = prose ? parseWithErrata(id, prose.prereq, prose.coreq) : null;
  const fromStored =
    storedProse.prereq || storedProse.coreq ? parseWithErrata(id, storedProse.prereq, storedProse.coreq) : null;
  const proseDrift =
    !!prose && (clean(storedProse.prereq) !== prose.prereq || clean(storedProse.coreq) !== prose.coreq);

  // Reference tree: today's parser on today's prose. If the course is in
  // neither roster, fall back to the prose captured at the last sync.
  const ref = live ?? fromStored;
  const refPre = ref?.prereqExpr ?? null;
  const refCo = ref?.coreqExpr ?? null;
  const matchesParser = treeEqual(storedPre, refPre) && treeEqual(storedCo, refCo);

  const findings: Finding[] = [];
  // No course doc: the template can only show this course as an off-roster
  // placeholder slot, which the engine never evaluates. Nothing to compare.
  if (!doc) {
    findings.push({
      tag: "NO_DOC",
      detail: prose ? `in ${prose.roster} roster but not in the catalog (never synced)` : "in neither roster",
    });
  }
  if (mergeResidue) {
    findings.push({ tag: "MERGE_RESIDUE", detail: "stored tree carries stray keys from a previous tree (merge-write)" });
  }
  const stored = bothLeaves(storedPre, storedCo);
  const refLeaves = bothLeaves(refPre, refCo);
  // A course is "supported" by the prose if ANY version of the prose (today's
  // or the last-synced) mentions it as a leaf in any modality.
  const supported = new Set([
    ...refLeaves.map((l) => l.ref),
    ...bothLeaves(fromStored?.prereqExpr, fromStored?.coreqExpr).map((l) => l.ref),
  ]);
  const storedRefs = new Set(stored.map((l) => l.ref));

  // PLACEHOLDER — wildcard leaves in what the app evaluates (printed verbatim
  // as "Needs CS 111x first"). DANGLING_REF — a leaf id with no course doc
  // (printed as a code the user cannot find or place).
  for (const l of stored) {
    if (l.kind === "pattern") findings.push({ tag: "PLACEHOLDER", detail: `pattern leaf "${code(l.ref)}" (${l.side})` });
    else if (!existingIds.has(l.ref)) findings.push({ tag: "DANGLING_REF", detail: `${l.ref} has no course doc (${l.side})` });
  }

  if (doc && !matchesParser) {
    // FALSE_PREREQ — a hard stored leaf no prose supports.
    for (const l of stored) {
      if (l.kind === "pattern" || !l.hard) continue;
      if (!supported.has(l.ref)) findings.push({ tag: "FALSE_PREREQ", detail: `${l.side} requires ${l.ref}; prose does not` });
    }
    // MISSING_PREREQ — a hard leaf of today's prose the stored tree never mentions.
    for (const l of refLeaves) {
      if (!l.hard || l.kind === "pattern") continue;
      if (!storedRefs.has(l.ref)) {
        // A stored pattern that matches this course already "mentions" it.
        const coveredByPattern = stored.some(
          (s) => s.kind === "pattern" && patternToRegex(s.ref).test(code(l.ref))
        );
        if (!coveredByPattern) findings.push({ tag: "MISSING_PREREQ", detail: `prose ${l.side} needs ${l.ref}; stored tree lacks it` });
      }
    }
    // WRONG_LOGIC — modality / shape differences on courses both trees share.
    const logic: string[] = [];
    for (const l of stored) {
      if (l.kind === "pattern") continue;
      const twins = refLeaves.filter((r) => r.ref === l.ref);
      if (twins.length === 0) continue;
      if (l.hard && twins.every((r) => !r.hard)) logic.push(`${l.ref} stored hard; prose makes it advisory ("or equivalent"/AP/permission)`);
      else if (!l.hard && twins.some((r) => r.hard)) logic.push(`${l.ref} stored advisory; prose makes it hard`);
      if (l.side === "prereq" && l.kind === "course" && twins.every((r) => r.side === "coreq" || r.kind === "concurrent"))
        logic.push(`${l.ref} stored as hard prereq; prose allows it concurrently (coreq / "prereq or coreq")`);
      if (l.side === "coreq" && twins.every((r) => r.side === "prereq" && r.kind === "course"))
        logic.push(`${l.ref} stored as coreq; prose makes it a prereq`);
    }
    const sameRefs =
      [...storedRefs].sort().join() === [...new Set(refLeaves.map((r) => r.ref))].sort().join();
    if (
      logic.length === 0 &&
      sameRefs &&
      (shapeKey(storedPre) !== shapeKey(refPre) || shapeKey(storedCo) !== shapeKey(refCo))
    ) {
      logic.push(`AND/OR structure differs: stored ${render(storedPre)} / ${render(storedCo)} vs prose ${render(refPre)} / ${render(refCo)}`);
    }
    for (const d of [...new Set(logic)]) findings.push({ tag: "WRONG_LOGIC", detail: d });

    // STALE — the stored tree is an older run's output; today's grammar
    // disagrees. (Provenance decides whether a re-run would actually fix it.)
    const prereqSource = doc?.prereqSource ?? null;
    const writable = (s: string | null | undefined) => s == null || s.startsWith("parsed");
    const blockedBy =
      !writable(prereqSource) || !writable(doc?.coreqSource ?? null) ? "authored stamp blocks the re-run" : null;
    findings.push({
      tag: "STALE",
      detail:
        `stored ≠ parse(today's prose)` +
        (proseDrift ? "; prose changed since last sync" : "") +
        (blockedBy ? `; ${blockedBy}` : "") +
        (live && live.cls !== "clean" && live.cls !== "annotated"
          ? `; today's parse is "${live.cls}" (quarantined, never auto-written)`
          : ""),
    });
  }

  return {
    id,
    title: doc?.title ?? null,
    scope,
    programs,
    docExists: !!doc,
    liveProse: prose,
    storedProse,
    proseDrift,
    stored: {
      prereqExpr: storedPre,
      coreqExpr: storedCo,
      prereqSource: doc?.prereqSource ?? null,
      coreqSource: doc?.coreqSource ?? null,
      prereqNotes: Array.isArray(doc?.prereqNotes) ? doc!.prereqNotes! : [],
    },
    seed,
    parsedLive: live
      ? { prereqExpr: live.prereqExpr, coreqExpr: live.coreqExpr, cls: live.cls, prereqNotes: live.prereqNotes }
      : null,
    parsedStoredText: fromStored
      ? { prereqExpr: fromStored.prereqExpr, coreqExpr: fromStored.coreqExpr, cls: fromStored.cls }
      : null,
    matchesParser,
    origin: {
      prereq: originOf("prereq", doc, seed, fromStored),
      coreq: originOf("coreq", doc, seed, fromStored),
    },
    findings,
    reviewFlags: reviewFlags(prose),
  };
}

// ── Fresh-plan simulation (the app's own engine) ──────────────────────────────
type Trees = { prereqExpr: PrereqExpr | null; coreqExpr: PrereqExpr | null };

function toCourse(doc: CourseDoc, trees: Trees): Course {
  return {
    id: doc.id,
    subject: doc.subject ?? subjectOf(doc.id),
    number: doc.number ?? doc.id.split("-")[1],
    title: doc.title ?? doc.id,
    credits_min: doc.creditsMin ?? 0,
    credits_max: doc.creditsMin ?? 0,
    description: null,
    offered: [], // term checks are out of scope here
    prereq_expr: trees.prereqExpr,
    coreq_expr: trees.coreqExpr,
    forbidden_overlaps: [],
    prereq_notes: doc.prereqNotes ?? [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: doc.roster ?? null,
    updated_at: new Date(0).toISOString(),
  };
}

type Block = {
  program: string;
  slotId: string;
  semester: number;
  course: string;
  message: string;
  leaves: Array<{ leaf: string; side: Side; cause: string }>;
  // Set when the card is only waiting on an open template choice due earlier:
  // the app shows the amber "Pick your … first" line, not a red block.
  choice?: string;
};

// The template's open choices, mirroring the app's openChoices(): pattern
// seats, and "pick one of these" list groups with explicit members. Credit
// pools and attribute seats never name a specific prerequisite course.
function templateChoices(p: RawProgram): OpenChoice[] {
  const groups = new Map((p.electiveGroups ?? []).map((g) => [g.id, g]));
  const out: OpenChoice[] = [];
  const seenGroups = new Set<string>();
  const slots = [...(p.slots ?? [])].sort((a, b) => a.suggestedSemester - b.suggestedSemester);
  for (const s of slots) {
    if (s.kind === "pattern" && s.pattern) {
      out.push({
        id: s.id,
        label: s.patternTitle ?? s.pattern.replace(/-/g, " "),
        requirement: { kind: "pattern", pattern: s.pattern },
        suggestedSem: s.suggestedSemester,
      });
    } else if (s.kind === "elective" && s.electiveGroupId && !seenGroups.has(s.electiveGroupId)) {
      const g = groups.get(s.electiveGroupId);
      seenGroups.add(s.electiveGroupId);
      const rule = (g as { qualifyingRule?: { type?: string } } | undefined)?.qualifyingRule;
      if (g && rule?.type === "list" && g.courseIds && g.courseIds.length > 0) {
        out.push({ id: g.id, label: g.name, requirement: null, courseIds: g.courseIds, suggestedSem: s.suggestedSemester });
      }
    }
  }
  return out;
}

/**
 * Place every template course in its suggested semester (nothing completed,
 * no AP credit, elective/pattern/attribute slots unfilled) and run the app's
 * computeSlotStatusMap. `treesFor` picks which trees the engine sees: the
 * stored ones (what users get today) or today's parse (what a straight
 * re-parse would ship).
 */
function simulateProgram(
  p: RawProgram,
  docs: Map<string, CourseDoc>,
  rows: Map<string, AuditRow>,
  treesFor: (row: AuditRow | undefined, doc: CourseDoc) => Trees
): Block[] {
  const groups = new Map((p.electiveGroups ?? []).map((g) => [g.id, g]));
  const rawSlots = p.slots ?? [];
  const slots = rawSlots.map(
    (s) =>
      ({
        id: s.id,
        program_id: p.id,
        kind: s.kind,
        course_id: s.courseId ?? null,
        pattern: s.pattern ?? null,
        pattern_title: s.patternTitle ?? null,
        elective_group_id: s.electiveGroupId ?? null,
        suggested_semester: s.suggestedSemester,
        slot_row: s.slotRow ?? 0,
        category: null,
        attribute_match: null,
        courses:
          s.kind === "course" && s.courseId && docs.has(s.courseId)
            ? toCourse(docs.get(s.courseId)!, treesFor(rows.get(s.courseId), docs.get(s.courseId)!))
            : null,
        elective_groups: null,
      }) as unknown as ProgramSlotWithData
  );
  const { statusMap } = computeSlotStatusMap(slots, [], {}, {});
  const choices = templateChoices(p);
  const blocks: Block[] = [];
  for (const slot of slots) {
    const st = statusMap[slot.id];
    if (!st?.blocked || !slot.courses) continue;
    const course = slot.courses.id;
    const row = rows.get(course);
    const sem = slot.suggested_semester;
    const pending = findPendingChoice({
      prereqExpr: slot.courses.prereq_expr,
      coreqExpr: slot.courses.coreq_expr,
      sem,
      pools: semesterPrereqPools(slots, [], {}, {}, sem),
      choices,
    });
    const unmet: Array<{ leaf: string; side: Side }> = [
      ...st.unmetPrereqLeaves.map((leaf) => ({ leaf, side: "prereq" as Side })),
      ...st.unmetCoreqLeaves.map((leaf) => ({ leaf, side: "coreq" as Side })),
    ];
    const attributed = unmet.map(({ leaf, side }) => {
      const leafId = leaf.replace(/ /g, "-");
      const tagged = (cause: string) => ({ leaf, side, cause });
      // 1. Data errors on the blocked course.
      if (!COURSE_ID_RE.test(leafId)) return tagged("data: PLACEHOLDER (wildcard leaf printed verbatim)");
      const err = row?.findings.find((f) => f.tag === "FALSE_PREREQ" && f.detail.includes(leafId));
      if (err) return tagged("data: FALSE_PREREQ");
      const logic = row?.findings.find((f) => f.tag === "WRONG_LOGIC" && f.detail.includes(leafId));
      if (logic) return tagged(`data: WRONG_LOGIC (${logic.detail})`);
      if (!docs.has(leafId)) {
        const placeholder = rawSlots.find((s) => s.pattern === leafId && s.suggestedSemester < sem);
        return tagged(
          placeholder
            ? `evaluator: ${leafId} has no course doc; its off-roster placeholder slot ${placeholder.id} can never satisfy it`
            : `data: DANGLING_REF (${leafId} has no course doc)`
        );
      }
      // 2. An unfilled template slot that the user's pick would satisfy.
      const slotHolds = (s: RawSlot) =>
        (s.kind === "pattern" && !!s.pattern && patternToRegex(s.pattern).test(leaf)) ||
        (s.kind === "elective" && !!s.electiveGroupId && (groups.get(s.electiveGroupId)?.courseIds ?? []).includes(leafId));
      const earlier = rawSlots.find((s) => s.suggestedSemester < sem && slotHolds(s));
      if (earlier) return tagged(`evaluator: needs a pick in unfilled slot ${earlier.id} (sem ${earlier.suggestedSemester})`);
      const same = rawSlots.find((s) => s.suggestedSemester === sem && slotHolds(s));
      if (same) return tagged(`evaluator: needs a pick in same-semester slot ${same.id}`);
      // 3. Template order / template gap.
      const anywhere = rawSlots.find((s) => s.courseId === leafId);
      if (anywhere) return tagged(`template order: ${leafId} sits in sem ${anywhere.suggestedSemester}`);
      return tagged("template gap: required by the prose but absent from the template");
    });
    const line = blockedLine(st.unmetPrereqLeaves, st.unmetCoreqLeaves);
    blocks.push({
      program: p.id,
      slotId: slot.id,
      semester: sem,
      course,
      message: pending ? `Pick your ${pending.label} first` : line.secondary ? `${line.text} · ${line.secondary}` : line.text,
      leaves: attributed,
      ...(pending ? { choice: pending.requirementId } : {}),
    });
  }
  return blocks;
}

// ── Report ────────────────────────────────────────────────────────────────────
const esc = (s: string | null | undefined, max = 140) => {
  if (!s) return "—";
  const t = s.length > max ? s.slice(0, max - 1) + "…" : s;
  return t.replace(/\|/g, "\\|");
};

const ALL_TAGS = ["FALSE_PREREQ", "MISSING_PREREQ", "WRONG_LOGIC", "PLACEHOLDER", "STALE", "DANGLING_REF", "NO_DOC", "MERGE_RESIDUE"];

function blockTable(lines: string[], blocks: Block[]) {
  lines.push("| program | sem | course | message | cause per leaf |");
  lines.push("|---|---|---|---|---|");
  for (const b of blocks) {
    const causes = b.leaves.map((l) => `${l.leaf}${l.side === "coreq" ? " (coreq)" : ""}: ${l.cause}`).join("; ");
    lines.push(`| ${b.program.replace(/^cornell-/, "")} | ${b.semester} | ${b.course} | ${esc(b.message)} | ${esc(causes, 300)} |`);
  }
}

function writeMarkdown(rows: AuditRow[], blocks: Block[], projectedBlocks: Block[]) {
  const tags = ALL_TAGS;
  const lines: string[] = [];
  lines.push(`# Prereq audit — ${new Date().toISOString().slice(0, 10)} (${PRIMARY_ROSTER}, fallback ${FALLBACK_ROSTER})`, "");
  lines.push(`Courses checked: ${rows.length} (template ${rows.filter((r) => r.scope === "template").length}, authored-only ${rows.filter((r) => r.scope === "authored").length}, one-hop ${rows.filter((r) => r.scope === "hop").length})`);
  lines.push(`Stored tree ≠ today's parse: ${rows.filter((r) => r.docExists && !r.matchesParser).length}`);
  for (const t of tags) lines.push(`- ${t}: ${rows.filter((r) => r.findings.some((f) => f.tag === t)).length} course(s)`);
  lines.push("");
  lines.push("## Mismatches", "");
  lines.push("| course | Cornell prose (trimmed) | stored expr [source] | parser (today) | tags | origin |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.findings.length > 0)) {
    const prose = r.liveProse
      ? `${r.liveProse.roster}: ${[r.liveProse.prereq && `P: ${r.liveProse.prereq}`, r.liveProse.coreq && `C: ${r.liveProse.coreq}`].filter(Boolean).join(" ") || "(none)"}`
      : `not in roster; synced: ${r.storedProse.prereq ?? "(none)"}`;
    const stored = `${render(r.stored.prereqExpr)}${r.stored.coreqExpr ? ` / co: ${render(r.stored.coreqExpr)}` : ""} [${r.stored.prereqSource ?? "—"}]`;
    const parsed = r.parsedLive
      ? `${render(r.parsedLive.prereqExpr)}${r.parsedLive.coreqExpr ? ` / co: ${render(r.parsedLive.coreqExpr)}` : ""} (${r.parsedLive.cls})`
      : "—";
    const tagList = [...new Set(r.findings.map((f) => f.tag))].join(", ");
    const origin = r.origin.prereq === r.origin.coreq ? r.origin.prereq : `pre: ${r.origin.prereq}; co: ${r.origin.coreq}`;
    lines.push(`| ${r.id} | ${esc(prose)} | ${esc(stored, 90)} | ${esc(parsed, 90)} | ${tagList} | ${esc(origin, 80)} |`);
  }
  lines.push("", "## Fresh-plan blocks today (template placed, nothing completed, no AP credit)", "");
  blockTable(lines, blocks);
  const key = (b: Block) => `${b.program}|${b.slotId}|${b.message}`;
  const before = new Set(blocks.map(key));
  const after = new Set(projectedBlocks.map(key));
  lines.push("", "## Blocks a straight re-parse of today's prose would ADD", "");
  blockTable(lines, projectedBlocks.filter((b) => !before.has(key(b))));
  lines.push("", "## Blocks a straight re-parse would REMOVE", "");
  blockTable(lines, blocks.filter((b) => !after.has(key(b))));
  lines.push("", "## Parser review flags (prose shapes worth eyeballing)", "");
  for (const r of rows.filter((x) => x.reviewFlags.length > 0 && x.liveProse)) {
    lines.push(`- ${r.id} [${r.reviewFlags.join("; ")}] — "${esc(r.liveProse!.prereq ?? "", 200)}"${r.liveProse!.coreq ? ` / coreq "${esc(r.liveProse!.coreq, 120)}"` : ""} → ${render(r.parsedLive?.prereqExpr)}${r.parsedLive?.coreqExpr ? ` / co: ${render(r.parsedLive.coreqExpr)}` : ""}`);
  }
  writeFileSync(MD_OUT, lines.join("\n") + "\n", "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key (never commit or echo it).");
  }
  console.log(`\n── audit-prereqs (READ-ONLY) — rosters ${PRIMARY_ROSTER} → ${FALLBACK_ROSTER} ──`);

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  // 1. Scope: every course the supported templates reference. Template slots
  //    come from the LIVE program docs when present (what users get), else the seed.
  const seedPrograms = loadSeedPrograms();
  const programSnaps = await db.getAll(...seedPrograms.map((p) => db.collection("programs").doc(p.id)));
  const programs: RawProgram[] = seedPrograms.map((seedP, i) =>
    programSnaps[i].exists ? ({ id: seedP.id, ...(programSnaps[i].data() as object) } as RawProgram) : seedP
  );
  const programsByCourse = new Map<string, string[]>();
  for (const p of programs) {
    for (const id of templateCourseIds(p)) {
      programsByCourse.set(id, [...(programsByCourse.get(id) ?? []), p.id]);
    }
  }
  // Every hand-authored seed course is in scope too: authored rows are exempt
  // from the parser, so nothing else ever re-checks them.
  const seed = loadSeedCourses();
  const authoredOnly = [...seed.keys()].filter((id) => !programsByCourse.has(id));
  const templateIds = [...programsByCourse.keys(), ...authoredOnly].sort();
  console.log(`   programs: ${programs.length} (${programSnaps.filter((s) => s.exists).length} live)  template + authored courses: ${templateIds.length}`);

  // 2. Live docs + Cornell prose for the template set.
  const docs = await fetchDocs(db, templateIds);
  const prose = await liveProseFor(templateIds);

  // 3. One hop: every course id referenced by a template course's stored tree,
  //    its parse of today's prose, or its parse of the last-synced prose.
  const hop = new Set<string>();
  for (const id of templateIds) {
    const d = docs.get(id);
    const p = prose.get(id);
    const trees = [d?.prereqExpr, d?.coreqExpr];
    if (p) {
      const r = parseWithErrata(id, p.prereq, p.coreq);
      trees.push(r.prereqExpr, r.coreqExpr);
    }
    if (d?.prereqText || d?.coreqText) {
      const r = parseWithErrata(id, d.prereqText ?? null, d.coreqText ?? null);
      trees.push(r.prereqExpr, r.coreqExpr);
    }
    for (const t of trees)
      for (const l of leaves(t ?? null, "prereq"))
        if (l.kind !== "pattern" && !programsByCourse.has(l.ref) && !seed.has(l.ref)) hop.add(l.ref);
  }
  const hopIds = [...hop].sort();
  for (const [id, d] of await fetchDocs(db, hopIds)) docs.set(id, d);
  for (const [id, p] of await liveProseFor(hopIds)) prose.set(id, p);
  console.log(`   one-hop courses: ${hopIds.length}  course docs read: ${docs.size}`);

  // 4. Analyze.
  // Existence for PLACEHOLDER checks: anything we read, plus anything the
  // roster knows (a leaf we didn't read may still exist).
  const existingIds = new Set(docs.keys());
  const rows: AuditRow[] = [...templateIds, ...hopIds].map((id) =>
    analyze(
      id,
      programsByCourse.has(id) ? "template" : seed.has(id) ? "authored" : "hop",
      programsByCourse.get(id) ?? [],
      docs.get(id),
      prose.get(id) ?? null,
      seed.get(id) ?? null,
      existingIds
    )
  );
  // Leaves of hop courses point beyond what we read; only flag dangling ids we
  // actually looked up.
  const lookedUp = new Set([...templateIds, ...hopIds]);
  for (const r of rows) {
    r.findings = r.findings.filter(
      (f) => !(f.tag === "DANGLING_REF" && !lookedUp.has(f.detail.split(" ")[0]))
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 5. Fresh-plan simulation per program.
  //    "stored": what users see today. "projected": what a straight re-parse of
  //    today's prose would ship (partial/failed parses keep the stored tree,
  //    matching parse-prereqs' quarantine rule).
  const storedTrees = (_row: AuditRow | undefined, doc: CourseDoc): Trees => ({
    prereqExpr: normalizeTree(doc.prereqExpr),
    coreqExpr: normalizeTree(doc.coreqExpr),
  });
  const projectedTrees = (row: AuditRow | undefined, doc: CourseDoc): Trees =>
    row?.parsedLive && row.parsedLive.cls !== "partial" && row.parsedLive.cls !== "failed"
      ? { prereqExpr: row.parsedLive.prereqExpr, coreqExpr: row.parsedLive.coreqExpr }
      : storedTrees(row, doc);
  const blocks = programs.flatMap((p) => simulateProgram(p, docs, byId, storedTrees));
  const projectedBlocks = programs.flatMap((p) => simulateProgram(p, docs, byId, projectedTrees));

  // 6. Output.
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), rosters: [PRIMARY_ROSTER, FALLBACK_ROSTER], rows, blocks, projectedBlocks }, null, 2) + "\n", "utf8");
  writeMarkdown(rows, blocks, projectedBlocks);

  const tagCount = (t: string) => rows.filter((r) => r.findings.some((f) => f.tag === t)).length;
  console.log(`\n── RESULTS ──`);
  console.log(`   courses checked:            ${rows.length}`);
  console.log(`   in neither roster:          ${rows.filter((r) => !r.liveProse).length}`);
  console.log(`   no course doc:              ${rows.filter((r) => !r.docExists).length}`);
  console.log(`   prose drift since sync:     ${rows.filter((r) => r.proseDrift).length}`);
  console.log(`   stored ≠ today's parse:     ${rows.filter((r) => r.docExists && !r.matchesParser).length}`);
  for (const t of ALL_TAGS) {
    console.log(`   ${t.padEnd(16)}            ${tagCount(t)}`);
  }
  console.log(`   parser review flags:        ${rows.filter((r) => r.reviewFlags.length > 0).length}`);
  // Red = blocked; amber = only waiting on an open choice ("Pick your … first").
  // A red card with any "data:" leaf is blocked by a data error.
  const red = (bs: Block[]) => bs.filter((b) => !b.choice);
  const dataRed = (bs: Block[]) => red(bs).filter((b) => b.leaves.some((l) => l.cause.startsWith("data:")));
  const summary = (bs: Block[]) =>
    `red ${red(bs).length} (data errors ${dataRed(bs).length}) + amber pick-one ${bs.length - red(bs).length}` +
    ` across ${new Set(red(bs).map((b) => b.program)).size} programs`;
  console.log(`   fresh-plan cards, stored trees:      ${summary(blocks)}`);
  console.log(`   ...after a straight re-parse:        ${summary(projectedBlocks)}`);
  const storedKeys = new Set(red(blocks).map((b) => `${b.program}|${b.slotId}`));
  const added = dataRed(projectedBlocks).filter((b) => !storedKeys.has(`${b.program}|${b.slotId}`));
  console.log(`   re-parse ADDS red data-error cards:  ${added.length}${added.length ? " — " + added.map((b) => `${b.program.replace(/^cornell-/, "")}:${b.course}`).join(", ") : ""}`);
  console.log(`\n   wrote ${JSON_OUT}\n   wrote ${MD_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
