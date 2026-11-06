/**
 * schedule.ts (spec 021) — the schedule filters' pure core: parse a catalog
 * index record's compact `meets` strings, and decide whether a course fits the
 * student's free days, time window and the courses already in their
 * enrollment-term column. No React here.
 *
 * `meets` grammar (built by scripts/catalog-index.ts meetingOptions):
 *   "<role><component>|<days> <start>-<end>[,<days> <start>-<end>…]"
 * role "P" = the primary component (the first LEC section's component, else
 * the first section's — the section the board card shows); "S" = any other
 * component (discussion, lab, …). Times are minutes since midnight. An empty
 * meeting list ("PIND|") means the section has no set time.
 *
 * Honesty rule (as everywhere in the app): no meeting data, no claim. While a
 * schedule filter is on, a course with no set time is hidden, never shown as
 * fitting.
 */

export type DayToken = "M" | "T" | "W" | "R" | "F" | "S" | "Su";
export const WEEKDAYS: DayToken[] = ["M", "T", "W", "R", "F"];
export const WEEKEND: DayToken[] = ["S", "Su"];

/** Which part of a course the days/time filters check (spec 021 Q3). */
export type ScheduleParts = "lecture" | "section" | "all";

export type MeetingBlock = { days: string[]; start: number; end: number };

/** One section option: its role and component, and its meetings (empty = no
 *  set time). */
export type MeetOption = { primary: boolean; component: string; blocks: MeetingBlock[] };

/** Tokenize a canonical day string ("TR", "MWF", "SSu"). "Su" before "S". */
export function dayTokens(days: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < days.length) {
    if (days[i] === "S" && days[i + 1] === "u") {
      out.push("Su");
      i += 2;
      continue;
    }
    if ("MTWRFS".includes(days[i])) out.push(days[i]);
    i += 1;
  }
  return out;
}

/** Parse one `meets` string; null when it isn't in the grammar. Malformed
 *  meetings inside a well-formed option are dropped (never a false time). */
export function parseMeet(s: string): MeetOption | null {
  const bar = s.indexOf("|");
  if (bar < 1) return null;
  const role = s[0];
  if (role !== "P" && role !== "S") return null;
  const component = s.slice(1, bar);
  const rest = s.slice(bar + 1);
  const blocks: MeetingBlock[] = [];
  if (rest) {
    for (const part of rest.split(",")) {
      const m = /^([A-Za-z]+) (\d{1,4})-(\d{1,4})$/.exec(part);
      if (!m) continue;
      const days = dayTokens(m[1]);
      const start = Number(m[2]);
      const end = Number(m[3]);
      if (days.length === 0 || !(end > start) || end > 24 * 60) continue;
      blocks.push({ days, start, end });
    }
  }
  return { primary: role === "P", component, blocks };
}

export function parseMeets(meets: readonly string[] | undefined): MeetOption[] {
  const out: MeetOption[] = [];
  for (const s of meets ?? []) {
    const o = parseMeet(s);
    if (o) out.push(o);
  }
  return out;
}

/** Does the course carry any set meeting time at all? */
export function hasSetTime(options: readonly MeetOption[]): boolean {
  return options.some((o) => o.blocks.length > 0);
}

/** The primary section's meetings (the first P option), or [] — the board's
 *  clash rule compares exactly this section (conflicts.ts v1). */
export function primaryBlocks(options: readonly MeetOption[]): MeetingBlock[] {
  return options.find((o) => o.primary)?.blocks ?? [];
}

export type ScheduleQuery = {
  /** Free days; a meeting must fall only on these. Empty/absent = any day. */
  days?: readonly string[];
  /** Earliest start, minutes since midnight. */
  from?: number;
  /** Latest end, minutes since midnight. */
  to?: number;
  /** Meetings the course must not overlap (the enrollment-term column). */
  busy?: readonly MeetingBlock[];
  parts: ScheduleParts;
};

/** Half-open overlap, as conflicts.ts: meetings that only touch don't clash. */
function clashes(a: MeetingBlock, b: MeetingBlock): boolean {
  return a.days.some((d) => b.days.includes(d)) && a.start < b.end && b.start < a.end;
}

function blockFits(b: MeetingBlock, q: ScheduleQuery): boolean {
  if (q.days && q.days.length > 0 && !b.days.every((d) => q.days!.includes(d))) return false;
  if (q.from != null && b.start < q.from) return false;
  if (q.to != null && b.end > q.to) return false;
  if (q.busy && q.busy.some((x) => clashes(b, x))) return false;
  return true;
}

/** A timed option fits when every one of its meetings fits. */
function optionFits(o: MeetOption, q: ScheduleQuery): boolean {
  return o.blocks.length > 0 && o.blocks.every((b) => blockFits(b, q));
}

/**
 * Does the course fit? A course with no set time anywhere never fits (no
 * claim). Then each checked part must have at least one timed option that
 * fits:
 * - "lecture": the primary component. Untimed there → no claim → no fit.
 * - "section": every other component (one fitting option per component). A
 *   component with no timed option has nothing to clash, so it passes; a course
 *   with no other component passes.
 * - "all": both.
 */
export function fitsSchedule(options: readonly MeetOption[], q: ScheduleQuery): boolean {
  if (!hasSetTime(options)) return false;
  if (q.parts !== "section") {
    if (!options.some((o) => o.primary && optionFits(o, q))) return false;
  }
  if (q.parts !== "lecture") {
    const byComponent = new Map<string, MeetOption[]>();
    for (const o of options) {
      if (o.primary) continue;
      const list = byComponent.get(o.component) ?? [];
      list.push(o);
      byComponent.set(o.component, list);
    }
    for (const list of byComponent.values()) {
      const timed = list.filter((o) => o.blocks.length > 0);
      if (timed.length > 0 && !timed.some((o) => optionFits(o, q))) return false;
    }
  }
  return true;
}

/** "10:10" (no meridian) — the board's compact chip idiom (sections.formatClock). */
function clock(min: number): string {
  let h = Math.floor(min / 60) % 12;
  if (h === 0) h = 12;
  return `${h}:${String(min % 60).padStart(2, "0")}`;
}

/** "10:10 AM" — the time dropdowns' labels. */
export function clockLabel(min: number): string {
  return `${clock(min)} ${min >= 12 * 60 ? "PM" : "AM"}`;
}

/**
 * The directory row's time chip: the first timed lecture option's first
 * meeting ("TR 10:10–11:25"), plus how many OTHER timed lecture options there
 * are. null when no lecture option has a set time.
 */
export function meetingSummary(
  options: readonly MeetOption[],
  /** When a schedule filter is on, lead with the lecture option that fits it,
   *  so the row shows why the course matched. */
  query?: ScheduleQuery | null
): { label: string; more: number } | null {
  const timedPrimary = options.filter((o) => o.primary && o.blocks.length > 0);
  if (timedPrimary.length === 0) return null;
  const lead = (query && timedPrimary.find((o) => optionFits(o, query))) ?? timedPrimary[0];
  const b = lead.blocks[0];
  return {
    label: `${b.days.join("")} ${clock(b.start)}–${clock(b.end)}`,
    more: timedPrimary.length - 1,
  };
}

/** The time dropdowns' choices: 7:00 AM to 10:00 PM in 15-minute steps. */
export const TIME_CHOICES: number[] = Array.from({ length: (22 - 7) * 4 + 1 }, (_, i) => 7 * 60 + i * 15);
