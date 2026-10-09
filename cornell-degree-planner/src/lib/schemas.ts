import { z } from "zod";

/**
 * Zod schemas for the Firestore document model (docs/specs/002 §3, §5).
 *
 * These describe the CAMEL-CASE Firestore doc shapes (creditsMin, prereqExpr, …),
 * NOT the app's snake_case @/types/db shapes — normalizers (src/lib/normalize/)
 * bridge the two at the read boundary. Every entity schema ends `.passthrough()`
 * so a forward-compatible extra field on a doc never fails a read (house-standard
 * field-shape-mismatch lesson). Hard caps (.max) exist so a corrupt/oversized doc
 * is rejected as UX defense; the AUTHORITATIVE cap is firestore.rules — the two
 * must stay numerically identical.
 */

// ─── Prereq / coreq expression tree ──────────────────────────────────────────
// Ports as-is from JSONB (docs/specs/002 §3). Recursive; typed loosely because
// evaluatePrereq.ts owns the real interpretation.
export const PrereqExprSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      id: z.string().optional(),
      pattern: z.string().optional(),
      children: z.array(PrereqExprSchema).optional(),
      // "advisory" node (spec 007 §3 decision 1): wraps `expr`, never blocks.
      expr: PrereqExprSchema.optional(),
      note: z.string().optional(),
    })
    .passthrough()
);

// ─── Qualifying rule (elective groups) ───────────────────────────────────────
export const QualifyingRuleSchema = z
  .object({ type: z.string() })
  .passthrough();

// ─── Course attribute (crseAttrs — spec 010 §1/§3, Unit 10A) ─────────────────
// Distribution/requirement tags, e.g. { value: "WRT-AG", descr: "AG-Written
// Expression", group: "Distribution Requirements" }. ENGL alone exposes 22
// distinct values (debug doc Part 1.5).
export const CourseAttrSchema = z
  .object({
    value: z.string().max(16),
    descr: z.string().max(120),
    group: z.string().max(80),
  })
  .passthrough();
export type CourseAttr = z.infer<typeof CourseAttrSchema>;

// ─── Course section (enrollGroups[].classSections[] — spec 010 §1/§3) ───────
// One entry per classSection across ALL enrollGroups for the active roster
// snapshot only (future terms simply have none). Pure data plumbing — no slot/
// requirement matching lives here (that's spec 010's Unit 10B / spec 011).
export const CourseSectionSchema = z
  .object({
    code: z.string().max(16), // `${ssrComponent} ${section}`, e.g. "LEC 001"
    component: z.string().max(8),
    openStatus: z.string().max(4).nullable().optional(),
    gradingBasis: z.string().max(16).nullable().optional(),
    components: z.array(z.string().max(8)).max(6).default([]),
    instructors: z
      .array(
        z
          .object({
            netid: z.string().max(16),
            firstName: z.string().max(60),
            lastName: z.string().max(60),
          })
          .passthrough()
      )
      .max(10)
      .default([]),
    meetings: z
      .array(
        z
          .object({
            pattern: z.string().max(8),
            timeStart: z.string().max(12),
            timeEnd: z.string().max(12),
          })
          .passthrough()
      )
      .max(10)
      .default([]),
  })
  .passthrough();
export type CourseSectionDoc = z.infer<typeof CourseSectionSchema>;

