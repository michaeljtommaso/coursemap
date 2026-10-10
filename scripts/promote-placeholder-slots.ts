// scripts/promote-placeholder-slots.ts
// Off-roster placeholders → real course slots, in the 2025 program JSONs.
//
// A required course missing from the synced roster was authored as a
// pattern-kind placeholder slot naming one exact course ("CHEME-2200", title
// "… — not in FA26 roster"), because a course slot must point at a real course
// doc. Once that course has a doc (e.g. after `roster-sync.ts --add-only` for
// SP26), the placeholder should become a course slot: the app then places it
// on a new board instead of listing it as a "choice" to pick.
//
// This script edits ONLY local files (seed-data/programs-2025/*.json). Pushing
// them live is seed-programs-2025.ts (dry run first), after
// validate-programs-2025.ts.
//
// Run (from scripts/):
//   npx tsx promote-placeholder-slots.ts            (DRY RUN — list promotions)
//   npx tsx promote-placeholder-slots.ts --write    (rewrite the JSON files)
//   --ids-from <file.json>     course ids from a local catalog JSON instead of
//                              the live collection (zero reads)
//   --assume-ids <file.json>   extra course ids (JSON array) to treat as
//                              existing — previews a promotion before the docs
//                              are created.
// Auth: GOOGLE_APPLICATION_CREDENTIALS (read-only: course id existence).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "degree-planner-app";
const WRITE = process.argv.includes("--write");
const DIR = join(__dirname, "seed-data", "programs-2025");
const EXACT_COURSE_RE = /^[A-Z]{2,7}-\d{4}[A-Z]?$/;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

type RawSlot = {
  id: string;
  kind: string;
  courseId: string | null;
  pattern: string | null;
  patternTitle: string | null;
  [k: string]: unknown;
};

type RawGroup = {
  id: string;
  description?: string | null;
  qualifyingRule?: { type?: string };
  courseIds: string[];
};

// Course codes in chart prose, carrying the subject onto bare numbers:
// "CHEM 3570 or 3590" → CHEM-3570, CHEM-3590.
function codesIn(text: string): string[] {
  const out: string[] = [];
  let subject: string | null = null;
  for (const m of text.matchAll(/(?:\b([A-Z]{2,7})\s+)?\b(\d{4})\b/g)) {
    if (m[1]) subject = m[1];
    if (subject) out.push(`${subject}-${m[2]}`);
  }
  return [...new Set(out)];
}

async function main() {
  console.log(`\n── promote-placeholder-slots (${WRITE ? "WRITE local JSON" : "DRY RUN"}) ──`);
  // --ids-from <json>: course ids from a local catalog file ({ courses: { id:
  // doc } } or an array of { id }) instead of reading the live collection.
  const idsFrom = argValue("--ids-from");
  let existing: Set<string>;
  if (idsFrom) {
    const raw = JSON.parse(readFileSync(idsFrom, "utf8")) as { courses?: Record<string, unknown> } | { id: string }[];
    existing = new Set(Array.isArray(raw) ? raw.map((d) => d.id) : Object.keys(raw.courses ?? {}));
    console.log(`   ${existing.size} course ids from ${idsFrom} (no Firestore reads)`);
  } else {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error("GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key (never echo it).");
      process.exit(1);
    }
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    const snap = await getFirestore().collection("courses").select().get();
    existing = new Set(snap.docs.map((d) => d.id));
  }
  const assumeFile = argValue("--assume-ids");
  if (assumeFile) {
    const extra = JSON.parse(readFileSync(assumeFile, "utf8")) as string[];
    for (const id of extra) existing.add(id);
    console.log(`   assuming ${extra.length} extra course id(s) exist (preview)`);
  }

  let promoted = 0;
  let restored = 0;
  const stillMissing: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(DIR, file);
    let text = readFileSync(path, "utf8");
    const program = JSON.parse(text) as { id: string; slots: RawSlot[] };
    let changed = 0;
    for (const s of program.slots) {
      if (s.kind !== "pattern" || !s.pattern || !EXACT_COURSE_RE.test(s.pattern)) continue;
      if (!existing.has(s.pattern)) {
        stillMissing.push(`${program.id}:${s.pattern}`);
        continue;
      }
      console.log(`   ${program.id.padEnd(24)} ${s.id.padEnd(24)} pattern ${s.pattern} → course`);
      // The JSONs are hand-formatted (one slot per line), so edit the slot's
      // line in place rather than re-serialising the whole file.
      const lines = text.split("\n");
      const at = lines.findIndex((l) => l.includes(`"id": "${s.id}",`));
      const head = `"kind": "pattern", "courseId": null, "pattern": "${s.pattern}", "patternTitle": `;
      const line = at === -1 ? "" : lines[at];
      const start = line.indexOf(head);
      const end = start === -1 ? -1 : line.indexOf(`, "electiveGroupId":`, start);
      if (start === -1 || end === -1) throw new Error(`${program.id}: could not rewrite slot ${s.id} in place`);
      lines[at] =
        line.slice(0, start) +
        `"kind": "course", "courseId": "${s.pattern}", "pattern": null, "patternTitle": null` +
        line.slice(end);
      text = lines.join("\n");
      changed++;
    }

    // "Pick one of these" (list) groups were authored without their off-roster
    // members (description "BEE 2220 or ENGRD 2210", courseIds ["ENGRD-2210"]).
    // Restore any member the description names that now has a doc.
    const groups = (JSON.parse(text) as { electiveGroups?: RawGroup[] }).electiveGroups ?? [];
    for (const g of groups) {
      if (g.qualifyingRule?.type !== "list") continue;
      const add = codesIn(g.description ?? "").filter((id) => existing.has(id) && !g.courseIds.includes(id));
      if (add.length === 0) continue;
      console.log(`   ${program.id.padEnd(24)} ${g.id.padEnd(24)} + ${add.join(", ")}`);
      const lines = text.split("\n");
      const at = lines.findIndex((l) => l.includes(`"id": "${g.id}",`));
      const ci = lines.findIndex((l, i) => i > at && l.includes(`"courseIds": [`));
      if (at === -1 || ci === -1 || !lines[ci].includes("]")) {
        throw new Error(`${program.id}: could not extend group ${g.id} in place`);
      }
      const all = [...g.courseIds, ...add];
      lines[ci] = lines[ci].replace(/"courseIds": \[[^\]]*\]/, `"courseIds": [${all.map((id) => `"${id}"`).join(", ")}]`);
      text = lines.join("\n");
      restored += add.length;
      changed++;
    }
    promoted += changed;
    if (changed > 0) {
      JSON.parse(text); // the edited file must still parse
      if (WRITE) writeFileSync(path, text, "utf8");
    }
  }
  console.log(`\n   edits: ${promoted} (list-group members restored: ${restored})`);
  console.log(`   exact-course placeholders still without a doc: ${stillMissing.length}`);
  for (const m of stillMissing) console.log(`     ${m}`);
  if (!WRITE) console.log(`\nDRY RUN — no files changed. Re-run with --write to rewrite the JSONs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
