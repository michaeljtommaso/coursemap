import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { StudentPrefs } from "@/services/profile";
import { buildMatchPool, type PoolCreditEntry } from "./matchAdapters";
import { columnKey, refOf } from "./terms";
import { creditEntryByCourse, isCreditOnlyCourseId, pushUnique } from "./creditPool";
import { selectLayers, solve } from "./distribution";
import type {
  Answers,
  CourseRule,
  DistributionResult,
  Layer,
  LayerKind,
  MarkValue,
  Question,
  Row,
  RowResult,
  RowStatus,
  SolveInput,
} from "./distribution";
import { applyCourseMarks } from "./questions/applyCourseMarks";
import { openQuestions, type OpenQuestion } from "./questions/openQuestions";
import { parseRef, questionRef } from "./questions/keys";
import { answeredLine, questionText, type QuestionLabels } from "./questions/registry";
import type {
  AnswerListEntry,
  DistributionItemInfo,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  RequirementStatus,
  RowAnswerInfo,
  RowQuestionInfo,
} from "@/hooks/useRequirementProgress";

/**
 * distributionProgress.ts (spec 019 D9) — the PURE adapter from the
 * Distribution engine (CAS / CALS layers, `solve()`) to the
 * useRequirementProgress contract, so the Still-needed panel, the course
 * cards' "counts toward" labels and every other reader work for both engine
 * families unchanged.
 *
 *   layers   = selectLayers(program's layers, student context) — college,
 *              major (and concentration). When the selection needs an answer
 *              the student hasn't given, or a layer is missing or failed to
 *              validate, NO rows are shown: the result carries a `notice`
 *              instead (never a guessed curriculum).
 *   courses  = buildMatchPool (board order + the credit profile), then the
 *              student's credit marks (applyCourseMarks, spec 020 D9).
 *   result   = solve() — solver plus the independent checker — with the
 *              student's answers (spec 020 D4: an answer is an engine input).
 *   open     = openQuestions() — the unanswered questions whose "yes" would
 *              improve a row (spec 020 D3); each lands on its rows as
 *              `dist.questions`, and the answers a row is counted with as
 *              `dist.answered`.
 *
 * Rows become items keyed `${layerId}:${rowId}` (the waiver key), grouped by
 * layer then the row's `group` heading ("College · Distribution").
 *
 * Credit is named where it counts (spec 028 D7): a row counting a credit
 * course carries that entry's label in `creditLabels` (credit totals too), and
 * `creditFills` maps each credit entry id to the rows its courses count
 * toward — like the cards' labels, credit-total rows ("120 credits") are left
 * out of it, since they would name every credit with the same line.
 */

export type DistributionProgressInput = {
  /** Every valid layer the program can need (ProgramData.layers). undefined →
   *  still loading. */
  layers: Layer[] | undefined;
  /** Layers dropped by the loader (missing, or failed schema/lint). */
  layerErrors?: string[];
  programId: string;
  family: "cas" | "cals";
  programStatus: "visible" | "hidden";
  ctx: Pick<StudentPrefs, "entryTerm" | "transfer" | "transferStanding"> &
    Partial<Pick<StudentPrefs, "concentration">>;
  placements: Placement[];
  /** courseId → course (enriched when available, so tag rules see attrs). */
  placedCourses: Record<string, Course>;
  /** Saved or resolved (useCreditProfile().resolved) credit entries. */
  creditProfile: PoolCreditEntry[];
  waivedRequirementIds: string[];
  canonical?: (id: string) => string;
  /** The cross-listing alias map behind `canonical`; gives each course its
   *  cross-listed subjects (CALS credit for a course cross-listed with a CALS
   *  prefix). Absent → no course carries any. */
  aliases?: Record<string, string>;
  /** Full catalog docs (credits are authoritative there: a fixed 0-credit
   *  course counts 0, not the default 3). */
  courseDetails?: Record<string, Course>;
  /** Spec 020: the student's answers — course marks from this plan, facts
   *  from the profile. Absent → no answers (today's strict result). */
  answers?: Partial<Answers>;
  /** Force the college layer (spec 020 D6: a share carries the rule set, not
   *  the answers behind it). */
  collegeLayerId?: string;
  /** Program id → display name (the program index), so a fact question about
   *  another program (a college layer asking "accepted to AEM?") names it. */
  programNames?: Record<string, string>;
  /** Skip the open-question search (one extra solve per candidate question).
   *  For a what-if solve whose questions nobody reads (spec 028 D11: the
   *  tried classes' result); rows then carry no `questions` and the result
   *  no `openQuestionCount`. */
  skipOpenQuestions?: boolean;
};

