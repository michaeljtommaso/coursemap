import { z } from "zod";
import type {
  AppliesClause,
  CourseRule,
  Layer,
  Row,
  RowLimit,
} from "@/lib/planner/distribution/types";

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
    // Spec 019 D6 — the group's targets IN THIS PROGRAM (each program doc embeds
    // its own copy of a group). Absent → this program's slot count for the group
    // × minCredits (per slot).
    requiredCourses: z.number().int().min(1).max(40).nullable().optional(),
    requiredCredits: z.number().min(0).max(120).nullable().optional(),
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
    // Spec 017 D5 — the roster slug the course doc's sections come from ("SP27"),
    // and its lead lecturer: the first instructor of the primary component, with
    // `more` = the other distinct instructors on that component. Computed by
    // scripts/catalog-index.ts buildIndexRecords. Additive: chunks written before
    // this rebuild lack both and default to null (the /classes term switch and
    // professor line then hide — never a claim from missing data). Both CATCH to
    // null: one malformed value degrades that record's field instead of failing
    // the whole index chunk. `lead.netid` may be "" (a name-only instructor);
    // the app then shows the name and never joins a rating.
    roster: z.string().max(8).nullable().default(null).catch(null),
    lead: z
      .object({
        netid: z.string().max(16),
        name: z.string().min(1).max(140),
        more: z.number().int().min(0).max(200),
      })
      .passthrough()
      .nullable()
      .default(null)
      .catch(null),
  })
  .passthrough();
export type CatalogIndexRecord = z.infer<typeof CatalogIndexRecordSchema>;
export type CatalogIndexLead = NonNullable<CatalogIndexRecord["lead"]>;

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

// ─── catalog/professorRatings (spec 017 D5) ──────────────────────────────────
// One small doc joining roster netids to their current overall rating, so the
// /classes directory can show a rating per row with ONE read per visit. Public-
// read (catalog/{id}), admin-write. Entry keys are short on purpose (≈1,400
// entries): r = rating 0–5, c = review count, t = match tier (v verified /
// p probable), at = fetchedAt epoch ms. TOLERANT: a malformed entry is dropped
// on its own; it never fails the whole doc.
export const ProfessorRatingEntrySchema = z
  .object({
    r: z.number().min(0).max(5),
    c: z.number().int().min(0),
    t: z.enum(["v", "p"]),
    at: z.number(),
  })
  .passthrough();
export type ProfessorRatingEntry = z.infer<typeof ProfessorRatingEntrySchema>;

