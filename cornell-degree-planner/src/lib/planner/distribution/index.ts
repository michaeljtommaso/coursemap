import { solveLayers } from "./engine";
import { verifyAssignment } from "./verify";
import type { RuleContext } from "./rules";
import type { DistCourse, DistributionResult, DistributionRow, Layer, SolveInput } from "./types";

/**
 * The Distribution engine as the app calls it (spec 019 D8): the solver with
 * the independent checker wired in, so every "met" a caller sees has been
 * re-proved by verifyAssignment. Callers use `solve`, never `solveLayers`
 * directly.
 */
export function solve(input: SolveInput): DistributionResult {
  return solveLayers(input, { verify: verifyAssignment });
}

/** One distribution row judged on its own (evaluateStandaloneRow). */
export type StandaloneRowResult = {
  status: "met" | "partial" | "unmet";
  /** Canonical course ids the row counts (the chosen set), board order. */
  counted: string[];
  /** Counted course id → the category id it counts in (its first one, should
   *  the row let a course fill several). */
  categoryOf: Record<string, string>;
  /** Category ids with at least one counted course, authored order. */
  categoriesHave: string[];
  /** Categories the row still needs, authored order. */
  missingCategories: string[];
  coursesHave: number;
  coursesNeed: number;
  creditsHave: number;
  /** 0 when the row sets no `requiredCredits`. */
  creditsNeed: number;
  /** 0–1 on the same scale as every engine row (1 iff met). */
  fraction: number;
  /** False when the engine couldn't prove a result (search budget, checker
   *  rejection): the row then reads "unmet" with nothing counted, and a
   *  caller should judge a smaller course set or keep what it had. */
  proven: boolean;
};

const STANDALONE_LAYER_ID = "standalone";

/**
 * Evaluates one DistributionRow over a course list, outside any layer stack
 * (spec 037: Engineering's liberal studies rule). The row is solved as the
 * only row of a layer of its own through `solve`, so the same evaluator picks
 * the best counted set and category assignment among all the given courses
 * (it may count fewer than all), and every "met" is re-proved by the checker.
 * A result the engine cannot prove (search budget, checker rejection) fails
 * closed as "unmet" with nothing counted, and `proven: false`.
 *
 * The row's own `appliesTo`, `overlay` and `exclusive` are ignored: the caller
 * has already decided the row applies. From `ctx` the program id, the
 * canonical-id function and the answers are used; question scopes come from
 * layers, and a standalone row has none.
 */
export function evaluateStandaloneRow(
  row: DistributionRow,
  courses: DistCourse[],
  ctx: RuleContext = {}
): StandaloneRowResult {
  const own: DistributionRow = { ...row, appliesTo: undefined, overlay: undefined, exclusive: undefined };
  const layer: Layer = {
    id: STANDALONE_LAYER_ID,
    kind: "college",
    family: "cas",
    name: row.label,
    catalogYear: "",
    rows: [own],
  };
  const result = solve({
    layers: [layer],
    courses,
    ctx: { programId: ctx.programId ?? "" },
    ...(ctx.canonical ? { canonical: ctx.canonical } : {}),
    ...(ctx.answers ? { answers: ctx.answers } : {}),
  });

  const r = result.layers[0]?.rows[0];
  const proven = r != null && (r.status === "met" || r.status === "partial" || r.status === "unmet");
  const coursesNeed = row.requiredCourses;
  const creditsNeed = row.requiredCredits ?? 0;
  if (!proven) {
    return {
      status: "unmet",
      counted: [],
      categoryOf: {},
      categoriesHave: [],
      missingCategories: row.categories.map((c) => c.id),
      coursesHave: 0,
      coursesNeed,
      creditsHave: 0,
      creditsNeed,
      fraction: 0,
      proven: false,
    };
  }

  const categoryOf: Record<string, string> = {};
  for (const c of r.courses) if (c.categories && c.categories.length > 0) categoryOf[c.courseId] = c.categories[0];
  return {
    status: r.status as StandaloneRowResult["status"],
    counted: r.courses.map((c) => c.courseId),
    categoryOf,
    categoriesHave: r.progress.categoriesHave ?? [],
    missingCategories: r.progress.missingCategories ?? [],
    coursesHave: r.courses.length,
    coursesNeed,
    creditsHave: r.courses.reduce((s, c) => s + c.credits, 0),
    creditsNeed,
    fraction: r.fraction,
    proven: true,
  };
}

export { selectLayers } from "./select";
export { courseMatchesRule } from "./rules";
export type { RuleContext } from "./rules";
export type * from "./types";
