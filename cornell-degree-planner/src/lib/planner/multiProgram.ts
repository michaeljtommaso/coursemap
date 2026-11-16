import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type {
  HeldBack,
  OverlapPair,
  ProgramSection,
  RequirementGroup,
  RequirementItem,
} from "@/hooks/useRequirementProgress";
import type { DistCourse, DistributionResult, Layer, LayerSharing, Row, CourseRule } from "./distribution/types";
import { courseMatchesRule, type RuleContext } from "./distribution/rules";
import {
  pairKey,
  type CountedByProgram,
  type HeldEntry,
  type OverlapOutcome,
  type OverlapProgram,
} from "./distribution/overlap";
import { programColorFor } from "./programColors";

/**
 * multiProgram.ts (spec 047) — the pieces both engines share when a plan
 * holds a second major or minors: which layers belong to which program, what
 * a program counts toward overlap (D7), the score the overlap search
 * maximizes, the per-program sections, the overlap / held-back outputs (D8)
 * and the D3 fill candidates. Pure.
 */

/** The extra programs that take part in a solve: loaded, with layers. Layers
 *  whose id is already in the solve (a duplicate entry) are dropped. */
export function solvableExtras(extras: readonly LoadedProgram[], taken: ReadonlySet<string>): LoadedProgram[] {
  const seen = new Set(taken);
  const out: LoadedProgram[] = [];
  for (const p of extras) {
    if (p.status !== "ok" || p.layers.length === 0) continue;
    const layers = p.layers.filter((l) => l.kind !== "college" && !seen.has(l.id));
    for (const l of layers) seen.add(l.id);
    if (layers.length > 0) out.push(layers.length === p.layers.length ? p : { ...p, layers });
  }
  return out;
}

/** The program's own major or minor layer (the one carrying its `sharing`). */
function ownLayer(layers: readonly Layer[]): Layer | undefined {
  return layers.find((l) => l.kind === "major" || l.kind === "minor");
}

function forbiddenOf(layers: readonly Layer[]): string[] | undefined {
  const out = layers.flatMap((l) => l.sharing?.forbiddenWith ?? []);
  return out.length > 0 ? [...new Set(out)] : undefined;
}

/** The overlap view of the primary (its non-college layers) and each extra. */
export function overlapPrograms(
  primary: { id: string; layers: readonly Layer[]; holdable: boolean; sharing?: LayerSharing },
  extras: readonly LoadedProgram[]
): OverlapProgram[] {
  const primaryLayers = primary.layers.filter((l) => l.kind !== "college");
  const out: OverlapProgram[] = [
    {
      id: primary.id,
      kind: "major",
      layerIds: primaryLayers.map((l) => l.id),
      ...(primary.sharing ?? ownLayer(primaryLayers)?.sharing
        ? { sharing: primary.sharing ?? ownLayer(primaryLayers)?.sharing }
        : {}),
      ...(forbiddenOf(primaryLayers) ? { forbiddenWith: forbiddenOf(primaryLayers) } : {}),
      holdable: primary.holdable,
    },
  ];
  for (const p of extras) {
    const sharing = p.sharing ?? ownLayer(p.layers)?.sharing;
    const forbidden = [...new Set([...(forbiddenOf(p.layers) ?? []), ...(sharing?.forbiddenWith ?? [])])];
    out.push({
      id: p.programId,
      kind: p.kind,
      layerIds: p.layers.map((l) => l.id),
      ...(sharing ? { sharing } : {}),
      ...(forbidden.length > 0 ? { forbiddenWith: forbidden } : {}),
      holdable: true,
    });
  }
  return out;
}

/** layerId → programId for every program's layers. */
export function programOfLayer(programs: readonly OverlapProgram[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of programs) for (const id of p.layerIds) out.set(id, p.id);
  return out;
}

/** D7: does a row's counting make a course "shared"? A consuming row (seat,
 *  pool, distribution, anyOf) or a credits row; never an overlay row or a
 *  confirm row. */
export function countsTowardOverlap(def: Row | undefined): boolean {
  if (!def || def.kind === "confirm") return false;
  if (def.kind === "credits") return true;
  return !def.overlay;
}

/** What each program counts toward overlap in a Distribution result. */
export function countedFromResult(
  result: DistributionResult,
  defs: ReadonlyMap<string, Row>,
  layerProgram: ReadonlyMap<string, string>,
  into: CountedByProgram = new Map()
): CountedByProgram {
  for (const layer of result.layers) {
    const programId = layerProgram.get(layer.layerId);
    if (!programId) continue;
    const map = into.get(programId) ?? new Map<string, number>();
    for (const row of layer.rows) {
      if (!countsTowardOverlap(defs.get(`${layer.layerId}:${row.rowId}`))) continue;
      for (const c of row.courses) map.set(c.courseId, Math.max(map.get(c.courseId) ?? 0, c.credits));
    }
    into.set(programId, map);
  }
  return into;
}

