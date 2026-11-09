import type { Program } from "@/types/db";
import type { ProgramData } from "@/contexts/ProgramProvider";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import { assign, programToRequirements, type Assignment, type MatchCourse } from "./majorMatch";
import { buildMatchPool, programSlotsToMatchInput, type PoolCreditEntry } from "./matchAdapters";
import { applyLiberalStudies, liberalStudiesCohort, liberalStudiesShortfall } from "./liberalStudies";
import { enteringYearForEntryTerm } from "./entryTerm";
import {
  isDistributionFamily,
  programCollegeId,
  programFamily,
  programIsVisible,
  type CollegeId,
} from "./colleges";
import { selectLayers, solve } from "./distribution";
import { applyCourseMarks } from "./questions/applyCourseMarks";
import { markKey, questionRef } from "./questions/keys";
import type { Answers, DistCourse, Layer, MarkValue, Row, RowResult, StudentContext } from "./distribution/types";

/**
 * rankMajors.ts (spec 019 D3, spec 011 §1) — Major Match's ranking, pure.
 * The hook (useMajorMatch) loads data and memoizes; every decision is here.
 *
 * Scope (D3): only majors in the student's own college are ranked. The college
 * is the current plan's major's; on the blank canvas, the student's saved one;
 * failing both, nothing is ranked and the panel asks for a college. Hidden
 * majors and the blank canvas are never ranked.
 *
 * Engines: Engineering-family programs run `assign()` over their slots,
 * with the liberal studies pool then judged by its group rules (spec 037,
 * applyLiberalStudies), as on the Requirements panel. Arts & Sciences / CALS programs run the Distribution engine over
 * their MAJOR layer only: every major of a college shares the same college
 * rows, so solving them would add the same amount to every major and cost a
 * full college solve per major (~45 in Arts & Sciences). The percent is the
 * engine's own: the mean share of each major row done.
 *
 * Answers (spec 020 D7): every answer that applies is used — facts for every
 * major, a course mark wherever the same question is asked (a question's key
 * carries the asking layer's id, not the program's, so a college question's
 * mark applies to every major in the college and a major's own mark only to
 * that major). Credit marks from the college and major layers set course
 * credits (applyCourseMarks). A college "usedAs" yes pins the course to an
 * exclusive college row, where it counts and nowhere else; the major-only
 * solve honours that by leaving the pinned course out of the major's pool,
 * as the full solve on the Requirements panel would. Whether the college row
 * actually counts the course is the college solve's call, not the mark's (the
 * row may already be full, or waived), so one college-only solve — with the
 * answers and the plan's college waivers — decides the pinned set. It is the
 * same for every major sharing that college layer and board, so it runs once
 * per Major Match computation (RankInput.collegeCache), not once per major.
 */

/** The seeded blank "start from scratch" canvas (FirstRun's BLANK_ID). It's an
 *  on-ramp, not a major: it is never ranked. */
export const BLANK_PROGRAM_ID = "blank";

/** A still-needed requirement. Engineering rows always know their credits;
 *  Distribution rows say what they know (courses or credits short), and
 *  `unchecked` marks a row the engine couldn't prove either way. */
export type MajorMatchMissing = {
  requirementId: string;
  label: string;
  credits?: number;
  courses?: number;
  reason?: "no-data" | "unchecked";
  /** What else the requirement needs, in a few words, when its courses are
   *  all there: liberal studies' group rules ("needs 1 more group, Race &
   *  Equity", spec 037). */
  detail?: string;
};

export type MajorMatch = {
  program: Program;
  /** Which engine scored it: "engineering" = credit-weighted assign();
   *  "distribution" = the share of the major's rows done (no credit target). */
  engine: "engineering" | "distribution";
  /** 0–100. */
  pct: number;
  /** Credits of the plan's courses that count toward the major. */
  creditsSatisfied: number;
  /** Engineering only: the major's credit target. 0 for Distribution majors,
   *  which have no single credit total to show. */
  creditsRequired: number;
  /** Distribution only: major rows not yet met. */
  requirementsLeft?: number;
  /** Distribution only: the track the major was scored on, when its own layer
   *  has no countable requirements and they all live in its tracks. */
  track?: string;
  /** Each counted course, resolved to display + the requirement label it fills. */
  matched: {
    courseId: string;
    code: string;
    title: string;
    requirementId: string;
    requirementLabel: string;
    credits: number;
  }[];
  missing: MajorMatchMissing[];
  /** Courses on the plan that DON'T count toward this program, with why. */
  uncounted: {
    courseId: string;
    code: string;
    title: string;
    credits: number;
    reason: Assignment["uncounted"][number]["reason"];
  }[];
};

