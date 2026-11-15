import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { usePlan } from "@/hooks/usePlan";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { useStudentAnswers } from "@/hooks/useRequirementProgress";
import { useProgramStore } from "@/store/useProgramStore";
import { useAdditionalProgramData, useMinorIndex } from "@/hooks/useAdditionalProgramData";
import { buildMatchPool } from "@/lib/planner/matchAdapters";
import { isDistributionFamily, programFamily } from "@/lib/planner/colleges";
import { overlapPrograms } from "@/lib/planner/multiProgram";
import { minorCandidates, rankMinor, sortMinorMatches, type MinorMatch } from "@/lib/planner/rankMinors";
import {
  BLANK_PROGRAM_ID,
  buildCourseDisplay,
  engineeringMatchPool,
  matchCollege,
  programsInScope,
  rankProgram,
  sortMatches,
  type MajorMatch,
} from "@/lib/planner/rankMajors";
import type { ProgramData } from "@/contexts/ProgramProvider";
import type { CollegeId } from "@/lib/planner/colleges";
import type { MatchCourse } from "@/lib/planner/majorMatch";
import type { Answers, DistCourse, Layer } from "@/lib/planner/distribution/types";
import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { BoardCard } from "@/lib/planner/board";

export type { MajorMatch } from "@/lib/planner/rankMajors";
export type { MinorMatch } from "@/lib/planner/rankMinors";

/**
 * useMajorMatch (spec 011 §1, spec 019 D3/D11) — thin React glue over the
 * bias-free ranking in lib/planner/rankMajors.ts. It builds ONE course pool
 * (the enriched plan + the credit profile) and ranks the majors of the
 * student's college against it — the identical function on the identical
 * courses, so the ranking is an honest answer to "what should I be doing?"
 * (audit C6 is dead: no currentProgramId enters the scoring path; the current
 * program only decides which college is ranked).
 *
 * WHAT THE PERCENT MEANS (B3): for Engineering-family majors,
 * creditsSatisfied / creditsRequired — the credits the board's courses (EVERY
 * placement, planned or completed; the board is the plan, spec 014 §D1) plus
 * credit-profile courses fill, each course counted toward at most one
 * requirement, with requirements we can't evaluate client-side kept in the
 * denominator (honest ceiling, spec 011 §1b). For Arts & Sciences / CALS
 * majors, the Distribution engine's share of the major's rows done. Either
 * way it is coverage of the major by your plan, not completion progress.
 *
 * Loading (D11): only the student's college's programs, and only while
 * `enabled` (Major Match is on screen). Other mounts (the left rail's teaser)
 * pass enabled:false and rank whatever is already cached; a shared load
 * counter re-ranks them when a load lands.
 */

/** Shared across hook instances: bumps when a batch of program loads settles,
 *  and remembers ids whose load failed (so `ready` doesn't wait on them). */
const useMatchLoads = create<{
  version: number;
  failed: ReadonlySet<string>;
  settle: (loaded: string[], failed: string[]) => void;
}>()((set) => ({
  version: 0,
  failed: new Set(),
  settle: (loaded, failed) =>
    set((s) => {
      const next = new Set(s.failed);
      for (const id of loaded) next.delete(id);
      for (const id of failed) next.add(id);
      return { version: s.version + 1, failed: next };
    }),
}));

/** One ranked result per program, reused across hook instances while the
 *  program data, pool and alias map are unchanged (each Distribution major is
 *  a solve; the rail and the panel would otherwise both run every one). */
const rankCache = new Map<
  string,
  { data: ProgramData; poolKey: string; aliases: Record<string, string>; match: MajorMatch | null }
>();

