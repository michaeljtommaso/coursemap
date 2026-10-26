import type { AppliesClause, ClassStanding, Layer, LayerFamily, StudentContext, TransferKind } from "./types";

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
  | "needs-transfer"
  | "needs-transfer-standing"
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

const TRANSFERS: TransferKind[] = ["none", "external", "internal"];
const STANDINGS: ClassStanding[] = ["first-year", "sophomore", "junior", "senior"];

/** What the student would get: the college version and every row (anyOf
 *  options included) whose appliesTo matches. Two contexts with the same
 *  signature are indistinguishable to the engine. */
function signature(all: Layer[], q: Query): string {
  const { layers } = selectLayersKnown(all, q);
  return layers
    .map((l) => {
      const rows = l.rows.flatMap((r) => [r, ...(r.kind === "anyOf" ? r.rows : [])]);
      return `${l.id}[${rows.filter((r) => appliesToMatches(r.appliesTo, q)).map((r) => r.id).join(",")}]`;
    })
    .join("|");
}

type Query = { family: LayerFamily } & StudentContext;

/** Every way the student's unknown transfer fields could be filled in. */
function completions(q: Query): Query[] {
  const transfers = q.transfer == null ? TRANSFERS : [q.transfer];
  const standings = q.transferStanding == null ? STANDINGS : [q.transferStanding];
  return transfers.flatMap((transfer) => standings.map((transferStanding) => ({ ...q, transfer, transferStanding })));
}

/** Does the selection depend on a field the student hasn't told us? Every
 *  completion of the unknowns is tried; if the outcome changes, the app must
 *  ask (an unknown never silently picks a curriculum or hides a row). */
function missingField(all: Layer[], q: Query): SelectProblem | undefined {
  if (new Set(completions(q).map((v) => signature(all, v))).size <= 1) return undefined;
  if (q.transfer == null) return "needs-transfer";
  return "needs-transfer-standing";
}

/** Layers in solve order: college, major, then each chosen concentration. The first problem
 *  found is reported (entry term, then transfer status, then the rest). When a
 *  needed field is unknown the layers that are certain are still returned, but
 *  the caller must ask the student before trusting the result. */
export function selectLayers(all: Layer[], q: Query): SelectResult {
  const known = selectLayersKnown(all, q);
  if (known.problem === "needs-entry-term") return known;
  const missing = missingField(all, q);
  if (!missing) return known;
  // Keep the college layer only when every possible answer picks the same one.
  const colleges = new Set(
    completions(q).map((v) => selectLayersKnown(all, v).layers.find((l) => l.kind === "college")?.id)
  );
  const layers = known.layers.filter((l) => l.kind !== "college" || colleges.size === 1);
  return { layers, problem: missing };
}

function selectLayersKnown(all: Layer[], q: { family: LayerFamily } & StudentContext): SelectResult {
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
    const chosen = q.concentrationIds ?? (q.concentrationId != null ? [q.concentrationId] : []);
    for (const id of chosen) {
      const conc = family.find(
        (l) => l.kind === "concentration" && l.programId === q.programId && l.concentrationId === id
      );
      // An id with no layer is ignored here; distributionProgress decides what
      // that means for the student (never a silent pass).
      if (conc && !layers.includes(conc)) layers.push(conc);
    }
  } else {
    problem ??= "no-major-layer";
  }

  return problem ? { layers, problem } : { layers };
}
