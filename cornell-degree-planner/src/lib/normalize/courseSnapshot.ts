import type { Course } from "@/types/db";

/**
 * Plan/share course snapshots (camelCase display cache stored in the doc's
 * `courseSnapshots`) ↔ the app's snake_case Course. Snapshots carry DISPLAY
 * fields only; the freshness-sensitive fields (prereq/coreq/offered/…) are
 * fetched on demand and overlaid by enrichCourses — so a snapshot-built Course
 * reads them as empty until its doc lands.
 */

export type CourseSnapshot = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
};

/** Split a dash-form id ("MATH-1910") into subject + number. */
function splitId(id: string): { subject: string; number: string } {
  const dash = id.indexOf("-");
  return dash >= 0
    ? { subject: id.slice(0, dash), number: id.slice(dash + 1) }
    : { subject: id, number: "" };
}

/** Build a display Course from a stored snapshot. A missing/garbled snapshot
 *  still yields a usable card (code derived from the id) — a placement is
 *  never dropped for want of its display cache. */
export function snapshotToCourse(id: string, snap: unknown): Course {
  const s = (snap && typeof snap === "object" ? snap : {}) as Record<string, unknown>;
  const fromId = splitId(id);
  const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const creditsMin = num(s.creditsMin) ?? 0;
  return {
    id: str(s.id, id),
    subject: str(s.subject, fromId.subject),
    number: str(s.number, fromId.number),
    title: str(s.title, id.replace(/-/g, " ")),
    credits_min: creditsMin,
    credits_max: num(s.creditsMax) ?? creditsMin,
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

/** The display snapshot stored for a placed course. Never contains undefined
 *  (Firestore rejects undefined values and fails the whole write). */
export function courseToSnapshot(c: Course): CourseSnapshot {
  return {
    id: c.id,
    subject: c.subject ?? "",
    number: c.number ?? "",
    title: c.title ?? c.id,
    creditsMin: c.credits_min ?? 0,
    creditsMax: c.credits_max ?? c.credits_min ?? 0,
  };
}
