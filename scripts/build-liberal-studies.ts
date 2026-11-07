// scripts/build-liberal-studies.ts
// Builds the Engineering liberal studies data module (spec 037 D12) into
// cornell-degree-planner/src/data/liberal-studies/<date>.json (LiberalStudiesData,
// typed in that folder's index.ts).
//
// Sources (committed, under seed-data/sources/):
//   liberal-studies-groups-<date>.json     the seven groups and the group rules for
//                                          both current entering-class policies (Fall
//                                          2024 and later; Fall 2020 – Spring 2024),
//                                          with the policy pages' URLs and quoted rules
//   liberal-studies-petitions-<date>.json  Engineering's approved petitions list,
//                                          written by parse-liberal-studies-petitions.ts
//
// Output:
//   cohorts     [fa2024, fa2020]: groups g1..g7 (short label, Cornell's name, the tag
//               bases that count for any college suffix, the full tags that count only
//               as written) and the rules (6 courses, 18 credits, 3 groups, at most 2
//               from Group 6, Group 7 credits, 2 courses at 2000+)
//   petitions   course id (dash form) → the petition rows for it: Engineering's
//               categories as printed, credits, college, and `takenThrough` where the
//               approval covers only terms through Summer 2024; a cross-listing a
//               row's note names ("Also GOVT 3303 (crosslisted)") gets the same entry
//
// The counting rule (spec 037 D2): a roster tag counts when its base (split at the
// last hyphen) is in some group's bases, or the whole tag is in some group's exact
// list. The script checks the group tables against that rule and re-derives every
// petition row's ids and categories from its printed cells (so a parser change
// can't leave the source stale), and fails listing every problem.
//
// Refresh: re-run parse-liberal-studies-petitions.ts on a newer PDF extraction (or
// edit the groups source after a policy change), re-run this, deploy.
//
// Offline: reads local files only (no Firestore).
// Run (from scripts/):
//   npx tsx build-liberal-studies.ts            (write the JSON)
//   npx tsx build-liberal-studies.ts --check    (exit 1 if the JSON on disk is stale)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KNOWN_CATEGORIES, normalizeRow, type PetitionsSource } from "./parse-liberal-studies-petitions";

export const DATA_VERSION = "2026-11-07";
export const GROUPS_FILE = resolve(__dirname, "seed-data", "sources", `liberal-studies-groups-${DATA_VERSION}.json`);
export const PETITIONS_FILE = resolve(__dirname, "seed-data", "sources", `liberal-studies-petitions-${DATA_VERSION}.json`);
export const OUT_FILE = resolve(__dirname, `../cornell-degree-planner/src/data/liberal-studies/${DATA_VERSION}.json`);

// The output shape. The app's copy of these types is in
// cornell-degree-planner/src/data/liberal-studies/index.ts (not imported here: the
// scripts typecheck can't load its JSON import).
export type GroupId = "g1" | "g2" | "g3" | "g4" | "g5" | "g6" | "g7";
export type CohortId = "fa2024" | "fa2020";
export type GroupDef = { id: GroupId; label: string; name: string; bases: string[]; exact: string[] };
export type Rules = {
  requiredCourses: 6;
  requiredCredits: 18;
  minGroups: 3;
  groupMax: Record<string, number>;
  groupMinCredits: Record<string, number>;
  minCoursesAtOrAbove: { number: 2000; count: 2 };
};
export type Cohort = { id: CohortId; enteredFrom: string; groups: GroupDef[]; rules: Rules; source: { url: string; quote: string[] } };
export type PetitionEntry = { categories: string[]; credits: string; college: string; takenThrough?: string };
export type LiberalStudiesData = {
  version: string;
  sources: { petitionsUrl: string; petitionsRevised: string; policyUrls: string[] };
  cohorts: Cohort[];
  petitions: Record<string, PetitionEntry[]>;
};

export type GroupsSource = { about: string; retrieved: string; cohorts: Cohort[] };

export const GROUP_IDS: GroupId[] = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"];
export const COHORT_IDS: CohortId[] = ["fa2024", "fa2020"];
/** Short chip labels (spec 037 D9), in group order. */
export const LABELS = ["Arts & Culture", "History", "Ethics & Mind", "Social Science", "Language", "Communications", "Race & Equity"];
/** Group 7 is "Diversity" (D-AG only) for students who entered Fall 2020 – Spring 2024. */
export const LABELS_BY_COHORT: Record<CohortId, string[]> = {
  fa2024: LABELS,
  fa2020: [...LABELS.slice(0, 6), "Diversity"],
};

