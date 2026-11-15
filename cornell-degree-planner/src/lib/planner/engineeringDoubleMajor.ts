import type { ProgramSlotWithData } from "@/types/db";
import { programCollegeId, programFamily } from "./colleges";
import { matchesProgramPrefix } from "./distribution/overlap";

/**
 * engineeringDoubleMajor.ts (spec 047 D15) — Engineering + Engineering double
 * majors, as data and pure functions. No live data: the rules live here.
 *
 * Sources: the Engineering Undergraduate Handbook (Fall 2026, "Double Majors"),
 * the 2026-27 catalog's Engineering page and the 13 Engineering B.S. program
 * pages. Any two Engineering majors may be combined, "All requirements of both
 * majors must be satisfied", and the student earns one B.S. degree. No page
 * caps the courses that count toward both majors, so the pair has no overlap
 * limit (a course may count for both).
 *
 * Two readings are ASSUMED, not quoted:
 *  1. The college-wide common curriculum (writing seminars, PE, CS 111x,
 *     ENGRI, liberal studies, the two-category ENGRD count and the college
 *     math/physics/chemistry core) is satisfied ONCE, by the primary major's
 *     template. Inferred from the single degree: both majors certify "all
 *     requirements for the B.S. degree", and the common curriculum is set by
 *     the college, not the major.
 *  2. Advisor-approved electives count once (the primary's), not once per
 *     major. Unstated either way.
 *
 * secondMajorSlots() applies them: the second major's template minus the
 * college-wide rows and minus every row naming the same course, pattern,
 * attribute or elective group as a primary row. Matching is never by slot id
 * (slot ids carry a major prefix: "cs-s1-math1910", "me-s1-math1910").
 * primaryRowsNotShared() and ADVISOR_ELECTIVE_GROUP keep the courses that
 * fill the common curriculum from counting again toward the second major
 * (the engine side is requirementProgress.ts withSecondMajor).
 */

/** The college's fixed math / physics / chemistry core (catalog "Common
 *  Curriculum": MATH 1910, 1920; PHYS 1112, 1110, 2213; CHEM 2090 + 2091).
 *  Dropped from a second major even when the primary meets them through its
 *  own choice group (EP's honors physics, BE's intro chemistry). */
export const COLLEGE_CORE_COURSES: ReadonlySet<string> = new Set([
  "MATH-1910",
  "MATH-1920",
  "PHYS-1112",
  "PHYS-1110",
  "PHYS-2213",
  "CHEM-2090",
  "CHEM-2091",
]);

/** College-wide pattern seats: intro computing, ENGRI, phys ed. */
export const COLLEGE_WIDE_PATTERNS: ReadonlySet<string> = new Set(["CS-111x", "ENGRI-1xxx", "PE-1xxx"]);

/** College-wide elective groups (shared ids, no owning program). */
export const COLLEGE_WIDE_GROUPS: ReadonlySet<string> = new Set(["liberal-studies", "advisor-elective-open"]);

/**
 * Each major's generic "second ENGRD" group: it exists only to complete the
 * college's two-category ENGRD count, which the primary already meets. NOT
 * listed (kept as the second major's own requirement): `mse-engr-dist` (MSE's
 * required ENGRD 2610/2620 category) and `ce-engrd-second` (CE's version
 * carries a major-approved-elective branch).
 */
export const GENERIC_SECOND_ENGRD_GROUPS: ReadonlySet<string> = new Set([
  "cs-engrd-dist",
  "ece-engrd-dist",
  "eas-engrd",
  "eas-engrd-second",
  "enve-engrd-second",
  "ep-engrd-second",
  "mse-engrd-second",
]);

/** A First-Year Writing Seminar attribute seat (title starts "FWS:"). */
function isFwsMatch(match: unknown): boolean {
  return JSON.stringify(match ?? null).includes('"FWS:"');
}

function courseOf(s: ProgramSlotWithData): string | null {
  return s.course_id ?? s.courses?.id ?? null;
}

function groupOf(s: ProgramSlotWithData): string | null {
  return s.elective_group_id ?? s.elective_groups?.id ?? null;
}

