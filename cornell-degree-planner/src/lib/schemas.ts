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
    })
    .passthrough()
);

// ─── Qualifying rule (elective groups) ───────────────────────────────────────
export const QualifyingRuleSchema = z
  .object({ type: z.string() })
  .passthrough();

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
    rosterId: z.string().max(64).nullable().optional(),
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
    kind: z.enum(["course", "pattern", "elective"]),
    courseId: z.string().max(40).nullable().optional(),
    pattern: z.string().max(40).nullable().optional(),
    patternTitle: z.string().max(200).nullable().optional(),
    electiveGroupId: z.string().max(64).nullable().optional(),
    suggestedSemester: z.number().int().min(1).max(12),
    slotRow: z.number().int().min(0).max(20),
    // Denormalized display snapshot (course-kind slots).
    courseTitle: z.string().max(200).nullable().optional(),
    creditsMin: z.number().min(0).max(20).nullable().optional(),
    creditsMax: z.number().min(0).max(20).nullable().optional(),
  })
  .passthrough();
export type SlotDoc = z.infer<typeof SlotSchema>;

// ─── Slot edge (embedded array in programs/{programId}) ──────────────────────
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
  })
  .passthrough();
export type CatalogIndexRecord = z.infer<typeof CatalogIndexRecordSchema>;

export const CatalogIndexChunkSchema = z
  .object({
    records: z.array(CatalogIndexRecordSchema).max(400),
  })
  .passthrough();
export type CatalogIndexChunkDoc = z.infer<typeof CatalogIndexChunkSchema>;

/**
 * ─── Plan / User schemas ─── (stage 2 — auth/plans)
 * Defined here so the "keep in sync with firestore.rules" caps live in one file.
 * NOT consumed by any stage-1 read path; PlanProvider/services/plans.ts (stage 2)
 * will validate against these. Caps below mirror the users/{uid}/plans/{planId}
 * rule in firestore.rules — keep numerically identical.
 */
export const PlanSchema = z
  .object({
    name: z.string().max(80), // rules: name.size() <= 80 — keep in sync with firestore.rules
    programId: z.string().max(64),
    // rules: slotSelections.size() <= 120 — keep in sync with firestore.rules
    slotSelections: z.record(z.string().max(80), z.string().max(40)),
    // rules: completedSlotIds.size() <= 150 — keep in sync with firestore.rules
    completedSlotIds: z.array(z.string().max(80)).max(150).default([]),
    // rules: waivedSlotIds.size() <= 150 — keep in sync with firestore.rules
    waivedSlotIds: z.array(z.string().max(80)).max(150).default([]),
    // rules: courseSnapshots.size() <= 150 — keep in sync with firestore.rules
    courseSnapshots: z.record(z.string().max(40), z.unknown()),
    // ─── schemaVersion 2 (spec 005 §9 — roadmap mutability) ───
    // rules: slotOverrides.size() <= 80 — keep in sync with firestore.rules
    slotOverrides: z
      .record(
        z.string().max(80),
        z
          .object({
            sem: z.number().int().min(1).max(10).optional(),
            removed: z.literal(true).optional(),
          })
          .passthrough()
      )
      .default({}),
    // rules: customSlots.size() <= 40 — keep in sync with firestore.rules
    customSlots: z
      .array(
        z
          .object({
            id: z.string().max(60),
            sem: z.number().int().min(1).max(10),
            title: z.string().max(60).optional(),
          })
          .passthrough()
      )
      .max(40)
      .default([]),
    schemaVersion: z.number().int(),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();
export type PlanDoc = z.infer<typeof PlanSchema>;
export type SlotOverride = { sem?: number; removed?: true };
export type CustomSlot = { id: string; sem: number; title?: string };

export const UserProfileSchema = z
  .object({
    // rules key allowlist: createdAt, displayName, authProvider, prefs,
    // activePlanId, importedLocalPlan — keep in sync with firestore.rules
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
  })
  .passthrough();
export type UserProfileDoc = z.infer<typeof UserProfileSchema>;