/** The base of a roster tag: everything before the LAST hyphen ("LAD-HE" → "LAD";
 *  "SCD" → "SCD"). */
export function tagBase(tag: string): string {
  const i = tag.lastIndexOf("-");
  return i < 0 ? tag : tag.slice(0, i);
}

/** The groups a roster tag counts in under one cohort (the D2 counting rule). */
export function tagGroups(cohort: Pick<Cohort, "groups">, tag: string): GroupId[] {
  const base = tagBase(tag);
  return cohort.groups.filter((g) => g.bases.includes(base) || g.exact.includes(tag)).map((g) => g.id);
}

/** Problems with the hand-authored group tables. */
export function groupProblems(src: GroupsSource): string[] {
  const problems: string[] = [];
  const ids = src.cohorts.map((c) => c.id);
  if (ids.join() !== COHORT_IDS.join()) problems.push(`cohorts are [${ids.join(", ")}], expected [${COHORT_IDS.join(", ")}]`);
  for (const c of src.cohorts) {
    const where = (s: string) => `${c.id}: ${s}`;
    if (!/^(FA|SP|SU|WI)\d{2}$/.test(c.enteredFrom)) problems.push(where(`enteredFrom "${c.enteredFrom}" is not a roster slug`));
    if (c.groups.map((g) => g.id).join() !== GROUP_IDS.join()) problems.push(where(`groups are not g1..g7 in order`));
    c.groups.forEach((g, i) => {
      const expected = LABELS_BY_COHORT[c.id]?.[i];
      if (g.label !== expected) problems.push(where(`${g.id} label "${g.label}", expected "${expected}"`));
      if (!g.name.trim()) problems.push(where(`${g.id} has no name`));
      if (!g.bases.length && !g.exact.length) problems.push(where(`${g.id} counts no tag`));
      for (const b of g.bases) {
        if (!KNOWN_CATEGORIES.includes(b)) problems.push(where(`${g.id} base "${b}" is not a liberal studies category`));
        const other = c.groups.find((h, j) => j > i && h.bases.includes(b));
        if (other) problems.push(where(`base "${b}" is in both ${g.id} and ${other.id}`));
      }
      for (const t of g.exact) {
        if (!/^[A-Z]+-[A-Z]+$/.test(t)) problems.push(where(`${g.id} exact tag "${t}" is not <CATEGORY>-<COLLEGE>`));
        if (c.groups.some((h) => h.bases.includes(tagBase(t)))) problems.push(where(`exact tag "${t}" already counts through a base`));
      }
    });
    const r = c.rules;
    if (r.requiredCourses !== 6 || r.requiredCredits !== 18 || r.minGroups !== 3) problems.push(where(`rules are not 6 courses / 18 credits / 3 groups`));
    if (r.minCoursesAtOrAbove?.number !== 2000 || r.minCoursesAtOrAbove?.count !== 2) problems.push(where(`rules are not "2 courses at 2000+"`));
    for (const k of [...Object.keys(r.groupMax), ...Object.keys(r.groupMinCredits)])
      if (!GROUP_IDS.includes(k as GroupId)) problems.push(where(`rule names unknown group "${k}"`));
    if (!/^https:\/\/www\.duffield\.cornell\.edu\//.test(c.source.url)) problems.push(where(`source url is not a Duffield page`));
    if (!c.source.quote.length) problems.push(where(`no quoted rules`));
  }
  return problems;
}

/** Problems with the petitions source: every row must re-derive (ids, categories,
 *  takenThrough) from its printed cells exactly as stored. */
export function petitionProblems(src: PetitionsSource): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(src.revised)) problems.push(`revised "${src.revised}" is not an ISO date`);
  for (const row of src.rows) {
    const cells = [row.prefix, row.number, row.title, row.college, row.category, row.credits, row.originalReview, row.latestReview, row.notes];
    const again = normalizeRow(cells);
    if ("problems" in again) {
      problems.push(...again.problems);
      continue;
    }
    const want = JSON.stringify([again.row.ids, again.row.categories, again.row.takenThrough ?? null, again.row.crossListed ?? null]);
    const have = JSON.stringify([row.ids, row.categories, row.takenThrough ?? null, row.crossListed ?? null]);
    if (want !== have) problems.push(`${row.prefix} ${row.number}: stored ${have}, the parser gives ${want} (re-run parse-liberal-studies-petitions.ts)`);
  }
  return problems;
}

