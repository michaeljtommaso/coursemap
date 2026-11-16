import type { Course, ElectiveGroup, ProgramSlotWithData } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { ResolvedCredit } from "@/lib/credit/types";
import type { Placement } from "@/types/plan";
import type { MatchElectiveGroup, MatchSlot } from "./majorMatch";
import type { DistCourse } from "./distribution/types";
import { creditOnlyCourseId } from "./creditPool";
import { semesterTerm } from "./liberalStudies";
import { columnKey, refOf } from "./terms";
import type { MarkValue } from "./distribution/types";
import { chosenCredits } from "./chosenCredits";

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
 * Roster cross-listings (catalog/meta `crossListings`: member id → its
 * family's representative id; classes sharing a roster crseId, e.g. LSP-3770,
 * HIST-3770, AMST-3775). They feed ONLY crossListedSubjects, never id
 * canonicalization: the alias map alone decides which ids are the same course
 * for lists, prerequisites, duplicates and stored marks. They ride on the alias
 * map object they were loaded with (withCrossListings), so every memo keyed on
 * that object recomputes when they arrive, and no call site changes.
 */
const crossListingsByAliases = new WeakMap<Record<string, string>, Record<string, string>>();

/** A copy of `aliases` that carries `crossListings` (CatalogProvider). */
export function withCrossListings(
  aliases: Record<string, string>,
  crossListings: Record<string, string> | undefined
): Record<string, string> {
  const out = { ...aliases };
  if (crossListings && Object.keys(crossListings).length > 0) crossListingsByAliases.set(out, crossListings);
  return out;
}

/**
 * Subjects a course is cross-listed under (spec 019, CALS cross-listing):
 * the subjects of every OTHER id in this course's family. Families come from
 * the alias map (ids sharing a canonical id: ENGRD-2110 → ["CS"], CS-2110 →
 * ["ENGRD"]) joined with the roster cross-listings it carries (HIST-3770 →
 * ["AMST", "LSP"]). Undefined when there are none.
 */
function crossListedSubjectsFor(
  id: string,
  subject: string,
  families: CrossListFamilies | null
): string[] | undefined {
  if (!families) return undefined;
  const subjects = new Set<string>();
  for (const other of families.get(id) ?? []) {
    if (other === id) continue;
    const s = splitCourseId(other).subject;
    if (s && s !== subject) subjects.add(s);
  }
  return subjects.size > 0 ? [...subjects].sort() : undefined;
}

/** id → every id in its family (itself included), for every id in a family. */
type CrossListFamilies = Map<string, string[]>;

/** Families from member → representative maps (aliases and roster
 *  cross-listings), joined where they share an id. Null when both are empty. */
function crossListFamilies(aliases: Record<string, string> | undefined): CrossListFamilies | null {
  if (!aliases) return null;
  const cached = familiesCache.get(aliases);
  if (cached !== undefined) return cached;
  const built = buildCrossListFamilies(aliases);
  familiesCache.set(aliases, built);
  return built;
}

/** Families per alias map object: built once, not on every pool rebuild. */
const familiesCache = new WeakMap<Record<string, string>, CrossListFamilies | null>();

function buildCrossListFamilies(aliases: Record<string, string>): CrossListFamilies | null {
  const maps = [aliases, aliases ? crossListingsByAliases.get(aliases) : undefined].filter(
    (m): m is Record<string, string> => m != null && Object.keys(m).length > 0
  );
  if (maps.length === 0) return null;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const m of maps) for (const [member, rep] of Object.entries(m)) {
    const a = find(member);
    const b = find(rep);
    if (a !== b) parent.set(a, b);
  }
  const byRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const ids = byRoot.get(root);
    if (ids) ids.push(id);
    else byRoot.set(root, [id]);
  }
  const out: CrossListFamilies = new Map();
  for (const ids of byRoot.values()) for (const id of ids) out.set(id, ids);
  return out;
}

/** id + subject → its cross-listed subjects, from an alias map and the roster
 *  cross-listings it carries (families precomputed once). The board pool and
 *  Find a class share it, so a `crossListed` rule sees the same subjects on both. */