export const ProfessorRatingsDocSchema = z
  .object({
    ratings: z
      .record(z.string(), z.unknown())
      .default({})
      .transform((raw) => {
        const out: Record<string, ProfessorRatingEntry> = {};
        for (const [netid, value] of Object.entries(raw)) {
          if (netid.length === 0 || netid.length > 16) continue;
          const parsed = ProfessorRatingEntrySchema.safeParse(value);
          if (parsed.success) out[netid] = parsed.data;
        }
        return out;
      }),
    count: z.number().int().min(0).optional(),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();
export type ProfessorRatingsDoc = z.infer<typeof ProfessorRatingsDocSchema>;

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
    // lastShareAt, lastReportAt, creditProfile — keep in sync with firestore.rules
    createdAt: z.unknown().optional(),
    // rules: displayName == null || displayName.size() <= 80 — keep in sync with firestore.rules
    displayName: z.string().max(80).nullable().optional(),
    authProvider: z.string().max(32).optional(),
    prefs: z
      .object({
        theme: z.string().max(16).optional(),
        // Entering year → real semester labels ("Fall 2026 · Freshman"), spec 004.
        enteringYear: z.number().int().min(2015).max(2035).optional(),
        // Spec 019 D10/D11 — what selectLayers needs to pick a college's rule
        // version, and the student's college (Major Match scope). In `prefs`
        // like enteringYear (rules: prefs is an open map, dot-path merged).
        // A malformed stored value reads as unknown (null), never a parse
        // failure that would take the whole profile down.
        entryTerm: z.string().regex(/^(FA|SP|SU|WI)\d{2}$/).nullable().optional().catch(null),
        transfer: z.enum(["none", "external", "internal"]).nullable().optional().catch(null),
        transferStanding: z
          .enum(["first-year", "sophomore", "junior", "senior"])
          .nullable()
          .optional()
          .catch(null),
        college: z.enum(["engineering", "cas", "cals"]).nullable().optional().catch(null),
        // The concentration(s) chosen for ONE major; ids apply only while
        // programId is the current major. Malformed reads as unanswered.
        concentration: z
          .object({
            programId: z.string().min(1).max(80),
            ids: z.array(z.string().min(1).max(80)).max(10),
          })
          .nullable()
          .optional()
          .catch(null),
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
    // Requirement-report rate-limit stamp (spec 019 D15; same rule as lastShareAt).
    lastReportAt: z.unknown().optional(),
  })
  .passthrough();
export type UserProfileDoc = z.infer<typeof UserProfileSchema>;

// ─── Requirement layer (spec 019 D8 + amendment; Distribution engine) ────────
// A layer is AUTHORED data (scripts/seed-data/layers/…), so unlike the entity
// schemas above every object here is STRICT: an unknown key in a rule or row
// would silently change what a requirement means, and must fail validation
// instead. The TS types live in lib/planner/distribution/types.ts; the
// `satisfies` checks below keep the two from drifting.
const TERM = z.string().regex(/^(FA|SP|SU|WI)\d{2}$/, "a roster term like FA25");
const CREDIT_KIND = z.enum(["ap", "ib", "transfer", "placement"]);
const STANDING = z.enum(["first-year", "sophomore", "junior", "senior"]);
const SHORT_LIST = z.array(z.string().min(1).max(40)).min(1).max(200);

export const CourseRuleSchema: z.ZodType<CourseRule> = z.lazy(() =>
  z.union([
    z.object({ tag: SHORT_LIST }).strict(),
    z.object({ subject: SHORT_LIST, crossListed: z.boolean().optional() }).strict(),
    z
      .object({
        number: z
          .object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })
          .strict()
          .refine((n) => n.min != null || n.max != null, "number needs min or max"),
      })
      .strict(),
    z.object({ course: SHORT_LIST }).strict(),
    z.object({ pattern: z.string().min(1).max(40) }).strict(),
    z.object({ titleStartsWith: z.string().min(1).max(80) }).strict(),
    z.object({ minCredits: z.number().min(0).max(20) }).strict(),
    z.object({ variableCredit: z.literal(true) }).strict(),
    z.object({ creditKind: z.array(CREDIT_KIND).min(1) }).strict(),
    z.object({ program: SHORT_LIST }).strict(),
    z.object({ allOf: z.array(CourseRuleSchema).min(1).max(20) }).strict(),
    z.object({ anyOf: z.array(CourseRuleSchema).min(1).max(40) }).strict(),
    z.object({ not: CourseRuleSchema }).strict(),
  ])
);

const AppliesClauseSchema = z
  .object({
    enteredFrom: TERM.optional(),
    enteredBefore: TERM.optional(),
    transfer: z.array(z.enum(["none", "external", "internal"])).min(1).optional(),
    transferStanding: z.array(STANDING).min(1).optional(),
  })
  .strict() satisfies z.ZodType<AppliesClause>;

const ROW_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase-kebab id");
const COUNT = z.number().int().min(0).max(60);
const CREDITS = z.number().min(0).max(200);

const RowLimitSchema = z
  .object({
    rule: CourseRuleSchema,
    label: z.string().max(120).optional(),
    minCourses: COUNT.optional(),
    maxCourses: COUNT.optional(),
    minCredits: CREDITS.optional(),
    maxCredits: CREDITS.optional(),
  })
  .strict() satisfies z.ZodType<RowLimit>;

const rowBase = {
  id: ROW_ID,
  label: z.string().min(1).max(160),
  group: z.string().min(1).max(60),
  source: z.object({ url: z.string().url().max(300), anchor: z.string().min(1).max(160) }).strict(),
  note: z.string().max(500).optional(),
  overlay: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  appliesTo: z.array(AppliesClauseSchema).min(1).max(8).optional(),
};

const SeatRowSchema = z
  .object({ ...rowBase, kind: z.literal("seat"), rule: CourseRuleSchema, credits: CREDITS.optional() })
  .strict();
const PoolRowSchema = z
  .object({
    ...rowBase,
    kind: z.literal("pool"),
    rule: CourseRuleSchema,
    requiredCourses: COUNT,
    requiredCredits: CREDITS,
    maxPerSubject: COUNT.optional(),
    subjectGroups: z.array(z.array(z.string().min(1).max(12)).min(2).max(40)).max(20).optional(),
    limits: z.array(RowLimitSchema).max(8).optional(),
  })
  .strict();
const DistributionRowSchema = z
  .object({
    ...rowBase,
    kind: z.literal("distribution"),
    rule: CourseRuleSchema.optional(),
    categories: z
      .array(z.object({ id: ROW_ID, label: z.string().min(1).max(120), rule: CourseRuleSchema }).strict())
      .min(1)
      .max(20),
    requiredCourses: COUNT,
    minDistinctCategories: COUNT,
    perCategory: z
      .record(z.string(), z.object({ min: COUNT.optional(), max: COUNT.optional() }).strict())
      .optional(),
    maxCategoriesPerCourse: z.number().int().min(1).max(4).optional(),
    maxDoubleCountCourses: COUNT.optional(),
    maxPerSubject: COUNT.optional(),
    subjectGroups: z.array(z.array(z.string().min(1).max(12)).min(2).max(40)).max(20).optional(),
  })
  .strict();
