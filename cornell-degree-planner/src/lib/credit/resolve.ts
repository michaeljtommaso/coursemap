/**
 * lib/credit/resolve.ts (spec 025 D3) — saved credit → ResolvedCredit[].
 *
 *   resolveCreditProfile(entries, college, tables)
 *     - exam entries (and LEGACY_EXAM_IDS entries) → courses, credits,
 *       courseCredits, limits, earnsNothing from the college's table
 *       (engineering → engineering table only; cas / cals → their override
 *       where it `replaces` the exam, else the university table, plus
 *       collegeLimits; null → university table);
 *       label = source.displayName ("AP Calculus BC (5)");
 *     - transfer entries → kept as saved, source { kind: "transfer" };
 *     - anything the tables can't place → kept as saved, "unresolved".
 *     Pure; same input → structurally equal output, in input order.
 *   examResult(exam, score, college, tables) → the award the editor shows on
 *     a row before saving (null = earns nothing in this college).
 *   scoresThatEarn(exam, tables) → the scores to show as buttons: those that
 *     earn something in ANY college, lowest first (D6). A 0-credit award
 *     with a note ("German Studies decides credit") counts as earning: the
 *     student should record it and read the note.
 *
 * "X or Y" awards (`courseOptions`) are copied onto the resolved entry with
 * per-course credits computed within each option (see optionCredits);
 * buildMatchPool counts only one option. The award's `note` and
 * `courseTitles` (the title a synthetic credit course carries, e.g.
 * Engineering's exam-credit FWS) are copied too.
 *
 * "Can't place" (→ unresolved, the saved entry counted exactly as saved):
 * no tables loaded, an exam id the tables don't list, a score that isn't on
 * the exam's scale, a missing score, or a `tableYear` other than the tables'
 * year (D3: a later table never silently changes an older student's credit).
 * An entry with no `tableYear` (the legacy ids never had one) reads as the
 * tables' year. The saved data is never rewritten here.
 */
import type { CreditEntry } from "@/lib/schemas";
import {
  LEGACY_EXAM_IDS,
  type CollegeExamTable,
  type CreditCollege,
  type ExamAward,
  type ExamDef,
  type ExamTables,
  type ResolvedCredit,
} from "./types";

/** The family prefix in a display name: "AP", "IB", "A-Level", or the
 *  national table's name for the smaller international tables. */
export function familyPrefix(def: ExamDef): string {
  switch (def.family) {
    case "ap":
      return "AP";
    case "ib":
      return "IB";
    case "alevel":
      return "A-Level";
    case "intl":
      return def.group?.trim() || "International";
  }
}

/** "AP Calculus BC (5)". */
export function examDisplayName(def: ExamDef, score: string): string {
  return `${familyPrefix(def)} ${def.name} (${score})`;
}

function findExam(tables: ExamTables, exam: string): ExamDef | undefined {
  return tables.exams.find((e) => e.id === exam);
}

function findAward(table: CollegeExamTable | undefined, exam: string, score: string): ExamAward | null {
  return table?.awards.find((a) => a.exam === exam && a.scores.includes(score)) ?? null;
}

/** The award one exam at one score earns in a college, with every limit that
 *  applies (the award's own, then the college's), or null (earns nothing). */
function lookup(
  exam: string,
  score: string,
  college: CreditCollege,
  tables: ExamTables
): { award: ExamAward; limits: string[] } | null {
  let award: ExamAward | null;
  let collegeLimits: string[] = [];
  if (college === "engineering") {
    // Engineering's own full table: an exam it doesn't list earns nothing.
    award = findAward(tables.engineering, exam, score);
    collegeLimits = tables.engineering.collegeLimits ?? [];
  } else if (college === "cas" || college === "cals") {
    const override = tables.overrides[college];
    award =
      override && (override.replaces ?? []).includes(exam)
        ? findAward(override, exam, score)
        : findAward(tables.university, exam, score);
    collegeLimits = override?.collegeLimits ?? [];
  } else {
    award = findAward(tables.university, exam, score);
  }
  if (award == null) return null;
  return { award, limits: [...(award.limits ?? []), ...collegeLimits] };
}

/**
 * Per-course credits summing to `credits`. Cornell's stated figures are kept;
 * courses it gives none for share what is left. The share is spread EVENLY in
 * whole credits, any remainder going to the first such course (8 credits over
 * a lecture and a lab → 4 + 4; 5 over two → 3 + 2), so an exam granting a
 * lecture and a lab never counts its total twice in a match pool. No courses →
 * undefined (credits only).
 */
export function spreadCredits(
  courses: readonly string[],
  credits: number,
  stated?: Record<string, number>
): Record<string, number> | undefined {
  if (courses.length === 0) return undefined;
  const out: Record<string, number> = {};
  const open: string[] = [];
  let left = credits;
  for (const id of courses) {
    const given = stated?.[id];
    if (given != null && Number.isFinite(given)) {
      out[id] = given;
      left -= given;
    } else open.push(id);
  }
  if (open.length > 0) {
    const share = Math.max(0, left);
    const each = Math.floor(share / open.length);
    open.forEach((id, i) => {
      out[id] = i === 0 ? share - each * (open.length - 1) : each;
    });
  }
  return out;
}

