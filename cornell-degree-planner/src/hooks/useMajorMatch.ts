import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlan } from "@/hooks/usePlan";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { useProgramStore } from "@/store/useProgramStore";
import { buildMatchPool } from "@/lib/planner/matchAdapters";
import {
  buildCourseDisplay,
  matchCollege,
  programsInScope,
  rankProgram,
  sortMatches,
  type MajorMatch,
} from "@/lib/planner/rankMajors";
import type { ProgramData } from "@/contexts/ProgramProvider";
import type { CollegeId } from "@/lib/planner/colleges";
import type { MatchCourse } from "@/lib/planner/majorMatch";
import type { BoardCard } from "@/lib/planner/board";

export type { MajorMatch } from "@/lib/planner/rankMajors";

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

function poolKeyOf(pool: MatchCourse[]): string {
  return pool
    .map((c) => `${c.id}:${c.credits}:${c.isCredit ? 1 : 0}:${(c.attrs ?? []).map((a) => a.value).join(",")}:${c.title ?? ""}`)
    .join("|");
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
  const { programs, loadProgramData, getProgramData } = useProgramContext();
  const { aliases } = useCatalogContext();
  const { creditProfile, studentContext } = useAuth();
  const { placements } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  // cards = useBoard's cards: enrichment fetches the placed
  // courses' full docs so attribute requirements see real attrs/titles.
  const { enrichedCourses } = useEnrichedPlan(cards);
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

  // Canonicalize an id through the alias map (either direction).
  const canonical = useMemo(() => (id: string): string => aliases[id] ?? id, [aliases]);

  // ONE pool, ZERO bias: every course on the board plus synthetic credit
  // courses. No program identity enters here.
  const pool = useMemo(
    () => buildMatchPool({ placements, placedCourses: enrichedCourses, creditProfile, aliases }),
    [placements, enrichedCourses, creditProfile, aliases]
  );

  const matches = useMemo(() => {
    const poolKey = poolKeyOf(pool);
    const display = buildCourseDisplay(pool, canonical);
    const out: MajorMatch[] = [];
    for (const program of scoped) {
      const data = getProgramData(program.id);
      if (!data) continue; // not loaded yet: reappears on the next load bump
      const hit = rankCache.get(program.id);
      let match: MajorMatch | null;
      if (hit && hit.data === data && hit.poolKey === poolKey && hit.aliases === aliases) {
        match = hit.match ? { ...hit.match, program } : null;
      } else {
        match = rankProgram(program, data, { pool, canonical, display });
        rankCache.set(program.id, { data, poolKey, aliases, match });
      }
      if (match) out.push(match);
    }
    return sortMatches(out);
    // loadVersion re-derives once program docs land in the provider's cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, pool, canonical, aliases, getProgramData, loadVersion]);

  // Settled = loaded into the cache, or failed. Reading the cache here is
  // cheap and current as of the last load bump.
  const ready =
    college !== null &&
    scoped.every((p) => getProgramData(p.id) !== undefined || failed.has(p.id));
  return { matches, ready, college, needsCollege: college === null };
}
