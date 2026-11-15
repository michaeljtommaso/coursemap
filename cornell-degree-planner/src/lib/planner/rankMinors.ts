import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { MatchCourse } from "./majorMatch";
import { solve } from "./distribution";
import { courseMatchesRule, type RuleContext } from "./distribution/rules";
import { appliesToStudent } from "./distribution/engine";
import {
  matchesProgramPrefix,
  overLimit,
  pairLimitWithSource,
  type OverlapProgram,
} from "./distribution/overlap";
import { countsTowardOverlap } from "./multiProgram";
import { applyCourseMarks } from "./questions/applyCourseMarks";
import { parseRef } from "./questions/keys";
import type { Answers, CourseRule, DistCourse, Layer, Row, RowResult, StudentContext } from "./distribution/types";

/**
 * rankMinors.ts (spec 047 D11) — "Minors you're close to", pure. The hook
 * (useMinorMatch in hooks/useMajorMatch.ts) loads the minor index and each
 * minor's layer; every decision is here.
 *
 * Scope: every visible minor in the index that isn't on the plan, isn't
 * `notOpenTo` the primary or second major (D12), and can be combined with
 * every program on the plan (`forbiddenWith` on either side, D14).
 *
 * Each minor's layer is solved alone against the same course pool and answers
 * Major Match uses (the board plus credit, the student's marks and facts), as
 * Major Match solves a major's layer alone.
 *
 * "Classes away" is the fewest more courses that would finish the minor's
 * rows. It FAILS CLOSED: it is a number only when every unmet row proves its
 * course count, and null otherwise, so the views show the minor's percent
 * instead of an optimistic number:
 *  - a seat row needs 1; a pool row its courses short; a distribution row the
 *    larger of its courses short and the categories it still needs;
 *  - a credit shortfall the course count can't cover at 3 credits a course, a
 *    credit-total row, a sub-limit with a minimum, a category needing two or
 *    more courses, a course that may sit in several categories, an overlay
 *    row (a new course could fill it and another row at once), an anyOf
 *    option that isn't proven, a row the engine couldn't check: not proven;
 *  - an overlap limit with a program on the plan (D7) that the minor's
 *    counted courses could break if every one were shared: not proven (the
 *    full solve could hold some back);
 *  - a counted course the student said is used as a requirement elsewhere
 *    (a "usedAs" yes on another layer's question): not proven (an exclusive
 *    row elsewhere may keep it);
 *  - a counted course an `exclusive` row of the plan's other layers (the
 *    college's FWS pool, a program's exclusive row) could take: not proven.
 *    The full solve runs exclusive rows first across every layer, so such a
 *    row may keep the course from the minor; this doesn't try to solve that
 *    exactly, it only refuses to promise a count;
 *  - a minor with nothing countable: not proven.
 */

export type MinorPlan = {
  primaryId: string;
  additional: readonly AdditionalProgram[];
};

/** Why a minor's count isn't proven (tests and debugging). */
export type InexactReason =
  | "unchecked"
  | "credits"
  | "limits"
  | "categories"
  | "overlay"
  | "overlap"
  | "used-elsewhere"
  | "exclusive-elsewhere"
  | "nothing-countable"
  | "plan-unknown";

export type MinorMatch = {
  entry: MinorIndexEntry;
  /** 0–100, the engine's own: the mean share of each scored row done. */
  pct: number;
  /** The fewest more courses that finish the minor, or null when the engine
   *  can't prove it (show `pct` instead). 0 = every requirement met. */
  classesAway: number | null;
  /** Set when `classesAway` is null. */
  inexact?: InexactReason[];
  /** Rows not yet met. */
  requirementsLeft: number;
};

/** "Close" (the panel's top two): a proven count of at most this many. */
export const CLOSE_CLASSES = 3;

/** The program-id prefixes on the plan that `notOpenTo` is matched against:
 *  the primary and a second major (D12: "Not open to <major> majors"). */
function majorsOnPlan(plan: MinorPlan): string[] {
  return [plan.primaryId, ...plan.additional.filter((p) => p.kind === "major").map((p) => p.programId)];
}

/**
 * The minors worth loading: visible, not on the plan, open to the plan's
 * majors, and not named in any plan program's `forbiddenWith` (known before
 * the minor's own layer loads). The minor's own `forbiddenWith` is checked
 * once its layer is in (rankMinor).
 */
