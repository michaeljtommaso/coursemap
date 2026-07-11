// scripts/validate-programs.ts
// Authoring-pipeline validation harness (spec 011 §2/§2a, Unit 11B) — the
// pipeline's TEETH. Every requirement in every authored major is evaluated
// against the FULL course catalog; a requirement with zero (or implausibly
// few) qualifying courses is an unsatisfiable requirement — the FWS class of
// bug (a slot/pool that can never be filled, shipped anyway) — and fails
// LOUDLY (nonzero exit, CI-gate ready) instead of silently shipping broken.
//
// This is BROADER than scripts/validate-programs-2025.ts (the existing
// lighter validator, which only checks shape/id-existence/sanity-ranges for
// the 2025 corpus against a course-id cache). This harness additionally
// evaluates pattern/attribute/elective-pool SATISFIABILITY against the full
// catalog and produces the per-major coverage report (spec §2a). The two
// scripts are intentionally separate — validate-programs-2025.ts is left
// untouched.
//
// ── Data source (dual, per binding decision 1) ────────────────────────────
//   Default:        reads ALL course docs from Firestore (read-only). Requires
//                   GOOGLE_APPLICATION_CREDENTIALS, like sibling scripts
//                   (seed-firestore.ts, validate-programs-2025.ts). Aborts
//                   cleanly with a clear message if the env var is unset —
//                   never attempts a live call without it.
//   --dump <path>:  reads a JSON array of course docs from a file instead
//                   (offline/CI mode). Each element is shaped like a Firestore
//                   course doc (id, subject, number, title, creditsMin,
//                   creditsMax, attrs — see CatalogCourse below). This is also
//                   how scripts/validate-programs.corpus.ts exercises the
//                   harness end-to-end without any network access.
//
// Run (live):    GOOGLE_APPLICATION_CREDENTIALS=... npx tsx validate-programs.ts
// Run (offline): npx tsx validate-programs.ts --dump path/to/catalog-dump.json
//
// ── What it validates (binding decision 2) — per authored major, composed
// from the SAME seed-data files the seeders read (scripts/seed-firestore.ts,
// scripts/seed-programs-2025.ts): the legacy scripts/seed-data/programs.json
// (each program object is already fully self-contained — slots + electiveGroups
// embedded, exactly what seed-firestore.ts's buildProgramDoc reads; slots.json/
// electiveGroups.json are the same data flattened for other purposes and are
// NOT separately joined here — that would be re-deriving what programs.json
// already carries) plus scripts/seed-data/programs-2025/*.json (each file
// fully self-contained the same way, read by scripts/seed-programs-2025.ts):
//
//   - Every course-kind slot's courseId EXISTS in the catalog. Missing → ERROR.
//     Title mismatches vs the slot's AUTHORED snapshot title are WARNINGS, not
//     errors — the raw seed JSON carries no courseTitle field itself (that's
//     denormalized onto the doc only at seed time, from courses.json for the
//     legacy set or from live Firestore for the 2025 set — see buildSlotDoc in
//     both seeders). The only pre-seed "authored snapshot" that exists is the
//     legacy set's local scripts/seed-data/courses.json (the small course
//     snapshot seed-firestore.ts denormalizes titles FROM) — so the title
//     check runs for legacy-set course slots only; the 2025 set's snapshot is
//     always fetched live at seed time (no local snapshot exists to drift).
//   - Every pattern-kind slot's pattern matches ≥1 catalog course (counted).
//     ZERO → ERROR. Pattern regex mirrors satisfies.ts's patternToRegex
//     (canonical: cornell-degree-planner/src/lib/planner/satisfies.ts) — same
//     mirroring convention scripts/catalog-index.ts already uses for the same
//     function, documented there as intentional (scripts/ has no import path
//     into cornell-degree-planner/src; see that file's header).
//   - Every attribute-kind slot's attributeMatch parses (normalizeAttributeMatch
//     mirror) AND matches ≥1 catalog course (matchesAttribute mirror). Either
//     failure → ERROR. Canonical: satisfies.ts's AttributeMatch/matchesAttribute/
//     normalizeAttributeMatch (same section as patternToRegex above).
//   - Every elective group with a COMPUTABLE rule (open/level/outside — mirrors
//     majorMatch.ts's ruleIsComputable/poolQualifies, canonical:
//     cornell-degree-planner/src/lib/planner/majorMatch.ts) has enough
//     qualifying catalog courses to PLAUSIBLY satisfy min_credits: qualifying
//     count × 3 ≥ min_credits (3 = the modal Cornell course credit value, same
//     DEFAULT_SEAT_CREDITS majorMatch.ts falls back to). Implausible → ERROR.
//     list/category rules are NEVER computable client-side (no predicate to
//     evaluate against course properties) → flagged INFO, never an error, per
//     binding decision. EXTENSION beyond the literal binding-decision text
//     (flagged as a deviation in the session's final report): list-rule groups
//     DO carry a concrete courseIds array (unlike category), so this harness
//     additionally checks each listed courseId EXISTS in the catalog — ERROR
//     if not. That's the same FWS-class bug (an authored list group made of
//     typo'd/retired course ids would otherwise sail through as merely "not
//     computable yet" forever) and validate-programs-2025.ts already performs
//     this exact check for list-group courseIds today; dropping it here would
//     be a regression in a script meant to be BROADER, not narrower.
//   - Credit-total sanity: Σ seat credits (slot creditsMin ?? 3 default — the
//     raw authored JSON never carries a per-slot creditsMin today, so this is
//     effectively catalog course credits for course-kind seats and the 3cr
//     default for pattern/attribute seats, mirroring programToRequirements's
//     fallback chain exactly) + Σ pool minCredits, compared against the
//     program's totalCredits WHEN PRESENT (most authored majors carry null
//     today — see header of programs-2025/*.json — so this check is currently
//     a no-op in practice but is exercised by the corpus fixture). Drift > 25%
//     → WARNING, not ERROR: authored majors deliberately under-specify free/
//     advisor-approved electives (open-rule pools with minCredits far below
//     what a real "free elective" allocation would be), so under-counting
//     toward the published total is EXPECTED authoring behavior, not a data
//     bug — an ERROR here would punish honest incompleteness rather than catch
//     an unsatisfiable requirement, which is what this harness exists to catch.
//
//   Schema note (binding decision 2, final bullet): spec 011 §2's `creditMin`
//   requirement kind is already expressed structurally as an elective pool
//   (a group with a min_credits floor and a qualifying rule); `nOfM` is
//   already expressed as N duplicate seats (majorMatch.ts programToRequirements
//   never deduplicates identical seats — "two 4000-level CS electives" is two
//   distinct pattern/pool instances). No new authoring syntax is invented by
//   this harness or by spec 011 — the current data model already covers both.
//
// ── Exit behavior (binding decision 3) ──────────────────────────────────────
//   Any ERROR anywhere → process exits 1 (CI-gate ready). Warnings/info never
//   fail the run.
//
// ── Coverage report (binding decision 4) ───────────────────────────────────
//   Written to docs/reference/program-coverage.md: one section per major
//   (seat/pool counts, per-requirement candidate counts with the bottom-5
//   scarcest listed, errors/warnings/info, credit sanity), a generated-by line
//   naming the data source used (firestore roster vs. dump file path).
//   Deterministic ordering (programs sorted by id; every list iterates the
//   authored JSON's own array order, never an object-key/Map iteration that
//   could vary run to run).
//
// ── Structure (house style, mirrors scripts/prereq-grammar.ts) ─────────────
//   Pure validation functions (importable, corpus-tested with zero IO) + a
//   thin main() at the bottom that does argv parsing / file+network IO /
//   console+file output / process.exit. main() only runs when this file is
//   executed directly (`require.main === module`) — not when
//   scripts/validate-programs.corpus.ts imports the pure functions below.

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve } from "path";

