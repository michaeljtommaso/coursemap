import type {
  ProgramSection,
  RequirementGroup,
  RequirementItem,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { hasExtraPrograms, sectionIdOf } from "@/components/requirements/programSections";
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
 *   - Spec 047 D6: a plan with a second major or a minor is sectioned by
 *     PROGRAM instead (college, primary, second major, minors, in
 *     `progress.sections` order); each section carries its ProgramSection
 *     for the foldable header. A plan with none is sectioned as above.
 */

export type LayerKind = "college" | "major" | "concentration" | "minor";

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
  /** A layer kind or "program"; in program mode `program:<section id>`. */
  key: string;
  label: string;
  groups: PageGroup[];
  /** Spec 047: the program this section is (program mode only). */
  program?: ProgramSection;
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
  /** A minor's name, when the groups are sectioned by layer. */
  minor?: string | null;
};

const LAYER_PREFIX = /^(College|Major|Concentration|Minor) · /;
const KIND_ORDER: LayerKind[] = ["college", "major", "concentration", "minor"];

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
    case "minor":
      // Layer mode only; program mode names every section from its ProgramSection.
      return names.minor ?? "Minor";
  }
}

export function buildPageModel(
  groups: readonly RequirementGroup[],
  names: SectionNames = {},
  /** Which engine produced the groups. An Engineering program stays one
   *  section even when a row carries distribution info (liberal studies,
   *  spec 037 D9). Absent: sectioned by each group's layer. */
  engine?: "engineering" | "distribution",
  /** Spec 047: `progress.sections`. With a second major or minor among them
   *  the page is sectioned by program. */
  programs?: readonly ProgramSection[]
): PageModel {
  if (programs && hasExtraPrograms({ sections: [...programs] })) return buildProgramModel(groups, programs, engine);
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

function pageGroup(g: RequirementGroup, items: RequirementItem[], engine?: "engineering" | "distribution"): PageGroup {
  return {
    key: g.key,
    title: groupTitle(g.label),
    items,
    // The engine's counts already leave confirm rows out.
    satisfiedCount: g.satisfiedCount,
    total: g.total,
    layerKind: engine === "engineering" ? null : (items.find((it) => it.dist)?.dist?.layerKind ?? null),
  };
}

/** Spec 047 D6: one section per program, in `programs` order (empty ones too:
 *  a program still loading, or one that can't load, keeps its header). */
function buildProgramModel(
  groups: readonly RequirementGroup[],
  programs: readonly ProgramSection[],
  engine?: "engineering" | "distribution"
): PageModel {
  const advisor: RequirementItem[] = [];
  const bySection = new Map<string, PageGroup[]>();
  for (const g of groups) {
    const items: RequirementItem[] = [];
    for (const it of g.items) (isConfirm(it) ? advisor : items).push(it);
    if (items.length === 0) continue;
    const id = sectionIdOf(g, programs);
    if (!id) continue;
    bySection.set(id, [...(bySection.get(id) ?? []), pageGroup(g, items, engine)]);
  }
  const sections = programs.map((p) => ({
    key: programSectionKey(p.id),
    label: p.name,
    groups: bySection.get(p.id) ?? [],
    program: p,
  }));
  return { sections, advisor };
}

/** A program section's key (outline, DOM id, fold state). */
export function programSectionKey(sectionId: string): string {
  return `program:${sectionId}`;
}

// ── Amounts ──────────────────────────────────────────────────────────────────

export type AmountUnit = "rows" | "categories" | "groups" | "courses" | "credits";
export type Amount = { have: number; need: number; unit: AmountUnit };

const UNIT_OF: Record<CountMeasure, Exclude<AmountUnit, "rows">> = {
  categories: "categories",
  groups: "groups",
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
  groups: ["group", "groups"],
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

/** "4 of 10", "16 of 120 cr", "2 of 3 groups" (Engineering liberal studies). */
export function formatAmount(a: Amount): string {
  const have = Math.round(a.have * 10) / 10;
  if (a.unit === "credits") return `${have} of ${a.need} cr`;
  return a.unit === "groups" ? `${have} of ${a.need} groups` : `${have} of ${a.need}`;
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

// ── The table row (spec 045 D1) ──────────────────────────────────────────────

/** A row the app can't check: the engine said "unchecked", or the rule can't
 *  be evaluated (advisor rows too). Never folded (D2), never counted. */
export function isUnchecked(it: RequirementItem): boolean {
  return !it.checkable || it.dist?.engineStatus === "unchecked";
}

export type RowProgress = {
  /** "Done", "Waived", "1 of 2", "3 of 9 cr", "Can't check". */
  text: string;
  tone: "done" | "waived" | "muted" | "plain";
  /** The tried classes' blue "+N" (D11): never a met state. */
  plus: number;
};

/** The Progress cell: Done / Waived / the row's own count, plus the tried
 *  classes' blue addition in that count (a seat they'd fill: +1). */
export function rowProgress(it: RequirementItem, tried?: RequirementItem): RowProgress {
  if (it.status === "waived") return { text: "Waived", tone: "waived", plus: 0 };
  if (isConfirm(it)) return { text: "Ask your advisor", tone: "muted", plus: 0 };
  if (it.status === "satisfied") return { text: "Done", tone: "done", plus: 0 };
  if (isUnchecked(it)) return { text: "Can't check", tone: "muted", plus: 0 };
  const d = triedDelta(it, tried);
  return { text: formatAmount(groupAmount({ items: [it] })), tone: "plain", plus: d ? (d.kind === "more" ? d.n : 1) : 0 };
}

/** The Counting cell: what counts here, named, or "—". */
export function countingText(it: RequirementItem, names: readonly string[]): string {
  if (it.status === "waived" || isConfirm(it) || names.length === 0) return "—";
  return names.join(", ");
}

// ── Folding finished rows (spec 045 D2) ──────────────────────────────────────

export type FoldKind = "finished" | "waived";

/**
 * Which fold line a row goes into, or null when it stays in the table: open
 * and partial rows, and every row the app can't check (it stays open with its
 * reason). A waived row folds whatever its rule, since the student settled it.
 */
export function foldKind(it: RequirementItem): FoldKind | null {
  if (it.status === "waived") return "waived";
  if (it.status === "satisfied" && !isUnchecked(it)) return "finished";
  return null;
}

export type GroupFold = {
  /** The rows the collapsed table shows, in order: everything that doesn't
   *  fold, plus the selected row (it stays put while selected). */
  shown: RequirementItem[];
  /** Folded into the end line, in order. */
  finished: RequirementItem[];
  waived: RequirementItem[];
  /** Nothing open: the group shrinks to its header ("✓ All finished"). */
  allFinished: boolean;
};

export function foldGroup(items: readonly RequirementItem[], selectedId: string | null = null): GroupFold {
  const shown: RequirementItem[] = [];
  const finished: RequirementItem[] = [];
  const waived: RequirementItem[] = [];
  for (const it of items) {
    const k = foldKind(it);
    if (!k || it.id === selectedId) shown.push(it);
    else if (k === "finished") finished.push(it);
    else waived.push(it);
  }
  const allFinished = items.length > 0 && items.every((it) => foldKind(it) !== null);
  return { shown, finished, waived, allFinished };
}

/** "4 finished · NS 1150, BIOG 1440 · 1 waived" (the ✓ is drawn beside it);
 *  "" when nothing folds. `namesOf` names what counts on a row. */
export function foldLineText(fold: Pick<GroupFold, "finished" | "waived">, namesOf: (it: RequirementItem) => string[]): string {
  const parts: string[] = [];
  if (fold.finished.length > 0) {
    parts.push(`${fold.finished.length} finished`);
    const names = [...new Set(fold.finished.flatMap(namesOf))];
    if (names.length > 0) parts.push(names.join(", "));
  }
  if (fold.waived.length > 0) parts.push(`${fold.waived.length} waived`);
  return parts.join(" · ");
}

/** Where a row sits on the page: its group, or the advisor list (group null). */
export function locateRow(
  model: PageModel,
  id: string | null
): { item: RequirementItem; group: PageGroup | null; advisor: boolean } | null {
  if (!id) return null;
  for (const s of model.sections) {
    for (const g of s.groups) {
      const it = g.items.find((x) => x.id === id);
      if (it) return { item: it, group: g, advisor: false };
    }
  }
  const it = model.advisor.find((x) => x.id === id);
  return it ? { item: it, group: null, advisor: true } : null;
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
