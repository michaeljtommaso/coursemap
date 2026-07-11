// scripts/instructor-history.corpus.ts
// Offline corpus runner for scripts/instructor-history.ts (spec 013 §3d). NO
// network. Exits nonzero on any mismatch, same contract as the sibling corpora.
//
// Run: npx tsx instructor-history.corpus.ts   (from the scripts/ folder)

import {
  extractCourseInstructors,
  mergeRoster,
  historyNetids,
} from "./instructor-history";
import type { ClassRow as ClassRowLike } from "./roster-convert";

let failures = 0;
const checks: Array<{ name: string; fn: () => void }> = [];
function check(name: string, fn: () => void) {
  checks.push({ name, fn });
}
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}
function assertTrue(name: string, cond: boolean, detail: string) {
  if (!cond) fail(name, detail);
}

// A CS-2110-like row (instructors nest under meetings — see roster-convert.ts).
const rowFA25: ClassRowLike = {
  subject: "CS",
  catalogNbr: "2110",
  titleLong: "OOP & Data Structures",
  enrollGroups: [
    {
      classSections: [
        {
          ssrComponent: "LEC",
          section: "001",
          meetings: [
            { pattern: "TR", timeStart: "10:10AM", timeEnd: "11:25AM", instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }] },
          ],
        },
        {
          ssrComponent: "DIS",
          section: "201",
          // Same instructor again across another section → deduped by netid.
          meetings: [
            { pattern: "T", timeStart: "11:40AM", timeEnd: "12:55PM", instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }] },
          ],
        },
      ],
    },
  ],
};

check("extract unions + dedupes instructors by netid across sections", () => {
  const map = extractCourseInstructors([rowFA25]);
  assertEqual("one course", [...map.keys()], ["CS-2110"]);
  assertEqual("single deduped instructor", map.get("CS-2110"), [{ netid: "al123", name: "Ada Lovelace" }]);
});

check("instructor with no netid kept with netid '' and name key", () => {
  const row: ClassRowLike = {
    subject: "CS",
    catalogNbr: "3110",
    titleLong: "FP",
    enrollGroups: [
      { classSections: [{ ssrComponent: "LEC", section: "001", meetings: [
        { pattern: "MW", timeStart: "1:25PM", timeEnd: "2:15PM", instructors: [{ firstName: "Jane", lastName: "Doe" }] },
      ] }] },
    ],
  };
  const map = extractCourseInstructors([row]);
  assertEqual("name-only instructor", map.get("CS-3110"), [{ netid: "", name: "Jane Doe" }]);
});

// ── merge/dedupe across rosters ──────────────────────────────────────────────
check("merging two DIFFERENT rosters keeps both, newest-first", () => {
  let doc = mergeRoster(null, "CS-2110", "FA24", [{ netid: "aa1", name: "Anne Alpha" }]);
  doc = mergeRoster(doc, "CS-2110", "FA25", [{ netid: "al123", name: "Ada Lovelace" }]);
  assertEqual("both terms present, FA25 first", doc.terms.map((t) => t.roster), ["FA25", "FA24"]);
  assertEqual("FA25 instructors", doc.terms[0].instructors, [{ netid: "al123", name: "Ada Lovelace" }]);
});

check("re-merging the SAME roster REPLACES (idempotent, no dup term)", () => {
  let doc = mergeRoster(null, "CS-2110", "FA25", [{ netid: "old", name: "Old Prof" }]);
  doc = mergeRoster(doc, "CS-2110", "FA25", [{ netid: "al123", name: "Ada Lovelace" }]);
  assertEqual("single FA25 term", doc.terms.length, 1);
  assertEqual("replaced with the newer instructor list", doc.terms[0].instructors, [{ netid: "al123", name: "Ada Lovelace" }]);
});

check("terms are capped at 24, oldest dropped", () => {
  let doc = mergeRoster(null, "X-1", "FA00", [{ netid: "a", name: "A" }]);
  // 25 distinct fall rosters FA01..FA25 → oldest (FA00) should fall off.
  for (let y = 1; y <= 25; y++) {
    const yy = String(y).padStart(2, "0");
    doc = mergeRoster(doc, "X-1", `FA${yy}`, [{ netid: `n${y}`, name: `N${y}` }]);
  }
  assertEqual("capped at 24 terms", doc.terms.length, 24);
  assertTrue("oldest FA00 dropped", !doc.terms.some((t) => t.roster === "FA00"), JSON.stringify(doc.terms.map((t) => t.roster)));
  assertEqual("newest first is FA25", doc.terms[0].roster, "FA25");
});

check("historyNetids returns distinct real netids, drops ''", () => {
  let doc = mergeRoster(null, "CS-2110", "FA25", [{ netid: "al123", name: "Ada Lovelace" }, { netid: "", name: "TBA" }]);
  doc = mergeRoster(doc, "CS-2110", "FA24", [{ netid: "aa1", name: "Anne Alpha" }, { netid: "al123", name: "Ada Lovelace" }]);
  assertEqual("distinct netids, no ''", historyNetids(doc).sort(), ["aa1", "al123"]);
});

console.log(`\n── instructor-history corpus — ${checks.length} case(s) ──`);
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
}
console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