// ─── Catalog course shape (dual-source-agnostic) ──────────────────────────
// Shaped like a Firestore courses/{id} doc (CourseSchema in
// cornell-degree-planner/src/lib/schemas.ts), trimmed to the fields this
// harness actually evaluates. Both data sources (live Firestore `.select()`
// and a --dump JSON array) produce this same shape.
export type CatalogCourse = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin?: number;
  creditsMax?: number;
  attrs?: { value: string; descr?: string; group?: string }[] | null;
};

export type CatalogMaps = {
  byId: Map<string, CatalogCourse>;
  all: CatalogCourse[];
};

export function buildCatalogMaps(courses: CatalogCourse[]): CatalogMaps {
  const byId = new Map<string, CatalogCourse>();
  for (const c of courses) byId.set(c.id, c);
  return { byId, all: courses };
}

// ─── Mirrored from cornell-degree-planner/src/lib/planner/satisfies.ts ────
// (scripts/ is a standalone package with no import path into
// cornell-degree-planner/src — same convention scripts/catalog-index.ts
// documents for this exact function. Keep both in sync if the wildcard
// grammar ever changes.)
export function patternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/-/g, " ");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/[*xX]/g, ".");
  return new RegExp(`^${withWildcards}$`, "i");
}

// Mirrored from satisfies.ts's AttributePredicate/AttributeMatch/
// matchesAttribute/normalizeAttributeMatch (canonical home for predicate
// semantics — add new fields/ops there first, then mirror here).
export type AttributePredicate =
  | { field: "title"; op: "startsWith"; value: string }
  | { field: "attrs.value"; op: "in"; value: string[] };