/** Mean row fraction (0–100, rounded) over the rows of these layers that are
 *  scored (not confirm, not waived) — the engine's own pct formula. */
export function pctOfLayers(result: DistributionResult, layerIds: ReadonlySet<string>): number {
  let sum = 0;
  let scored = 0;
  for (const layer of result.layers) {
    if (!layerIds.has(layer.layerId)) continue;
    for (const row of layer.rows) {
      if (row.status === "confirm" || row.status === "waived") continue;
      sum += row.fraction;
      scored++;
    }
  }
  return scored > 0 ? Math.round((100 * sum) / scored) : 0;
}

/** The overlap search's objective: total requirement progress across every
 *  program's layers (row fractions), with each program's percent as a tie-break. */
export function progressScore(result: DistributionResult, programs: readonly OverlapProgram[]): number {
  const layerProgram = programOfLayer(programs);
  let sum = 0;
  for (const layer of result.layers) {
    if (!layerProgram.has(layer.layerId)) continue;
    for (const row of layer.rows) if (row.status !== "confirm" && row.status !== "waived") sum += row.fraction;
  }
  let pcts = 0;
  for (const p of programs) pcts += pctOfLayers(result, new Set(p.layerIds));
  return sum + pcts * 1e-6;
}

/** What holding `courseId` back from `programId` would cost: each of that
 *  program's rows counting it, a met row most. */
export function holdCost(
  result: DistributionResult,
  programs: readonly OverlapProgram[],
  programId: string,
  courseId: string
): number {
  const layers = new Set(programs.find((p) => p.id === programId)?.layerIds ?? []);
  let cost = 0;
  for (const layer of result.layers) {
    if (!layers.has(layer.layerId)) continue;
    for (const row of layer.rows) {
      if (!row.courses.some((c) => c.courseId === courseId)) continue;
      cost += row.status === "met" ? 1 : row.fraction / Math.max(1, row.courses.length);
    }
  }
  return cost;
}

/** D8: the student's countsFor marks as canonical course id → programId. A
 *  mark naming a layer no program on the plan has is ignored. */
export function countsForChoices(
  marks: Readonly<Record<string, unknown>> | undefined,
  layerProgram: ReadonlyMap<string, string>,
  canonical: (id: string) => string,
  parse: (key: string) => { layerId: string; courseId: string } | null
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(marks ?? {})) {
    if (value !== "yes") continue;
    const parsed = parse(key);
    if (!parsed) continue;
    const programId = layerProgram.get(parsed.layerId);
    if (programId) out.set(canonical(parsed.courseId), programId);
  }
  return out;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

/** The overlap pairs (only pairs with a limit) and each placement's held-back
 *  notes. A held-back entry is reported only while the program it counts for
 *  still counts it. */
export function overlapOutputs<R>(
  outcome: OverlapOutcome<R>,
  counted: CountedByProgram,
  placementByCourse: ReadonlyMap<string, string>
): { overlap: OverlapPair[]; heldBackByPlacement: Record<string, HeldBack[]> } {
  const overlap: OverlapPair[] = [];
  const heldBackByPlacement: Record<string, HeldBack[]> = {};
  for (const pair of outcome.pairs) {
    const tag = pairKey(pair.a, pair.b);
    const heldBack: HeldBack[] = [];
    for (const h of outcome.held as HeldEntry[]) {
      if (h.pair !== tag) continue;
      const countsFor = h.from === pair.a ? pair.b : pair.a;
      if (!counted.get(countsFor)?.has(h.courseId)) continue;
      if (heldBack.some((x) => x.courseId === h.courseId && x.heldFrom === h.from)) continue;
      const placementId = placementByCourse.get(h.courseId) ?? null;
      const entry: HeldBack = { courseId: h.courseId, placementId, countsFor, heldFrom: h.from };
      heldBack.push(entry);
      if (placementId) (heldBackByPlacement[placementId] ??= []).push(entry);
    }
    overlap.push({
      a: pair.a,
      b: pair.b,
      limit: pair.limit,
      limitFrom: pair.limitFrom,
      sharedCourseIds: pair.shared.map((s) => s.courseId),
      heldBack,
      estimated: outcome.estimated,
    });
  }
  return { overlap, heldBackByPlacement };
}

