/**
 * conflicts.ts (spec 012 §4) — the "sleeper feature": advisory time-conflict
 * detection across the near-horizon column. Pure + unit-tested.
 *
 * v1 decision (spec §4, recorded): compare each course's PRIMARY section only
 * (first LEC, else first section) — the honest caption "based on the main
 * lecture times — other sections may differ" covers the rest. The every-section
 * check is the designed v2 upgrade inside this same API.
 *
 * Advisory ONLY — a Conflict never blocks a card. Meetings missing a day
 * pattern or parseable times are skipped silently (the honesty rule: no
 * meeting data → no conflict claim).
 */

import type { CourseSection } from "@/types/db";
import { primarySection, parseDayTokens, parseClockToMinutes, formatClock } from "./sections";

export type ConflictPlacement = {
  slotId: string;
  courseId: string;
  /** Display code ("CS 2110") for the advisory copy. */
  courseCode: string;
  sections: CourseSection[];
};

export type Conflict = {
  aSlotId: string;
  bSlotId: string;
  aCourseId: string;
  bCourseId: string;
  overlap: { days: string[]; timeRange: string };
};

/** A resolved, comparable meeting window: which days, and the minute range. */
type MeetingWindow = { days: string[]; start: number; end: number };

/** The primary section's well-formed meeting windows (day pattern + parseable
 *  times + positive duration). Empty when the course has no usable meeting. */
function primaryMeetingWindows(sections: CourseSection[]): MeetingWindow[] {
  const primary = primarySection(sections);
  if (!primary) return [];
  const windows: MeetingWindow[] = [];
  for (const m of primary.meetings) {
    const days = parseDayTokens(m.pattern);
    const start = parseClockToMinutes(m.timeStart);
    const end = parseClockToMinutes(m.timeEnd);
    if (days.length === 0 || start == null || end == null || end <= start) continue;
    windows.push({ days, start, end });
  }
  return windows;
}

/**
 * Pairwise conflict detection over the given placements (the caller passes ONLY
 * near-horizon, offered-this-term placements). Two placements conflict iff their
 * primary sections share a day AND their minute ranges intersect. Half-open
 * comparison — meetings that merely touch (endA === startB) do NOT collide.
 */
export function findConflicts(placements: ConflictPlacement[]): Conflict[] {
  const prepared = placements.map((p) => ({ p, windows: primaryMeetingWindows(p.sections) }));
  const conflicts: Conflict[] = [];

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.windows.length === 0 || b.windows.length === 0) continue;

      const collidingDays = new Set<string>();
      let timeRange: string | null = null;
      for (const wa of a.windows) {
        for (const wb of b.windows) {
          const shared = wa.days.filter((d) => wb.days.includes(d));
          if (shared.length === 0) continue;
          // Half-open intersection: [start, end). Touching boundaries do not overlap.
          if (wa.start < wb.end && wb.start < wa.end) {
            for (const d of shared) collidingDays.add(d);
            if (!timeRange) {
              const s = Math.max(wa.start, wb.start);
              const e = Math.min(wa.end, wb.end);
              timeRange = `${formatClock(s)}–${formatClock(e)}`;
            }
          }
        }
      }

      if (collidingDays.size > 0 && timeRange) {
        conflicts.push({
          aSlotId: a.p.slotId,
          bSlotId: b.p.slotId,
          aCourseId: a.p.courseId,
          bCourseId: b.p.courseId,
          overlap: { days: [...collidingDays], timeRange },
        });
      }
    }
  }
  return conflicts;
}