export type AttributeMatch = { anyOf: AttributePredicate[] };

function attributePredicateMatches(
  pred: AttributePredicate,
  input: { title?: string | null; attrValues?: string[] }
): boolean {
  switch (pred.field) {
    case "title":
      return input.title != null && input.title.startsWith(pred.value);
    case "attrs.value": {
      const have = input.attrValues;
      if (!have || have.length === 0) return false;
      return pred.value.some((v) => have.includes(v));
    }
  }
}

export function matchesAttribute(
  input: { title?: string | null; attrValues?: string[] },
  match: AttributeMatch
): boolean {
  return match.anyOf.some((p) => attributePredicateMatches(p, input));
}

export function normalizeAttributeMatch(raw: unknown): AttributeMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const anyOf = (raw as { anyOf?: unknown }).anyOf;
  if (!Array.isArray(anyOf) || anyOf.length === 0) return null;
  const preds: AttributePredicate[] = [];
  for (const p of anyOf) {
    if (!p || typeof p !== "object") continue;
    const { field, op, value } = p as { field?: unknown; op?: unknown; value?: unknown };
    if (field === "title" && op === "startsWith" && typeof value === "string") {
      preds.push({ field, op, value });
    } else if (
      field === "attrs.value" &&
      op === "in" &&
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    ) {
      preds.push({ field, op, value: value as string[] });
    }
  }
  return preds.length > 0 ? { anyOf: preds } : null;
}

// ─── Mirrored from cornell-degree-planner/src/types/db.ts (QualifyingRule) ─
export type QualifyingRule =
  | { type: "level"; subject: string; min_number: number }
  | { type: "category"; category: string }
  | { type: "outside"; exclude_subjects: string[] }
  | { type: "list" }
  | { type: "open" };

// Mirrored from majorMatch.ts's ruleIsComputable/poolQualifies. list/category
// need server-side data this client-side harness (and the app) doesn't have.
export function ruleIsComputable(rule: QualifyingRule): boolean {
  return rule.type === "open" || rule.type === "level" || rule.type === "outside";
}

export function poolQualifies(
  rule: QualifyingRule,
  course: { subject: string; number: string }
): boolean {
  switch (rule.type) {
    case "open":
      return true;
    case "level": {
      const num = parseInt(course.number, 10);
      return course.subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    }
    case "outside":
      return !rule.exclude_subjects.includes(course.subject);
    case "list":
    case "category":
      return false;
  }
}

const DEFAULT_SEAT_CREDITS = 3; // mirrors majorMatch.ts's DEFAULT_SEAT_CREDITS

// ─── Authored seed-data shapes (raw JSON, camelCase — same as seed-firestore.ts
// / seed-programs-2025.ts's local Raw* types; mirrored rather than imported so
// this script stays a standalone module like its siblings). ────────────────
export type RawSlot = {
  id: string;
  programId?: string;
  kind: "course" | "pattern" | "elective" | "attribute";
  courseId?: string | null;
  pattern?: string | null;
  patternTitle?: string | null;
  attributeMatch?: unknown;
  electiveGroupId?: string | null;
  suggestedSemester?: number;
  slotRow?: number;
};
export type RawGroup = {
  id: string;
  programId?: string | null;
  name: string;
  description?: string | null;
  qualifyingRule: unknown;
  minCredits: number;
  advisorApproval?: boolean;
  notes?: string | null;
  courseIds?: string[];
};
export type RawProgram = {
  id: string;
  name: string;
  shortName?: string;
  college?: string;
  catalogYear?: number;
  totalCredits?: number | null;
  affiliationText?: string | null;
  electiveGroups: RawGroup[];
  slots: RawSlot[];
  edges?: unknown[];
};

