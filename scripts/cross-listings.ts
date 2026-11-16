// scripts/cross-listings.ts
// Cross-listing families from the Class Roster API (pure, no I/O).
//
// A cross-listed course is ONE course offered under several codes: the roster
// gives every one of its classes the same `crseId` (LSP 3770, HIST 3770 and
// AMST 3775 are all crseId 373951, with different `crseOfferNbr`s). A course
// that only meets with another one (a graduate twin such as LSP 3010 / LSP 6020,
// listed together in `enrollGroups[].simpleCombinations`) has its OWN crseId, so
// it is not a cross-listing and never joins a family here.
//
// The result is a member → representative map (same shape as catalog/meta
// aliases: every member but the representative is a key, the representative is
// the family's alphabetically first id and never a key). The app reads it ONLY
// to give a course its cross-listed subjects (the `crossListed` rule leaf); it
// never canonicalizes ids with it, unlike the alias map.
//
// A crseId keeps its family across rosters (a renumbered course keeps its
// crseId, so ASRC 1650 and its later number ASRC 2650 stay one family). A
// course number can also move to a DIFFERENT course (ASRC 2650 was one of the
// AMST/ENGL 2650 codes in FA24 and the renumbered ASRC/PHIL course in SP26):
// each id joins only the crseId of the latest roster it appears in (`order`),
// so a reused number never merges two courses. `conflicts` lists every id seen
// under more than one crseId for the build report.

export const COURSE_ID_RE = /^[A-Z]+-\d+[A-Z]?$/;

/** One roster class reduced to what a family needs; `order` = the roster's
 *  position, oldest first (absent = 0). */
export type RosterClassRef = { crseId: number | string; subject: string; catalogNbr: string; order?: number };

export type CrossListingBuild = {
  /** member id → representative id (alphabetically first id of its family). */
  crossListings: Record<string, string>;
  /** Number of families (two or more ids). */
  families: number;
  /** Ids seen under more than one crseId, with those crseIds (sorted). */
  conflicts: { id: string; crseIds: string[] }[];
};

export function courseIdOf(subject: string, catalogNbr: string): string | null {
  const id = `${String(subject).trim().toUpperCase()}-${String(catalogNbr).trim().toUpperCase()}`;
  return COURSE_ID_RE.test(id) ? id : null;
}

/** Group roster classes into cross-listing families by crseId. */
export function buildCrossListings(classes: Iterable<RosterClassRef>): CrossListingBuild {
  // Union-find over course ids; each crseId links all ids it was offered under.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  // Each id's crseId in the latest roster it appears in (ties: the larger crseId).
  const latest = new Map<string, { order: number; crse: string }>();
  const crseIdsOf = new Map<string, Set<string>>();
  for (const c of classes) {
    const id = courseIdOf(c.subject, c.catalogNbr);
    if (!id || c.crseId == null || String(c.crseId).trim() === "") continue;
    const crse = String(c.crseId).trim();
    const order = c.order ?? 0;
    (crseIdsOf.get(id) ?? crseIdsOf.set(id, new Set()).get(id)!).add(crse);
    const was = latest.get(id);
    if (!was || order > was.order || (order === was.order && crse.localeCompare(was.crse, undefined, { numeric: true }) > 0)) latest.set(id, { order, crse });
  }
  const firstOfCrse = new Map<string, string>();
  for (const [id, { crse }] of [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    add(id);
    const first = firstOfCrse.get(crse);
    if (first == null) firstOfCrse.set(crse, id);
    else union(first, id);
  }

  const members = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    (members.get(root) ?? members.set(root, []).get(root)!).push(id);
  }
  const crossListings: Record<string, string> = {};
  let families = 0;
  for (const ids of members.values()) {
    if (ids.length < 2) continue;
    families++;
    ids.sort();
    const rep = ids[0];
    for (const id of ids.slice(1)) crossListings[id] = rep;
  }
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(crossListings).sort()) sorted[k] = crossListings[k];

  const conflicts = [...crseIdsOf.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([id, s]) => ({ id, crseIds: [...s].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { crossListings: sorted, families, conflicts };
}

/** Problems with a member → representative map ([] = valid): bad ids, a
 *  self-entry, or a representative that is itself a member (a chain). */
export function crossListingProblems(map: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [member, rep] of Object.entries(map)) {
    if (!COURSE_ID_RE.test(member) || !COURSE_ID_RE.test(rep)) out.push(`bad entry ${member} → ${rep}`);
    else if (member === rep) out.push(`self entry ${member}`);
    else if (map[rep] !== undefined) out.push(`chain: ${member} → ${rep} → ${map[rep]}`);
  }
  return out;
}

/** The ids in the family of `id` (itself included), or [id] when it has none. */
export function familyOf(map: Record<string, string>, id: string): string[] {
  const rep = map[id] ?? id;
  const ids = Object.keys(map).filter((k) => map[k] === rep);
  return ids.length ? [rep, ...ids].sort() : [id];
}

/** Only the families that contain an id of one of these subjects (whole
 *  families: their other members stay, so a twin sees every subject). */
export function restrictToSubjects(map: Record<string, string>, subjects: string[]): Record<string, string> {
  const keep = new Set<string>();
  for (const s of subjects) for (const ids of familiesWithSubject(map, s)) keep.add(map[ids[0]] ?? ids[0]);
  const out: Record<string, string> = {};
  for (const [m, rep] of Object.entries(map)) if (keep.has(rep)) out[m] = rep;
  return out;
}

/** Families that contain an id of this subject, as sorted id lists. */
export function familiesWithSubject(map: Record<string, string>, subject: string): string[][] {
  const byRep = new Map<string, string[]>();
  for (const [m, rep] of Object.entries(map)) (byRep.get(rep) ?? byRep.set(rep, [rep]).get(rep)!).push(m);
  const prefix = `${subject}-`;
  return [...byRep.values()]
    .filter((ids) => ids.some((i) => i.startsWith(prefix)))
    .map((ids) => ids.sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}
