import type { Course, PrereqExpr } from "@/types/db";
import { patternToRegex } from "./satisfies";

/**
 * deriveEdges (spec 008 §2a, Unit 8A) — the pure data layer of the living
 * graph. Walks each PLACED course's prereq_expr/coreq_expr (same recursion
 * idiom as satisfies.ts's `evaluate`) and emits an edge for every OTHER placed
 * course the tree references, rather than discarding that information into a
 * boolean like the old evaluator does.
 *
 * Deliberately renderer-agnostic: no EdgeLayer/RoadmapCanvas import here. The
 * caller (useDerivedEdges) supplies the placed courses with ENRICHED courses
 * (see enrichCourses.ts) so prereq_expr/coreq_expr are the real trees, not the
 * null placeholders template/plan snapshots carry.
 *
 * Spec 014: every edge endpoint is a board PLACEMENT id (the engine slot id IS
 * the placement id), so a course placed twice (a retake) gets distinct wires
 * and a moved card keeps its wire for free.
 */

export type DerivedEdgeKind = "prereq" | "concurrent" | "advisory";
export type DerivedEdgeState = "satisfied" | "violated";

export type DerivedEdge = {
  fromPlacementId: string;
  toPlacementId: string;
  fromCourseId: string;
  toCourseId: string;
  kind: DerivedEdgeKind;
  state: DerivedEdgeState;
};

/** One course sitting at one board placement (spec 014: a placement id — the
 *  engine slot id IS the placement id) at a known semester. `semester` drives the
 *  same strictly-earlier (prereq) / same-or-earlier (concurrent) rule
 *  computeSlotStatusMap's poolsAt() uses — deriveEdges is a second view over
 *  the identical semantics, never a second source of truth for what "earlier"
 *  means. */
export type PlacedCourse = {
  placementId: string;
  course: Course;
  semester: number;
};

// Which tree we're walking determines the DEFAULT rule for course/pattern
// leaves: a prereq_expr leaf needs a STRICTLY earlier feeder; a coreq_expr
// leaf (any leaf kind, per spec 008 §2a's "kind 'concurrent' edges with
// same-or-earlier satisfied semantics") only needs a same-or-earlier feeder.
// `concurrent`-type leaves always use same-or-earlier regardless of which
// tree they're found in — that is that leaf type's own semantics.
type WalkMode = "prereq" | "coreq";

function feedersFor(
  byCourseId: Map<string, PlacedCourse[]>,
  courseId: string,
  dependentPlacementId: string
): PlacedCourse[] {
  const all = byCourseId.get(courseId);
  if (!all || all.length === 0) return [];
  // No self-edges: a placement never feeds itself (guards the malformed-data
  // case where a course's own tree references its own id; a DIFFERENT placement
  // holding the same course id is still a legitimate feeder).
  return all.filter((p) => p.placementId !== dependentPlacementId);
}

function emitEdge(
  out: Map<string, DerivedEdge>,
  feeder: PlacedCourse,
  dependent: PlacedCourse,
  kind: DerivedEdgeKind,
  satisfied: boolean
): void {
  const key = `${feeder.placementId}::${dependent.placementId}::${kind}`;
  if (out.has(key)) return; // dedupe by from/to placement + kind (spec 008 §2a)
  out.set(key, {
    fromPlacementId: feeder.placementId,
    toPlacementId: dependent.placementId,
    fromCourseId: feeder.course.id,
    toCourseId: dependent.course.id,
    kind,
    state: satisfied ? "satisfied" : "violated",
  });
}

type WalkCtx = {
  byCourseId: Map<string, PlacedCourse[]>;
  dependent: PlacedCourse;
  mode: WalkMode;
  /** Set once we descend into an `advisory` node — every edge emitted below
   *  that point is softened to kind "advisory" regardless of leaf type,
   *  while the satisfied/violated rule keeps following the leaf's own
   *  semantics (course/pattern → mode's rule; concurrent → same-or-earlier). */
  forcedKind: DerivedEdgeKind | null;
  /** Path-based visited set (ancestors only, not siblings) — guards a
   *  malformed/cyclic tree (an object graph with a real circular reference)
   *  from hanging the walk. A fresh copy per recursive call, so legitimately
   *  shared (DAG, non-cyclic) subtrees across sibling branches are unaffected. */
  visited: Set<PrereqExpr>;
  out: Map<string, DerivedEdge>;
};