/** Is this slot part of the college-wide common curriculum? */
export function isCollegeWideSlot(s: ProgramSlotWithData, canonical: (id: string) => string = (id) => id): boolean {
  switch (s.kind) {
    case "course": {
      const id = courseOf(s);
      return id != null && (COLLEGE_CORE_COURSES.has(id) || COLLEGE_CORE_COURSES.has(canonical(id)));
    }
    case "pattern":
      return s.pattern != null && COLLEGE_WIDE_PATTERNS.has(s.pattern);
    case "attribute":
      return isFwsMatch(s.attribute_match);
    case "elective": {
      const g = groupOf(s);
      return g != null && (COLLEGE_WIDE_GROUPS.has(g) || GENERIC_SECOND_ENGRD_GROUPS.has(g));
    }
  }
}

/**
 * The second Engineering major's own requirements: its template minus the
 * college-wide rows (isCollegeWideSlot) and minus every row naming the same
 * course (`courseId`, compared canonically), pattern, attribute match or
 * elective-group id as a row of the primary's template. What stays: the major
 * program, its second math / physics / chemistry choices, PHYS 2214 where
 * required, its own ENGRD courses and major-specific ENGRD rules. Pure.
 */
export function secondMajorSlots(
  primary: readonly ProgramSlotWithData[],
  second: readonly ProgramSlotWithData[],
  canonical: (id: string) => string = (id) => id
): ProgramSlotWithData[] {
  const courses = new Set<string>();
  const patterns = new Set<string>();
  const attributes = new Set<string>();
  const groups = new Set<string>();
  for (const s of primary) {
    const c = courseOf(s);
    if (s.kind === "course" && c) courses.add(canonical(c));
    if (s.kind === "pattern" && s.pattern) patterns.add(s.pattern);
    if (s.kind === "attribute") attributes.add(JSON.stringify(s.attribute_match ?? null));
    const g = groupOf(s);
    if (s.kind === "elective" && g) groups.add(g);
  }
  return second.filter((s) => {
    if (isCollegeWideSlot(s, canonical)) return false;
    switch (s.kind) {
      case "course": {
        const c = courseOf(s);
        return !(c && courses.has(canonical(c)));
      }
      case "pattern":
        return !(s.pattern && patterns.has(s.pattern));
      case "attribute":
        return !attributes.has(JSON.stringify(s.attribute_match ?? null));
      case "elective": {
        const g = groupOf(s);
        return !(g && groups.has(g));
      }
    }
  });
}

/** The college's advisor-approved electives group. Its courses may not be
 *  "used elsewhere toward degree requirements" (catalog, Electives), so a
 *  course the second major counts never fills it: the engine re-matches the
 *  primary with those courses excluded from it. */
export const ADVISOR_ELECTIVE_GROUP = "advisor-elective-open";

/** The college's liberal studies group: a course it counts may not count
 *  toward either major. */
export const LIBERAL_STUDIES_GROUP = "liberal-studies";

/**
 * The primary's requirement ids whose courses the second major may not count
 * again: its common-curriculum seats (writing seminars, PE, CS 111x, ENGRI,
 * the math/physics/chemistry core), every seat naming the same course,
 * pattern or attribute as a second-major row (the row the second major
 * dropped), and liberal studies. Seats are slot ids, the pool its group id
 * (programToRequirements' ids). Not listed: the primary's own ENGRD groups (a
 * major's required ENGRD course also counts toward the college's ENGRD
 * distribution, as in a single major) and advisor electives (see
 * ADVISOR_ELECTIVE_GROUP). Pure.
 */
export function primaryRowsNotShared(
  primary: readonly ProgramSlotWithData[],
  second: readonly ProgramSlotWithData[],
  canonical: (id: string) => string = (id) => id
): Set<string> {
  const courses = new Set<string>();
  const patterns = new Set<string>();
  const attributes = new Set<string>();
  for (const s of second) {
    const c = courseOf(s);
    if (s.kind === "course" && c) courses.add(canonical(c));
    if (s.kind === "pattern" && s.pattern) patterns.add(s.pattern);
    if (s.kind === "attribute") attributes.add(JSON.stringify(s.attribute_match ?? null));
  }
  const out = new Set<string>();
  for (const s of primary) {
    if (s.kind === "elective") {
      if (groupOf(s) === LIBERAL_STUDIES_GROUP) out.add(LIBERAL_STUDIES_GROUP);
      continue;
    }
    const c = courseOf(s);
    const same =
      (s.kind === "course" && c != null && courses.has(canonical(c))) ||
      (s.kind === "pattern" && s.pattern != null && patterns.has(s.pattern)) ||
      (s.kind === "attribute" && attributes.has(JSON.stringify(s.attribute_match ?? null)));
    if (same || isCollegeWideSlot(s, canonical)) out.add(s.id);
  }
  return out;
}

