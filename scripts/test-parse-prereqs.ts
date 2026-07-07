// scripts/test-parse-prereqs.ts
// Offline coverage harness for prereq-grammar.ts. Fetches live FA26 prereq/coreq
// text across a broad subject spread and reports clean/partial/failed stats plus
// random samples per class. NO Firestore, NO writes — pure evaluation.
//
// Run: npx tsx test-parse-prereqs.ts

import { parsePrereqs, type ParseClass } from "./prereq-grammar";

const BASE = "https://classes.cornell.edu/api/2.0";
const ROSTER = process.env.ROSTER ?? "FA26";
const SUBJECTS = [
  "CS","MATH","PHYS","ECE","INFO","ENGRD","CHEM","BIOG","AEP","ORIE","MAE",
  "ECON","ENGL","BTRY","STSCI","CEE","BEE","CHEME","MSE","AEM","NS","PSYCH",
  "GOVT","HIST","BIOMG","BIOEE","ASTRO","MUSIC","PLSCI","ANTHR",
];

function has(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

type Sample = {
  id: string;
  prereqText: string | null;
  coreqText: string | null;
};

async function main() {
  const samples: Sample[] = [];
  for (const subj of SUBJECTS) {
    const res = await fetch(`${BASE}/search/classes.json?roster=${ROSTER}&subject=${subj}`);
    if (!res.ok) continue;
    const json = (await res.json()) as { data?: { classes?: any[] } };
    for (const c of json.data?.classes ?? []) {
      const prereqText = has(c.catalogPrereq)
        ? c.catalogPrereq
        : has(c.catalogPrereqCoreq)
          ? c.catalogPrereqCoreq
          : null;
      const coreqText = has(c.catalogCoreq) ? c.catalogCoreq : null;
      if (prereqText || coreqText) {
        samples.push({ id: `${c.subject}-${c.catalogNbr}`, prereqText, coreqText });
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const byClass: Record<ParseClass, Array<{ s: Sample; tree: string; notes: string[] }>> = {
    clean: [], partial: [], failed: [], empty: [],
  };

  for (const s of samples) {
    const r = parsePrereqs(s.prereqText, s.coreqText);
    const tree = JSON.stringify({ prereqExpr: r.prereqExpr, coreqExpr: r.coreqExpr });
    byClass[r.cls].push({ s, tree, notes: r.notes });
  }

  const total = samples.length;
  const n = (c: ParseClass) => byClass[c].length;
  const pct = (c: ParseClass) => ((n(c) / total) * 100).toFixed(1);

  console.log(`\n── PARSE COVERAGE (roster ${ROSTER}, ${SUBJECTS.length} subjects) ──`);
  console.log(`   samples with prereq/coreq text: ${total}`);
  console.log(`   clean:   ${n("clean")}  (${pct("clean")}%)`);
  console.log(`   partial: ${n("partial")}  (${pct("partial")}%)`);
  console.log(`   failed:  ${n("failed")}  (${pct("failed")}%)`);
  console.log(`   empty:   ${n("empty")}  (should be 0 here)`);
  const good = n("clean") + n("partial");
  console.log(`   clean+partial rate: ${((good / total) * 100).toFixed(1)}%`);

  const sampleOf = (c: ParseClass, k = 20) => {
    const arr = [...byClass[c]];
    // deterministic "random": shuffle by hash of id
    arr.sort((a, b) => a.s.id.split("").reduce((x, ch) => x + ch.charCodeAt(0), 0) -
                       b.s.id.split("").reduce((x, ch) => x + ch.charCodeAt(0), 0));
    const step = Math.max(1, Math.floor(arr.length / k));
    const picked = [];
    for (let i = 0; i < arr.length && picked.length < k; i += step) picked.push(arr[i]);
    return picked;
  };

  for (const c of ["clean", "partial", "failed"] as ParseClass[]) {
    console.log(`\n── ${c.toUpperCase()} — ${Math.min(20, n(c))} samples ──`);
    for (const { s, tree, notes } of sampleOf(c)) {
      console.log(`\n  ${s.id}`);
      if (s.prereqText) console.log(`    prereqText: ${s.prereqText.replace(/\s+/g, " ").trim()}`);
      if (s.coreqText) console.log(`    coreqText:  ${s.coreqText.replace(/\s+/g, " ").trim()}`);
      console.log(`    → ${tree}`);
      if (notes.length) console.log(`    notes: ${notes.join("; ")}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