/** "X or Y" awards (courseOptions): each option is a whole grant, so its
 *  courses share the full total among themselves (spreadCredits per set);
 *  the per-course figures then sum to `credits` within any ONE option. */
function optionCredits(
  options: string[][],
  credits: number,
  stated?: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const set of options) Object.assign(out, spreadCredits(set, credits, stated));
  return out;
}

function unresolved(entry: CreditEntry): ResolvedCredit {
  return { ...entry, source: { kind: "unresolved" }, limits: [], earnsNothing: false };
}

/** The exam and score an entry stands for: its own fields, else the legacy
 *  id map. null → not an exam entry. */
function examOf(entry: CreditEntry): { exam: string; score: string | undefined } | null {
  if (typeof entry.exam === "string" && entry.exam !== "") return { exam: entry.exam, score: entry.score };
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_EXAM_IDS, entry.id) ? LEGACY_EXAM_IDS[entry.id] : undefined;
  return legacy ? { exam: legacy.exam, score: legacy.score } : null;
}

function resolveEntry(entry: CreditEntry, college: CreditCollege, tables: ExamTables | null): ResolvedCredit {
  const ex = examOf(entry);
  if (ex == null) {
    if (entry.kind === "transfer") {
      return { ...entry, source: { kind: "transfer" }, limits: [], earnsNothing: false };
    }
    return unresolved(entry);
  }
  if (tables == null || ex.score == null || ex.score === "") return unresolved(entry);
  const tableYear = entry.tableYear ?? tables.year;
  if (tableYear !== tables.year) return unresolved(entry);
  const def = findExam(tables, ex.exam);
  if (def == null || !def.scale.includes(ex.score)) return unresolved(entry);

  const displayName = examDisplayName(def, ex.score);
  const hit = lookup(ex.exam, ex.score, college, tables);
  const award = hit?.award ?? null;
  const placementOnly = award?.placementOnly === true;
  // Placement out of a course grants no credit: the courses still count as
  // done for prerequisites, the total is 0.
  const credits = award == null || placementOnly ? 0 : award.credits;
  const courses = award ? [...award.courses] : [];
  const options = award?.courseOptions?.filter((set) => set.length > 0).map((set) => [...set]);
  const stated = placementOnly ? undefined : award?.courseCredits;
  const courseCredits =
    options && options.length > 0 ? optionCredits(options, credits, stated) : spreadCredits(courses, credits, stated);

  const out: ResolvedCredit = {
    ...entry,
    kind: def.family,
    label: displayName,
    satisfiesCourseIds: courses,
    credits,
    exam: ex.exam,
    score: ex.score,
    tableYear,
    source: { kind: "exam", exam: ex.exam, family: def.family, score: ex.score, tableYear, displayName },
    limits: hit ? hit.limits : [],
    earnsNothing: award == null,
  };
  if (courseCredits) out.courseCredits = courseCredits;
  if (options && options.length > 0) out.courseOptions = options;
  if (award?.courseTitles && Object.keys(award.courseTitles).length > 0) out.courseTitles = { ...award.courseTitles };
  if (award?.note) out.note = award.note;
  if (placementOnly) out.placementOnly = true;
  return out;
}

export function resolveCreditProfile(
  entries: CreditEntry[],
  college: CreditCollege,
  tables: ExamTables | null
): ResolvedCredit[] {
  return entries.map((e) => resolveEntry(e, college, tables));
}

export function examResult(
  exam: string,
  score: string,
  college: CreditCollege,
  tables: ExamTables | null
): (ExamAward & { limits: string[] }) | null {
  if (tables == null) return null;
  const def = findExam(tables, exam);
  if (def == null || !def.scale.includes(score)) return null;
  const hit = lookup(exam, score, college, tables);
  if (hit == null) return null;
  return { ...hit.award, courses: [...hit.award.courses], scores: [...hit.award.scores], limits: hit.limits };
}

/** Does an award earn the student anything (credit, a course, placement, or
 *  a department decision its note explains)? */
function earns(a: ExamAward): boolean {
  return a.credits > 0 || a.courses.length > 0 || a.placementOnly === true || (a.note?.trim() ?? "") !== "";
}

export function scoresThatEarn(exam: string, tables: ExamTables | null): string[] {
  if (tables == null) return [];
  const def = findExam(tables, exam);
  if (def == null) return [];
  const earning = new Set<string>();
  const tablesInPlay: (CollegeExamTable | undefined)[] = [
    tables.university,
    tables.overrides.cas,
    tables.overrides.cals,
    tables.engineering,
  ];
  for (const t of tablesInPlay) {
    for (const a of t?.awards ?? []) {
      if (a.exam === exam && earns(a)) for (const s of a.scores) earning.add(s);
    }
  }
  // The scale is lowest first; a score not on the scale is never offered.
  return def.scale.filter((s) => earning.has(s));
}