// ─── Course (courses/{courseId}) ─────────────────────────────────────────────
export const CourseSchema = z
  .object({
    id: z.string().max(40),
    subject: z.string().max(16),
    number: z.string().max(16),
    title: z.string().max(200),
    // NUMERIC(4,1) lesson: plain JS numbers, 0 ≤ credits ≤ 20 (spec 002 §8g).
    creditsMin: z.number().min(0).max(20),
    creditsMax: z.number().min(0).max(20),
    description: z.string().max(4000).nullable().optional(),
    offered: z.array(z.string().max(8)).max(8).default([]),
    prereqExpr: PrereqExprSchema.nullable().optional(),
    coreqExpr: PrereqExprSchema.nullable().optional(),
    // Spec 007 §3 decision 4/3(c) — provenance of prereqExpr/coreqExpr:
    // "authored" (hand-seeded, never touched by the parser) vs. "parsed-v1"/
    // "parsed-v2" (written by scripts/parse-prereqs.ts). Absent on older docs.
    prereqSource: z.string().max(24).nullable().optional(),
    coreqSource: z.string().max(24).nullable().optional(),
    // Human-readable prose captured from AND-noise / whole-clause-noise during
    // parsing (grade minimums, permission-of-instructor asides, the MATH 1910
    // "high school math" branch) — may accompany a null prereqExpr.
    prereqNotes: z.array(z.string().max(300)).max(20).nullable().optional(),
    // Credit-exclusion course ids, self-stripped, parsed from Cornell's
    // catalogForbiddenOverlaps prose (spec 007 §5 / Unit 7D, debug doc #11).
    // Pure data plumbing — no derived warning state or UI here (later units).
    forbiddenOverlaps: z.array(z.string().max(40)).max(30).nullable().optional(),
    // Spec 010 §1/§3 (Unit 10A) — crseAttrs + enrollGroups ingest. Pure data
    // plumbing only (no requirement matching here — that's Unit 10B/spec 011).
    attrs: z.array(CourseAttrSchema).max(40).nullable().optional(),
    sections: z.array(CourseSectionSchema).max(60).nullable().optional(),
    components: z.array(z.string().max(8)).max(6).nullable().optional(),
    // ⚠️ NAMING TRAP (spec-002-era accident, root-caused 2026-07-11): rosterId
    // is Cornell's NUMERIC crseId ("358546"), NOT the roster slug — never
    // compare it to a slug like "FA26".
    rosterId: z.string().max(64).nullable().optional(),
    // The roster SLUG the last sync ran against ("FA26") — what the time-horizon
    // gates compare to catalog/meta.enrollmentTarget (spec 012 near-face fix).
    // Absent on docs written before the fixed sync → null → gates stay silent
    // (no near face, no "not offered" claim — never claim from missing data).
    roster: z.string().max(8).nullable().optional(),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();
export type CourseDoc = z.infer<typeof CourseSchema>;

// ─── Elective group (embedded in programs + catalog/meta) ────────────────────
export const ElectiveGroupSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().max(120),
    description: z.string().max(500).nullable().optional(),
    qualifyingRule: QualifyingRuleSchema,
    minCredits: z.number().min(0).max(20),
    advisorApproval: z.boolean().default(false),
    notes: z.string().max(500).nullable().optional(),
    courseIds: z.array(z.string().max(40)).max(200).default([]),
  })
  .passthrough();
export type ElectiveGroupDoc = z.infer<typeof ElectiveGroupSchema>;

// ─── Program slot (embedded array in programs/{programId}) ───────────────────
export const SlotSchema = z
  .object({
    id: z.string().max(80),
    // Spec 010 §2 (Unit 10B) — `attribute` slots match on course PROPERTIES
    // (title/attrs) rather than a code; see attributeMatch below.
    kind: z.enum(["course", "pattern", "elective", "attribute"]),
    courseId: z.string().max(40).nullable().optional(),
    pattern: z.string().max(40).nullable().optional(),
    // Display label for pattern AND attribute slots. Attribute slots REUSE this
    // field (spec 010 §2 decision) — an attribute requirement has no code, so it
    // renders its patternTitle exactly the way a pattern slot does ("First-Year
    // Writing Seminar"). No separate label field is minted.
    patternTitle: z.string().max(200).nullable().optional(),
    // Spec 010 §2 (Unit 10B) — the attribute requirement's match spec, loose by
    // design (satisfies.ts owns the real predicate shape; normalizeAttributeMatch
    // gates a malformed value to null → an unmatchable requirement, never a
    // crashed read). anyOf is capped so a corrupt doc can't balloon the read.
    attributeMatch: z
      .object({
        anyOf: z
          .array(
            z
              .object({ field: z.string(), op: z.string(), value: z.unknown() })
              .passthrough()
          )
          .max(8),
      })
      .passthrough()
      .nullable()
      .optional(),
    electiveGroupId: z.string().max(64).nullable().optional(),
    suggestedSemester: z.number().int().min(1).max(12),
    slotRow: z.number().int().min(0).max(20),
    // Denormalized display snapshot (course-kind slots).
    courseTitle: z.string().max(200).nullable().optional(),
    creditsMin: z.number().min(0).max(20).nullable().optional(),
    creditsMax: z.number().min(0).max(20).nullable().optional(),
    // Slot category (spec 006 §D1) — a small shared taxonomy for the card
    // accent (math | science | core | liberal | elective | fws | pe).
    // Optional + additive: old program docs pass through, missing → no accent.
    // Loose z.string() here (not z.enum) so a forward-compatible category value
    // never fails a read; normalizeCategory() gates it to the app enum.
    category: z.string().max(24).nullable().optional(),
  })
  .passthrough();
