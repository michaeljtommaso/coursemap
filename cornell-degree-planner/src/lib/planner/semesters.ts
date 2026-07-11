import type { ProgramSlotWithData, Course } from "@/types/db";

/**
 * Semester grouping + labeling for the roadmap canvas (spec 004 §1).
 *
 * With an entering year (profile.prefs.enteringYear) the columns read as the
 * student's ACTUAL semesters — "Fall 2026 · Freshman" — instead of the generic
 * "Sem 1". Odd semesters are Fall of (year + (sem-1)/2); even are Spring of
 * (year + sem/2). Class of = enteringYear + 4.
 */

export type SemesterGroup = {
  sem: number;
  season: "Fall" | "Spring";
  slots: ProgramSlotWithData[];
};

const YEAR_WORDS = ["Freshman", "Freshman", "Sophomore", "Sophomore", "Junior", "Junior", "Senior", "Senior"];

export function groupSlotsBySemester(slots: ProgramSlotWithData[]): SemesterGroup[] {
  const bySem = new Map<number, ProgramSlotWithData[]>();
  for (const slot of slots) {
    const list = bySem.get(slot.suggested_semester) ?? [];
    list.push(slot);
    bySem.set(slot.suggested_semester, list);
  }
  // Always render semesters 1–8 (a column emptied by removals must survive so
  // its slots can be restored and new ones added), plus any later semester
  // that actually has content (moves/customs can reach sem 9–10).
  const sems = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, ...bySem.keys()]);
  return [...sems]
    .sort((a, b) => a - b)
    .map((sem) => ({
      sem,
      season: (sem % 2 === 1 ? "Fall" : "Spring") as "Fall" | "Spring",
      slots: (bySem.get(sem) ?? []).sort((a, b) => a.slot_row - b.slot_row),
    }));
}

export type SemesterLabel = {
  /** "Fall 2026" when enteringYear is known, else "Fall" */
  primary: string;
  /** "Freshman" / "Sophomore" … */
  yearWord: string;
  /** Calendar year, when known (for .num rendering) */
  calendarYear: number | null;
  sem: number;
};

export function semesterLabel(sem: number, enteringYear: number | null): SemesterLabel {
  const season = sem % 2 === 1 ? "Fall" : "Spring";
  const yearWord = YEAR_WORDS[sem - 1] ?? `Year ${Math.ceil(sem / 2)}`;
  if (!enteringYear) {
    return { primary: season, yearWord, calendarYear: null, sem };
  }
  const calendarYear =
    season === "Fall" ? enteringYear + (sem - 1) / 2 : enteringYear + sem / 2;
  return { primary: `${season} ${calendarYear}`, yearWord, calendarYear, sem };
}

export function classOfYear(enteringYear: number | null): number | null {
  return enteringYear ? enteringYear + 4 : null;
}

/** Credits currently represented by a slot: the placed course's, else the
 *  template course's, else the elective group's min_credits. Null when unknown
 *  (e.g. an unfilled pattern slot). */
export function slotCredits(
  slot: ProgramSlotWithData,
  placedCourse: Course | null
): { min: number; max: number } | null {
  const c = placedCourse ?? (slot.kind === "course" ? slot.courses : null);
  if (c) return { min: c.credits_min, max: c.credits_max };
  if (slot.kind === "elective" && slot.elective_groups) {
    const m = slot.elective_groups.min_credits;
    return m != null ? { min: m, max: m } : null;
  }
  return null;
}

export function formatCredits(cr: { min: number; max: number } | null): string | null {
  if (!cr) return null;
  return cr.min === cr.max ? `${cr.min}` : `${cr.min}–${cr.max}`;
}

/** A catalog search seed for an empty pattern/elective slot (spec 006 §D3): the
 *  "＋ Find a class" affordance opens the drawer pre-filtered to the slot's
 *  qualifying rule. Pattern slots seed the subject+level (wildcards stripped:
 *  "CS-111x" → "CS 111"); level-rule electives seed the subject; everything else
 *  seeds "" (open the drawer, no filter).
 *
 *  Attribute slots (spec 010 §2) DO NOT emit a text query — a property match has
 *  no code prefix. Their "Find a class" instead activates a catalog attribute
 *  filter (SlotCard passes slot.attribute_match through requestCatalogSearch),
 *  so this returns "" for them. */
export function slotSearchSeed(slot: ProgramSlotWithData): string {
  if (slot.kind === "pattern" && slot.pattern) {
    // "CS-111x" → "CS 111", "ENGRI-1xxx" → "ENGRI 1".
    return slot.pattern
      .replace(/-/g, " ")
      .replace(/[xX*]+$/g, "")
      .trim();
  }
  if (slot.kind === "elective" && slot.elective_groups) {
    const rule = slot.elective_groups.qualifying_rule;
    if (rule.type === "level") return rule.subject;
  }
  return "";
}