export type CourseDisplay = Map<string, { code: string; title: string; credits: number }>;

/** The college Major Match ranks within (D3), or null → ask the student.
 *  The current plan's major decides it when it has a college (D11: "taken
 *  from the selected major"), so a plan switched in from another college never
 *  ranks against a stale saved college; the saved college covers the blank
 *  canvas, which has none. */
export function matchCollege(
  studentCollege: CollegeId | null,
  currentProgram: Program | null | undefined
): CollegeId | null {
  return programCollegeId(currentProgram) ?? studentCollege;
}

/** The programs ranked for a college: visible, not the blank, in the college. */
export function programsInScope(programs: Program[], college: CollegeId | null): Program[] {
  if (!college) return [];
  return programs.filter(
    (p) => p.id !== BLANK_PROGRAM_ID && programIsVisible(p) && programCollegeId(p) === college
  );
}

/**
 * The course pool Engineering majors are ranked on, built the way the
 * Requirements panel builds it (computeRequirementProgress): placed courses
 * dated by the board's entering year (the entering year, else the entry
 * term's), so a liberal studies petition limited to "Summer 2024 and prior"
 * applies to an early placement; credit courses with a real catalog id carry
 * that course's roster tags (spec 037 D3, D4).
 */
export function engineeringMatchPool(input: {
  placements: Placement[];
  placedCourses: Record<string, Course>;
  creditProfile: readonly PoolCreditEntry[];
  aliases?: Record<string, string>;
  entryTerm?: string | null;
  enteringYear?: number | null;
  catalogAttrs?: (id: string) => readonly string[] | undefined;
  courseMarks?: Readonly<Record<string, MarkValue>>;
}): DistCourse[] {
  const boardYear = input.enteringYear ?? enteringYearForEntryTerm(input.entryTerm);
  return buildMatchPool({
    placements: input.placements,
    placedCourses: input.placedCourses,
    creditProfile: input.creditProfile,
    ...(input.aliases ? { aliases: input.aliases } : {}),
    ...(boardYear != null ? { enteringYear: boardYear } : {}),
    ...(input.catalogAttrs ? { catalogAttrs: input.catalogAttrs } : {}),
    ...(input.courseMarks ? { courseMarks: input.courseMarks } : {}),
  });
}

/** canonical id → student-facing display (first occurrence wins). */
export function buildCourseDisplay(pool: MatchCourse[], canonical: (id: string) => string): CourseDisplay {
  const map: CourseDisplay = new Map();
  for (const c of pool) {
    const cid = canonical(c.id);
    if (map.has(cid)) continue;
    const code = `${c.subject} ${c.number}`.trim();
    map.set(cid, { code, title: c.title ?? code, credits: c.credits });
  }
  return map;
}

type RankInput = {
  pool: MatchCourse[];
  canonical: (id: string) => string;
  display: CourseDisplay;
  /** Distribution majors: the pool built with full catalog docs (a fixed
   *  0-credit course counts 0); defaults to `pool`. */
  distPool?: MatchCourse[];
  /** Distribution majors: the student's start answers, so a row with
   *  `appliesTo` (e.g. "non-transfers only") is solved as the panel solves it. */
  ctx?: Pick<StudentContext, "entryTerm" | "transfer" | "transferStanding">;
  /** Engineering majors: the student's entering year, which with
   *  `ctx.entryTerm` picks the liberal studies rules (spec 037 D8). */
  enteringYear?: number | null;
  /** Spec 020 D7: the student's answers (facts from the profile, marks from
   *  the current plan). Absent → the strict reading. */
  answers?: Answers;
  /** The plan's waived requirement ids (`${layerId}:${rowId}`). Only the
   *  college layer's matter here: a waived college row pins nothing. */
  waived?: string[];
  /** Pinned-course sets from the college solve, shared across the majors of
   *  ONE computation (same pool, answers, context and waivers). Create a
   *  fresh map per computation; absent → no sharing. */
  collegeCache?: Map<string, Set<string>>;
};