/** Sections whose program can't be shown as cleanly met: the later program of
 *  a "forbidden" pair (D14), or of a pair the search couldn't bring within its
 *  limit. */
export function cappedSections<R>(outcome: OverlapOutcome<R> | null): Set<string> {
  const out = new Set<string>();
  for (const p of outcome?.pairs ?? []) if (p.limit === "forbidden" || p.over) out.add(p.b);
  return out;
}

/** Shown on a row a pair over its limit still counts a shared course in. */
export const OVERLAP_UNRESOLVED_NOTE =
  "Overlap limit not resolved: a class here also counts for another program on your plan, beyond what the two programs allow. Check with your advisor.";

/**
 * D7: rows (`${layerId}:${rowId}`) of the later program of each pair still
 * over its limit after the search and the greedy fallback, that count one of
 * the pair's still-shared courses. Such a row may be met only because of a
 * course the limit forbids sharing, so it must not read as met.
 */
export function unresolvedRowKeys<R>(
  outcome: OverlapOutcome<R> | null,
  result: DistributionResult,
  programs: readonly OverlapProgram[]
): Set<string> {
  const out = new Set<string>();
  for (const pair of outcome?.pairs ?? []) {
    if (!pair.over) continue;
    const later = new Set(programs.find((p) => p.id === pair.b)?.layerIds ?? []);
    const shared = new Set(pair.shared.map((s) => s.courseId));
    for (const layer of result.layers) {
      if (!later.has(layer.layerId)) continue;
      for (const row of layer.rows) {
        if (row.courses.some((c) => shared.has(c.courseId))) out.add(`${layer.layerId}:${row.rowId}`);
      }
    }
  }
  return out;
}

/** A row unresolvedRowKeys names: a "satisfied" item reads "partial", with
 *  the reason (fails closed: never a met row on a broken limit). */
export function downgradeUnresolved(item: RequirementItem): void {
  if (item.status !== "satisfied") return;
  item.status = "partial";
  if (item.dist) {
    item.dist.engineStatus = "partial";
    item.dist.reason = "overlap-unresolved";
    item.dist.note = item.dist.note ? `${item.dist.note} ${OVERLAP_UNRESOLVED_NOTE}` : OVERLAP_UNRESOLVED_NOTE;
  }
}

/** Counts of a section's groups: scored items (not confirm rows), done ones. */
export function groupCounts(groups: readonly RequirementGroup[]): { satisfiedCount: number; total: number } {
  let satisfiedCount = 0;
  let total = 0;
  for (const g of groups) {
    satisfiedCount += g.satisfiedCount;
    total += g.total;
  }
  return { satisfiedCount, total };
}

/** A section that may not read as complete: below 100 % and one short. */
export function capSection(section: ProgramSection): ProgramSection {
  return {
    ...section,
    pct: Math.min(section.pct, 99),
    satisfiedCount:
      section.total > 0 && section.satisfiedCount >= section.total ? section.total - 1 : section.satisfiedCount,
  };
}

/** The extra programs' sections, in plan order (index = color), unloaded and
 *  unavailable ones included. `stats(programId)` gives a solved program's
 *  figures. */
export function extraSections(
  extras: readonly LoadedProgram[],
  stats: (programId: string) => { pct: number; satisfiedCount: number; total: number } | null,
  capped: ReadonlySet<string>
): ProgramSection[] {
  return extras.map((p, index) => {
    const s = p.status === "ok" ? stats(p.programId) : null;
    const section: ProgramSection = {
      id: p.programId,
      kind: p.kind === "major" ? "secondMajor" : "minor",
      name: p.name,
      shortName: p.shortName,
      color: programColorFor(index),
      pct: s?.pct ?? 0,
      satisfiedCount: s?.satisfiedCount ?? 0,
      total: s?.total ?? 0,
      // Loaded but with no usable layer: as good as unavailable.
      status: p.status === "ok" && !s ? "unavailable" : p.status,
    };
    return capped.has(p.programId) ? capSection(section) : section;
  });
}

/** A second major with fewer concentrations than its major layer requires
 *  can't read as complete (like the primary's `concentrations.needed`). */
export function needsConcentration(p: LoadedProgram): boolean {
  const major = p.layers.find((l) => l.kind === "major");
  const min = major?.concentrations?.min ?? 0;
  return p.kind === "major" && min > p.layers.filter((l) => l.kind === "concentration").length;
}

// ─── D3: fill candidates ────────────────────────────────────────────────────

