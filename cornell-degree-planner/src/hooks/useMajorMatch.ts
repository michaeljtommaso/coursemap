import { useEffect, useMemo, useState } from "react";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlan } from "@/hooks/usePlan";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { assign, programToRequirements, type Assignment } from "@/lib/planner/majorMatch";
import { buildMatchPool, programSlotsToMatchInput } from "@/lib/planner/matchAdapters";
import type { Program, ProgramSlotWithData } from "@/types/db";

/**
 * useMajorMatch (spec 011 §1) — thin React glue over the bias-free matcher.
 * REBUILT: this hook no longer scores anything itself. It builds ONE course
 * pool (the enriched plan + the credit profile) and runs the pure `assign`
 * against every program's requirements — the identical function on the
 * identical courses, so the ranking is an honest answer to "what should I be
 * doing?" (audit C6 is dead: no currentProgramId enters the scoring path).
 *
 * Consumers get, per program: credit-weighted pct, creditsSatisfied /
 * creditsRequired, and the explainable matched / missing / uncounted lists
 * (course ids resolved to student-facing codes/titles, requirement ids to
 * labels) — the material the discovery panel renders as "here's what counts,
 * what's still needed, and what didn't count and why".
 *
 * WHAT THE PERCENT MEANS (B3): pct = creditsSatisfied / creditsRequired, where
 *   - creditsSatisfied = credits the board's courses (EVERY placement — planned
 *     or completed; spec 014 §D1 makes the board the plan) plus credit-profile
 *     courses fill, each course counted toward at most one requirement, a seat
 *     counting its seat credits and a pool capped at its minCredits;
 *   - creditsRequired = the major's seats + elective-pool minimums, INCLUDING
 *     pools we can't evaluate client-side yet (list/category rules), so the
 *     ceiling is below 100% for most majors (honest denominator, spec 011 §1b).
 * So it is coverage of the major by your plan, not completion progress:
 * marking a course done does not change it. Verified 2026-10-09 against the
 * seed programs: a fresh CS board ranks CS first (~52%, the fixed seats),
 * engineering majors sharing the common core follow (EAS ~49%, ECE ~37%), and
 * Comm sits near 9% because its two open pools (free elective, advisor-approved
 * elective, 3 cr each of a 64-credit denominator) accept ANY course — any board
 * earns those 6 credits, and "What counts" says so.
 */

/** The seeded blank "start from scratch" canvas (FirstRun's BLANK_ID). It's an
 *  on-ramp, not a major: it never appears in the "ranked across Engineering
 *  majors" list (its empty template would always score 0%). */
const BLANK_PROGRAM_ID = "blank";

export type MajorMatch = {
  program: Program;
  /** Credit-weighted, 0–100. */
  pct: number;
  creditsSatisfied: number;
  creditsRequired: number;
  /** Each counted course, resolved to display + the requirement label it fills. */
  matched: {
    courseId: string;
    code: string;
    title: string;
    requirementId: string;
    requirementLabel: string;
    credits: number;
  }[];
  /** Still-needed requirements (labels + credits); `reason:"no-data"` marks a
   *  pool we can't evaluate client-side yet. */
  missing: Assignment["missing"];
  /** Courses on the plan that DON'T count toward this program, with why. */
  uncounted: {
    courseId: string;
    code: string;
    title: string;
    credits: number;
    reason: Assignment["uncounted"][number]["reason"];
  }[];
};

export function useMajorMatch(currentSlots: ProgramSlotWithData[]): {
  matches: MajorMatch[];
  ready: boolean;
} {
  const { programs, loadProgramData, getProgramData } = useProgramContext();
  const { aliases } = useCatalogContext();
  const { creditProfile } = useAuth();
  const { placements } = usePlan();
  // currentSlots = useBoard's engineSlots: enrichment fetches the placed
  // courses' full docs so attribute requirements see real attrs/titles.
  const { enrichedCourses } = useEnrichedPlan(currentSlots);
  const [loadedVersion, setLoadedVersion] = useState(0);

  // Idle prefetch of every program doc (cached — repeat calls are free). The
  // ranking needs EVERY program's data, not just the current one.
  useEffect(() => {
    if (programs.length === 0) return;
    let cancelled = false;
    const run = () => {
      Promise.allSettled(programs.map((p) => loadProgramData(p.id))).then(() => {
        if (!cancelled) setLoadedVersion((v) => v + 1);
      });
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    const handle = hasIdle ? window.requestIdleCallback(run) : window.setTimeout(run, 600);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle);
    };
  }, [programs, loadProgramData]);

  // Canonicalize an id through the alias map (either direction). `assign` does
  // the actual canonicalization/dedup; this same fn resolves display below.
  const canonical = useMemo(() => (id: string): string => aliases[id] ?? id, [aliases]);

  // ONE pool, ZERO bias: every course on the board plus synthetic credit
  // courses. No program identity enters here.
  const pool = useMemo(
    () => buildMatchPool({ placements, placedCourses: enrichedCourses, creditProfile }),
    [placements, enrichedCourses, creditProfile]
  );

  // canonical id → student-facing display. `assign` returns canonicalized ids,
  // so matched/uncounted resolve through this map (first occurrence wins).
  const courseDisplay = useMemo(() => {
    const map = new Map<string, { code: string; title: string; credits: number }>();
    for (const c of pool) {
      const cid = canonical(c.id);
      if (map.has(cid)) continue;
      const code = `${c.subject} ${c.number}`.trim();
      map.set(cid, { code, title: c.title ?? code, credits: c.credits });
    }
    return map;
  }, [pool, canonical]);

  const matches = useMemo(() => {
    const out: MajorMatch[] = [];
    for (const program of programs) {
      if (program.id === BLANK_PROGRAM_ID) continue; // on-ramp, not a major
      const data = getProgramData(program.id);
      if (!data) continue; // not loaded yet — reappears on loadedVersion bump

      const requirements = programToRequirements(programSlotsToMatchInput(data.slots));
      const reqLabelById = new Map(requirements.map((r) => [r.id, r.label]));
      const result = assign(pool, requirements, canonical);

      const matched = result.matched.map((m) => {
        const disp = courseDisplay.get(m.courseId);
        return {
          courseId: m.courseId,
          code: disp?.code ?? m.courseId.replace(/-/g, " "),
          title: disp?.title ?? "",
          requirementId: m.requirementId,
          requirementLabel: reqLabelById.get(m.requirementId) ?? "Requirement",
          credits: m.credits,
        };
      });

      const uncounted = result.uncounted.map((u) => {
        const disp = courseDisplay.get(u.courseId);
        return {
          courseId: u.courseId,
          code: disp?.code ?? u.courseId.replace(/-/g, " "),
          title: disp?.title ?? "",
          credits: disp?.credits ?? 0,
          reason: u.reason,
        };
      });

      out.push({
        program,
        pct: result.pct,
        creditsSatisfied: result.creditsSatisfied,
        creditsRequired: result.creditsRequired,
        matched,
        missing: result.missing,
        uncounted,
      });
    }
    // Ranked by credit-weighted fit, then name. No program bias anywhere.
    return out.sort((a, b) => b.pct - a.pct || a.program.name.localeCompare(b.program.name));
    // loadedVersion re-derives once all program docs land in the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, pool, canonical, courseDisplay, getProgramData, loadedVersion]);

  const rankableCount = programs.filter((p) => p.id !== BLANK_PROGRAM_ID).length;
  return { matches, ready: matches.length === rankableCount && rankableCount > 0 };
}