export type NormalizedProgram = {
  id: string;
  name: string;
  source: "legacy" | "2025";
  totalCredits: number | null;
  slots: RawSlot[];
  electiveGroups: RawGroup[];
};

// ─── Loaders — read the SAME files the seeders read ───────────────────────
export function loadLegacyPrograms(dataDir: string): NormalizedProgram[] {
  const raw = JSON.parse(readFileSync(resolve(dataDir, "programs.json"), "utf-8")) as RawProgram[];
  return raw.map((p) => ({
    id: p.id,
    name: p.name,
    source: "legacy" as const,
    totalCredits: p.totalCredits ?? null,
    slots: p.slots,
    electiveGroups: p.electiveGroups,
  }));
}

// The legacy set's local course snapshot (scripts/seed-data/courses.json) is
// the ONLY pre-seed "authored title" that exists anywhere (see file header) —
// seed-firestore.ts denormalizes course-kind slots' courseTitle FROM this file.
export function loadLegacyAuthoredTitles(dataDir: string): Map<string, string> {
  const courses = JSON.parse(
    readFileSync(resolve(dataDir, "courses.json"), "utf-8")
  ) as { id: string; title: string }[];
  return new Map(courses.map((c) => [c.id, c.title]));
}

export function loadPrograms2025(dataDir: string): NormalizedProgram[] {
  const dir = resolve(dataDir, "programs-2025");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const p = JSON.parse(readFileSync(resolve(dir, f), "utf-8")) as RawProgram;
    return {
      id: p.id,
      name: p.name,
      source: "2025" as const,
      totalCredits: p.totalCredits ?? null,
      slots: p.slots,
      electiveGroups: p.electiveGroups,
    };
  });
}

// ─── Catalog counting helpers ──────────────────────────────────────────────
export function countPatternMatches(pattern: string, catalog: CatalogMaps): number {
  const re = patternToRegex(pattern);
  let n = 0;
  for (const c of catalog.all) if (re.test(`${c.subject} ${c.number}`)) n++;
  return n;
}

export function countAttributeMatches(match: AttributeMatch, catalog: CatalogMaps): number {
  let n = 0;
  for (const c of catalog.all) {
    if (matchesAttribute({ title: c.title, attrValues: (c.attrs ?? []).map((a) => a.value) }, match)) n++;
  }
  return n;
}

export function countPoolQualifying(rule: QualifyingRule, catalog: CatalogMaps): number {
  let n = 0;
  for (const c of catalog.all) if (poolQualifies(rule, c)) n++;
  return n;
}

// ─── Per-major report ──────────────────────────────────────────────────────
export type RequirementCount = {
  id: string;
  label: string;
  kind: string; // "course" | "pattern" | "attribute" | "pool:open" | "pool:level" | "pool:outside" | "pool:list" | "pool:category"
  count: number | null; // null = genuinely no computable signal (category rule)
};

export type ProgramReport = {
  id: string;
  name: string;
  source: "legacy" | "2025";
  seatCount: number;
  poolCount: number;
  errors: string[];
  warnings: string[];
  infos: string[];
  requirementCounts: RequirementCount[];
  creditSeatSum: number;
  creditPoolSum: number;
  creditTotal: number;
  totalCreditsPublished: number | null;
  creditDriftPct: number | null;
};