function shown(courseId: string, display: CourseDisplay) {
  const d = display.get(courseId);
  return { code: d?.code ?? courseId.replace(/-/g, " "), title: d?.title ?? "", credits: d?.credits ?? 0 };
}

function uncountedOf(
  rows: { courseId: string; reason: MajorMatch["uncounted"][number]["reason"] }[],
  display: CourseDisplay
): MajorMatch["uncounted"] {
  return rows.map((u) => {
    const d = shown(u.courseId, display);
    return { courseId: u.courseId, code: d.code, title: d.title, credits: d.credits, reason: u.reason };
  });
}

function rankEngineering(program: Program, data: ProgramData, input: RankInput): MajorMatch {
  const requirements = programToRequirements(programSlotsToMatchInput(data.slots));
  const reqLabelById = new Map(requirements.map((r) => [r.id, r.label]));
  const { cohort, olderPolicy } = liberalStudiesCohort(input.ctx?.entryTerm, input.enteringYear);
  const matcher = assign(input.pool, requirements, input.canonical, { liberalStudiesCohort: cohort });
  const ls = applyLiberalStudies({
    courses: input.pool,
    requirements,
    assignment: matcher,
    canonical: input.canonical,
    cohort,
    olderPolicy,
  });
  const result = ls?.assignment ?? matcher;
  const lsDetail = ls ? liberalStudiesShortfall(ls) : null;
  return {
    program,
    engine: "engineering",
    pct: result.pct,
    creditsSatisfied: result.creditsSatisfied,
    creditsRequired: result.creditsRequired,
    matched: result.matched.map((m) => {
      const d = shown(m.courseId, input.display);
      return {
        courseId: m.courseId,
        code: d.code,
        title: d.title,
        requirementId: m.requirementId,
        requirementLabel: reqLabelById.get(m.requirementId) ?? "Requirement",
        credits: m.credits,
      };
    }),
    missing: result.missing.map((m) =>
      lsDetail && ls && m.requirementId === ls.requirementId ? { ...m, detail: lsDetail } : m
    ),
    uncounted: uncountedOf(result.uncounted, input.display),
  };
}

/** A row not met, as a still-needed line: courses or credits short when the
 *  row knows them; nothing invented when it doesn't. */
function missingOf(row: RowResult): MajorMatchMissing {
  const p = row.progress;
  const short = (need?: number, have?: number) =>
    need != null && need - (have ?? 0) > 0 ? need - (have ?? 0) : undefined;
  return {
    requirementId: row.rowId,
    label: row.label,
    courses: short(p.coursesNeed, p.coursesHave),
    credits: short(p.creditsNeed, p.creditsHave),
    ...(row.status === "unchecked" ? { reason: "unchecked" as const } : {}),
  };
}

/** Null when the program's major layer didn't load (the loader drops a layer
 *  that fails its schema or lint) — such a major can't be scored. */
/** The college layer selectLayers picks for the student, when it is certain
 *  (null while a start answer it needs is missing, or none loaded). */
function studentCollege(data: ProgramData, major: Layer, input: RankInput): Layer | null {
  const picked = selectLayers(data.layers ?? [], {
    family: major.family,
    programId: major.programId ?? "",
    entryTerm: input.ctx?.entryTerm,
    transfer: input.ctx?.transfer,
    transferStanding: input.ctx?.transferStanding,
  });
  return picked.layers.find((l) => l.kind === "college") ?? null;
}

/** Does any rule in the layer read the student's program (a `program`
 *  leaf)? Then its solve depends on the major, not only on the board. */