/** The courses a rule can be met by, canonical, or null when it is open (a
 *  subject, a pattern, a tag ... could meet it). A `course` leaf names its
 *  courses; `anyOf` is the union (open when any option is); `allOf` is the
 *  intersection of its children that name courses (the others only narrow
 *  it), open when none does; anything else is open. */
function namedCourses(rule: CourseRule, canonical: (id: string) => string): Set<string> | null {
  if ("course" in rule) return new Set(rule.course.map(canonical));
  if ("anyOf" in rule) {
    const out = new Set<string>();
    for (const r of rule.anyOf) {
      const c = namedCourses(r, canonical);
      if (c == null) return null;
      for (const id of c) out.add(id);
    }
    return out;
  }
  if ("allOf" in rule) {
    const named = rule.allOf
      .map((r) => namedCourses(r, canonical))
      .filter((c): c is Set<string> => c != null);
    if (named.length === 0) return null;
    return new Set([...named[0]].filter((id) => named.every((c) => c.has(id))));
  }
  return null;
}

/** The ONE specific course a seat row requires, or null when its rule can be
 *  met by more than one course ("ECE 3100 or ENGRD 2700"), by an open rule (a
 *  pattern, a subject) or by none. Cross-listed twins of one course are one
 *  course (`canonical`). D3 only suggests a seat's course when there is no
 *  choice to make. */
export function seatCourse(rule: CourseRule, canonical: (id: string) => string = (id) => id): string | null {
  const named = namedCourses(rule, canonical);
  return named != null && named.size === 1 ? [...named][0] : null;
}

/**
 * D3: the specific required courses of a program's still-unmet seat rows, in
 * authored order then earliest-needed first (a course before the courses it
 * unlocks, from the catalog index's `unlocks`), minus courses already placed
 * or in `exclude`. The solve decides "still unmet", so a seat an equivalent
 * course already fills adds nothing. Pool rows add nothing.
 *
 * A seat adds its course only when its rule names exactly one course
 * (seatCourse): a seat with a choice is the student's to fill. It adds nothing
 * when a course the student has (`have`: the board and credit, tried classes
 * too when the caller has them) meets the seat's ORIGINAL rule, as authored:
 * a course an overlap limit holds back from the program (D7) still means the
 * student has the class, and suggesting a copy of it would be wrong.
 */
export function fillCandidatesFor(
  layers: readonly Layer[],
  result: DistributionResult,
  options: {
    canonical: (id: string) => string;
    placed: ReadonlySet<string>;
    exclude?: ReadonlySet<string>;
    unlocks?: (courseId: string) => readonly string[] | undefined;
    /** Courses the student has (board, credit, tried). */
    have?: readonly DistCourse[];
    /** How `have` is read against a seat's rule (program, answers). */
    ruleCtx?: RuleContext;
  }
): string[] {
  const { canonical, placed } = options;
  const ruleCtx: RuleContext = { ...options.ruleCtx, canonical };
  const status = new Map<string, string>();
  for (const l of result.layers) for (const r of l.rows) status.set(`${l.layerId}:${r.rowId}`, r.status);
  const out: string[] = [];
  for (const layer of layers) {
    for (const row of layer.rows) {
      if (row.kind !== "seat") continue;
      const s = status.get(`${layer.id}:${row.id}`);
      if (s !== "unmet" && s !== "partial") continue;
      const id = seatCourse(row.rule, canonical);
      if (!id) continue;
      if (placed.has(id) || options.exclude?.has(id) || out.includes(id)) continue;
      if ((options.have ?? []).some((c) => courseMatchesRule(c, row.rule, ruleCtx))) continue;
      out.push(id);
    }
  }
  return earliestNeededFirst(out, (id) => (options.unlocks?.(id) ?? []).map(canonical));
}

/** Stable topological order: a course before every course it unlocks; ties
 *  and cycles keep the given order. */
export function earliestNeededFirst(ids: readonly string[], unlocks: (id: string) => readonly string[]): string[] {
  const inSet = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const id of ids) {
    const outs = [...new Set(unlocks(id))].filter((u) => inSet.has(u) && u !== id);
    next.set(id, outs);
    for (const u of outs) indegree.set(u, (indegree.get(u) ?? 0) + 1);
  }
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < ids.length) {
    const ready = ids.find((id) => !done.has(id) && indegree.get(id) === 0);
    // A cycle: release the earliest remaining course.
    const pick = ready ?? ids.find((id) => !done.has(id))!;
    done.add(pick);
    out.push(pick);
    for (const u of next.get(pick) ?? []) indegree.set(u, (indegree.get(u) ?? 0) - 1);
  }
  return out;
}