export function minorCandidates(
  entries: readonly MinorIndexEntry[],
  plan: MinorPlan,
  planPrograms: readonly OverlapProgram[] = []
): MinorIndexEntry[] {
  const onPlan = new Set([plan.primaryId, ...plan.additional.map((p) => p.programId)]);
  const majors = majorsOnPlan(plan);
  return entries.filter(
    (e) =>
      e.visible !== false &&
      !onPlan.has(e.id) &&
      !majors.some((m) => matchesProgramPrefix(m, e.notOpenTo)) &&
      !planPrograms.some((p) => matchesProgramPrefix(e.id, p.forbiddenWith))
  );
}

export type MinorRankInput = {
  /** Major Match's Distribution pool (full catalog docs, credit included). */
  pool: MatchCourse[];
  canonical: (id: string) => string;
  ctx?: Pick<StudentContext, "entryTerm" | "transfer" | "transferStanding">;
  plan: MinorPlan;
  answers?: Answers;
  /** The plan's waived requirement ids; only this minor's apply (a minor
   *  removed and re-added keeps its waivers, D10). */
  waived?: readonly string[];
  /** Every program on the plan, as the overlap check sees it (D7). */
  planPrograms: readonly OverlapProgram[];
  /** False while a program on the plan has no known sharing (its layers
   *  didn't load): no count is proven. */
  planKnown: boolean;
  /** The plan's other layers, whose credit marks (creditsTaken,
   *  sequenceDone) the full solve would also apply, and whose `exclusive`
   *  rows could take a course before the minor sees it. */
  markLayers?: readonly Layer[];
};

type Count = { n: number; exact: boolean; reason?: InexactReason };

const proven = (n: number): Count => ({ n, exact: true });
const estimate = (n: number, reason: InexactReason): Count => ({ n, exact: false, reason });

const short = (need?: number, have?: number) => Math.max(0, (need ?? 0) - (have ?? 0));
const hasMinLimit = (limits: readonly { minCourses?: number; minCredits?: number }[] | undefined) =>
  (limits ?? []).some((l) => (l.minCourses ?? 0) > 0 || (l.minCredits ?? 0) > 0);

/** Assumed credits per new course: a credit shortfall within this many per
 *  counted-short course is covered by those courses. */
const CREDITS_PER_COURSE = 3;

/** One unmet row's count (anyOf children included). */
function unmetCount(def: Exclude<Row, { kind: "confirm" }>, res: RowResult, ctx: StudentContext): Count {
  const p = res.progress;
  switch (def.kind) {
    case "seat":
      return proven(1);
    case "credits":
      return estimate(Math.max(1, Math.ceil(short(p.creditsNeed, p.creditsHave) / CREDITS_PER_COURSE)), "credits");
    case "pool": {
      const k = short(p.coursesNeed, p.coursesHave);
      const c = short(p.creditsNeed, p.creditsHave);
      const n = Math.max(1, k, Math.ceil(c / CREDITS_PER_COURSE));
      if (hasMinLimit(def.limits)) return estimate(n, "limits");
      // Courses already there: what's short is credits or a sub-limit.
      if (k === 0) return estimate(n, c > 0 ? "credits" : "limits");
      if (c > k * CREDITS_PER_COURSE) return estimate(n, "credits");
      return proven(k);
    }
    case "distribution": {
      const k = short(p.coursesNeed, p.coursesHave);
      const c = short(p.creditsNeed, p.creditsHave);
      const covered = new Set(p.categoriesHave ?? []);
      const distinctShort = short(p.categoriesNeed, covered.size);
      // Categories with a minimum of one still empty.
      const minOne = def.categories.filter(
        (cat) => (def.perCategory?.[cat.id]?.min ?? 0) >= 1 && !covered.has(cat.id)
      ).length;
      const need = Math.max(k, distinctShort, minOne);
      const n = Math.max(1, need, Math.ceil(c / CREDITS_PER_COURSE));
      if (hasMinLimit(def.limits)) return estimate(n, "limits");
      const perCat = Object.values(def.perCategory ?? {});
      if (perCat.some((pc) => (pc.min ?? 0) > 1 || (pc.minCredits ?? 0) > 0)) return estimate(n, "categories");
      if ((def.maxCategoriesPerCourse ?? 1) > 1) return estimate(n, "categories");
      if (need === 0) return estimate(n, "categories");
      if (c > need * CREDITS_PER_COURSE) return estimate(n, "credits");
      return proven(need);
    }
    case "anyOf": {
      const kids: Count[] = [];
      def.rows.forEach((child, i) => {
        if (!appliesToStudent(child.appliesTo, ctx)) return; // can't count for this student
        const kr = res.children?.[i];
        if (!kr) {
          kids.push(estimate(1, "unchecked"));
          return;
        }
        kids.push(rowCount(child, kr, ctx));
      });
      if (kids.length === 0) return estimate(1, "unchecked");
      const n = Math.min(...kids.map((k) => k.n));
      const bad = kids.find((k) => !k.exact);
      return bad ? estimate(n, bad.reason ?? "unchecked") : proven(n);
    }
  }
}

