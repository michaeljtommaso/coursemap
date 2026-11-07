// scripts/liberal-studies.corpus.ts
// Asserted, offline corpus runner for parse-liberal-studies-petitions.ts and
// build-liberal-studies.ts (spec 037 D2, D3, D12), plus the liberal studies
// categories build-credit-tables.ts reads from Engineering's credit table (D4):
// "CEE 4560/61/62" naming three ids, "See Notes Column" rows taking their
// categories from the note with takenThrough, cross-listings the note names
// carrying the row's approval, comma splitting with and without spaces, a bare
// "SCD" kept as printed, the tag counting rule for both entering
// classes, and the committed sources and JSON being current. Exits nonzero on any
// mismatch.
//
// Run: npx tsx liberal-studies.corpus.ts   (from the scripts/ folder)

import { readFileSync } from "node:fs";
import {
  GROUPS_FILE,
  OUT_FILE,
  PETITIONS_FILE,
  buildData,
  groupProblems,
  petitionProblems,
  renderJson,
  tagBase,
  tagGroups,
  type GroupsSource,
} from "./build-liberal-studies";
import { liberalStudiesCategories } from "./build-credit-tables";
import {
  HEADER,
  crossListings,
  expandNumbers,
  isoDate,
  normalizeRow,
  notesApproval,
  parsePetitions,
  splitCategories,
  type PetitionsSource,
} from "./parse-liberal-studies-petitions";

const checks: { name: string; fn: () => void }[] = [];
let failures = 0;
const check = (name: string, fn: () => void) => checks.push({ name, fn });
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}
function assertThrows(name: string, fn: () => unknown, pattern: RegExp) {
  try {
    fn();
    fail(name, "expected a throw");
  } catch (e) {
    if (!pattern.test(String((e as Error).message))) fail(name, `threw "${(e as Error).message}", expected ${pattern}`);
  }
}

const NOTE_KCM_ETM =
  "Approved in KCM, ETM category if taken Summer 2024 and prior. See class roster for updated category approval beginning Fall 2024.";
const row = (prefix: string, number: string, category: string, notes = "", credits = "3") => [
  prefix,
  number,
  "A Course",
  "A&S",
  category,
  credits,
  "SP 2018",
  "Fall 2023",
  notes,
];
const parsed = (cells: unknown[]) => {
  const r = normalizeRow(cells);
  if ("problems" in r) throw new Error(r.problems.join("; "));
  return r.row;
};

check("numbers: a plain number, and 4560/61/62 → three", () => {
  assertEqual("plain", expandNumbers("2710"), ["2710"]);
  assertEqual("slashes", expandNumbers("4560/61/62"), ["4560", "4561", "4562"]);
  assertEqual("full second", expandNumbers("4560/4570"), ["4560", "4570"]);
  assertEqual("not a number", expandNumbers("45x0"), null);
});

check("CEE 4560/61/62 is one row with three ids", () => {
  const r = parsed(row("CEE", "4560/61/62", "CA, SBA"));
  assertEqual("ids", r.ids, ["CEE-4560", "CEE-4561", "CEE-4562"]);
  assertEqual("categories", r.categories, ["CA", "SBA"]);
  assertEqual("number kept as printed", r.number, "4560/61/62");
});

check("categories split on commas, spaced or not; SCD kept as printed", () => {
  assertEqual("spaced", splitCategories("SBA, SSC"), ["SBA", "SSC"]);
  assertEqual("unspaced", splitCategories("CA,LA,SBA,KCM"), ["CA", "LA", "SBA", "KCM"]);
  assertEqual("SCD", parsed(row("ENGRG", "3700", "SCD")).categories, ["SCD"]);
  assertEqual("no takenThrough on an ordinary row", "takenThrough" in parsed(row("AEM", "2710", "SBA, SSC")), false);
});

check('"See Notes Column": categories from the note, takenThrough SU24', () => {
  assertEqual("note", notesApproval(NOTE_KCM_ETM), { categories: ["KCM", "ETM"], takenThrough: "SU24" });
  const r = parsed(row("COGST", "2200", "See Notes Column", NOTE_KCM_ETM));
  assertEqual("categories", r.categories, ["KCM", "ETM"]);
  assertEqual("takenThrough", r.takenThrough, "SU24");
  assertEqual("printed category kept", r.category, "See Notes Column");
  // The note can carry other text before the approval (a cross-listing).
  const x = parsed(row("COGST", "3660", "See Notes Column", `Also HD 3660 (crosslisted). ${NOTE_KCM_ETM.replace("KCM, ETM", "KCM, SBA")}`));
  assertEqual("after other text", [x.categories, x.takenThrough], [["KCM", "SBA"], "SU24"]);
});

