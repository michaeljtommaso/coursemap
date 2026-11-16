// scripts/cross-listings.corpus.ts
// Asserted, offline corpus for cross-listings.ts, seed-cross-listings.ts and the
// authoring catalog's cross-listed subjects (layer-authoring.ts). NO network,
// NO Firestore: the roster classes below are hand-built in the API's shape
// (crseId, subject, catalogNbr). Exits nonzero on any mismatch.
//
// Run: npx tsx cross-listings.corpus.ts   (from the scripts/ folder)

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildCrossListings, courseIdOf, crossListingProblems, familiesWithSubject, familyOf, restrictToSubjects, type RosterClassRef } from "./cross-listings";
import { seededAliasMap, withCrossListedSubjects, type DistCourse } from "./layer-authoring";
import { loadCrossListingsFile, metaWriteProblems } from "./seed-cross-listings";

let failures = 0;
let checks = 0;
function assertEqual<T>(name: string, actual: T, expected: T) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

const cls = (crseId: number, subject: string, catalogNbr: string): RosterClassRef => ({ crseId, subject, catalogNbr });

// Fall: LSP 3770 = HIST 3770 = AMST 3775 (one crseId). LSP 3010 co-meets with
// LSP 6020 (its own crseId) and COML 3010 / COML 6021 are their twins.
// LSP 4210 has no twin. Spring: SPAN 2000 / LSP 2020 again, plus LSP 3770.
const fall = [
  cls(373951, "LSP", "3770"),
  cls(373951, "HIST", "3770"),
  cls(373951, "AMST", "3775"),
  cls(353334, "LSP", "3010"),
  cls(353334, "COML", "3010"),
  cls(373922, "LSP", "6020"),
  cls(373922, "COML", "6021"),
  cls(351010, "LSP", "4210"),
  cls(359453, "SPAN", "2000"),
];
const spring = [cls(359453, "LSP", "2020"), cls(373951, "LSP", "3770"), cls(0, "", "1000"), cls(5, "BAD", "x1")];

const built = buildCrossListings([...fall, ...spring]);
assertEqual("families by crseId; the representative is the first id", built.crossListings, {
  "HIST-3770": "AMST-3775",
  "LSP-3010": "COML-3010",
  "LSP-3770": "AMST-3775",
  "LSP-6020": "COML-6021",
  "SPAN-2000": "LSP-2020",
});
assertEqual("family count", built.families, 4);
assertEqual("a co-meeting graduate twin is NOT in the undergraduate course's family", familyOf(built.crossListings, "LSP-6020"), ["COML-6021", "LSP-6020"]);
assertEqual("no family for a course with no twin", built.crossListings["LSP-4210"] ?? null, null);
assertEqual("no conflicts", built.conflicts, []);
assertEqual("valid map", crossListingProblems(built.crossListings), []);
assertEqual("familyOf a member", familyOf(built.crossListings, "HIST-3770"), ["AMST-3775", "HIST-3770", "LSP-3770"]);
assertEqual("familyOf the representative", familyOf(built.crossListings, "AMST-3775"), ["AMST-3775", "HIST-3770", "LSP-3770"]);
assertEqual("familyOf a loner", familyOf(built.crossListings, "LSP-4210"), ["LSP-4210"]);
assertEqual("LSP families", familiesWithSubject(built.crossListings, "LSP"), [
  ["AMST-3775", "HIST-3770", "LSP-3770"],
  ["COML-3010", "LSP-3010"],
  ["COML-6021", "LSP-6020"],
  ["LSP-2020", "SPAN-2000"],
].sort((a, b) => a[0].localeCompare(b[0])));
assertEqual("restrict to HIST keeps whole families", restrictToSubjects(built.crossListings, ["HIST"]), { "HIST-3770": "AMST-3775", "LSP-3770": "AMST-3775" });
assertEqual("restrict to SPAN, COML", Object.keys(restrictToSubjects(built.crossListings, ["SPAN", "COML"])).sort(), ["LSP-3010", "LSP-6020", "SPAN-2000"]);
assertEqual("restrict to a subject with no family", restrictToSubjects(built.crossListings, ["MATH"]), {});
assertEqual("deterministic: input order does not matter", buildCrossListings([...spring, ...fall].reverse()).crossListings, built.crossListings);