function rowCount(def: Row, res: RowResult, ctx: StudentContext): Count {
  switch (res.status) {
    case "met":
    case "waived":
    case "confirm":
      return proven(0);
    case "unchecked":
      return estimate(1, "unchecked");
    default: {
      if (def.kind === "confirm") return proven(0);
      const count = unmetCount(def, res, ctx);
      // An overlay row sees every course: a new course could fill it and a
      // consuming row at once, so the sum may overcount. Credits rows are
      // overlay too but already report "credits".
      if (count.exact && def.overlay) return estimate(count.n, "overlay");
      return count;
    }
  }
}

/** Canonical ids of courses a "usedAs" yes points at a row in another layer. */
function usedElsewhere(answers: Answers | undefined, layerId: string, canonical: (id: string) => string): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(answers?.marks ?? {})) {
    if (value !== "yes") continue;
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const ref = parseRef(key.slice(0, at));
    if (ref?.type !== "usedAs" || ref.layerId === layerId) continue;
    out.add(canonical(key.slice(at + 1)));
  }
  return out;
}

/** The rules of a row's `exclusive` parts that could take a course: an
 *  exclusive seat / pool / credits row's rule; an exclusive distribution row's
 *  categories (each with its eligibility rule); inside an anyOf, an exclusive
 *  option (or every option of an exclusive anyOf). Read broadly: a course any
 *  of them matches might be taken. */
function exclusiveRules(row: Row, inherited: boolean, out: CourseRule[][]): void {
  const exclusive = inherited || row.exclusive === true;
  switch (row.kind) {
    case "seat":
    case "pool":
    case "credits":
      if (exclusive) out.push([row.rule]);
      return;
    case "distribution":
      if (!exclusive) return;
      if (row.categories.length === 0 && row.rule) out.push([row.rule]);
      for (const c of row.categories) out.push(row.rule ? [row.rule, c.rule] : [c.rule]);
      return;
    case "anyOf":
      for (const child of row.rows) exclusiveRules(child, exclusive, out);
      return;
    case "confirm":
      return;
  }
}

/** Canonical ids of the minor's counted courses that an exclusive row of the
 *  plan's other layers matches. */
function takenByExclusive(
  layers: readonly Layer[],
  counted: Iterable<string>,
  courseOf: ReadonlyMap<string, DistCourse>,
  ctx: RuleContext
): string[] {
  const rules: CourseRule[][] = [];
  for (const l of layers) for (const r of l.rows) exclusiveRules(r, false, rules);
  if (rules.length === 0) return [];
  const out: string[] = [];
  for (const cid of counted) {
    const course = courseOf.get(cid);
    // A counted course we can't read: assume it could be taken (fail closed).
    if (!course || rules.some((all) => all.every((rule) => courseMatchesRule(course, rule, ctx)))) out.push(cid);
  }
  return out;
}

/**
 * One minor, solved alone against the board. Null when it can't join this
 * plan (a `forbiddenWith` pair, D14) — such a minor isn't listed.
 */
