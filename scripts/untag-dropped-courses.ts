// scripts/untag-dropped-courses.ts
// Untag courses a roster sync labeled with a term whose roster no longer lists
// them (cancelled or renumbered after the sync). roster-sync only upserts the
// courses Cornell lists, so a dropped course keeps the term's tag, its time
// chip, and a place in that term's searches.
//
// For each course tagged ROSTER that Cornell's ROSTER no longer lists:
//   - with a doc in the --previous backup tagged another term, restore that
//     term's roster slug, sections and components (its state before the sync);
//   - otherwise clear them (roster null, no sections), so it reads as a
//     catalog course with no scheduled term.
// Then rebuild catalogIndex from all courses.
//
// Auth: GOOGLE_APPLICATION_CREDENTIALS → the service-account key.
// Run:  ROSTER=SP27 npx tsx untag-dropped-courses.ts --previous backups/<catalog-backup>.json          (dry run)
//       ROSTER=SP27 npx tsx untag-dropped-courses.ts --previous backups/<catalog-backup>.json --apply  (writes)
// --previous takes a catalog backup (scripts/backups/catalog-backup-*.json) from
// before the sync that tagged the courses.

import { readFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { initAdmin } from "./admin-app";
import { buildIndexRecords, newUnlocksStats, regenerateCatalogIndex } from "./catalog-index";

const BASE = "https://classes.cornell.edu/api/2.0";
const APPLY = process.argv.includes("--apply");
const ROSTER = process.env.ROSTER;
const prevIdx = process.argv.indexOf("--previous");
const PREVIOUS = prevIdx !== -1 ? process.argv[prevIdx + 1] : null;
// A full fall or spring roster lists ~4,500 courses; refuse to judge "dropped"
// from a partial fetch.
const MIN_ROSTER_COURSES = 2000;
const MAX_DROPPED_SHARE = 0.05;

function fail(msg: string): never {
  console.error(`\nUNTAG ABORTED: ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (coursemap roster check)" } });
    if (res.ok) return res.json();
    if (attempt >= 3) fail(`${url} → HTTP ${res.status}`);
    await sleep(2000 * attempt);
  }
}

async function rosterCourseIds(roster: string): Promise<Set<string>> {
  const subjects: string[] = ((await getJson(`${BASE}/config/subjects.json?roster=${roster}`)).data?.subjects ?? []).map(
    (s: { value: string }) => s.value
  );
  if (subjects.length < 100) fail(`${roster} lists only ${subjects.length} subjects`);
  const ids = new Set<string>();
  for (const subject of subjects) {
    await sleep(300);
    const classes = (await getJson(`${BASE}/search/classes.json?roster=${roster}&subject=${subject}`)).data?.classes ?? [];
    for (const c of classes) ids.add(`${c.subject}-${c.catalogNbr}`);
  }
  return ids;
}

async function main() {
  if (!ROSTER || !/^(FA|SP)\d{2}$/.test(ROSTER)) fail("set ROSTER to a fall or spring roster, e.g. ROSTER=SP27");
  if (!PREVIOUS) fail("pass --previous <catalog backup from before the sync>");
  const previous = JSON.parse(readFileSync(PREVIOUS, "utf8")).courses as Record<string, Record<string, unknown>>;
  if (!previous) fail(`${PREVIOUS} has no courses`);

  const db = initAdmin();
  console.log(`── untag-dropped-courses (${APPLY ? "APPLY" : "dry run"}) — roster ${ROSTER} ──`);

  const onRoster = await rosterCourseIds(ROSTER);
  if (onRoster.size < MIN_ROSTER_COURSES) fail(`${ROSTER} lists only ${onRoster.size} courses`);
  console.log(`   Cornell's ${ROSTER} roster lists ${onRoster.size} courses.`);

  const tagged = await db.collection("courses").where("roster", "==", ROSTER).get();
  const dropped = tagged.docs.filter((d) => !onRoster.has(d.id));
  console.log(`   ${tagged.size} course docs tagged ${ROSTER}; ${dropped.length} not on the roster.`);
  if (dropped.length > tagged.size * MAX_DROPPED_SHARE) {
    fail(`${dropped.length} of ${tagged.size} would be untagged — more than ${MAX_DROPPED_SHARE * 100}%; check the fetch`);
  }

  const plan = dropped.map((d) => {
    const prev = previous[d.id];
    const prevRoster = typeof prev?.roster === "string" && prev.roster !== ROSTER ? prev.roster : null;
    return {
      id: d.id,
      update: prevRoster
        ? {
            roster: prevRoster,
            sections: prev.sections ?? null,
            components: prev.components ?? null,
          }
        : { roster: null, sections: [], components: [] },
    };
  });
  const tally: Record<string, number> = {};
  for (const p of plan) {
    const k = p.update.roster ?? "(no term)";
    tally[k] = (tally[k] ?? 0) + 1;
  }
  console.log(`   new tags: ${JSON.stringify(tally)}`);
  for (const p of plan) console.log(`     ${p.id} → ${p.update.roster ?? "(no term)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  for (const p of plan) {
    batch.update(db.collection("courses").doc(p.id), { ...p.update, updatedAt: FieldValue.serverTimestamp() });
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`   updated ${plan.length} course docs.`);

  const all = await db.collection("courses").get();
  const records = buildIndexRecords(
    all.docs.map((d) => d.data()),
    newUnlocksStats()
  );
  const { chunkCount } = await regenerateCatalogIndex(db, records);
  console.log(`   regenerated catalogIndex: ${chunkCount} chunk(s), ${records.length} records.`);
  console.log("\nUNTAG COMPLETE.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