export type SlotDoc = z.infer<typeof SlotSchema>;

// ─── Slot edge (embedded array in programs/{programId}) ──────────────────────
// WRITE-DEAD (spec 008 §2b): authored edges are retired — the app derives edges
// from placed courses' prereq/coreq trees and seeds no longer WRITE edges. This
// schema STAYS because existing program docs still carry an `edges` array, and
// ProgramSchema below must keep validating them on read (it just isn't consumed).
export const EdgeSchema = z
  .object({
    from: z.string().max(80),
    to: z.string().max(80),
    type: z.enum(["prereq", "coreq", "concurrent"]),
  })
  .passthrough();
export type EdgeDoc = z.infer<typeof EdgeSchema>;

// ─── Program (programs/{programId}) — ONE read loads a program ────────────────
export const ProgramSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().max(200),
    shortName: z.string().max(32),
    college: z.string().max(120),
    catalogYear: z.number().int().min(2000).max(2100),
    totalCredits: z.number().min(0).max(400).nullable().optional(),
    affiliationText: z.string().max(4000).nullable().optional(),
    electiveGroups: z.array(ElectiveGroupSchema).max(60).default([]),
    slots: z.array(SlotSchema).max(200),
    edges: z.array(EdgeSchema).max(400).default([]),
  })
  .passthrough();
export type ProgramDoc = z.infer<typeof ProgramSchema>;

// ─── catalog/meta singleton ──────────────────────────────────────────────────
export const CatalogMetaSchema = z
  .object({
    aliases: z.record(z.string().max(40), z.string().max(40)),
    globalElectiveGroups: z.array(ElectiveGroupSchema).max(60).default([]),
    seedVersion: z.number().int().optional(),
    syncedAt: z.unknown().optional(),
    // Enrollment target (spec 012 §1) — the roster slug ("FA26") students are
    // currently enrolling for, driving the near/far horizon. App-level config,
    // set by us each cycle via scripts/set-enrollment-target.ts. Absent on docs
    // written before this spec → null (everything reads "far", no false near
    // face). `.passthrough()` already tolerates its absence; this makes it typed.
    enrollmentTarget: z.string().max(8).nullable().optional(),
  })
  .passthrough();
export type CatalogMetaDoc = z.infer<typeof CatalogMetaSchema>;