function defaultKindFor(mode: WalkMode): DerivedEdgeKind {
  return mode === "coreq" ? "concurrent" : "prereq";
}

function walk(expr: PrereqExpr | null | undefined, ctx: WalkCtx): void {
  if (!expr || typeof expr !== "object") return;
  if (ctx.visited.has(expr)) return; // cycle guard — never hang
  const visited = new Set(ctx.visited);
  visited.add(expr);

  switch (expr.type) {
    case "and":
    case "or": {
      const children = Array.isArray(expr.children) ? expr.children : [];
      for (const child of children) walk(child, { ...ctx, visited });
      return;
    }
    case "course": {
      const kind = ctx.forcedKind ?? defaultKindFor(ctx.mode);
      const strictlyEarlier = ctx.mode === "prereq";
      for (const feeder of feedersFor(ctx.byCourseId, expr.id, ctx.dependent.placementId)) {
        const satisfied = strictlyEarlier
          ? feeder.semester < ctx.dependent.semester
          : feeder.semester <= ctx.dependent.semester;
        emitEdge(ctx.out, feeder, ctx.dependent, kind, satisfied);
      }
      return;
    }
    case "pattern": {
      const kind = ctx.forcedKind ?? defaultKindFor(ctx.mode);
      const strictlyEarlier = ctx.mode === "prereq";
      const re = patternToRegex(expr.pattern);
      for (const feeders of ctx.byCourseId.values()) {
        for (const feeder of feeders) {
          if (feeder.placementId === ctx.dependent.placementId) continue; // no self-edges
          const code = `${feeder.course.subject} ${feeder.course.number}`;
          if (!re.test(code)) continue;
          const satisfied = strictlyEarlier
            ? feeder.semester < ctx.dependent.semester
            : feeder.semester <= ctx.dependent.semester;
          emitEdge(ctx.out, feeder, ctx.dependent, kind, satisfied);
        }
      }
      return;
    }
    case "concurrent": {
      const kind = ctx.forcedKind ?? "concurrent";
      for (const feeder of feedersFor(ctx.byCourseId, expr.id, ctx.dependent.placementId)) {
        const satisfied = feeder.semester <= ctx.dependent.semester; // always same-or-earlier
        emitEdge(ctx.out, feeder, ctx.dependent, kind, satisfied);
      }
      return;
    }
    case "advisory": {
      // An unsatisfied-inner advisory naturally emits nothing further down —
      // no placed-course check needed here beyond the normal leaf lookups.
      walk(expr.expr, { ...ctx, visited, forcedKind: "advisory" });
      return;
    }
  }
}

/**
 * Derive every real prereq/coreq edge between PLACED courses. Pure and
 * deterministic — same input always yields the same array in the same order
 * (sorted by toPlacementId, then fromPlacementId, then kind), so memoized
 * consumers (useDerivedEdges → EdgeLayer) are stable across renders that
 * don't change the plan.
 */
export function deriveEdges(placements: PlacedCourse[]): DerivedEdge[] {
  const byCourseId = new Map<string, PlacedCourse[]>();
  for (const p of placements) {
    const arr = byCourseId.get(p.course.id);
    if (arr) arr.push(p);
    else byCourseId.set(p.course.id, [p]);
  }

  const out = new Map<string, DerivedEdge>();

  for (const dependent of placements) {
    if (dependent.course.prereq_expr) {
      walk(dependent.course.prereq_expr, {
        byCourseId,
        dependent,
        mode: "prereq",
        forcedKind: null,
        visited: new Set(),
        out,
      });
    }
    if (dependent.course.coreq_expr) {
      walk(dependent.course.coreq_expr, {
        byCourseId,
        dependent,
        mode: "coreq",
        forcedKind: null,
        visited: new Set(),
        out,
      });
    }
  }

  return [...out.values()].sort(
    (a, b) =>
      a.toPlacementId.localeCompare(b.toPlacementId) ||
      a.fromPlacementId.localeCompare(b.fromPlacementId) ||
      a.kind.localeCompare(b.kind)
  );
}