export function validateProgram(
  program: NormalizedProgram,
  catalog: CatalogMaps,
  authoredTitles?: Map<string, string>
): ProgramReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const requirementCounts: RequirementCount[] = [];

  const groupIds = new Set(program.electiveGroups.map((g) => g.id));
  let seatCount = 0;
  let creditSeatSum = 0;

  for (const slot of program.slots) {
    if (slot.kind === "course") {
      seatCount++;
      const courseId = slot.courseId;
      if (!courseId) {
        errors.push(`slot ${slot.id}: kind=course but no courseId`);
        requirementCounts.push({ id: slot.id, label: slot.id, kind: "course", count: 0 });
        creditSeatSum += DEFAULT_SEAT_CREDITS;
        continue;
      }
      const course = catalog.byId.get(courseId);
      if (!course) {
        errors.push(`slot ${slot.id}: courseId ${courseId} MISSING from catalog`);
        requirementCounts.push({ id: slot.id, label: courseId, kind: "course", count: 0 });
        creditSeatSum += DEFAULT_SEAT_CREDITS;
        continue;
      }
      requirementCounts.push({ id: slot.id, label: courseId, kind: "course", count: 1 });
      creditSeatSum += course.creditsMin ?? DEFAULT_SEAT_CREDITS;
      const authoredTitle = authoredTitles?.get(courseId);
      if (authoredTitle != null && authoredTitle !== course.title) {
        warnings.push(
          `slot ${slot.id}: authored snapshot title "${authoredTitle}" for ${courseId} differs from catalog title "${course.title}"`
        );
      }
    } else if (slot.kind === "pattern") {
      seatCount++;
      creditSeatSum += DEFAULT_SEAT_CREDITS;
      if (!slot.pattern) {
        errors.push(`slot ${slot.id}: kind=pattern but no pattern string`);
        requirementCounts.push({ id: slot.id, label: slot.patternTitle ?? slot.id, kind: "pattern", count: 0 });
        continue;
      }
      const count = countPatternMatches(slot.pattern, catalog);
      requirementCounts.push({
        id: slot.id,
        label: slot.patternTitle ?? slot.pattern,
        kind: "pattern",
        count,
      });
      if (count === 0) {
        errors.push(`slot ${slot.id}: pattern "${slot.pattern}" matches ZERO catalog courses`);
      }
    } else if (slot.kind === "attribute") {
      seatCount++;
      creditSeatSum += DEFAULT_SEAT_CREDITS;
      const match = normalizeAttributeMatch(slot.attributeMatch);
      if (!match) {
        errors.push(`slot ${slot.id}: kind=attribute but attributeMatch is missing/malformed`);
        requirementCounts.push({
          id: slot.id,
          label: slot.patternTitle ?? slot.id,
          kind: "attribute",
          count: 0,
        });
        continue;
      }
      const count = countAttributeMatches(match, catalog);
      requirementCounts.push({
        id: slot.id,
        label: slot.patternTitle ?? "attribute requirement",
        kind: "attribute",
        count,
      });
      if (count === 0) {
        errors.push(`slot ${slot.id}: attributeMatch matches ZERO catalog courses`);
      }
    } else if (slot.kind === "elective") {
      // No seat/credit contribution here — mirrors majorMatch.ts's
      // programToRequirements, where elective-kind slots are represented by
      // their GROUP's pool, never their own seat.
      if (!slot.electiveGroupId) {
        errors.push(`slot ${slot.id}: kind=elective but no electiveGroupId`);
      } else if (!groupIds.has(slot.electiveGroupId)) {
        errors.push(`slot ${slot.id}: unknown electiveGroupId ${slot.electiveGroupId}`);
      }
    }
  }

  let creditPoolSum = 0;
  for (const group of program.electiveGroups) {
    creditPoolSum += group.minCredits;
    const rule = group.qualifyingRule as QualifyingRule;

    if (ruleIsComputable(rule)) {
      const qualifying = countPoolQualifying(rule, catalog);
      requirementCounts.push({ id: group.id, label: group.name, kind: `pool:${rule.type}`, count: qualifying });
      const plausible = qualifying * 3 >= group.minCredits;
      if (!plausible) {
        errors.push(
          `group ${group.id} ("${group.name}"): only ${qualifying} qualifying catalog course(s) found — ` +
            `implausible for ${group.minCredits} credits (need ≥${Math.ceil(
              group.minCredits / 3
            )} qualifying courses at 3cr each)`
        );
      }
    } else if (rule.type === "list") {
      const ids = group.courseIds ?? [];
      let existing = 0;
      for (const cid of ids) {
        if (catalog.byId.has(cid)) existing++;
        else errors.push(`group ${group.id} ("${group.name}"): listed course ${cid} MISSING from catalog`);
      }
      requirementCounts.push({ id: group.id, label: group.name, kind: "pool:list", count: existing });
      infos.push(
        `group ${group.id} ("${group.name}"): list rule — credit-plausibility not computable client-side yet ` +
          `(${existing}/${ids.length} listed courses found in catalog)`
      );
    } else {
      // category
      requirementCounts.push({ id: group.id, label: group.name, kind: "pool:category", count: null });
      infos.push(`group ${group.id} ("${group.name}"): category rule — not computable client-side yet`);
    }
  }

  const creditTotal = creditSeatSum + creditPoolSum;
  const totalCreditsPublished = program.totalCredits;
  let creditDriftPct: number | null = null;
  if (totalCreditsPublished != null && totalCreditsPublished > 0) {
    const drift = Math.abs(creditTotal - totalCreditsPublished) / totalCreditsPublished;
    creditDriftPct = Math.round(drift * 1000) / 10; // percent, 1 decimal
    if (drift > 0.25) {
      warnings.push(
        `credit total ${creditTotal} drifts ${creditDriftPct}% from published totalCredits ${totalCreditsPublished} ` +
          `(authored majors intentionally under-specify free/advisor electives — WARNING, not an error)`
      );
    }
  }

  return {
    id: program.id,
    name: program.name,
    source: program.source,
    seatCount,
    poolCount: program.electiveGroups.length,
    errors,
    warnings,
    infos,
    requirementCounts,
    creditSeatSum,
    creditPoolSum,
    creditTotal,
    totalCreditsPublished,
    creditDriftPct,
  };
}