export function crossListedSubjectsLookup(
  aliases: Record<string, string> | undefined
): (id: string, subject: string) => string[] | undefined {
  const families = crossListFamilies(aliases);
  return (id, subject) => crossListedSubjectsFor(id, subject, families);
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
 *
 * Resolved credit (spec 028, useCreditProfile().resolved): each credit course
 * counts its own share (`courseCredits`), so an exam granting a lecture and a
 * lab doesn't count its total twice; an exam credit course carries its exam
 * and score (`creditExam` / `creditScore`) for the `examScore` rule leaf; a
 * placement-only award (no credit) is left out of the pool, so it never fills
 * a requirement (its courses still count as done for prerequisites, through
 * buildCreditCourses).
 *
 * Cornell's "X or Y" awards (`courseOptions`: AP Chemistry → CHEM 2070 & 2071
 * or CHEM 2090 & 2091) add ONE option: a synthetic course per position of the
 * first set, each carrying the other sets' ids at that position as `altIds`
 * (the matchers let it count as whichever reading a requirement accepts, once).
 * Such an entry adds nothing when any of its courses is already on the board:
 * taking one of the options at Cornell uses the credit up, and the board
 * course must not be joined by an alternate of itself.
 *
 * Credit that names NO Cornell course but carries credits (AP Biology 5 → 8
 * credits; a language exam; a "No Cornell equivalent" transfer) adds ONE
 * credit-only course, id `credit:<entry id>` (creditOnlyCourseId), with an
 * empty subject and number: credit totals ("120 academic credits") and
 * credit-kind limits ("at most 15 credits from exams") count it; no subject,
 * number, course, pattern or title rule can. Display names it by its entry
 * (creditEntryByCourse), never as a course code. A synthetic course takes the
 * award's `courseTitles` title for it when given (Engineering's ENGL 1100F is
 * "FWS: …", so its FWS seats accept it).
 *
 * Liberal studies (spec 037), both optional so other callers are unchanged:
 * with `enteringYear`, every placed course carries its placement's roster
 * `term` (petitions limited to "Summer 2024 and prior" read it); with
 * `catalogAttrs`, a credit course whose id is a real catalog course takes that
 * course's roster tags as `attrs` (AP Microeconomics → ECON 1110's tags). A
 * credit course always carries its award's `liberalStudies` base codes.
 */
/** Prefix of an Engineering liberal studies group in `countsToward.areas`
 *  ("LS:g1"); every other area is a roster distribution tag ("ALC-AS"). */
export const LS_AREA_PREFIX = "LS:";

/**
 * Spec 046 D6 — what a no-equivalent transfer's "Counts toward" adds to its
 * credit-only course: roster tags as `attrs` (A&S and CALS distribution rows
 * read them), Engineering liberal studies groups as `liberalStudiesGroups`,
 * and a requirement row as `placedFor` (each engine grants that row's rule).
 * Absent → nothing, exactly as before.
 */
export function countsTowardFields(
  ct: CreditEntry["countsToward"]
): Pick<DistCourse, "attrs" | "liberalStudiesGroups" | "placedFor"> {
  if (!ct) return {};
  if (ct.row) return { placedFor: ct.categories ? { row: ct.row, categories: [...ct.categories] } : { row: ct.row } };
  const areas = ct.areas ?? [];
  const tags = areas.filter((a) => !a.startsWith(LS_AREA_PREFIX));
  const groups = areas.filter((a) => a.startsWith(LS_AREA_PREFIX)).map((a) => a.slice(LS_AREA_PREFIX.length));
  return {
    ...(tags.length > 0 ? { attrs: tags.map((value) => ({ value })) } : {}),
    ...(groups.length > 0 ? { liberalStudiesGroups: groups } : {}),
  };
}

/** A saved or resolved credit entry: the resolver's fields are optional so a
 *  raw CreditEntry[] (tests, older callers) still works unchanged. */