const CreditsRowSchema = z
  .object({
    ...rowBase,
    kind: z.literal("credits"),
    rule: CourseRuleSchema,
    requiredCredits: CREDITS,
    sameSubject: z.boolean().optional(),
    limits: z.array(RowLimitSchema).max(8).optional(),
  })
  .strict();
const ChildRowSchema = z.discriminatedUnion("kind", [
  SeatRowSchema,
  PoolRowSchema,
  DistributionRowSchema,
  CreditsRowSchema,
]);
const AnyOfRowSchema = z
  .object({ ...rowBase, kind: z.literal("anyOf"), rows: z.array(ChildRowSchema).min(2).max(6) })
  .strict();
const ConfirmRowSchema = z.object({ ...rowBase, kind: z.literal("confirm") }).strict();

export const LayerRowSchema = z.discriminatedUnion("kind", [
  SeatRowSchema,
  PoolRowSchema,
  DistributionRowSchema,
  CreditsRowSchema,
  AnyOfRowSchema,
  ConfirmRowSchema,
]) satisfies z.ZodType<Row>;

export const LayerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
    kind: z.enum(["college", "major", "concentration"]),
    family: z.enum(["cas", "cals"]),
    name: z.string().min(1).max(160),
    catalogYear: z.string().regex(/^\d{4}-\d{2}$/),
    programId: z.string().max(80).optional(),
    concentrationId: z.string().max(80).optional(),
    // Major layers: how many concentrations a student chooses (lintLayer checks
    // min <= max and that only a major sets it).
    concentrations: z
      .object({ min: z.number().int().min(0).max(10), max: z.number().int().min(1).max(10) })
      .strict()
      .optional(),
    appliesTo: z.array(AppliesClauseSchema).min(1).max(8).optional(),
    rows: z.array(LayerRowSchema).min(1).max(80),
  })
  .strict() satisfies z.ZodType<Layer>;
export type LayerDoc = z.infer<typeof LayerSchema>;

// ─── Program index (spec 019 D11) ───────────────────────────────────────────
// `catalog/programIndex`: one doc listing every program, written by the seed
// scripts (scripts/seed-program-index.ts). The major picker reads it instead of
// every program doc. Passthrough like the other entity schemas: a newer seed
// may add fields an older app ignores.
export const ProgramIndexEntrySchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    shortName: z.string().min(1).max(40),
    /** Display college, as on the program doc ("College of Engineering"). */
    college: z.string().min(1).max(80),
    /** Who the program is ranked with (Major Match scope, D3). null: the blank canvas. */
    collegeId: z.enum(["engineering", "cas", "cals"]).nullable(),
    /** Which engine evaluates it (colleges.ts ProgramFamily). */
    family: z.enum(["engineering", "cas", "cals"]),
    /** Program ids of the same major offered by another college (D5). */
    twins: z.array(z.string().max(80)).max(4).default([]),
    /** Cornell's page for this major (the twins line links to it). */
    // https only: it becomes a link's href (no javascript:/data: schemes).
    url: z
      .string()
      .url()
      .max(300)
      .refine((u) => u.startsWith("https://"), "an https URL")
      .nullable()
      .default(null),
    /** "hidden" pulls a major from the picker without deleting it (D11). */
    status: z.enum(["visible", "hidden"]).default("visible"),
    catalogYear: z.number().int().min(2000).max(2100),
    totalCredits: z.number().nullable().default(null),
  })
  .passthrough();
export type ProgramIndexEntry = z.infer<typeof ProgramIndexEntrySchema>;

export const ProgramIndexDocSchema = z
  .object({
    entries: z.array(ProgramIndexEntrySchema).max(300),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();
export type ProgramIndexDoc = z.infer<typeof ProgramIndexDocSchema>;

// ─── Requirement reports (spec 019 D15) ─────────────────────────────────────
// `requirementReports/{id}`: create-only "this looks wrong" reports from any
// signed-in or guest user. Every cap mirrors firestore.rules — keep in sync.
export const RequirementReportSchema = z
  .object({
    uid: z.string().min(1).max(128),
    programId: z.string().min(1).max(80),
    /** Layer id for Distribution programs; "program" for Engineering-family rows. */
    layer: z.string().min(1).max(120),
    rowId: z.string().min(1).max(120),
    note: z.string().max(500).optional(),
    createdAt: z.unknown(),
  })
  .strict();
export type RequirementReportDoc = z.infer<typeof RequirementReportSchema>;
