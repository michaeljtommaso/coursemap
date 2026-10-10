// scripts/prereq-errata.corpus.ts
// Offline corpus for prereq-errata.ts: apply, self-expiry, validation, and the
// real errata file feeding the grammar end to end. No network.
//
// Run: npx tsx prereq-errata.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyErrata, loadErrata, type Erratum } from "./prereq-errata";
import { parsePrereqs } from "./prereq-grammar";
import { treeEqual } from "./canonical-json";

let failures = 0;
let total = 0;
function check(name: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const typo: Erratum = {
  courseId: "ENGRD-2111",
  field: "prereqText",
  find: "BIOG 1350",
  replace: "BIOMG 1350",
  reason: "test",
  source: "test",
  verifiedOn: "2026-10-09",
};

console.log("\n── prereq-errata corpus ──");

check("applies a matching erratum to its own field only", () => {
  const r = applyErrata("ENGRD-2111", "CHEM 2090; MATH 1920; BIOG 1350 or BIOG 1440.", "BIOG 1350", [typo]);
  assert(r.prereqText === "CHEM 2090; MATH 1920; BIOMG 1350 or BIOG 1440.", `prereqText: ${r.prereqText}`);
  assert(r.coreqText === "BIOG 1350", "coreqText untouched");
  assert(r.applied.length === 1 && r.unmatched.length === 0, "one applied, none unmatched");
});

check("self-expires when the prose no longer contains `find`", () => {
  const r = applyErrata("ENGRD-2111", "CHEM 2090; MATH 1920; BIOMG 1350 or BIOG 1440.", null, [typo]);
  assert(r.prereqText === "CHEM 2090; MATH 1920; BIOMG 1350 or BIOG 1440.", "prose unchanged");
  assert(r.applied.length === 0 && r.unmatched.length === 1, "reported as unmatched");
});

check("blank prose leaves the erratum unmatched (never invents text)", () => {
  const r = applyErrata("ENGRD-2111", null, null, [typo]);
  assert(r.prereqText === null && r.unmatched.length === 1, "null stays null, unmatched");
});

check("other courses are untouched", () => {
  const r = applyErrata("CS-2110", "BIOG 1350", null, [typo]);
  assert(r.prereqText === "BIOG 1350" && r.applied.length === 0 && r.unmatched.length === 0, "no-op");
});

check("loadErrata rejects a malformed entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "errata-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ courseId: "X-1000", field: "prereqText", find: "" }]));
  let threw = false;
  try {
    loadErrata(bad);
  } catch {
    threw = true;
  }
  assert(threw, "malformed entry throws");
});

check("the real errata file loads and fixes ENGRD 2111 + MAE 3780 end to end", () => {
  const errata = loadErrata();
  const engrd = applyErrata("ENGRD-2111", "CHEM 2090; MATH 1920; BIOG 1350 or BIOG 1440.", null, errata);
  const r1 = parsePrereqs(engrd.prereqText, engrd.coreqText);
  assert(
    treeEqual(r1.prereqExpr, {
      type: "and",
      children: [
        { type: "course", id: "CHEM-2090" },
        { type: "course", id: "MATH-1920" },
        { type: "or", children: [{ type: "course", id: "BIOMG-1350" }, { type: "course", id: "BIOG-1440" }] },
      ],
    }),
    `ENGRD 2111 tree: ${JSON.stringify(r1.prereqExpr)}`
  );

  const mae = applyErrata(
    "MAE-3780",
    "CS 1110/CS 1112 or equivalent programming experience, MATH 2930 and PHYS 2213.",
    null,
    errata
  );
  const r2 = parsePrereqs(mae.prereqText, mae.coreqText);
  assert(
    treeEqual(r2.prereqExpr, {
      type: "and",
      children: [
        {
          type: "advisory",
          expr: { type: "or", children: [{ type: "course", id: "CS-1110" }, { type: "course", id: "CS-1112" }] },
          note: "or equivalent programming experience",
        },
        { type: "course", id: "MATH-2930" },
        { type: "course", id: "PHYS-2213" },
      ],
    }),
    `MAE 3780 tree: ${JSON.stringify(r2.prereqExpr)}`
  );
});

console.log(`\n${total - failures}/${total} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
