import type {
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import { creditProfileCredits } from "@/lib/planner/creditPool";
import { groupCount, isConfirm, isOpen, type Count } from "./groupCount";

/**
 * railLines.ts (spec 028 D9/D11) — the planner rail's "Still needed" as one
 * line per requirement group, read straight from `progress.groups` (no engine
 * logic here). Pure: the rail component only renders and wires clicks.
 *
 * Count rule: groupCount.ts, shared with the Requirements page so the two
 * always agree. In short: advisor rows are left out (a group with nothing
 * else is dropped); a group of one counted row states that row's count still
 * binding ("4 of 10" categories, then its course or credit floor; a pool's
 * courses, then "4 of 11 cr"; Engineering liberal studies its courses, then
 * "15 of 18 cr", then "2 of 3 groups"); any other group counts rows done of
 * checkable.
 * A line is done only when its rows' status is; tried classes add a blue
 * "+N" in the same count and never mark a line done.
 */

/** The tried reminder's list: two lines (21 px each + the 4 px gap) and no
 *  taller; the rest scroll inside it (spec 028 D13). */
export const REMINDER_LIST_CAP = "max-h-[46px] overflow-y-auto";

export type RailCountUnit = "" | "cr" | "groups";

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
  // The count is shared with the Requirements page (groupCount.ts).
  const count = groupCount(group.items, tried);
  if (!count) return null;
  const rows = group.items.filter((it) => !isConfirm(it));
  const unit: RailCountUnit = count.measure === "poolCredits" ? "cr" : count.measure === "groups" ? "groups" : "";
  const coveredBy: string[] = [];
  for (const it of rows) for (const id of it.coveredBy) if (!coveredBy.includes(id)) coveredBy.push(id);
  const open = rows.filter(isOpen);

  return {
    key: group.key,
    name: railGroupName(group, majorName),
    fullLabel: group.label,
    have: count.have,
    need: count.need,
    unit,
    countText: count.need > 0 ? countText(count, unit) : "",
    fraction: count.need > 0 ? count.have / count.need : 0,
    done: count.done,
    triedPlus: count.plus,
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
