/**
 * countsToward.ts (spec 046 D2/D3/D7) — the "Counts toward" choice on a
 * "No Cornell equivalent" transfer: the options offered, and reading a saved
 * choice back. Pure; no React here.
 */
import type { CountsToward } from "@/lib/schemas";
import type { CreditCollege } from "@/lib/credit/types";
import { DIST_TAG_GROUPS } from "@/lib/classes/requirementFilter";
import { LIBERAL_STUDIES_GROUP_ID, liberalStudiesGroups, type LsCohortId } from "@/lib/planner/liberalStudies";
import { LS_AREA_PREFIX } from "@/lib/planner/matchAdapters";

/** One option. `value` is the select's value ("area:ALC-AS", "row:<item id>"). */
export type TowardOption = {
  value: string;
  label: string;
  /** A distribution row: the areas to pick from (one or two). */
  categories?: { id: string; label: string }[];
  /** A seat (one course): hint that searching for the Cornell course is better. */
  seat?: boolean;
};
export type TowardGroup = { label: string; options: TowardOption[] };

/** The slice of a Requirements item the picker reads (RequirementItem). */
export type TowardItem = {
  id: string;
  label: string;
  status: "unmet" | "partial" | "satisfied" | "waived";
  checkable: boolean;
  requirement?: unknown;
  poolProgress?: unknown;
  dist?: {
    rowKind: "seat" | "pool" | "distribution" | "credits" | "anyOf" | "confirm";
    confirm?: boolean;
    categories?: { id: string; label: string }[];
  };
};
export type TowardItemGroup = { label: string; items: TowardItem[] };

export const NONE = "none";
const AREA = "area:";
const ROW = "row:";

/** Areas the student's college uses: A&S or CALS roster tags, or Engineering's
 *  liberal studies groups for the student's cohort. Unknown college → none. */
export function areaOptions(college: CreditCollege, cohort: LsCohortId): TowardOption[] {
  if (college === "engineering") {
    return liberalStudiesGroups(cohort).map((g) => ({
      value: `${AREA}${LS_AREA_PREFIX}${g.id}`,
      label: `Liberal studies: ${g.label}`,
    }));
  }
  const key = college === "cas" ? "AS" : college === "cals" ? "AG" : null;
  const group = DIST_TAG_GROUPS.find((g) => g.key === key);
  return (group?.tags ?? []).map((t) => ({ value: `${AREA}${t.code}`, label: `${t.short} — ${t.name}` }));
}

/**
 * Every requirement the student can point credit at (D2): checkable rows,
 * minus advisor-confirm rows (never checked), credit-total rows (the credit
 * already counts there) and Engineering's liberal studies row (offered as
 * areas). Met rows read "(done)". A distribution row offers its categories.
 */
export function requirementOptions(groups: readonly TowardItemGroup[]): TowardGroup[] {
  const out: TowardGroup[] = [];
  for (const g of groups) {
    const options: TowardOption[] = [];
    for (const it of g.items) {
      if (!it.checkable || it.status === "waived") continue;
      if (it.id === LIBERAL_STUDIES_GROUP_ID) continue;
      const kind = it.dist?.rowKind;
      if (it.dist?.confirm || kind === "confirm" || kind === "credits") continue;
      if (kind === "distribution" && !(it.dist?.categories && it.dist.categories.length > 0)) continue;
      if (options.some((o) => o.value === `${ROW}${it.id}`)) continue;
      const done = it.status === "satisfied" ? " (done)" : "";
      const seat = kind ? kind === "seat" : it.requirement != null && it.poolProgress == null;
      options.push({
        value: `${ROW}${it.id}`,
        label: `${it.label}${done}`,
        ...(kind === "distribution" ? { categories: it.dist!.categories!.map((c) => ({ id: c.id, label: c.label })) } : {}),
        ...(seat ? { seat: true } : {}),
      });
    }
    if (options.length > 0) out.push({ label: g.label, options });
  }
  return out;
}

/** The whole dropdown: Just credits, the college's areas, then the plan's
 *  requirements (absent while no program is loaded, e.g. early first run). */
export function towardGroups(
  college: CreditCollege,
  cohort: LsCohortId,
  requirementGroups: readonly TowardItemGroup[] | null
): TowardGroup[] {
  const areas = areaOptions(college, cohort);
  return [
    { label: "", options: [{ value: NONE, label: "Just credits" }] },
    ...(areas.length > 0 ? [{ label: "Distribution areas", options: areas }] : []),
    ...requirementOptions(requirementGroups ?? []),
  ];
}

export function findOption(groups: readonly TowardGroup[], value: string): TowardOption | undefined {
  for (const g of groups) for (const o of g.options) if (o.value === value) return o;
  return undefined;
}

/** A saved choice → the select's value (a second area doesn't change it). */
export function valueOf(ct: CountsToward | undefined): string {
  if (!ct) return NONE;
  if (ct.row) return `${ROW}${ct.row}`;
  return ct.areas && ct.areas.length > 0 ? `${AREA}${ct.areas[0]}` : NONE;
}

/** The select's value (+ the areas picked inside a distribution row, or a
 *  second area) → the saved choice. Just credits → undefined. */
export function toCountsToward(
  groups: readonly TowardGroup[],
  value: string,
  picked: readonly string[] = []
): CountsToward | undefined {
  const opt = findOption(groups, value);
  if (!opt || value === NONE) return undefined;
  if (value.startsWith(AREA)) {
    const areas = [value.slice(AREA.length), ...picked.filter((a) => `${AREA}${a}` !== value)].slice(0, 2);
    const labels = areas.map((a) => findOption(groups, `${AREA}${a}`)?.label ?? a);
    return { areas, label: labels.join(" and ").slice(0, 160) };
  }
  const row = value.slice(ROW.length);
  const base = opt.label.replace(/ \(done\)$/, "");
  if (opt.categories) {
    const cats = opt.categories.filter((c) => picked.includes(c.id)).slice(0, 2);
    if (cats.length === 0) return undefined;
    return {
      row,
      categories: cats.map((c) => c.id),
      label: `${base}: ${cats.map((c) => c.label).join(" and ")}`.slice(0, 160),
    };
  }
  return { row, label: base.slice(0, 160) };
}

/** Is the saved choice still on offer? A choice whose row this plan doesn't
 *  have is stale (D7): it counts only toward totals here. Areas are stale
 *  only when the college offers none of them. */
export function isStale(groups: readonly TowardGroup[], ct: CountsToward | undefined, rowsKnown = true): boolean {
  if (!ct) return false;
  if (ct.row) return rowsKnown && !findOption(groups, `${ROW}${ct.row}`);
  return !(ct.areas ?? []).some((a) => findOption(groups, `${AREA}${a}`));
}

/** The list row's line: "counts toward ECON electives (you said)". */
export function towardLine(ct: CountsToward | undefined, stale: boolean): string {
  if (!ct) return "counts toward total credits";
  const what = ct.label ?? (ct.row ? "a requirement" : (ct.areas ?? []).join(" and "));
  return stale ? `counts toward ${what} in another program, not this one` : `counts toward ${what} (you said)`;
}