const readsProgramMemo = new WeakMap<Layer, boolean>();
function layerReadsProgram(layer: Layer): boolean {
  const memo = readsProgramMemo.get(layer);
  if (memo != null) return memo;
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(walk);
    if (v == null || typeof v !== "object") return false;
    if (Array.isArray((v as { program?: unknown }).program)) return true;
    return Object.values(v).some(walk);
  };
  const reads = walk(layer.rows);
  readsProgramMemo.set(layer, reads);
  return reads;
}

/**
 * Courses a college "usedAs" yes pins to an exclusive college row (canonical
 * ids): they count there and nowhere else (spec 020 D9). A course is pinned
 * only when the college solve — with the student's answers and college
 * waivers — counts it on the question's target row (or that option's anyOf
 * parent), exactly as the full solve on the Requirements panel would. No
 * usedAs yes on the board → no solve.
 */
function pinnedToCollege(
  college: Layer,
  programId: string,
  courses: DistCourse[],
  answers: Answers,
  input: RankInput
): Set<string> {
  const canonical = input.canonical;
  // usedAs questions with a "yes" on a board course: ref → top-level target row.
  const parentOf = new Map<string, Row>();
  for (const r of college.rows) if (r.kind === "anyOf") for (const c of r.rows) parentOf.set(c.id, r);
  const wanted: { cid: string; topRowId: string }[] = [];
  for (const q of college.questions ?? []) {
    if (q.type !== "usedAs") continue;
    const top = parentOf.get(q.row) ?? college.rows.find((r) => r.id === q.row);
    if (top?.exclusive !== true) continue;
    const ref = questionRef(college.id, q);
    for (const c of courses) {
      const cid = canonical(c.id);
      if (answers.marks[markKey(ref, cid)] === "yes") wanted.push({ cid, topRowId: top.id });
    }
  }
  if (wanted.length === 0) return new Set();

  const cacheKey = [
    college.id,
    layerReadsProgram(college) ? programId : "",
    courses.map((c) => `${canonical(c.id)}:${c.credits}`).join(","),
  ].join("|");
  const hit = input.collegeCache?.get(cacheKey);
  if (hit) return hit;

  const waived = (input.waived ?? []).filter((id) => id.startsWith(`${college.id}:`));
  const result = solve({
    layers: [college],
    courses,
    ctx: { programId, ...input.ctx },
    canonical,
    answers,
    ...(waived.length > 0 ? { waived } : {}),
  });
  const pinned = new Set<string>();
  for (const { cid, topRowId } of wanted) {
    if ((result.attribution[cid] ?? []).some((a) => a.layerId === college.id && a.rowId === topRowId)) pinned.add(cid);
  }
  input.collegeCache?.set(cacheKey, pinned);
  return pinned;
}

/** The major's pool with the student's answers applied (see the module
 *  comment). No answers → the pool as given, untouched. */
function answeredPool(data: ProgramData, major: Layer, input: RankInput): MatchCourse[] {
  const base = input.distPool ?? input.pool;
  const answers = input.answers;
  if (!answers || Object.keys(answers.marks).length === 0) return base;
  const college = studentCollege(data, major, input);
  const layers = college ? [college, major] : [major];
  let courses = applyCourseMarks(base as DistCourse[], layers, answers.marks, input.canonical);
  if (college) {
    const pinned = pinnedToCollege(college, major.programId ?? "", courses, answers, input);
    if (pinned.size > 0) courses = courses.filter((c) => !pinned.has(input.canonical(c.id)));
  }
  return courses;
}