check("cross-listings the note names carry the row's approval", () => {
  assertEqual("two, with and", crossListings("Also HIST 2005 and ENGL 2999 (crosslisted)"), ["HIST-2005", "ENGL-2999"]);
  assertEqual(
    "serial comma",
    crossListings("Also FREN 2350, ITAL 2350, and MEDVL 2350 (crosslisted). Approved in HA category if taken Summer 2024 and prior."),
    ["FREN-2350", "ITAL-2350", "MEDVL-2350"],
  );
  assertEqual("commas only", crossListings("Also ECE 2750, INFO 2750, STS 2751 (crosslisted)"), ["ECE-2750", "INFO-2750", "STS-2751"]);
  assertEqual("after a former number", crossListings("Formerly ILRIC 4330. Also GOVT 3303 (crosslisted)"), ["GOVT-3303"]);
  assertEqual("after a semicolon", crossListings("Formerly Interior Design Studio I; Also VISST 1101 (crosslisted)."), ["VISST-1101"]);
  assertEqual(
    "limited to the printed course",
    crossListings("Also PE 1180 (crosslisted), however, only allowed for liberal studies credit when taken as PMA 1200. Formerly DANCE 1200."),
    [],
  );
  assertEqual("no cross-listing", crossListings("Also PSYCH 6050. Approved in KCM category if taken Summer 2024 and prior."), []);
  assertEqual("an unread shape", crossListings("Crosslisted with the HIST version"), null);
  const r = parsed(row("MUSIC", "3613", "LA", "Also LATA 3613 (crosslisted)"));
  assertEqual("row", [r.ids, r.crossListed], [["MUSIC-3613"], ["LATA-3613"]]);
  assertEqual("no field without one", "crossListed" in parsed(row("AEM", "2710", "SBA, SSC")), false);
  assertEqual("an unread shape is a problem", "problems" in normalizeRow(row("HIST", "2005", "HA", "crosslisted somewhere")), true);
});

check("rows that don't parse are reported, not guessed", () => {
  const bad = normalizeRow(row("ART", "1500", "See Notes Column", "Ask the department."));
  assertEqual("note without an approval", "problems" in bad, true);
  assertEqual("unknown category", "problems" in normalizeRow(row("PHIL", "1100", "XYZ")), true);
  assertEqual("odd number", "problems" in normalizeRow(row("PHIL", "11a0", "KCM")), true);
  assertEqual("odd credits", "problems" in normalizeRow(row("PHIL", "1100", "KCM", "", "three")), true);
  assertThrows("parsePetitions lists them", () => parsePetitions([HEADER, row("PHIL", "1100", "XYZ")], "10/23/26"), /unknown category "XYZ"/);
  assertThrows("a wrong header", () => parsePetitions([["Prefix"], row("PHIL", "1100", "KCM")], "10/23/26"), /header row/);
});

check("parsePetitions: dates, header row, blank rows skipped", () => {
  assertEqual("iso", isoDate("10/23/26"), "2026-10-23");
  const src = parsePetitions([HEADER, row("AEM", "2710", "SBA, SSC"), ["", "", "", "", "", "", "", "", ""]], "10/23/26");
  assertEqual("rows", src.rows.length, 1);
  assertEqual("revised", [src.revisedAsPrinted, src.revised, src.retrieved], ["10/23/26", "2026-10-23", "2026-11-07"]);
});

check("tag counting rule (D2), both entering classes", () => {
  const groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as GroupsSource;
  const [fa24, fa20] = groups.cohorts;
  assertEqual("base at the last hyphen", [tagBase("LAD-HE"), tagBase("SCD"), tagBase("CE-EN")], ["LAD", "SCD", "CE"]);
  const cases: [string, string[], string[]][] = [
    // tag, Fall 2024+ groups, Fall 2020 – Spring 2024 groups
    ["LAD-HE", ["g1"], ["g1"]],
    ["ALC-HA", ["g1"], ["g1"]],
    ["SSC-AAP", ["g4"], ["g4"]],
    ["SCD-HA", ["g1"], ["g1"]],
    ["SCD-AS", ["g7"], ["g1"]],
    ["D-AG", ["g7"], ["g7"]],
    ["D-HE", [], []],
    ["D-HA", [], []],
    ["HST-AG", ["g2"], ["g2"]],
    ["CE-EN", ["g6"], ["g6"]],
    ["FL-AG", ["g5"], ["g5"]],
    ["SCD", [], ["g1"]], // a petitioned bare SCD: the planner places it in Group 7 for Fall 2024+ (D3)
    ["PBS-AS", [], []],
  ];
  for (const [tag, a, b] of cases) {
    assertEqual(`${tag} fa2024`, tagGroups(fa24, tag), a);
    assertEqual(`${tag} fa2020`, tagGroups(fa20, tag), b);
  }
  assertEqual("rules fa2024", [fa24.rules.groupMax, fa24.rules.groupMinCredits], [{ g6: 2 }, { g7: 3 }]);
  assertEqual("rules fa2020", [fa20.rules.groupMax, fa20.rules.groupMinCredits], [{ g6: 2 }, {}]);
});

check("group tables: a base in two groups, or a wrong label, is a problem", () => {
  const groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as GroupsSource;
  assertEqual("committed groups are clean", groupProblems(groups), []);
  const broken = JSON.parse(JSON.stringify(groups)) as GroupsSource;
  broken.cohorts[0].groups[1].bases.push("CA");
  broken.cohorts[1].groups[0].label = "Arts";
  const p = groupProblems(broken);
  assertEqual("two problems", p.length, 2);
});

