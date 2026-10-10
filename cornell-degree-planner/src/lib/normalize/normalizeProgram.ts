import type { ProgramDoc, SlotDoc, ElectiveGroupDoc } from "@/lib/schemas";
import type {
  Program,
  ProgramSlotWithData,
  Course,
  ElectiveGroup,
  QualifyingRule,
} from "@/types/db";
import { normalizeCategory } from "@/lib/planner/slotCategory";
import { normalizeAttributeMatch } from "@/lib/planner/satisfies";

/**
 * Read-boundary bridge: a single Firestore ProgramDoc (camelCase, slots+groups
 * embedded) → the app's snake_case Program metadata plus the joined
 * ProgramSlotWithData[] that useProgramData returns. One doc read reconstructs
 * the whole Postgres join (docs/specs/002 §3). Idempotent.
 *
 * Authored edges are dead (spec 008 §2b): the program doc's `edges` array is no
 * longer normalized — the canvas derives its wires from placed courses'
 * prereq/coreq trees (deriveEdges). `normalizeProgramEdges` was deleted here.
 */

export function normalizeProgramMeta(doc: ProgramDoc): Program {
  return {
    id: doc.id,
    name: doc.name,
    short_name: doc.shortName,
    college: doc.college,
    catalog_year: doc.catalogYear,
    total_credits: doc.totalCredits ?? null,
    affiliation_text: doc.affiliationText ?? null,
    created_at: new Date(0).toISOString(),
  };
}

function normalizeElectiveGroup(
  g: ElectiveGroupDoc,
  programId: string | null
): ElectiveGroup {
  return {
    id: g.id,
    program_id: programId,
    name: g.name,
    description: g.description ?? null,
    qualifying_rule: g.qualifyingRule as QualifyingRule,
    min_credits: g.minCredits,
    advisor_approval: g.advisorApproval ?? false,
    notes: g.notes ?? null,
    course_ids: g.courseIds ?? [],
  };
}

// Rebuild the joined `.courses` snapshot from a course-kind slot's denormalized
// display fields. Only the fields GridSlotNode / RightSidebar render are needed
// (id, subject, number, title, credits_min, credits_max); the rest are display-
// irrelevant and filled defensively. Freshness-sensitive data (description,
// prereq_expr) is fetched from courses/{id} on demand — never from the snapshot.
function slotCourseSnapshot(slot: SlotDoc): Course | null {
  if (slot.kind !== "course" || !slot.courseId) return null;
  const anySlot = slot as Record<string, unknown>;
  const subject =
    (anySlot.courseSubject as string | undefined) ??
    slot.courseId.split("-")[0] ??
    "";
  const number =
    (anySlot.courseNumber as string | undefined) ??
    slot.courseId.split("-").slice(1).join("-") ??
    "";
  return {
    id: slot.courseId,
    subject,
    number,
    title: slot.courseTitle ?? slot.courseId,
    credits_min: slot.creditsMin ?? 0,
    credits_max: slot.creditsMax ?? slot.creditsMin ?? 0,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
}

export function normalizeProgramSlots(doc: ProgramDoc): ProgramSlotWithData[] {
  const groupsById = new Map<string, ElectiveGroup>(
    (doc.electiveGroups ?? []).map((g) => [g.id, normalizeElectiveGroup(g, doc.id)])
  );

  return (doc.slots ?? []).map((slot) => ({
    id: slot.id,
    program_id: doc.id,
    kind: slot.kind,
    course_id: slot.courseId ?? null,
    pattern: slot.pattern ?? null,
    pattern_title: slot.patternTitle ?? null,
    elective_group_id: slot.electiveGroupId ?? null,
    suggested_semester: slot.suggestedSemester,
    slot_row: slot.slotRow,
    category: normalizeCategory((slot as Record<string, unknown>).category),
    // Attribute slots (spec 010 §2): bridge the loose doc `attributeMatch` to a
    // validated AttributeMatch, or null when malformed/absent (→ an unmatchable
    // requirement, never a crash). normalizeAttributeMatch owns the shape check.
    attribute_match: normalizeAttributeMatch(
      (slot as Record<string, unknown>).attributeMatch
    ),
    courses: slotCourseSnapshot(slot),
    elective_groups: slot.electiveGroupId
      ? groupsById.get(slot.electiveGroupId) ?? null
      : null,
  }));
}