// A reused number (the ASRC 2650 case): AAA-1000 was crseId 1 (with BBB-1000)
// in roster 0 and crseId 2 (with CCC-2000) in roster 1. It joins only its
// latest crseId's family; BBB-1000 stays alone (no family), and it is reported.
const at = (order: number, c: RosterClassRef): RosterClassRef => ({ ...c, order });
const reusedRefs = [at(0, cls(1, "AAA", "1000")), at(0, cls(1, "BBB", "1000")), at(1, cls(2, "AAA", "1000")), at(1, cls(2, "CCC", "2000"))];
const reused = buildCrossListings(reusedRefs);
assertEqual("reused number joins only its latest course", reused.crossListings, { "CCC-2000": "AAA-1000" });
assertEqual("reused number reported", reused.conflicts, [{ id: "AAA-1000", crseIds: ["1", "2"] }]);
assertEqual("reused number: input order does not matter", buildCrossListings([...reusedRefs].reverse()).crossListings, reused.crossListings);
// A renumbered course keeps its crseId: both numbers stay one family.
const renumbered = buildCrossListings([at(0, cls(7, "ASRC", "1650")), at(0, cls(7, "PHIL", "1650")), at(1, cls(7, "ASRC", "2650")), at(1, cls(7, "PHIL", "2650"))]);
assertEqual("renumbered course keeps one family", familyOf(renumbered.crossListings, "PHIL-2650"), ["ASRC-1650", "ASRC-2650", "PHIL-1650", "PHIL-2650"]);

assertEqual("courseIdOf normalizes", courseIdOf(" lsp ", "3770"), "LSP-3770");
assertEqual("courseIdOf letter suffix", courseIdOf("ENGL", "1100F"), "ENGL-1100F");
assertEqual("courseIdOf rejects junk", courseIdOf("LSP", "37-70"), null);

assertEqual("problems: chain and self", crossListingProblems({ "A-1": "B-1", "B-1": "C-1", "D-1": "D-1", "x": "Y-1" }), [
  "chain: A-1 → B-1 → C-1",
  "self entry D-1",
  "bad entry x → Y-1",
]);

// seed-cross-listings: the file loader and the catalog/meta guard.
const dir = mkdtempSync(join(tmpdir(), "xl-corpus-"));
try {
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ rosters: ["FA26"], crossListings: built.crossListings }));
  assertEqual("loads a valid file", loadCrossListingsFile(good), built.crossListings);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ crossListings: { "A-1": "B-1", "B-1": "C-1" } }));
  let threw = false;
  try {
    loadCrossListingsFile(bad);
  } catch {
    threw = true;
  }
  assertEqual("refuses a chained map", threw, true);

  assertEqual("meta write: a good map on a real-shaped doc", metaWriteProblems({ aliases: { "ENGRD-2110": "CS-2110" }, enrollmentTarget: "SP27" }, built.crossListings), []);
  const tooLongId = { ["X".repeat(41) + "-1"]: "A-1" };
  assertEqual("meta write: a map the app schema would drop is refused", metaWriteProblems({ aliases: {} }, tooLongId), ["the app's schema would drop crossListings"]);
  const huge: Record<string, string> = {};
  for (let i = 0; i < 40000; i++) huge[`SUBJ-${String(i).padStart(5, "0")}`] = "AAAA-0001";
  assertEqual("meta write: an oversized doc is refused", metaWriteProblems({ aliases: {} }, huge).length, 1);

  // The authoring catalog gives courses the subjects the app gives them.
  const aliasesFile = join(dir, "aliases.json");
  writeFileSync(aliasesFile, JSON.stringify({ "ENGRD-2110": "CS-2110" }));
  const map = seededAliasMap({ aliases: aliasesFile, crossListings: good });
  assertEqual("seeded alias map keeps only the aliases as entries", map, { "ENGRD-2110": "CS-2110" });
  const dc = (id: string): DistCourse => ({ id, subject: id.split("-")[0], number: id.split("-")[1], credits: 3 });
  const out = withCrossListedSubjects([dc("HIST-3770"), dc("CS-2110"), dc("LSP-6020"), dc("MATH-1910")], map);
  assertEqual(
    "cross-listed subjects from both maps",
    out.map((c) => [c.id, c.crossListedSubjects ?? null]),
    [["HIST-3770", ["AMST", "LSP"]], ["CS-2110", ["ENGRD"]], ["LSP-6020", ["COML"]], ["MATH-1910", null]],
  );
  const none = withCrossListedSubjects([dc("HIST-3770")], seededAliasMap({ aliases: join(dir, "none.json"), crossListings: join(dir, "none.json") }));
  assertEqual("no seed files → no subjects", "crossListedSubjects" in none[0], false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`cross-listings corpus: ${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
