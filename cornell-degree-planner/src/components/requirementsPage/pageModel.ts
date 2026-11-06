import type {
  RequirementGroup,
  RequirementItem,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { triedPlacementId } from "@/lib/planner/triedProgress";
import { progressText } from "@/components/requirements/requirementText";

/**
 * pageModel (spec 025 D8/D10/D11) — the Requirements page's shape, from
 * `progress.groups` with no new engine logic. Pure and unit-tested.
 *
 *   - Every advisor-only row (`dist.confirm`) leaves its group and is
 *     collected in one "Check with your advisor (N)" list, shown last.
 *   - Groups are sectioned by layer for Distribution programs (college, then
 *     major, then concentration); an Engineering program is one section.
 *   - A group's progress is its one row's own unit when it has a single
 *     counted row ("Distribution 4 of 10"), else rows done ("1 of 2").
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

export const isConfirm = (it: RequirementItem): boolean => !!it.dist?.confirm;
export const isDone = (it: RequirementItem): boolean => it.status === "satisfied" || it.status === "waived";
export const isOpen = (it: RequirementItem): boolean => it.status === "unmet" || it.status === "partial";

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

export function buildPageModel(groups: readonly RequirementGroup[], names: SectionNames = {}): PageModel {
  const advisor: RequirementItem[] = [];
  const byKind = new Map<LayerKind | "program", PageGroup[]>();
  for (const g of groups) {
    const items: RequirementItem[] = [];
    for (const it of g.items) (isConfirm(it) ? advisor : items).push(it);
    if (items.length === 0) continue;
    const layerKind = items.find((it) => it.dist)?.dist?.layerKind ?? null;
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

/** The unit a row is counted in, or null for a single-course seat. */
export function rowUnit(it: RequirementItem): Exclude<AmountUnit, "rows"> | null {
  const d = it.dist;
  if (d) {
    if (d.categoriesNeed != null) return "categories";
    if (d.coursesNeed != null && d.coursesNeed > 0 && d.rowKind !== "seat") return "courses";
    if (d.creditsNeed != null && d.creditsNeed > 0) return "credits";
    return null;
  }
  const p = it.poolProgress;
  if (p) return p.courses < p.requiredCourses || p.requiredCredits <= 0 ? "courses" : "credits";
  return null;
}

/** A row's amount in `unit` (have / need). */
export function amountIn(it: RequirementItem, unit: Exclude<AmountUnit, "rows">): Amount | null {
  const d = it.dist;
  if (d) {
    if (unit === "categories" && d.categoriesNeed != null) return { have: d.categoriesHave ?? 0, need: d.categoriesNeed, unit };
    if (unit === "courses" && d.coursesNeed != null) return { have: d.coursesHave ?? 0, need: d.coursesNeed, unit };
    if (unit === "credits" && d.creditsNeed != null) return { have: d.creditsHave ?? 0, need: d.creditsNeed, unit };
    return null;
  }
  const p = it.poolProgress;
  if (!p) return null;
  if (unit === "courses") return { have: p.courses, need: p.requiredCourses, unit };
  if (unit === "credits") return { have: p.credits, need: p.requiredCredits, unit };
  return null;
}

export type TriedDelta =
  /** "+2 categories" */
  | { kind: "more"; n: number; unit: Exclude<AmountUnit, "rows"> }
  /** A seat the tried classes would fill. */
  | { kind: "fills" };

/**
 * D11: what the tried classes add to one row — the tried recomputation
 * against the real row, in the real row's unit. Null when they add nothing.
 * Never a met state: callers keep showing the REAL status.
 */
export function triedDelta(real: RequirementItem, tried: RequirementItem | undefined): TriedDelta | null {
  if (!tried || real.status === "waived" || isConfirm(real)) return null;
  const unit = rowUnit(real);
  if (unit) {
    const a = amountIn(real, unit);
    const b = amountIn(tried, unit);
    if (a && b && b.have > a.have) {
      // Never past what the row needs: the rest wouldn't count here.
      const n = Math.min(b.have, a.need) - a.have;
      return n > 0 ? { kind: "more", n: Math.round(n * 10) / 10, unit } : null;
    }
    return null;
  }
  return !isDone(real) && isDone(tried) ? { kind: "fills" } : null;
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

export type GroupAmount = Amount & { plus: number };

/**
 * A group's progress for the outline and its card header: its single counted
 * row's own amount ("4 of 10" categories), else rows done ("1 of 2"). `plus`
 * is the tried classes' blue addition in the same unit.
 */
export function groupAmount(g: Pick<PageGroup, "items" | "satisfiedCount" | "total">, tried?: TriedProgress): GroupAmount {
  const counted = g.items.filter((it) => !isConfirm(it));
  if (counted.length === 1) {
    const only = counted[0];
    const unit = only.status === "waived" ? null : rowUnit(only);
    const a = unit ? amountIn(only, unit) : null;
    if (a && a.need > 0) {
      const d = triedDelta(only, tried?.items[only.id]);
      return { ...a, plus: d?.kind === "more" ? d.n : 0 };
    }
  }
  let plus = 0;
  if (tried) {
    for (const it of counted) {
      const t = tried.items[it.id];
      if (t && !isDone(it) && isDone(t)) plus += 1;
    }
  }
  return { have: g.satisfiedCount, need: g.total, unit: "rows", plus };
}

export function amountDone(a: Amount): boolean {
  return a.need > 0 && a.have >= a.need;
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
