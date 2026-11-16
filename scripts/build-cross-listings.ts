// scripts/build-cross-listings.ts
// Build scripts/seed-data/cross-listings.json from the Cornell Class Roster API:
// every cross-listing family (one course offered under several codes, i.e. the
// same crseId; see cross-listings.ts) over a set of rosters. Network only: it
// touches no Firestore. seed-cross-listings.ts writes the file to catalog/meta.
//
// Run (from scripts/):
//   npx tsx build-cross-listings.ts [--subjects LSP,...] [--rosters FA24,SP25,...] [--cache <dir>] [--out <file>]
//
//   --subjects keep only the families with a course of these subjects (whole
//              families). Every crossListed rule of every live layer reads the
//              seeded map, so a scope lets a rollout go one program family at a
//              time; the file records it. Default: every family.
//   --rosters  roster slugs to read (default: the six most recent fall and
//              spring rosters in /config/rosters.json)
//   --cache    keep each roster/subject's class refs here and reuse them on a
//              re-run (default: scripts/backups/roster-crosslist-cache, gitignored)
//   --out      default scripts/seed-data/cross-listings.json
//
// One request at a time with a pause between them (the API is free and public;
// be polite). Prints the family count, the LSP families as a spot check, and
// any id seen under two crseIds. Exit 0 written, 1 fetch failure (nothing written).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { buildCrossListings, crossListingProblems, familiesWithSubject, restrictToSubjects, type RosterClassRef } from "./cross-listings";

const BASE = "https://classes.cornell.edu/api/2.0";
const PAUSE_MS = 400;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with three tries; a 404 (the API's answer for a subject with no
 *  classes that roster) is null. */
async function getJson<T>(url: string): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(2000 * attempt);
    }
  }
}

async function defaultRosters(): Promise<string[]> {
  const json = await getJson<{ data?: { rosters?: { slug: string }[] } }>(`${BASE}/config/rosters.json`);
  const regular = (json?.data?.rosters ?? []).map((r) => r.slug).filter((s) => /^(FA|SP)\d\d$/.test(s));
  return regular.slice(-6);
}

async function rosterClasses(roster: string, cacheDir: string): Promise<RosterClassRef[]> {
  const subjectsJson = await getJson<{ data?: { subjects?: { value: string }[] } }>(`${BASE}/config/subjects.json?roster=${roster}`);
  const subjects = (subjectsJson?.data?.subjects ?? []).map((s) => s.value).filter(Boolean).sort();
  if (subjects.length === 0) throw new Error(`no subjects for roster ${roster}`);
  const out: RosterClassRef[] = [];
  let fetched = 0;
  for (const subject of subjects) {
    const file = join(cacheDir, `${roster}-${subject}.json`);
    let refs: RosterClassRef[];
    if (existsSync(file)) refs = JSON.parse(readFileSync(file, "utf-8")) as RosterClassRef[];
    else {
      await sleep(PAUSE_MS);
      const json = await getJson<{ data?: { classes?: { crseId: number; subject: string; catalogNbr: string }[] } }>(
        `${BASE}/search/classes.json?roster=${roster}&subject=${encodeURIComponent(subject)}`,
      );
      refs = (json?.data?.classes ?? []).map((c) => ({ crseId: c.crseId, subject: c.subject, catalogNbr: c.catalogNbr }));
      writeFileSync(file, JSON.stringify(refs));
      fetched++;
    }
    out.push(...refs);
  }
  console.log(`   ${roster}: ${subjects.length} subjects (${fetched} fetched, ${subjects.length - fetched} cached), ${out.length} classes`);
  return out;
}

async function main() {
  const rosters = flag("--rosters")?.split(",").map((s) => s.trim()).filter(Boolean) ?? (await defaultRosters());
  const cacheDir = resolve(flag("--cache") ?? join(__dirname, "backups", "roster-crosslist-cache"));
  const outFile = resolve(flag("--out") ?? join(__dirname, "seed-data", "cross-listings.json"));
  mkdirSync(cacheDir, { recursive: true });
  console.log(`\n── build-cross-listings — rosters ${rosters.join(", ")} ──`);

  const all: RosterClassRef[] = [];
  // `order` = the roster's position (oldest first): an id joins the family of
  // its latest roster's crseId (a reused course number never merges courses).
  for (const [order, r] of rosters.entries()) all.push(...(await rosterClasses(r, cacheDir)).map((c) => ({ ...c, order })));

  const built = buildCrossListings(all);
  const problems = crossListingProblems(built.crossListings);
  if (problems.length) throw new Error(`invalid map: ${problems.slice(0, 5).join("; ")}`);

  const subjects = flag("--subjects")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const map = subjects?.length ? restrictToSubjects(built.crossListings, subjects) : built.crossListings;
  const families = new Set(Object.values(map)).size;
  const file = {
    source: "Cornell Class Roster API: classes sharing a crseId (one course under several codes)",
    rosters,
    ...(subjects?.length ? { subjects } : {}),
    families,
    crossListings: map,
  };
  writeFileSync(outFile, `${JSON.stringify(file, null, 2)}\n`);

  console.log(`   ${built.families} families in all${subjects?.length ? `; kept ${families} with ${subjects.join(", ")}` : ""}; ${Object.keys(map).length} member entries → ${outFile}`);
  const lsp = familiesWithSubject(built.crossListings, "LSP");
  console.log(`   LSP families: ${lsp.length}`);
  for (const ids of lsp) console.log(`     ${ids.join(" ")}`);
  if (built.conflicts.length) {
    console.log(`   ids under more than one crseId: ${built.conflicts.length}`);
    for (const c of built.conflicts.slice(0, 30)) console.log(`     ${c.id}: ${c.crseIds.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