const LAYER_KIND_LABEL: Record<LayerKind, string> = {
  college: "College",
  major: "Major",
  concentration: "Concentration",
};

/** Engine status → the shared RequirementStatus (contract mapping in
 *  useRequirementProgress.ts DistributionItemInfo). */
const STATUS: Record<RowStatus, RequirementStatus> = {
  met: "satisfied",
  partial: "partial",
  unmet: "unmet",
  waived: "waived",
  unchecked: "unmet",
  confirm: "unmet",
};

function base(notice?: RequirementProgress["notice"]): RequirementProgress {
  return {
    groups: [],
    attribution: {},
    satisfiedCount: 0,
    total: 0,
    engine: "distribution",
    ...(notice ? { notice } : {}),
  };
}

/** A layer row by its waiver key `${layerId}:${rowId}` (top-level rows only:
 *  anyOf options are not keyed on their own). */
export function findLayerRow(
  layers: readonly Layer[] | undefined,
  key: string
): { layer: Layer; row: Row } | null {
  const at = key.indexOf(":");
  if (at <= 0 || !layers) return null;
  const layerId = key.slice(0, at);
  const rowId = key.slice(at + 1);
  const layer = layers.find((l) => l.id === layerId);
  const row = layer?.rows.find((r) => r.id === rowId);
  return layer && row ? { layer, row } : null;
}

/**
 * The rule a course must match to help a row (spec 019 D9 "Find a class from
 * a row"), or null when the row can't narrow a search (confirm rows). A
 * distribution row narrows to its eligibility rule AND the categories still
 * missing (every category when none are named); an anyOf row to any option.
 */
export function layerRowFilterRule(row: Row, missingCategoryIds?: readonly string[]): CourseRule | null {
  switch (row.kind) {
    case "seat":
    case "pool":
    case "credits":
      return row.rule;
    case "distribution": {
      const missing = new Set(missingCategoryIds ?? []);
      const cats = row.categories.filter((c) => missing.has(c.id));
      const anyCategory: CourseRule = { anyOf: (cats.length > 0 ? cats : row.categories).map((c) => c.rule) };
      return row.rule ? { allOf: [row.rule, anyCategory] } : anyCategory;
    }
    case "anyOf": {
      const options = row.rows.map((c) => layerRowFilterRule(c)).filter((r): r is CourseRule => r != null);
      return options.length > 0 ? { anyOf: options } : null;
    }
    case "confirm":
      return null;
  }
}

