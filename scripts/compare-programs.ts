// scripts/compare-programs.ts
// After re-seeding one or more programs, prove nothing else changed and the new
// docs are readable by the app:
//   - compare every programs/* doc with a backup (backup-programs.ts) and list
//     which changed;
//   - for each program named on the command line, print its elective groups
//     (rule, list size, name) and how many slots carry a category;
//   - parse EVERY doc with the app's ProgramSchema, exactly as the program list
//     does. One unparsable doc breaks the major picker for every major.
// Read-only: about one read per program.
//
// Run from scripts/:  npx tsx compare-programs.ts <programs-backup.json> [programId ...]

import { readFileSync } from "node:fs";
import { initAdmin } from "./admin-app";
import { ProgramSchema } from "../cornell-degree-planner/src/lib/schemas";

/** JSON with object keys sorted, so key order never reads as a change. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );

type Group = { id: string; name: string; qualifyingRule: { type: string; min_number?: number }; courseIds?: string[] };

async function main() {
  const [backupPath, ...targets] = process.argv.slice(2);
  if (!backupPath) throw new Error("usage: compare-programs.ts <programs-backup.json> [programId ...]");
  const before = JSON.parse(readFileSync(backupPath, "utf8")).programs as Record<string, unknown>;
  const db = initAdmin();
  const snap = await db.collection("programs").get();

  const changed = snap.docs.filter((d) => stable(d.data()) !== stable(before[d.id])).map((d) => d.id);
  console.log(
    `   programs now ${snap.size}, before ${Object.keys(before).length}; unchanged ${snap.size - changed.length}; changed: ${changed.join(", ") || "none"}`
  );
  const unexpected = changed.filter((id) => !targets.includes(id));
  if (targets.length && unexpected.length) console.log(`   !! changed but not named: ${unexpected.join(", ")}`);

  for (const id of targets) {
    const doc = snap.docs.find((d) => d.id === id);
    if (!doc) {
      console.log(`   !! ${id}: not found`);
      continue;
    }
    const data = doc.data() as { electiveGroups: Group[]; slots: { category?: string }[] };
    console.log(`\n   ${id}`);
    for (const g of data.electiveGroups) {
      const rule = g.qualifyingRule.type + (g.qualifyingRule.min_number ? `>=${g.qualifyingRule.min_number}` : "");
      console.log(`     ${g.id.padEnd(30)} ${rule.padEnd(14)} ${String(g.courseIds?.length ?? 0).padStart(5)}  ${g.name}`);
    }
    console.log(`     slots ${data.slots.length}, with category ${data.slots.filter((s) => s.category).length}`);
  }

  const bad = snap.docs.filter((d) => !ProgramSchema.safeParse(d.data()).success).map((d) => d.id);
  console.log(`\n   every doc parses with the app's schema: ${bad.length ? "NO — " + bad.join(", ") : "yes"}`);
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