// ─── catalogIndex/{chunk} — compact search records ───────────────────────────
export const CatalogIndexRecordSchema = z
  .object({
    id: z.string().max(40),
    subject: z.string().max(16),
    number: z.string().max(16),
    title: z.string().max(200),
    creditsMin: z.number().min(0).max(20),
    creditsMax: z.number().min(0).max(20),
    hasPrereqs: z.boolean(),
    // Offered terms (spec 006 §E3) — added to the index so the /classes + drawer
    // "offered" filter works without fetching full course docs. Additive: chunks
    // written before the roster-sync rebuild lack it and default to []. Populated
    // by scripts/catalog-index.ts buildIndexRecords from each course's `offered`.
    offered: z.array(z.string().max(8)).max(8).default([]),
    // Spec 010 §3 (Unit 10A) — lightweight derived flags so attribute matching
    // is an index filter, not a per-doc read. `attrs` is just the crseAttrs
    // values (max 40); `fws` is the durable title-prefix signal (debug doc
    // Part 1.5). Additive: chunks written before the rebuild lack these and
    // default to []/false.
    attrs: z.array(z.string().max(16)).max(40).default([]),
    fws: z.boolean().default(false),
    // Spec 008 §3a (Unit 8A) — the forward "unlocks" reverse-adjacency, computed
    // at sync time (scripts/catalog-index.ts buildIndexRecords) since the client
    // must never scan all course docs to derive it (read-budget law). Additive:
    // chunks written before this rebuild lack it and default to [].
    unlocks: z.array(z.string().max(40)).max(200).default([]),
  })
  .passthrough();
export type CatalogIndexRecord = z.infer<typeof CatalogIndexRecordSchema>;

export const CatalogIndexChunkSchema = z
  .object({
    records: z.array(CatalogIndexRecordSchema).max(400),
  })
  .passthrough();
export type CatalogIndexChunkDoc = z.infer<typeof CatalogIndexChunkSchema>;

// ─── professorReviews/{netid} (spec 013 §3a/§3b, Unit 13B) ───────────────────
// Per-professor RMP rollup, keyed by roster netid. Public-read, ADMIN-WRITE
// ONLY (same rules style as the catalog — the pipeline writes it, clients never
// do). GUARDRAIL (spec §3e): ratings/difficulty/link/capped snippet only — NEVER
// full review text. topSnippet is a ≤160-char field so the cap is the boundary,
// not a promise. Caps below mirror the professorReviews rule in firestore.rules
// — keep numerically identical. `.passthrough()` per the field-shape lesson.
export const ProfessorPerCourseSchema = z
  .object({
    courseId: z.string().max(40),
    rating: z.number().min(0).max(5).nullable(),
    difficulty: z.number().min(0).max(5).nullable(),
    count: z.number().int().min(0).max(100000),
  })
  .passthrough();
export const ProfessorReviewsSchema = z
  .object({
    netid: z.string().max(16),
    displayName: z.string().max(120).nullable().optional(),
    // Match tier + candidate (spec §3c). tier "verified" = unique exact match;
    // "probable" = fuzzy best candidate, rendered with the double-check hedge.
    match: z
      .object({
        tier: z.enum(["verified", "probable"]),
        candidateName: z.string().max(120).nullable().optional(),
        url: z.string().max(300),
      })
      .passthrough(),
    rating: z.number().min(0).max(5).nullable(),
    difficulty: z.number().min(0).max(5).nullable(),
    count: z.number().int().min(0).max(100000).nullable(),
    // ≤160 chars (spec §3e guardrail 1/2) — a search-engine-snippet-sized cap,
    // enforced here AND at the write gate; its own field so it drops alone.
    topSnippet: z.string().max(160).nullable().optional(),
    // Professor×course buckets (spec §3d) — min-N applied in the pipeline; ≤40.
    perCourse: z.array(ProfessorPerCourseSchema).max(40).default([]),
    fetchedAt: z.unknown().optional(),
    source: z.string().max(16).optional(),
  })
  .passthrough();
export type ProfessorReviewsDoc = z.infer<typeof ProfessorReviewsSchema>;

// ─── courseInstructorHistory/{courseId} (spec 013 §3d, Unit 13B) ─────────────
// Per-course instructor timeline from archived rosters. Public-read, ADMIN-
// WRITE ONLY. Caps mirror the courseInstructorHistory rule in firestore.rules
// — keep numerically identical.
export const CourseHistoryTermSchema = z
  .object({
    roster: z.string().max(8), // "FA25"
    instructors: z
      .array(
        z
          .object({ netid: z.string().max(16), name: z.string().max(120) })
          .passthrough()
      )
      .max(20)
      .default([]),
  })
  .passthrough();