/** Both sources → the data module, or throws listing every problem. */
export function buildData(groups: GroupsSource, petitions: PetitionsSource): LiberalStudiesData {
  const problems = [...groupProblems(groups), ...petitionProblems(petitions)];
  if (problems.length) throw new Error(`build-liberal-studies: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`);
  const byId: Record<string, PetitionEntry[]> = {};
  for (const row of petitions.rows) {
    const entry: PetitionEntry = { categories: [...row.categories], credits: row.credits, college: row.college };
    if (row.takenThrough) entry.takenThrough = row.takenThrough;
    // A cross-listing the note names carries the same approval (an identical
    // entry an id already has isn't repeated).
    for (const id of [...row.ids, ...(row.crossListed ?? [])]) {
      const list = (byId[id] ??= []);
      if (!list.some((e) => JSON.stringify(e) === JSON.stringify(entry))) list.push({ ...entry, categories: [...entry.categories] });
    }
  }
  const petitionsOut: Record<string, PetitionEntry[]> = {};
  for (const id of Object.keys(byId).sort((a, b) => a.localeCompare(b))) petitionsOut[id] = byId[id];
  return {
    version: DATA_VERSION,
    sources: { petitionsUrl: petitions.url, petitionsRevised: petitions.revised, policyUrls: groups.cohorts.map((c) => c.source.url) },
    cohorts: groups.cohorts.map((c) => ({
      id: c.id,
      enteredFrom: c.enteredFrom,
      groups: c.groups.map((g) => ({ id: g.id, label: g.label, name: g.name, bases: [...g.bases], exact: [...g.exact] })),
      rules: {
        requiredCourses: c.rules.requiredCourses,
        requiredCredits: c.rules.requiredCredits,
        minGroups: c.rules.minGroups,
        groupMax: { ...c.rules.groupMax },
        groupMinCredits: { ...c.rules.groupMinCredits },
        minCoursesAtOrAbove: { ...c.rules.minCoursesAtOrAbove },
      },
      source: { url: c.source.url, quote: [...c.source.quote] },
    })),
    petitions: petitionsOut,
  };
}

/** Petitioned categories that count in no group under a cohort's tag rule, by
 *  category → count of ids (a bare "SCD" under Fall 2024+: spec 037 D3 places it
 *  in Group 7, which the planner applies when it reads the petition). */
export function unplacedPetitionCategories(data: LiberalStudiesData, cohort: CohortId): Record<string, number> {
  const c = data.cohorts.find((x) => x.id === cohort)!;
  const out: Record<string, number> = {};
  for (const entries of Object.values(data.petitions))
    for (const e of entries) for (const cat of e.categories) if (!tagGroups(c, cat).length) out[cat] = (out[cat] ?? 0) + 1;
  return out;
}

export function renderJson(data: LiberalStudiesData): string {
  return JSON.stringify(data, null, 2) + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  const groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as GroupsSource;
  const petitions = JSON.parse(readFileSync(PETITIONS_FILE, "utf8")) as PetitionsSource;
  const data = buildData(groups, petitions);
  const next = renderJson(data);
  const prev = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8").replace(/\r\n/g, "\n") : null;
  const entries = Object.values(data.petitions).flat();
  console.log(`\n── build-liberal-studies (${check ? "CHECK" : "WRITE"}) ──`);
  console.log(`   petitions list revised ${data.sources.petitionsRevised}: ${petitions.rows.length} rows`);
  console.log(`   petitioned course ids ${Object.keys(data.petitions).length} (${entries.length} entries; ids with two rows: ${Object.entries(data.petitions).filter(([, v]) => v.length > 1).map(([k]) => k).join(", ") || "none"})`);
  console.log(`   entries with takenThrough ${entries.filter((e) => e.takenThrough).length}`);
  for (const c of data.cohorts) {
    const unplaced = Object.entries(unplacedPetitionCategories(data, c.id)).map(([k, n]) => `${k} ×${n}`);
    console.log(`   ${c.id} (from ${c.enteredFrom}): ${c.groups.length} groups; petitioned categories outside the tag rule: ${unplaced.join(", ") || "none"}`);
  }
  if (check) {
    if (prev !== next) {
      console.error(`\nSTALE: ${DATA_VERSION}.json differs from what the sources produce. Re-run without --check.`);
      process.exit(1);
    }
    console.log(`\n${DATA_VERSION}.json is current.`);
    return;
  }
  if (prev === next) console.log("\nNo change.");
  else {
    writeFileSync(OUT_FILE, next);
    console.log(`\nWrote ${DATA_VERSION}.json.`);
  }
}

if (require.main === module) main();
