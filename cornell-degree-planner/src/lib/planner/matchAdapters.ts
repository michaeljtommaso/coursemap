import type { Course, ProgramSlotWithData } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { MatchCourse, MatchElectiveGroup, MatchSlot } from "./majorMatch";

/**
 * matchAdapters.ts (spec 011 §1) — the two PURE adapters that feed the
 * bias-free matcher in majorMatch.ts, extracted from the hook so both are
 * table-testable in isolation (the hook itself is just React glue over these).
 *
 *   buildMatchPool          — the board's placements (+ credit) → MatchCourse[]
 *   programSlotsToMatchInput — a program's joined slots → programToRequirements input
 *
 * Neither adapter knows which program is "current" (C6 is dead by construction):
 * the SAME pool is scored against every program's requirements identically.
 */

/** Fallback credits for a course we have no credit figure for. A Cornell course
 *  is 3 credits far more often than any other value; synthetic AP/transfer
 *  credit is unlabeled per-course, so it also defaults here. */
const DEFAULT_COURSE_CREDITS = 3;

/** Split a dash-form course id ("MATH-1910") into subject + number. The number
 *  keeps any trailing segments verbatim so `${subject} ${number}` reconstructs
 *  the code exactly for the pattern matcher. */
function splitCourseId(id: string): { subject: string; number: string } {
  const dash = id.indexOf("-");
  return dash >= 0
    ? { subject: id.slice(0, dash), number: id.slice(dash + 1) }
    : { subject: id, number: "" };
}

/** Build a MatchCourse from a real Course (placed pick or completed-template
 *  snapshot), or from an id alone when the full course isn't in the map (the
 *  shape tolerates it, same as the old hook). Enrichment fields (title, attrs)
 *  ride along so attribute requirements can test against them. A 0 snapshot
 *  credit means "no credit data", not a genuine 0-credit course → default. */
function courseToMatchCourse(id: string, course: Course | undefined): MatchCourse {
  if (!course) {
    const { subject, number } = splitCourseId(id);
    return { id, subject, number, credits: DEFAULT_COURSE_CREDITS };
  }
  return {
    id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    attrs: course.attrs,
    credits: course.credits_min || DEFAULT_COURSE_CREDITS,
  };
}

/**
 * Build the matcher's course pool from the board plus the credit profile
 * (spec 014 §D1: requirements are attribution over the courses ON THE BOARD).
 * Every placement contributes its course, in board order (sem, then order);
 * the course object comes from the (enriched) placed-course map so attribute
 * requirements see title/attrs. Synthetic credit courses (007 §2) are
 * appended: each entry's satisfiesCourseIds becomes an isCredit MatchCourse
 * the matcher treats exactly like any other course.
 *
 * Ids stay in dash-form and are NOT canonicalized here — `assign` canonicalizes
 * and dedupes, so the pool stays a faithful list. A light first-wins dedup by
 * raw id keeps a course placed twice (a retake) from counting twice (spec 014
 * States: "attribution counts it once"), and lets a real placement win over a
 * same-id synthetic credit for its richer fields.
 */
export function buildMatchPool(input: {
  placements: Placement[];
  /** courseId → course (enriched when available). */
  placedCourses: Record<string, Course>;
  creditProfile: CreditEntry[];
}): MatchCourse[] {
  const { placements, placedCourses, creditProfile } = input;
  const out: MatchCourse[] = [];
  const seen = new Set<string>();

  const push = (mc: MatchCourse) => {
    if (seen.has(mc.id)) return;
    seen.add(mc.id);
    out.push(mc);
  };

  const ordered = placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.sem - b.p.sem || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    push(courseToMatchCourse(p.courseId, placedCourses[p.courseId]));
  }

  for (const entry of creditProfile) {
    for (const id of entry.satisfiesCourseIds) {
      const { subject, number } = splitCourseId(id);
      push({
        id,
        subject,
        number,
        // Credits from the entry when authored, else the shared default (3).
        credits: entry.credits ?? DEFAULT_COURSE_CREDITS,
        isCredit: true,
      });
    }
  }

  return out;
}

/**
 * Adapt a program's joined slots (ProgramSlotWithData[], the app's runtime
 * shape) into the minimal { slots, electiveGroups } input programToRequirements
 * consumes. Course/pattern/attribute slots pass through as MatchSlots; each
 * DISTINCT elective group becomes one MatchElectiveGroup (its min_credits
 * already encodes the pool total, so the several elective slots that share a
 * group collapse to that one pool — matching the module's "one pool per group").
 */
export function programSlotsToMatchInput(slots: ProgramSlotWithData[]): {
  slots: MatchSlot[];
  electiveGroups: MatchElectiveGroup[];
} {
  const matchSlots: MatchSlot[] = slots.map((s) => ({
    id: s.id,
    kind: s.kind,
    course_id: s.course_id,
    courses: s.courses
      ? {
          id: s.courses.id,
          subject: s.courses.subject,
          number: s.courses.number,
          title: s.courses.title,
          // A 0 snapshot credit means the seed carried no per-slot credits, not
          // a genuine 0-credit course — pass undefined so the module's
          // DEFAULT_SEAT_CREDITS applies (consistent with pattern/attr seats).
          credits_min: s.courses.credits_min || undefined,
        }
      : null,
    pattern: s.pattern,
    pattern_title: s.pattern_title,
    attribute_match: s.attribute_match ?? null,
    elective_group_id: s.elective_group_id,
  }));

  const groupsById = new Map<string, MatchElectiveGroup>();
  for (const s of slots) {
    if (s.kind === "elective" && s.elective_groups) {
      const g = s.elective_groups;
      if (!groupsById.has(g.id)) {
        groupsById.set(g.id, {
          id: g.id,
          name: g.name,
          qualifying_rule: g.qualifying_rule,
          min_credits: g.min_credits,
        });
      }
    }
  }

  return { slots: matchSlots, electiveGroups: [...groupsById.values()] };
}