export const CourseInstructorHistorySchema = z
  .object({
    courseId: z.string().max(40),
    terms: z.array(CourseHistoryTermSchema).max(24).default([]),
    fetchedAt: z.unknown().optional(),
  })
  .passthrough();
export type CourseInstructorHistoryDoc = z.infer<typeof CourseInstructorHistorySchema>;

/**
 * ─── Plan / Share schemas ─── (spec 014 §D5 — the course-PLACEMENT model)
 * Caps below mirror the users/{uid}/plans/{planId} and /shares rules in
 * firestore.rules — keep numerically identical. The retired slot-model
 * fields are GONE from the app's schema (services/plans.ts
 * RETIRED_PLAN_FIELDS names them only to delete them on write); a plan doc
 * with an older schemaVersion is read as EMPTY (normalizePlan) and never
 * parsed against PlanSchema (services/plans.ts short-circuits it).
 */

/** The plan-doc schemaVersion of the placement model. Older docs (v1/v2 slot
 *  model) load as an empty plan → the program's starting board (spec 014 §D5). */
export const PLAN_SCHEMA_VERSION = 3;

/** One course on the board (src/types/plan.ts Placement). */
export const PlacementSchema = z
  .object({
    id: z.string().min(1).max(64),
    courseId: z.string().min(1).max(40),
    sem: z.number().int().min(1).max(10),
    // Dense 0..n-1 per column; a column holds at most the plan cap.
    order: z.number().int().min(0).max(79),
  })
  .passthrough();

/** Record-size cap helper — z.record has no .max(); rules cap map.size(). */
function maxKeys(n: number) {
  return (o: Record<string, unknown>) => Object.keys(o).length <= n;
}

