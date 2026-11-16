import type {
  ProgramSection,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import {
  extraSections,
  forbiddenSectionIds,
  sectionIdOf,
} from "@/components/requirements/programSections";
import { creditProfileCredits } from "@/lib/planner/creditPool";
import { groupTitle } from "@/components/requirementsPage/pageModel";
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
  /** Short display name ("Distribution", "Core"). */
  name: string;
  /** The rule layer the group comes from; null for Engineering categories. */
  layerKind: "college" | "major" | "concentration" | "minor" | null;
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

/** "Core" → "core", but "CS core" / "ECON" stay as written. */
function lowerFirst(s: string): string {
  if (s.length > 1 && s[0] === s[0].toUpperCase() && s[1] === s[1].toLowerCase()) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

/**
 * A group's rail name: the same title the Requirements page shows for it
 * (`groupTitle`: the layer prefix dropped, Engineering labels unchanged).
 * Lines whose titles collide are qualified by `buildRailLines`.
 */
export function railGroupName(group: RequirementGroup): string {
  return groupTitle(group.label);
}

/** Who owns each rule layer, used to tell apart lines with the same title. */
export type RailSourceNames = {
  college?: string | null;
  major?: string | null;
  concentration?: string | null;
  minor?: string | null;
};

function countText(c: Count, unit: RailCountUnit): string {
  return `${Math.min(c.have, c.need)} of ${c.need}${unit ? ` ${unit}` : ""}`;
}

/** One group's line, or null when it holds only advisor rows. */
export function railLineFor(
  group: RequirementGroup,
  tried?: TriedProgress
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
    name: railGroupName(group),
    layerKind: group.items.find((it) => it.dist)?.dist?.layerKind ?? null,
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

/**
 * Lines whose names are identical are qualified by their source so none reads
 * the same as another: "College credits" and "<Concentration> credits". Any
 * name can collide, not just "Credits". A source with no name available is
 * left as is.
 */
function disambiguate(lines: RailLine[], names: RailSourceNames): RailLine[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  return lines.map((l) => {
    if ((counts.get(l.name) ?? 0) < 2 || !l.layerKind) return l;
    const source = l.layerKind === "college" ? (names.college ?? "College") : names[l.layerKind];
    if (!source) return l;
    const name = `${source} ${lowerFirst(l.name)}`;
    return { ...l, name, fullLabel: name };
  });
}

/** Every group's line, in the engine's order (advisor-only groups dropped). */
export function buildRailLines(progress: RequirementProgress, names: RailSourceNames = {}): RailLine[] {
  const lines: RailLine[] = [];
  for (const g of progress.groups) {
    const line = railLineFor(g, progress.tried);
    if (line) lines.push(line);
  }
  return disambiguate(lines, names);
}

/** One extra program's block in the rail (spec 047 D6): folded to one line by default. */
export type RailProgramBlock = {
  section: ProgramSection;
  lines: RailLine[];
  /** D14: this program can't be combined with an earlier one on the plan. */
  forbidden: boolean;
};

export type RailBlocks = {
  /** The college's and the primary's lines, exactly as before spec 047. */
  base: RailLine[];
  /** Each second major / minor, in plan order. Empty for a plan with none. */
  extras: RailProgramBlock[];
};

/**
 * The rail's lines split by program (spec 047 D6): the college and primary
 * groups as today, then one block per extra program. A plan with no extra
 * program gets `buildRailLines` unchanged and no blocks. Lines are qualified
 * against their own program only (two programs' "Electives" sit under
 * different headers).
 */
export function buildRailBlocks(progress: RequirementProgress, names: RailSourceNames = {}): RailBlocks {
  const extras = extraSections(progress);
  if (extras.length === 0) return { base: buildRailLines(progress, names), extras: [] };
  const sections = progress.sections ?? [];
  const extraIds = new Set(extras.map((s) => s.id));
  const baseGroups: RequirementGroup[] = [];
  const byExtra = new Map<string, RequirementGroup[]>();
  for (const g of progress.groups) {
    const id = sectionIdOf(g, sections);
    if (id && extraIds.has(id)) byExtra.set(id, [...(byExtra.get(id) ?? []), g]);
    else baseGroups.push(g);
  }
  const forbidden = forbiddenSectionIds(progress);
  return {
    base: buildRailLines({ ...progress, groups: baseGroups }, names),
    extras: extras.map((section) => ({
      section,
      lines: buildRailLines(
        { ...progress, groups: byExtra.get(section.id) ?? [] },
        { major: section.shortName, minor: section.shortName, concentration: null }
      ),
      forbidden: forbidden.has(section.id),
    })),
  };
}

/** "4 of 10", "Done", "Loading…", "Can't load right now", "Can't combine": a
 *  folded program's summary. `tone` picks its color. */
export function programSummary(
  section: Pick<ProgramSection, "status" | "satisfiedCount" | "total">,
  forbidden = false
): { text: string; tone: "done" | "warn" | "muted" | "plain" } {
  if (section.status === "loading") return { text: "Loading…", tone: "muted" };
  if (section.status === "unavailable") return { text: "Can't load right now", tone: "warn" };
  if (forbidden) return { text: "Can't combine", tone: "warn" };
  if (section.total > 0 && section.satisfiedCount >= section.total) return { text: "Done", tone: "done" };
  return { text: `${Math.min(section.satisfiedCount, section.total)} of ${section.total}`, tone: "plain" };
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