check("petitions source: re-derives from its printed cells; drift is a problem", () => {
  const src = JSON.parse(readFileSync(PETITIONS_FILE, "utf8")) as PetitionsSource;
  assertEqual("committed petitions are clean", petitionProblems(src), []);
  const drifted = JSON.parse(JSON.stringify(src)) as PetitionsSource;
  drifted.rows[0].categories = ["FL"];
  assertEqual("drift", petitionProblems(drifted).length, 1);
});

check("committed data: counts, the three CEE ids, two-row ids, takenThrough entries", () => {
  const groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as GroupsSource;
  const src = JSON.parse(readFileSync(PETITIONS_FILE, "utf8")) as PetitionsSource;
  const data = buildData(groups, src);
  assertEqual("rows", src.rows.length, 380);
  // 380 printed ids plus 39 cross-listings named in 26 rows' notes (the four PMA
  // rows limit their approval to PMA, so their PE twins aren't added).
  assertEqual("ids", Object.keys(data.petitions).length, 419);
  assertEqual("rows naming cross-listings", src.rows.filter((r) => r.crossListed).length, 26);
  assertEqual("PE twins of PMA rows", ["PE-1180", "PE-1183", "PE-1184", "PE-1185"].filter((id) => id in data.petitions), []);
  assertEqual("GOVT-3303 is ILRGL 4330's approval", data.petitions["GOVT-3303"], data.petitions["ILRGL-4330"]);
  assertEqual("LATA-3613 is MUSIC 3613's approval", data.petitions["LATA-3613"], data.petitions["MUSIC-3613"]);
  assertEqual("a dated cross-listing keeps takenThrough", data.petitions["HD-3660"], [{ categories: ["KCM", "SBA"], credits: data.petitions["COGST-3660"][0].credits, college: data.petitions["COGST-3660"][0].college, takenThrough: "SU24" }]);
  for (const id of ["CEE-4560", "CEE-4561", "CEE-4562"]) assertEqual(id, data.petitions[id], [{ categories: ["CA", "SBA"], credits: "3", college: "Eng" }]);
  assertEqual("INDO-1100 has both rows", data.petitions["INDO-1100"]?.map((e) => e.categories), [["FL", "CA"], ["FL"]]);
  assertEqual("COGST-2200", data.petitions["COGST-2200"], [{ categories: ["KCM", "ETM"], credits: "3", college: "A&S", takenThrough: "SU24" }]);
  // 27 printed rows' ids plus their 12 cross-listings.
  assertEqual("takenThrough entries", Object.values(data.petitions).flat().filter((e) => e.takenThrough).length, 39);
  assertEqual("ENGRG-3700 SCD", data.petitions["ENGRG-3700"]?.[0].categories, ["SCD"]);
  assertEqual("credits as printed", data.petitions["AEM-2710"]?.[0].credits, "1.5");
  assertEqual("cohorts", data.cohorts.map((c) => [c.id, c.enteredFrom]), [["fa2024", "FA24"], ["fa2020", "FA20"]]);
  assertEqual("policy urls", data.sources.policyUrls.length, 2);
});

check("the JSON on disk is current (--check)", () => {
  const groups = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as GroupsSource;
  const src = JSON.parse(readFileSync(PETITIONS_FILE, "utf8")) as PetitionsSource;
  const onDisk = readFileSync(OUT_FILE, "utf8").replace(/\r\n/g, "\n");
  if (onDisk !== renderJson(buildData(groups, src))) fail("current", "the data JSON is stale: run npx tsx build-liberal-studies.ts");
});

check("exam credit: liberal studies categories from Engineering's requirement cell (D4)", () => {
  assertEqual("FL", liberalStudiesCategories("Liberal Studies Distribution Requirement in the Foreign Language (FL) category"), ["FL"]);
  assertEqual(
    "LA or ALC",
    liberalStudiesCategories("Liberal Studies Distribution Requirement in the Literature and the Arts (LA) or Arts, Literature, and Culture (ALC) category."),
    ["LA", "ALC"],
  );
  assertEqual(
    "two requirements",
    liberalStudiesCategories("Two Liberal Studies Distribution Requirements in the Social and Behavioral Analysis (SBA) or Social Sciences (SSC) category"),
    ["SBA", "SSC"],
  );
  assertEqual("not liberal studies", liberalStudiesCategories("First-Year Writing Seminar (FWS)"), null);
  assertEqual("liberal studies with no code", liberalStudiesCategories("Liberal Studies elective"), []);
});

for (const { name, fn } of checks) {
  const before = failures;
  try {
    fn();
  } catch (e) {
    fail(name, `threw: ${(e as Error).message}`);
  }
  if (failures === before) console.log(`  ✓ ${name}`);
}
if (failures) {
  console.error(`\nCORPUS FAILED: ${failures} mismatch(es).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
