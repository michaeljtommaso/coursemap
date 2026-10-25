import type { Course, ElectiveGroup, ProgramSlotWithData } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { MatchElectiveGroup, MatchSlot } from "./majorMatch";
import type { DistCourse } from "./distribution/types";

/**
 * matchAdapters.ts (spec 011 §1) — the two PURE adapters that feed the
 * bias-free matcher in majorMatch.ts, extracted from the hook so both are
 * table-testable in isolation (the hook itself is just React glue over these).
 *
 *   buildMatchPool          — the board's placements (+ credit) → DistCourse[]
 *                             (a MatchCourse[] with the Distribution fields)
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

/**
 * Subjects a course is cross-listed under (spec 019, CALS cross-listing):
 * the subjects of every OTHER id that shares this course's canonical id in the
 * alias map (alias id → canonical id; `aliases[id] ?? id` canonicalizes).
 * ENGRD-2110 → ["CS"]; CS-2110 → ["ENGRD"]. Undefined when there are none.
 */
function crossListedSubjectsFor(
  id: string,
  subject: string,
  byCanonical: Map<string, string[]> | null,
  aliases: Record<string, string> | undefined
): string[] | undefined {
  if (!byCanonical || !aliases) return undefined;
  const canonical = aliases[id] ?? id;
  const subjects = new Set<string>();
  for (const other of byCanonical.get(canonical) ?? []) {
    if (other === id) continue;
    const s = splitCourseId(other).subject;
    if (s && s !== subject) subjects.add(s);
  }
  return subjects.size > 0 ? [...subjects].sort() : undefined;
}

/** canonical id → every id in its cross-listing family (canonical included). */
function aliasFamilies(aliases: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(aliases)) {
    const ids = out.get(canonical) ?? [canonical];
    ids.push(alias);
    out.set(canonical, ids);
  }
  return out;
}

/** Build a pool course from a real Course (placed pick or completed-template
 *  snapshot), or from an id alone when the full course isn't in the map (the
 *  shape tolerates it, same as the old hook). Enrichment fields (title, attrs)
 *  ride along so attribute requirements can test against them. A 0 snapshot
 *  credit means "no credit data", not a genuine 0-credit course → default.
 *  `creditsMax` is set only for a variable-credit course (spec 019). */
function courseToMatchCourse(id: string, course: Course | undefined, detail?: Course): DistCourse {
  if (!course) {
    const { subject, number } = splitCourseId(id);
    return { id, subject, number, credits: DEFAULT_COURSE_CREDITS };
  }
  const credits = detail
    ? matchCredits(detail.credits_min, detail.credits_max, true)
    : matchCredits(course.credits_min, course.credits_max, false);
  return {
    id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    attrs: course.attrs,
    credits,
    ...((detail ?? course).credits_max > credits ? { creditsMax: (detail ?? course).credits_max } : {}),
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
 *
 * Distribution fields (spec 019, roadmap "Courses need two more fields"): each
 * course is a DistCourse — `creditsMax` on variable-credit courses, the credit
 * entry's `kind` as `creditKind` on credit courses, and `crossListedSubjects`
 * from the alias map when `aliases` is passed. The Engineering engine ignores
 * them (DistCourse extends MatchCourse).
 */
/**
 * The credits the matchers count for a course. A snapshot's 0 means "no
 * credit data" (a missing snapshot reads 0/0) → the shared default. Catalog
 * data (`authoritative`: a full course doc or a catalog index record) is
 * trusted for a FIXED 0-credit course (0–0, e.g. an orientation lecture):
 * defaulting it to 3 would let a credit total go green early (spec 019 review).
 * Board and Find-a-class both use this, so they agree on every course.
 */
export function matchCredits(min: number, max: number, authoritative: boolean): number {
  if (authoritative && min === 0 && max === 0) return 0;
  return min || DEFAULT_COURSE_CREDITS;
}

export function buildMatchPool(input: {
  placements: Placement[];
  /** courseId → course (enriched when available). */
  placedCourses: Record<string, Course>;
  creditProfile: CreditEntry[];
  /** catalog/meta aliases (alias id → canonical id), for crossListedSubjects. */
  aliases?: Record<string, string>;
  /** Full catalog docs by id (CatalogProvider.courseDetails): their credits
   *  are authoritative (matchCredits). Absent → snapshot credits, as before. */
  details?: Record<string, Course>;
}): DistCourse[] {
  const { placements, placedCourses, creditProfile, aliases, details } = input;
  const out: DistCourse[] = [];
  const seen = new Set<string>();
  const families = aliases && Object.keys(aliases).length > 0 ? aliasFamilies(aliases) : null;

  const push = (mc: DistCourse) => {
    if (seen.has(mc.id)) return;
    seen.add(mc.id);
    const crossListedSubjects = crossListedSubjectsFor(mc.id, mc.subject, families, aliases);
    out.push(crossListedSubjects ? { ...mc, crossListedSubjects } : mc);
  };

  const ordered = placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.sem - b.p.sem || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    push(courseToMatchCourse(p.courseId, placedCourses[p.courseId], details?.[p.courseId]));
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
        creditKind: entry.kind,
      });
    }
  }

  return out;
}

/**
 * Adapt a program's joined slots (ProgramSlotWithData[], the app's runtime
 * shape) into the minimal { slots, electiveGroups } input programToRequirements
 * consumes. Course/pattern/attribute slots pass through as MatchSlots; each
 * DISTINCT elective group becomes one MatchElectiveGroup — one pool per group —
 * whose targets come from the group's explicit requiredCourses/requiredCredits
 * when authored, else from THIS program's slot count for the group × the
 * per-slot min_credits (spec 019 D6). The pool keeps the group's id, so saved
 * waivers keep working.
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

  const groupsById = new Map<string, ElectiveGroup>();
  const slotCount = new Map<string, number>();
  for (const s of slots) {
    if (s.kind === "elective" && s.elective_groups) {
      const g = s.elective_groups;
      if (!groupsById.has(g.id)) groupsById.set(g.id, g);
      slotCount.set(g.id, (slotCount.get(g.id) ?? 0) + 1);
    }
  }

  const electiveGroups: MatchElectiveGroup[] = [...groupsById.values()].map((g) => {
    const requiredCourses = g.required_courses ?? Math.max(1, slotCount.get(g.id) ?? 1);
    return {
      id: g.id,
      name: g.name,
      qualifying_rule: g.qualifying_rule,
      min_credits: g.required_credits ?? requiredCourses * g.min_credits,
      required_courses: requiredCourses,
      course_ids: g.course_ids ?? [],
    };
  });

  return { slots: matchSlots, electiveGroups };
}
