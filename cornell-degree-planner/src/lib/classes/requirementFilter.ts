/**
 * requirementFilter.ts (spec 022) — the /classes "Counts toward" picker's
 * options and the "Distribution tag" filter's catalog. Pure; no React here.
 */

/** The slice of a requirement-progress item the picker reads. */
export type PickerItem = {
  id: string;
  label: string;
  status: "unmet" | "partial" | "satisfied" | "waived";
  /** False when the app can't tell which courses count (e.g. Engineering
   *  liberal studies): offered disabled, never as a filter that narrows
   *  nothing. */
  checkable: boolean;
};
export type PickerGroup = { key: string; label: string; items: PickerItem[] };

export type RequirementOption = { id: string; label: string; disabled: boolean };
export type RequirementOptionGroup = { key: string; label: string; options: RequirementOption[] };

/**
 * The requirements still open on the plan (unmet, or partly filled), grouped
 * as the Still-needed panel groups them. Empty groups are dropped. A
 * requirement already met or waived isn't offered: there's nothing left to
 * find for it. Same-label seats in a group (two writing seminars, two PE
 * seats) filter identically, so they collapse to one option that says how
 * many are still needed.
 */
export function requirementOptions(groups: readonly PickerGroup[]): RequirementOptionGroup[] {
  const out: RequirementOptionGroup[] = [];
  for (const g of groups) {
    const open = g.items.filter((it) => it.status === "unmet" || it.status === "partial");
    const byLabel = new Map<string, { first: PickerItem; n: number }>();
    for (const it of open) {
      const seen = byLabel.get(it.label);
      if (seen) seen.n += 1;
      else byLabel.set(it.label, { first: it, n: 1 });
    }
    const options = [...byLabel.values()].map(({ first: it, n }) => ({
      id: it.id,
      label: !it.checkable
        ? `${it.label} (can't check automatically)`
        : n > 1
          ? `${it.label} (${n} still needed)`
          : it.label,
      disabled: !it.checkable,
    }));
    if (options.length > 0) out.push({ key: g.key, label: g.label, options });
  }
  return out;
}

/** A Cornell class-roster distribution tag (a `crseAttrs` value on the index). */
export type DistTag = { code: string; short: string; name: string };

/**
 * The roster's distribution tags the filter offers, with the names Cornell's
 * own requirement pages use (as recorded in the spec 019 requirement files).
 * Arts & Sciences tags end in -AS; CALS tags end in -AG. Engineering's
 * liberal studies has no roster tag of its own (spec 019 X3).
 */
export const DIST_TAG_GROUPS: { key: string; label: string; tags: DistTag[] }[] = [
  {
    key: "AS",
    label: "Arts & Sciences",
    tags: [
      { code: "ALC-AS", short: "ALC", name: "Arts, Literature, and Culture" },
      { code: "BIO-AS", short: "BIO", name: "Biological Sciences" },
      { code: "ETM-AS", short: "ETM", name: "Ethics and the Mind" },
      { code: "GLC-AS", short: "GLC", name: "Global Citizenship" },
      { code: "HST-AS", short: "HST", name: "Historical Analysis" },
      { code: "PHS-AS", short: "PHS", name: "Physical Sciences" },
      { code: "SCD-AS", short: "SCD", name: "Social Difference" },
      { code: "SSC-AS", short: "SSC", name: "Social Sciences" },
      { code: "SDS-AS", short: "SDS", name: "Statistics and Data Science" },
      { code: "SMR-AS", short: "SMR", name: "Symbolic and Mathematical Reasoning" },
      { code: "FLOPI-AS", short: "FLOPI", name: "Language (Option 1)" },
    ],
  },
  {
    key: "AG",
    label: "CALS",
    tags: [
      { code: "CA-AG", short: "CA", name: "Cultural Analysis" },
      { code: "HA-AG", short: "HA", name: "Historical Analysis" },
      { code: "KCM-AG", short: "KCM", name: "Knowledge, Cognition and Moral Reasoning" },
      { code: "LA-AG", short: "LA", name: "Literature and the Arts" },
      { code: "SBA-AG", short: "SBA", name: "Social and Behavioral Analysis" },
      { code: "D-AG", short: "D", name: "Human Diversity" },
      { code: "FL-AG", short: "FL", name: "Foreign Language" },
      { code: "WRT-AG", short: "WRT", name: "Written Expression" },
      { code: "ORL-AG", short: "ORL", name: "Oral Expression" },
    ],
  },
];

export const DIST_TAGS: DistTag[] = DIST_TAG_GROUPS.flatMap((g) => g.tags);

/** How many index records carry each offered tag (a tag with none is hidden). */
export function distTagCounts(index: readonly { attrs: readonly string[] }[]): Record<string, number> {
  const offered = new Set(DIST_TAGS.map((t) => t.code));
  const counts: Record<string, number> = {};
  for (const r of index) {
    for (const a of new Set(r.attrs)) {
      if (offered.has(a)) counts[a] = (counts[a] ?? 0) + 1;
    }
  }
  return counts;
}

/** "LA — Literature and the Arts (CALS)", for the removable label. */
export function distTagLabel(code: string): string {
  for (const g of DIST_TAG_GROUPS) {
    const t = g.tags.find((x) => x.code === code);
    if (t) return `${t.short} — ${t.name} (${g.label})`;
  }
  return code;
}