export type PoolCreditEntry = CreditEntry &
  Partial<
    Pick<
      ResolvedCredit,
      "courseCredits" | "source" | "placementOnly" | "courseOptions" | "courseTitles" | "earnsNothing" | "liberalStudies"
    >
  >;

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
  creditProfile: readonly PoolCreditEntry[];
  /** catalog/meta aliases (alias id → canonical id), for crossListedSubjects. */
  aliases?: Record<string, string>;
  /** Full catalog docs by id (CatalogProvider.courseDetails): their credits
   *  are authoritative (matchCredits). Absent → snapshot credits, as before. */
  details?: Record<string, Course>;
  /** The board's entering year (sem 1 = Fall of it): placed courses get their
   *  roster `term`. Absent/null → no terms. */
  enteringYear?: number | null;
  /** Catalog roster tags by course id (the class index): credit courses with
   *  a real catalog id take them as `attrs`. Absent → credit carries no tags. */
  catalogAttrs?: (id: string) => readonly string[] | undefined;
  /** The plan's course marks: a variable-credit course the student chose
   *  credits for counts those credits (chosenCredits.ts). */
  courseMarks?: Readonly<Record<string, MarkValue>>;
}): DistCourse[] {
  const { placements, placedCourses, creditProfile, aliases, details, enteringYear, catalogAttrs, courseMarks } = input;
  const out: DistCourse[] = [];
  const seen = new Set<string>();
  const families = crossListFamilies(aliases);

  const push = (mc: DistCourse) => {
    if (seen.has(mc.id)) return;
    seen.add(mc.id);
    const crossListedSubjects = crossListedSubjectsFor(mc.id, mc.subject, families);
    out.push(crossListedSubjects ? { ...mc, crossListedSubjects } : mc);
  };

  // Board order is TIME order (spec 042 D5): a short term before semester k
  // sorts between semester k − 1 and k (terms.ts columnKey).
  const ordered = placements
    .map((p, i) => ({ p, i, key: columnKey(refOf(p)) }))
    .sort((a, b) => a.key - b.key || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    const src = details?.[p.courseId] ?? placedCourses[p.courseId];
    let mc = courseToMatchCourse(p.courseId, placedCourses[p.courseId], details?.[p.courseId]);
    const chosen = src ? chosenCredits(courseMarks, p.courseId, src.credits_min, src.credits_max) : null;
    // Still a variable-credit course whatever was chosen (rules that leave
    // those out keep doing so at its maximum too).
    if (chosen !== null) mc = { ...mc, credits: chosen, variableCredit: true };
    // A short-term placement carries its real roster slug ("SU24").
    const term = enteringYear != null ? semesterTerm(refOf(p), enteringYear) : null;
    push(term ? { ...mc, term } : mc);
  }

  const canon = (id: string) => aliases?.[id] ?? id;
  const boardIds = new Set(placements.map((p) => canon(p.courseId)));
  for (const entry of creditProfile) {
    if (entry.placementOnly) continue;
    const exam = entry.source?.kind === "exam" ? entry.source : null;
    const examFields = exam ? { creditExam: exam.exam, creditScore: exam.score } : {};
    // Spec 028: a synthetic course carries the award's title for it when the
    // table gives one (Engineering's exam-credit FWS: "FWS: …").
    const titleOf = (id: string) => (entry.courseTitles?.[id] ? { title: entry.courseTitles[id] } : {});
    // Spec 037 D4: the award's liberal studies categories, and the granted
    // course's own roster tags when it is a real catalog course.
    const lsFields = entry.liberalStudies && entry.liberalStudies.length > 0 ? { liberalStudies: entry.liberalStudies } : {};
    const attrsOf = (id: string) => {
      const tags = catalogAttrs?.(id);
      return tags && tags.length > 0 ? { attrs: tags.map((value) => ({ value })) } : {};
    };
    const creditOnly = creditOnlyCourseId(entry);
    if (creditOnly) {
      // Credit naming no Cornell course (AP Biology's 8, a "No Cornell
      // equivalent" transfer): one credit-only course with no subject or
      // number, so credit-total and credit-kind rules count it and no
      // subject, number, course, pattern or title rule ever does.
      push({
        id: creditOnly,
        subject: "",
        number: "",
        credits: entry.credits ?? 0,
        isCredit: true,
        creditKind: entry.kind,
        ...examFields,
        ...lsFields,
        ...(entry.kind === "transfer" ? countsTowardFields(entry.countsToward) : {}),
      });
      continue;
    }
    const options = entry.courseOptions?.filter((set) => set.length > 0);
    if (options && options.length > 0) {
      const union = options.flat();
      if (union.some((id) => boardIds.has(canon(id)))) continue;
      const [first, ...rest] = options;
      first.forEach((id, i) => {
        const { subject, number } = splitCourseId(id);
        const altIds = rest.map((set) => set[i]).filter((alt): alt is string => alt != null && alt !== id);
        push({
          id,
          subject,
          number,
          ...titleOf(id),
          ...attrsOf(id),
          credits: entry.courseCredits?.[id] ?? entry.credits ?? DEFAULT_COURSE_CREDITS,
          isCredit: true,
          creditKind: entry.kind,
          ...examFields,
          ...lsFields,
          ...(altIds.length > 0 ? { altIds } : {}),
        });
      });
      continue;
    }
    for (const id of entry.satisfiesCourseIds) {
      const { subject, number } = splitCourseId(id);
      push({
        id,
        subject,
        number,
        ...titleOf(id),
        ...attrsOf(id),
        // The course's own share when the resolver split the total, else the
        // entry's credits when authored, else the shared default (3).
        credits: entry.courseCredits?.[id] ?? entry.credits ?? DEFAULT_COURSE_CREDITS,
        isCredit: true,
        creditKind: entry.kind,
        ...examFields,
        ...lsFields,
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
