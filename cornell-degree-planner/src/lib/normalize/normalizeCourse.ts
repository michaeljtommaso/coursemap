import type { CourseDoc } from "@/lib/schemas";
import type { Course, PrereqExpr } from "@/types/db";

/**
 * Read-boundary bridge: Firestore camelCase CourseDoc → app snake_case Course
 * (@/types/db). Idempotent; the app's components + evaluatePrereq.ts all consume
 * the snake_case shape, so keeping this here means the whole read port is one
 * mechanical rename and nothing downstream changes.
 */
export function normalizeCourse(doc: CourseDoc): Course {
  return {
    id: doc.id,
    subject: doc.subject,
    number: doc.number,
    title: doc.title,
    credits_min: doc.creditsMin,
    credits_max: doc.creditsMax,
    description: doc.description ?? null,
    offered: doc.offered ?? [],
    prereq_expr: (doc.prereqExpr ?? null) as PrereqExpr | null,
    coreq_expr: (doc.coreqExpr ?? null) as PrereqExpr | null,
    forbidden_overlaps: doc.forbiddenOverlaps ?? [],
    prereq_notes: doc.prereqNotes ?? [],
    // Spec 010 §1/§3/§5 (Unit 10A) — crseAttrs + enrollGroups ingest bridge.
    // Explicit per-field mapping (not a raw cast) so a doc's optional nested
    // fields always resolve to the app's required shape.
    attrs: (doc.attrs ?? []).map((a) => ({
      value: a.value,
      descr: a.descr,
      group: a.group,
    })),
    sections: (doc.sections ?? []).map((s) => ({
      code: s.code,
      component: s.component,
      openStatus: s.openStatus ?? null,
      gradingBasis: s.gradingBasis ?? null,
      components: s.components ?? [],
      instructors: (s.instructors ?? []).map((i) => ({
        netid: i.netid,
        firstName: i.firstName,
        lastName: i.lastName,
      })),
      meetings: (s.meetings ?? []).map((m) => ({
        pattern: m.pattern,
        timeStart: m.timeStart,
        timeEnd: m.timeEnd,
      })),
    })),
    components: doc.components ?? [],
    roster_id: doc.rosterId ?? null,
    // updatedAt is a Firestore Timestamp on real docs; the UI never reads it, so
    // coerce to a string defensively.
    updated_at:
      typeof doc.updatedAt === "string" ? doc.updatedAt : new Date(0).toISOString(),
  };
}
