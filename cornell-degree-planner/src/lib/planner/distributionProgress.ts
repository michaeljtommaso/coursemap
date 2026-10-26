import type { Course } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { StudentPrefs } from "@/services/profile";
import { buildMatchPool } from "./matchAdapters";
import { selectLayers, solve } from "./distribution";
import type {
  CourseRule,
  Layer,
  LayerKind,
  Row,
  RowResult,
  RowStatus,
} from "./distribution";
import type {
  DistributionItemInfo,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  RequirementStatus,
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
 *   courses  = buildMatchPool (board order + the credit profile).
 *   result   = solve() — solver plus the independent checker.
 *
 * Rows become items keyed `${layerId}:${rowId}` (the waiver key), grouped by
 * layer then the row's `group` heading ("College · Distribution").
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
  creditProfile: CreditEntry[];
  waivedRequirementIds: string[];
  canonical?: (id: string) => string;
  /** The cross-listing alias map behind `canonical`; gives each course its
   *  cross-listed subjects (CALS credit for a course cross-listed with a CALS
   *  prefix). Absent → no course carries any. */
  aliases?: Record<string, string>;
  /** Full catalog docs (credits are authoritative there: a fixed 0-credit
   *  course counts 0, not the default 3). */
  courseDetails?: Record<string, Course>;
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

  const courses = buildMatchPool({
    placements,
    placedCourses,
    creditProfile,
    aliases: input.aliases,
    details: input.courseDetails,
  });
  const result = solve({
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
  });

  // canonical course id → the ONE placement carrying it (board order, first
  // wins — buildMatchPool's dedup), and → its display code.
  const placementByCourse = new Map<string, string>();
  const ordered = placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.sem - b.p.sem || a.p.order - b.p.order || a.i - b.i);
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
  const byBoard = (a: string, b: string) =>
    (boardIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (boardIndex.get(b) ?? Number.MAX_SAFE_INTEGER);

  const defs = new Map<string, Row>();
  for (const l of layers) for (const r of l.rows) defs.set(`${l.id}:${r.id}`, r);
  const kindOf = new Map(layers.map((l) => [l.id, l.kind]));

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
      });
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

  const items = groups.flatMap((g) => g.items).filter(scored);
  const major = layers.find((l) => l.kind === "major");
  const college = layers.find((l) => l.kind === "college");
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
  };
}

type ItemEnv = {
  placementByCourse: Map<string, string>;
  codeOf: (canonicalId: string) => string;
  byBoard: (a: string, b: string) => number;
};

function toItem(row: RowResult, layerKind: LayerKind, def: Row | undefined, env: ItemEnv): RequirementItem {
  const status = STATUS[row.status];
  const courseIds = [...new Set(row.courses.map((c) => c.courseId))].sort(env.byBoard);
  const coveredBy = courseIds
    .map((cid) => env.placementByCourse.get(cid))
    .filter((pid): pid is string => pid != null);
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
    countedCodes: courseIds.map(env.codeOf),
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