export function rankMinor(entry: MinorIndexEntry, layer: Layer, input: MinorRankInput): MinorMatch | null {
  const cand: OverlapProgram = {
    id: entry.id,
    kind: "minor",
    layerIds: [layer.id],
    ...(layer.sharing ? { sharing: layer.sharing } : {}),
    ...(layer.sharing?.forbiddenWith ? { forbiddenWith: layer.sharing.forbiddenWith } : {}),
    holdable: true,
  };
  const limits = input.planPrograms.map((p) => pairLimitWithSource(p, cand));
  if (limits.some((l) => l?.limit === "forbidden")) return null;

  const additionalProgramIds = [...input.plan.additional.map((p) => p.programId), entry.id];
  const ctx: StudentContext = { programId: input.plan.primaryId, additionalProgramIds, ...input.ctx };
  const marks = input.answers?.marks ?? {};
  const courses =
    Object.keys(marks).length > 0
      ? applyCourseMarks(input.pool as DistCourse[], [...(input.markLayers ?? []), layer], marks, input.canonical)
      : (input.pool as DistCourse[]);
  const waived = (input.waived ?? []).filter((id) => id.startsWith(`${layer.id}:`));
  const result = solve({
    layers: [layer],
    courses,
    ctx,
    canonical: input.canonical,
    ...(input.answers ? { answers: input.answers } : {}),
    ...(waived.length > 0 ? { waived } : {}),
  });

  const defs = new Map(layer.rows.map((r) => [r.id, r]));
  const rows = result.layers.flatMap((l) => l.rows);
  const reasons = new Set<InexactReason>();
  let total = 0;
  let countable = 0;
  let left = 0;
  for (const res of rows) {
    const def = defs.get(res.rowId);
    if (!def) {
      reasons.add("unchecked");
      continue;
    }
    if (def.kind !== "confirm" && res.status !== "waived") countable++;
    if (res.status === "unmet" || res.status === "partial" || res.status === "unchecked") left++;
    const c = rowCount(def, res, ctx);
    total += c.n;
    if (!c.exact) reasons.add(c.reason ?? "unchecked");
  }
  if (countable === 0) reasons.add("nothing-countable");
  if (!input.planKnown) reasons.add("plan-unknown");

  // Overlap (D7): with every counted course assumed shared, is any limit
  // with a program on the plan broken? Then the full solve may hold some
  // back and the count isn't proven.
  const counted = new Map<string, number>();
  for (const res of rows) {
    if (!countsTowardOverlap(defs.get(res.rowId))) continue;
    for (const c of res.courses) counted.set(c.courseId, Math.max(counted.get(c.courseId) ?? 0, c.credits));
  }
  const shared = [...counted.values()].map((credits) => ({ credits }));
  if (limits.some((l) => l != null && overLimit(l.limit, shared))) reasons.add("overlap");

  // An exclusive row elsewhere on the plan (the college's FWS pool) is
  // solved first in the full solve and may take a course this count relies
  // on (D11 fails closed: the percent is shown instead).
  const courseOf = new Map<string, DistCourse>();
  for (const c of courses) {
    const cid = input.canonical(c.id);
    if (!courseOf.has(cid)) courseOf.set(cid, c);
  }
  const reliedOn = new Set(rows.flatMap((r) => r.courses.map((c) => c.courseId)));
  const otherLayers = (input.markLayers ?? []).filter((l) => l.id !== layer.id);
  const ruleCtx: RuleContext = {
    programId: ctx.programId,
    additionalProgramIds,
    canonical: input.canonical,
    ...(input.answers ? { answers: input.answers } : {}),
  };
  if (takenByExclusive(otherLayers, reliedOn, courseOf, ruleCtx).length > 0) reasons.add("exclusive-elsewhere");

  const elsewhere = usedElsewhere(input.answers, layer.id, input.canonical);
  if (elsewhere.size > 0 && rows.some((r) => r.courses.some((c) => elsewhere.has(c.courseId)))) {
    reasons.add("used-elsewhere");
  }

  return {
    entry,
    pct: result.pct,
    classesAway: reasons.size === 0 ? total : null,
    ...(reasons.size > 0 ? { inexact: [...reasons] } : {}),
    requirementsLeft: left,
  };
}

/** Proven counts first, fewest classes first; then the rest by percent.
 *  Ties by name. No program bias. */
export function sortMinorMatches(matches: readonly MinorMatch[]): MinorMatch[] {
  return [...matches].sort((a, b) => {
    const ea = a.classesAway != null;
    const eb = b.classesAway != null;
    if (ea !== eb) return ea ? -1 : 1;
    if (ea && eb && a.classesAway !== b.classesAway) return (a.classesAway as number) - (b.classesAway as number);
    return b.pct - a.pct || a.entry.name.localeCompare(b.entry.name);
  });
}

/** Rank every candidate minor whose layer is loaded. */
export function rankMinors(
  input: MinorRankInput & {
    entries: readonly MinorIndexEntry[];
    layerOf: (id: string) => Layer | undefined;
  }
): MinorMatch[] {
  const out: MinorMatch[] = [];
  for (const entry of minorCandidates(input.entries, input.plan, input.planPrograms)) {
    const layer = input.layerOf(entry.id);
    if (!layer) continue;
    const m = rankMinor(entry, layer, input);
    if (m) out.push(m);
  }
  return sortMinorMatches(out);
}

/** The panel's "Minors you're close to": proven counts of at most
 *  CLOSE_CLASSES, from an already sorted list. */
export function closeMinors(sorted: readonly MinorMatch[], max = 2): MinorMatch[] {
  return sorted.filter((m) => m.classesAway != null && m.classesAway <= CLOSE_CLASSES).slice(0, max);
}

/** "2 classes away", "1 class away", "Requirements met", or the percent. */
export function minorStanding(m: Pick<MinorMatch, "classesAway" | "pct">): string {
  if (m.classesAway == null) return `${m.pct}% done`;
  if (m.classesAway === 0) return "Requirements met";
  return `${m.classesAway} ${m.classesAway === 1 ? "class" : "classes"} away`;
}
