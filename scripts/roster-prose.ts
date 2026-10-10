// scripts/roster-prose.ts
// Read-only access to Cornell's prerequisite prose from the public Class Roster
// API, one subject at a time, cached as JSON under scripts/out/roster-cache/.
// Shared by audit-prereqs.ts (what Cornell says today) and parse-prereqs.ts
// (the fallback-roster check before clearing a tree whose prose went blank).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://classes.cornell.edu/api/2.0/search/classes.json";
const THROTTLE_MS = 1100;
export const ROSTER_CACHE_DIR = join(__dirname, "out", "roster-cache");

export type RosterRow = {
  subject: string;
  catalogNbr: string;
  titleLong?: string;
  catalogPrereq?: string | null;
  catalogCoreq?: string | null;
  catalogPrereqCoreq?: string | null;
};

/** One course's prose as a roster states it. */
export type Prose = { roster: string; prereq: string | null; coreq: string | null };

export const cleanProse = (s: string | null | undefined): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
};

const subjectOf = (id: string) => id.split("-")[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createRosterReader(opts: { refresh?: boolean; cacheDir?: string } = {}) {
  const cacheDir = opts.cacheDir ?? ROSTER_CACHE_DIR;
  const memo = new Map<string, Map<string, RosterRow>>();
  let lastFetch = 0;

  async function subject(roster: string, subj: string): Promise<Map<string, RosterRow>> {
    const key = `${roster}-${subj}`;
    const hit = memo.get(key);
    if (hit) return hit;
    mkdirSync(cacheDir, { recursive: true });
    const file = join(cacheDir, `${key}.json`);
    let rows: RosterRow[];
    if (!opts.refresh && existsSync(file)) {
      rows = JSON.parse(readFileSync(file, "utf8")) as RosterRow[];
    } else {
      const wait = lastFetch + THROTTLE_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastFetch = Date.now();
      const res = await fetch(`${API}?roster=${roster}&subject=${subj}`);
      if (res.ok) {
        const json = (await res.json()) as { data?: { classes?: RosterRow[] } };
        rows = (json.data?.classes ?? []).map((c) => ({
          subject: c.subject,
          catalogNbr: c.catalogNbr,
          titleLong: c.titleLong,
          catalogPrereq: c.catalogPrereq ?? null,
          catalogCoreq: c.catalogCoreq ?? null,
          catalogPrereqCoreq: c.catalogPrereqCoreq ?? null,
        }));
      } else {
        // The API answers 404 for a subject with no classes in that roster.
        if (res.status !== 404) throw new Error(`roster ${roster} ${subj}: HTTP ${res.status}`);
        rows = [];
      }
      writeFileSync(file, JSON.stringify(rows), "utf8");
    }
    const map = new Map(rows.map((r) => [`${r.subject}-${r.catalogNbr}`, r]));
    memo.set(key, map);
    return map;
  }

  /** Prose for each id from the first roster (in order) that lists the course;
   *  null when no roster lists it. A course listed with blank prose resolves to
   *  that roster with null fields — "listed, no prereq" — not to a later one. */
  async function proseFor(ids: string[], rosters: string[]): Promise<Map<string, Prose | null>> {
    const out = new Map<string, Prose | null>();
    for (const roster of rosters) {
      const pending = ids.filter((id) => !out.has(id));
      for (const subj of [...new Set(pending.map(subjectOf))].sort()) {
        const map = await subject(roster, subj);
        for (const id of pending.filter((x) => subjectOf(x) === subj)) {
          const row = map.get(id);
          if (!row) continue;
          out.set(id, {
            roster,
            prereq: cleanProse(row.catalogPrereq) ?? cleanProse(row.catalogPrereqCoreq),
            coreq: cleanProse(row.catalogCoreq),
          });
        }
      }
    }
    for (const id of ids) if (!out.has(id)) out.set(id, null);
    return out;
  }

  return { subject, proseFor };
}