export const PlanSchema = z
  .object({
    name: z.string().max(80), // rules: name.size() <= 80 — keep in sync with firestore.rules
    programId: z.string().max(64),
    // rules: placements.size() <= 80 — keep in sync with firestore.rules
    placements: z.array(PlacementSchema).max(80).default([]),
    // courseId → display snapshot (camelCase) of every placed course.
    // rules: courseSnapshots.size() <= 80 — keep in sync with firestore.rules
    courseSnapshots: z
      .record(z.string().max(40), z.unknown())
      .refine(maxKeys(80), { message: "courseSnapshots: at most 80 courses" })
      .default({}),
    // Placement ids. rules: completedIds.size() <= 80 — keep in sync with firestore.rules
    completedIds: z.array(z.string().max(64)).max(80).default([]),
    // Placement ids. rules: inProgressIds.size() <= 80 — keep in sync with firestore.rules
    inProgressIds: z.array(z.string().max(64)).max(80).default([]),
    // REQUIREMENT ids (template slot ids from the program doc), not placements.
    // rules: waivedRequirementIds.size() <= 80 — keep in sync with firestore.rules
    waivedRequirementIds: z.array(z.string().max(80)).max(80).default([]),
    schemaVersion: z.number().int(),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();
export type PlanDoc = z.infer<typeof PlanSchema>;

/** Frozen plan snapshot for read-only share links (spec 005 §5), written in
 *  the placement shape (spec 014). Caps mirror the /shares rule in
 *  firestore.rules — keep numerically identical. The placement fields DEFAULT
 *  on read so a share written before spec 014 (slot shape) still parses — its
 *  old fields pass through untouched for ShareView's old-shape reader. */
export const ShareSchema = z
  .object({
    createdBy: z.string().max(128),
    createdAt: z.unknown().optional(),
    planName: z.string().max(80),
    programId: z.string().max(64),
    programName: z.string().max(120),
    enteringYear: z.number().int().min(2015).max(2035).nullable(),
    // rules: placements.size() <= 80 — keep in sync with firestore.rules
    placements: z.array(PlacementSchema).max(80).default([]),
    // rules: courseSnapshots.size() <= 80 (new shape) — keep in sync with
    // firestore.rules. Not capped HERE on read: pre-014 shares carry up to 150.
    courseSnapshots: z.record(z.string().max(40), z.unknown()).default({}),
    // rules: completedIds.size() <= 80 — keep in sync with firestore.rules
    completedIds: z.array(z.string().max(64)).max(80).default([]),
    // rules: inProgressIds.size() <= 80 — keep in sync with firestore.rules
    inProgressIds: z.array(z.string().max(64)).max(80).default([]),
    // rules: waivedRequirementIds.size() <= 80 — keep in sync with firestore.rules
    waivedRequirementIds: z.array(z.string().max(80)).max(80).default([]),
    schemaVersion: z.number().int(),
  })
  .passthrough();
export type ShareDoc = z.infer<typeof ShareSchema>;

/** Write-side share validation: the read schema plus the new-shape snapshot
 *  cap (rules: courseSnapshots.size() <= 80 — keep in sync with firestore.rules). */
export const ShareCreateSchema = ShareSchema.refine(
  (s) => Object.keys(s.courseSnapshots).length <= 80,
  { message: "courseSnapshots: at most 80 courses" }
);

// ─── Credit profile (spec 007 §2) — AP/IB/transfer/placement as synthetic
// completed courses. Lives on the profile (not the plan): credit follows the
// student across plans. Injected into the evaluation pool via
// lib/planner/creditPool.ts buildCreditCourses(); the prereq evaluator and
// major matcher never learn exams exist.
export const CreditEntrySchema = z
  .object({
    id: z.string().max(40),
    kind: z.enum(["ap", "ib", "transfer", "placement"]),
    label: z.string().max(80),
    // rules: satisfiesCourseIds.size() <= 8 — keep in sync with firestore.rules
    satisfiesCourseIds: z.array(z.string().max(40)).max(8),
    credits: z.number().min(0).max(20).optional(),
  })
  .passthrough();
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

export const UserProfileSchema = z
  .object({
    // rules key allowlist: createdAt, displayName, authProvider, prefs,
    // activePlanId, importedLocalPlan, favoriteCourseIds, pinnedCourseIds,
    // lastShareAt, creditProfile — keep in sync with firestore.rules
    createdAt: z.unknown().optional(),
    // rules: displayName == null || displayName.size() <= 80 — keep in sync with firestore.rules
    displayName: z.string().max(80).nullable().optional(),
    authProvider: z.string().max(32).optional(),
    prefs: z
      .object({
        theme: z.string().max(16).optional(),
        // Entering year → real semester labels ("Fall 2026 · Freshman"), spec 004.
        enteringYear: z.number().int().min(2015).max(2035).optional(),
      })
      .passthrough()
      .optional(),
    activePlanId: z.string().max(64).nullable().optional(),
    importedLocalPlan: z.boolean().optional(),
    // Favorited courses (spec 006 §E4) — profile-level, works for anonymous uids
    // and survives the Google upgrade (same uid). Additive: old profiles lack it
    // and default to []. rules: favoriteCourseIds.size() <= 200 — keep in sync
    // with firestore.rules.
    favoriteCourseIds: z.array(z.string().max(40)).max(200).default([]),
    // Pinned courses for the decision-hub compare tray (spec 013 §2) —
    // profile-level, persisted exactly like favoriteCourseIds. The tray shows up
    // to 4 side-by-side; the schema/rules cap is a slightly-higher safety bound.
    // Additive: old profiles lack it and default to []. rules:
    // pinnedCourseIds.size() <= 8 — keep in sync with firestore.rules.
    pinnedCourseIds: z.array(z.string().max(40)).max(8).default([]),
    // Credit profile (spec 007 §2) — AP/IB/transfer/placement entries. Additive:
    // old profiles lack it and default to []. rules: creditProfile.size() <= 60
    // — keep in sync with firestore.rules.
    creditProfile: z.array(CreditEntrySchema).max(60).default([]),
    // Share rate-limit stamp (rules: must equal request.time when touched).
    lastShareAt: z.unknown().optional(),
  })
  .passthrough();
export type UserProfileDoc = z.infer<typeof UserProfileSchema>;
