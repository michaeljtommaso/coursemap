import type { AppliesClause, Layer, LayerFamily, StudentContext } from "./types";

/**
 * select.ts (spec 019 D10 amended) — picks the layers that apply to a student:
 * one college layer (the entry-term version that matches), the major layer for
 * the student's program, and optionally the concentration layer. Pure.
 */

const TERM_RE = /^(FA|SP|SU|WI)(\d{2})$/;
/** Within a calendar year: winter session (January) < spring < summer < fall. */
const SEASON_ORDER: Record<string, number> = { WI: 0, SP: 1, SU: 2, FA: 3 };

/** Roster slug ("FA25") → sortable number, or null when malformed. */
export function termOrdinal(term: string): number | null {
  const m = TERM_RE.exec(term);
  if (!m) return null;
  return Number(m[2]) * 4 + SEASON_ORDER[m[1]];
}

/** Every present field of the clause must hold (types.ts AppliesClause). */
export function clauseMatches(clause: AppliesClause, ctx: StudentContext): boolean {
  if (clause.enteredFrom != null || clause.enteredBefore != null) {
    const entry = ctx.entryTerm ? termOrdinal(ctx.entryTerm) : null;
    if (entry == null) return false;
    if (clause.enteredFrom != null) {
      const from = termOrdinal(clause.enteredFrom);
      if (from == null || entry < from) return false;
    }
    if (clause.enteredBefore != null) {
      const before = termOrdinal(clause.enteredBefore);
      if (before == null || entry >= before) return false;
    }
  }
  if (clause.transfer != null) {
    if (ctx.transfer == null || !clause.transfer.includes(ctx.transfer)) return false;
  }
  if (clause.transferStanding != null) {
    if (ctx.transferStanding == null || !clause.transferStanding.includes(ctx.transferStanding)) return false;
  }
  return true;
}

/** Clauses are OR'd; absent → applies to everyone. */
export function appliesToMatches(clauses: AppliesClause[] | undefined, ctx: StudentContext): boolean {
  if (clauses == null) return true;
  return clauses.some((c) => clauseMatches(c, ctx));
}

function usesEntryTerm(clauses: AppliesClause[] | undefined): boolean {
  return (clauses ?? []).some((c) => c.enteredFrom != null || c.enteredBefore != null);
}

export type SelectProblem =
  | "needs-entry-term"
  | "no-college-layer"
  | "ambiguous-college-layer"
  | "no-major-layer";

export type SelectResult = { layers: Layer[]; problem?: SelectProblem };

type CollegePick = { layer?: Layer; problem?: SelectProblem };

function pickCollege(colleges: Layer[], ctx: StudentContext): CollegePick {
  if (colleges.length === 0) return { problem: "no-college-layer" };
  const hasEntry = ctx.entryTerm != null && termOrdinal(ctx.entryTerm) != null;
  if (!hasEntry && colleges.some((l) => usesEntryTerm(l.appliesTo))) return { problem: "needs-entry-term" };

  const versioned = colleges.filter((l) => l.appliesTo != null);
  const matched = versioned.filter((l) => appliesToMatches(l.appliesTo, ctx));
  if (matched.length === 1) return { layer: matched[0] };
  if (matched.length > 1) return { problem: "ambiguous-college-layer" };

  const defaults = colleges.filter((l) => l.appliesTo == null);
  if (defaults.length === 1) return { layer: defaults[0] };
  if (defaults.length > 1) return { problem: "ambiguous-college-layer" };
  return { problem: "no-college-layer" };
}

/** Layers in solve order: college, major, concentration. The first problem
 *  found (college before major) is reported; the layers that could be picked
 *  are still returned. */
export function selectLayers(all: Layer[], q: { family: LayerFamily } & StudentContext): SelectResult {
  const family = all.filter((l) => l.family === q.family);
  const layers: Layer[] = [];
  let problem: SelectProblem | undefined;

  const college = pickCollege(
    family.filter((l) => l.kind === "college"),
    q
  );
  if (college.layer) layers.push(college.layer);
  problem = college.problem;

  const major = family.find((l) => l.kind === "major" && l.programId === q.programId);
  if (major) {
    layers.push(major);
    if (q.concentrationId != null) {
      const conc = family.find(
        (l) => l.kind === "concentration" && l.programId === q.programId && l.concentrationId === q.concentrationId
      );
      if (conc) layers.push(conc);
    }
  } else {
    problem ??= "no-major-layer";
  }

  return problem ? { layers, problem } : { layers };
}
