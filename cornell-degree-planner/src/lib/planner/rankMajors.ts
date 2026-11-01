import type { Program } from "@/types/db";
import type { ProgramData } from "@/contexts/ProgramProvider";
import { assign, programToRequirements, type Assignment, type MatchCourse } from "./majorMatch";
import { programSlotsToMatchInput } from "./matchAdapters";
import {
  isDistributionFamily,
  programCollegeId,
  programFamily,
  programIsVisible,
  type CollegeId,
} from "./colleges";
import { selectLayers, solve } from "./distribution";
import { courseMatchesRule } from "./distribution/rules";
import { applyCourseMarks } from "./questions/applyCourseMarks";
import { markKey, questionRef } from "./questions/keys";
import type { Answers, DistCourse, Layer, RowResult, StudentContext } from "./distribution/types";

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
 * unchanged. Arts & Sciences / CALS programs run the Distribution engine over
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
 * as the full solve on the Requirements panel would.
 *
 * Info Science and Communication are CALS majors still on the Engineering
 * engine until their CALS layers exist (spec 019 Phase 5): they rank with the
 * other CALS majors but are scored by `assign()`. Transient by design.
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
  /** Spec 020 D7: the student's answers (facts from the profile, marks from
   *  the current plan). Absent → the strict reading. */
  answers?: Answers;
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
  const result = assign(input.pool, requirements, input.canonical);
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
    missing: result.missing,
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

/** Courses a college "usedAs" yes pins to an exclusive college row (canonical
 *  ids): they count there and nowhere else (spec 020 D9). */
function pinnedToCollege(college: Layer, courses: DistCourse[], answers: Answers, canonical: (id: string) => string): Set<string> {
  const pinned = new Set<string>();
  for (const q of college.questions ?? []) {
    if (q.type !== "usedAs") continue;
    if (college.rows.find((r) => r.id === q.row)?.exclusive !== true) continue;
    const ref = questionRef(college.id, q);
    for (const c of courses) {
      const cid = canonical(c.id);
      if (answers.marks[markKey(ref, cid)] !== "yes") continue;
      if (courseMatchesRule(c, q.courses, { canonical, answers })) pinned.add(cid);
    }
  }
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
    const pinned = pinnedToCollege(college, courses, answers, input.canonical);
    if (pinned.size > 0) courses = courses.filter((c) => !pinned.has(input.canonical(c.id)));
  }
  return courses;
}

function rankDistribution(program: Program, data: ProgramData, input: RankInput): MajorMatch | null {
  const major = data.layers?.find((l) => l.kind === "major" && l.programId === program.id);
  if (!major) return null;
  const result = solve({
    layers: [major],
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
}): MajorMatch[] {
  const display = buildCourseDisplay(input.pool, input.canonical);
  const out: MajorMatch[] = [];
  for (const program of programsInScope(input.programs, input.college)) {
    const data = input.getData(program.id);
    if (!data) continue;
    const m = rankProgram(program, data, {
      pool: input.pool,
      canonical: input.canonical,
      display,
      ...(input.answers ? { answers: input.answers } : {}),
    });
    if (m) out.push(m);
  }
  return sortMatches(out);
}
