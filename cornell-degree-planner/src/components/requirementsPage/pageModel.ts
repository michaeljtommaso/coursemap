import type {
  RequirementGroup,
  RequirementItem,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { triedPlacementId } from "@/lib/planner/triedProgress";
import { progressText } from "@/components/requirements/requirementText";
import {
  bindingMeasure,
  groupCount,
  isConfirm,
  isDone,
  isOpen,
  triedPlusOn,
  type CountMeasure,
} from "@/components/rail/groupCount";

/**
 * pageModel (spec 028 D8/D10/D11) — the Requirements page's shape, from
 * `progress.groups` with no new engine logic. Pure and unit-tested.
 *
 *   - Every advisor-only row (isConfirm: `dist.confirm` or a "confirm" row,
 *     the rail's definition) leaves its group and is
 *     collected in one "Check with your advisor (N)" list, shown last.
 *   - Groups are sectioned by layer for Distribution programs (college, then
 *     major, then concentration); an Engineering program is one section.
 *   - A group's progress is the rail's count (rail/groupCount.ts): its one
 *     row's binding count when it has a single counted row ("Distribution
 *     4 of 10", then the course or credit floor still short), else rows done
 *     ("1 of 2"). Done comes from status, never from the numbers.
 *   - Tried classes (D11) add a separate blue "+N", never a met state.
 */

export type LayerKind = "college" | "major" | "concentration";

export type PageGroup = {
  key: string;
  /** "Distribution" (the group label without its "College · " prefix). */
  title: string;
  items: RequirementItem[];
  satisfiedCount: number;
  total: number;
  layerKind: LayerKind | null;
};

export type PageSection = {
  key: LayerKind | "program";
  label: string;
  groups: PageGroup[];
};

export type PageModel = {
  sections: PageSection[];
  /** Every `confirm` row, in group order. */
  advisor: RequirementItem[];
};

export type SectionNames = {
  /** "Arts & Sciences" → the college section reads "Arts & Sciences college". */
  college?: string | null;
  /** The program's name ("Economics (BA)"). */
  program?: string | null;
  /** The chosen concentration name(s). */
  concentration?: string | null;
};

const LAYER_PREFIX = /^(College|Major|Concentration) · /;
const KIND_ORDER: LayerKind[] = ["college", "major", "concentration"];

/** "College · Distribution" → "Distribution"; Engineering labels unchanged.
 *  The name a group goes by on the page's outline and the rail. */
export function groupTitle(label: string): string {
  return label.replace(LAYER_PREFIX, "");
}

export { isConfirm, isDone, isOpen };

function sectionLabel(kind: LayerKind | "program", names: SectionNames): string {
  switch (kind) {
    case "college":
      return names.college ? `${names.college} college` : "College";
    case "major":
      return names.program ?? "Major";
    case "concentration":
      return names.concentration ? `Concentration: ${names.concentration}` : "Concentration";
    case "program":
      return names.program ?? "Your major";
  }
}

export function buildPageModel(
  groups: readonly RequirementGroup[],
  names: SectionNames = {},
  /** Which engine produced the groups. An Engineering program stays one
   *  section even when a row carries distribution info (liberal studies,
   *  spec 037 D9). Absent: sectioned by each group's layer. */
  engine?: "engineering" | "distribution"
): PageModel {
  const advisor: RequirementItem[] = [];
  const byKind = new Map<LayerKind | "program", PageGroup[]>();
  for (const g of groups) {
    const items: RequirementItem[] = [];
    for (const it of g.items) (isConfirm(it) ? advisor : items).push(it);
    if (items.length === 0) continue;
    const layerKind = engine === "engineering" ? null : (items.find((it) => it.dist)?.dist?.layerKind ?? null);
    const kind = layerKind ?? "program";
    const list = byKind.get(kind) ?? [];
    list.push({
      key: g.key,
      title: groupTitle(g.label),
      items,
      // The engine's counts already leave confirm rows out.
      satisfiedCount: g.satisfiedCount,
      total: g.total,
      layerKind,
    });
    byKind.set(kind, list);
  }
  const order: (LayerKind | "program")[] = [...KIND_ORDER, "program"];
  const sections = order
    .filter((k) => byKind.has(k))
    .map((k) => ({ key: k, label: sectionLabel(k, names), groups: byKind.get(k)! }));
  return { sections, advisor };
}

// ── Amounts ──────────────────────────────────────────────────────────────────

export type AmountUnit = "rows" | "categories" | "courses" | "credits";
export type Amount = { have: number; need: number; unit: AmountUnit };

const UNIT_OF: Record<CountMeasure, Exclude<AmountUnit, "rows">> = {
  categories: "categories",
  courses: "courses",
  credits: "credits",
  poolCredits: "credits",
};

/** The unit a row is counted in (its binding count, shared with the rail),
 *  or null for a single-course seat. */
export function rowUnit(it: RequirementItem): Exclude<AmountUnit, "rows"> | null {
  const m = bindingMeasure(it);
  return m ? UNIT_OF[m] : null;
}

export type TriedDelta =
  /** "+2 categories" */
  | { kind: "more"; n: number; unit: Exclude<AmountUnit, "rows"> }
  /** A seat the tried classes would fill. */
  | { kind: "fills" };

/**
 * D11: what the tried classes add to one row — the tried recomputation
 * against the real row, in the real row's binding count (so a tried class
 * that adds the missing course or credits shows, not only a new category).
 * Null when they add nothing.
 * Never a met state: callers keep showing the REAL status.
 */
export function triedDelta(real: RequirementItem, tried: RequirementItem | undefined): TriedDelta | null {
  if (!tried || real.status === "waived" || isConfirm(real) || isDone(real)) return null;
  const m = bindingMeasure(real);
  if (m) {
    const n = triedPlusOn(real, tried) ?? 0;
    return n > 0 ? { kind: "more", n, unit: UNIT_OF[m] } : null;
  }
  return isDone(tried) ? { kind: "fills" } : null;
}

const UNIT_WORD: Record<Exclude<AmountUnit, "rows">, [string, string]> = {
  categories: ["category", "categories"],
  courses: ["course", "courses"],
  credits: ["credit", "credits"],
};

/** "+2 categories if you take what you're trying". */
export function triedDeltaText(d: TriedDelta): string {
  if (d.kind === "fills") return "Filled if you take what you're trying";
  const [one, many] = UNIT_WORD[d.unit];
  return `+${d.n} ${d.n === 1 ? one : many} if you take what you're trying`;
}

export type GroupAmount = Amount & {
  plus: number;
  /** Every counted row is met or waived (status, never the numbers). */
  done: boolean;
};

/**
 * A group's progress for the outline and its card header — the rail's count
 * (groupCount): its single counted row's binding count ("4 of 10"
 * categories), else rows done ("1 of 2"). `plus` is the tried classes' blue
 * addition in the same count.
 */
export function groupAmount(g: Pick<PageGroup, "items">, tried?: TriedProgress): GroupAmount {
  const c = groupCount(g.items, tried);
  if (!c) return { have: 0, need: 0, unit: "rows", plus: 0, done: false };
  return { have: c.have, need: c.need, unit: c.measure ? UNIT_OF[c.measure] : "rows", plus: c.plus, done: c.done };
}

/** Green "Done" / ✓: only when the rows' status is done, whatever the count. */
export function amountDone(a: Pick<GroupAmount, "need" | "done">): boolean {
  return a.need > 0 && a.done;
}

/** "4 of 10", "16 of 120 cr". */
export function formatAmount(a: Amount): string {
  const have = Math.round(a.have * 10) / 10;
  return a.unit === "credits" ? `${have} of ${a.need} cr` : `${have} of ${a.need}`;
}

// ── Row wording ──────────────────────────────────────────────────────────────

/** What counts on a row, named: board courses, then credit by name ("AP
 *  Calculus BC (5)", D7). Falls back to the engine's counted codes. */
export function countedNames(it: RequirementItem, boardCodes: readonly string[]): string[] {
  const credit = it.creditLabels ?? [];
  if (boardCodes.length > 0 || credit.length > 0) return [...boardCodes, ...credit];
  return it.dist?.countedCodes ?? [];
}

/** "4 of 6 courses · 12 of 18 credits", "Option 2 in progress: …", or "". */
export function howFar(it: RequirementItem): string {
  const d = it.dist;
  if (d) {
    const p = progressText(d);
    if (d.rowKind === "anyOf" && d.activeOption != null && it.status === "partial") {
      return `Option ${d.activeOption + 1} in progress${p ? `: ${p}` : ""}`;
    }
    return p;
  }
  const pool = it.poolProgress;
  if (pool) {
    return pool.courses < pool.requiredCourses || pool.requiredCredits <= 0
      ? `${pool.courses} of ${pool.requiredCourses} courses`
      : `${pool.credits} of ${pool.requiredCredits} credits`;
  }
  return "";
}

/** Names this many or fewer go inline on the detail line; more go in the
 *  "Counting" chips. */
export const INLINE_NAMES = 3;

/**
 * The row's detail line: "1 of 2 courses: HIST 1200", "AP Calculus BC (5)",
 * "Waived", "Nothing counted yet". Credit is always named, never "Your credit".
 */
export function rowDetail(it: RequirementItem, names: readonly string[]): string {
  if (it.status === "waived") return "Waived";
  const engine = it.dist?.engineStatus;
  if (engine === "confirm") return "Confirm with your advisor";
  if (engine === "unchecked") return "Can't check this automatically";
  if (!it.dist && !it.checkable && it.status === "unmet") {
    return "Can't check this automatically. Confirm with your advisor";
  }
  const how = howFar(it);
  const inline = names.length > 0 && names.length <= INLINE_NAMES ? names.join(", ") : "";
  if (how) return inline ? `${how}: ${inline}` : how;
  if (names.length > 0) return names.join(", ");
  if (it.status === "satisfied") return "Counted from credit before Cornell";
  return "Nothing counted yet";
}

const TRIED_PREFIX = triedPlacementId("");

/** Course ids the tried classes add to a row (their virtual placements). */
export function triedCourseIdsOn(real: RequirementItem, tried: RequirementItem | undefined): string[] {
  if (!tried) return [];
  const have = new Set(real.coveredBy);
  return tried.coveredBy
    .filter((id) => id.startsWith(TRIED_PREFIX) && !have.has(id))
    .map((id) => id.slice(TRIED_PREFIX.length));
}

/** Category ids the tried classes would fill on a distribution row. */
export function triedCategoryIds(real: RequirementItem, tried: RequirementItem | undefined): Set<string> {
  const out = new Set<string>();
  const cats = tried?.dist?.categories;
  if (!cats) return out;
  const filled = new Set((real.dist?.categories ?? []).filter((c) => c.filled).map((c) => c.id));
  for (const c of cats) if (c.filled && !filled.has(c.id)) out.add(c.id);
  return out;
}

/**
 * Tried course id → labels of THIS group's rows it would count toward, read
 * from the rows recomputed with the tried classes (their virtual placement
 * on the row's coverage). Ids with nothing here are left out.
 */
export function triedFillsIn(
  items: readonly RequirementItem[],
  tried: TriedProgress | undefined,
  canonical: (id: string) => string = (id) => id
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!tried) return out;
  for (const id of tried.courseIds) {
    const pid = triedPlacementId(canonical(id));
    const labels = items.filter((it) => tried.items[it.id]?.coveredBy.includes(pid)).map((it) => it.label);
    if (labels.length > 0) out[id] = labels;
  }
  return out;
}

/** "MATH-1910" → "MATH 1910". */
export function codeFromId(id: string): string {
  return id.replace(/-/g, " ");
}

/** The "Check with your advisor" card's key (outline + DOM). */
export const ADVISOR_CARD_KEY = "advisor";

/** A DOM id for a group card (outline jumps). */
export function cardDomId(key: string): string {
  return `rq-card-${key}`;
}
