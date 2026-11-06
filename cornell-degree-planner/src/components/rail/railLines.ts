import type {
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { creditProfileCredits } from "@/lib/planner/creditPool";

/**
 * railLines.ts (spec 025 D9/D11) — the planner rail's "Still needed" as one
 * line per requirement group, read straight from `progress.groups` (no engine
 * logic here). Pure: the rail component only renders and wires clicks.
 *
 * Count rule:
 *  - Advisor rows (`confirm`) are left out; a group with nothing else is
 *    dropped.
 *  - A group of ONE row that carries its own counts states that row's counts:
 *    a distribution row its categories ("4 of 10"), a credits row its credits
 *    ("16 of 120"), a pool (or an anyOf row's active option) its courses, or
 *    its credits ("4 of 11 cr") once the courses are reached or when it only
 *    counts credits.
 *  - Any other group counts its rows: done (met or waived) of checkable.
 *  - Tried classes (D11) add a blue "+N" when the same count, read from
 *    `progress.tried.items`, is higher. Tried never marks a line done.
 */

/** The tried reminder's list: two lines (21 px each + the 4 px gap) and no
 *  taller; the rest scroll inside it (spec 025 D13). */
export const REMINDER_LIST_CAP = "max-h-[46px] overflow-y-auto";

export type RailCountUnit = "" | "cr";

export type RailLine = {
  /** The group's key (`progress.groups[*].key`). */
  key: string;
  /** Short display name ("Distribution", "Economics core"). */
  name: string;
  /** The group's full label, for the tooltip. */
  fullLabel: string;
  have: number;
  need: number;
  unit: RailCountUnit;
  /** "4 of 10", "4 of 11 cr"; "" when nothing here can be counted. */
  countText: string;
  /** 0..1 for the thin bar. */
  fraction: number;
  /** Every counted row is met or waived. */
  done: boolean;
  /** How much the tried classes would add to the count (0 = none). */
  triedPlus: number;
  /** Placements counting toward any row of the group (deduped, board order). */
  coveredBy: string[];
  /** The first row still open (unmet or partly filled), checkable rows first;
   *  null when every row is done. The catalog opens scoped to it. */
  firstOpen: RequirementItem | null;
};

type Measure = "categories" | "credits" | "courses" | "poolCredits";
type Count = { have: number; need: number };

const isConfirm = (it: RequirementItem): boolean => it.dist?.confirm === true || it.dist?.rowKind === "confirm";
const isDone = (it: RequirementItem): boolean => it.status === "satisfied" || it.status === "waived";
const isOpen = (it: RequirementItem): boolean => it.status === "unmet" || it.status === "partial";

/** The count a row states for one measure, or null when it has none. */
function read(it: RequirementItem, m: Measure): Count | null {
  const d = it.dist;
  const p = it.poolProgress;
  switch (m) {
    case "categories":
      return d?.categoriesNeed != null ? { have: d.categoriesHave ?? 0, need: d.categoriesNeed } : null;
    case "credits":
    case "poolCredits":
      if (d?.creditsNeed != null && d.creditsNeed > 0) return { have: d.creditsHave ?? 0, need: d.creditsNeed };
      if (p && p.requiredCredits > 0) return { have: p.credits, need: p.requiredCredits };
      return null;
    case "courses":
      if (d?.coursesNeed != null && d.coursesNeed > 0) return { have: d.coursesHave ?? 0, need: d.coursesNeed };
      if (p && p.requiredCourses > 0) return { have: p.courses, need: p.requiredCourses };
      return null;
  }
}

/** Which of its own counts a single row states, if any (see the count rule). */
function measureOf(it: RequirementItem): Measure | null {
  if (it.status === "waived") return null;
  const d = it.dist;
  if (d) {
    if (d.rowKind === "distribution" && d.categoriesNeed != null) return "categories";
    if (d.rowKind === "credits") return read(it, "credits") ? "credits" : null;
    const pooled = d.rowKind === "pool" || (d.rowKind === "anyOf" && d.activeOption != null);
    if (!pooled) return null;
  } else if (!it.poolProgress) {
    return null;
  }
  const courses = read(it, "courses");
  const credits = read(it, "poolCredits");
  // The count still binding: courses until they're reached, then credits.
  if (courses && courses.have < courses.need) return "courses";
  if (credits && credits.have < credits.need) return "poolCredits";
  if (courses) return "courses";
  if (credits) return "poolCredits";
  return null;
}

/** "Major · Core" → "Core" (the engine's labels lead with the layer kind). */
function groupPart(label: string): string {
  const at = label.indexOf(" · ");
  return at >= 0 ? label.slice(at + 3) : label;
}

/** "Core" → "core", but "CS core" / "ECON" stay as written. */
function lowerFirst(s: string): string {
  if (s.length > 1 && s[0] === s[0].toUpperCase() && s[1] === s[1].toLowerCase()) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

/**
 * A group's short rail name: a college group by its own name ("Writing",
 * "Distribution"); a major group led by the major's short name ("Economics
 * core") so it never reads like the college's group of the same name; a
 * concentration group, or an Engineering category, as labelled.
 */
export function railGroupName(group: RequirementGroup, majorName?: string | null): string {
  const kind = group.items.find((it) => it.dist)?.dist?.layerKind;
  if (!kind) return group.label;
  const part = groupPart(group.label);
  if (kind !== "major" || !majorName) return part;
  if (part.toLowerCase().includes(majorName.toLowerCase())) return part;
  return `${majorName} ${lowerFirst(part)}`;
}

function countText(c: Count, unit: RailCountUnit): string {
  return `${Math.min(c.have, c.need)} of ${c.need}${unit ? ` ${unit}` : ""}`;
}

/** One group's line, or null when it holds only advisor rows. */
export function railLineFor(
  group: RequirementGroup,
  tried?: TriedProgress,
  majorName?: string | null
): RailLine | null {
  const rows = group.items.filter((it) => !isConfirm(it));
  if (rows.length === 0) return null;
  const triedRow = (it: RequirementItem): RequirementItem => tried?.items[it.id] ?? it;

  let count: Count;
  let triedCount: Count;
  let unit: RailCountUnit = "";
  let done: boolean;
  const measure = rows.length === 1 ? measureOf(rows[0]) : null;
  if (measure) {
    const row = rows[0];
    count = read(row, measure)!;
    triedCount = read(triedRow(row), measure) ?? count;
    unit = measure === "poolCredits" ? "cr" : "";
    done = isDone(row);
  } else {
    // Rows the app can check (or that are done anyway, e.g. waived).
    const counted = rows.filter((it) => it.checkable || isDone(it));
    count = { have: counted.filter(isDone).length, need: counted.length };
    triedCount = { have: counted.filter((it) => isDone(triedRow(it))).length, need: counted.length };
    done = counted.length > 0 && counted.every(isDone);
  }

  const shown = Math.min(count.have, count.need);
  const triedShown = Math.min(triedCount.have, count.need);
  const coveredBy: string[] = [];
  for (const it of rows) for (const id of it.coveredBy) if (!coveredBy.includes(id)) coveredBy.push(id);
  const open = rows.filter(isOpen);

  return {
    key: group.key,
    name: railGroupName(group, majorName),
    fullLabel: group.label,
    have: shown,
    need: count.need,
    unit,
    countText: count.need > 0 ? countText(count, unit) : "",
    fraction: count.need > 0 ? shown / count.need : 0,
    done,
    triedPlus: tried && !done ? Math.max(0, triedShown - shown) : 0,
    coveredBy,
    firstOpen: open.find((it) => it.checkable) ?? open[0] ?? null,
  };
}

/** Every group's line, in the engine's order (advisor-only groups dropped). */
export function buildRailLines(progress: RequirementProgress, majorName?: string | null): RailLine[] {
  const lines: RailLine[] = [];
  for (const g of progress.groups) {
    const line = railLineFor(g, progress.tried, majorName);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * The "Credit before Cornell · 8 cr" line: the credits the student's resolved
 * credit earns in their college (exam + transfer, each course once), or null
 * to hide the line (no credit, or none of it earns credit here).
 */
export function creditLineCredits(resolved: Parameters<typeof creditProfileCredits>[0]): number | null {
  const earning = resolved.filter((e) => !(e as { earnsNothing?: boolean }).earnsNothing);
  const total = creditProfileCredits(earning);
  return total > 0 ? total : null;
}

/** Same placement ids, any order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Whether a board highlight still points at something the student can see: a
 * rail line's cards or a single row's cards (the Requirements page's "Show on
 * board" lights one row). A highlight matching neither is stale.
 */
export function highlightStillValid(
  highlighted: readonly string[],
  lines: readonly RailLine[],
  progress: RequirementProgress
): boolean {
  if (highlighted.length === 0) return true;
  if (lines.some((l) => l.coveredBy.length > 0 && sameIds(l.coveredBy, highlighted))) return true;
  return progress.groups.some((g) =>
    g.items.some((it) => it.coveredBy.length > 0 && sameIds(it.coveredBy, highlighted))
  );
}