/** Answers as a cache key: order-free, so the same answers always hit. */
function answersKeyOf(answers: Answers): string {
  const part = (o: Record<string, unknown>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${String(o[k])}`)
      .join(",");
  return `m[${part(answers.marks)}]f[${part(answers.facts)}]`;
}

function poolKeyOf(pool: MatchCourse[]): string {
  return pool
    .map((c) => {
      const d = c as DistCourse;
      return `${c.id}:${c.credits}:${d.creditsMax ?? ""}:${c.isCredit ? 1 : 0}:${d.creditKind ?? ""}:${d.creditExam ?? ""}@${d.creditScore ?? ""}:${(c.altIds ?? []).join(",")}:${(c.attrs ?? []).map((a) => a.value).join(",")}:${c.title ?? ""}:${(d.crossListedSubjects ?? []).join(",")}:${(c.liberalStudies ?? []).join(",")}:${c.term ?? ""}:${(c.liberalStudiesGroups ?? []).join(",")}:${c.placedFor ? `${c.placedFor.row}/${(c.placedFor.categories ?? []).join(",")}` : ""}`;
    })
    .join("|");
}

/** Major Match's course pool and answers, shared by the majors' and the
 *  minors' rankings: ONE pool, ZERO bias (no program identity enters it). */
function useMatchPool(cards: BoardCard[]) {
  const { aliases, courseDetails, index } = useCatalogContext();
  const { studentContext, enteringYear } = useAuth();
  // Spec 028: credit resolved for the student's college (exam + score → courses).
  const { resolved: creditProfile } = useCreditProfile();
  const { placements, waivedRequirementIds } = usePlan();
  // Spec 020 D7: facts from the profile plus this plan's course marks. A mark
  // applies to any major asking the same question (same key), so a college
  // question's answer reaches every major in the college.
  const { marks, facts } = useStudentAnswers();
  // cards = useBoard's cards: enrichment fetches the placed
  // courses' full docs so attribute requirements see real attrs/titles.
  const { enrichedCourses } = useEnrichedPlan(cards);

  // Canonicalize an id through the alias map (either direction).
  const canonical = useMemo(() => (id: string): string => aliases[id] ?? id, [aliases]);

  // Roster tags by course id from the class index (spec 037 D4: a credit
  // course with a real catalog id takes that course's tags).
  const catalogAttrs = useMemo(() => {
    const byId = new Map(index.map((r) => [r.id, r.attrs]));
    return (id: string): readonly string[] | undefined => byId.get(id);
  }, [index]);
  const { entryTerm, transfer, transferStanding } = studentContext;

  // ONE pool, ZERO bias: every course on the board plus synthetic credit
  // courses. No program identity enters here. Built as the Requirements
  // panel builds it: placements dated by the entering year, credit courses
  // with their catalog tags.
  const pool = useMemo(
    () =>
      engineeringMatchPool({
        placements,
        placedCourses: enrichedCourses,
        creditProfile,
        aliases,
        entryTerm,
        enteringYear,
        catalogAttrs,
        courseMarks: marks,
      }),
    [placements, enrichedCourses, creditProfile, aliases, entryTerm, enteringYear, catalogAttrs, marks]
  );
  // Distribution majors count credits from the full catalog docs (a fixed
  // 0-credit course is 0, as on the Requirements panel); Engineering keeps
  // the pool above, unchanged.
  const distPool = useMemo(
    () =>
      buildMatchPool({
        placements,
        placedCourses: enrichedCourses,
        creditProfile,
        aliases,
        details: courseDetails,
        courseMarks: marks,
      }),
    [placements, enrichedCourses, creditProfile, aliases, courseDetails, marks]
  );
  return {
    pool,
    distPool,
    canonical,
    aliases,
    marks,
    facts,
    entryTerm,
    transfer,
    transferStanding,
    enteringYear,
    waivedRequirementIds,
  };
}

export function useMajorMatch(
  cards: BoardCard[],
  opts: { enabled?: boolean } = {}
): {
  matches: MajorMatch[];
  /** Every in-scope program has loaded (or failed to). */
  ready: boolean;
  /** The college ranked within, or null when it isn't known. */
  college: CollegeId | null;
  /** No college from the student or the current program: ask for one. */
  needsCollege: boolean;
} {
  const enabled = opts.enabled ?? true;
  const { programs, programsLoading, loadProgramData, getProgramData } = useProgramContext();
  const { studentContext } = useAuth();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const {
    pool,
    distPool,
    canonical,
    aliases,
    marks,
    facts,
    entryTerm,
    transfer,
    transferStanding,
    enteringYear,
    waivedRequirementIds,
  } = useMatchPool(cards);
  const loadVersion = useMatchLoads((s) => s.version);
  const failed = useMatchLoads((s) => s.failed);
  const settle = useMatchLoads((s) => s.settle);

  const currentProgram = programs.find((p) => p.id === selectedProgramId) ?? null;
  const college = matchCollege(studentContext.college, currentProgram);
  const scoped = useMemo(() => programsInScope(programs, college), [programs, college]);

  // Load the college's programs while Major Match is on screen (cached:
  // repeat calls are free).
  useEffect(() => {
    if (!enabled || scoped.length === 0) return;
    const ids = scoped.map((p) => p.id);
    Promise.allSettled(ids.map((id) => loadProgramData(id))).then((results) => {
      const ok: string[] = [];
      const bad: string[] = [];
      results.forEach((r, i) => (r.status === "fulfilled" && r.value ? ok : bad).push(ids[i]));
      settle(ok, bad);
    });
  }, [enabled, scoped, loadProgramData, settle]);

  const matches = useMemo(() => {
    const ctx = { entryTerm, transfer, transferStanding };
    const answers: Answers = { marks, facts };
    // Waivers matter only through the college solve that pins usedAs courses
    // (a waived college row pins nothing), but they are part of the key.
    const waived: string[] = waivedRequirementIds ?? [];
    const poolKey = `${poolKeyOf(pool)}#${poolKeyOf(distPool)}#${entryTerm}:${transfer}:${transferStanding}:${enteringYear}#${answersKeyOf(answers)}#w[${[...waived].sort().join(",")}]`;
    const display = buildCourseDisplay(pool, canonical);
    // One college solve per computation, shared by every major of the college.
    const collegeCache = new Map<string, Set<string>>();
    const out: MajorMatch[] = [];
    for (const program of scoped) {
      const data = getProgramData(program.id);
      if (!data) continue; // not loaded yet: reappears on the next load bump
      const hit = rankCache.get(program.id);
      let match: MajorMatch | null;
      if (hit && hit.data === data && hit.poolKey === poolKey && hit.aliases === aliases) {
        match = hit.match ? { ...hit.match, program } : null;
      } else {
        match = rankProgram(program, data, {
          pool,
          distPool,
          ctx,
          enteringYear,
          canonical,
          display,
          answers,
          waived,
          collegeCache,
        });
        rankCache.set(program.id, { data, poolKey, aliases, match });
      }
      if (match) out.push(match);
    }
    return sortMatches(out);
    // loadVersion re-derives once program docs land in the provider's cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, pool, distPool, entryTerm, transfer, transferStanding, enteringYear, marks, facts, waivedRequirementIds, canonical, aliases, getProgramData, loadVersion]);

  // Settled = loaded into the cache, or failed. Reading the cache here is
  // cheap and current as of the last load bump.
  const ready =
    college !== null &&
    scoped.every((p) => getProgramData(p.id) !== undefined || failed.has(p.id));
  // While the program list loads the current program is unknown: don't ask
  // for a college the student's major is about to supply (review: cold load).
  return { matches, ready, college, needsCollege: college === null && !programsLoading };
}

// ─── Minors (spec 047 D11) ──────────────────────────────────────────────────

const NO_PROGRAMS: AdditionalProgram[] = [];

/** One ranked minor per id, reused across mounts (the Minors tab and the
 *  stack's panel) while its layer, the pool, the answers and the plan are
 *  unchanged: each minor is a solve. */
const minorRankCache = new Map<
  string,
  {
    entry: MinorIndexEntry;
    layer: Layer;
    key: string;
    canonical: (id: string) => string;
    match: MinorMatch | null;
  }
>();

/**
 * useMinorMatch (spec 047 D11) — every minor the student can take, ranked by
 * classes away (lib/planner/rankMinors.ts), on Major Match's own course pool
 * and answers.
 *
 * Reads (budgeted): nothing while `enabled` is false (the Minors tab closed,
 * the drawer collapsed). Enabled, the minor index (one read, session-cached)
 * and each candidate minor's layer (one read per minor, session-cached), both
 * through useAdditionalProgramData's loaders; the primary and the plan's
 * extra programs come from caches the board already fills. Candidates load
 * only once the plan's programs are in, so a minor a plan program forbids is
 * never read.
 */
export function useMinorMatch(
  cards: BoardCard[],
  opts: { enabled?: boolean } = {}
): {
  matches: MinorMatch[];
  /** The index and every candidate's layer have loaded (or failed to). */
  ready: boolean;
  /** No major on the board yet (the blank canvas): nothing to rank against. */
  needsMajor: boolean;
  /** The minor index couldn't be read. */
  error: boolean;
} {
  const enabled = opts.enabled ?? true;
  const { programs, loadProgramData } = useProgramContext();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { additionalPrograms } = usePlan();
  const { distPool, canonical, marks, facts, entryTerm, transfer, transferStanding, waivedRequirementIds } =
    useMatchPool(cards);

  const primaryId = selectedProgramId && selectedProgramId !== BLANK_PROGRAM_ID ? selectedProgramId : null;
  const active = enabled && primaryId != null;
  const index = useMinorIndex(active);

  // The primary's layers, for its overlap limits and credit marks (cached by
  // ProgramProvider; the board has already loaded them).
  const [primaryLoad, setPrimaryLoad] = useState<{ id: string; data: ProgramData | null } | null>(null);
  useEffect(() => {
    if (!active || !primaryId) return;
    let cancelled = false;
    loadProgramData(primaryId).then(
      (data) => {
        if (!cancelled) setPrimaryLoad((prev) => (prev?.id === primaryId && prev.data === data ? prev : { id: primaryId, data }));
      },
      () => {
        if (!cancelled) setPrimaryLoad((prev) => (prev?.id === primaryId && prev.data === null ? prev : { id: primaryId, data: null }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [active, primaryId, loadProgramData]);
  const primaryData = primaryLoad?.id === primaryId ? primaryLoad.data : undefined;

  // The plan's second major and minors (cached: the engine loads them too).
  const { programs: extras, allLoaded: extrasLoaded } = useAdditionalProgramData(
    active ? additionalPrograms : NO_PROGRAMS
  );

  const primaryProgram = programs.find((p) => p.id === primaryId);
  const primaryIsDistribution = isDistributionFamily(programFamily(primaryProgram));
  const primaryMajor = primaryData?.layers?.find((l) => l.kind === "major" && l.programId === primaryId);
  // Settled: the primary's data and every extra program are in (or failed).
  const planSettled = active && primaryProgram != null && primaryData !== undefined && extrasLoaded;
  // Known: every program on the plan has its sharing in hand. An Engineering
  // primary has no layers, so nothing of its own to know.
  const planKnown =
    planSettled && (!primaryIsDistribution || primaryMajor != null) && extras.every((e) => e.status === "ok");

  const plan = useMemo(
    () => ({ primaryId: primaryId ?? "", additional: additionalPrograms }),
    [primaryId, additionalPrograms]
  );
  const planPrograms = useMemo(
    () =>
      overlapPrograms(
        { id: primaryId ?? "", layers: primaryMajor ? [primaryMajor] : [], holdable: primaryIsDistribution },
        extras.filter((e) => e.status === "ok")
      ),
    [primaryId, primaryMajor, primaryIsDistribution, extras]
  );

  const candidates = useMemo(
    () => (planSettled ? minorCandidates(index.entries, plan, planPrograms) : []),
    [planSettled, index.entries, plan, planPrograms]
  );
  const candidateList = useMemo<AdditionalProgram[]>(
    () => candidates.map((e) => ({ programId: e.id, kind: "minor" })),
    [candidates]
  );
  const { programs: loaded, allLoaded } = useAdditionalProgramData(candidateList);

  const matches = useMemo(() => {
    if (!planSettled || loaded.length === 0) return [];
    const answers: Answers = { marks, facts };
    const waived: string[] = waivedRequirementIds ?? [];
    const markLayers = [...(primaryData?.layers ?? []), ...extras.flatMap((e) => e.layers)];
    const key = [
      poolKeyOf(distPool),
      `${entryTerm}:${transfer}:${transferStanding}`,
      answersKeyOf(answers),
      `w[${[...waived].sort().join(",")}]`,
      JSON.stringify(plan),
      JSON.stringify(planPrograms),
      markLayers.map((l) => l.id).join(","),
      String(planKnown),
    ].join("#");
    const byId = new Map(candidates.map((e) => [e.id, e]));
    const out: MinorMatch[] = [];
    for (const p of loaded) {
      const entry = byId.get(p.programId);
      const layer = p.layers[0];
      if (p.status !== "ok" || !entry || !layer) continue; // unavailable: not listed
      const hit = minorRankCache.get(entry.id);
      let match: MinorMatch | null;
      if (hit && hit.entry === entry && hit.layer === layer && hit.key === key && hit.canonical === canonical) {
        match = hit.match;
      } else {
        match = rankMinor(entry, layer, {
          pool: distPool,
          canonical,
          ctx: { entryTerm, transfer, transferStanding },
          plan,
          answers,
          waived,
          planPrograms,
          planKnown,
          markLayers,
        });
        minorRankCache.set(entry.id, { entry, layer, key, canonical, match });
      }
      if (match) out.push(match);
    }
    return sortMinorMatches(out);
  }, [planSettled, loaded, candidates, distPool, canonical, marks, facts, entryTerm, transfer, transferStanding, waivedRequirementIds, primaryData, extras, plan, planPrograms, planKnown]);

  const error = active && index.status === "error";
  const ready = active && (error || (index.status === "ok" && planSettled && allLoaded));
  return { matches, ready, needsMajor: enabled && primaryId == null, error };
}