function rankDistribution(program: Program, data: ProgramData, input: RankInput): MajorMatch | null {
  const major = data.layers?.find((l) => l.kind === "major" && l.programId === program.id);
  if (!major) return null;
  // A major whose own layer has nothing countable (Classics: every requirement
  // is in the track the student picks) is scored on the track the plan fits
  // best, so it still shows how much is left. Every other major is scored on
  // its own layer, as before.
  // A track the app can't check at all (every row advisor-confirmed) is left
  // out: with nothing to count it would always have "nothing left".
  const checkable = (l: Layer) => l.rows.some((r) => r.kind !== "confirm");
  const tracks = checkable(major)
    ? []
    : (data.layers ?? []).filter((l) => l.kind === "concentration" && l.programId === program.id && checkable(l));
  if (tracks.length === 0) return scoreLayers(program, data, major, [major], input);
  const scored = tracks
    .map((t) => ({ ...scoreLayers(program, data, major, [major, t], input), track: trackName(t.name) }))
    .sort(
      (a, b) =>
        b.pct - a.pct ||
        (a.requirementsLeft ?? 0) - (b.requirementsLeft ?? 0) ||
        a.track.localeCompare(b.track)
    );
  return scored[0];
}

/** A track layer's name as Major Match shows it: "Classics (BA): Latin track"
 *  → "Latin" (the row already names the major). */
function trackName(name: string): string {
  const short = name.includes(": ") ? name.slice(name.indexOf(": ") + 2) : name;
  return short.replace(/\s+track$/i, "").trim() || name;
}

/** Solve these layers for the major and shape the result as a match. */
function scoreLayers(
  program: Program,
  data: ProgramData,
  major: Layer,
  layers: Layer[],
  input: RankInput
): MajorMatch {
  const result = solve({
    layers,
    courses: answeredPool(data, major, input),
    ctx: { programId: program.id, ...input.ctx },
    canonical: input.canonical,
    ...(input.answers ? { answers: input.answers } : {}),
  });
  const rows = result.layers.flatMap((l) => l.rows);

  const matched: MajorMatch["matched"] = [];
  const countedCredits = new Map<string, number>();
  for (const row of rows) {
    for (const c of row.courses) {
      const d = shown(c.courseId, input.display);
      matched.push({
        courseId: c.courseId,
        code: d.code,
        title: d.title,
        requirementId: row.rowId,
        requirementLabel: row.label,
        credits: c.credits,
      });
      // A course an overlay row also counts adds its credits once.
      countedCredits.set(c.courseId, Math.max(countedCredits.get(c.courseId) ?? 0, c.credits));
    }
  }
  const missing = rows
    .filter((r) => r.status === "unmet" || r.status === "partial" || r.status === "unchecked")
    .map(missingOf);

  return {
    program,
    engine: "distribution",
    pct: result.pct,
    creditsSatisfied: [...countedCredits.values()].reduce((a, b) => a + b, 0),
    creditsRequired: 0,
    requirementsLeft: missing.length,
    matched,
    missing,
    uncounted: uncountedOf(
      result.uncounted.map((courseId) => ({ courseId, reason: "no-requirement-matched" as const })),
      input.display
    ),
  };
}

/** One program's match, by its engine family. Null → it can't be scored. */
export function rankProgram(program: Program, data: ProgramData, input: RankInput): MajorMatch | null {
  return isDistributionFamily(programFamily(program))
    ? rankDistribution(program, data, input)
    : rankEngineering(program, data, input);
}

/** Ranked by fit, then name. No program bias anywhere (spec 011 C6). */
export function sortMatches(matches: MajorMatch[]): MajorMatch[] {
  return [...matches].sort((a, b) => b.pct - a.pct || a.program.name.localeCompare(b.program.name));
}

/** Rank every in-scope program whose data is loaded. */
export function rankMajors(input: {
  programs: Program[];
  college: CollegeId | null;
  getData: (id: string) => ProgramData | undefined;
  pool: MatchCourse[];
  canonical: (id: string) => string;
  answers?: Answers;
  waived?: string[];
}): MajorMatch[] {
  const display = buildCourseDisplay(input.pool, input.canonical);
  const collegeCache = new Map<string, Set<string>>();
  const out: MajorMatch[] = [];
  for (const program of programsInScope(input.programs, input.college)) {
    const data = input.getData(program.id);
    if (!data) continue;
    const m = rankProgram(program, data, {
      pool: input.pool,
      canonical: input.canonical,
      display,
      collegeCache,
      ...(input.answers ? { answers: input.answers } : {}),
      ...(input.waived ? { waived: input.waived } : {}),
    });
    if (m) out.push(m);
  }
  return sortMatches(out);
}