// ─── Coverage report rendering (pure — corpus-testable) ───────────────────
export type CoverageMeta = {
  generatedAt: string; // ISO timestamp
  dataSource: string; // "firestore roster (...)" | "dump file: <path>"
};

export function renderCoverageReport(reports: ProgramReport[], meta: CoverageMeta): string {
  const sorted = [...reports].sort((a, b) => a.id.localeCompare(b.id));
  const totalErrors = sorted.reduce((n, r) => n + r.errors.length, 0);
  const totalWarnings = sorted.reduce((n, r) => n + r.warnings.length, 0);
  const cleanCount = sorted.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length;

  const lines: string[] = [];
  lines.push("# Program Coverage Report");
  lines.push("");
  lines.push("> Generated by `scripts/validate-programs.ts` (spec 011 §2a — the authoring");
  lines.push("> pipeline's validation harness). Do not hand-edit; rerun the harness to");
  lines.push("> regenerate. An ERROR means some requirement in an authored major has zero");
  lines.push("> (or implausibly few) qualifying catalog courses — the FWS class of bug —");
  lines.push("> and the harness exits nonzero (CI-gate ready). Warnings/info never fail.");
  lines.push("");
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Data source: ${meta.dataSource}`);
  lines.push(
    `Programs validated: ${sorted.length} (${totalErrors} error(s), ${totalWarnings} warning(s), ${cleanCount} fully clean)`
  );
  lines.push("");
  lines.push("---");

  for (const r of sorted) {
    lines.push("");
    lines.push(`## ${r.id} — ${r.name} (${r.source})`);
    lines.push("");
    lines.push(`- Seats: ${r.seatCount} · Pools: ${r.poolCount}`);
    const driftText =
      r.totalCreditsPublished != null
        ? ` (published ${r.totalCreditsPublished}, drift ${r.creditDriftPct}%)`
        : " (no published totalCredits on file)";
    lines.push(`- Credits: seat Σ ${r.creditSeatSum} + pool Σ ${r.creditPoolSum} = ${r.creditTotal}${driftText}`);
    lines.push(`- Errors: ${r.errors.length} · Warnings: ${r.warnings.length} · Info: ${r.infos.length}`);

    if (r.errors.length) {
      lines.push("");
      lines.push("  Errors:");
      for (const e of r.errors) lines.push(`  - ${e}`);
    }
    if (r.warnings.length) {
      lines.push("");
      lines.push("  Warnings:");
      for (const w of r.warnings) lines.push(`  - ${w}`);
    }
    if (r.infos.length) {
      lines.push("");
      lines.push("  Info:");
      for (const i of r.infos) lines.push(`  - ${i}`);
    }

    const scarcest = r.requirementCounts
      .filter((c): c is RequirementCount & { count: number } => c.count != null)
      .sort((a, b) => a.count - b.count)
      .slice(0, 5);
    if (scarcest.length) {
      lines.push("");
      lines.push("  Bottom-5 scarcest requirements:");
      scarcest.forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.id} — ${c.label} (${c.kind}) — ${c.count} candidate(s)`);
      });
    }
    lines.push("");
    lines.push("---");
  }

  return lines.join("\n") + "\n";
}

// ─── Catalog loaders (IO — not corpus-tested against real IO, but loadCatalogDump
// is exercised via a fixture file so the --dump path itself is proven). ────
export function loadCatalogDump(path: string): CatalogCourse[] {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`--dump file must contain a JSON array of course docs; got ${typeof raw}`);
  }
  return raw as CatalogCourse[];
}

export async function loadCatalogFromFirestore(): Promise<CatalogCourse[]> {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: "degree-planner-app" });
  const db = getFirestore();
  const snap = await db
    .collection("courses")
    .select("subject", "number", "title", "creditsMin", "creditsMax", "attrs")
    .get();
  const out: CatalogCourse[] = [];
  snap.forEach((d) => {
    const x = d.data();
    out.push({
      id: d.id,
      subject: x.subject,
      number: x.number,
      title: x.title,
      creditsMin: x.creditsMin,
      creditsMax: x.creditsMax,
      attrs: Array.isArray(x.attrs) ? x.attrs : null,
    });
  });
  return out;
}

export const DATA_DIR = resolve(__dirname, "seed-data");
export const COVERAGE_REPORT_PATH = resolve(__dirname, "..", "docs", "reference", "program-coverage.md");

// ─── main() ─────────────────────────────────────────────────────────────────
async function main() {
  const dumpIdx = process.argv.indexOf("--dump");
  const dumpPath = dumpIdx !== -1 ? process.argv[dumpIdx + 1] : null;

  let catalogCourses: CatalogCourse[];
  let dataSource: string;
  if (dumpPath) {
    catalogCourses = loadCatalogDump(resolve(dumpPath));
    dataSource = `dump file: ${dumpPath}`;
  } else {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error(
        "\nABORTED: GOOGLE_APPLICATION_CREDENTIALS is unset and no --dump <path> was given.\n" +
          "Set the credential env var to validate against live Firestore, or pass\n" +
          "--dump <path> for offline/CI mode (see file header)."
      );
      process.exit(1);
    }
    catalogCourses = await loadCatalogFromFirestore();
    dataSource = "firestore roster (degree-planner-app, live courses/*)";
  }

  const catalog = buildCatalogMaps(catalogCourses);
  const legacyPrograms = loadLegacyPrograms(DATA_DIR);
  const authoredTitles = loadLegacyAuthoredTitles(DATA_DIR);
  const programs2025 = loadPrograms2025(DATA_DIR);
  const allPrograms = [...legacyPrograms, ...programs2025];

  const reports = allPrograms.map((p) =>
    validateProgram(p, catalog, p.source === "legacy" ? authoredTitles : undefined)
  );

  let anyError = false;
  for (const r of reports) {
    console.log(`\n${r.id} [${r.source}]  seats ${r.seatCount}  pools ${r.poolCount}  credits ${r.creditTotal}`);
    if (r.errors.length) {
      anyError = true;
      console.log(`  ERRORS (${r.errors.length}):`);
      for (const e of r.errors) console.log(`    x ${e}`);
    }
    if (r.warnings.length) {
      console.log(`  WARNINGS (${r.warnings.length}):`);
      for (const w of r.warnings) console.log(`    ! ${w}`);
    }
    if (r.infos.length) {
      console.log(`  INFO (${r.infos.length}):`);
      for (const i of r.infos) console.log(`    i ${i}`);
    }
    if (!r.errors.length && !r.warnings.length) console.log("  OK");
  }

  const markdown = renderCoverageReport(reports, {
    generatedAt: new Date().toISOString(),
    dataSource,
  });
  writeFileSync(COVERAGE_REPORT_PATH, markdown);
  console.log(`\nCoverage report written: ${COVERAGE_REPORT_PATH}`);

  console.log(
    anyError
      ? "\nVALIDATION FAILED — fix ERRORS above."
      : "\nVALIDATION PASSED (no unsatisfiable requirements found)."
  );
  process.exit(anyError ? 1 : 0);
}

// Only run the CLI when this file is executed directly — importing the pure
// functions above (scripts/validate-programs.corpus.ts) must never trigger a
// live/dump run, a docs/ write, or a process.exit.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