// ─── Pairs ────────────────────────────────────────────────────────────────────

/** Program-id prefixes (every catalog year matches, like the `program` rule
 *  leaf). Engineering ids only. */
export const ENGINEERING_PROGRAM_PREFIXES = {
  cs: "cornell-cs-bs",
  ore: "cornell-ore-bs",
  isst: "cornell-isst-bs",
  enve: "cornell-enve-bs",
  ce: "cornell-ce-bs",
  be: "cornell-be-bs",
} as const;

const ISST_REASON =
  "ISST can't be paired with Computer Science or Operations Research (curricular overlap).";

/** Pairs the college forbids, either order (Handbook, Double Majors, note 2:
 *  "students majoring in ISST may not pursue a Double Major with either
 *  Computer Science (CS) or Operations Research and Engineering (ORE)"). The
 *  Independent Major may not pair with anything, but has no template. */
export const ENGINEERING_FORBIDDEN_PAIRS: readonly { a: string; b: string; reason: string }[] = [
  { a: ENGINEERING_PROGRAM_PREFIXES.isst, b: ENGINEERING_PROGRAM_PREFIXES.cs, reason: ISST_REASON },
  { a: ENGINEERING_PROGRAM_PREFIXES.isst, b: ENGINEERING_PROGRAM_PREFIXES.ore, reason: ISST_REASON },
];

const ENVE_NOTE =
  "Both majors' undergraduate coordinators must approve this pair, and your plan must show distinct thrusts in the two areas.";

/** Allowed pairs that carry a note for the picker (Handbook note 3; the
 *  Environmental Engineering handbook's "distinct thrusts" rule). */
export const ENGINEERING_PAIR_NOTES: readonly { a: string; b: string; note: string }[] = [
  { a: ENGINEERING_PROGRAM_PREFIXES.enve, b: ENGINEERING_PROGRAM_PREFIXES.ce, note: ENVE_NOTE },
  { a: ENGINEERING_PROGRAM_PREFIXES.enve, b: ENGINEERING_PROGRAM_PREFIXES.be, note: ENVE_NOTE },
];

function pairMatches(pair: { a: string; b: string }, x: string, y: string): boolean {
  return (
    (matchesProgramPrefix(x, [pair.a]) && matchesProgramPrefix(y, [pair.b])) ||
    (matchesProgramPrefix(x, [pair.b]) && matchesProgramPrefix(y, [pair.a]))
  );
}

/** Why two Engineering majors can't be a double major, or null when they can
 *  (either order, any catalog year). */
export function engineeringForbiddenReason(x: string, y: string): string | null {
  return ENGINEERING_FORBIDDEN_PAIRS.find((p) => pairMatches(p, x, y))?.reason ?? null;
}

/** The picker note for an allowed pair, or null (either order). */
export function engineeringPairNote(x: string, y: string): string | null {
  return ENGINEERING_PAIR_NOTES.find((p) => pairMatches(p, x, y))?.note ?? null;
}

/** The program-id prefixes `programId` may not be paired with — an overlap
 *  program's `forbiddenWith`. */
export function engineeringForbiddenWith(programId: string): string[] {
  const out: string[] = [];
  for (const p of ENGINEERING_FORBIDDEN_PAIRS) {
    if (matchesProgramPrefix(programId, [p.a])) out.push(p.b);
    else if (matchesProgramPrefix(programId, [p.b])) out.push(p.a);
  }
  return [...new Set(out)];
}

/** Is this program an Engineering major (the slot-template engine, in the
 *  College of Engineering)? A second major of one needs an Engineering
 *  primary (D1: same college). */
export function isEngineeringProgram(
  p: { college: string; collegeId?: "engineering" | "cas" | "cals" | null; family?: "engineering" | "cas" | "cals" } | null | undefined
): boolean {
  return !!p && programFamily(p) === "engineering" && programCollegeId(p) === "engineering";
}