/** The pure transformation (unit-tested). */
export function computeDistributionProgress(input: DistributionProgressInput): RequirementProgress {
  const {
    layers: allLayers,
    layerErrors = [],
    programId,
    family,
    programStatus,
    ctx,
    placements,
    placedCourses,
    creditProfile,
    waivedRequirementIds,
    canonical = (id: string) => id,
    programNames,
  } = input;

  if (programStatus === "hidden") return base({ kind: "under-review" });
  if (!allLayers) return base();

  // The student's concentration choice counts only for the major it was made
  // for (switching majors invalidates it), once per id.
  const stored = ctx.concentration;
  const chosenIds = stored && stored.programId === programId ? [...new Set(stored.ids)] : [];

  const selected = selectLayers(allLayers, {
    family,
    programId,
    entryTerm: ctx.entryTerm,
    transfer: ctx.transfer,
    transferStanding: ctx.transferStanding,
    concentrationIds: chosenIds,
    ...(input.collegeLayerId ? { collegeLayerId: input.collegeLayerId } : {}),
  });
  switch (selected.problem) {
    case "needs-entry-term":
    case "needs-transfer":
    case "needs-transfer-standing":
      // The student answers first (spec 019 deviation 7): never guess.
      return base({ kind: selected.problem });
    case "no-college-layer":
    case "ambiguous-college-layer":
    case "no-major-layer":
      return base({ kind: "layers-unavailable" });
  }
  // A dropped college or major layer could change which version applies (a
  // missing pre-2025 layer would hand a pre-2025 student the 2025 rules), so
  // any load error outside the program's concentrations stops the panel.
  if (layerErrors.some((id) => !id.startsWith(`${programId}--`))) {
    return base({ kind: "layers-unavailable" });
  }
  const layers = selected.layers;

  // Concentrations (spec 019 Phase 5). Never a silent drop: a chosen id whose
  // layer isn't loaded does not count as chosen, and a required concentration
  // that can't be offered in full stops the panel.
  const majorLayer = layers.find((l) => l.kind === "major");
  const offered = allLayers.filter(
    (l) => l.kind === "concentration" && l.family === family && l.programId === programId && l.concentrationId
  );
  const need = majorLayer?.concentrations ?? { min: 0, max: 1 };
  const concentrationErrors = layerErrors.some((id) => id.startsWith(`${programId}--`));
  const validChosen = chosenIds.filter((id) => offered.some((l) => l.concentrationId === id));
  if (need.min > 0 && (offered.length === 0 || concentrationErrors)) {
    return base({ kind: "layers-unavailable" });
  }
  if (concentrationErrors && validChosen.length < chosenIds.length) {
    // The student's pick is one that failed to load: its rows would be missing.
    return base({ kind: "layers-unavailable" });
  }
  const concentrations: RequirementProgress["concentrations"] =
    offered.length > 0
      ? {
          min: need.min,
          max: need.max,
          options: offered.map((l) => ({ id: l.concentrationId!, name: l.name })),
          chosen: validChosen,
          needed: validChosen.length < need.min || validChosen.length > need.max,
        }
      : undefined;

  const layerIds = new Set(layers.map((l) => l.id));
  const waived = waivedRequirementIds.filter((id) => {
    const at = id.indexOf(":");
    return at > 0 && layerIds.has(id.slice(0, at));
  });

  // Credits chosen on variable-credit courses (chosenCredits.ts) come from the
  // same marks, so a solve without one answer rebuilds the pool without it.
  const poolFor = (courseMarks: Record<string, MarkValue> | undefined) =>
    buildMatchPool({
      placements,
      placedCourses,
      creditProfile,
      aliases: input.aliases,
      details: input.courseDetails,
      courseMarks,
    });
  const pool = poolFor(input.answers?.marks);
  const answers: Answers = { marks: input.answers?.marks ?? {}, facts: input.answers?.facts ?? {} };
  const hasAnswers = Object.keys(answers.marks).length > 0 || Object.keys(answers.facts).length > 0;
  // Credit marks change a course's credits before solving, so the engine and
  // the checker see the same courses (spec 020 D9).
  const courses = hasAnswers ? applyCourseMarks(pool, layers, answers.marks, canonical) : pool;
  const solveInput: SolveInput = {
    layers,
    courses,
    ctx: {
      programId,
      entryTerm: ctx.entryTerm,
      transfer: ctx.transfer,
      transferStanding: ctx.transferStanding,
    },
    waived,
    canonical,
    ...(hasAnswers ? { answers } : {}),
  };
  const result = solve(solveInput);
  // One extra solve per candidate question, and none when no layer asks
  // anything the board could answer (openQuestions skips without solving).
  const open =
    !input.skipOpenQuestions && layers.some((l) => (l.questions?.length ?? 0) > 0)
      ? openQuestions(solveInput, result, solve)
      : [];

  // canonical course id → the ONE placement carrying it (board order, first
  // wins — buildMatchPool's dedup), and → its display code.
  const placementByCourse = new Map<string, string>();
  // Board order is time order (spec 042): short terms by terms.ts columnKey.
  const ordered = placements
    .map((p, i) => ({ p, i, key: columnKey(refOf(p)) }))
    .sort((a, b) => a.key - b.key || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    const cid = canonical(p.courseId);
    if (!placementByCourse.has(cid)) placementByCourse.set(cid, p.id);
  }
  const codeByCourse = new Map<string, string>();
  const boardIndex = new Map<string, number>();
  courses.forEach((c, i) => {
    const cid = canonical(c.id);
    if (!codeByCourse.has(cid)) codeByCourse.set(cid, `${c.subject} ${c.number}`.trim());
    if (!boardIndex.has(cid)) boardIndex.set(cid, i);
  });
  const codeOf = (cid: string) => codeByCourse.get(cid) ?? cid.replace(/-/g, " ");
  // Spec 028 D7: credit courses (not on the board) → the entry carrying them.
  const creditByCourse = creditEntryByCourse(
    creditProfile,
    placements.map((p) => p.courseId),
    canonical
  );
  const byBoard = (a: string, b: string) =>
    (boardIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (boardIndex.get(b) ?? Number.MAX_SAFE_INTEGER);

  const defs = new Map<string, Row>();
  for (const l of layers) for (const r of l.rows) defs.set(`${l.id}:${r.id}`, r);
  const kindOf = new Map(layers.map((l) => [l.id, l.kind]));

  const questionEnv = buildQuestionEnv({
    layers,
    allLayers,
    programNames,
    answers,
    open,
    result,
    codeOf,
    onBoard: (cid) => boardIndex.has(canonical(cid)),
    canonical,
    // The board solved with every answer but one: the per-answer baseline a
    // credit mark's or a fact's "counted because you said" line is checked
    // against. One extra solve per active credit mark or "yes" fact a
    // selected layer declares (none when there are none).
    withoutAnswer: (key, scope) => {
      const marks = { ...answers.marks };
      const facts = { ...answers.facts };
      if (scope === "mark") delete marks[key];
      else delete facts[key];
      return solve({
        ...solveInput,
        courses: applyCourseMarks(scope === "mark" ? poolFor(marks) : pool, layers, marks, canonical),
        answers: { marks, facts },
      });
    },
  });

  const groups: RequirementGroup[] = [];
  const labelByKey = new Map<string, string>();
  const isDone = (it: RequirementItem) => it.status === "satisfied" || it.status === "waived";
  const scored = (it: RequirementItem) => !it.dist?.confirm;

  for (const layer of result.layers) {
    const layerKind = kindOf.get(layer.layerId) ?? layer.kind;
    const byGroup = new Map<string, RequirementItem[]>();
    for (const row of layer.rows) {
      const key = `${layer.layerId}:${row.rowId}`;
      labelByKey.set(key, row.label);
      const item = toItem(row, layerKind, defs.get(key), {
        placementByCourse,
        codeOf,
        byBoard,
        creditByCourse,
      });
      const questions = questionEnv.questionsByItem.get(key);
      const answered = questionEnv.answeredByItem.get(key);
      if (item.dist && questions && questions.length > 0) item.dist.questions = questions;
      if (item.dist && answered && answered.length > 0) item.dist.answered = answered;
      const list = byGroup.get(row.group) ?? [];
      list.push(item);
      byGroup.set(row.group, list);
    }
    for (const [group, items] of byGroup) {
      const counted = items.filter(scored);
      groups.push({
        key: `${layer.layerId}:${group}`,
        label: `${LAYER_KIND_LABEL[layerKind]} · ${group}`,
        items,
        satisfiedCount: counted.filter(isDone).length,
        total: counted.length,
      });
    }
  }

  // Card labels: every row counting the course (a course counting in the
  // college AND the major layer shows both, D9). Credit totals ("120
  // academic credits") count nearly every course, so they'd label every card
  // with the same line; they stay off the cards.
  const attribution: Record<string, string[]> = {};
  for (const [cid, rows] of Object.entries(result.attribution)) {
    const pid = placementByCourse.get(cid);
    if (!pid) continue; // counted by credit only (no card on the board)
    for (const { layerId, rowId } of rows) {
      const key = `${layerId}:${rowId}`;
      if (defs.get(key)?.kind === "credits") continue;
      const label = labelByKey.get(key);
      if (label) (attribution[pid] ??= []).push(label);
    }
  }

  // Credit entry id → the rows its courses count toward (D7).
  const creditFills: Record<string, string[]> = {};
  for (const [cid, rows] of Object.entries(result.attribution)) {
    const entry = creditByCourse.get(cid);
    if (!entry) continue;
    for (const { layerId, rowId } of rows) {
      const key = `${layerId}:${rowId}`;
      if (defs.get(key)?.kind === "credits") continue;
      const label = labelByKey.get(key);
      if (label) pushUnique(creditFills, entry.id, label);
    }
  }

  const items = groups.flatMap((g) => g.items).filter(scored);
  const major = layers.find((l) => l.kind === "major");
  const college = layers.find((l) => l.kind === "college");

  // Spec 045 D6: credit before Cornell, and how much of it the college's
  // degree-total row (its largest credits row, where a cap on outside credit
  // lives as a row limit) actually counts.
  let creditCount: { counted: number; total: number } | undefined;
  if (creditByCourse.size > 0) {
    const creditCredits = new Map<string, number>();
    for (const c of courses) {
      const cid = canonical(c.id);
      if (creditByCourse.has(cid) && !creditCredits.has(cid)) creditCredits.set(cid, c.credits);
    }
    const total = [...creditCredits.values()].reduce((a, b) => a + b, 0);
    let degreeRow: { row: (typeof result.layers)[number]["rows"][number]; need: number } | undefined;
    for (const r of result.layers.find((l) => l.layerId === college?.id)?.rows ?? []) {
      const def = defs.get(`${college!.id}:${r.rowId}`);
      if (def?.kind !== "credits") continue;
      if (!degreeRow || def.requiredCredits > degreeRow.need) degreeRow = { row: r, need: def.requiredCredits };
    }
    const counted = degreeRow
      ? degreeRow.row.courses.filter((c) => creditCredits.has(c.courseId)).reduce((a, c) => a + c.credits, 0)
      : total;
    if (total > 0) creditCount = { counted, total };
  }
  return {
    groups,
    attribution,
    satisfiedCount: items.filter(isDone).length,
    total: items.length,
    engine: "distribution",
    catalogYear: major?.catalogYear ?? college?.catalogYear,
    collegeVersion: college?.name,
    // An unpicked required concentration is an unmet requirement the engine
    // can't see: never read as complete.
    pct: concentrations?.needed ? Math.min(result.pct, 99) : result.pct,
    ...(concentrations ? { concentrations } : {}),
    ...(college ? { collegeLayerId: college.id } : {}),
    ...(questionEnv.openCount > 0 ? { openQuestionCount: questionEnv.openCount } : {}),
    ...(creditCount ? { creditCount } : {}),
    ...(questionEnv.answerList.length > 0 ? { answers: questionEnv.answerList } : {}),
    ...(Object.keys(creditFills).length > 0 ? { creditFills } : {}),
  };
}

type ItemEnv = {
  placementByCourse: Map<string, string>;
  /** Canonical credit course id → the credit entry carrying it (D7). */
  creditByCourse: Map<string, PoolCreditEntry>;
  codeOf: (canonicalId: string) => string;
  byBoard: (a: string, b: string) => number;
};

function toItem(row: RowResult, layerKind: LayerKind, def: Row | undefined, env: ItemEnv): RequirementItem {
  const status = STATUS[row.status];
  const courseIds = [...new Set(row.courses.map((c) => c.courseId))].sort(env.byBoard);
  const coveredBy = courseIds
    .map((cid) => env.placementByCourse.get(cid))
    .filter((pid): pid is string => pid != null);
  const creditLabels: string[] = [];
  for (const cid of courseIds) {
    const label = env.placementByCourse.has(cid) ? undefined : env.creditByCourse.get(cid)?.label;
    if (label && !creditLabels.includes(label)) creditLabels.push(label);
  }
  // anyOf rows: the option in progress — the met one, else the furthest along
  // (first wins a tie). Its figures are the ones the panel shows.
  let activeOption: number | undefined;
  if (row.children && row.children.length > 0) {
    const kids = row.children;
    const metAt = kids.findIndex((c) => c.status === "met");
    activeOption = metAt >= 0 ? metAt : kids.reduce((best, c, i) => (c.fraction > kids[best].fraction ? i : best), 0);
  }
  const p = activeOption != null ? row.children![activeOption].progress : row.progress;

  const dist: DistributionItemInfo = {
    layerId: row.layerId,
    rowId: row.rowId,
    layerKind,
    rowKind: row.kind,
    engineStatus: row.status,
    ...(row.status === "confirm" ? { confirm: true } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(p.coursesHave != null ? { coursesHave: p.coursesHave } : {}),
    ...(p.coursesNeed != null ? { coursesNeed: p.coursesNeed } : {}),
    ...(p.creditsHave != null ? { creditsHave: p.creditsHave } : {}),
    ...(p.creditsNeed != null ? { creditsNeed: p.creditsNeed } : {}),
    // A credit-only course ("credit:<entry>") has no code; creditLabels names it.
    countedCodes: courseIds.filter((id) => !isCreditOnlyCourseId(id)).map(env.codeOf),
    ...(def?.note ? { note: def.note } : {}),
  };

  if (def?.kind === "distribution") {
    const have = new Set(p.categoriesHave ?? []);
    const missing = new Set(p.missingCategories ?? []);
    dist.categories = def.categories.map((c) => ({
      id: c.id,
      label: c.label,
      filled: have.has(c.id),
      missing: missing.has(c.id),
    }));
    dist.categoriesHave = have.size;
    dist.categoriesNeed = p.categoriesNeed ?? def.minDistinctCategories;
  }

  if (row.children && activeOption != null) {
    dist.options = row.children.map((c) => ({
      label: c.label,
      status: STATUS[c.status],
      fraction: c.fraction,
    }));
    dist.activeOption = activeOption;
  }

  return {
    id: `${row.layerId}:${row.rowId}`,
    label: row.label,
    category: null,
    suggestedSem: null,
    status,
    coveredBy: status === "waived" ? [] : coveredBy,
    checkable: row.status !== "unchecked" && row.status !== "confirm",
    requirement: null,
    ...(status !== "waived" && creditLabels.length > 0 ? { creditLabels } : {}),
    ...(row.kind === "pool" && p.coursesNeed != null && p.creditsNeed != null
      ? {
          poolProgress: {
            courses: p.coursesHave ?? 0,
            requiredCourses: p.coursesNeed,
            credits: p.creditsHave ?? 0,
            requiredCredits: p.creditsNeed,
          },
        }
      : {}),
    dist,
  };
}

// ─── Spec 020: questions and answers on the rows ────────────────────────────

type QuestionEnvInput = {
  /** The selected layers (what the student is scored on). */
  layers: Layer[];
  /** Every layer the program can need: wording for a question no selected
   *  layer asks any more. */
  allLayers: Layer[];
  programNames?: Record<string, string>;
  answers: Answers;
  open: OpenQuestion[];
  result: DistributionResult;
  codeOf: (canonicalId: string) => string;
  onBoard: (courseId: string) => boolean;
  canonical: (id: string) => string;
  /** The board solved with every answer except this one (lazy: only run for
   *  an active credit mark or a "yes" fact, at most once per answer). */
  withoutAnswer: (key: string, scope: "mark" | "fact") => DistributionResult;
};

type QuestionEnv = {
  questionsByItem: Map<string, RowQuestionInfo[]>;
  answeredByItem: Map<string, RowAnswerInfo[]>;
  /** Distinct open questions shown on at least one row. */
  openCount: number;
  answerList: AnswerListEntry[];
};

type Declared = { layer: Layer; question: Question };

function credits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

function inputOf(q: Question | undefined, value?: MarkValue): RowQuestionInfo["input"] {
  if (q?.type === "creditsTaken") return { kind: "credits", values: [...q.values] };
  if (!q && typeof value === "number") return { kind: "credits", values: [value] };
  return { kind: "yesno" };
}

function valueLabel(value: MarkValue): string {
  if (typeof value === "number") return credits(value);
  return value === "yes" ? "Yes" : "No";
}

/** Every `answered` ref a row reads (its rule, categories, limits, options). */
function answeredRefs(row: Row): Set<string> {
  const out = new Set<string>();
  const walk = (rule: CourseRule | undefined) => {
    if (!rule) return;
    if ("allOf" in rule) rule.allOf.forEach(walk);
    else if ("anyOf" in rule) rule.anyOf.forEach(walk);
    else if ("not" in rule) walk(rule.not);
    else if ("answered" in rule) out.add(rule.answered);
  };
  const visit = (r: Row) => {
    switch (r.kind) {
      case "seat":
        walk(r.rule);
        break;
      case "pool":
      case "credits":
        walk(r.rule);
        for (const l of r.limits ?? []) walk(l.rule);
        break;
      case "distribution":
        walk(r.rule);
        for (const c of r.categories) walk(c.rule);
        for (const l of r.limits ?? []) walk(l.rule);
        break;
      case "anyOf":
        r.rows.forEach(visit);
        break;
      case "confirm":
        break;
    }
  };
  visit(row);
  return out;
}

/** A row result's identity for "did the answer change it": status, the
 *  courses counted (with their credits) and the figures shown. */
function rowSignature(r: RowResult | undefined): string {
  return r ? JSON.stringify([r.status, r.courses, r.progress, (r.children ?? []).map((c) => c.status)]) : "";
}

function countsCourse(r: RowResult | undefined, courseId: string): boolean {
  if (!r) return false;
  if (r.courses.some((c) => c.courseId === courseId)) return true;
  return (r.children ?? []).some((child) => child.courses.some((c) => c.courseId === courseId));
}

/** Questions on rows, "counted because you said" lines and the answers list. */
function buildQuestionEnv(env: QuestionEnvInput): QuestionEnv {
  const { layers, allLayers, programNames, answers, open, result, codeOf, onBoard, canonical } = env;

  // `${layerId}:${rowId}` (anyOf options included) → top-level row id, label.
  const topOf = new Map<string, string>();
  const rowLabel = new Map<string, string>();
  const topRows = new Map<string, Row>();
  for (const l of layers) {
    for (const r of l.rows) {
      topOf.set(`${l.id}:${r.id}`, r.id);
      rowLabel.set(`${l.id}:${r.id}`, r.label);
      topRows.set(`${l.id}:${r.id}`, r);
      if (r.kind === "anyOf") {
        for (const c of r.rows) {
          topOf.set(`${l.id}:${c.id}`, r.id);
          rowLabel.set(`${l.id}:${c.id}`, c.label);
        }
      }
    }
  }
  const resultRow = new Map<string, RowResult>();
  for (const l of result.layers) for (const r of l.rows) resultRow.set(`${l.layerId}:${r.rowId}`, r);
  const itemOf = (layerId: string, rowId: string) => `${layerId}:${topOf.get(`${layerId}:${rowId}`) ?? rowId}`;

  const programLabel = (subject: string): string | undefined =>
    allLayers.find(
      (l) => l.kind === "major" && l.programId != null && (l.programId === subject || l.programId.startsWith(`${subject}-`))
    )?.name ?? programNames?.[subject];

  const labelsFor = (layerId: string, q: Question, courseId?: string): QuestionLabels => {
    const course = courseId ?? ("course" in q ? canonical(q.course) : undefined);
    const row = "row" in q && q.row != null ? rowLabel.get(`${layerId}:${q.row}`) : undefined;
    const program = q.type === "studentFact" ? programLabel(q.subject) : undefined;
    return {
      ...(course != null ? { course: codeOf(course) } : {}),
      ...(row != null ? { row } : {}),
      ...(program != null ? { program } : {}),
    };
  };

  const declaredIn = (pool: readonly Layer[], ref: string): Declared | undefined => {
    for (const layer of pool) {
      for (const question of layer.questions ?? []) {
        if (questionRef(layer.id, question) === ref) return { layer, question };
      }
    }
    return undefined;
  };

  // ── Open questions → the rows they could improve ──
  const questionsByItem = new Map<string, RowQuestionInfo[]>();
  const shown = new Set<string>();
  for (const oq of open) {
    const q = oq.question;
    const text = questionText(q, labelsFor(oq.layerId, q, oq.courseId));
    const course = oq.courseId ?? ("course" in q ? canonical(q.course) : undefined);
    const info: RowQuestionInfo = {
      key: oq.key,
      scope: q.type === "studentFact" ? "fact" : "mark",
      prompt: text.prompt,
      detail: text.detail,
      input: inputOf(q),
      ...(course != null ? { courseCode: codeOf(course) } : {}),
    };
    for (const { layerId, rowId } of oq.rows) {
      if (!topOf.has(`${layerId}:${rowId}`)) continue;
      {
        const itemKey = itemOf(layerId, rowId);
        const list = questionsByItem.get(itemKey) ?? [];
        if (!list.some((x) => x.key === info.key)) list.push(info);
        questionsByItem.set(itemKey, list);
        shown.add(info.key);
      }
    }
  }

  // ── Answers a row is counted with ──
  const answeredByItem = new Map<string, RowAnswerInfo[]>();
  const addAnswered = (itemKey: string, info: RowAnswerInfo) => {
    const list = answeredByItem.get(itemKey) ?? [];
    if (!list.some((x) => x.key === info.key)) list.push(info);
    answeredByItem.set(itemKey, list);
  };
  // Did THIS answer change the row? Compared against the board solved with
  // every other answer kept, so a line never lands on a row another answer
  // changed.
  const baselines = new Map<string, Map<string, RowResult>>();
  const changed = (key: string, scope: "mark" | "fact", itemKey: string): boolean => {
    const memoKey = `${scope}|${key}`;
    let baseline = baselines.get(memoKey);
    if (!baseline) {
      baseline = new Map<string, RowResult>();
      for (const l of env.withoutAnswer(key, scope).layers) for (const r of l.rows) baseline.set(`${l.layerId}:${r.rowId}`, r);
      baselines.set(memoKey, baseline);
    }
    return rowSignature(baseline.get(itemKey)) !== rowSignature(resultRow.get(itemKey));
  };

  for (const [key, value] of Object.entries(answers.marks)) {
    const at = key.indexOf("@");
    const found = declaredIn(layers, at >= 0 ? key.slice(0, at) : key);
    if (!found) continue;
    const { layer, question: q } = found;
    if ((q.type === "usedAs" || q.type === "approvedFor" || q.type === "courseCondition") && at >= 0) {
      // Row-scoped: shown on the target row while it counts the course.
      if (value !== "yes") continue;
      const courseId = canonical(key.slice(at + 1));
      const itemKey = itemOf(layer.id, q.row);
      if (!countsCourse(resultRow.get(itemKey), courseId)) continue;
      addAnswered(itemKey, { key, scope: "mark", line: answeredLine(q, value, labelsFor(layer.id, q, courseId)) });
    } else if (q.type === "creditsTaken" || q.type === "sequenceDone") {
      // Credit marks: every row counting the course that the answer changed.
      const active = q.type === "creditsTaken" ? typeof value === "number" && q.values.includes(value) : value === "yes";
      if (!active) continue;
      const courseId = canonical(q.course);
      const line = answeredLine(q, value, labelsFor(layer.id, q));
      for (const itemKey of resultRow.keys()) {
        if (countsCourse(resultRow.get(itemKey), courseId) && changed(key, "mark", itemKey)) {
          addAnswered(itemKey, { key, scope: "mark", line });
        }
      }
    }
  }
  for (const [key, value] of Object.entries(answers.facts)) {
    if (value !== "yes") continue;
    const found = declaredIn(layers, key);
    if (!found || found.question.type !== "studentFact") continue;
    const { layer, question: q } = found;
    const line = answeredLine(q, value, labelsFor(layer.id, q));
    // Facts: the question's row, else every row whose rule reads the fact —
    // only where the answer changed the result.
    const targets =
      q.row != null
        ? [itemOf(layer.id, q.row)]
        : [...topRows.entries()].filter(([, row]) => answeredRefs(row).has(key)).map(([k]) => k);
    for (const itemKey of targets) {
      if (changed(key, "fact", itemKey)) addAnswered(itemKey, { key, scope: "fact", line });
    }
  }

  // ── "Your answers": every stored mark and fact ──
  const answerList: AnswerListEntry[] = [];
  const entry = (key: string, value: MarkValue, scope: "mark" | "fact") => {
    const at = key.indexOf("@");
    const ref = at >= 0 ? key.slice(0, at) : key;
    const parsed = parseRef(ref);
    const asked = declaredIn(layers, ref);
    const found = asked ?? declaredIn(allLayers, ref);
    // Credits chosen on a course card that no layer asks about belong to the
    // card (chosenCredits.ts), not to this list.
    if (!found && parsed?.type === "creditsTaken") return;
    const course =
      at >= 0 ? canonical(key.slice(at + 1)) : parsed && "course" in parsed ? canonical(parsed.course) : undefined;
    const state: AnswerListEntry["state"] = !asked
      ? "notAsked"
      : course != null && !onBoard(course)
        ? "hidden"
        : "active";
    const prompt = found
      ? questionText(found.question, labelsFor(found.layer.id, found.question, at >= 0 ? course : undefined)).prompt
      : course != null
        ? `A question about ${codeOf(course)}`
        : "A question that is no longer asked";
    answerList.push({
      key,
      scope,
      prompt,
      valueLabel: valueLabel(value),
      value,
      input: inputOf(found?.question, value),
      state,
    });
  };
  for (const [key, value] of Object.entries(answers.marks)) entry(key, value, "mark");
  for (const [key, value] of Object.entries(answers.facts)) entry(key, value, "fact");

  return { questionsByItem, answeredByItem, openCount: shown.size, answerList };
}
